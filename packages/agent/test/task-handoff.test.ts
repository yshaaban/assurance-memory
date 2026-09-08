import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, symlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { LocalIndex } from '../src/local-index.js';
import { parseReviewArchive } from '../src/local-review-archive.js';

const hook = fileURLToPath(new URL('../../../../scripts/task-handoff.mjs', import.meta.url));
const cli = fileURLToPath(new URL('../src/local-cli.js', import.meta.url));
const run = (args: string[]) => spawnSync(process.execPath, args, { encoding: 'utf8' });

async function fixture(root: string) {
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src/cache.ts'), 'export async function warmCache() { try { await Promise.resolve(); } catch {} }\n');
  await writeFile(join(root, 'workspace.json'), JSON.stringify({ workspace: 'handoff', components: { app: { root: './src' } } }));
  const db = join(root, 'index.sqlite');
  const scan = run([cli, 'scan', '--config', join(root, 'workspace.json'), '--db', db]);
  assert.equal(scan.status, 0, scan.stderr);
  const index = new LocalIndex(db);
  try {
    const candidate = index.backlog(200).items.find((row: any) => row.ruleId === 'TS_EMPTY_CATCH');
    assert.ok(candidate);
    index.addReview({ candidateId: candidate.id, expectedSnapshot: index.revision(), disposition: 'COUNTEREVIDENCE',
      author: 'fixture', reason: 'Optional warm-up failure is deliberately ignored.',
      evidence: 'The fixture has an empty catch; this observation requires rechecking after transfer.' });
  } finally { index.close(); }
  // A read-only SQLite connection can leave WAL/SHM files. The exporter must not
  // open this original index, even though its actual CLI export is read-only.
  const status = run([cli, 'status', '--db', db]);
  assert.equal(status.status, 0, status.stderr);
  return db;
}

async function files(root: string) {
  const result: Record<string, string> = {};
  for (const name of (await readdir(root)).sort()) if ((await stat(join(root, name))).isFile())
    result[name] = (await readFile(join(root, name))).toString('base64');
  return result;
}

test('task handoff exports nonempty history repeatedly without touching the original SQLite files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'assurance-handoff-'));
  try {
    const db = await fixture(root), output = join(root, 'reviews.json');
    const before = await files(root);
    let exported = run([hook, '--db', db, '--output', output, '--quiescent']);
    assert.equal(exported.status, 0, exported.stderr);
    const summary = JSON.parse(exported.stdout);
    assert.equal(summary.records, 1);
    assert.equal(summary.originalIndexUnchanged, true);
    assert.equal(summary.restoration, 'REQUIRES_REVIEW');
    assert.equal((await stat(output)).mode & 0o777, 0o600);
    const archive = await readFile(output);
    assert.equal(parseReviewArchive(archive).records.length, 1);
    const after = await files(root); delete after['reviews.json'];
    assert.deepEqual(after, before);
    exported = run([hook, '--db', db, '--output', output, '--quiescent']);
    assert.notEqual(exported.status, 0);
    assert.deepEqual(await readFile(output), archive);
    exported = run([hook, '--db', db, '--output', output, '--quiescent', '--replace']);
    assert.equal(exported.status, 0, exported.stderr);
    assert.deepEqual(parseReviewArchive(await readFile(output)).records, parseReviewArchive(archive).records);
    const again = await files(root); delete again['reviews.json'];
    assert.deepEqual(again, before);
    assert.ok(!(await readdir(root)).some(name => name.startsWith('.assurance-handoff-')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('task handoff rejects unsafe targets and failures preserve the prior archive and original input', async () => {
  const root = await mkdtemp(join(tmpdir(), 'assurance-handoff-failure-'));
  try {
    const db = await fixture(root), archive = join(root, 'reviews.json');
    assert.equal(run([hook, '--db', db, '--output', archive, '--quiescent']).status, 0);
    const retained = await readFile(archive), database = await readFile(db);
    const missingPrecondition = run([hook, '--db', db, '--output', join(root, 'new.json')]);
    assert.notEqual(missingPrecondition.status, 0); assert.match(missingPrecondition.stderr, /quiescent/);
    assert.notEqual(run([hook, '--db', db, '--output', db, '--quiescent', '--replace']).status, 0);
    assert.deepEqual(await readFile(db), database);
    await writeFile(join(root, 'unrelated.txt'), 'Preserve unrelated data');
    assert.notEqual(run([hook, '--db', db, '--output', join(root, 'unrelated.txt'), '--quiescent', '--replace']).status, 0);
    assert.equal(await readFile(join(root, 'unrelated.txt'), 'utf8'), 'Preserve unrelated data');
    await symlink(archive, join(root, 'alias.json'));
    assert.notEqual(run([hook, '--db', db, '--output', join(root, 'alias.json'), '--quiescent', '--replace']).status, 0);
    await symlink(db, join(root, 'alias.sqlite'));
    assert.notEqual(run([hook, '--db', join(root, 'alias.sqlite'), '--output', join(root, 'new.json'), '--quiescent']).status, 0);
    // A copied invalid DB fails inside the real exporter; the previous archive
    // and invalid original remain unchanged and temporary files are removed.
    const invalid = join(root, 'invalid.sqlite'); await writeFile(invalid, 'not a database');
    const result = run([hook, '--db', invalid, '--output', archive, '--quiescent', '--replace']);
    assert.notEqual(result.status, 0);
    assert.deepEqual(await readFile(archive), retained);
    assert.equal(await readFile(invalid, 'utf8'), 'not a database');
    assert.ok(!(await readdir(root)).some(name => name.startsWith('.assurance-handoff-')));
  } finally { await rm(root, { recursive: true, force: true }); }
});
