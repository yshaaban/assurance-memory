import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { LocalIndex } from '../src/local-index.js';
import { lifecycleCheckerDigest } from '../src/lifecycle-lab.js';
import { sha256, subjectId } from '../src/util.js';

const example = resolve('examples/lifecycle-lab/reuse.mjs');
const { runLifecycleReuseExample } = await import(pathToFileURL(example).href);

test('actual lifecycle results enter the existing review flow without reviving changed or reverted evidence', async () => {
  const result = await runLifecycleReuseExample();
  assert.equal(result.opportunityOrigin, 'MANUALLY_REGISTERED_WORKFLOW_FIXTURE_NOT_PRODUCTION_DETECTOR_OUTPUT');
  assert.equal(result.authority, 'USER_REPORTED_LOCAL_ANNOTATION');
  const stages = new Map<string, any>(result.stages.map((stage: any) => [stage.name, stage]));
  const first = stages.get('checked_and_reviewed');
  const unchanged = stages.get('unchanged_rescan');
  const changed = stages.get('captured_source_changed');
  const reverted = stages.get('source_reverted');
  const rechecked = stages.get('rechecked_without_new_review');
  const fresh = stages.get('fresh_review_appended');
  const recovered = stages.get('archive_restored');
  assert.equal(first.lifecycle.review.state, 'CURRENT');
  assert.equal(unchanged.lifecycle.review.state, 'CURRENT');
  assert.equal(unchanged.lifecycle.sourceHash, first.lifecycle.sourceHash);
  assert.equal(unchanged.reviewRevision, first.reviewRevision);
  assert.notEqual(changed.lifecycle.sourceHash, first.lifecycle.sourceHash);
  assert.equal(changed.lifecycle.review.state, 'STALE');
  assert.equal(changed.lifecycle.review.invalidation.reason, 'SOURCE_OR_CONTEXT_CHANGED');
  assert.equal(changed.lifecycle.score, first.lifecycle.score + 20);
  assert.equal(reverted.lifecycle.sourceHash, first.lifecycle.sourceHash);
  assert.equal(reverted.lifecycle.sourceRevision, first.lifecycle.sourceRevision);
  assert.equal(reverted.lifecycle.review.state, 'STALE');
  assert.equal(rechecked.lifecycle.review.state, 'STALE');
  assert.equal(rechecked.reviewRevision, reverted.reviewRevision);
  assert.equal(fresh.lifecycle.review.state, 'CURRENT');
  assert.equal(fresh.lifecycle.score, first.lifecycle.score);
  assert.notEqual(result.freshReviewId, result.firstReviewId);
  assert.equal(fresh.lifecycle.review.id, result.freshReviewId);

  const initialReport = result.reports.initial;
  assert.equal(initialReport.evidence, 'EXECUTED_IMPLEMENTATION_ADAPTER');
  assert.equal(initialReport.status, 'NO_VIOLATION_OBSERVED');
  assert.deepEqual(initialReport.finalState, { generation: 2, version: 1, value: 'replacement accepted', mutations: 3 });
  assert.ok(initialReport.verifiedSources.some((source: any) => source.role === 'MUTATION_BOUNDARY'));
  assert.equal(result.reports.changed.evidence, 'NOT_EXECUTED');
  assert.equal(result.reports.changed.status, 'UNKNOWN');
  assert.ok(result.reports.changed.gaps.some((gap: string) => gap.includes('source digest mismatch')));
  assert.equal(result.reports.rechecked.evidence, 'EXECUTED_IMPLEMENTATION_ADAPTER');
  assert.deepEqual(result.reports.rechecked.digests, initialReport.digests);
  assert.equal(result.history.length, 2);
  const oldReview = result.history.find((review: any) => review.id === result.firstReviewId);
  const newReview = result.history.find((review: any) => review.id === result.freshReviewId);
  assert.equal(oldReview.state, 'STALE');
  assert.equal(newReview.state, 'CURRENT');
  assert.deepEqual(oldReview.evidence.digests, initialReport.digests);
  assert.deepEqual(newReview.evidence.digests, result.reports.rechecked.digests);
  assert.equal(oldReview.capturedGuardHash, first.lifecycle.sourceHash);
  assert.ok(oldReview.capturedSourceCount >= new Set(initialReport.verifiedSources.map((pin: any) => pin.path)).size + 2);
  assert.deepEqual(oldReview.capturedContexts, ['lifecycle']);
  assert.equal(oldReview.capturedEnvironment.checkerImplementation, initialReport.digests.checker);
  assert.equal(oldReview.capturedEnvironment.checkerImplementation, lifecycleCheckerDigest());
  assert.equal(oldReview.capturedEnvironment.node, sha256(process.version));

  // Broad invalidation within a component is intentional; independent component
  // context remains current across the other component's change and revert.
  for (const stage of result.stages.filter((stage: any) => stage.name !== 'archive_restored')) {
    assert.equal(stage.independent.review.state, 'CURRENT');
    assert.equal(stage.independent.review.id, first.independent.review.id);
    assert.equal(stage.independent.sourceRevision, first.independent.sourceRevision);
    assert.equal(stage.independent.score, first.independent.score);
  }
  assert.equal(recovered.lifecycle.review.state, 'STALE');
  assert.equal(recovered.independent.review.state, 'STALE');
  assert.equal(recovered.lifecycle.review.invalidation.reason, 'ARCHIVE_RESTORE_REQUIRES_REVIEW');
  assert.equal(recovered.independent.review.invalidation.reason, 'ARCHIVE_RESTORE_REQUIRES_REVIEW');
  assert.equal(recovered.lifecycle.review.restored, true);
  assert.equal(result.archive.imported, 3);
  assert.equal(result.archive.originalLifecycleStateAfterRestore, 'CURRENT');
});

test('changed checker or runtime context invalidates retained lifecycle reasoning even with identical source, contract and trace', async () => {
  const exampleResult = await runLifecycleReuseExample();
  const report = exampleResult.reports.initial;
  const context = exampleResult.history.find((review: any) => review.id === exampleResult.firstReviewId).capturedEnvironment;
  const pin = report.verifiedSources.find((value: any) => value.role === 'MUTATION_BOUNDARY');
  for (const changedField of ['checkerImplementation', 'node']) {
    const index = new LocalIndex(':memory:');
    try {
      const locator = `${pin.path}#file`, id = subjectId('lifecycle', locator);
      const publish = (environment: Record<string, string>) => {
        index.begin('checker-context-workflow', {});
        index.ingest('lifecycle', '/explicit-workflow-fixture', {
          facts: [{ id, locator, path: pin.path, line: 1, kind: 'FILE', language: 'JS',
            contentHash: pin.sha256, signatureHash: sha256(locator), tags: ['tests'], effects: [], metrics: {} }],
          findings: [{ subjectId: id, ruleId: 'LIFECYCLE_LAB_WORKFLOW_FIXTURE', line: 1, severity: 'MEDIUM',
            message: 'Manual retained-review context fixture; not production detector output.' }],
          rulesExecuted: [], analyzer: 'manual-workflow-fixture/1', sourceRevision: report.digests.source,
          configurationDigest: report.digests.contract, environment,
          coverage: { discovery: 'COMPLETE', semantic: 'PARTIAL', limitations: ['Explicit frozen context input fixture.'] },
        });
        index.commit(['lifecycle']);
      };
      publish(context);
      const candidateId = index.backlog().items[0].id;
      index.addReview({ candidateId, expectedSnapshot: 1, disposition: 'COUNTEREVIDENCE', author: 'workflow reviewer',
        reason: 'Retained finite lifecycle observation under a captured checker/runtime context.', evidence: JSON.stringify(report.digests) });
      publish(context);
      assert.equal(index.backlog().items[0].review.state, 'CURRENT');
      // This is an explicitly simulated future context, not execution of a changed checker/runtime.
      publish({ ...context, [changedField]: sha256(`different frozen ${changedField} context`) });
      const stale = index.backlog().items[0].review;
      assert.equal(stale.state, 'STALE');
      assert.equal(stale.invalidation.reason, 'SOURCE_OR_CONTEXT_CHANGED');
      assert.equal(index.context(id).subject.contentHash, pin.sha256);
      assert.equal(index.context(id).component.sourceRevision, report.digests.source);
      publish(context);
      assert.equal(index.backlog().items[0].review.state, 'STALE');
      assert.deepEqual(JSON.parse(index.reviewHistory(candidateId).items[0].evidence), report.digests);
    } finally { index.close(); }
  }
});

test('the runnable reuse example emits the same explicit workflow and implementation evidence boundary', () => {
  const result = spawnSync(process.execPath, [example], { encoding: 'utf8', timeout: 15_000 });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.kind, 'SYNTHETIC_LIFECYCLE_REVIEW_WORKFLOW');
  assert.equal(output.stages.length, 7);
  assert.equal(output.stages.at(-1).name, 'archive_restored');
  assert.equal(output.reports.initial.status, 'NO_VIOLATION_OBSERVED');
  assert.equal(output.reports.changed.evidence, 'NOT_EXECUTED');
  assert.match(output.limitations.join(' '), /component sourceRevision/);
});
