import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LocalIndex } from '../../packages/agent/dist/src/local-index.js';
import { localQuery } from '../../packages/agent/dist/src/local-query.js';
import { runLifecycleLab, verifyLifecycleSources, lifecycleDigest, lifecycleCheckerDigest } from '../../packages/agent/dist/src/lifecycle-lab.js';
import { sha256, subjectId } from '../../packages/agent/dist/src/util.js';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const fixtureDirectory = 'examples/lifecycle-lab';
const guardedPath = `${fixtureDirectory}/guarded.mjs`;
const rule = 'LIFECYCLE_LAB_WORKFLOW_FIXTURE';

function observed(report) {
  return { evidence: report.evidence, status: report.conclusion.status, digests: report.digests,
    verifiedSources: report.verifiedSources, gaps: report.conclusion.gaps,
    finalState: report.observations.at(-1)?.after ?? null };
}

/** Explicit synthetic workflow example. This function is never called by a scanner. */
export async function runLifecycleReuseExample() {
  const temporary = await mkdtemp(join(tmpdir(), 'assurance-lifecycle-reuse-'));
  const lifecycleRoot = join(temporary, 'lifecycle');
  const independentRoot = join(temporary, 'independent');
  const index = new LocalIndex(':memory:');
  let restored;
  try {
    const contractsBytes = await readFile(join(repository, fixtureDirectory, 'contracts.json'));
    const contract = JSON.parse(contractsBytes).guarded;
    const paths = [...new Set([...contract.sources.map(pin => pin.path),
      `${fixtureDirectory}/contracts.json`, `${fixtureDirectory}/traces.mjs`])].sort();
    for (const path of paths) {
      await mkdir(dirname(join(lifecycleRoot, path)), { recursive: true });
      await writeFile(join(lifecycleRoot, path), await readFile(join(repository, path)));
    }
    await mkdir(independentRoot, { recursive: true });
    await writeFile(join(independentRoot, 'stable.mjs'), 'export function stableValue() { return 1; }\n');
    const sourceCheck = verifyLifecycleSources(lifecycleRoot, contract, { sourcePath: `${fixtureDirectory}/adapter.mjs` });
    if (sourceCheck.gaps.length) throw new Error(`Fixture source verification failed: ${sourceCheck.gaps.join('; ')}`);
    const { adapters } = await import(pathToFileURL(join(lifecycleRoot, fixtureDirectory, 'adapter.mjs')).href);
    const { traces } = await import(pathToFileURL(join(lifecycleRoot, fixtureDirectory, 'traces.mjs')).href);
    const { stableValue } = await import(pathToFileURL(join(independentRoot, 'stable.mjs')).href);
    const originalGuard = await readFile(join(lifecycleRoot, guardedPath), 'utf8');

    const scan = async (destination, component, root, selectedPaths, primaryPath) => {
      const facts = await Promise.all(selectedPaths.map(async path => {
        const bytes = await readFile(join(root, path));
        const locator = `${path}#file`;
        return { id: subjectId(component, locator), path, locator, line: 1,
          kind: path.endsWith('.json') ? 'CONFIG' : 'FILE', language: path.endsWith('.json') ? 'CONFIG' : 'JS',
          contentHash: sha256(bytes), signatureHash: sha256(locator), tags: ['tests'], effects: [], metrics: {} };
      }));
      const primary = facts.find(fact => fact.path === primaryPath);
      destination.ingest(component, root, {
        facts,
        findings: [{ subjectId: primary.id, ruleId: rule, line: 1, severity: 'MEDIUM',
          message: 'Manually registered lifecycle-review workflow fixture; not production detector output.' }],
        rulesExecuted: [], analyzer: 'manual-workflow-fixture/1',
        sourceRevision: lifecycleDigest(facts.map(fact => ({ path: fact.path, sha256: fact.contentHash }))),
        configurationDigest: sha256('synthetic-lifecycle-review-workflow/1'),
        environment: { node: sha256(process.version),
          ...(component === 'lifecycle' ? { checkerImplementation: lifecycleCheckerDigest() } : {}) },
        coverage: { discovery: 'COMPLETE', semantic: 'PARTIAL',
          limitations: ['Explicit finite workflow fixture inventory; no production detector or call-graph inference was run.'] },
      });
      return { primary: primary.id, factIds: facts.map(fact => fact.id),
        candidateId: sha256(`${primary.id}:${rule}`), sourceHashes: facts.map(fact => ({ path: fact.path, sha256: fact.contentHash })) };
    };
    const publish = async destination => {
      destination.begin('synthetic-lifecycle-review-workflow', { components: ['lifecycle', 'independent'] });
      const lifecycle = await scan(destination, 'lifecycle', lifecycleRoot, paths, guardedPath);
      const independent = await scan(destination, 'independent', independentRoot, ['stable.mjs'], 'stable.mjs');
      destination.commit(['lifecycle', 'independent']);
      return { lifecycle, independent };
    };
    const sources = await publish(index);
    const initial = runLifecycleLab(lifecycleRoot, contract, traces.replacement, adapters.guarded);
    if (initial.conclusion.status !== 'NO_VIOLATION_OBSERVED') throw new Error('Expected a complete guarded fixture execution');
    const recordLifecycleReview = report => index.addReview({
      candidateId: sources.lifecycle.candidateId, expectedSnapshot: index.revision(),
      disposition: 'COUNTEREVIDENCE', author: 'synthetic workflow reviewer',
      reason: 'The finite replacement trace admits current traffic and rejects the retained old snapshot under the recorded contract.',
      evidence: JSON.stringify({ checker: report.checker, traceId: report.traceId, evidence: report.evidence,
        status: report.conclusion.status, digests: report.digests, assumptions: contract.assumptions,
        meaning: 'User-reported finite implementation check, not proof or approved assurance evidence.' }),
      factIds: sources.lifecycle.factIds,
    });
    const firstReview = recordLifecycleReview(initial);
    index.addReview({ candidateId: sources.independent.candidateId, expectedSnapshot: index.revision(),
      disposition: 'COUNTEREVIDENCE', author: 'synthetic workflow reviewer',
      reason: 'The independent helper has its own unchanged source and component context.',
      evidence: JSON.stringify({ sourceHashes: sources.independent.sourceHashes, observedValue: stableValue(),
        meaning: 'One user-reported invocation of a synthetic helper, not a lifecycle assurance result.' }),
      factIds: sources.independent.factIds });

    const stages = [];
    const candidate = (destination, selected) => {
      const context = localQuery(destination, 'context', { id: selected.primary });
      const row = context.opportunities.find(item => item.id === selected.candidateId);
      return { id: row.id, score: row.score, sourceHash: context.subject.contentHash,
        sourceRevision: context.component.sourceRevision,
        review: row.review ? { id: row.review.id, state: row.review.state, disposition: row.review.disposition,
          authority: row.review.authority, invalidation: row.review.invalidation,
          restored: Boolean(row.review.archive) } : null };
    };
    const checkpoint = (name, destination = index) => stages.push({ name,
      snapshot: destination.revision(), reviewRevision: destination.reviewRevision(),
      lifecycle: candidate(destination, sources.lifecycle), independent: candidate(destination, sources.independent) });
    checkpoint('checked_and_reviewed');
    await publish(index);
    checkpoint('unchanged_rescan');

    const guard = 'if (owner !== current || owner.released) return;';
    if (!originalGuard.includes(guard)) throw new Error('The demonstration guard seam changed; review this example');
    await writeFile(join(lifecycleRoot, guardedPath), originalGuard.replace(guard, '// Guard deliberately removed in the isolated workflow copy.'));
    await publish(index);
    const changed = runLifecycleLab(lifecycleRoot, contract, traces.replacement, adapters.guarded);
    checkpoint('captured_source_changed');

    await writeFile(join(lifecycleRoot, guardedPath), originalGuard);
    await publish(index);
    checkpoint('source_reverted');
    // The restored bytes exactly match the already imported original fixture.
    // Changed bytes were rejected before any callback execution above.
    const rechecked = runLifecycleLab(lifecycleRoot, contract, traces.replacement, adapters.guarded);
    checkpoint('rechecked_without_new_review');
    if (rechecked.conclusion.status !== 'NO_VIOLATION_OBSERVED') throw new Error('Fresh guarded recheck was incomplete');
    const freshReview = recordLifecycleReview(rechecked);
    checkpoint('fresh_review_appended');

    const archive = index.exportReviews();
    restored = new LocalIndex(':memory:');
    await publish(restored);
    const restoredCounts = restored.importReviews(archive);
    checkpoint('archive_restored', restored);
    const history = index.reviewHistory(sources.lifecycle.candidateId).items.map(review => ({
      id: review.id, state: review.state, invalidation: review.invalidation,
      capturedSourceCount: review.sources.length, capturedContexts: review.contexts.map(item => item.component),
      capturedEnvironment: review.contexts.find(item => item.component === 'lifecycle').metadata.environment,
      capturedGuardHash: review.sources.find(item => item.fact.path === guardedPath).fact.contentHash,
      evidence: JSON.parse(review.evidence), authority: review.authority,
    }));
    return {
      kind: 'SYNTHETIC_LIFECYCLE_REVIEW_WORKFLOW',
      authority: 'USER_REPORTED_LOCAL_ANNOTATION',
      opportunityOrigin: 'MANUALLY_REGISTERED_WORKFLOW_FIXTURE_NOT_PRODUCTION_DETECTOR_OUTPUT',
      scope: 'Actual public fixture bytes and implementation callbacks; LocalIndex owns all review state and invalidation.',
      reports: { initial: observed(initial), changed: observed(changed), rechecked: observed(rechecked) },
      stages, history, firstReviewId: firstReview.id, freshReviewId: freshReview.id,
      archive: { ...restoredCounts, sourceReviewRevision: index.reviewRevision(),
        originalLifecycleStateAfterRestore: candidate(index, sources.lifecycle).review.state },
      limitations: ['Finite user-reported checks do not prove behavior, approve evidence, suppress active rules, or close debt.',
        'A component sourceRevision change intentionally invalidates reviews in that component; the independent component has separate unchanged context.',
        'The changed implementation is not executed because its original source pins fail. Reversion and a new execution cannot themselves revive an invalidated review.'],
    };
  } finally {
    restored?.close(); index.close();
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) {
    process.stderr.write('Usage: node examples/lifecycle-lab/reuse.mjs\n');
    process.exitCode = 2;
  } else {
    try { process.stdout.write(`${JSON.stringify(await runLifecycleReuseExample(), null, 2)}\n`); }
    catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
  }
}
