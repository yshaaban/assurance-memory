# Gated detector backlog

These are investigation hypotheses, not shipped detectors or confirmed defects. Current branch counts, effect labels and import neighbors do not establish domain ownership, runtime ordering or a complete call graph. Do not turn these proposals into new high-severity findings until their required facts and negative controls are available. Scores order review; they are not probabilities, savings estimates or permission to refactor.

Each proposal must retain source provenance, state missing facts explicitly, and name a falsifiable check. A reviewed intentional pattern is counterevidence for that source/context, not a global rule suppression. Changed source, context or review applicability requires renewed investigation. The assurance kernel remains the authority for approved requirements, evidence and debt closure.

## Duplicated policy owners

- **Hypothesis:** A single domain rule is independently maintained in several owners, so a realistic policy change requires coordinated edits and can produce divergent behavior.
- **Required facts:** Stable declaration identities; resolved callers and state writes; the domain identity/key shared by the owners; policy inputs/outputs; source-pinned evidence of a concrete change scenario. Similar syntax or equal constants alone is insufficient.
- **Intentional negative control:** Two adapters independently serialize the same protocol constant while forwarding policy to one domain owner; visually similar functions operating on unrelated domains.
- **Validation:** Trace one policy change through both owners, compare the actual edit surface with a proposed single owner, and run behavior checks for each consumer before and after. Preserve deliberately different runtime semantics.
- **Graduation criteria:** Independently reviewed positive and negative examples from at least two unrelated codebases; an actionable mechanism and cited ownership evidence for every positive; no finding when domain identity remains unresolved. Prove that narrowing the owner reduces the named change surface without changing the contract.
- **Dependencies:** Call/alias resolution beyond current import neighbors; source-pinned ownership reviews; representative consumer tests. Do not infer duplicate authority from branch or effect counts.

## Competing retry and concurrency owners

- **Hypothesis:** Several layers independently retry or schedule the same operation, multiplying attempts, losing a newly degraded category, or exceeding a caller's admission/deadline budget.
- **Required facts:** Resolved operation identity and call chain; retry/admission limits; deadline and cancellation propagation; timer ownership; captured versus execution-time inputs; shared versus per-request state.
- **Intentional negative control:** Nested retry wrappers governed by one shared attempt/deadline budget; independent operations with separate concurrency limits; a scheduler intentionally coalescing all pending keys before execution.
- **Validation:** Deterministically interleave two arrivals, a timeout and disposal. Measure admitted attempts and verify late/new keys, cancellation and replacement sessions. Compare observed behavior with the declared budget; textual nesting alone is not a failure.
- **Graduation criteria:** Positive cases have a repeatable failing budget or lifecycle check, negative controls preserve intentional nesting, and unresolved wrapper budgets are reported as gaps. Distinguish attempt amplification, coalescing loss and teardown leakage rather than issuing one generic warning.
- **Dependencies:** Timer/callback capture facts, interprocedural budget propagation, operation identity and deterministic fake-time or scheduler seams.

## Lifecycle admission after release

- **Hypothesis:** A callback retained before cleanup can mutate state after its owner is released, or can corrupt a replacement owner's version/order tracking.
- **Required facts:** Acquisition/release transitions; callback registration and delivery route; mutation targets; owner/generation identity; absorbing or restartable state contract; downstream admission guards.
- **Intentional negative control:** Listener unsubscription paired with a generation guard at the mutation boundary; restartable owners that deliberately admit work only after an explicit new generation.
- **Validation:** Release before readiness and after readiness, deliver queued events/snapshots, then start a replacement owner. Assert observable state and accepted current traffic rather than unsubscribe call counts.
- **Graduation criteria:** A failing delayed-delivery trace is required for positives; downstream guards prevent false positives; restartable and absorbing lifecycles are distinguished. Unknown callback or mutation ownership remains a coverage gap.
- **Dependencies:** Cross-callback data flow, resolved state ownership and generation checks, independent behavioral fixtures with verified cleanup and test-order isolation.

**1.3 development status:** the opt-in [lifecycle admission lab](LIFECYCLE_LAB.md) now executes pinned unsafe, downstream-guarded and restartable synthetic implementations against an independent explicit contract. It records observable state and replayable delayed-callback witnesses; incomplete route/ownership/admission coverage yields `UNKNOWN`. The [reuse example](../examples/lifecycle-lab/reuse.mjs) uses the existing local review store to exercise unrelated changes, guard changes, reverts and fresh re-review. These are development fixtures and manually registered workflow candidates, not automatically extracted production findings. The scanner rule remains disabled pending independent unrelated-codebase examples, reviewed adapter/source mappings, held-out behavioral discrimination and measured extraction overhead. Neither a passing lab trace nor a current annotation suppresses existing structural warnings.

## Divergent normalization at entry points

- **Hypothesis:** Multiple restore/import paths normalize the same durable model independently, so adding or changing a common field creates inconsistent canonical state.
- **Required facts:** Model and field identity; normalization operations; caller and trust boundaries; mutation versus value-return behavior; catalog/default provenance; persisted versus trusted capability fields.
- **Intentional negative control:** A trusted catalog and untrusted persisted input deliberately apply different capability rules; transport-specific decoding delegates to a common canonical normalizer.
- **Validation:** Introduce one representative common-field change and exercise each entry path. Compare canonical output, object identity requirements and rejection of untrusted capabilities. Demonstrate the edit surface before proposing consolidation.
- **Graduation criteria:** Positives show the same semantic field contract and a reproducible divergence or duplicated change obligation; negative controls preserve trust-specific behavior. A common helper is not automatically better unless the named change becomes local.
- **Dependencies:** Resolved types/fields, caller provenance and explicit trust contracts; representative restore/import behavior tests.

## Error observation across detached work

- **Hypothesis:** A detached promise or contained cleanup exception can leave an operation without its required error observation or recovery path. This may refine existing structural warnings, but does not justify deleting them because `.catch` appears in source.
- **Required facts:** Promise-chain ownership; rejection-handler behavior and possible throws; fallback control flow; caller completion requirements; cancellation/release obligations; declared observability expectations.
- **Intentional negative control:** A beacon failure falls through to an observed fallback request; teardown contains an unsubscribe error while revoking credentials and stale callbacks; an intentional detached command logs and reports its failure to its caller.
- **Validation:** Inject failure at each stage, including the error handler, and assert the required outcome. Prove whether the caller needs acknowledged completion or only observed failure. Distinguish handled rejection from joined lifecycle ownership.
- **Graduation criteria:** Positive and intentional-negative fixtures are independently reviewed; findings name the missing obligation and a falsifiable failure path. Suppression or reduced confidence requires applicable source-bound evidence, not method-name matching.
- **Dependencies:** Promise/callback flow and exception propagation, caller contracts, applicable local counterevidence and its invalidation rules.

Before enabling any proposal, use a held-out fixture set, record disagreement and coverage gaps, and measure extraction and projection overhead separately. Required gates are provenance completeness, deterministic identity, snapshot invalidation, negative-control preservation and behavioral discrimination. Passing this gate permits an investigation candidate; it does not establish a violated requirement or authorize debt closure.

## GitHub tracking

- [Duplicated policy owners](https://github.com/yshaaban/assurance-memory/issues/1)
- [Competing retry and concurrency owners](https://github.com/yshaaban/assurance-memory/issues/2)
- [Lifecycle admission after release](https://github.com/yshaaban/assurance-memory/issues/3)
- [Divergent normalization at entry points](https://github.com/yshaaban/assurance-memory/issues/4)
- [Error observation across detached work](https://github.com/yshaaban/assurance-memory/issues/5)
