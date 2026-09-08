#!/usr/bin/env node
// A local deterministic retrieval comparison. No model requests or application worktrees.
import { readFile, readdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join, dirname, resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { LocalIndex } from '../../packages/agent/dist/src/local-index.js';
import { localQuery } from '../../packages/agent/dist/src/local-query.js';
import { searchTerms } from '../../packages/agent/dist/src/local-search.js';
import { investigate as previous } from './baseline-1.4.mjs';
import { taskContext } from '../task-context.mjs';

const toolRoot = dirname(fileURLToPath(import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const args = process.argv.slice(2);
const root = args[4] === '--corpus' && args[5] ? resolve(args[5]) : toolRoot;
if (![4, 6].includes(args.length) || (args.length === 6 && args[4] !== '--corpus') || args[0] !== '--split' || !['development', 'held-out'].includes(args[1]) || args[2] !== '--output')
  throw new Error('Usage: node scripts/relevance/run.mjs --split development|held-out --output NEW_FILE.json [--corpus DIR]');
const split = args[1], output = resolve(args[3]);
const freeze = JSON.parse(await readFile(join(root, 'freeze.json'), 'utf8'));
for (const [path, expected] of Object.entries(freeze.files))
  if (hash(await readFile(join(root, path))) !== expected) throw new Error(`Frozen input changed: ${path}`);
const tasks = JSON.parse(await readFile(join(root, `${split}.json`), 'utf8'));
const reserved = await import('node:fs/promises').then(fs => fs.open(output, 'wx', 0o600));
const scratch = await mkdtemp(join(tmpdir(), 'assurance-relevance-'));
const fixture = join(root, 'fixture');
const { limit, maxBytes, latencyRepetitions } = freeze.protocol;
const words = new Set('a an and are as at be been being but by can could did do does for from had has have how i if in into is it its me my of on or our should so than that the their them then there these they this to us was we were what when where which while who why will with would you your'.split(' '));
const bytes = value => Buffer.byteLength(JSON.stringify(value));
const quantile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];
const sourceBearing = brief => brief.entries.flatMap(entry => [entry.source, ...(entry.matches ?? []), ...(entry.owners ?? []), ...(entry.nearbySymbols ?? [])]);

function ordinary(task) {
  const terms = searchTerms(task).filter(term => !words.has(term));
  let raw = '';
  if (terms.length) {
    try { raw = execFileSync('rg', ['--json', '--sort', 'path', '-i', '-C', '2', '-e', terms.join('|'), '--', '.'],
      { cwd: fixture, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }); }
    catch (error) { if (error.status !== 1) throw error; }
  }
  const files = new Map();
  for (const line of raw.trim().split('\n').filter(Boolean)) {
    const event = JSON.parse(line);
    if (!['match', 'context'].includes(event.type)) continue;
    const path = event.data.path.text.replace(/^\.\//, '');
    const entry = files.get(path) ?? { path, lines: [] };
    entry.lines.push({ line: event.data.line_number, text: event.data.lines.text }); files.set(path, entry);
  }
  const response = { method: 'ordinary-rg', terms, entries: [], omittedPaths: [], truncated: files.size > limit };
  for (const entry of [...files.values()].slice(0, limit)) {
    response.entries.push(entry);
    if (bytes(response) + limit * 200 > maxBytes) { response.entries.pop(); response.omittedPaths.push(entry.path); response.truncated = true; }
  }
  return response;
}

function score(task, response, facts) {
  const ordinary = response.method === 'ordinary-rg';
  const shown = ordinary ? facts.filter(fact => response.entries.some(entry => entry.path === fact.path
    && entry.lines.some(line => line.line === fact.line) && entry.lines.some(line => line.line === fact.line + 1))) : sourceBearing(response);
  const locators = new Set(shown.map(fact => fact.locator));
  const groups = kind => ({ hit: task[kind].filter(group => group.some(locator => locators.has(locator))).length, total: task[kind].length });
  const relevant = new Set([...task.owners, ...task.consumers, ...task.counterexamples].flat().map(locator => locator.split('#')[0]));
  for (const path of task.acceptable ?? []) relevant.add(path);
  const irrelevant = response.entries.filter(entry => !relevant.has(entry.path));
  return { owners: groups('owners'), consumers: groups('consumers'), counterexamples: groups('counterexamples'),
    returnedEntries: response.entries.length, irrelevantEntries: irrelevant.length,
    irrelevantEntryBytes: irrelevant.reduce((sum, entry) => sum + bytes(entry), 0),
    briefBytes: bytes(response), truncated: response.truncated,
    substantiveLocators: [...locators].sort(), paths: response.entries.map(entry => entry.path) };
}

try {
  const config = join(scratch, 'workspace.json');
  await writeFile(config, JSON.stringify({ workspace: 'public-relevance', components: { fixture: { root: fixture } } }));
  const rows = [];
  for (const task of tasks) {
    const taskPath = join(scratch, `${task.id}.txt`), db = join(scratch, `${task.id}.sqlite`);
    await writeFile(taskPath, task.task);
    const packet = await taskContext({ config, db, task: taskPath, output: join(scratch, `${task.id}.packet.json`), limit, 'max-bytes': maxBytes });
    const index = new LocalIndex(db, true);
    try {
      // Exact source locators, never filenames in scan coverage warnings.
      const facts = [];
      const walk = async directory => {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          const path = join(directory, entry.name);
          if (entry.isDirectory()) await walk(path);
          else {
            const relativePath = relative(fixture, path).split('\\').join('/');
            for (const line of (await readFile(path, 'utf8')).split('\n').entries()) {
              const name = line[1].match(/^export function ([A-Za-z0-9_]+)/)?.[1];
              if (name) facts.push({ locator: `${relativePath}#${name}`, path: relativePath, line: line[0] + 1 });
            }
          }
        }
      };
      await walk(fixture);
      const methods = {
        previous: () => index.read(() => previous(index, task.task, limit, maxBytes)),
        current: () => localQuery(index, 'investigate', { task: task.task, limit, maxBytes }),
        ordinary: () => ordinary(task.task),
      };
      const measurements = Object.fromEntries(Object.keys(methods).map(name => [name, []]));
      const responses = {};
      // Rotate order to reduce systematic first-method cache bias. Warm queries include serialization, not indexing.
      for (let repetition = 0; repetition < latencyRepetitions; repetition++) {
        const names = Object.keys(methods);
        for (let offset = 0; offset < names.length; offset++) {
          const name = names[(offset + repetition) % names.length];
          const start = performance.now(); const response = methods[name](); JSON.stringify(response);
          measurements[name].push(performance.now() - start); responses[name] = response;
        }
      }
      rows.push({ id: task.id, ambiguous: !!task.ambiguous, preparationMs: packet.preparation.elapsedMs,
        methods: Object.fromEntries(Object.entries(responses).map(([name, response]) => [name, {
          ...score(task, response, facts), packetBytes: bytes({ ...packet, investigation: response }) + 1,
          queryMs: measurements[name], medianQueryMs: quantile(measurements[name], .5), p95QueryMs: quantile(measurements[name], .95),
        }])) });
    } finally { index.close(); }
  }
  const totals = Object.fromEntries(['previous', 'current', 'ordinary'].map(name => {
    const values = rows.map(row => row.methods[name]);
    const sum = key => values.reduce((total, value) => total + value[key], 0);
    return [name, { owners: values.reduce((r, v) => ({ hit: r.hit + v.owners.hit, total: r.total + v.owners.total }), { hit: 0, total: 0 }),
      consumers: values.reduce((r, v) => ({ hit: r.hit + v.consumers.hit, total: r.total + v.consumers.total }), { hit: 0, total: 0 }),
      counterexamples: values.reduce((r, v) => ({ hit: r.hit + v.counterexamples.hit, total: r.total + v.counterexamples.total }), { hit: 0, total: 0 }),
      returnedEntries: sum('returnedEntries'), irrelevantEntries: sum('irrelevantEntries'), irrelevantEntryBytes: sum('irrelevantEntryBytes'),
      briefBytes: sum('briefBytes'), packetBytes: sum('packetBytes'),
      medianQueryMs: quantile(values.flatMap(value => value.queryMs), .5), p95QueryMs: quantile(values.flatMap(value => value.queryMs), .95) }];
  }));
  const report = { schemaVersion: 1, split, measuredAt: new Date().toISOString(), freezeSha256: hash(await readFile(join(root, 'freeze.json'))),
    implementationSha256: hash(await readFile(join(toolRoot, '../../packages/agent/dist/src/local-investigate.js'))),
    runtime: { node: process.version, platform: process.platform, arch: process.arch, rg: execFileSync('rg', ['--version'], { encoding: 'utf8' }).split('\n')[0] },
    protocol: freeze.protocol, rows, totals,
    limitations: ['Public authored fixture, not independently blinded task labels, production capacity or agent benefit.',
      'Complete packet bytes use each actual task-start packet with its nested response replaced for comparator arms; identical scan/provenance envelope, no notes.',
      'Preparation is measured once for the current real scan + hook per task. Warm query latency separately compares all three methods; ordinary rg needs no index.',
      'Snippet matches are retrieval opportunities, not evidence an agent substantively read or correctly used a source.',
      'Empty-label negative and ambiguous tasks remain in irrelevant-entry and byte denominators. No recall is invented for a zero-label task.'] };
  await reserved.writeFile(JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ split, output, totals }, null, 2));
} finally { await reserved.close(); await rm(scratch, { recursive: true, force: true }); }
