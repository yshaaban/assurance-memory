#!/usr/bin/env node
// Reproduce the bounded, warm in-memory source-review read workload from ADR 005.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { LocalIndex } from '../packages/agent/dist/src/local-index.js';
import { sha256, subjectId } from '../packages/agent/dist/src/util.js';

const subjects = 1200, records = 3600, samples = 200, warmupReads = 20, pageLimit = 20;

function sample(operation) {
  for (let i = 0; i < warmupReads; i++) operation();
  const elapsed = [];
  for (let i = 0; i < samples; i++) {
    const started = performance.now();
    operation();
    elapsed.push(performance.now() - started);
  }
  elapsed.sort((a, b) => a - b);
  // Preserve the original diagnostic's upper-middle and p95 order statistics.
  return { samples, warmupReads, medianMs: elapsed[Math.floor(samples / 2)],
    p95Ms: elapsed[Math.floor(samples * 0.95)] };
}

const started = performance.now();
const memoryBefore = process.memoryUsage();
const index = new LocalIndex(':memory:');
try {
  const facts = Array.from({ length: subjects }, (_, n) => ({
    id: subjectId('app', `owner-${n}.ts#file`), path: `owner-${n}.ts`, locator: `owner-${n}.ts#file`,
    kind: 'FILE', language: 'TS', contentHash: sha256(String(n)), signatureHash: sha256('s'),
    tags: [], effects: n ? [`IMPORT:owner-${n - 1}.ts`] : [], line: 1, metrics: { lines: 1 },
  }));
  index.begin('observation-perf', {});
  index.ingest('app', '/fixture', { facts, findings: [], rulesExecuted: [], analyzer: 'fixture',
    sourceRevision: 'fixed', configurationDigest: 'fixed', environment: {},
    coverage: { discovery: 'COMPLETE', semantic: 'RESOLVED', limitations: [] } });
  index.commit(['app']);
  const selectedId = facts[600].id;
  const sourceContextBeforeNotes = sample(() => index.context(selectedId, pageLimit));
  const appendStarted = performance.now();
  for (let n = 0; n < records; n++) {
    index.addReview({ sourceId: facts[n % facts.length].id, expectedSnapshot: 1,
      disposition: 'COUNTEREVIDENCE', author: 'benchmark', reason: 'Read the exact implementation',
      evidence: 'Synthetic observation; no product behavior established' });
  }
  const appendMs = performance.now() - appendStarted;
  assert.equal(index.reviewRevision(), records);
  assert.equal(index.reviewHistory(selectedId, pageLimit, undefined, 'SOURCE').items.length, 3);
  assert.equal(index.context(selectedId, pageLimit).sourceReview.state, 'CURRENT');
  const sourceContextAfterNotes = sample(() => index.context(selectedId, pageLimit));
  const sourceHistoryPage20 = sample(() => index.reviewHistory(selectedId, pageLimit, undefined, 'SOURCE'));
  const memoryAfter = process.memoryUsage();
  const elapsedMs = performance.now() - started;
  process.stdout.write(JSON.stringify({ benchmark: 'SOURCE_OBSERVATION_READS', runtime: process.version,
    platform: process.platform, architecture: process.arch, subjects, records, recordsPerOwner: 3, pageLimit,
    appendMs, elapsedMs, sourceContextBeforeNotes, sourceContextAfterNotes, sourceHistoryPage20,
    processMemoryBytes: { before: memoryBefore, after: memoryAfter },
    limits: [
      'Warm in-memory synthetic workload on one process; no production capacity, cold-storage latency or agent efficacy claim.',
      'History page limit is 20 but this fixture contains only three notes per owner.',
      'Memory values are process-wide snapshots, not peak memory or allocations attributable solely to reviews.',
      'Shared-host activity, runtime, warmup and garbage collection can change measurements; no latency threshold is asserted.',
      'Order statistics match the original probe: sorted values[floor(samples/2)] and values[floor(samples*0.95)].',
    ],
  }) + '\n');
} finally { index.close(); }
