import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalIndex } from '../packages/agent/dist/src/local-index.js';
import { sha256, subjectId } from '../packages/agent/dist/src/util.js';
const total = Number(process.argv[2] ?? 100000);
if (!Number.isSafeInteger(total) || total < 100 || total > 1000000) throw new Error('Choose 100..1000000 facts');
const dir = await mkdtemp(join(tmpdir(), 'assurance-benchmark-'));
const path = join(dir, 'index.sqlite');
const index = new LocalIndex(path);
const components = Array.from({ length: Math.ceil(total / 10000) }, (_, i) => `component${i}`);
const timings = {};
const counts = [];
try {
  for (const phase of ['initial', 'unchanged', 'one-change']) {
    const start = performance.now();
    index.begin('synthetic-benchmark', {});
    let changes = 0;
    for (const [partition, component] of components.entries()) {
      const facts = Array.from({ length: Math.min(10000, total - partition * 10000) }, (_, i) => {
        const locator = `module${i}.ts#file`;
        return { id: subjectId(component, locator), locator, path: `module${i}.ts`, language: 'TS', kind: 'FILE',
          contentHash: sha256(`${component}:${i}:${phase === 'one-change' && partition === 0 && i === 0 ? 1 : 0}`),
          signatureHash: sha256('signature'), tags: ['all', 'files'], effects: i ? [`IMPORT:module${i-1}.ts`] : [], metrics: { lines: 30 }, line: 1 };
      });
      const result = index.ingest(component, `/synthetic/${component}`, { facts, findings: [], analyzer: 'synthetic-1',
        rulesExecuted: [], sourceRevision: phase, configurationDigest: 'config', environment: {},
        coverage: { discovery: 'COMPLETE', semantic: 'RESOLVED', limitations: [] } });
      changes += result.added + result.changed + result.removed;
    }
    index.commit(components); timings[phase] = Math.round(performance.now() - start); counts.push(changes);
  }
  if (counts[0] !== total || counts[1] !== 0 || counts[2] !== 1) throw new Error(`Incorrect drift counts: ${counts}`);
  const queryTimes = [];
  for (let i = 0; i < 100; i++) {
    const start = performance.now();
    const found = index.search(`module${i}`, 20);
    if (!found.length) throw new Error('Search missed indexed subject');
    index.context(found[0].id, 20);
    queryTimes.push(performance.now() - start);
  }
  queryTimes.sort((a,b) => a-b);
  const summary = index.summary();
  index.close();
  console.log(JSON.stringify({ workload: 'Synthetic local SQLite projection; excludes compiler extraction and remote service',
    facts: total, components: components.length, scanMs: timings, changedFactCounts: counts,
    searchPlusContextMs: { p50: queryTimes[49], p95: queryTimes[94], p99: queryTimes[98] },
    databaseBytes: (await stat(path)).size, peakRssBytes: process.resourceUsage().maxRSS * 1024,
    node: process.version, platform: `${process.platform}/${process.arch}`, observedFacts: summary.facts }, null, 2));
} finally { await rm(dir, { recursive: true, force: true }); }
