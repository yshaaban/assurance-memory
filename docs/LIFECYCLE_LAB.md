# Lifecycle admission lab

This opt-in development checker exercises actual, checked-in synthetic implementations against an explicit lifecycle contract. It advances [backlog issue #3](https://github.com/yshaaban/assurance-memory/issues/3) without enabling a scanner rule. The assurance kernel remains the authority for requirements, evidence acceptance, and debt closure.

Run from the repository root with Node 24.16 or newer:

```sh
npm run build
node --test packages/agent/dist/test/lifecycle-lab.test.js
node examples/lifecycle-lab/run.mjs --summary
node examples/lifecycle-lab/run.mjs > /tmp/lifecycle-lab-report.json
```

The CLI accepts only its built-in fixture matrix and optional `--summary`. It does not load a repository path, evaluate source text, contact a service, or update a review. Full output contains source pins, input digests, every observation, and a replayable first-divergence witness. Intentional unsafe examples are expected violations; an incomplete `UNKNOWN` run makes the CLI exit unsuccessfully.

## The contract and the independent check

`packages/agent/src/lifecycle-lab.ts` defines one narrow protocol, `versioned-cell/1`. A cell has a generation, version, value, and monotonic mutation count. The count makes an otherwise invisible repeated write observable in these fixtures. Acquisition starts an empty cell in a strictly increasing generation; owners are exclusive. Readiness and release do not themselves change the cell. Events and snapshots may write only when their captured generation is current, unreleased, ready, and carries a newer version. A released absorbing owner cannot reacquire. A restartable owner can explicitly acquire a new generation, while existing callbacks still belong to the old one.

The runner calls a trusted synchronous adapter to acquire owners, retain actual callback closures, release owners, and deliver retained callbacks. Each operation records independent copies of the cell before and after execution. The oracle builds its own lifecycle state from the supplied operations; it does not inspect implementation flags, count unsubscribe calls, infer semantics from method names, or filter callbacks on the implementation's behalf. It checks both forbidden mutations and the required acceptance of valid new traffic. A reject-all implementation therefore fails.

Contracts in `examples/lifecycle-lab/contracts.json` pin the actual `.mjs` implementation, mutation boundary, and adapter bytes with SHA-256. All statically imported fixture implementations are pinned, including those imported by the shared adapter but not selected for a case. The runner checks these files before and after executing callbacks, rejects symlink indirection, and accepts at most 32 pins of at most 1 MiB each. Pins are checked-in expectations: editing a fixture makes the result `UNKNOWN` until a reviewer deliberately updates the affected hashes. The CLI never automatically blesses changed bytes.

Each report has separate checker, source, contract, trace, adapter, and observation digests, plus a versioned checker identity. `digests.checker` automatically hashes the executable lifecycle checker and its `util.js` dependency bytes sampled when the checker module initializes; `lifecycleCheckerDigest()` exposes that captured build identity. The runner checks those bytes again before and after implementation execution. A changed or unavailable checker/dependency makes the result `UNKNOWN`; a preflight mismatch does not invoke the implementation adapter. Reload a deliberately reviewed build to obtain its new digest. This is byte provenance, not loader attestation. The contract digest includes lifecycle assumptions and coverage declarations; the trace digest includes all payloads and delivery ordering. Source hashes do not establish the truth of a contract or prove that an arbitrary caller supplied the corresponding function. The programmatic API trusts its adapter mapping and declared coverage. The built-in CLI fixes that mapping to the reviewed public fixtures. Stronger deployment provenance still requires independently verified build and adapter mappings.

## Development fixture matrix

| Implementation | Scenario | Observed result |
| --- | --- | --- |
| Unsafe unsubscribe-only owner | Release before readiness, then queued readiness and snapshot | Released cell changes to version 90 |
| Unsafe unsubscribe-only owner | Release after readiness, then queued event | Released cell changes to version 90 |
| Unsafe unsubscribe-only owner | Replace owner, deliver old snapshot before current event | Old version 90 poisons ordering; current version 1 is lost |
| Downstream guarded owner | Same three delivery schedules | Old callbacks leave state unchanged; replacement version 1 is accepted |
| Downstream guarded owner | Reacquire the same absorbing owner | Acquisition is rejected; old callback remains harmless |
| Restartable guarded owner | Explicit new generation using the same owner ID | Old callback is rejected; new generation version 1 is accepted |
| Both safe owners | Before readiness, then current, older, and duplicate versions | Only the ready current newer event mutates state |

The default matrix executes 13 cases: three intentional violations and ten cases with no observed violation. The fixture implementations are independent from the oracle. `unsafe.mjs` performs cleanup but omits admission at the write; `guarded.mjs` checks admission at the downstream mutation function; `restartable.mjs` deliberately enables new generations. None imports the oracle. The adapter imports the fixture factories and adds no guard logic.

For the replacement scenario the unsafe observation is:

```json
{"generation":2,"version":90,"value":"poisoned version","mutations":3}
```

The guarded implementation finishes the same schedule with:

```json
{"generation":2,"version":1,"value":"replacement accepted","mutations":3}
```

The failing witness identifies `NO_MUTATION_FROM_OLD_GENERATION` at the first old snapshot delivery, supplies the expected empty generation-2 state and the observed version-90 state, and includes the complete prefix needed to replay that divergence. Subsequent observations preserve the lost-current-traffic consequence without presenting each downstream difference as a separate root cause.

## Unknowns and evidence boundaries

`NO_VIOLATION_OBSERVED` means only that the supplied trace matched this contract. It does not establish all schedules, liveness, unrelated mutation targets, or a production implementation. Traces contain at most 128 steps; oversized traces are rejected without truncation. A trace that does not exercise a particular obligation supplies no evidence about it. Use the full matrix to retain both disposal and current-traffic controls.

Missing callback-route, mutation-ownership, or downstream-admission coverage yields `UNKNOWN` and `NOT_EXECUTED`, as do source-pin failures and unsupported preflight schedules. Missing captured callbacks, overlapping live owners, non-increasing generations, malformed state, adapter exceptions, asynchronous method results, dirty initial state, discontinuous observations, and incomplete populations cannot produce a clean conclusion. Changes detected during execution keep the observations but make the conclusion `UNKNOWN`.

The synchronous step bound is not a process sandbox or a wall-clock timeout. Programmatic callers must supply trusted, terminating, synchronous adapters. A callback that secretly schedules background work or mutates unobserved state violates the declared coverage assumptions; this lab cannot detect that behavior automatically. No scanner invokes these adapters.

`runLifecycleLab` labels actual adapter runs `EXECUTED_IMPLEMENTATION_ADAPTER`. `evaluateLifecycleModel` labels externally supplied or hand-authored observations `MODEL_ONLY`, even when copied from a previous execution. Model-only results never produce implementation investigation candidates. Preflight failure is labelled `NOT_EXECUTED`. Only a complete, source-verified implementation run with an observed divergence produces a local lab investigation candidate, carrying source pins and a falsifiable replay step. No result suppresses active structural warnings or approves a requirement.

## Reuse and remaining gates

An unrelated file outside the declared source closure leaves report applicability digests unchanged. Changing a pinned mutation boundary prevents execution until it is explicitly repinned. Changing only the absorbing/restartable assumption changes the contract digest and can change the conclusion: the restartable fixture fails an absorbing-owner contract when it reacquires. These behaviors are executable tests, not textual similarity judgments.

A report file is evidence input, not a review database. Run `node examples/lifecycle-lab/reuse.mjs` after building to exercise the existing `LocalIndex` review API with actual guarded implementation results and source-byte captures. The example uses explicitly labelled, manually registered workflow candidates; they are not production detector output.

It operates on a temporary copy of the public fixtures and removes it afterward. The guarded replacement check supplies report digests and assumptions to a user-reported review, citing all fixture sources plus contract and trace facts. Its captured lifecycle component environment includes the automatic `checkerImplementation` digest and `sha256(process.version)` as `node`; the independent component captures its Node runtime without depending on the lifecycle checker.

An unchanged rescan retains `CURRENT`; removing the captured guard produces `STALE` and a source-pin `UNKNOWN/NOT_EXECUTED` lab result. Restoring the original bytes keeps the old review `STALE`. Running the implementation again still leaves that review stale until a new review is appended. The original annotation remains in history. A separately reviewed independent component stays `CURRENT` throughout; existing component-wide `sourceRevision` invalidation remains intentional.

Finally, export and import through the established archive API restore both components' annotations as `STALE`. `packages/agent/test/lifecycle-reuse.test.ts` verifies the observations, digests, ranking changes, retained history and recovered states.

Its separate frozen-environment regression changes only a simulated future checker/runtime context, keeping source/contract/trace fixed: the review becomes stale and does not revive on context revert. That regression does not claim execution of a changed checker or runtime. Finite runtime checks remain user-reported evidence inputs, not proof or approved assurance evidence; the example adds no second review engine.

The public fixture bank is development data, not a held-out benchmark. The detector remains gated pending independent positive and intentional-negative examples from unrelated codebases, reviewed adapter mappings, verified source/build provenance, disagreement records, and measured extraction/projection overhead. The present result demonstrates behavioral discrimination within the declared fixture protocol; it does not satisfy production detector graduation.
