# Decision 001: Evolve Assurance Memory

Date: 2026-09-07. Status: implemented as a local repository, with measured limits.

## Decision

Choose **Assurance Memory**, retain its assurance kernel, and add a local investigation projection. Carry over ContractGraph's emphasis on content-pinned compiler dependencies and graph navigation. Do not combine the two service implementations: two policy/evidence authorities would make consistency harder to establish.

The user's objective is to make agents effective at finding technical liabilities and simplifying large codebases. Discovery and useful retrieval must be inexpensive before an organization has formalized every requirement. Once a candidate matters, its intended behavior, assumptions and evidence should become reusable assets.

## Comparison of the supplied implementations

| Concern | Assurance Memory | ContractGraph | Consequence |
|---|---|---|---|
| Core abstraction | Immutable claim revisions; reviewed sufficiency arguments with AND premises and OR routes | Immutable obligations; assumption dependencies; method-specific assurance | Assurance Memory is closer to reusable decomposition of a difficult requirement |
| Debt | Mechanism, future-change scenarios, owner, affected claims, repayment claims, expiring decisions, checked closure | Explicit debt/risk decisions tied to assurance | Assurance Memory directly represents the user's simplification workflow |
| Extraction | TS compiler/JDK trees, effect summaries and per-component facts | TS projects/references, JDK adapter, explicit typed/modality edges and CAS partitions | ContractGraph has a stronger source-graph representation and project handling |
| Simplification discovery | Duplicate bodies, large functions, import cycles, layer rules; many lifecycle candidates | Lifecycle/runtime candidates and drift over fact attributes | Assurance Memory offers more immediately useful simplification signals |
| Evidence validity | Generations, scope membership, environmental context, sticky failures | Applicability fingerprints covering roots, edges, assumptions and environment; separate result/applicability | Both correctly account for new subjects and preserve counterevidence |
| Retrieval | Bounded mandatory context, paginated descriptive memory; substring search inspects limited windows | Bounded server context and compact assessment summaries | Neither provides a convenient persistent local investigation workbench |
| Change coordination | Explicit rebasing, fenced leases, runner jobs, release receipts | Exact semantic keys, fenced leases, proposal/integrator workflow | Both need external Git integration for atomic promotion of actual code |
| Storage/scaling | Generic PostgreSQL document/link store, per-workspace writer serialization | CAS partitions/manifests, domain SQL ledgers, transactional promotion | ContractGraph's partition model is attractive for future distributed extraction; neither demonstrates organization-scale operation |
| Operational proof in the download | Core/Node tests and 10,000-fact in-memory exercise; durable stack unexecuted | Core/Node tests; durable stack unexecuted | Both were reference implementations needing connected verification |

Code inspected: `Claims.java`, `MemoryDebt.java`, `Scans.java`, `JdbcStore.java`, `scan.ts`, `analyzer.ts`, `runner.ts`, and `mcp.ts` in Assurance Memory; `AssuranceEngine.java`, `Store.java`, `model.ts`, `scanner.ts`, `detectors.ts`, schemas and operation/limitation documents in ContractGraph.

The decision is about fit, not a claim that Assurance Memory wins every dimension. ContractGraph would be a stronger starting point if the primary goal were a typed source-edge/CAS ingestion platform. Here, reviewed decomposition and explicit repayment obligations are more expensive to recreate than local search and graph navigation.

## What Prove2Me contributes

Prove2Me separates immutable targets from contributions, decomposes missions into reusable subproblems, and lets checked sketches depend on other statements. Its kernel validates proof submissions against exact targets. [Primary description](https://prove2.me/about); [paper](https://arxiv.org/abs/2608.28433).

Our adaptation is an engineering inference: retain canonical requirements, expose the unresolved frontier, and reuse evidence only while its code and assumptions remain applicable. Unlike Lean proofs, tests and a reviewed software decomposition do not establish general logical sufficiency or model-to-implementation refinement. An argument edge must not silently confer proof authority.

## Scope and behavioral contract

Keep the existing service's authorization, immutable claims, evidence generations, counterexample persistence, debt decisions, and release-gate semantics. Add read-only mission discovery; no new operation approves claims or supplies passing evidence.

Local inputs are an explicit workspace inventory, source/configuration files, and declared compiler dependencies. Outputs are JSON source summaries, candidate records, bounded context and drift. Side effects are confined to an explicitly selected SQLite database and its WAL files. Scanning does not run package scripts or build tools. Local Java extraction invokes only the supplied compiler adapter.

A workspace scan is atomic. Failure rolls it back. Incomplete source discovery cannot publish deletions. Semantic gaps remain visible even when discovery succeeds. Readers observe a consistent committed snapshot. The local index is disposable and cannot replace the durable policy/evidence store.

Named TS identities remain stable except previously colliding names: repeated declarations in separate scopes now receive position suffixes, and a function named `file` no longer collides with its source-file fact. Extractor version 1.1.0 and scanner implementation digests make the migration visible. Position-bound identities can overinvalidate after line edits.

## Expected changes and ownership

| Expected change | Before | After |
|---|---|---|
| Investigate a possible debt item in a new checkout | Set up service/authentication, scan publication, then page findings and source facts | One local scan; ranked backlog, search, context and impact queries |
| Add an investigation rule | Analyzer finding, followed by manually interpreting/connecting service output | Extraction stays in language adapter; `investigation.ts` owns candidate classification and evidence prompts |
| Change compiler dependencies behind a stable path | TS external source digest existed; Java classpath content was not represented in scan environment | `dependency-inputs.ts` owns bounded content hashing; `scan.ts` pins classpath, runtime, effective TS options and scanner code |
| Find independent work under a difficult reviewed requirement | Recursively fetch claim explanations and reconstruct alternatives in agent context | One paginated `claims.frontier` read with current revision/generation and explicit alternatives |
| Change a query or add a client | Retrieval behavior repeated in a client-side workflow | `local-query.ts` shares snapshot-pinned queries between CLI and existing MCP transport |

The local index owns transactions, indexes and projection history. The assurance kernel owns truth status and policy. No graph database, vector service, model SDK, new server, or second authorization system was added.

## Migration and scorecard

1. Import the supplied project into Git; preserve provenance in the initial commit.
2. Verify existing tests and build the durable stack.
3. Add the optional local projection and query workflow without changing gate policy.
4. Add read-only mission frontier and dependency-content fingerprints.
5. Fix declaration collisions revealed by a real project, preserving ordinary named identities.
6. Verify regression, persistence, concurrency, real-source extraction and synthetic scale.

| Design dimension | Supplied version | Evolved version |
|---|---|---|
| Required running services for TS/JS investigation | Assurance HTTP service | None |
| Policy/evidence authorities | One | One, unchanged |
| Investigation storage ownership | Primarily remote, client reconstructs useful views | One disposable local SQLite projection |
| Third-party runtime packages for local features | TypeScript | TypeScript; SQLite is provided by Node |
| Retrieval transports | SDK/CLI/MCP to service | Same MCP transport plus local CLI; local query logic shared |
| Semantic change surface | Agent reconstructs dependency/work frontier | Explicit source-impact and reviewed-argument work queries |
| Test setup | Kernel fixtures + HTTP/MCP harness | Retained; additional temporary SQLite/source fixtures |

## Remaining risks and next acceptance gates

This is ready for a **bounded large-project investigation pilot**, not certified as a release authority for arbitrary repositories. Automatic distributed extraction, cross-repository contract federation, retention/compaction, full call/data-flow graphs, and Python/Go/Rust semantic adapters are not implemented. Solution tsconfig references must be partitioned into concrete targets. Java import navigation is not yet projected as TS import edges are.

Before a wider rollout, label a representative sample of candidates with maintainers; measure useful precision by rule, context usefulness, and actual change-surface reduction. Inject known bypasses and dependency changes to measure invalidation recall. Then benchmark real parsers and PostgreSQL writer contention at the intended repository/agent concurrency. These are explicit acceptance gates, not already-passing claims.
