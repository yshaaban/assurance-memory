import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalIndex } from '../src/local-index.js';
import { localQuery } from '../src/local-query.js';
import { analyzeComponent, type ScanProfile } from '../src/scan.js';
import { sha256, subjectId } from '../src/util.js';
import type { Fact } from '../src/types.js';

const cli = fileURLToPath(new URL('../src/local-cli.js', import.meta.url));
const source: Fact = { id: subjectId('app', 'handler.ts#handler'), locator: 'handler.ts#handler',
  path: 'handler.ts', kind: 'FUNCTION', language: 'TS', contentHash: sha256('handler'),
  signatureHash: sha256('signature'), tags: [], effects: [], metrics: { lines: 5 }, line: 1 };
function publish(index: LocalIndex) {
  index.begin('recovery', {});
  index.ingest('app', '/fixture/app', { facts: [source], findings: [{ subjectId: source.id,
    ruleId: 'TS_EMPTY_CATCH', severity: 'HIGH', line: 1, message: 'Inspect recovery' }],
    rulesExecuted: [], analyzer: 'fixture', sourceRevision: 'same', configurationDigest: 'same',
    environment: {}, coverage: { discovery: 'COMPLETE', semantic: 'PARTIAL', limitations: [] } });
  index.commit(['app']);
}
function note(index: LocalIndex, author: string) {
  return index.addReview({ candidateId: index.backlog().items[0].id, expectedSnapshot: index.revision(),
    disposition: 'COUNTEREVIDENCE', reason: 'The caller implements recovery', evidence: 'Read the caller contract', author }) as any;
}
function run(...args: string[]) { return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 30000 }); }

test('CLI archive recovery is exclusive, corruption-safe, idempotent and permanently stale before and after scan', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'assurance-recovery-'));
  const original = join(dir, 'original.sqlite'), target = join(dir, 'restored.sqlite'), archive = join(dir, 'reviews.json');
  try {
    const index = new LocalIndex(original); publish(index); const saved = note(index, 'original reviewer'); index.close();
    const exported = run('review-export', '--db', original, '--output', archive);
    assert.equal(exported.status, 0, exported.stderr);
    assert.equal((await stat(archive)).mode & 0o777, 0o600);
    const bytes = await readFile(archive);
    assert.notEqual(run('review-export', '--db', original, '--output', archive).status, 0);
    assert.deepEqual(await readFile(archive), bytes);
    const corrupt = join(dir, 'corrupt.json'); await writeFile(corrupt, bytes.toString().replace('original reviewer', 'altered reviewer'));
    assert.notEqual(run('review-import', '--db', target, '--input', corrupt).status, 0);
    assert.equal(existsSync(target), false);
    const restored = run('review-import', '--db', target, '--input', archive);
    assert.equal(restored.status, 0, restored.stderr); assert.equal(JSON.parse(restored.stdout).imported, 1);
    const recovered = new LocalIndex(target);
    try {
      assert.equal(recovered.revision(), 0);
      const absent = recovered.reviewHistory(saved.candidateId).items[0];
      assert.equal(absent.invalidation.reason, 'ARCHIVE_RESTORE_REQUIRES_REVIEW');
      publish(recovered);
      assert.equal(recovered.backlog().items[0].review.state, 'STALE');
      assert.equal(recovered.backlog().items[0].score, 80);
      assert.equal(recovered.changes(1).items.length, 1);
    } finally { recovered.close(); }
    const repeated = run('review-import', '--db', target, '--input', archive);
    assert.equal(repeated.status, 0, repeated.stderr); assert.equal(JSON.parse(repeated.stdout).skipped, 1);
    assert.equal(JSON.parse(repeated.stdout).imported, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('archive import preserves local priority consistently in backlog, context and task brief', () => {
  const original = new LocalIndex(':memory:'), target = new LocalIndex(':memory:');
  try {
    publish(original); note(original, 'archived reviewer');
    publish(target); const native = note(target, 'local reviewer');
    target.importReviews(original.exportReviews());
    assert.equal(target.reviewHistory(native.candidateId).items.length, 2);
    const candidates = [target.backlog().items[0], target.context(source.id).opportunities[0],
      (localQuery(target, 'investigate', { task: 'handler' }).entries as any[])[0].candidates[0]];
    for (const candidate of candidates) {
      assert.equal(candidate.review.id, native.id); assert.equal(candidate.review.state, 'CURRENT');
      assert.equal(candidate.score, 60);
    }
  } finally { original.close(); target.close(); }
});

test('version-two migration and failed scan preserve retained records and roll back schema changes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'assurance-v2-'));
  const path = join(dir, 'index.sqlite');
  try {
    const first = new LocalIndex(path); publish(first); const review = note(first, 'v2 reviewer'); first.close();
    const old = new DatabaseSync(path);
    old.exec(`DROP VIEW local_review_latest; DROP INDEX local_reviews_effective; DROP INDEX local_reviews_archive_digest;
      CREATE VIEW local_review_latest AS SELECT r.*, 'CURRENT' AS state, NULL AS invalidatedSnapshot, NULL AS invalidationReason
      FROM local_reviews r WHERE r.id=(SELECT max(id) FROM local_reviews WHERE candidateId=r.candidateId);
      PRAGMA user_version=2;`);
    const before = old.prepare("SELECT sql FROM sqlite_master WHERE name='local_review_latest'").get()!.sql; old.close();
    assert.throws(() => new LocalIndex(path, true), /run scan/);
    const config = join(dir, 'workspace.json');
    await writeFile(config, JSON.stringify({ workspace: 'recovery', components: { app: { root: 'missing-root' } } }));
    assert.notEqual(run('scan', '--db', path, '--config', config).status, 0);
    const unchanged = new DatabaseSync(path, { readOnly: true });
    try {
      assert.equal(unchanged.prepare('PRAGMA user_version').get()!.user_version, 2);
      assert.equal(unchanged.prepare('SELECT count(*) AS n FROM snapshots').get()!.n, 1);
      assert.equal(unchanged.prepare('SELECT count(*) AS n FROM local_reviews').get()!.n, 1);
      assert.equal(unchanged.prepare("SELECT sql FROM sqlite_master WHERE name='local_review_latest'").get()!.sql, before);
    } finally { unchanged.close(); }
    const migrated = new LocalIndex(path, false, true);
    try {
      publish(migrated);
      assert.equal(migrated.summary().schemaVersion, 4);
      assert.equal(migrated.reviewHistory(review.candidateId).items[0].state, 'CURRENT');
      assert.equal(migrated.reviewRevision(), 1);
      assert.equal(migrated.backlog().items[0].score, 60);
      assert.equal(migrated.changes(2).items.length, 0);
    } finally { migrated.close(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('scan profiling leaves source identity and retained review freshness unchanged', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'assurance-profile-'));
  const index = new LocalIndex(':memory:');
  try {
    await writeFile(join(dir, 'handler.ts'), 'export async function handler() { try { await Promise.resolve(); } catch {} }\n');
    const config = { root: dir };
    const first = await analyzeComponent(undefined, 'app', dir, config);
    index.begin('profile', {}); index.ingest('app', dir, first); index.commit(['app']);
    const saved = note(index, 'profile reviewer');
    let profile: ScanProfile | undefined;
    const second = await analyzeComponent(undefined, 'app', dir, config, undefined, value => { profile = value; });
    assert.deepEqual(second, first);
    assert.ok(profile); assert.equal(profile.files, 1); assert.equal(profile.facts, first.facts.length);
    assert.ok(profile.elapsedMs >= 0); assert.ok(profile.processPeakRssBytes > 0);
    assert.deepEqual(Object.keys(profile.phaseMs), ['discovery', 'typescript', 'java', 'configuration', 'sourceValidation', 'context']);
    index.begin('profile', {}); index.ingest('app', dir, second); index.commit(['app']);
    assert.equal(index.reviewHistory(saved.candidateId).items[0].state, 'CURRENT');
    assert.deepEqual(index.changes(2).items, []);
  } finally { index.close(); await rm(dir, { recursive: true, force: true }); }
});
