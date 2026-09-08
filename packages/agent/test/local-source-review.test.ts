import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalIndex } from '../src/local-index.js';
import { localQuery } from '../src/local-query.js';
import { analyzeComponent } from '../src/scan.js';
import { archiveCanonical, archiveRecordDigest, parseReviewArchive } from '../src/local-review-archive.js';
import { subjectId, sha256 } from '../src/util.js';
import type { Fact } from '../src/types.js';

const cli = fileURLToPath(new URL('../src/local-cli.js', import.meta.url));
const file = (path: string, effects: string[] = []): Fact => ({ id: subjectId('app', `${path}#file`), path,
  locator: `${path}#file`, kind: 'FILE', language: 'TS', contentHash: sha256(path), signatureHash: sha256('signature'),
  tags: [], effects, metrics: { lines: 1 }, line: 1 });
const source = file('policy.ts');
function publish(index: LocalIndex, facts = [source], findings: any[] = []) {
  index.begin('source-notes', {});
  index.ingest('app', '/fixture/app', { facts, findings, rulesExecuted: [], analyzer: 'fixture', sourceRevision: 'fixed',
    configurationDigest: 'fixed', environment: {}, coverage: { discovery: 'COMPLETE', semantic: 'RESOLVED', limitations: [] } });
  return index.commit(['app']);
}
function note(index: LocalIndex, sourceId = source.id, author = 'reviewer') {
  return index.addReview({ sourceId, expectedSnapshot: index.revision(), disposition: 'COUNTEREVIDENCE', author,
    reason: 'Display identifiers preserve literal case; request identifiers use a separate contract.',
    evidence: 'Read the selected implementation and its caller; changing display identity would merge distinct names.' }) as any;
}
function history(index: LocalIndex, id = source.id) { return index.reviewHistory(id, 200, undefined, 'SOURCE').items as any[]; }

test('candidate-free source observations reuse exact source captures and never create or discount findings', () => {
  const index = new LocalIndex(':memory:');
  try {
    publish(index); assert.equal(index.backlog().items.length, 0);
    const saved = note(index);
    assert.equal(saved.candidateId, null); assert.equal(saved.candidate, null); assert.equal(saved.sourceId, source.id);
    assert.equal(saved.state, 'CURRENT'); assert.equal(saved.authority, 'USER_REPORTED_LOCAL_ANNOTATION');
    assert.equal(index.context(source.id).sourceReview.id, saved.id);
    assert.equal(index.reviewHistory(source.id).items.length, 0);
    assert.equal(index.backlog().items.length, 0);
    const finding = { subjectId: source.id, ruleId: 'TS_LARGE_FUNCTION', severity: 'LOW', line: 1, message: 'Inspect size' };
    publish(index, [source], [finding]);
    const candidate = index.backlog().items[0];
    assert.equal(candidate.review, null);
    const baseline = new LocalIndex(':memory:');
    try { publish(baseline, [source], [finding]); assert.equal(candidate.score, baseline.backlog().items[0].score); }
    finally { baseline.close(); }
    assert.deepEqual(history(index)[0].sources, saved.sources);
  } finally { index.close(); }
});

test('real candidate-free policy review becomes stale after a value-only change and cannot revive after reversion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'assurance-source-policy-'));
  const index = new LocalIndex(':memory:');
  const original = 'export function displayKey(value: string) { return value; }\n';
  const scan = async () => {
    const result = await analyzeComponent(undefined, 'app', root, { root });
    index.begin('source-policy', {}); index.ingest('app', root, result); index.commit(['app']);
  };
  try {
    await writeFile(join(root, 'policy.ts'), original); await scan();
    const id = subjectId('app', 'policy.ts#displayKey');
    assert.equal(index.context(id).opportunities.length, 0);
    const saved = note(index, id); await scan(); assert.equal(history(index, id)[0].state, 'CURRENT');
    await writeFile(join(root, 'policy.ts'), original.replace('return value;', 'return value.toLowerCase();')); await scan();
    const stale = history(index, id)[0];
    assert.equal(stale.state, 'STALE'); assert.equal(stale.fingerprint, saved.fingerprint);
    assert.deepEqual(stale.sources, saved.sources);
    await writeFile(join(root, 'policy.ts'), original); await scan();
    assert.equal(history(index, id)[0].state, 'STALE');
    assert.deepEqual(history(index, id)[0].invalidation, stale.invalidation);
    const fresh = note(index, id, 'explicit re-review'); assert.equal(fresh.state, 'CURRENT');
    // New declaration membership in the same owner file invalidates the exact old judgment.
    await writeFile(join(root, 'policy.ts'), original + 'export function displayAlias(value: string) { return value; }\n'); await scan();
    assert.equal(history(index, id)[0].state, 'STALE');
    await rm(join(root, 'policy.ts')); await scan(); assert.equal(history(index, id)[0].state, 'SOURCE_ABSENT');
    await writeFile(join(root, 'policy.ts'), original); await scan(); assert.equal(history(index, id)[0].state, 'STALE');
    assert.equal(index.backlog().items.length, 0);
  } finally { index.close(); await rm(root, { recursive: true, force: true }); }
});

test('source dependency captures detect resolved targets, new importers, changed neighbors and removed evidence', () => {
  const cases = [
    { name: 'unresolved target resolves', before: [file('policy.ts', ['IMPORT:target.ts'])], after: [file('policy.ts', ['IMPORT:target.ts']), file('target.ts')] },
    { name: 'new importer joins scope', before: [source], after: [source, file('caller.ts', ['IMPORT:policy.ts'])] },
    { name: 'importer value changes', before: [source, file('caller.ts', ['IMPORT:policy.ts'])],
      after: [source, { ...file('caller.ts', ['IMPORT:policy.ts']), contentHash: sha256('new value') }] },
    { name: 'resolved target disappears', before: [file('policy.ts', ['IMPORT:target.ts']), file('target.ts')], after: [file('policy.ts', ['IMPORT:target.ts'])] },
  ];
  for (const scenario of cases) {
    const index = new LocalIndex(':memory:');
    try {
      publish(index, scenario.before); const saved = note(index);
      publish(index, scenario.after); assert.equal(history(index)[0].state, 'STALE', scenario.name);
      publish(index, scenario.before); assert.equal(history(index)[0].state, 'STALE', scenario.name);
      assert.deepEqual(history(index)[0].sources, saved.sources);
    } finally { index.close(); }
  }
  const index = new LocalIndex(':memory:');
  try {
    const evidence = file('policy.test.ts'); publish(index, [source, evidence]);
    index.addReview({ sourceId: source.id, factIds: [evidence.id], expectedSnapshot: 1, disposition: 'INVESTIGATE',
      reason: 'The test documents the assumption', evidence: 'Inspect the literal assertion', author: 'reviewer' });
    publish(index, [source]); assert.equal(history(index)[0].state, 'STALE');
  } finally { index.close(); }
});

test('source reviews reject ambiguous selection, absent IDs, invalid bounds and cross-kind cursors without mutation', () => {
  const index = new LocalIndex(':memory:');
  try {
    publish(index);
    const base = { sourceId: source.id, expectedSnapshot: 1, disposition: 'INVESTIGATE', reason: 'Inspect the policy', evidence: 'Read source', author: 'reviewer' };
    for (const extra of [{ candidateId: source.id }, { sourceId: 'missing' }, { sourceId: '' }, { sourceId: 'x'.repeat(201) },
      { sourceId: null }, { sourceId: source.id + '\0' }, { expectedSnapshot: 0 }, { extra: true }, { factIds: ['missing'] }])
      assert.throws(() => index.addReview({ ...base, ...extra }));
    assert.equal(index.reviewRevision(), 0);
    note(index); note(index);
    const first = localQuery(index, 'reviews', { id: source.id, kind: 'SOURCE', limit: 1 });
    assert.equal((first.items as any[]).length, 1); assert.ok(first.next);
    assert.throws(() => localQuery(index, 'reviews', { id: source.id, limit: 1, after: first.next }), /pagination/);
    assert.throws(() => localQuery(index, 'reviews', { id: source.id, kind: 'ANY' }), /kind/);
    assert.equal((localQuery(index, 'reviews', { id: source.id, kind: 'SOURCE', limit: 1, after: first.next }).items as any[]).length, 1);
  } finally { index.close(); }
});

function resign(value: any): string {
  for (const entry of value.records) entry.digest = archiveRecordDigest(entry.record);
  const { digest: _digest, ...payload } = value;
  return archiveCanonical({ ...payload, digest: sha256(archiveCanonical(payload)) }) + '\n';
}

test('mixed archives preserve old candidate records and original source captures with permanent restore invalidation', () => {
  const origin = new LocalIndex(':memory:'), target = new LocalIndex(':memory:');
  try {
    const finding = { subjectId: source.id, ruleId: 'TS_EMPTY_CATCH', severity: 'HIGH', line: 1, message: 'Inspect recovery' };
    publish(origin, [source], [finding]);
    origin.addReview({ candidateId: origin.backlog().items[0].id, expectedSnapshot: 1, disposition: 'INVESTIGATE',
      reason: 'Inspect recovery', evidence: 'Read caller', author: 'reviewer' });
    const old = parseReviewArchive(origin.exportReviews()); assert.equal(old.version, 1);
    const saved = note(origin);
    const mixed = parseReviewArchive(origin.exportReviews()); assert.equal(mixed.version, 2);
    assert.deepEqual(mixed.records[0], old.records[0]);
    target.importReviews(origin.exportReviews());
    assert.equal(history(target)[0].state, 'SOURCE_ABSENT');
    assert.equal(history(target)[0].invalidation.snapshot, 0);
    assert.deepEqual(parseReviewArchive(target.exportReviews()).records, mixed.records);
    publish(target, [source], [finding]); assert.equal(history(target)[0].state, 'STALE');
    assert.deepEqual(history(target)[0].sources, saved.sources);
    assert.equal(target.importReviews(origin.exportReviews()).skipped, 2);
    const fresh = note(target, source.id, 'fresh local review');
    note(origin, source.id, 'later remote review'); target.importReviews(origin.exportReviews());
    assert.equal(target.context(source.id).sourceReview.id, fresh.id);
    publish(target, [{ ...source, contentHash: sha256('changed') }]);
    publish(target); assert.equal(target.context(source.id).sourceReview.id, fresh.id);
    assert.equal(target.context(source.id).sourceReview.state, 'STALE');
    assert.equal(target.backlog().items.length, 0);
    for (const mutate of [
      (value: any) => { value.records[1].record.note.candidateId = 'fake'; },
      (value: any) => { value.records[1].record.note.candidate = {}; },
      (value: any) => { value.records[1].record.note.sourceId = 'absent-primary'; },
      (value: any) => { value.version = 1; },
    ]) {
      const value = structuredClone(mixed); mutate(value);
      assert.throws(() => target.importReviews(resign(value)));
    }
  } finally { origin.close(); target.close(); }
});

test('CLI and MCP expose the same source history selection without permitting MCP writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'assurance-source-cli-'));
  const path = join(root, 'index.sqlite');
  try {
    const index = new LocalIndex(path); publish(index); index.close();
    const inputFile = join(root, 'review.json');
    await writeFile(inputFile, JSON.stringify({ sourceId: source.id, expectedSnapshot: 1, disposition: 'INVESTIGATE',
      author: 'reviewer', reason: 'Inspect normalization policy', evidence: 'Read the source before changing it' }));
    const add = spawnSync(process.execPath, [cli, 'review', '--db', path, '--input', inputFile], { encoding: 'utf8' });
    assert.equal(add.status, 0, add.stderr);
    const read = spawnSync(process.execPath, [cli, 'reviews', source.id, '--kind', 'SOURCE', '--db', path], { encoding: 'utf8' });
    assert.equal(read.status, 0, read.stderr); const expected = JSON.parse(read.stdout);
    const input = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'assurance_local_reviews', arguments: { id: source.id, kind: 'SOURCE' } } },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'assurance_local_context', arguments: { id: source.id } } },
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'assurance_local_review', arguments: {} } },
    ].map(value => JSON.stringify(value)).join('\n') + '\n';
    const child = spawnSync(process.execPath, [fileURLToPath(new URL('../src/mcp.js', import.meta.url))], {
      input, encoding: 'utf8', timeout: 10000, env: { PATH: process.env.PATH, ASSURANCE_LOCAL_DB: path } });
    assert.equal(child.status, 0, child.stderr);
    const messages = child.stdout.trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(messages.find(message => message.id === 2).result.structuredContent, expected);
    assert.equal(messages.find(message => message.id === 3).result.structuredContent.sourceReview.sourceId, source.id);
    assert.equal(messages.find(message => message.id === 4).error.code, -32602);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('actual schema-three migration preserves immutable candidate history and rolls back completely on failed scan', async () => {
  const root = await mkdtemp(join(tmpdir(), 'assurance-source-migration-'));
  const path = join(root, 'index.sqlite');
  try {
    const initial = new LocalIndex(path);
    const findings = [{ subjectId: source.id, ruleId: 'TS_EMPTY_CATCH', severity: 'HIGH', line: 1, message: 'Inspect recovery' }];
    publish(initial, [source], findings);
    const candidateId = initial.backlog().items[0].id;
    initial.addReview({ candidateId, expectedSnapshot: 1, disposition: 'COUNTEREVIDENCE', author: 'schema-three reviewer',
      reason: 'The caller handles recovery', evidence: 'Read the caller' });
    initial.addReview({ candidateId, expectedSnapshot: 1, disposition: 'COUNTEREVIDENCE', author: 'latest local reviewer',
      reason: 'Rechecked the caller recovery', evidence: 'Read the current caller' });
    const remote = new LocalIndex(':memory:');
    try {
      publish(remote, [source], findings);
      remote.addReview({ candidateId, expectedSnapshot: 1, disposition: 'INVESTIGATE', author: 'imported reviewer',
        reason: 'Inspect the caller again', evidence: 'Historical note supplied by another index' });
      initial.importReviews(remote.exportReviews());
    } finally { remote.close(); }
    const beforeArchive = parseReviewArchive(initial.exportReviews()); const beforeRevision = initial.reviewRevision();
    initial.close();
    const legacy = new DatabaseSync(path);
    legacy.exec(`DROP VIEW local_review_latest;
      DROP TRIGGER local_reviews_no_update; DROP TRIGGER local_reviews_no_delete; DROP TRIGGER local_reviews_revision;
      ALTER TABLE local_reviews RENAME TO migrated_reviews;
      CREATE TABLE local_reviews(id INTEGER PRIMARY KEY AUTOINCREMENT,candidateId TEXT NOT NULL,snapshot INTEGER NOT NULL,
        disposition TEXT NOT NULL CHECK(disposition IN ('COUNTEREVIDENCE','INVESTIGATE')),created TEXT NOT NULL,body TEXT NOT NULL,fingerprint TEXT NOT NULL);
      INSERT INTO local_reviews SELECT id,candidateId,snapshot,disposition,created,body,fingerprint FROM migrated_reviews;
      DROP TABLE migrated_reviews;
      CREATE INDEX local_reviews_candidate ON local_reviews(candidateId,id DESC);
      CREATE INDEX local_reviews_effective ON local_reviews(candidateId,CASE WHEN json_type(body,'$.archive') IS NULL THEN 0 ELSE 1 END,id DESC);
      CREATE UNIQUE INDEX local_reviews_archive_digest ON local_reviews(json_extract(body,'$.archive.recordDigest')) WHERE json_type(body,'$.archive')='object';
      CREATE TRIGGER local_reviews_no_update BEFORE UPDATE ON local_reviews BEGIN SELECT RAISE(ABORT,'Local review history is append-only'); END;
      CREATE TRIGGER local_reviews_no_delete BEFORE DELETE ON local_reviews BEGIN SELECT RAISE(ABORT,'Local review history is append-only'); END;
      CREATE TRIGGER local_reviews_revision AFTER INSERT ON local_reviews BEGIN UPDATE local_review_meta SET revision=revision+1 WHERE id=1; END;
      CREATE VIEW local_review_latest AS SELECT r.*, CASE WHEN o.id IS NULL OR o.resolved IS NOT NULL THEN 'CANDIDATE_ABSENT'
        WHEN i.reviewId IS NOT NULL THEN 'STALE' ELSE 'CURRENT' END AS state,
        i.snapshot AS invalidatedSnapshot,i.reason AS invalidationReason FROM local_reviews r
        LEFT JOIN local_review_invalidations i ON i.reviewId=r.id LEFT JOIN opportunities o ON o.id=r.candidateId
        WHERE r.id=(SELECT newest.id FROM local_reviews newest WHERE newest.candidateId=r.candidateId
          ORDER BY CASE WHEN json_type(newest.body,'$.archive') IS NULL THEN 0 ELSE 1 END,newest.id DESC LIMIT 1);
      PRAGMA user_version=3;`);
    const schema = legacy.prepare("SELECT type,name,sql FROM sqlite_master WHERE name LIKE 'local_review%' ORDER BY name").all();
    const rows = legacy.prepare('SELECT * FROM local_reviews').all(); legacy.close();
    assert.throws(() => new LocalIndex(path, true), /run scan/);
    const input = join(root, 'note.json'); await writeFile(input, '{}');
    const forbiddenWrite = spawnSync(process.execPath, [cli, 'review', '--db', path, '--input', input], { encoding: 'utf8' });
    assert.notEqual(forbiddenWrite.status, 0); assert.match(forbiddenWrite.stderr, /run scan/);
    const failed = new LocalIndex(path, false, true);
    failed.begin('source-notes', {});
    assert.throws(() => failed.ingest('app', '/wrong-root', { facts: [], findings: [], rulesExecuted: [], analyzer: 'fixture',
      sourceRevision: 'fixed', configurationDigest: 'fixed', environment: {}, coverage: { discovery: 'COMPLETE', semantic: 'RESOLVED', limitations: [] } }), /root changed/);
    failed.close();
    const unchanged = new DatabaseSync(path, { readOnly: true });
    assert.equal(unchanged.prepare('PRAGMA user_version').get()!.user_version, 3);
    assert.deepEqual(unchanged.prepare("SELECT type,name,sql FROM sqlite_master WHERE name LIKE 'local_review%' ORDER BY name").all(), schema);
    assert.deepEqual(unchanged.prepare('SELECT * FROM local_reviews').all(), rows); unchanged.close();
    const migrated = new LocalIndex(path, false, true);
    try {
      publish(migrated, [source], findings);
      assert.equal(migrated.summary().schemaVersion, 4);
      assert.equal(migrated.reviewRevision(), beforeRevision);
      assert.deepEqual(parseReviewArchive(migrated.exportReviews()).records, beforeArchive.records);
      assert.equal(migrated.backlog().items[0].review.state, 'CURRENT');
      assert.equal(migrated.backlog().items[0].review.author, 'latest local reviewer');
      assert.equal(migrated.reviewHistory(candidateId).items[0].state, 'STALE');
      note(migrated); assert.equal(migrated.context(source.id).sourceReview.state, 'CURRENT');
      assert.equal(migrated.reviewHistory(candidateId).items.length, 3);
    } finally { migrated.close(); }
    const final = new DatabaseSync(path);
    assert.throws(() => final.prepare('DELETE FROM local_reviews').run(), /append-only/);
    assert.throws(() => final.prepare("UPDATE local_reviews SET body='{}'").run(), /append-only/); final.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});
