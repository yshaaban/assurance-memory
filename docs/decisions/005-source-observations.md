# Decision 005: retain source observations through one review lifecycle

Status: accepted implementation for 1.5; retrieval and agent-benefit gates remain open. This decision extends [Decision 004](004-longitudinal-maintenance.md) without changing the assurance kernel's authority.

## Scope and decision

Retain reasoning against an explicitly selected existing source fact even when no detector emits a candidate. Extend the existing local review store, capture, invalidation, history and archive path. Compose task-start delivery and task-end export around that store. Keep retrieval relevance separate from review applicability and candidate ranking.

The motivating gap was concrete: an ordinary policy owner could be found and inspected, yet its rationale could only be carried as unverified prose because review submission required a candidate. Creating a synthetic finding would conflate retention with detection. A separate observation database would duplicate history, invalidation and recovery. The selected design adds an explicit source subject to the existing record instead.

This is an authorized capability addition. Existing candidate review defaults, ranking discounts, source identities, append-only history and assurance authority remain the compatibility envelope. No detector, compiler cache, provider dependency, generic claim graph or alternate evidence service is introduced.

## Contract ledger

| Surface | Preserved contract and explicit addition | Evidence |
| --- | --- | --- |
| Selection and output | Exactly one existing `candidateId` or `sourceId`; source results have null candidate fields and a separate `sourceReview` in context | Candidate-free source tests and CLI/MCP parity |
| Defaults and ordering | Review history defaults to candidates; source history requires `kind: SOURCE`; local submissions retain precedence over imports | Cross-kind cursor, mixed-history and migration-precedence tests |
| Validation and errors | Exact bounded fields; missing subjects, ambiguous selection, stale snapshots and invalid archives fail without appended history | Input and archive rejection tests |
| Writes and ordering | One SQLite review store; source publication and invalidation commit together; migration commits with a successful upgrade scan | Actual schema-3 rollback and immutable-history tests |
| Freshness | Changed captures invalidate permanently; source disappearance is `SOURCE_ABSENT`; reversion never revives old judgments | Real compiler value-change, declaration-membership, deletion and recreation tests |
| Transfer | Original captures and digests survive; import is atomic and idempotent, always stale or absent, and cannot override local precedence | Version-1/version-2 round trips and restore tests |
| Delivery and concurrency | Query snapshots remain consistent; packet output cannot alias DB/sidecars; task-end export requires closed connections and no concurrent index/output writers | Task workflow integration and alias checks |
| Authority | User-reported text never approves evidence, establishes a requirement, creates a candidate or closes debt | Separate source/candidate outputs and unchanged kernel interfaces |
| Read cost | Context/history read captured JSON without recomputing dependency hashes; ordinary history pagination stays bounded | Synthetic read observation below |

The local store owns review mutations and reconciliation. `LocalIndex` owns the surrounding SQLite transactions. CLI and MCP use `local-query.ts` for the same read behavior; MCP remains read-only. The canonical archive parser owns compatibility and complete-or-fail validation. These boundaries isolate storage, query, wire-format and process-lifecycle decisions that change for different reasons.

## Expected changes and ownership

These scenarios come from the implemented maintenance workflow and its observed gaps. The table compares where the decision previously propagated with its intended home; it does not invent a count of files saved.

| Concrete change | Previous change surface | Owner and verification after this decision |
| --- | --- | --- |
| Retain why an ordinary display policy differs from request normalization | Candidate-only review API could not represent the inspected owner; plain handoff text carried the rationale without captured applicability | `local-review.ts` accepts the exact source subject through the existing lifecycle; real candidate-free compiler fixture verifies capture and authority |
| Revise a policy body, add a declaration or introduce a new importer | Source facts and candidate captures already had invalidation, but candidate-free prose had no comparable lifecycle | Scan projection plus the same review reconciliation; test value changes, enclosing-file membership and unresolved-to-resolved imports |
| Move the next task into a fresh checkout | Root-bound index plus evaluator-written copy/export procedure; incorrectly carrying the DB caused integration failures | `task-context.mjs` scans a fresh index and imports history; `task-handoff.mjs` owns quiescent copy/export/publication |
| Upgrade retained history to support source notes | Candidate-only schema and archive needed coordinated compatibility changes | Schema 4 migration in the existing store and archive version 2 in `local-review-archive.ts`; preserve version-1 records and rollback failed scans |
| Improve relevance for a task or filename anchor | Query selection and brief composition needed adjustment independent of evidence policy | `local-search.ts` and `local-investigate.ts`; evaluate owners, consumers and counterexamples without changing review freshness or candidate discounts |

The design tax was the coupling between having a detector finding and being allowed to retain a source-bound rationale. The solution keeps subject selection explicit while sharing the state owner. Task adapters own delivery and transfer, not review policy. Retrieval can change without adding another freshness computation or mutating retained judgments.

## Migration and tradeoffs

Schema 4 adds mutually exclusive nullable candidate/source columns to the existing review table. Upgrade preserves row IDs, immutable body bytes, fingerprints, timestamps, invalidations, review revision and local precedence. Older read-only queries and review writes request a successful scan first. A failed upgrade scan retains the previous schema and source snapshot; newer schemas remain incompatible with older tools.

Candidate-only exports remain archive version 1. Exports containing source observations use version 2 with unchanged candidate record digests. The importer accepts both, keeps all distinct originating captures and permanently invalidates restored notes. Archives are transfer artifacts; SQLite remains the live store. Neither matching source bytes nor later reappearance can promote an imported judgment to current applicability.

A current candidate counterevidence review retains the existing ranking discount. A source observation never discounts a candidate, even when both refer to the same owner. This deliberately requires an explicit candidate review when the user intends to change triage priority. Source rationale, review applicability, detector confidence and kernel approval therefore retain distinct meanings.

Captures include the selected fact, its enclosing file, explicit citations, complete direct-import/importer fingerprints and component context. File-body edits and declaration membership can invalidate a symbol note; component revision, analyzer, configuration or coverage changes can invalidate it more broadly. This conservative policy increases re-review work but avoids claiming freshness for an incompletely captured assumption. It does not establish a complete call graph, runtime dependency set or arbitrary directory/claim scope.

Task-start delivery composes existing scan, investigation and import operations. Scan and import are separate commits: a later packet failure can leave the new index available for inspection. Task-end export streams hashes of DB/WAL/SHM, copies them to scratch, exports and validates there, then publishes an exclusive new archive or explicitly replaces an existing valid archive atomically. Closed connections and a sole output writer are preconditions; hash checks neither establish quiescence nor implement online backup. No adapter retries or silently retargets a root-bound index.

## Before and after scorecard

| Dimension | Before | After / limit |
| --- | --- | --- |
| Live local review stores | One | One; no duplicate memory store |
| Review subject choices | Emitted candidate | Emitted candidate or exact existing source fact |
| Capture and invalidation paths | Existing candidate review lifecycle | Same lifecycle with explicit subject selection; permanent invalidation remains shared |
| New runtime dependencies | Baseline dependency set | Zero added by this extension and its task adapters |
| History transfer | Version-1 candidate archives | Version 1 remains compatible; version 2 supports mixed records without rewriting old captures |
| Upgrade publication | Atomic schema/scan migration | Schema 4 uses the same transaction boundary, including failed-scan rollback |
| Task integration | Task-start composition plus manual task-end export procedure | Task-start and task-end composition through existing APIs; quiescence is still explicit |
| Test setup | Real SQLite and compiler fixtures for candidate history | Extended behavior fixtures for source history, migration and adapters; no model provider needed for lifecycle checks |
| Change locality | Ordinary source rationale had no review subject | One existing state owner now handles both subjects; no measured claim about fewer files or lower maintenance effort |

A warm, in-memory synthetic probe on Node 24.16 used **1,200 facts, 3,600 source notes and 200 reads per measurement**. Context median latency was **0.092 ms before notes** and **0.098 ms after notes**, with **0.117 ms p95 after notes**. A source-history page measured **0.029 ms median / 0.037 ms p95**, with three records per owner. These observations check the read path's immediate cost on one machine; they are not production capacity, cold-storage latency or evidence of an agent speed benefit.

Reproduce the workload with the standalone [source-observation read probe](../../scripts/benchmark-source-observations.mjs):

```sh
npm run build
node scripts/benchmark-source-observations.mjs
```

Each invocation writes one compact JSON diagnostic with runtime, workload counts, read timing, elapsed time and process-memory snapshots. New measurements do not replace the historical values above or establish a production or agent-outcome claim.

## Verification and remaining gates

Behavior checks cover candidate-free source capture, body/value edits, enclosing-file declaration membership, dependencies becoming resolved, new importers, deleted citations, deletion/recreation, reversion, fresh explicit review, source/candidate namespace isolation, archive compatibility, imported-history precedence and actual schema-3 migration rollback. Full regression and real PostgreSQL/restart checks have passed during integration. These checks establish implementation behavior within their fixtures; they do not determine the usefulness or truth of retained reasoning.

The independent retrieval holdout contains five privately authored tasks created after the evaluated code was frozen, with no tuning on those tasks. Required-owner coverage was 4/4 versus 3/4 for the preceding retrieval, and consumer coverage was 3/3 versus 2/3. Required counterexample coverage fell to 1/2 from 2/2. That negative result keeps the retrieval-value gate open: more owners do not compensate automatically for lost counterevidence. A later filename-anchor bug fix was not rescored on that holdout; these counts describe the frozen pre-fix comparison.

The [fresh paired study](../VALIDATION_1_5.md#fresh-paired-study) exercises source archives across successive tasks and retains independently rejected candidates and their blocked descendants. It exposes a missed prior owner in automatic delivery and temporal counterexamples missed by protected checks. No avoided-investigation, total-cost or retained-reasoning benefit is established. Follow-up evaluation must keep both arms' information opportunities explicit, retain failed and blocked assignments, separate integration failures from model outcomes, and count preparation, review and rework. Arbitrary claims, automatic proof, broader detector activation, online backup and compiler caching remain outside this decision.

See [source observations](../SOURCE_OBSERVATIONS.md), [review archives](../REVIEW_ARCHIVES.md), [task workflow](../TASK_WORKFLOW.md) and [longitudinal pilots](../LONGITUDINAL_PILOTS.md) for the operational contracts.
