# Validation of the 1.1 evolution

Executed locally on 2026-09-07, macOS arm64, Node 24.16.0, JDK 21.0.12.1, Maven 3.9.16 and PostgreSQL 17.11. These are observed environment versions, not recommendations to use the latest available release.

For the Homebrew JDK installed during this task, the Java checks used:

```sh
export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
```

The disposable PostgreSQL server was stopped after validation. Local TS/JS investigation needs only Node.

## Regression and durable service

| Check | Result | What it establishes |
|---|---|---|
| `npm test` | 25 Java scenarios / 85 assertions; 30 Node tests pass | Original behavior plus local persistence, rollback, WAL readers, drift, query cursors, MCP, identity fixes, dependency hashing and frontier |
| `mvn -B -ntp -Ppostgres-it verify` | Build succeeds; 10 real PostgreSQL assertions pass | Store persistence, rollback, optimistic writer race, isolation, repeatable reads, reverse links and keyset pages |
| `bash scripts/test-spring.sh` | Seed and restart-persistence pass | Real packaged Spring service retains evidence and release-receipt applicability across restart |
| `ScaleSelfTest 10000` | 10,000 facts / 100 claims; one matching obligation invalidates | Existing in-memory assurance invalidation behavior, not database throughput |
| ContractGraph reference tests | 49 Java checks and 47 Node tests pass | Comparison used working source, not README claims alone |

ContractGraph's shell script uses Bash `mapfile`, unavailable in macOS's default Bash. Its exact Java sources and test main were compiled directly with JDK 21, then its unchanged Node suite ran. Its Spring/PostgreSQL service was not validated in this task.

The original Assurance Memory suite passed before evolution. The new suite retains all original tests and adds 12 local cases plus one Java mission-frontier scenario. An additional run on Node 22.13.1 passed 21 of 30 Node tests but failed nine SQLite cases because its bundled SQLite lacks FTS5. The evolved package therefore requires Node 24.16+, the verified runtime, and checks FTS5 availability with a clear startup error. The failure log is retained as compatibility evidence rather than presented as a pass.

## 100,000-fact local projection exercise

Run: `node scripts/benchmark-local.mjs 100000`. Ten components of 10,000 synthetic facts; initial scan, unchanged scan, one-source-change scan, then 100 search-plus-context requests. Results are asserted by the benchmark, including exact drift counts.

| Measurement | Observed |
|---|---:|
| Initial publication | 15,472 ms |
| Unchanged publication | 1,914 ms |
| One-fact-change publication | 1,762 ms |
| Recorded changed-fact counts | 100,000 → 0 → 1 |
| Search + context p50 / p95 / p99 | 0.475 / 0.877 / 1.877 ms |
| SQLite file after close | 202,694,656 bytes |
| Process peak RSS | 450,641,920 bytes |

These are one-run **SQLite projection** measurements. They exclude compiler parsing, the remote service, PostgreSQL, multi-machine concurrency and real detector precision. The unchanged scan reuses index rows; it does not demonstrate incremental compiler parsing. The workload contains imports but no candidate backlog, so these query timings do not measure category-filtered candidate retrieval at 100,000 findings.

## Real source exercises

A self-scan covered the agent package and JDK core: 435 facts and 35 candidates in roughly 2.7 seconds at that intermediate revision. Java type resolution succeeded; TS semantics remained conservatively partial. This is a development diagnostic, not a clean final-revision attestation.

A read-only scan of a private TypeScript/React application, using its concrete application tsconfig, extracted **12,407 facts** and **1,044 candidates** in **13,498 ms**. Discovery completed. Semantic coverage was PARTIAL with **78 compiler diagnostics**; no green assurance result was manufactured. The earlier solution-config scan demonstrated why a concrete build-target tsconfig is necessary.

This exercise exposed and drove fixes for repeated local declaration names in separate callbacks and a function named `file` colliding with its containing source-file identity. Regression tests cover both.

The simplification category returned functions with concentrated conditional decisions. These are **review candidates**, not validated defects. The application source was not changed, its scripts were not executed, and no precision/recall claim is made. Repository names, source identifiers and raw project reports are excluded from the public repository; the aggregate measurements above are retained.

## Remaining validation boundary

Not established: production failover or disaster recovery, TLS/SSO deployment, external Git-provider promotion enforcement, container execution, full interprocedural semantic coverage, distributed monorepo extraction, cross-repository evidence reuse, or debt valuation. The local workbench supports a bounded project pilot; larger rollout needs the acceptance gates in the foundation decision.

Raw summaries and logs are in `verification/evolution/`. Download-era evidence remains separate in the imported history.

## Public-snapshot validation addendum

The prepublication source review added two regression cases: Java large-method candidate categorization and local candidate-policy implementation changes across process restarts. The current local suite passes **32 Node tests** and **25 Java scenarios / 85 assertions**. CLI help now agrees with the query default of 20 records.

The original 30-test run remains in `verification/evolution/tests-node24.txt` as historical evolution evidence. The publication run is retained separately as `verification/evolution/publication-tests.txt`. Personal filesystem prefixes are normalized in published logs. A fresh export of the staged source tree also passed `npm ci --ignore-scripts` and the full 32-Node/25-Java suite. Documentation checks passed for 30 Markdown files and 21 JSON/JSONL examples, and onboarding smoke tests exercised the documented TS and Java paths. GitHub Actions provides a separate hosted check after publication.
