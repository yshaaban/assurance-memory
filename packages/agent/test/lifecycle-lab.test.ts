import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, mkdir, writeFile, rm, symlink, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { evaluateLifecycleModel, lifecycleDigest, lifecycleCheckerDigest, LIFECYCLE_LAB_MAX_STEPS, runLifecycleLab,
  type LifecycleAdapter, type LifecycleContract, type LifecycleTrace } from '../src/lifecycle-lab.js';

const root = resolve('.');
const fixtureRoot = join(root, 'examples/lifecycle-lab');
const contracts = JSON.parse(await readFile(join(fixtureRoot, 'contracts.json'), 'utf8')) as Record<string, LifecycleContract>;
const { adapters } = await import(pathToFileURL(join(fixtureRoot, 'adapter.mjs')).href) as { adapters: Record<string, LifecycleAdapter> };
const { traces, cases } = await import(pathToFileURL(join(fixtureRoot, 'traces.mjs')).href) as {
  traces: Record<string, LifecycleTrace>; cases: Array<[string, string]>;
};
const run = (implementation: string, trace: string) => runLifecycleLab(root, contracts[implementation]!, traces[trace]!, adapters[implementation]!);

test('actual unsafe implementations produce replayable early/late-release and replacement witnesses', () => {
  for (const name of ['earlyRelease', 'lateRelease', 'replacement']) {
    const result = run('unsafe', name);
    assert.equal(result.evidence, 'EXECUTED_IMPLEMENTATION_ADAPTER');
    assert.equal(result.conclusion.status, 'VIOLATION_OBSERVED');
    assert.deepEqual(result.conclusion.gaps, []);
    const witness = result.conclusion.witnesses[0]!;
    assert.equal(witness.obligation, name === 'replacement' ? 'NO_MUTATION_FROM_OLD_GENERATION' : 'NO_MUTATION_AFTER_RELEASE');
    assert.equal(witness.observed.version, 90);
    assert.equal(witness.observed.mutations, witness.expected.mutations + 1);
    assert.equal(witness.replay.length, witness.index + 1);
    assert.deepEqual(witness.replay, traces[name]!.steps.slice(0, witness.index + 1));
    assert.equal(result.candidate?.kind, 'LIFECYCLE_LAB_INVESTIGATION');
    assert.equal(result.candidate?.sourcePins.length, contracts.unsafe!.sources.length);
    assert.ok(result.verifiedSources.some(pin => pin.role === 'MUTATION_BOUNDARY' && pin.path.endsWith('unsafe.mjs')));
  }
  // The high old version poisons ordering and prevents the subsequent current event.
  assert.deepEqual(run('unsafe', 'replacement').observations.at(-1)!.after,
    { generation: 2, version: 90, value: 'poisoned version', mutations: 3 });
});

test('downstream admission preserves disposal and accepts real replacement traffic', () => {
  for (const name of ['earlyRelease', 'lateRelease', 'replacement', 'beforeReady', 'absorbing']) {
    const result = run('guarded', name);
    assert.equal(result.conclusion.status, 'NO_VIOLATION_OBSERVED', JSON.stringify(result.conclusion));
    assert.equal(result.candidate, null);
  }
  assert.deepEqual(run('guarded', 'replacement').observations.at(-1)!.after,
    { generation: 2, version: 1, value: 'replacement accepted', mutations: 3 });
  assert.deepEqual(run('guarded', 'beforeReady').observations.at(-1)!.after,
    { generation: 1, version: 2, value: 'accepted', mutations: 2 });
});

test('explicit new generations allow restart while old-generation deliveries remain harmless', () => {
  const restarted = run('restartable', 'restart');
  assert.equal(restarted.conclusion.status, 'NO_VIOLATION_OBSERVED');
  assert.deepEqual(restarted.observations.at(-1)!.after,
    { generation: 2, version: 1, value: 'new generation accepted', mutations: 3 });
  const absorbing = run('guarded', 'absorbing');
  assert.deepEqual(absorbing.observations.at(-1)!.after,
    { generation: 1, version: -1, value: null, mutations: 1 });
  // Changing only the declared lifecycle assumption changes the oracle obligation.
  const wrongContract = { ...contracts.restartable!, release: 'ABSORBING' as const };
  const mismatch = runLifecycleLab(root, wrongContract, traces.absorbing!, adapters.restartable!);
  assert.equal(mismatch.conclusion.witnesses[0]?.obligation, 'NO_MUTATION_AFTER_RELEASE');
  assert.notEqual(mismatch.digests.contract, restarted.digests.contract);
});

test('rejecting every callback cannot masquerade as successful lifecycle behavior', () => {
  const adapter: LifecycleAdapter = { ...adapters.guarded!, create() {
    const actual = adapters.guarded!.create();
    return { ...actual, retain() { return () => {}; } };
  } };
  const result = runLifecycleLab(root, contracts.guarded!, traces.beforeReady!, adapter);
  assert.equal(result.conclusion.status, 'VIOLATION_OBSERVED');
  assert.equal(result.conclusion.witnesses[0]?.obligation, 'ACCEPT_CURRENT_TRAFFIC');
  assert.equal(result.conclusion.witnesses[0]?.expected.value, 'accepted');
  assert.equal(result.conclusion.witnesses[0]?.observed.value, null);
});

test('partial route, ownership, or downstream coverage produces UNKNOWN before implementation execution', () => {
  for (const coverage of ['callbackRoute', 'mutationOwnership', 'downstreamAdmission'] as const) {
    let invoked = false;
    const contract = structuredClone(contracts.guarded!);
    contract.coverage[coverage] = 'UNRESOLVED';
    const result = runLifecycleLab(root, contract, traces.replacement!, {
      ...adapters.guarded!, create() { invoked = true; return adapters.guarded!.create(); },
    });
    assert.equal(result.conclusion.status, 'UNKNOWN');
    assert.equal(result.evidence, 'NOT_EXECUTED');
    assert.ok(result.conclusion.gaps.some(gap => gap.includes(coverage)));
    assert.equal(result.observations.length, 0);
    assert.equal(result.candidate, null);
    assert.equal(invoked, false);
  }
});

test('bounded complete traces, valid callback routes, and isolated initial state are required', () => {
  let executions = 0;
  const adapter = { ...adapters.guarded!, create() { executions++; return adapters.guarded!.create(); } };
  const tooLong = { id: 'too-long', steps: Array.from({ length: LIFECYCLE_LAB_MAX_STEPS + 1 }, () => traces.beforeReady!.steps[0]!) };
  assert.equal(runLifecycleLab(root, contracts.guarded!, tooLong, adapter).conclusion.status, 'UNKNOWN');
  const unknownDelivery: LifecycleTrace = { id: 'unresolved-delivery', steps: [{ op: 'deliver', delivery: 'missing' }] };
  assert.equal(runLifecycleLab(root, contracts.guarded!, unknownDelivery, adapter).conclusion.status, 'UNKNOWN');
  const overlapping: LifecycleTrace = { id: 'overlap', steps: [
    { op: 'acquire', owner: 'a', generation: 1 }, { op: 'acquire', owner: 'b', generation: 2 },
  ] };
  assert.equal(runLifecycleLab(root, contracts.guarded!, overlapping, adapter).conclusion.status, 'UNKNOWN');
  assert.equal(executions, 0);
  const dirty = { ...adapters.guarded!, create() {
    const actual = adapters.guarded!.create(); actual.acquire('leftover', 1); return actual;
  } };
  assert.equal(runLifecycleLab(root, contracts.guarded!, traces.beforeReady!, dirty).conclusion.status, 'UNKNOWN');
});

async function copiedSources(body: (path: string) => Promise<void>): Promise<void> {
  const temporary = await mkdtemp(join(tmpdir(), 'assurance-lifecycle-'));
  try {
    for (const path of new Set(contracts.guarded!.sources.map(pin => pin.path))) {
      await mkdir(dirname(join(temporary, path)), { recursive: true });
      await writeFile(join(temporary, path), await readFile(join(root, path)));
    }
    await body(temporary);
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

test('actual source/adapter bytes must match their pins and unrelated files do not affect applicability', async () => {
  await copiedSources(async temporary => {
    const before = runLifecycleLab(temporary, contracts.guarded!, traces.replacement!, adapters.guarded!);
    await writeFile(join(temporary, 'unrelated.txt'), 'unrelated edit');
    const unaffected = runLifecycleLab(temporary, contracts.guarded!, traces.replacement!, adapters.guarded!);
    assert.deepEqual(unaffected.digests, before.digests);
    await writeFile(join(temporary, 'examples/lifecycle-lab/guarded.mjs'), '// changed mutation boundary');
    let invoked = false;
    const changed = runLifecycleLab(temporary, contracts.guarded!, traces.replacement!, {
      ...adapters.guarded!, create() { invoked = true; return adapters.guarded!.create(); },
    });
    assert.equal(changed.conclusion.status, 'UNKNOWN');
    assert.ok(changed.conclusion.gaps.some(gap => gap.includes('source digest mismatch')));
    assert.equal(invoked, false);
    assert.equal(changed.candidate, null);
  });
  const missingAdapter = { ...contracts.guarded!, sources: contracts.guarded!.sources.filter(pin => pin.role !== 'ADAPTER') };
  assert.equal(runLifecycleLab(root, missingAdapter, traces.replacement!, adapters.guarded!).conclusion.status, 'UNKNOWN');
});

test('symlink source indirection is not accepted as a verified implementation pin', async () => {
  await copiedSources(async temporary => {
    const path = join(temporary, 'examples/lifecycle-lab/guarded.mjs');
    await rm(path);
    await symlink(join(fixtureRoot, 'guarded.mjs'), path);
    const result = runLifecycleLab(temporary, contracts.guarded!, traces.replacement!, adapters.guarded!);
    assert.equal(result.conclusion.status, 'UNKNOWN');
    assert.equal(result.observations.length, 0);
  });
});

test('source changes during explicit adapter execution cannot produce reusable behavioral evidence', async () => {
  await copiedSources(async temporary => {
    const { writeFileSync } = await import('node:fs');
    const adapter: LifecycleAdapter = { ...adapters.guarded!, create() {
      writeFileSync(join(temporary, 'examples/lifecycle-lab/guarded.mjs'), '// changed during execution');
      return adapters.guarded!.create();
    } };
    const result = runLifecycleLab(temporary, contracts.guarded!, traces.replacement!, adapter);
    assert.equal(result.conclusion.status, 'UNKNOWN');
    assert.equal(result.evidence, 'EXECUTED_IMPLEMENTATION_ADAPTER');
    assert.equal(result.candidate, null);
    assert.equal(result.observations.length, traces.replacement!.steps.length);
    assert.ok(result.conclusion.gaps.some(gap => gap.startsWith('After execution:')));
  });
});

test('runtime exceptions and asynchronous adapter methods remain incomplete evidence', () => {
  const throwing = { ...adapters.guarded!, create() { throw new Error('fixture startup failure'); } };
  const failure = runLifecycleLab(root, contracts.guarded!, traces.replacement!, throwing);
  assert.equal(failure.conclusion.status, 'UNKNOWN');
  assert.match(failure.conclusion.gaps.join(' '), /fixture startup failure/);
  const asynchronous: LifecycleAdapter = { ...adapters.guarded!, create() {
    const actual = adapters.guarded!.create();
    return { ...actual, async acquire(owner, generation) { actual.acquire(owner, generation); } };
  } };
  const asyncResult = runLifecycleLab(root, contracts.guarded!, traces.replacement!, asynchronous);
  assert.equal(asyncResult.conclusion.status, 'UNKNOWN');
  assert.match(asyncResult.conclusion.gaps.join(' '), /Asynchronous adapters/);
});

test('model-only traces never become implementation candidates and incomplete populations stay UNKNOWN', () => {
  const actual = run('unsafe', 'replacement');
  const model = evaluateLifecycleModel(contracts.unsafe!, traces.replacement!, actual.observations);
  assert.equal(model.evidence, 'MODEL_ONLY');
  assert.equal(model.conclusion.status, 'VIOLATION_OBSERVED');
  assert.equal(model.candidate, null);
  assert.deepEqual(model.verifiedSources, []);
  assert.equal(model.digests.adapter, null);
  assert.equal(evaluateLifecycleModel(contracts.unsafe!, traces.replacement!, actual.observations.slice(1)).conclusion.status, 'UNKNOWN');
  const discontinuous = structuredClone(actual.observations);
  discontinuous[1]!.before.mutations = 100;
  assert.equal(evaluateLifecycleModel(contracts.unsafe!, traces.replacement!, discontinuous).conclusion.status, 'UNKNOWN');
  const reordered = structuredClone(actual.observations).reverse();
  assert.equal(evaluateLifecycleModel(contracts.unsafe!, traces.replacement!, reordered).conclusion.status, 'UNKNOWN');
});

test('checker and util byte changes prevent old loaded checker evidence and bind a new checker build to a new digest', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'assurance-lifecycle-checker-'));
  try {
    for (const file of ['lifecycle-lab.js', 'util.js'])
      await copyFile(new URL(`../src/${file}`, import.meta.url), join(temporary, file));
    await writeFile(join(temporary, 'package.json'), '{"type":"module"}');
    const url = pathToFileURL(join(temporary, 'lifecycle-lab.js')).href;
    const loaded = await import(url) as typeof import('../src/lifecycle-lab.js');
    const before = loaded.runLifecycleLab(root, contracts.guarded!, traces.replacement!, adapters.guarded!);
    assert.equal(before.conclusion.status, 'NO_VIOLATION_OBSERVED');
    assert.equal(before.digests.checker, lifecycleCheckerDigest());
    const checker = await readFile(join(temporary, 'lifecycle-lab.js'), 'utf8');
    await writeFile(join(temporary, 'lifecycle-lab.js'), `${checker}\n// A different executable build.\n`);
    let invoked = false;
    const stale = loaded.runLifecycleLab(root, contracts.guarded!, traces.replacement!, {
      ...adapters.guarded!, create() { invoked = true; return adapters.guarded!.create(); },
    });
    assert.equal(stale.conclusion.status, 'UNKNOWN');
    assert.equal(stale.evidence, 'NOT_EXECUTED');
    assert.equal(stale.digests.checker, before.digests.checker);
    assert.equal(invoked, false);
    assert.ok(stale.conclusion.gaps.some(gap => gap.includes('Checker implementation bytes changed')));
    const newer = await import(`${url}?new-build`) as typeof import('../src/lifecycle-lab.js');
    const after = newer.runLifecycleLab(root, contracts.guarded!, traces.replacement!, adapters.guarded!);
    assert.equal(after.conclusion.status, 'NO_VIOLATION_OBSERVED');
    assert.notEqual(after.digests.checker, before.digests.checker);
    assert.equal(after.digests.source, before.digests.source);
    assert.equal(after.digests.trace, before.digests.trace);
    const util = await readFile(join(temporary, 'util.js'), 'utf8');
    const { writeFileSync } = await import('node:fs');
    const changedDuringExecution = newer.runLifecycleLab(root, contracts.guarded!, traces.replacement!, {
      ...adapters.guarded!, create() {
        writeFileSync(join(temporary, 'util.js'), `${util}\n// Dependency build changed.\n`);
        return adapters.guarded!.create();
      },
    });
    assert.equal(changedDuringExecution.conclusion.status, 'UNKNOWN');
    assert.equal(changedDuringExecution.evidence, 'EXECUTED_IMPLEMENTATION_ADAPTER');
    assert.equal(changedDuringExecution.candidate, null);
    assert.ok(changedDuringExecution.conclusion.gaps.some(gap => gap.startsWith('After execution: Checker implementation')));
    const changedDependency = newer.runLifecycleLab(root, contracts.guarded!, traces.replacement!, adapters.guarded!);
    assert.equal(changedDependency.conclusion.status, 'UNKNOWN');
    assert.equal(changedDependency.evidence, 'NOT_EXECUTED');
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('trace binding, deterministic digests, and cleanup isolate repeated or reordered fixture execution', () => {
  const forward = new Map(cases.map(([implementation, trace]) => [`${implementation}:${trace}`, run(implementation, trace)]));
  for (const [implementation, trace] of [...cases].reverse())
    assert.deepEqual(run(implementation, trace), forward.get(`${implementation}:${trace}`));
  const original = run('guarded', 'replacement');
  const altered = structuredClone(traces.replacement!);
  altered.steps.splice(8, 1); // Different delivery schedule remains explicit in trace provenance.
  const changed = runLifecycleLab(root, contracts.guarded!, altered, adapters.guarded!);
  assert.notEqual(changed.digests.trace, original.digests.trace);
  assert.equal(changed.digests.source, original.digests.source);
  assert.equal(lifecycleDigest({ b: 2, a: 1 }), lifecycleDigest({ a: 1, b: 2 }));
  assert.throws(() => lifecycleDigest({ value: undefined }));
  assert.throws(() => lifecycleDigest({ value: Number.NaN }));
});
