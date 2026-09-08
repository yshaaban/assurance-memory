import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeLocalReviewSchema, LocalReviewStore, type LocalReviewInput } from '../src/local-review.js';
import { sha256, subjectId } from '../src/util.js';
import type { Fact } from '../src/types.js';

const primaryId = subjectId('app', 'renderer.ts#preload');
const evidenceId = subjectId('tests', 'renderer.test.ts#boundedImports');
const candidateId = sha256(`${primaryId}:TS_UNBOUNDED_FANOUT`);
type AppendInput = LocalReviewInput;
type Fixture = { db: DatabaseSync; store: LocalReviewStore };

function transaction<T>(db: DatabaseSync, operation: () => T, write = true): T {
  db.exec(write ? 'BEGIN IMMEDIATE' : 'BEGIN');
  try { const result = operation(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

function source(id: string, path: string, locator: string): Fact {
  return { id, path, locator, kind: 'FUNCTION', language: 'TS', line: 12,
    contentHash: sha256(`content:${path}`), signatureHash: sha256(`signature:${path}`),
    tags: [], effects: [], metrics: { lines: 8 } };
}

function component(root: string) {
  return { root, analyzer: 'typescript-fixture-1', configurationDigest: sha256('configuration'),
    environment: { runtime: 'node-24.16.0' }, dependencyDigest: sha256('dependencies'),
    rulesExecuted: ['TS_UNBOUNDED_FANOUT'], candidatePolicyDigest: sha256('candidate-policy'),
    sourceRevision: 'revision-1', coverage: { discovery: 'COMPLETE', semantic: 'RESOLVED', limitations: [] },
    factCount: 1, findingCount: 1 };
}

/** Seed only the projection tables used by reviews; no compiler scan or LocalIndex mutation. */
function fixture(path = ':memory:'): Fixture {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    PRAGMA busy_timeout=5000;
    CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE snapshots(id INTEGER PRIMARY KEY, created TEXT NOT NULL, config TEXT NOT NULL);
    CREATE TABLE components(id TEXT PRIMARY KEY, snapshot INTEGER NOT NULL, body TEXT NOT NULL);
    CREATE TABLE facts(id TEXT PRIMARY KEY, component TEXT NOT NULL, path TEXT NOT NULL, body TEXT NOT NULL);
    CREATE TABLE edges(source TEXT NOT NULL, target TEXT NOT NULL, PRIMARY KEY(source,target));
    CREATE TABLE opportunities(id TEXT PRIMARY KEY, component TEXT NOT NULL, score INTEGER NOT NULL,
      firstSeen INTEGER NOT NULL, lastSeen INTEGER NOT NULL, resolved INTEGER, body TEXT NOT NULL);
    CREATE TABLE drift(id INTEGER PRIMARY KEY, snapshot INTEGER NOT NULL, component TEXT NOT NULL,
      subject TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL);
  `);
  transaction(db, () => {
    db.prepare('INSERT INTO meta VALUES(?,?)').run('workspace', 'review-fixture');
    db.prepare('INSERT INTO snapshots VALUES(?,?,?)').run(1, '2026-09-08T00:00:00.000Z', '{}');
    for (const [id, root] of [['app', '/fixture/app'], ['tests', '/fixture/tests']] as const)
      db.prepare('INSERT INTO components VALUES(?,?,?)').run(id, 1, JSON.stringify(component(root)));
    const primary = source(primaryId, 'renderer.ts', 'renderer.ts#preload');
    const evidence = source(evidenceId, 'renderer.test.ts', 'renderer.test.ts#boundedImports');
    const owner = { ...source(subjectId('app', 'renderer.ts#file'), 'renderer.ts', 'renderer.ts#file'), kind: 'FILE' };
    for (const [id, fact] of [['app', primary], ['tests', evidence], ['app', owner]] as const)
      db.prepare('INSERT INTO facts VALUES(?,?,?,?)').run(fact.id, id, fact.path, JSON.stringify(fact));
    db.prepare('INSERT INTO opportunities VALUES(?,?,?,?,?,?,?)').run(candidateId, 'app', 90, 1, 1, null,
      JSON.stringify({ id: candidateId, subjectId: primaryId, ruleId: 'TS_UNBOUNDED_FANOUT',
        path: primary.path, line: primary.line, category: 'RELIABILITY', severity: 'HIGH', score: 90,
        confidence: 'STATIC_CANDIDATE', message: 'Inspect concurrency of renderer imports',
        nextStep: 'Verify the collection bound', evidenceNeeded: ['Source and caller inspection'] }));
  });
  initializeLocalReviewSchema(db);
  return { db, store: new LocalReviewStore(db) };
}

function input(overrides: Partial<AppendInput> = {}): AppendInput {
  return { candidateId, expectedSnapshot: 1, disposition: 'COUNTEREVIDENCE',
    reason: 'The renderer inventory is a fixed tuple of ten imports.',
    evidence: 'Read the literal inventory and the sole test-setup caller; bounded-import test passed.',
    author: 'reviewer', ...overrides };
}

function append(f: Fixture, overrides: Partial<AppendInput> = {}) {
  return transaction(f.db, () => f.store.append(input(overrides)));
}

function changeBody(db: DatabaseSync, table: 'facts' | 'components' | 'opportunities', id: string,
  change: (body: Record<string, any>) => void): void {
  const row = db.prepare(`SELECT body FROM ${table} WHERE id=?`).get(id);
  assert.ok(row);
  const body = JSON.parse(String(row.body)) as Record<string, any>;
  change(body);
  db.prepare(`UPDATE ${table} SET body=? WHERE id=?`).run(JSON.stringify(body), id);
  if (table === 'facts') db.prepare('UPDATE facts SET path=? WHERE id=?').run(String(body.path), id);
}

function scan(f: Fixture, mutate: (db: DatabaseSync) => void = () => {}): number {
  return transaction(f.db, () => {
    const snapshot = Number(f.db.prepare('SELECT max(id) AS id FROM snapshots').get()!.id) + 1;
    f.db.prepare('INSERT INTO snapshots VALUES(?,?,?)').run(snapshot, `scan-${snapshot}`, '{}');
    f.db.prepare('UPDATE components SET snapshot=?').run(snapshot);
    f.db.prepare('UPDATE opportunities SET lastSeen=? WHERE resolved IS NULL').run(snapshot);
    mutate(f.db);
    f.store.reconcile(snapshot);
    return snapshot;
  });
}

test('reviews preserve their candidate, primary source, cited evidence and context at submission', () => {
  const f = fixture();
  try {
    const review = append(f, { factIds: [evidenceId, primaryId, evidenceId] });
    assert.equal(review.candidateId, candidateId);
    assert.equal(review.snapshot, 1);
    assert.equal(review.disposition, 'COUNTEREVIDENCE');
    assert.equal(review.author, 'reviewer');
    assert.equal(review.state, 'CURRENT');
    assert.ok(JSON.stringify(review.candidate).includes('TS_UNBOUNDED_FANOUT'));
    assert.deepEqual(new Set(review.sources.map(source => source.id)), new Set([primaryId, evidenceId]));
    assert.equal(review.sources.length, 2);
    assert.equal(review.sources.find(source => source.id === primaryId)?.ownerFile?.locator, 'renderer.ts#file');
    assert.deepEqual(review.contexts.map(context => context.component), ['app', 'tests']);
    assert.equal(review.contexts[0]!.metadata.analyzer, 'typescript-fixture-1');
    assert.equal(f.store.latestCurrent(candidateId)?.id, review.id);
    assert.deepEqual(f.store.list(candidateId).items, [review]);
    assert.equal(f.store.latest(` ${candidateId} `)?.id, review.id);
    assert.deepEqual(f.store.list(` ${candidateId} `).items, [review]);
  } finally { f.db.close(); }
});

test('stale submissions cannot annotate a different scan or advance review revision', () => {
  const f = fixture();
  try {
    scan(f);
    const before = f.store.revision();
    assert.throws(() => append(f), /snapshot|changed|stale/i);
    assert.equal(f.store.revision(), before);
    assert.equal(f.store.list(candidateId).items.length, 0);
    assert.equal(append(f, { expectedSnapshot: 2 }).snapshot, 2);
  } finally { f.db.close(); }
});

test('review inputs require explicit bounded rationale, evidence, author and valid references', () => {
  const f = fixture();
  try {
    const invalid: Record<string, unknown>[] = [
      { reason: undefined }, { evidence: undefined }, { author: undefined },
      { reason: '' }, { reason: ' \n ' }, { evidence: '' }, { author: '' },
      { reason: 'x'.repeat(2001) }, { evidence: 'x'.repeat(8001) }, { author: 'x'.repeat(201) },
      { disposition: 'APPROVED' }, { disposition: ['COUNTEREVIDENCE'] },
      { expectedSnapshot: 0 }, { expectedSnapshot: 1.5 },
      { candidateId: 'missing-candidate' }, { factIds: ['missing-source'] },
      { factIds: Array.from({ length: 33 }, () => evidenceId) }, { trusted: true },
    ];
    for (const overrides of invalid) {
      assert.throws(() => append(f, overrides as Partial<AppendInput>));
      assert.equal(f.store.list(candidateId).items.length, 0, `invalid input persisted: ${Object.keys(overrides)}`);
    }
    assert.equal(append(f, { reason: 'x'.repeat(2000), evidence: 'x'.repeat(8000), author: 'x'.repeat(200) }).state, 'CURRENT');
    for (const limit of [0, -1, 201, 1.5]) assert.throws(() => f.store.list(candidateId, limit), /limit/i);
  } finally { f.db.close(); }
});

test('unchanged scans keep counterevidence current without rewriting its submitted snapshot', () => {
  const f = fixture();
  try {
    const before = append(f, { factIds: [evidenceId] });
    const revision = f.store.revision();
    assert.equal(scan(f), 2);
    const after = f.store.latestCurrent(candidateId);
    assert.equal(after?.id, before.id);
    assert.equal(after?.snapshot, 1);
    assert.equal(after?.state, 'CURRENT');
    assert.deepEqual(after?.sources, before.sources);
    assert.equal(f.store.revision(), revision);
  } finally { f.db.close(); }
});

const invalidatingChanges: Array<[string, (db: DatabaseSync) => void]> = [
  ['primary source content', db => changeBody(db, 'facts', primaryId, body => { body.contentHash = sha256('changed'); })],
  ['primary source signature', db => changeBody(db, 'facts', primaryId, body => { body.signatureHash = sha256('changed'); })],
  ['enclosing file content', db => changeBody(db, 'facts', subjectId('app', 'renderer.ts#file'), body => { body.contentHash = sha256('changed-constant'); })],
  ['primary source path', db => changeBody(db, 'facts', primaryId, body => { body.path = 'moved.ts'; })],
  ['primary source line', db => changeBody(db, 'facts', primaryId, body => { body.line += 20; })],
  ['explicitly cited source', db => changeBody(db, 'facts', evidenceId, body => { body.contentHash = sha256('changed-test'); })],
  ['dependency inputs', db => changeBody(db, 'components', 'app', body => { body.dependencyDigest = sha256('new-dependency'); })],
  ['environment', db => changeBody(db, 'components', 'app', body => { body.environment.runtime = 'node-next'; })],
  ['analyzer', db => changeBody(db, 'components', 'app', body => { body.analyzer = 'typescript-fixture-2'; })],
  ['executed rules', db => changeBody(db, 'components', 'app', body => { body.rulesExecuted.push('TS_OTHER_RULE'); })],
  ['candidate policy', db => changeBody(db, 'components', 'app', body => { body.candidatePolicyDigest = sha256('policy-2'); })],
  ['configuration', db => changeBody(db, 'components', 'app', body => { body.configurationDigest = sha256('configuration-2'); })],
  ['cited source component context', db => changeBody(db, 'components', 'tests', body => { body.analyzer = 'test-analyzer-2'; })],
  ['candidate location', db => changeBody(db, 'opportunities', candidateId, body => { body.line += 1; })],
];

for (const [label, mutate] of invalidatingChanges) {
  test(`changed ${label} invalidates counterevidence despite stable candidate identity`, () => {
    const f = fixture();
    try {
      const before = append(f, { factIds: [evidenceId] });
      scan(f, mutate);
      assert.equal(f.store.latestCurrent(candidateId) == null, true);
      const stale = f.store.list(candidateId).items[0]!;
      assert.equal(stale.id, before.id);
      assert.equal(stale.state, 'STALE');
      assert.ok(stale.invalidation);
      assert.deepEqual(stale.sources, before.sources);
      assert.deepEqual(stale.contexts, before.contexts);
    } finally { f.db.close(); }
  });
}

test('reverting source input never silently reactivates invalidated counterevidence', () => {
  const f = fixture();
  try {
    const before = append(f);
    const original = String(f.db.prepare('SELECT body FROM facts WHERE id=?').get(primaryId)!.body);
    scan(f, db => changeBody(db, 'facts', primaryId, body => { body.contentHash = sha256('intermediate-change'); }));
    const firstInvalidation = f.store.list(candidateId).items[0]!.invalidation;
    scan(f, db => db.prepare('UPDATE facts SET body=? WHERE id=?').run(original, primaryId));
    assert.equal(f.store.latestCurrent(candidateId) == null, true);
    const old = f.store.list(candidateId).items[0]!;
    assert.equal(old.id, before.id);
    assert.equal(old.state, 'STALE');
    assert.deepEqual(old.invalidation, firstInvalidation);
    assert.equal(append(f, { expectedSnapshot: 3 }).state, 'CURRENT');
  } finally { f.db.close(); }
});

test('candidate disappearance and reappearance retain the review without reviving its judgment', () => {
  const f = fixture();
  try {
    const before = append(f);
    scan(f, db => db.prepare('UPDATE opportunities SET resolved=2 WHERE id=?').run(candidateId));
    assert.equal(f.store.latestCurrent(candidateId) == null, true);
    assert.equal(f.store.list(candidateId).items[0]!.state, 'CANDIDATE_ABSENT');
    assert.throws(() => append(f, { expectedSnapshot: 2 }), /candidate|absent|resolved/i);
    scan(f, db => db.prepare('UPDATE opportunities SET resolved=NULL,lastSeen=3 WHERE id=?').run(candidateId));
    assert.equal(f.store.latestCurrent(candidateId) == null, true);
    const retained = f.store.list(candidateId).items[0]!;
    assert.equal(retained.id, before.id);
    assert.equal(retained.state, 'STALE');
    assert.deepEqual(retained.candidate, before.candidate);
  } finally { f.db.close(); }
});

test('deleting projection records preserves the review and its cited source snapshots', () => {
  const f = fixture();
  try {
    const before = append(f, { factIds: [evidenceId] });
    scan(f, db => {
      db.prepare('DELETE FROM opportunities WHERE id=?').run(candidateId);
      db.exec('DELETE FROM facts; DELETE FROM components;');
    });
    const retained = f.store.list(candidateId).items[0]!;
    assert.equal(retained.id, before.id);
    assert.equal(retained.state, 'CANDIDATE_ABSENT');
    assert.deepEqual(retained.sources, before.sources);
    assert.deepEqual(retained.contexts, before.contexts);
    assert.equal(retained.reason, before.reason);
  } finally { f.db.close(); }
});

test('later investigation supersedes counterevidence while both annotations remain available', () => {
  const f = fixture();
  try {
    const old = append(f);
    const revision = f.store.revision();
    const latest = append(f, { disposition: 'INVESTIGATE', reason: 'The bounded imports still need a failure-budget check.' });
    assert.ok(f.store.revision() > revision);
    assert.equal(f.store.latest(candidateId)?.id, latest.id);
    assert.equal(f.store.latest(candidateId)?.disposition, 'INVESTIGATE');
    assert.equal(f.store.latestCurrent(candidateId)?.id, latest.id);
    const first = f.store.list(candidateId, 1);
    assert.equal(first.items[0]!.id, latest.id);
    assert.equal(first.hasMore, true);
    assert.ok(first.next !== null);
    const second = f.store.list(candidateId, 1, Number(first.next));
    assert.equal(second.items[0]!.id, old.id);
    assert.equal(second.hasMore, false);
  } finally { f.db.close(); }
});

test('caller rollback publishes neither an annotation nor its review revision', () => {
  const f = fixture();
  try {
    const revision = f.store.revision();
    f.db.exec('BEGIN IMMEDIATE');
    f.store.append(input());
    f.db.exec('ROLLBACK');
    assert.equal(f.store.revision(), revision);
    assert.equal(f.store.list(candidateId).items.length, 0);
  } finally { f.db.close(); }
});

test('a stale latest review never falls back to older still-current counterevidence', () => {
  const f = fixture();
  try {
    const older = append(f);
    const newer = append(f, { factIds: [evidenceId] });
    scan(f, db => changeBody(db, 'facts', evidenceId, body => { body.contentHash = sha256('new-test'); }));
    const records = f.store.list(candidateId).items;
    assert.equal(records.find(record => record.id === older.id)?.state, 'CURRENT');
    assert.equal(records.find(record => record.id === newer.id)?.state, 'STALE');
    assert.equal(f.store.latest(candidateId)?.id, newer.id);
    assert.equal(f.store.latestCurrent(candidateId), null);
  } finally { f.db.close(); }
});

test('review mutations require caller-owned transactions and the current scan', () => {
  const f = fixture();
  try {
    assert.throws(() => f.store.append(input()), /transaction/i);
    assert.throws(() => f.store.reconcile(1), /transaction/i);
    assert.throws(() => transaction(f.db, () => f.store.reconcile(2)), /snapshot|scan/i);
    assert.equal(f.store.list(candidateId).items.length, 0);
    assert.equal(append(f).state, 'CURRENT');
  } finally { f.db.close(); }
});

test('dependency provenance includes imports and importers beyond the first bounded page', () => {
  const f = fixture();
  try {
    const ownerId = subjectId('app', 'renderer.ts#file');
    const neighbors: string[] = [];
    transaction(f.db, () => {
      for (let i = 0; i < 205; i++) {
        const path = `dependency-${i}.ts`;
        const id = subjectId('app', `${path}#file`);
        const fact = { ...source(id, path, `${path}#file`), kind: 'FILE' };
        f.db.prepare('INSERT INTO facts VALUES(?,?,?,?)').run(id, 'app', path, JSON.stringify(fact));
        f.db.prepare('INSERT INTO edges VALUES(?,?)').run(i % 2 ? id : ownerId, i % 2 ? ownerId : id);
        neighbors.push(id);
      }
    });
    const review = append(f);
    assert.equal(review.sources[0]!.dependencyCount, 205);
    const beyondFirstPage = neighbors.sort().at(-1)!;
    scan(f, db => changeBody(db, 'facts', beyondFirstPage, body => { body.contentHash = sha256('changed-neighbor'); }));
    assert.equal(f.store.latestCurrent(candidateId), null);
    const stale = f.store.latest(candidateId)!;
    assert.equal(stale.state, 'STALE');
    assert.equal(stale.sources[0]!.dependencyFingerprint, review.sources[0]!.dependencyFingerprint);
  } finally { f.db.close(); }
});

test('reversing a dependency invalidates counterevidence even when source records are unchanged', () => {
  const f = fixture();
  try {
    const ownerId = subjectId('app', 'renderer.ts#file');
    const neighborId = subjectId('app', 'dependency.ts#file');
    transaction(f.db, () => {
      const neighbor = { ...source(neighborId, 'dependency.ts', 'dependency.ts#file'), kind: 'FILE' };
      f.db.prepare('INSERT INTO facts VALUES(?,?,?,?)').run(neighborId, 'app', neighbor.path, JSON.stringify(neighbor));
      f.db.prepare('INSERT INTO edges VALUES(?,?)').run(ownerId, neighborId);
    });
    const before = append(f);
    const sourceRecords = f.db.prepare('SELECT * FROM facts ORDER BY id').all();
    assert.equal(before.sources[0]!.dependencyCount, 1);
    scan(f, db => {
      db.prepare('DELETE FROM edges WHERE source=? AND target=?').run(ownerId, neighborId);
      db.prepare('INSERT INTO edges VALUES(?,?)').run(neighborId, ownerId);
    });
    assert.deepEqual(f.db.prepare('SELECT * FROM facts ORDER BY id').all(), sourceRecords);
    assert.equal(f.store.latestCurrent(candidateId), null);
    const stale = f.store.latest(candidateId)!;
    assert.equal(stale.id, before.id);
    assert.equal(stale.state, 'STALE');
    assert.equal(stale.invalidation?.snapshot, 2);
    assert.deepEqual(stale.sources, before.sources);
  } finally { f.db.close(); }
});

test('WAL review reads pin annotation pages and revision while another connection commits', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'assurance-review-wal-'));
  const path = join(dir, 'index.sqlite');
  const writer = fixture(path);
  let reader: DatabaseSync | undefined;
  try {
    const first = append(writer);
    reader = new DatabaseSync(path, { readOnly: true });
    const reviews = new LocalReviewStore(reader);
    transaction(reader, () => {
      const pinnedRevision = reviews.revision();
      assert.equal(reviews.latestCurrent(candidateId)?.id, first.id);
      const second = append(writer, { disposition: 'INVESTIGATE' });
      assert.ok(writer.store.revision() > pinnedRevision);
      assert.equal(reviews.revision(), pinnedRevision);
      assert.deepEqual(reviews.list(candidateId).items.map(item => item.id), [first.id]);
      assert.notEqual(reviews.latestCurrent(candidateId)?.id, second.id);
    }, false);
    assert.equal(reviews.latest(candidateId)?.disposition, 'INVESTIGATE');
    assert.equal(reviews.latestCurrent(candidateId)?.disposition, 'INVESTIGATE');
    assert.equal(reviews.list(candidateId).items.length, 2);
    assert.equal(reviews.revision(), writer.store.revision());
  } finally { reader?.close(); writer.db.close(); await rm(dir, { recursive: true }); }
});

test('WAL readers observe source changes and review invalidation from the same committed scan', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'assurance-review-scan-wal-'));
  const path = join(dir, 'index.sqlite');
  const writer = fixture(path);
  let reader: DatabaseSync | undefined;
  try {
    const original = append(writer);
    reader = new DatabaseSync(path, { readOnly: true });
    const reviews = new LocalReviewStore(reader);
    const originalSource = String(reader.prepare('SELECT body FROM facts WHERE id=?').get(primaryId)!.body);
    transaction(reader, () => {
      const pinnedRevision = reviews.revision();
      scan(writer, db => changeBody(db, 'facts', primaryId, body => { body.contentHash = sha256('new-source'); }));
      assert.ok(writer.store.revision() > pinnedRevision);
      assert.equal(writer.store.latestCurrent(candidateId), null);
      assert.equal(reviews.revision(), pinnedRevision);
      assert.equal(reviews.latestCurrent(candidateId)?.id, original.id);
      assert.equal(String(reader!.prepare('SELECT body FROM facts WHERE id=?').get(primaryId)!.body), originalSource);
    }, false);
    assert.notEqual(String(reader.prepare('SELECT body FROM facts WHERE id=?').get(primaryId)!.body), originalSource);
    assert.equal(reviews.latestCurrent(candidateId), null);
    assert.equal(reviews.latest(candidateId)?.state, 'STALE');
    assert.equal(reviews.latest(candidateId)?.invalidation?.snapshot, 2);
  } finally { reader?.close(); writer.db.close(); await rm(dir, { recursive: true }); }
});
