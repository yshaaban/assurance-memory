import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LocalIndex } from '../src/local-index.js';
import { localQuery } from '../src/local-query.js';
import { sha256, subjectId } from '../src/util.js';
import type { Fact, Finding } from '../src/types.js';

function fact(name: string, extra: Partial<Fact> = {}): Fact {
  const locator = `data/resourceRegistry.ts#${name}`;
  return { id: subjectId('app', locator), locator, path: 'data/resourceRegistry.ts', language: 'TS', kind: 'FUNCTION',
    contentHash: sha256(name), signatureHash: sha256('sig'), tags: ['functions'], effects: [], metrics: { lines: 10 }, line: 1, ...extra };
}
function publish(index: LocalIndex, facts: Fact[], findings: Finding[] = []) {
  index.begin('test', {});
  index.ingest('app', '/app', { facts, findings, rulesExecuted: ['TS_EMPTY_CATCH'], analyzer: 'fixture', sourceRevision: 'same',
    configurationDigest: 'same', environment: {}, coverage: { discovery: 'COMPLETE', semantic: 'RESOLVED', limitations: [] } });
  return index.commit(['app']);
}

test('task vocabulary retrieves identifier/effect owners and discloses broader fallback', () => {
  const index = new LocalIndex(':memory:');
  try {
    const request = fact('requestResource', { effects: ['CANCEL_REQUEST'] });
    const dispose = fact('createBootstrapGate.dispose');
    const hydrate = fact('hydrateStartup');
    publish(index, [request, dispose, hydrate]);
    assert.equal(index.search('request cancellation')[0]!.id, request.id);
    assert.equal(index.search('bootstrap disposal')[0]!.id, dispose.id);
    assert.equal(index.search('startup hydration')[0]!.id, hydrate.id);
    assert.equal(index.searchResult('request cancellation').matchMode, 'ALL_TERMS');
    const broader = index.searchResult('unknown cancellation');
    assert.equal(broader.matchMode, 'ANY_TERM');
    assert.deepEqual(broader.items[0].matchedTerms, ['cancel']);
    assert.equal(index.searchResult('!!!').matchMode, 'EMPTY');
    assert.throws(() => index.search(Array.from({ length: 21 }, (_, i) => `term${i}`).join(' ')), /20 normalized/);
  } finally { index.close(); }
});

test('constructor identifiers remain literal search terms without inherited alias text', () => {
  const index = new LocalIndex(':memory:');
  try {
    const constructor = fact('Resource.constructor', { kind: 'METHOD' });
    const native = fact('nativeCode');
    publish(index, [constructor, native]);
    const result = localQuery(index, 'search', { query: 'constructor' });
    assert.deepEqual(result.terms, ['constructor']);
    assert.deepEqual((result.items as Fact[]).map(item => item.id), [constructor.id]);
    assert.deepEqual(index.search('native code').map(item => item.id), [native.id]);
  } finally { index.close(); }
});

test('exact symbols and named policy owners survive helper-heavy file lookup', () => {
  const index = new LocalIndex(':memory:');
  try {
    const owner = fact('requestResource', { effects: ['CANCEL_REQUEST'], metrics: { lines: 120, guards: 6 } });
    const helper = fact('requestResource.request@callback:42', { line: 50 });
    publish(index, [fact('file', { kind: 'FILE' }), owner, helper,
      ...Array.from({ length: 80 }, (_, i) => fact(`value${i}`, { kind: 'VARIABLE' }))]);
    assert.equal(index.search('requestResource', 1)[0]!.id, owner.id);
    assert.ok(index.search('resourceRegistry', 5).some(item => item.id === owner.id));
    const context = index.context(helper.id, 3);
    assert.equal(context.owners[0].id, owner.id);
    assert.ok(context.localSymbols.some((item: any) => item.id === owner.id));
    assert.match(context.symbolMeaning, /not callers/);
    assert.deepEqual(context.neighbors, []);
  } finally { index.close(); }
});

test('broad lexical pools disclose exhaustion instead of promising complete ranking', () => {
  const index = new LocalIndex(':memory:');
  try {
    publish(index, Array.from({ length: 205 }, (_, i) => fact(`handle${i}`, { effects: ['CANCEL_REQUEST'] })));
    const result = index.searchResult('cancellation', 1);
    assert.equal(result.items.length, 1);
    assert.equal(result.hasMore, true);
    assert.equal(result.candidatePoolTruncated, true);
  } finally { index.close(); }
});

test('version-one migration rebuilds normalized search without changing source snapshots', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'assurance-migration-'));
  const path = join(dir, 'index.sqlite');
  let index: LocalIndex | undefined;
  try {
    index = new LocalIndex(path); const owner = fact('hydrateStartup'); publish(index, [owner]); index.close(); index = undefined;
    const old = new DatabaseSync(path);
    old.exec(`DROP VIEW local_review_latest; DROP TABLE local_reviews; DROP TABLE local_review_invalidations; DROP TABLE local_review_meta;
      DROP INDEX facts_symbol_lookup; DROP INDEX opportunities_subject; DELETE FROM search; PRAGMA user_version=1`);
    old.prepare('INSERT INTO search(rowid,id,text) VALUES((SELECT rowid FROM facts WHERE id=?),?,?)').run(owner.id, owner.id, owner.locator);
    old.close();
    assert.throws(() => new LocalIndex(path, true), /run scan/);
    index = new LocalIndex(path);
    assert.equal(index.revision(), 1);
    assert.equal(index.search('startup hydration')[0]!.id, owner.id);
    assert.equal(index.summary().schemaVersion, 2);
    assert.equal(index.changes(1).items.length, 1);
  } finally { index?.close(); await rm(dir, { recursive: true }); }
});

test('counterevidence reranks without suppressing and invalidates cursors and stale influence', () => {
  const index = new LocalIndex(':memory:');
  try {
    const facts = [fact('a'), fact('b')];
    const findings = facts.map(f => ({ subjectId: f.id, ruleId: 'TS_EMPTY_CATCH', severity: 'HIGH' as const, line: 1, message: 'Candidate' }));
    publish(index, facts, findings);
    const first = localQuery(index, 'backlog', { limit: 1 });
    const candidate = (first.items as any[])[0]!;
    const review = index.addReview({ candidateId: candidate.id, expectedSnapshot: 1, disposition: 'COUNTEREVIDENCE',
      author: 'fixture reviewer', reason: 'Fallback observes failure', evidence: 'Reviewed the recovery contract at this source.' }) as any;
    assert.equal(review.state, 'CURRENT');
    assert.throws(() => localQuery(index, 'backlog', { limit: 1, after: first.next }), /Index changed/);
    let item = index.backlog().items.find((item: any) => item.id === candidate.id)!;
    assert.equal(item.score, 60); assert.equal(item.baseScore, 80); assert.equal(item.severity, 'HIGH');
    assert.equal(index.backlog().items.length, 2);
    assert.equal(item.review.authority, 'USER_REPORTED_LOCAL_ANNOTATION');
    publish(index, facts, findings);
    assert.equal(index.backlog().items.find((item: any) => item.id === candidate.id)!.review.state, 'CURRENT');
    const changed = facts.map(f => f.id === candidate.subjectId ? { ...f, contentHash: sha256('new behavior') } : f);
    publish(index, changed, findings);
    item = index.backlog().items.find((item: any) => item.id === candidate.id)!;
    assert.equal(item.review.state, 'STALE'); assert.equal(item.score, 80);
    publish(index, facts, findings);
    assert.equal(index.backlog().items.find((item: any) => item.id === candidate.id)!.review.state, 'STALE');
    publish(index, facts, []);
    assert.equal((localQuery(index, 'reviews', { id: candidate.id }).items as any[])[0].state, 'CANDIDATE_ABSENT');
  } finally { index.close(); }
});

test('review pagination cannot cross a new annotation at the same source snapshot', () => {
  const index = new LocalIndex(':memory:');
  try {
    const f = fact('request'); publish(index, [f], [{ subjectId: f.id, ruleId: 'TS_EMPTY_CATCH', severity: 'HIGH', line: 1, message: 'Candidate' }]);
    const candidateId = index.backlog().items[0].id;
    const input = { candidateId, expectedSnapshot: 1, disposition: 'INVESTIGATE', author: 'reviewer', reason: 'Needs a boundary check', evidence: 'Observed source only' };
    index.addReview(input); index.addReview(input);
    const page = localQuery(index, 'reviews', { id: candidateId, limit: 1 }); assert.ok(page.next);
    index.addReview(input);
    assert.throws(() => localQuery(index, 'reviews', { id: candidateId, limit: 1, after: page.next }), /Index changed/);
  } finally { index.close(); }
});

test('CLI rejects discarded query terms and records then reads explicit review input', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'assurance-cli-review-')); const path = join(dir, 'index.sqlite');
  const index = new LocalIndex(path); const f = fact('requestResource', { effects: ['CANCEL_REQUEST'] });
  publish(index, [f], [{ subjectId: f.id, ruleId: 'TS_EMPTY_CATCH', severity: 'HIGH', line: 1, message: 'Candidate' }]);
  const candidateId = index.backlog().items[0].id; index.close();
  const cli = fileURLToPath(new URL('../src/local-cli.js', import.meta.url));
  const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args, '--db', path], { encoding: 'utf8', timeout: 10000 });
  try {
    const invalid = run('search', 'request', 'cancellation'); assert.equal(invalid.status, 1); assert.match(invalid.stderr, /quote multi-word/);
    assert.equal(run('status', '--category', 'RELIABILITY').status, 1);
    assert.equal(JSON.parse(run('search', 'request cancellation').stdout).items[0].id, f.id);
    const input = join(dir, 'review.json');
    await writeFile(input, JSON.stringify({ candidateId, expectedSnapshot: 1, disposition: 'COUNTEREVIDENCE', author: 'reviewer',
      reason: 'Intentional recovery', evidence: 'Caller observes the fallback result' }));
    const added = run('review', '--input', input); assert.equal(added.status, 0, added.stderr);
    assert.equal(JSON.parse(added.stdout).review.state, 'CURRENT');
    const listed = run('reviews', candidateId); assert.equal(listed.status, 0, listed.stderr);
    assert.equal(JSON.parse(listed.stdout).items[0].reason, 'Intentional recovery');
  } finally { await rm(dir, { recursive: true }); }
});

test('equivalent spellings preserve exact owner lookup beyond the lexical pool', () => {
  const index = new LocalIndex(':memory:');
  try {
    const owner = fact('requestResource', { effects: Array.from({ length: 300 }, (_, i) => `IMPORT:dependency${i}.ts`) });
    publish(index, [owner, ...Array.from({ length: 205 }, (_, i) => fact(`helper${i}`, { effects: ['REQUEST_RESOURCE'] }))]);
    for (const query of ['requestResource', 'request resource', 'request-resource'])
      assert.equal(index.search(query, 1)[0]!.id, owner.id, query);
  } finally { index.close(); }
});

test('context and backlog choose the same effective priority before limiting', () => {
  const index = new LocalIndex(':memory:');
  try {
    const source = fact('owner');
    publish(index, [source], ['TS_EMPTY_CATCH', 'TS_FLOATING_PROMISE'].map(ruleId => ({
      subjectId: source.id, ruleId, line: 1, severity: 'HIGH' as const, message: 'Candidate' })));
    const first = index.backlog(1).items[0];
    index.addReview({ candidateId: first.id, expectedSnapshot: 1, disposition: 'COUNTEREVIDENCE',
      author: 'reviewer', reason: 'Observed fallback', evidence: 'Caller contract' });
    assert.equal(index.context(source.id, 1).opportunities[0].id, index.backlog(1).items[0].id);
    assert.notEqual(index.backlog(1).items[0].id, first.id);
  } finally { index.close(); }
});

test('search and candidate ranking share conventional test source classification', () => {
  const index = new LocalIndex(':memory:');
  try {
    const source = fact('helper', { path: 'test/helper.ts', locator: 'test/helper.ts#helper', id: subjectId('app', 'test/helper.ts#helper') });
    publish(index, [source], [{ subjectId: source.id, ruleId: 'TS_EMPTY_CATCH', line: 1, severity: 'HIGH', message: 'Candidate' }]);
    assert.equal(index.backlog(1).items[0].sourceRole, 'TEST');
    assert.ok(index.search('helper', 1)[0]!.rankingReasons.includes('TEST_SOURCE'));
  } finally { index.close(); }
});

test('malformed opaque cursors never silently restart a page', () => {
  const index = new LocalIndex(':memory:');
  try {
    const source = fact('source'); publish(index, [source]);
    for (const value of [null, false, 0, [], 'cursor']) {
      const after = Buffer.from(JSON.stringify(value)).toString('base64url');
      assert.throws(() => localQuery(index, 'backlog', { after }), /Invalid cursor/);
      assert.throws(() => localQuery(index, 'reviews', { id: 'candidate', after }), /Invalid cursor/);
    }
    const after = Buffer.from(JSON.stringify({ snapshot: 1, reviewRevision: 0, category: '', after: null })).toString('base64url');
    assert.throws(() => localQuery(index, 'backlog', { after }), /Invalid cursor/);
    const missingAfter = Buffer.from(JSON.stringify({ snapshot: 1, reviewRevision: 0, id: 'candidate' })).toString('base64url');
    assert.throws(() => localQuery(index, 'reviews', { id: 'candidate', after: missingAfter }), /Invalid cursor/);
  } finally { index.close(); }
});

test('invalid or failed CLI scans retain the previous schema and source snapshot', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'assurance-scan-upgrade-')); const path = join(dir, 'index.sqlite');
  const index = new LocalIndex(path); publish(index, [fact('source')]); index.close();
  const old = new DatabaseSync(path); old.exec(`DROP VIEW local_review_latest; DROP TABLE local_reviews;
    DROP TABLE local_review_invalidations; DROP TABLE local_review_meta; PRAGMA user_version=1`); old.close();
  const cli = fileURLToPath(new URL('../src/local-cli.js', import.meta.url));
  const run = (...args: string[]) => spawnSync(process.execPath, [cli, 'scan', '--db', path, ...args], { encoding: 'utf8', timeout: 10000 });
  const unchanged = () => {
    const db = new DatabaseSync(path, { readOnly: true });
    try { assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 1);
      assert.equal(db.prepare('SELECT max(id) AS n FROM snapshots').get()!.n, 1);
      assert.equal(db.prepare('SELECT count(*) AS n FROM facts').get()!.n, 1);
    } finally { db.close(); }
  };
  try {
    assert.equal(run().status, 1); unchanged();
    const config = join(dir, 'workspace.json'); await writeFile(config, JSON.stringify({ workspace: 'test', components: { app: { root: 'missing' } } }));
    const result = run('--config', config); assert.equal(result.status, 1, result.stderr); unchanged();
  } finally { await rm(dir, { recursive: true }); }
});

test('changed search policy requires and rebuilds projection even with unchanged source facts', async () => {
  const { copyFile, readFile } = await import('node:fs/promises');
  const dir = await mkdtemp(join(tmpdir(), 'assurance-search-policy-'));
  try {
    for (const name of ['local-index.js', 'local-search.js', 'local-review.js', 'investigation.js', 'util.js'])
      await copyFile(fileURLToPath(new URL(`../src/${name}`, import.meta.url)), join(dir, name));
    await writeFile(join(dir, 'package.json'), '{"type":"module"}');
    await writeFile(join(dir, 'probe.mjs'), `
      import { LocalIndex } from './local-index.js';
      import { subjectId } from './util.js';
      const readonly = process.argv[3] === 'read';
      const index = new LocalIndex(process.argv[2], readonly, !readonly);
      if (!readonly) {
        index.begin('test', {}); index.ingest('app', '/app', { facts: [{id:subjectId('app','requests.ts#file'),
          locator:'requests.ts#file',path:'requests.ts',language:'TS',kind:'FILE',contentHash:'fixed',signatureHash:'fixed',tags:[],effects:[],metrics:{},line:1}],
          findings:[],rulesExecuted:[],analyzer:'fixture',sourceRevision:'same',configurationDigest:'same',environment:{},
          coverage:{discovery:'COMPLETE',semantic:'RESOLVED',limitations:[]} }); index.commit(['app']);
      }
      console.log(JSON.stringify(index.search('operation'))); index.close();
    `);
    const run = (mode = 'scan') => spawnSync(process.execPath, [join(dir, 'probe.mjs'), join(dir, 'index.sqlite'), mode], { encoding: 'utf8', timeout: 10000 });
    const before = run(); assert.equal(before.status, 0, before.stderr); assert.deepEqual(JSON.parse(before.stdout), []);
    const module = join(dir, 'local-search.js'); const text = await readFile(module, 'utf8');
    assert.ok(text.includes("requests: 'request'"));
    await writeFile(module, text.replace("requests: 'request'", "requests: 'operation'"));
    const stale = run('read'); assert.equal(stale.status, 1); assert.match(stale.stderr, /Search policy changed/);
    const rebuilt = run(); assert.equal(rebuilt.status, 0, rebuilt.stderr); assert.equal(JSON.parse(rebuilt.stdout).length, 1);
  } finally { await rm(dir, { recursive: true }); }
});
