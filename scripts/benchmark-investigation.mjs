import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalIndex } from '../packages/agent/dist/src/local-index.js';
import { localQuery } from '../packages/agent/dist/src/local-query.js';
import { sha256, subjectId } from '../packages/agent/dist/src/util.js';

// One bounded workload per process keeps the process-wide RSS measurement interpretable.
const presets = {
  small: { facts: 2000, degree: 250, reviews: 100 },
  larger: { facts: 20000, degree: 2000, reviews: 500 },
};
const selected = process.argv[2] ?? 'small';
if (process.argv.length > 3 || !Object.hasOwn(presets, selected))
  throw new Error('Usage: node scripts/benchmark-investigation.mjs [small|larger]');
const workload = presets[selected];
const directory = await mkdtemp(join(tmpdir(), 'assurance-investigation-scale-'));
const database = join(directory, 'source.sqlite');
const restoredDatabase = join(directory, 'restored.sqlite');
const index = new LocalIndex(database);
let restored;
let sourceClosed = false;
let restoreClosed = false;
const round = value => Math.round(value * 1000) / 1000;
const measure = action => {
  const start = performance.now();
  const value = action();
  return { value, ms: round(performance.now() - start) };
};
const quantiles = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return { samples: sorted.length, min: round(sorted[0]), p50: round(sorted[Math.ceil(sorted.length * .5) - 1]),
    p95: round(sorted[Math.ceil(sorted.length * .95) - 1]), max: round(sorted.at(-1)) };
};
const component = 'synthetic';
const ownerPath = 'requestLifecycle.ts';
const file = (path, extra = {}) => {
  const locator = `${path}#file`;
  return { id: subjectId(component, locator), locator, path, language: 'TS', kind: 'FILE',
    contentHash: sha256(path), signatureHash: sha256('signature'), tags: ['all', 'files', 'request', 'cancel', 'lifecycle'],
    effects: [], metrics: { lines: 20 }, line: 1, ...extra };
};

try {
  const generated = measure(() => {
    const owner = file(ownerPath, { locator: `${ownerPath}#manageRequestLifecycle`,
      id: subjectId(component, `${ownerPath}#manageRequestLifecycle`), kind: 'FUNCTION', effects: ['CANCEL_REQUEST'] });
    const facts = [file(ownerPath), owner, ...Array.from({ length: workload.facts - 2 }, (_, i) =>
      file(`request/module${String(i).padStart(5, '0')}.ts`, { effects: i < workload.degree ? [`IMPORT:${ownerPath}`] : [] }))];
    const findings = facts.filter((fact, i) => i === 1 || i > 1 && i % 5 === 0).map(fact => ({
      subjectId: fact.id, ruleId: 'TS_EMPTY_CATCH', severity: 'HIGH', line: 1,
      message: 'Synthetic candidate: inspect request cancellation assumptions before proposing a change.',
    }));
    return { facts, findings, owner, candidateId: sha256(`${owner.id}:TS_EMPTY_CATCH`) };
  });
  const { facts, findings, owner, candidateId } = generated.value;
  const scan = incoming => ({ facts: incoming, findings, rulesExecuted: ['TS_EMPTY_CATCH'], analyzer: 'synthetic-investigation-1',
    // Deliberately fixed context isolates fact/dependency invalidation from revision-wide invalidation.
    sourceRevision: 'synthetic-fixed', configurationDigest: 'synthetic-fixed', environment: {},
    coverage: { discovery: 'COMPLETE', semantic: 'RESOLVED', limitations: [] } });
  const phases = [];
  const publish = (target, phase, incoming, retainedReviews) => {
    const begin = measure(() => target.begin('synthetic-investigation', {}));
    const projection = measure(() => target.ingest(component, '/synthetic', scan(incoming)));
    const commit = measure(() => target.commit([component]));
    const result = { phase, retainedReviews, beginMs: begin.ms, projectionMs: projection.ms,
      reconciliationAndCommitMs: commit.ms, counts: projection.value };
    if (target === index) phases.push(result);
    assert.equal(target.summary().facts, workload.facts);
    return result;
  };
  const changedCount = result => result.counts.added + result.counts.changed + result.counts.removed;
  assert.equal(changedCount(publish(index, 'initial', facts, 0)), workload.facts);
  assert.equal(changedCount(publish(index, 'unchanged-no-reviews', facts, 0)), 0);

  const queryRuns = [];
  function query(phase) {
    for (const [taskKind, task, limit, maxBytes] of [
      ['broad-minimum-budget', 'request cancellation lifecycle', 20, 4096],
      ['broad-default-budget', 'request cancellation lifecycle', 5, 24000],
      ['broad-maximum-budget', 'request cancellation lifecycle', 20, 128000],
      ['owner', 'manageRequestLifecycle', 1, 24000],
    ]) {
      const durations = [], sizes = [], entries = [];
      for (let i = 0; i < 20; i++) {
        const measured = measure(() => localQuery(index, 'investigate', { task, limit, maxBytes }));
        const result = measured.value;
        const bytes = Buffer.byteLength(JSON.stringify(result));
        assert.equal(result.authority, 'LOCAL_INVESTIGATION_ONLY');
        assert.equal(result.budget.responseBytes, bytes);
        assert.ok(bytes <= maxBytes, 'JSON response exceeded its byte budget');
        assert.ok(result.entries.length <= limit);
        if (taskKind.startsWith('broad')) {
          assert.equal(result.retrieval.candidatePoolTruncated, true);
          assert.equal(result.truncated, true);
        } else {
          assert.equal(result.entries.length, 1);
          assert.equal(result.entries[0].source.id, owner.id);
          assert.ok(result.entries[0].candidates.some(candidate => candidate.id === candidateId));
        }
        durations.push(measured.ms); sizes.push(bytes); entries.push(result.entries.length);
      }
      queryRuns.push({ phase, taskKind, limit, maxBytes, durationMs: quantiles(durations),
        responseBytes: { min: Math.min(...sizes), max: Math.max(...sizes) },
        entries: { min: Math.min(...entries), max: Math.max(...entries) } });
    }
  }
  query('no-reviews');
  const appendMs = [];
  for (let i = 0; i < workload.reviews; i++) {
    const appended = measure(() => index.addReview({ candidateId, expectedSnapshot: index.revision(),
      disposition: 'COUNTEREVIDENCE', reason: `Synthetic retained review ${i + 1}; validate cancellation ownership.`,
      evidence: 'Synthetic observation only; intentional cancellation still requires source and behavior inspection.', author: 'synthetic-reviewer' }));
    assert.equal(appended.value.state, 'CURRENT');
    assert.equal(appended.value.sources[0].dependencyCount, workload.degree);
    appendMs.push(appended.ms);
  }
  const currentCandidate = () => index.context(owner.id, 20).opportunities.find(candidate => candidate.id === candidateId);
  assert.equal(currentCandidate().score, 60);
  const latestReviewId = currentCandidate().review.id;
  for (const phase of ['unchanged-with-reviews-1', 'unchanged-with-reviews-2']) {
    assert.equal(changedCount(publish(index, phase, facts, workload.reviews)), 0);
    assert.equal(currentCandidate().review.state, 'CURRENT');
    assert.equal(currentCandidate().review.id, latestReviewId);
  }
  query('retained-current-reviews');

  // Export while notes are CURRENT: restore must still require a fresh local review.
  const exported = measure(() => index.exportReviews());
  const archive = JSON.parse(exported.value);
  assert.equal(archive.records.length, workload.reviews);
  assert.ok(archive.records.every(entry => entry.record.note.invalidation === null));
  const reviewRevisionBeforeChange = index.reviewRevision();

  // Change the last dependency in the review store's ID order, beyond its 200-row page.
  const farDependency = facts.slice(2, workload.degree + 2).sort((a, b) => a.id.localeCompare(b.id)).at(-1);
  const changed = facts.map(fact => fact.id === farDependency.id ? { ...fact, contentHash: sha256('changed-dependency') } : fact);
  assert.equal(changedCount(publish(index, 'dependency-change-beyond-first-page', changed, workload.reviews)), 1);
  assert.equal(currentCandidate().review.state, 'STALE');
  assert.equal(currentCandidate().score, 80);
  assert.equal(index.reviewRevision(), reviewRevisionBeforeChange + workload.reviews);
  assert.equal(changedCount(publish(index, 'dependency-revert', facts, workload.reviews)), 1);
  assert.equal(currentCandidate().review.state, 'STALE');
  assert.equal(currentCandidate().review.id, latestReviewId);
  assert.equal(currentCandidate().score, 80);
  query('retained-stale-reviews');

  const staleExported = measure(() => index.exportReviews());
  const staleArchive = JSON.parse(staleExported.value);
  assert.equal(staleArchive.records.length, workload.reviews);
  assert.ok(staleArchive.records.every(entry => entry.record.note.invalidation !== null));
  restored = new LocalIndex(restoredDatabase);
  const restoredProjection = publish(restored, 'restore-source-scan', facts, 0);
  const imported = measure(() => restored.importReviews(exported.value));
  assert.equal(imported.value.imported, workload.reviews);
  assert.equal(imported.value.skipped, 0);
  const repeated = measure(() => restored.importReviews(exported.value));
  assert.equal(repeated.value.imported, 0);
  assert.equal(repeated.value.skipped, workload.reviews);
  assert.equal(repeated.value.reviewRevision, imported.value.reviewRevision);
  const afterRestore = restored.context(owner.id, 20).opportunities.find(candidate => candidate.id === candidateId);
  assert.equal(afterRestore.score, 80);
  assert.equal(afterRestore.review.state, 'STALE');
  const history = [];
  let cursor;
  do {
    const page = localQuery(restored, 'reviews', { id: candidateId, limit: 200, ...(cursor ? { after: cursor } : {}) });
    history.push(...page.items);
    cursor = page.next;
  } while (cursor);
  assert.equal(history.length, workload.reviews);
  assert.equal(new Set(history.map(review => review.id)).size, workload.reviews);
  assert.ok(history.every(review => review.state === 'STALE' && review.invalidation.reason === 'ARCHIVE_RESTORE_REQUIRES_REVIEW'));
  const reexport = measure(() => restored.exportReviews());
  assert.deepEqual(JSON.parse(reexport.value).records.map(entry => entry.digest), archive.records.map(entry => entry.digest));
  index.close(); sourceClosed = true;
  restored.close(); restoreClosed = true;
  console.log(JSON.stringify({
    scope: 'Bounded synthetic local investigation diagnostics. Excludes compiler extraction, remote service and agent outcomes. Timings are not capacity guarantees.',
    workload: { preset: selected, ...workload, candidates: findings.length, components: 1, querySamplesPerCase: 20,
      dependencyDirection: 'incoming', retainedReviewCandidateCount: 1 },
    node: process.version, platform: `${process.platform}/${process.arch}`, fixtureGenerationMs: generated.ms,
    scanPhases: phases, reviewAppendMs: { total: round(appendMs.reduce((sum, value) => sum + value, 0)), ...quantiles(appendMs) },
    queryRuns, archive: { records: workload.reviews, bytes: Buffer.byteLength(exported.value), exportMs: exported.ms,
      sourceProjectionMs: restoredProjection.projectionMs, sourceCommitMs: restoredProjection.reconciliationAndCommitMs,
      staleExportMs: staleExported.ms, importMs: imported.ms, repeatImportMs: repeated.ms, reexportMs: reexport.ms,
      imported: imported.value.imported, repeatSkipped: repeated.value.skipped },
    databaseBytes: (await stat(database)).size, restoredDatabaseBytes: (await stat(restoredDatabase)).size,
    peakRssBytes: process.resourceUsage().maxRSS * 1024,
    correctness: { unchangedDriftZero: true, farDependencyInvalidates: true, revertRemainsStale: true,
      currentCounterevidenceDiscountOnly: true, boundedJsonBytes: true, broadPoolTruncationDisclosed: true,
      completeHistoryRestore: true, repeatImportIdempotent: true, restoredReviewsStale: true, originalRecordDigestsPreserved: true },
  }, null, 2));
} finally {
  if (!sourceClosed) index.close();
  if (restored && !restoreClosed) restored.close();
  await rm(directory, { recursive: true, force: true });
}
