#!/usr/bin/env node
// Export a quiescent task index without SQLite touching its original WAL/SHM.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, existsSync, realpathSync } from 'node:fs';
import { chmod, copyFile, link, lstat, mkdtemp, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { LOCAL_REVIEW_ARCHIVE_LIMITS, parseReviewArchive } from '../packages/agent/dist/src/local-review-archive.js';

const cli = fileURLToPath(new URL('../packages/agent/dist/src/local-cli.js', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function fingerprint(path) {
  let metadata;
  try { metadata = await lstat(path); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`Expected a regular file without a symlink: ${path}`);
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    if (!before.isFile() || before.ino !== metadata.ino || before.dev !== metadata.dev)
      throw new Error('Input changed while opening; close all writers before exporting');
    const digest = createHash('sha256');
    const buffer = Buffer.alloc(1024 * 1024);
    let bytes = 0;
    while (true) {
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      digest.update(buffer.subarray(0, bytesRead)); bytes += bytesRead;
    }
    const after = await file.stat();
    if (before.size !== after.size || bytes !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs)
      throw new Error('Input changed while reading; close all writers before exporting');
    return { sha256: digest.digest('hex'), bytes, device: before.dev, inode: before.ino,
      modifiedMs: before.mtimeMs, changedMs: before.ctimeMs };
  } finally { await file.close(); }
}

async function indexFiles(database) {
  const result = {};
  for (const suffix of ['', '-wal', '-shm']) result[suffix] = await fingerprint(database + suffix);
  if (!result['']) throw new Error('Index does not exist');
  return result;
}

async function boundedArchive(path) {
  try {
    if ((await lstat(path)).size > LOCAL_REVIEW_ARCHIVE_LIMITS.bytes)
      throw new Error('Review archive exceeds the complete archive byte limit');
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const info = await fingerprint(path);
  if (!info) return null;
  if (info.bytes > LOCAL_REVIEW_ARCHIVE_LIMITS.bytes) throw new Error('Review archive exceeds the complete archive byte limit');
  const bytes = await readFile(path);
  if (bytes.length !== info.bytes || hash(bytes) !== info.sha256) throw new Error('Archive changed while reading');
  return { info, bytes, parsed: parseReviewArchive(bytes) };
}

export async function taskHandoff(options) {
  if (!options.db || !options.output) throw new Error('--db and --output are required');
  if (options.quiescent !== true) throw new Error('--quiescent is required: close every index connection and stop concurrent index/output writers first');
  if (options.replace !== undefined && typeof options.replace !== 'boolean') throw new Error('--replace must be a boolean');
  const database = resolve(options.db);
  const output = join(await realpath(dirname(resolve(options.output))), basename(options.output));
  const inputParent = await realpath(dirname(database));
  if (['', '-wal', '-shm'].some(suffix => output === join(inputParent, basename(database) + suffix)))
    throw new Error('Archive output must be separate from the index and its sidecars');
  let existing = null;
  try {
    await lstat(output);
    if (!options.replace) throw new Error('Output already exists; select a new path or explicitly use --replace');
    existing = (await boundedArchive(output))?.info ?? null; // Replacement applies only to an actual complete archive.
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const started = performance.now();
  const before = await indexFiles(database);
  const scratch = await mkdtemp(join(dirname(output), '.assurance-handoff-'));
  const snapshot = join(scratch, 'index.sqlite'), prepared = join(scratch, 'reviews.json');
  const phaseMs = {};
  try {
    let phase = performance.now();
    for (const [suffix, info] of Object.entries(before)) if (info) {
      await copyFile(database + suffix, snapshot + suffix, constants.COPYFILE_FICLONE);
      const copied = await fingerprint(snapshot + suffix);
      if (copied?.sha256 !== info.sha256 || copied.bytes !== info.bytes) throw new Error('Copied index differs from its captured input');
    }
    phaseMs.copy = performance.now() - phase;
    if (JSON.stringify(await indexFiles(database)) !== JSON.stringify(before)) throw new Error('Original index changed during snapshot copy');
    phase = performance.now();
    execFileSync(process.execPath, [cli, 'review-export', '--db', snapshot, '--output', prepared], {
      encoding: 'utf8', timeout: 120_000, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const archive = await boundedArchive(prepared);
    if (!archive) throw new Error('Review export did not create an archive');
    phaseMs.export = performance.now() - phase;
    phase = performance.now();
    if (JSON.stringify(await indexFiles(database)) !== JSON.stringify(before)) throw new Error('Original index changed during export');
    if (JSON.stringify(await fingerprint(output)) !== JSON.stringify(existing)) throw new Error('Output changed during export; preserve it and retry with a new path');
    await chmod(prepared, 0o600);
    const file = await open(prepared, 'r');
    try { await file.sync(); } finally { await file.close(); }
    // A new archive is exclusively linked. Explicit replacement is atomic for
    // the sole output owner; this is not a compare-and-swap for concurrent writers.
    if (existing) await rename(prepared, output);
    else await link(prepared, output);
    phaseMs.verifyAndPublish = performance.now() - phase;
    return { output, sha256: archive.info.sha256, bytes: archive.info.bytes, records: archive.parsed.records.length,
      source: archive.parsed.source, originalIndexUnchanged: true,
      indexInputs: Object.fromEntries(Object.entries(before).map(([suffix, value]) => [suffix, value ? { sha256: value.sha256, bytes: value.bytes } : null])),
      preparation: { elapsedMs: performance.now() - started, phaseMs },
      authority: 'USER_REPORTED_LOCAL_ANNOTATION', restoration: 'REQUIRES_REVIEW',
      limitations: ['Requires closed index connections and no concurrent index/output writers; not an online backup.',
        'Hash checks detect observed changes but cannot make concurrent file copying transactionally consistent.',
        'Archives retain originating observations; they do not preserve the full source/drift database or establish current applicability.'] };
  } finally { await rm(scratch, { recursive: true, force: true }); }
}

if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    const { values } = parseArgs({ options: { db: { type: 'string' }, output: { type: 'string' },
      quiescent: { type: 'boolean' }, replace: { type: 'boolean' } } });
    process.stdout.write(JSON.stringify(await taskHandoff(values)) + '\n');
  } catch (error) {
    process.stderr.write(`Task handoff failed: ${error.message}\n`); process.exitCode = 1;
  }
}
