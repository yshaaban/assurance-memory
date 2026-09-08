import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, access, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { subjectId } from '../src/util.js';
import { LocalIndex } from '../src/local-index.js';
import { parseReviewArchive, LOCAL_REVIEW_ARCHIVE_LIMITS } from '../src/local-review-archive.js';

const hook = fileURLToPath(new URL('../../../../scripts/task-context.mjs', import.meta.url));
const cli = fileURLToPath(new URL('../src/local-cli.js', import.meta.url));

test('task-start refreshes source, preserves all notes and fails without replacing a prior packet', async () => {
  const root = await mkdtemp(join(tmpdir(), 'assurance-task-context-'));
  try {
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src/session.ts'), 'export function sessionActive() { return true; }');
    await writeFile(join(root, 'workspace.json'), JSON.stringify({ workspace: 'task-hook', components: { app: { root: './src' } } }));
    await writeFile(join(root, 'task.txt'), 'session active ownership');
    const notes = '\uFEFFRejected hypothesis: removing the owner check.\nRecheck the caller.\n🧪\n';
    await writeFile(join(root, 'notes.md'), notes);
    const alias = join(root, 'task-hook.mjs');
    await symlink(hook, alias);
    const run = (output: string, extra: string[] = []) => spawnSync(process.execPath, [alias, '--config', join(root, 'workspace.json'),
      '--db', join(root, 'index.sqlite'), '--task', join(root, 'task.txt'), '--notes', join(root, 'notes.md'),
      '--output', join(root, output), ...extra], { encoding: 'utf8' });
    for (const extra of [['--limit', '21'], ['--max-bytes', '4095']]) {
      const invalid = run('invalid.json', extra);
      assert.notEqual(invalid.status, 0);
      await assert.rejects(access(join(root, 'index.sqlite')), 'Invalid options must not create or scan an index');
      await assert.rejects(access(join(root, 'invalid.json')));
    }
    let result = run('first.json');
    assert.equal(result.status, 0, result.stderr);
    const first = JSON.parse(await readFile(join(root, 'first.json'), 'utf8'));
    assert.equal(first.retainedNotes.text, notes);
    assert.equal(first.retainedNotes.freshness, 'NOT_ESTABLISHED');
    assert.equal(first.investigation.snapshot, 1);
    assert.ok(first.investigation.entries.length > 0);
    await writeFile(join(root, 'src/session.ts'), 'export function sessionActive() { return false; }');
    result = run('second.json');
    assert.equal(result.status, 0, result.stderr);
    const second = JSON.parse(await readFile(join(root, 'second.json'), 'utf8'));
    assert.equal(second.investigation.snapshot, 2);
    assert.equal(second.sourceChanges.previousSnapshot, 1);
    assert.ok(second.sourceChanges.items.some((row: any) => row.kind === 'CHANGED'));
    assert.notEqual(second.investigation.entries[0].source.contentHash, first.investigation.entries[0].source.contentHash);
    result = run('first.json');
    assert.notEqual(result.status, 0);
    assert.deepEqual(JSON.parse(await readFile(join(root, 'first.json'), 'utf8')), first);
    await writeFile(join(root, 'workspace.json'), JSON.stringify({ workspace: 'task-hook', components: { app: { root: './missing' } } }));
    result = run('failed.json');
    assert.notEqual(result.status, 0);
    await assert.rejects(access(join(root, 'failed.json')));
    await writeFile(join(root, 'notes.md'), 'n'.repeat(65_537));
    result = run('oversize.json');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /65536/);
    await assert.rejects(access(join(root, 'oversize.json')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('task-start transfers review archives across checkout roots without moving indexes or establishing current evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'assurance-task-portable-'));
  try {
    const firstRoot = join(root, 'first-checkout'), secondRoot = join(root, 'second-checkout');
    for (const checkout of [firstRoot, secondRoot]) {
      await mkdir(join(checkout, 'src'), { recursive: true });
      await writeFile(join(checkout, 'src/cache.ts'), 'export async function warmCache() { try { await Promise.resolve(); } catch {} }\n');
      await writeFile(join(checkout, 'workspace.json'), JSON.stringify({ workspace: 'portable-hook', components: { app: { root: './src' } } }));
      await writeFile(join(checkout, 'task.txt'), 'warm cache error recovery ownership');
    }
    const run = (checkout: string, output: string, extra: string[] = []) => spawnSync(process.execPath,
      [hook, '--config', join(checkout, 'workspace.json'), '--db', join(checkout, 'index.sqlite'),
        '--task', join(checkout, 'task.txt'), '--output', join(checkout, output), ...extra], { encoding: 'utf8' });
    let result = run(firstRoot, 'first.json');
    assert.equal(result.status, 0, result.stderr);
    const first = new LocalIndex(join(firstRoot, 'index.sqlite'));
    let saved: any;
    try {
      const candidate = first.backlog(200).items.find((item: any) => item.ruleId === 'TS_EMPTY_CATCH');
      assert.ok(candidate, 'The real scanner must produce the candidate; the test cannot fabricate one');
      saved = first.addReview({ candidateId: candidate.id, expectedSnapshot: first.revision(), disposition: 'COUNTEREVIDENCE',
        reason: 'Optional cache warm-up failure is an intentional fixture behavior.',
        evidence: 'Read warmCache and its empty catch; this is an observation to recheck in a new checkout.', author: 'fixture reviewer' });
      assert.equal(saved.state, 'CURRENT');
    } finally { first.close(); }
    const archive = join(root, 'reviews.json');
    result = spawnSync(process.execPath, [cli, 'review-export', '--db', join(firstRoot, 'index.sqlite'), '--output', archive], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const originalArchiveBytes = await readFile(archive);
    const originalArchive = parseReviewArchive(originalArchiveBytes);
    const originalDatabase = await readFile(join(firstRoot, 'index.sqlite'));

    result = run(secondRoot, 'root-change-rejected.json', ['--db', join(firstRoot, 'index.sqlite')]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Component root changed/);
    await assert.rejects(access(join(secondRoot, 'root-change-rejected.json')));
    assert.deepEqual(await readFile(join(firstRoot, 'index.sqlite')), originalDatabase);

    result = run(secondRoot, 'restored.json', ['--review-archive', archive]);
    assert.equal(result.status, 0, result.stderr);
    const packet = JSON.parse(await readFile(join(secondRoot, 'restored.json'), 'utf8'));
    assert.equal(packet.reviewImport.imported, 1);
    assert.equal(packet.reviewImport.total, 1);
    assert.equal(packet.reviewImport.digest, originalArchive.digest);
    assert.equal(packet.reviewImport.freshness, 'STALE_OR_SUBJECT_ABSENT');
    assert.equal(packet.sourceChanges.availability, 'UNAVAILABLE_ACROSS_INDEX_ROOTS');
    assert.equal(packet.sourceChanges.items, undefined, 'Unavailable drift must not masquerade as an empty complete change list');
    assert.equal(packet.investigation.snapshot, 1);
    assert.ok(JSON.stringify(packet.investigation).includes('ARCHIVE_RESTORE_REQUIRES_REVIEW'));

    const second = new LocalIndex(join(secondRoot, 'index.sqlite'), true);
    try {
      const restored = second.reviewHistory(saved.candidateId).items[0];
      assert.equal(restored.state, 'STALE');
      assert.equal(restored.invalidation.reason, 'ARCHIVE_RESTORE_REQUIRES_REVIEW');
      assert.deepEqual(restored.contexts, saved.contexts);
      assert.deepEqual(restored.sources, saved.sources);
      assert.deepEqual(restored.candidate, saved.candidate);
      assert.deepEqual(parseReviewArchive(second.exportReviews()).records, originalArchive.records);
      assert.notEqual(second.summary().components[0].root, saved.contexts[0].metadata.root);
    } finally { second.close(); }
    result = run(secondRoot, 'rescanned.json');
    assert.equal(result.status, 0, result.stderr);
    const rescanned = JSON.parse(await readFile(join(secondRoot, 'rescanned.json'), 'utf8'));
    assert.equal(rescanned.reviewImport, null);
    assert.equal(rescanned.investigation.snapshot, 2);
    assert.ok(JSON.stringify(rescanned.investigation).includes('ARCHIVE_RESTORE_REQUIRES_REVIEW'));
    const beforeRejectedImport = await readFile(join(secondRoot, 'index.sqlite'));
    result = run(secondRoot, 'reuse-rejected.json', ['--review-archive', archive]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /new destination database/);
    await assert.rejects(access(join(secondRoot, 'reuse-rejected.json')));
    assert.deepEqual(await readFile(join(secondRoot, 'index.sqlite')), beforeRejectedImport);
    assert.deepEqual(await readFile(join(firstRoot, 'index.sqlite')), originalDatabase);
    assert.deepEqual(await readFile(archive), originalArchiveBytes);

    const absentRoot = join(root, 'absent-checkout');
    await mkdir(join(absentRoot, 'src'), { recursive: true });
    await writeFile(join(absentRoot, 'src/cache.ts'), 'export function warmCache() { return true; }\n');
    await writeFile(join(absentRoot, 'workspace.json'), JSON.stringify({ workspace: 'portable-hook', components: { app: { root: './src' } } }));
    await writeFile(join(absentRoot, 'task.txt'), 'warm cache error recovery ownership');
    result = run(absentRoot, 'absent.json', ['--review-archive', archive]);
    assert.equal(result.status, 0, result.stderr);
    const absent = new LocalIndex(join(absentRoot, 'index.sqlite'), true);
    try {
      assert.equal(absent.reviewHistory(saved.candidateId).items[0].state, 'CANDIDATE_ABSENT');
      assert.equal(absent.backlog(200).items.some((candidate: any) => candidate.id === saved.candidateId), false,
        'Archive restoration must not manufacture the disappeared scanner candidate');
      assert.deepEqual(parseReviewArchive(absent.exportReviews()).records, originalArchive.records);
    } finally { absent.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('task-start rejects corrupt and oversized review archives before creating output or destination index', async () => {
  const root = await mkdtemp(join(tmpdir(), 'assurance-task-archive-invalid-'));
  try {
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src/worker.ts'), 'export const value = 1;\n');
    await writeFile(join(root, 'workspace.json'), JSON.stringify({ workspace: 'invalid-archive', components: { app: { root: './src' } } }));
    await writeFile(join(root, 'task.txt'), 'worker value ownership');
    for (const [name, bytes] of [['corrupt', Buffer.from('{"format":"ASSURANCE_MEMORY_LOCAL_REVIEWS"}')],
      ['oversized', Buffer.alloc(LOCAL_REVIEW_ARCHIVE_LIMITS.bytes + 1)]] as const) {
      const archive = join(root, `${name}.json`), db = join(root, `${name}.sqlite`), output = join(root, `${name}-packet.json`);
      await writeFile(archive, bytes);
      const result = spawnSync(process.execPath, [hook, '--config', join(root, 'workspace.json'), '--db', db,
        '--task', join(root, 'task.txt'), '--review-archive', archive, '--output', output], { encoding: 'utf8' });
      assert.notEqual(result.status, 0);
      await assert.rejects(access(db));
      await assert.rejects(access(`${db}-wal`));
      await assert.rejects(access(`${db}-shm`));
      await assert.rejects(access(output));
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});


test('candidate-free source reasoning survives task handoff and requires explicit review at the new checkout', async () => {
  const root = await mkdtemp(join(tmpdir(), 'assurance-source-handoff-'));
  const handoff = fileURLToPath(new URL('../../../../scripts/task-handoff.mjs', import.meta.url));
  try {
    const oldRoot = join(root, 'old'), newRoot = join(root, 'new');
    for (const checkout of [oldRoot, newRoot]) {
      await mkdir(join(checkout, 'src'), { recursive: true });
      await writeFile(join(checkout, 'src/policy.ts'), 'export function displayKey(value: string) { return value; }\n');
      await writeFile(join(checkout, 'workspace.json'), JSON.stringify({ workspace: 'source-handoff', components: { app: { root: './src' } } }));
      await writeFile(join(checkout, 'task.txt'), 'Investigate displayKey case preservation');
    }
    const run = (checkout: string, output: string, extra: string[] = []) => spawnSync(process.execPath,
      [hook, '--config', join(checkout, 'workspace.json'), '--db', join(checkout, 'index.sqlite'),
        '--task', join(checkout, 'task.txt'), '--output', join(checkout, output), ...extra], { encoding: 'utf8' });
    assert.equal(run(oldRoot, 'initial.json').status, 0);
    const sourceId = subjectId('app', 'policy.ts#displayKey');
    const note = { sourceId, disposition: 'COUNTEREVIDENCE' as const, author: 'fixture reviewer',
      reason: 'Display identity deliberately preserves case.', evidence: 'Read displayKey; lowercasing would merge distinct display names.' };
    const prior = new LocalIndex(join(oldRoot, 'index.sqlite'));
    try {
      assert.equal(prior.backlog().items.length, 0);
      prior.addReview({ ...note, expectedSnapshot: prior.revision() });
    } finally { prior.close(); }
    const archive = join(root, 'source-reviews.json');
    const exported = spawnSync(process.execPath, [handoff, '--db', join(oldRoot, 'index.sqlite'), '--output', archive, '--quiescent'], { encoding: 'utf8' });
    assert.equal(exported.status, 0, exported.stderr);
    assert.equal(JSON.parse(exported.stdout).records, 1);
    const restored = run(newRoot, 'restored.json', ['--review-archive', archive]);
    assert.equal(restored.status, 0, restored.stderr);
    const packet = JSON.parse(await readFile(join(newRoot, 'restored.json'), 'utf8'));
    assert.equal(packet.reviewImport.freshness, 'STALE_OR_SUBJECT_ABSENT');
    const summaries = (value: any) => value.investigation.entries.flatMap((entry: any) => entry.sourceReviews ?? []);
    assert.ok(summaries(packet).some((review: any) => review.sourceId === sourceId && review.state === 'STALE'));
    const current = new LocalIndex(join(newRoot, 'index.sqlite'));
    try {
      assert.equal(current.backlog().items.length, 0);
      current.addReview({ ...note, expectedSnapshot: current.revision(), author: 'explicit re-review' });
    } finally { current.close(); }
    assert.equal(run(newRoot, 'reviewed.json').status, 0);
    assert.ok(summaries(JSON.parse(await readFile(join(newRoot, 'reviewed.json'), 'utf8')))
      .some((review: any) => review.sourceId === sourceId && review.state === 'CURRENT'));
    await writeFile(join(newRoot, 'src/policy.ts'), 'export function displayKey(value: string) { return value.toLowerCase(); }\n');
    assert.equal(run(newRoot, 'changed.json').status, 0);
    assert.ok(summaries(JSON.parse(await readFile(join(newRoot, 'changed.json'), 'utf8')))
      .some((review: any) => review.sourceId === sourceId && review.state === 'STALE'));
  } finally { await rm(root, { recursive: true, force: true }); }
});


test('task packets reject index and sidecar output aliases before SQLite can replace the reserved file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'assurance-packet-alias-'));
  try {
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src/policy.ts'), 'export const flag = true;');
    await writeFile(join(root, 'workspace.json'), JSON.stringify({ workspace: 'packet-alias', components: { app: { root: './src' } } }));
    await writeFile(join(root, 'task.txt'), 'policy flag');
    await symlink(root, join(root, 'alias'));
    const db = join(root, 'index.sqlite');
    for (const suffix of ['', '-wal', '-shm']) {
      const result = spawnSync(process.execPath, [hook, '--config', join(root, 'workspace.json'), '--db', db,
        '--task', join(root, 'task.txt'), '--output', join(root, 'alias', 'index.sqlite' + suffix)], { encoding: 'utf8' });
      assert.notEqual(result.status, 0); assert.match(result.stderr, /separate from the index/);
      for (const sidecar of ['', '-wal', '-shm']) await assert.rejects(access(db + sidecar));
    }
    const nested = spawnSync(process.execPath, [hook, '--config', join(root, 'workspace.json'),
      '--db', join(root, 'new/cache/index.sqlite'), '--task', join(root, 'task.txt'),
      '--output', join(root, 'packet.json')], { encoding: 'utf8' });
    assert.equal(nested.status, 0, nested.stderr);
    assert.equal(JSON.parse(await readFile(join(root, 'packet.json'), 'utf8')).investigation.snapshot, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
