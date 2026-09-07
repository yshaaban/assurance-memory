# HTTP API

All application operations use `POST /v1/{workspace}/{operation}` with `Content-Type: application/json` and `Authorization: Bearer TOKEN`. Mutations require `Idempotency-Key: UNIQUE_LOGICAL_OPERATION_KEY`. The SDK creates a key and retains it across retries; a changed payload with the same actor/key is a conflict. The server derives tenant and actor from authentication. All granted roles may read their authorized workspaces.

`GET /health` is a minimal unauthenticated liveness response. The Spring deployment also exposes its configured Actuator health endpoint without details. Business requests with an Origin header are rejected; expose the service to trusted backend clients rather than enabling browser CORS casually.

Failures return `{ "error": { "code": "...", "message": "..." } }`, with an `X-Request-Id` header. Bad input is 400, authentication 401, authorization 403, missing resource 404, stale/CAS conflict 409, partition/body limits 413, saturation 429, and store unavailability 503. Never automatically resolve a 409 by silently adopting newer requirements or heads.

## Reading

| Operation | Input | Result |
|---|---|---|
| `heads.list` | Pagination | Current component manifest rows |
| `subjects.list` | `component`, pagination | Current fact rows for one component |
| `snapshots.subject` | `head`, `subjectId` | Exact historic subject or deletion/absence at the named head |
| `churn.list` | `component`, pagination | Per-subject observed change counters |
| `claims.get`, `claims.explain` | `id` | Immutable current definition, head/generation, assessment, current evidence, arguments and debt IDs |
| `claims.list` | Pagination | Claim-head rows; fetch details by ID |
| `evidence.get` | `id` | Immutable evidence artifact metadata; use claim assessment for current applicability |
| `evidence.list` | Pagination | Historical evidence rows, not only the newest result |
| `proposals.list` | Pagination | Untrusted proposed requirements |
| `findings.list` | Pagination | Candidate findings with OPEN, NOT_OBSERVED or UNKNOWN state |
| `debts.list` | Pagination | Debt rows, current reviewed disposition and expiry indication |
| `plans.get` | `id` | Stored plan |
| `plans.validate` | `planId` | Current disposition, blockers, exceptions, assessments and exact heads |
| `jobs.list` | Pagination | Checker work records; visibility does not grant completion authority |
| `gate.get` | `id` | Original release receipt plus its current applicability |
| `memory.search` | Optional `query`, `component`, pagination | Descriptive notes with provenance and staleness |
| `events.list` | Numeric `after` sequence, `limit` | Ordered committed events and continuation |
| `graph.neighbors` | `relation`, optional `source`, `target` | Indexed incoming/outgoing edges for `watch`, `parent`, `componentClaim`, `debtClaim`, `queue` |

Document pagination is `{after: "", limit: 100}` with limit 1..500. Results use `{items, next, hasMore}`. Row lists wrap documents as `{id, version, value}`; memory search returns notes directly. Memory can return a partially searched window and `hasMore: true` even with few matches: continue using the returned cursor. Event cursors are numeric, unlike document cursors; do not use the SDK's document `pages()` helper for `events.list`.

`watch` relation targets are hashes of selector strings; `componentClaim` targets are component IDs, `parent` points from conclusion to premises, `debtClaim` points from debt item to affected claim, and `queue` points from job to checker identity.

## Scanner publication — SCANNER

`scan.start` takes:

```json
{
  "component": "gateway",
  "expectedHead": "",
  "sourceRevision": "immutable-git-revision-or-explicit-working-tree-marker",
  "environment": {},
  "configurationDigest": "64-lowercase-hex-digest",
  "expectedFacts": 0,
  "coverage": {"discovery": "COMPLETE", "semantic": "PARTIAL", "limitations": []},
  "analyzer": "adapter/version",
  "rulesExecuted": []
}
```

The response includes scan `id`. The manifest's digest example above is a shape description, not a usable digest. `expectedHead` is empty only for a new component. Environment values must each be SHA-256 digests. Source revision may identify a non-Git scan, but the bundled runner deliberately requires a clean immutable Git revision.

`scan.batch` takes `scanId`, `facts`, `findings`, at most 500 of each per call. A fact has `id`, `locator`, `path`, `language`, `kind`, `contentHash`, `signatureHash`, `tags`, `effects`, numeric `metrics`, and `line`. Identity must equal SHA-256 of `component + ':' + locator`. A finding has `subjectId`, `ruleId`, `line`, `severity`, and `message`; its rule must be in the executed manifest.

`scan.commit` takes `scanId`, validates the expected count and current head, publishes atomically and returns `head`, `impactedClaims`, and bounded changed-key details. Staging expires after one hour. There is no operation allowing an AGENT to overwrite source heads or mark candidate findings as proved defects.

`analysis.java` accepts `{component, files: [{path, source}]}` with at most 2,000 files and five megabytes total. Remote callers cannot supply a classpath or enable local type attribution. It returns facts, findings, rules and explicit coverage.

## Requirement authority — MAINTAINER

`claims.approve` takes the [claim schema](../schemas/claim.schema.json). Required fields are `id`, `expectedRevision`, `statement`, `owner`, `components`, `watch`, `checks`, `mode`. Use explicit `quantification`, `critical` and `allowPartialAnalysis` in reviewed configuration rather than relying on defaults. Definitions and source references are retained. The result contains immutable `claim` and current `head`.

`mode` is DIRECT, DECOMPOSED or BOTH. DIRECT and BOTH require declared checks. DECOMPOSED uses reviewed arguments; supplying no checks does not automatically support the requirement.

`arguments.approve` takes:

```json
{
  "id": "terminal-safety-composition-v1",
  "conclusion": {"id": "jobs.terminal-safety", "revision": 1},
  "premises": [
    {"id": "jobs.terminal-protocol", "revision": 1},
    {"id": "jobs.implementation-binding", "revision": 1}
  ],
  "rationale": "Explain why these premises are jointly sufficient under the declared assumptions.",
  "limitations": []
}
```

The claim IDs must already exist at those revisions. Circular arguments are rejected. An argument ID is immutable; create a new approved argument rather than replacing it.

## Agent operations — AGENT or MAINTAINER

`claims.propose` records a bounded proposal object under PROPOSED authority. It does not activate a requirement. `claims.recheck` takes `{id: claimId}` and queues independent reassessment for the current generation. Same-generation failure evidence is not removed by this operation.

`plans.prepare` takes `intent`, `components`, `writeSelectors`, optional `limit`, and optional `supersedes`. It returns `plan`, `mandatoryClaimPins`, `claimDetails`, `remainingClaimIds`, truncation metadata, and relevant finding/debt IDs. Valid write selectors name components, scopes or existing subjects. New/unknown subject and scope writes conservatively use component-level leases.

`leases.acquire` and `leases.renew` take `planId` and optional `ttlSeconds` (10..3600). `leases.release` takes `planId`. Ownership is authenticated; an agent cannot release another agent's current fence. Releasing an old plan does not release a replacement owner's lease.

`memory.write` takes `kind` (HYPOTHESIS, HANDOFF, INCIDENT, PROCEDURE, DECISION_PROPOSAL), `text`, `components`, optional `provenance`, `ttlSeconds` (60..31536000), and `supersedes`. Current component heads and authenticated author are recorded by the service. Notes cannot set their own authority or freshness.

`debts.propose` takes `title`, `mechanism`, `owner`, `affectedClaims`, `repaymentClaims`, optional `futureChangeScenarios`, `sourceFindingIds`, `principalEstimate` object, and `interestObservations` array. Referenced claims/findings must exist. Estimates and observations are recorded as supplied, not converted into a fabricated debt interest score.

## Debt decisions — MAINTAINER

`debts.decide` takes `id`, `expectedVersion` (the row version), `state`, `rationale`, and `expiresAt` when accepting an exception. Allowed states are ACKNOWLEDGED, MITIGATED, ACCEPTED_EXCEPTION, REPAYING and REJECTED. Exceptions must expire within 30 days, cannot waive critical requirements, and are pinned to the current affected requirement generations. Decisions are immutable historical records even though the debt's current view advances.

`debts.close` takes `id`, `expectedVersion` and `rationale`. Closure requires acknowledgement, supported repayment obligations, and qualifying evidence created after the liability was recorded. A pre-debt green badge or deleted TODO is not repayment evidence.

`maintenance.run` performs one bounded expiry sweep for the workspace. It is also invoked by the scheduled Spring maintenance component. Expired exceptions block gates before their sweep runs.

## Independent evidence — RUNNER

`jobs.claim` takes an optional authorized `checkers` list and `ttlSeconds` (10..600). It returns a job or null; the job includes its exact required checker/version, claim revision/generation, dependency fingerprints, component contexts, owner and fence. `jobs.heartbeat` takes `jobId`, `fence`, `ttlSeconds`.

`jobs.finish` takes `jobId`, `fence`, `checkerVersion`, `result` (PASS/FAIL/UNKNOWN), `coverage` (COMPLETE/PARTIAL), `artifactDigest`, `artifactUri`, and `limitations`. Only the current assigned runner may complete the job. Artifact URI schemes are HTTPS, `artifact://` and `urn:`; the server does not dereference them. Partial PASS becomes UNKNOWN. Result retention and current applicability are returned separately.

`gate.issue` takes `planId` and the **complete exact** `expectedHeads` map. It additionally requires the runner's `release-gate` permission. The gate evaluates the whole plan server-side, not a caller-supplied subset. The receipt includes heads, source revisions, claim pins, policy epoch, exceptions and a digest. It is not a cryptographic signature.

## Pure checks

READER, AGENT, RUNNER or MAINTAINER can call `models.check` and `traces.check`. These calls return check results; they do not submit authoritative evidence.

The [finite-model schema](../schemas/model.schema.json) has `initial`, finite `domains`, transitions with `when` and simultaneous `set`, and named invariant `predicate`s. Optional `terminal` and `deadlockIsViolation` distinguish allowed terminal states from nonterminal deadlock. Operators are `and`, `or`, `not`, `eq`, `ne`, `lt`, `le`, `gt`, `ge`, `add`, `sub`. Results are MODEL_SATISFIED, COUNTEREXAMPLE or INCONCLUSIVE. Bounds and model/code limitations remain explicit.

`traces.check` takes `first`, `later`, and events `{id, entity, executionEpoch, kind, parents}`. It tests a forbidden causal ordering within the same execution identity. Results are OBSERVED_VIOLATION, NOT_OBSERVED or INCONCLUSIVE. Missing causal parents are not silently ignored; wall-clock order is not used as a causality proof.

## `claims.frontier` (1.1 addition)

Read-authorized operation, available to all existing read roles. Input:

```json
{ "id": "root-requirement", "limit": 20, "maxClaims": 500 }
```

Output contains `rootStatus`, `fingerprint`, revision/generation-pinned unresolved `items`, `reachableClaims`, `unresolvedClaims`, `hasMore`, and `next`. Each item has `action`, `reasonKinds`, `checks`, and explicit argument `alternatives`. All entries inside an alternative's `allRequired` list are required; separate alternatives are OR routes. Stale premise revisions return `REVIEW_ARGUMENT_REVISION` and are never automatically rebound.

Continuation supplies both `after` and `fingerprint`. Changed frontier returns HTTP 409; missing fingerprint on continuation or exceeded traversal budget returns HTTP 400. This is a work-discovery API, not approval, lease acquisition, or gate issuance.
