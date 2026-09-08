# Changelog

## Node tooling 1.3.0 — task investigation and retained recovery

- Added `investigate TASK` and the eighth read-only local MCP tool, composing source matches, lexical owners, candidates, retained reviews and coverage in one snapshot. File, byte, term and subject limits disclose omissions; the result is an investigation starting point.
- Added bounded `review-export` / `review-import` archives of distinct originating annotations, canonical integrity checks, idempotent restore and original provenance. Restored records remain permanently stale or absent and never supersede destination submissions. SQLite backups remain necessary for complete local audit history.
- Migrated the local index to schema 3 during the first successful CLI scan. Read-only queries, including export, reject schema-2 indexes until migration; failed scans retain the older schema and committed data. The Java modules remain 1.0.0.
- Added opt-in `scan --profile`, a reproducible investigation/review workload and separate frozen-component extraction diagnostics. Measurements support investigating incremental TypeScript work; no compiler-result cache or speedup is claimed.
- Added an evaluator-owned Python pilot harness with frozen inputs, randomized repeated assignments, isolated candidate copies and protected evaluation. The completed frozen-1.2 study passed all 16 protected checks and blind mechanism reviews; none of eight tool-enabled runs used the optional CLI, and three runs violated the strict read protocol by consulting generic workflow skills. No retrieval or efficiency benefit is established.
- Added an opt-in lifecycle admission lab that executes pinned synthetic implementations against an independent explicit contract, retains replayable witnesses and distinguishes executed observations from model-only input. Its detector remains gated; no production scanner rule is enabled.
- Added focused investigation/archive, lab and pilot-harness test commands; the full test command includes Python harness behavior checks. See the [design decision](docs/decisions/003-task-investigation.md), [scale diagnostics](docs/INVESTIGATION_SCALE.md), [archive contract](docs/REVIEW_ARCHIVES.md), [lab](docs/LIFECYCLE_LAB.md) and [pilot harness](docs/PILOT_HARNESS.md) for scope. Final release validation must report only checks actually executed on the final revision.

## Node tooling 1.2.0 — investigation feedback

- Added normalized identifier/effect search, explicit broader-match reporting, indexed exact-symbol lookup and bounded named-owner context. Extra CLI query terms now fail instead of being ignored.
- Added source-role-aware priorities with original severity/base scores and explanations. Context and backlog select by the same effective priority.
- Added append-only local counterevidence and investigation reviews, source/context invalidation, retained history after disappearance, and review-aware pagination. The seventh local MCP tool reads review history; writes remain explicit CLI actions.
- Migrated the local index to schema 2 and fingerprinted the search policy. CLI upgrades and source publication commit together; failed scans retain the prior schema and source snapshot. Older read-only clients reject the newer schema.
- Removed dependency rehashing from review reads and bounded transaction-local memoization. Added exact-symbol and subject indexes, synthetic scale checks, and regression coverage for migration, malformed cursors, lifecycle invalidation and ranking consistency.
- Documented retained-database backup requirements and five gated detector proposals. No new detector is enabled by this change; the Java modules remain 1.0.0.
- Validation passes 79 Node tests, 25 Java scenarios / 85 assertions, real PostgreSQL checks and the Spring restart test. See the [1.2 report](docs/VALIDATION_1_2.md) for scope and remaining uncertainty.

## Public source publication — Node tooling 1.1.0 / Java service 1.0.0

- Added a persistent local SQLite investigation index with full-text search, category-filtered candidates, direct source context, and bounded reverse-import impact.
- Added atomic workspace scans, persistent drift history, snapshot-bound pagination and a six-tool read-only local MCP mode.
- Added reviewed mission-frontier retrieval with explicit AND premises, OR alternatives and stale revision review.
- Fingerprinted Java dependency contents, effective TypeScript options, scanner implementation and local candidate-policy implementation.
- Fixed repeated local function identities and function/file identity collisions found during application scanning.
- Classified Java large-method findings as simplification candidates and aligned CLI help with the actual query default.
- Added source-verified onboarding, concepts, command/MCP reference, extension guidance, troubleshooting and a controlled pilot protocol.
- Retained real test and benchmark evidence with private project details excluded. See [validation](docs/VALIDATION_1_1.md) for exact scope and [release maintenance](docs/RELEASING.md) for version boundaries.

This is a research and investigation foundation for bounded project pilots. No npm package, container image or production deployment is implied by this source publication.
