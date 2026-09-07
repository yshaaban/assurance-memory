# Architecture and invariants

## The durable memory is an obligation graph

The global surface stores approved claims, reviewed arguments, component snapshots, evidence, decisions and debt. Local TypeScript/JDK extraction produces compact facts rather than copying every syntax-tree edge into a central graph. The implementation uses typed document kinds plus indexed directed relations in PostgreSQL; argument documents represent the joint-premise relationship that ordinary pairwise edges cannot express.

A capsule consists of its immutable claim revision, definitions, authority, owner, components, watch selectors, declared evidence checks, current generation, arguments, evidence and counterevidence. A requirement statement is never inferred into authority merely because code or an agent repeats it.

## Identity and time

Logical claim ID is stable. `revision` changes only through MAINTAINER approval. `generation` changes when the relevant implementation/context or an approved argument changes. Evidence names both. A component snapshot has a content digest and a head derived from parent plus content; returning to old content after an intervening change cannot cause an ABA head collision. Identical no-op scans retain the head.

Facts use SHA-256 of `component + ':' + locator`. Named source identities survive ordinary line movement. Anonymous TypeScript callbacks are explicitly location-bound. Ambiguous duplicate identities fail extraction rather than overwrite a different declaration. Location changes can still alter a fact fingerprint and conservatively invalidate evidence.

Historical fact bodies are content-addressed. Every new snapshot records changed-subject deltas and deletion tombstones, with a checkpoint at the first and each 100th snapshot. `snapshots.subject` reconstructs one subject against a specified head in a bounded walk. This is not a complete arbitrary historical graph-query engine.

Events and decisions record server time. Source/deployment revisions identify effective context. The implementation does not provide general bitemporal interval queries or externally tamper-proof storage.

## Scans are staged and atomically published

A scanner declares component, expected head, immutable source revision, expected fact count, execution-rule manifest, coverage and context digests. Batches add validated facts/findings. Commit validates the whole manifest and compares the current component head in the writer transaction. Competing publication is rejected, never silently merged.

Complete discovery permits deletion of omitted subjects. Partial discovery retains previously known omitted subjects and prevents them from becoming absence evidence. The TypeScript scanner rejects detected source changes and changed file membership during collection. There remains a working-tree race without filesystem snapshot isolation: use immutable CI checkouts, not shared live worktrees, for authoritative publication.

## Invalidation includes newly created paths

Selectors are `component:C`, `scope:C:TAG`, `subject:C:DIGEST` and implicit `context:C`.

A scope fingerprint contains the complete extracted membership **and each member's fingerprint**. A new writer can therefore invalidate a universal writer obligation even though it was not in yesterday's graph. Removing a member also changes the scope. Component scope includes all recognized facts. Context includes scan configuration, coverage, analyzer/rule versions and operator-provided environment assumptions.

ALL_MATCHING requirements must include a component or scope selector per component; exact yesterday-only subject lists are rejected. That is a structural guarantee about declared scopes, not a guarantee that a heuristic `writers` extractor found every framework-specific writer. Prefer component/all scopes for high-assurance negative claims until narrower extraction completeness is established.

Changed selectors resolve through indexed reverse `watch` links. Invalidation increments generations and propagates through parent claims, then schedules deterministic checker jobs. Scheduling and the events documenting it share the publication transaction. This is an in-database durable queue; no message broker is required for this implementation.

## Evidence and assurance

Checks declare ID, kind, checker identity, version and maximum age. A checker result carries source/context pins, artifact digest, URI, limitations and completeness. The server decides applicability; a runner cannot choose a newer generation for old work. Jobs have owner, expiry and monotonically increasing fence. Late results are retained historically when the still-owned job can submit, but cannot bless a changed generation. An expired or stolen job fence cannot submit at all.

`SUPPORTED` means supported by the **declared evidence policy**. It is not unrestricted formal correctness. `UNKNOWN` includes missing/stale/expired evidence, unresolved semantics and incomplete source discovery. `VIOLATED` represents applicable submitted counterevidence. Partial PASS becomes UNKNOWN.

Applicable failure evidence is sticky for its requirement generation. A later PASS from rechecking the same generation cannot launder that failure. Resolving a faulty checker requires independent policy/checker revision; resolving code requires a changed relevant context and fresh evidence. Failure does not age into success. Historical failure remains available after a generation change but is no longer automatically asserted against changed code.

Approved arguments use all premises within an argument and alternatives between arguments. Premises pin exact claim revisions. Cycles are rejected; mutual guarantees need a separate checked joint invariant. Direct counterevidence cannot be overridden by a green argument. Model-to-code binding is a distinct obligation, not an inference from a successful model result.

## Collaborative plans

Plan preparation captures component heads, applicable claim revisions/generations, a workspace policy epoch, and semantic write selectors. The obligation closure is computed by the server rather than trusting an agent's similarity search or stated list of requirements. Every required ID remains in the plan even when details are paginated.

Leases use overlapping component/scope/subject domains and shared claim ownership. Scope writes conservatively broaden to component leases. Claim leases prevent agents changing different code regions that jointly affect the same obligation from appearing independent. This favors correctness over maximum parallelism. Reads and speculative work can proceed without write ownership, but cannot acquire release authority.

New snapshots, changed obligations or changed policy make the plan stale. Rebase is explicit: release the previous leases, prepare with `supersedes`, read new context, acquire new fences. Old agents cannot renew expired leases. Release validation checks the complete manifest, evidence, current policy, and valid fences.

The gate returns an immutable database receipt for exact source revisions. It is not signed and cannot atomically update Git or a deployment controller. Integrate those systems using their own compare-and-swap and protected service identities.

## Debt and memory

Agent notes are descriptive, untrusted, provenance-bearing, snapshot-pinned and TTL-limited. Retrieval reports staleness. Text search is deterministic substring search; no embedding score becomes authority. Superseding a note preserves its original record.

Debt identifies mechanism, affected and repayment claims, future change scenarios, source findings, owner, estimates and observations. MAINTAINER decisions are separate immutable records. Exceptions expire within 30 days and pin exact claim revision/generation. Critical requirements cannot be waived. Closure requires current supported repayment obligations, post-debt evidence and review rationale. Debt disposition never mutates evidence truth.

## Persistence and failure semantics

PostgreSQL holds document rows, typed relation rows and ordered per-workspace events. Every query includes tenant/workspace predicates. Writers acquire the workspace row lock; reads use repeatable-read transactions. Checkers never execute while holding that lock. Public writes use actor-bound, payload-bound idempotency receipts. Retrying after a transport/database failure must reuse the original key; conflicts require an explicit new decision.

Maintenance uses bounded, persistent cursors for debt and staged-scan expiry. Release checks enforce expiry immediately, independent of sweep cadence. Retention of immutable evidence, artifacts, snapshots and events remains an operator responsibility: do not garbage-collect artifacts reachable from historical claims, incidents, debt or receipts without a declared retention policy.
