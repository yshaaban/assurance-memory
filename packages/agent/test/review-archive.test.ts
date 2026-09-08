import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeLocalReviewSchema, LocalReviewStore } from '../src/local-review.js';
import { archiveCanonical, archiveRecordDigest, LOCAL_REVIEW_ARCHIVE_LIMITS, parseReviewArchive,
  type LocalReviewArchive } from '../src/local-review-archive.js';
import { sha256, subjectId } from '../src/util.js';

type Fixture = { db: DatabaseSync; store: LocalReviewStore; candidateId: string; sourceId: string };

function transaction<T>(db: DatabaseSync, operation: () => T, write = true): T {
  db.exec(write ? 'BEGIN IMMEDIATE' : 'BEGIN');
  try { const result = operation(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

function fixture(path = ':memory:', component = 'app'): Fixture {
  const db = new DatabaseSync(path);
  const sourceId = subjectId(component, 'worker.ts#run');
  const candidateId = sha256(`${sourceId}:TS_UNBOUNDED_FANOUT`);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE snapshots(id INTEGER PRIMARY KEY,created TEXT NOT NULL,config TEXT NOT NULL);
    CREATE TABLE components(id TEXT PRIMARY KEY,snapshot INTEGER NOT NULL,body TEXT NOT NULL);
    CREATE TABLE facts(id TEXT PRIMARY KEY,component TEXT NOT NULL,path TEXT NOT NULL,body TEXT NOT NULL);
    CREATE TABLE edges(source TEXT NOT NULL,target TEXT NOT NULL,PRIMARY KEY(source,target));
    CREATE TABLE opportunities(id TEXT PRIMARY KEY,component TEXT NOT NULL,resolved INTEGER,body TEXT NOT NULL);`);
  transaction(db, () => {
    initializeLocalReviewSchema(db);
    db.prepare('INSERT INTO meta VALUES(?,?)').run('workspace', 'archive-fixture');
    db.prepare('INSERT INTO snapshots VALUES(?,?,?)').run(1, '2026-09-08T00:00:00.000Z', '{}');
    db.prepare('INSERT INTO components VALUES(?,?,?)').run(component, 1, JSON.stringify({
      root: `/fixture/${component}`, analyzer: 'fixture-1', sourceRevision: 'commit-1',
      configurationDigest: sha256('config'), environment: { runtime: 'node-24.16.0' } }));
    db.prepare('INSERT INTO facts VALUES(?,?,?,?)').run(sourceId, component, 'worker.ts', JSON.stringify({
      id: sourceId, path: 'worker.ts', locator: 'worker.ts#run', contentHash: sha256('worker-1'), kind: 'FUNCTION' }));
    db.prepare('INSERT INTO opportunities VALUES(?,?,?,?)').run(candidateId, component, null, JSON.stringify({
      id: candidateId, subjectId: sourceId, ruleId: 'TS_UNBOUNDED_FANOUT', path: 'worker.ts',
      message: 'Inspect the inventory bound', confidence: 'STATIC_CANDIDATE' }));
  });
  return { db, store: new LocalReviewStore(db), candidateId, sourceId };
}

function append(f: Fixture, author = 'original reviewer') {
  return transaction(f.db, () => f.store.append({ candidateId: f.candidateId,
    expectedSnapshot: Number(f.db.prepare('SELECT max(id) AS id FROM snapshots').get()!.id),
    disposition: 'COUNTEREVIDENCE', reason: 'The source inventory has a fixed size.',
    evidence: 'Inspected the literal inventory and its callers.', author }));
}

function archive(f: Fixture): string { return transaction(f.db, () => f.store.exportArchive(), false); }
function restore(f: Fixture, value: string | Uint8Array) { return transaction(f.db, () => f.store.importArchive(value)); }
function total(f: Fixture): number { return Number(f.db.prepare('SELECT count(*) AS n FROM local_reviews').get()!.n); }

function scan(f: Fixture, change: () => void = () => {}): void {
  transaction(f.db, () => {
    const snapshot = Number(f.db.prepare('SELECT max(id) AS id FROM snapshots').get()!.id) + 1;
    f.db.prepare('INSERT INTO snapshots VALUES(?,?,?)').run(snapshot, `scan-${snapshot}`, '{}');
    change();
    f.store.reconcile(snapshot);
  });
}

/** Recompute integrity to exercise structural validation and deliberately untrusted authorship. */
function sign(value: LocalReviewArchive): string {
  for (const entry of value.records) entry.digest = archiveRecordDigest(entry.record);
  const { digest: _digest, ...payload } = value;
  return archiveCanonical({ ...payload, digest: sha256(archiveCanonical(payload)) }) + '\n';
}

test('complete archive roundtrip retains original history, disappeared candidates, captures and invalidations', () => {
  const source = fixture(), target = fixture(), recovered = fixture();
  try {
    append(source, 'first');
    append(source, 'second');
    scan(source, () => source.db.prepare("UPDATE components SET body=json_set(body,'$.analyzer','fixture-2')").run());
    append(source, 'third');
    scan(source, () => source.db.exec('DELETE FROM opportunities; DELETE FROM facts; DELETE FROM components;'));
    const exported = archive(source), original = parseReviewArchive(exported);
    assert.equal(original.records.length, 3);
    assert.deepEqual(original.records.map(entry => entry.record.note.invalidation?.reason),
      ['SOURCE_OR_CONTEXT_CHANGED', 'SOURCE_OR_CONTEXT_CHANGED', 'CANDIDATE_ABSENT']);
    assert.equal(restore(target, exported).imported, 3);
    const history = target.store.list(source.candidateId).items;
    assert.equal(history.length, 3);
    for (const review of history) {
      assert.equal(review.state, 'STALE');
      assert.equal(review.invalidation?.reason, 'ARCHIVE_RESTORE_REQUIRES_REVIEW');
      assert.equal(review.authority, 'USER_REPORTED_LOCAL_ANNOTATION');
      assert.equal(review.sources[0]!.id, source.sourceId);
      assert.ok(review.archive?.originalInvalidation);
      const sourceEntry = original.records.find(entry => entry.record.origin.reviewId === review.archive!.origin.reviewId)!;
      assert.deepEqual(review.candidate, sourceEntry.record.note.candidate);
      assert.deepEqual(review.sources, sourceEntry.record.note.sources);
      assert.deepEqual(review.contexts, sourceEntry.record.note.contexts);
      assert.deepEqual(review.archive?.originalInvalidation, sourceEntry.record.note.invalidation);
    }
    const reexported = parseReviewArchive(archive(target));
    assert.deepEqual(reexported.records, original.records);
    assert.equal(restore(recovered, archive(target)).imported, 3);
    assert.deepEqual(parseReviewArchive(archive(recovered)).records, original.records);
  } finally { source.db.close(); target.db.close(); recovered.db.close(); }
});

test('repeat import and returning an archive to its origin are idempotent without revision changes', () => {
  const source = fixture(), target = fixture();
  try {
    append(source);
    const exported = archive(source);
    assert.equal(restore(target, Buffer.from(exported)).imported, 1);
    const revision = target.store.revision();
    assert.deepEqual(restore(target, exported), { imported: 0, skipped: 1, total: 1,
      reviewRevision: revision, digest: parseReviewArchive(exported).digest });
    assert.equal(total(target), 1);
    assert.equal(restore(source, archive(target)).skipped, 1);
    assert.equal(source.store.revision(), 1);
    assert.equal(source.store.latestCurrent(source.candidateId)?.author, 'original reviewer');
  } finally { source.db.close(); target.db.close(); }
});

test('later local invalidation can converge with an imported record without blocking export or losing audit rows', () => {
  const source = fixture(), target = fixture();
  try {
    const original = append(source);
    // Produce a real later archive, then restore the earlier database snapshot.
    // This models importing a later checkpoint into an older local copy.
    source.db.exec('BEGIN IMMEDIATE');
    source.db.prepare('INSERT INTO snapshots VALUES(?,?,?)').run(2, 'later-scan', '{}');
    source.db.prepare("UPDATE components SET body=json_set(body,'$.analyzer','fixture-2')").run();
    source.store.reconcile(2);
    const laterArchive = source.store.exportArchive();
    source.db.exec('ROLLBACK');
    assert.equal(source.store.latestCurrent(source.candidateId)?.id, original.id);

    assert.equal(restore(source, laterArchive).imported, 1);
    assert.equal(total(source), 2);
    assert.equal(parseReviewArchive(archive(source)).records.length, 2);
    scan(source, () => source.db.prepare("UPDATE components SET body=json_set(body,'$.analyzer','fixture-2')").run());
    const before = source.store.list(source.candidateId).items;
    const revision = source.store.revision();
    assert.deepEqual(before.find(review => review.id === original.id)!.invalidation,
      before.find(review => review.archive)!.archive!.originalInvalidation);

    const exported = archive(source);
    assert.deepEqual(parseReviewArchive(exported).records, parseReviewArchive(laterArchive).records);
    assert.deepEqual(source.store.list(source.candidateId).items, before);
    assert.equal(source.store.revision(), revision);
    assert.equal(total(source), 2);
    assert.equal(source.store.latest(source.candidateId)?.id, original.id);
    assert.equal(source.store.latestCurrent(source.candidateId), null);
    assert.equal(restore(target, exported).imported, 1);
    assert.equal(restore(target, exported).skipped, 1);
    assert.deepEqual(parseReviewArchive(archive(target)).records, parseReviewArchive(exported).records);
  } finally { source.db.close(); target.db.close(); }
});

for (const change of ['identical inputs', 'changed source', 'changed context', 'moved component'] as const) {
  test(`restore with ${change} cannot manufacture current counterevidence`, () => {
    const source = fixture(), target = fixture(':memory:', change === 'moved component' ? 'moved-app' : 'app');
    try {
      append(source);
      if (change === 'changed source') target.db.prepare("UPDATE facts SET body=json_set(body,'$.contentHash','changed')").run();
      if (change === 'changed context') target.db.prepare("UPDATE components SET body=json_set(body,'$.root','/elsewhere/app')").run();
      restore(target, archive(source));
      const review = target.store.latest(source.candidateId)!;
      assert.equal(review.state, change === 'moved component' ? 'CANDIDATE_ABSENT' : 'STALE');
      assert.equal(review.snapshot, 1);
      assert.equal(review.sources[0]!.component, 'app');
      assert.equal(review.sources[0]!.id, source.sourceId);
      assert.equal(review.contexts[0]!.metadata.root, '/fixture/app');
      assert.equal(target.store.latestCurrent(source.candidateId), null);
      scan(target);
      assert.equal(target.store.latestCurrent(source.candidateId), null);
      assert.equal(target.store.latest(source.candidateId)?.invalidation?.reason, 'ARCHIVE_RESTORE_REQUIRES_REVIEW');
    } finally { source.db.close(); target.db.close(); }
  });
}

test('recovery before any scan preserves captured snapshot and remains invalidated after candidates reappear', () => {
  const source = fixture(), target = fixture();
  try {
    append(source);
    const candidate = target.db.prepare('SELECT * FROM opportunities').get()!;
    target.db.exec('DELETE FROM opportunities; DELETE FROM facts; DELETE FROM components; DELETE FROM snapshots; DELETE FROM meta;');
    restore(target, archive(source));
    assert.equal(target.store.latest(source.candidateId)?.invalidation?.snapshot, 0);
    assert.equal(target.store.latest(source.candidateId)?.snapshot, 1);
    assert.deepEqual(parseReviewArchive(archive(target)).records, parseReviewArchive(archive(source)).records);
    transaction(target.db, () => {
      target.db.prepare('INSERT INTO snapshots VALUES(?,?,?)').run(1, 'recovery-scan', '{}');
      target.db.prepare('INSERT INTO opportunities VALUES(?,?,?,?)').run(String(candidate.id), String(candidate.component), null, String(candidate.body));
      target.store.reconcile(1);
    });
    assert.equal(target.store.latest(source.candidateId)?.state, 'STALE');
  } finally { source.db.close(); target.db.close(); }
});

test('restoring historical notes cannot displace a destination local review or resurrect older counterevidence', () => {
  const source = fixture(), target = fixture();
  try {
    append(source, 'archived reviewer');
    const local = append(target, 'destination reviewer');
    restore(target, archive(source));
    assert.equal(target.store.list(target.candidateId).items[0]!.author, 'archived reviewer');
    assert.equal(target.store.latestCurrent(target.candidateId)?.id, local.id);
    assert.equal(target.db.prepare('SELECT id FROM local_review_latest WHERE candidateId=?').get(target.candidateId)!.id, local.id);
    scan(target, () => target.db.prepare("UPDATE components SET body=json_set(body,'$.analyzer','fixture-2')").run());
    assert.equal(target.store.latest(target.candidateId)?.id, local.id);
    assert.equal(target.store.latestCurrent(target.candidateId), null);
    assert.equal(target.db.prepare('SELECT state FROM local_review_latest WHERE candidateId=?').get(target.candidateId)!.state, 'STALE');
    const fresh = append(target, 'new local review');
    assert.equal(target.store.latestCurrent(target.candidateId)?.id, fresh.id);
  } finally { source.db.close(); target.db.close(); }
});

test('corrupt, reordered, duplicate, oversized and malformed archives reject without publishing history', () => {
  const source = fixture(), target = fixture();
  try {
    append(source, 'first'); append(source, 'second');
    const exported = archive(source);
    const cases: Array<string | Uint8Array> = [exported.replace('fixed size', 'unlimited size'), '{',
      exported.replace('"version":1', '"version":1,"version":1'),
      JSON.stringify(JSON.parse(exported), null, 2), Buffer.alloc(LOCAL_REVIEW_ARCHIVE_LIMITS.bytes + 1),
      new Uint8Array([0xff, 0xfe])];
    const reordered = parseReviewArchive(exported); reordered.records.reverse(); cases.push(sign(reordered));
    const duplicate = parseReviewArchive(exported); duplicate.records[1] = { ...duplicate.records[0]!, sequence: 2 }; cases.push(sign(duplicate));
    const missing = JSON.parse(exported); delete missing.records[1].record.note.evidence; cases.push(sign(missing));
    const version = parseReviewArchive(exported); (version as any).version = 2; cases.push(sign(version));
    const tooMany = parseReviewArchive(exported); (tooMany as any).records = Array(LOCAL_REVIEW_ARCHIVE_LIMITS.records + 1).fill(null);
    const { digest: _tooManyDigest, ...tooManyPayload } = tooMany;
    cases.push(archiveCanonical({ ...tooManyPayload, digest: sha256(archiveCanonical(tooManyPayload)) }));
    const authority = parseReviewArchive(exported); (authority as any).authority = 'APPROVED'; cases.push(sign(authority));
    const disposition = parseReviewArchive(exported); (disposition.records[0]!.record.note as any).disposition = 'APPROVED'; cases.push(sign(disposition));
    const capture = parseReviewArchive(exported); capture.records[0]!.record.note.sources[0]!.fact.id = 'forged'; cases.push(sign(capture));
    const deep = JSON.parse(exported); let tree: any = {}; deep.records[0].record.note.candidate.deep = tree;
    for (let i = 0; i < 40; i++) { tree.next = {}; tree = tree.next; } cases.push(sign(deep));
    for (const invalid of cases) {
      transaction(target.db, () => assert.throws(() => target.store.importArchive(invalid)));
      assert.equal(total(target), 0);
      assert.equal(target.store.revision(), 0);
    }
    assert.equal(restore(target, exported).imported, 2);
  } finally { source.db.close(); target.db.close(); }
});

test('a correctly checksummed fabricated author remains a stale self-reported annotation', () => {
  const source = fixture(), target = fixture();
  try {
    append(source);
    const forged = parseReviewArchive(archive(source));
    forged.records[0]!.record.note.author = 'claimed external approver';
    forged.records[0]!.record.note.reason = 'A claim supplied in an untrusted archive';
    restore(target, sign(forged));
    const review = target.store.latest(source.candidateId)!;
    assert.equal(review.author, 'claimed external approver');
    assert.equal(review.authority, 'USER_REPORTED_LOCAL_ANNOTATION');
    assert.equal(review.state, 'STALE');
    assert.equal(target.store.latestCurrent(source.candidateId), null);
  } finally { source.db.close(); target.db.close(); }
});

test('import savepoint rolls back inserted records and invalidations even when its caller catches and commits', () => {
  const source = fixture(), target = fixture();
  try {
    append(source, 'first'); append(source, 'reject second');
    const before = append(target, 'destination');
    target.db.exec(`CREATE TRIGGER fail_archive BEFORE INSERT ON local_reviews
      WHEN json_extract(NEW.body,'$.author')='reject second'
      BEGIN SELECT RAISE(ABORT,'injected import failure'); END;`);
    const exported = archive(source), revision = target.store.revision();
    transaction(target.db, () => assert.throws(() => target.store.importArchive(exported), /injected import failure/));
    assert.equal(total(target), 1);
    assert.equal(target.store.revision(), revision);
    assert.equal(target.db.prepare('SELECT count(*) AS n FROM local_review_invalidations').get()!.n, 0);
    assert.equal(target.store.latestCurrent(target.candidateId)?.id, before.id);
    target.db.exec('DROP TRIGGER fail_archive');
    assert.equal(restore(target, exported).imported, 2);
  } finally { source.db.close(); target.db.close(); }
});

test('caller rollback discards a successful import and its review revision', () => {
  const source = fixture(), target = fixture();
  try {
    append(source);
    const exported = archive(source);
    target.db.exec('BEGIN IMMEDIATE');
    target.store.importArchive(exported);
    assert.equal(total(target), 1);
    target.db.exec('ROLLBACK');
    assert.equal(total(target), 0);
    assert.equal(target.store.revision(), 0);
  } finally { source.db.close(); target.db.close(); }
});

test('archive export includes history past query pages and explicitly rejects over-limit history', () => {
  const source = fixture();
  try {
    const first = append(source);
    const body = source.db.prepare('SELECT body FROM local_reviews WHERE id=?').get(first.id)!.body;
    transaction(source.db, () => {
      const insert = source.db.prepare('INSERT INTO local_reviews(candidateId,snapshot,disposition,created,body,fingerprint) VALUES(?,?,?,?,?,?)');
      for (let i = 1; i < 205; i++) insert.run(first.candidateId, first.snapshot, first.disposition, first.created, String(body), first.fingerprint);
    });
    assert.equal(source.store.list(source.candidateId, 200).hasMore, true);
    assert.equal(parseReviewArchive(archive(source)).records.length, 205);
    transaction(source.db, () => {
      const insert = source.db.prepare('INSERT INTO local_reviews(candidateId,snapshot,disposition,created,body,fingerprint) VALUES(?,?,?,?,?,?)');
      for (let i = 205; i <= LOCAL_REVIEW_ARCHIVE_LIMITS.records; i++)
        insert.run(first.candidateId, first.snapshot, first.disposition, first.created, String(body), first.fingerprint);
    });
    assert.throws(() => archive(source), /exceeds 10000 records/);
    assert.equal(total(source), 10001);
  } finally { source.db.close(); }
});

test('archive export rejects histories exceeding its byte bound without changing retained records', () => {
  const source = fixture();
  try {
    source.db.prepare("UPDATE components SET body=json_set(body,'$.details',?)").run('x'.repeat(128 * 1024));
    const first = append(source);
    const body = source.db.prepare('SELECT body FROM local_reviews WHERE id=?').get(first.id)!.body;
    transaction(source.db, () => {
      const insert = source.db.prepare('INSERT INTO local_reviews(candidateId,snapshot,disposition,created,body,fingerprint) VALUES(?,?,?,?,?,?)');
      for (let i = 1; i < 128; i++) insert.run(first.candidateId, first.snapshot, first.disposition, first.created, String(body), first.fingerprint);
    });
    const revision = source.store.revision();
    assert.throws(() => archive(source), /exceeds 16777216 bytes/);
    assert.equal(total(source), 128);
    assert.equal(source.store.revision(), revision);
  } finally { source.db.close(); }
});

test('export requires a pinned transaction and reads consistent WAL history while an import commits', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'assurance-archive-wal-'));
  const source = fixture(), writer = fixture(join(directory, 'index.db'));
  let reader: DatabaseSync | undefined;
  try {
    append(source);
    const exported = archive(source);
    reader = new DatabaseSync(join(directory, 'index.db'), { readOnly: true });
    const store = new LocalReviewStore(reader);
    assert.throws(() => writer.store.exportArchive(), /transaction/);
    assert.throws(() => writer.store.importArchive(exported), /transaction/);
    transaction(reader, () => {
      assert.equal(store.revision(), 0);
      restore(writer, exported);
      const pinned = parseReviewArchive(store.exportArchive());
      assert.equal(pinned.records.length, 0);
      assert.equal(pinned.source.reviewRevision, 0);
      assert.equal(store.list(source.candidateId).items.length, 0);
    }, false);
    transaction(reader, () => {
      const current = parseReviewArchive(store.exportArchive());
      assert.equal(current.records.length, 1);
      assert.equal(current.source.reviewRevision, 2);
      assert.equal(store.latest(source.candidateId)?.state, 'STALE');
    }, false);
    append(source, 'another archived reviewer');
    const secondArchive = archive(source);
    writer.db.exec('BEGIN IMMEDIATE');
    writer.store.importArchive(secondArchive);
    transaction(reader, () => {
      assert.equal(store.list(source.candidateId).items.length, 1);
      assert.equal(store.revision(), 2);
    }, false);
    writer.db.exec('ROLLBACK');
    transaction(reader, () => {
      assert.equal(store.list(source.candidateId).items.length, 1);
      assert.equal(store.revision(), 2);
    }, false);
  } finally { reader?.close(); writer.db.close(); source.db.close(); await rm(directory, { recursive: true, force: true }); }
});
