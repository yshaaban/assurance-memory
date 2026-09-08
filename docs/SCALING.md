# Scaling and operational constraints

## Partition the semantic work

The implementation has a small assurance graph above per-component fact collections. Publish components independently and bind cross-component obligations explicitly. Source content is hashed; the central store does not retain full ASTs or raw repository files. Named symbols keep stable logical identities, and large import graphs use iterative strongly connected component traversal rather than recursive JavaScript DFS.

PostgreSQL serves indexed reverse dependencies and keyset-paginated documents/events. A changed scope invalidates only connected obligations and their parents. New scope membership participates in the fingerprint. Checker execution is outside database transactions; independent workers lease jobs using fences. Large artifacts belong in a dedicated object store, not inline in graph documents.

This is **bounded component/workspace scaling**, not a completed distributed whole-enterprise graph. A workspace has one serialized writer transaction at a time across service replicas. Independent workspaces can write concurrently, but cross-workspace assurance/federation is not implemented. Replicas share PostgreSQL, not JVM locks.

## Explicit current limits

| Boundary | Limit / behavior |
|---|---|
| HTTP body | 8 MB; bounded response consumption in SDK |
| Fact partition | 50,000 facts per component; fail rather than silently truncate |
| Scan batch | 500 facts and 500 findings |
| CLI source discovery | Default 20,000 files; maximum 50,000; default 1 MB per file, configurable to 5 MB |
| Remote/local Java source request | 2,000 files / five megabytes; local attribution requires a full bounded module |
| Requirement | Up to 100 components, 2,000 selectors, 20 checks |
| Plan / invalidation closure | 5,000 claims; failure requires partitioning, not incomplete assurance |
| Argument | 100 premises; assessment depth 256; cycle/reachability bound 5,000 |
| Active-check acquisition search | Up to 10,000 queued/running candidates per acquisition; worker capacity/backlog needs monitoring |
| Fact history | Checkpoint every 100 snapshots; bounded per-subject reconstruction |
| Expiry maintenance | 500 debt rows and 500 scan rows per workspace sweep with persistent cursors |
| Finite model | 100 variables; 128 values/domain; 1,000 transitions; up to 100,000 states and depth 1,000; internal time bound |
| MCP | 1 MB request line; eight active calls; bounded tool result size; explicit pagination |

The database interface currently updates many facts individually inside a component publication transaction. Very large, frequently changing components can hold a workspace writer lock long enough to hurt interactive latency. The kernel includes no claim that a 50,000-fact publication will meet a particular p99 on your database. Split components, measure SQL round trips and lock duration, and add bulk fact projection writes only while preserving transactional publication/invalidation semantics.

`allowPartialAnalysis` does not override incomplete source discovery. Hitting a partition limit must not create absence evidence. A fundamental framework/context change can legitimately invalidate a large graph; no sound impact system can promise every edit is local.

## Measured local exercise

`java -Xmx1g -cp .build/java dev.assurance.core.ScaleSelfTest 10000` publishes 10,000 synthetic facts, approves 100 scope-bound obligations, changes one fact, and verifies that exactly its one matching obligation invalidates. The recorded run is in `verification/scale.json`.

Observed single-run staging-plus-publication times were 1,294 ms initially and 637 ms for the changed publication. This exercises the **in-memory kernel only**. It is not a PostgreSQL benchmark, a parser benchmark, a warm/cold comparison, a p99 estimate, a million-line codebase result, or a production-capacity promise. The code intentionally labels the output accordingly.

## Run a representative acceptance test

Use your real build modules and dependency graphs. Measure source-discovery coverage; candidate precision; newly introduced forbidden-path recall; stale-evidence correctness; publication transaction duration; graph fan-out; lease contention; queue age; artifact size; and check completion under worker crashes. Inject new bypass writers, removed guards, altered test definitions, changed environments, stale agents and retry races.

Run many server and runner processes against PostgreSQL with the real-PostgreSQL profile and your merge queue. Verify transaction behavior under crash/retry, database failover and credential rotation. A semantic graph test cannot establish database HA or deployment-controller atomicity.

Workspace-wide policy epochs intentionally invalidate plans broadly on approval/decision changes. This is safe but can create contention when many maintainers revise unrelated policy. A future narrower policy-dependency index must retain detection of newly applicable obligations; replacing epochs with existing-only links would reintroduce the negative-dependency bug.

## Retention and recovery

Mutable views, immutable historical records and idempotency receipts are all stored in PostgreSQL. There is no automated archival/deletion policy in this version. Size and retain them according to compliance and operational needs, with explicit reachability rules for evidence used by historical claims/incidents/debt. Never drop all old evidence merely because it is no longer current.

Back up PostgreSQL and the external checker artifact store together with their integrity references. Test restore and current-applicability recomputation. Audit events are committed atomically with changes but are not cryptographically chained or protected from database administrators. Export to an independent append-only audit sink for stronger tamper resistance.

Observability currently consists of audit events, structured API outcomes, basic health endpoints and core request counters. Full distributed tracing, per-tenant Prometheus budgets and an operator UI are not included. Monitor the service, database and workers using your deployment observability stack rather than assuming the graph's application tracing checks instrument the graph service itself.

## Local investigation projection added in 1.1

The optional SQLite workbench does not use the workspace's PostgreSQL writer. It publishes one local workspace transaction, keeps readers on committed snapshots through WAL, and processes compiler components sequentially. It updates changed fact/search rows and records additions, removals and context changes. All component scans are still executed; no unverified compiler cache is used.

The local benchmark now exercises 100,000 facts across ten components; see [measured results](VALIDATION_1_1.md). Limits are intentionally component-local and queries explicitly bounded. The local index has one writer, unbounded retained drift history, and no cross-workspace transactions. Direct and reverse import retrieval are TS/JS component-local projections, not a complete Java or cross-repository call graph.

The service `claims.frontier` query bounds a mission to 500 claims by default (maximum 5,000), 20,000 argument edges, and the existing 256-level assessment limit. Exceeding a graph budget fails instead of returning a seemingly complete assurance frontier. Paginated output requires its returned fingerprint on continuation. This read-only operation changes no gate policy.

## Investigation and retained recovery in 1.3

The task brief defaults to five files within 24,000 compact JSON bytes, with maxima of twenty files and 128,000 bytes. It composes existing lexical reads in one snapshot and discloses term, subject, candidate and entry omissions. These output limits do not bound FTS work independently of the matching population. Local MCP exposes eight read-only tools; its transport limit remains separate from the brief's structured-payload budget.

Review archives hold up to 10,000 distinct originating records and 16 MiB. They preserve captured annotations with permanently stale restore state, rather than replacing full SQLite backup or supplying automatic retention. Complete export fails when its limits are exceeded. See [recovery semantics](REVIEW_ARCHIVES.md).

Use `scan --profile` to separate compiler analysis, source validation, SQLite ingestion and reconciliation plus commit. The [investigation diagnostics](INVESTIGATION_SCALE.md) exercise broad queries, a high-degree owner, retained reviews, permanent invalidation and restore, alongside frozen-component profiles. TypeScript dominated those unchanged scans; no compiler-result cache is added. Any incremental path must prove complete input/membership equivalence and measure retained memory and end-to-end benefit.
