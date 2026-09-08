import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LocalIndex } from '../src/local-index.js';
import { localQuery } from '../src/local-query.js';
import { sha256, subjectId } from '../src/util.js';
import type { Fact, Finding } from '../src/types.js';

function fact(name: string, path = 'cache/session.ts', kind = 'FUNCTION'): Fact {
  const locator = `${path}#${name}`;
  return { id: subjectId('app', locator), locator, path, kind, language: 'TS', contentHash: sha256(locator),
    signatureHash: sha256(name), tags: [], effects: ['CANCEL_REQUEST'], metrics: { lines: 10 }, line: 1 };
}
function publish(index: LocalIndex, facts: Fact[], findings: Finding[] = []) {
  index.begin('task-test', {});
  index.ingest('app', '/app', { facts, findings, rulesExecuted: [], analyzer: 'fixture', sourceRevision: 'same',
    configurationDigest: 'same', environment: {}, coverage: { discovery: 'COMPLETE', semantic: 'PARTIAL', limitations: ['Runtime dispatch unresolved'] } });
  return index.commit(['app']);
}
const task = 'Why does cancellation allow a callback to update a released session?';

test('task brief finds an enclosing owner and its counterevidence without confusing notes with proof', () => {
  const index = new LocalIndex(':memory:');
  try {
    const owner = fact('Session.cancel', undefined, 'METHOD');
    const callback = fact('Session.cancel.deliver@callback:17');
    const file = fact('file', undefined, 'FILE');
    const facts = [owner, callback, file];
    const findings: Finding[] = [{ subjectId: owner.id, ruleId: 'TS_EMPTY_CATCH', severity: 'HIGH', line: 1, message: 'Possible swallowed failure' }];
    publish(index, facts, findings);
    const candidateId = index.backlog().items[0].id;
    index.addReview({ candidateId, expectedSnapshot: 1, disposition: 'COUNTEREVIDENCE', author: 'fixture reviewer',
      reason: 'Mutation boundary checks the current owner', evidence: 'Delayed-delivery check passes for this source' });
    const result = localQuery(index, 'investigate', { task });
    assert.equal(result.snapshot, 1); assert.equal(result.reviewRevision, 1);
    assert.equal(result.authority, 'LOCAL_INVESTIGATION_ONLY');
    const entries = result.entries as any[];
    assert.equal(entries.length, 1);
    assert.ok(entries[0].owners.some((item: any) => item.id === owner.id));
    const candidate = entries[0].candidates.find((item: any) => item.id === candidateId);
    assert.equal(candidate.score, 60); assert.equal(candidate.baseScore, 80);
    assert.equal(candidate.action, 'CHECK_RECORDED_ASSUMPTIONS');
    assert.equal(candidate.review.authority, 'USER_REPORTED_LOCAL_ANNOTATION');
    assert.equal(entries[0].coverage.semantic, 'PARTIAL');
    assert.match(entries[0].coverage.limitations[0], /unresolved/);
    publish(index, facts.map(f => f.id === owner.id ? { ...f, contentHash: sha256('changed') } : f), findings);
    const changed = localQuery(index, 'investigate', { task });
    const stale = (changed.entries as any[])[0].candidates.find((item: any) => item.id === candidateId);
    assert.equal(stale.review.state, 'STALE'); assert.equal(stale.score, 80);
    assert.equal(stale.action, 'INVESTIGATE_BEHAVIOR');
  } finally { index.close(); }
});

test('task brief reports term selection, empty retrieval and strict input limits', () => {
  const index = new LocalIndex(':memory:');
  try {
    publish(index, [fact('cancel')]);
    const long = localQuery(index, 'investigate', { task: 'the ' + Array.from({ length: 30 }, (_, i) => `term${i}`).join(' ') });
    assert.equal((long.retrieval as any).terms.length, 20);
    assert.equal((long.retrieval as any).omittedTermCount, 10);
    assert.equal((long.retrieval as any).ignoredStopwordCount, 1);
    assert.equal(long.truncated, true);
    const empty = localQuery(index, 'investigate', { task: 'the and is' });
    assert.deepEqual(empty.entries, []); assert.equal((empty.retrieval as any).matchMode, 'EMPTY');
    for (const args of [{ task: '' }, { task: 'x'.repeat(2001) }, { task, limit: 21 }, { task, maxBytes: '8000' }, { task, maxBytes: 4095 }])
      assert.throws(() => localQuery(index, 'investigate', args));
  } finally { index.close(); }
});

test('candidate lookup discloses visible subjects beyond its bounded anchors', () => {
  const index = new LocalIndex(':memory:');
  try {
    const file = { ...fact('file', 'sample.ts', 'FILE'), tags: ['needle'] };
    const symbols = ['a', 'b', 'c'].map(name => fact(name, 'sample.ts'));
    publish(index, [file, ...symbols]);
    const omittedId = index.context(file.id, 4).localSymbols[2].id;
    publish(index, [file, ...symbols], [{ subjectId: omittedId, ruleId: 'TS_EMPTY_CATCH',
      severity: 'HIGH', line: 1, message: 'Only the third nearby symbol has a finding' }]);
    const result = localQuery(index, 'investigate', { task: 'needle' });
    const entry = (result.entries as any[])[0];
    assert.deepEqual(entry.candidates, []);
    assert.ok(entry.candidateCoverage.omittedSubjectIds.includes(omittedId));
    assert.equal(entry.candidateCoverage.queriedSubjectIds.length, 3);
    assert.equal(entry.truncated, true); assert.equal(result.truncated, true);
    assert.equal(index.context(omittedId).opportunities.length, 1);
  } finally { index.close(); }
});

test('task response budget bounds serialized bytes and exposes skipped entries for follow-up', () => {
  const index = new LocalIndex(':memory:');
  try {
    const facts = Array.from({ length: 12 }, (_, i) => fact('cancelSession', `cache/session${i}.ts`));
    for (const f of facts) f.effects.push(...Array.from({ length: 20 }, (_, i) => `IMPORT:${'x'.repeat(200)}${i}.ts`));
    publish(index, facts);
    const result = localQuery(index, 'investigate', { task, limit: 12, maxBytes: 4096 });
    const bytes = Buffer.byteLength(JSON.stringify(result));
    assert.ok(bytes <= 4096); assert.equal((result.budget as any).responseBytes, bytes);
    assert.ok((result.omittedEntryIds as string[]).length > 0);
    assert.equal(result.truncated, true);
    for (const id of result.omittedEntryIds as string[]) assert.ok(index.context(id).subject);
  } finally { index.close(); }
});

test('CLI investigation uses the shared task contract and accepts response budgets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'assurance-investigate-'));
  try {
    const path = join(dir, 'index.sqlite'); const index = new LocalIndex(path);
    publish(index, [fact('cancelSession')]); index.close();
    const cli = fileURLToPath(new URL('../src/local-cli.js', import.meta.url));
    const result = spawnSync(process.execPath, [cli, 'investigate', task, '--db', path, '--max-bytes', '8000'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout); assert.equal(output.entries[0].source.kind, 'FUNCTION');
    assert.equal(output.budget.maxBytes, 8000);
    assert.equal(Buffer.byteLength(result.stdout.trimEnd()), output.budget.responseBytes);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('response byte accounting remains exact across a decimal digit boundary', () => {
  const index = new LocalIndex(':memory:');
  try {
    const selected = { ...fact('cancelSession'), effects: ['x'] };
    publish(index, [selected]);
    const baseline = localQuery(index, 'investigate', { task: 'cancelSession' });
    const added = Math.floor((10001 - Buffer.byteLength(JSON.stringify(baseline))) / 2) - 1;
    publish(index, [{ ...selected, effects: ['x'.repeat(added + 1)] }]);
    const sizes = [];
    for (const suffix of ['', '?', '??', '???', '????']) {
      const result = localQuery(index, 'investigate', { task: `cancelSession${suffix}` });
      const actual = Buffer.byteLength(JSON.stringify(result));
      assert.equal((result.budget as any).responseBytes, actual);
      sizes.push(actual);
    }
    assert.ok(sizes.includes(10001), `Expected the boundary fixture to cover 10,001 bytes; got ${sizes}`);
  } finally { index.close(); }
});


test('explicit late owners and separate consumers survive noisy prose and helper-heavy files', () => {
  const index = new LocalIndex(':memory:');
  try {
    const owner = fact('renewLease', 'queue/owner.ts');
    const consumer = fact('acknowledgeJob', 'queue/worker.ts');
    publish(index, [owner, consumer, ...Array.from({ length: 120 }, (_, i) => fact(`requestHelper${i}`, 'noise.ts', 'VARIABLE'))]);
    const result = localQuery(index, 'investigate', { task: 'Please carefully investigate request behavior and logs with environment configuration previous discussion operational metrics deployment details debugging context. Inspect `renewLease` and acknowledgeJob.', limit: 2 });
    assert.deepEqual(new Set((result.entries as any[]).map(entry => entry.source.id)), new Set([owner.id, consumer.id]));
    assert.ok((result.retrieval as any).probeCount <= 26);
    assert.match((result.entries as any[])[0].matches[0].rankingReasons.join(' '), /TASK_EXACT_SYMBOL/);
  } finally { index.close(); }
});

test('compact provenance survives oversized context and explicitly retains stale counterevidence', () => {
  const index = new LocalIndex(':memory:');
  try {
    const owner = { ...fact('renewLease', 'queue/owner.ts'), effects: ['x'.repeat(30000)] };
    const consumer = fact('acknowledgeJob', 'queue/worker.ts');
    const findings: Finding[] = [{ subjectId: owner.id, ruleId: 'TS_EMPTY_CATCH', severity: 'HIGH', line: 1, message: 'Candidate' }];
    publish(index, [owner, consumer], findings);
    index.addReview({ candidateId: index.backlog().items[0].id, expectedSnapshot: 1, disposition: 'COUNTEREVIDENCE',
      author: 'fixture', reason: 'A separate consumer checks the token', evidence: 'Intentional boundary inspected at the original revision' });
    publish(index, [{ ...owner, contentHash: sha256('changed') }, consumer], findings);
    const result = localQuery(index, 'investigate', { task: 'renewLease acknowledgeJob', limit: 2, maxBytes: 8000 });
    const entries = result.entries as any[];
    assert.equal(entries.length, 2);
    const selected = entries.find(entry => entry.source.id === owner.id);
    assert.equal(selected.detail, 'COMPACT'); assert.ok(selected.omittedDetail);
    assert.equal(selected.candidates[0].review.state, 'STALE');
    assert.equal(selected.candidates[0].review.disposition, 'COUNTEREVIDENCE');
    assert.equal(selected.candidates[0].action, 'INVESTIGATE_BEHAVIOR');
    assert.equal(result.truncated, true); assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 8000);
  } finally { index.close(); }
});
