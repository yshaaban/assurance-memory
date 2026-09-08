# Validation of investigation feedback in 1.2

Executed locally on 2026-09-08 with Node 24.16.0, JDK 21.0.12.1 and PostgreSQL 17 on macOS arm64. These are observed results for the Node tooling 1.2 change; Java modules remain 1.0.0.

## Regression and durable service

| Check | Result | Scope |
| --- | --- | --- |
| `npm test` | 78 Node tests; 25 Java scenarios / 85 assertions pass | Extraction, local SQLite, CLI/MCP, service boundaries and assurance behavior |
| `mvn -B -ntp -Ppostgres-it verify` | Build succeeds; 10 PostgreSQL assertions pass | Durable persistence, rollback, concurrency and isolation |
| `bash scripts/test-spring.sh` | Seed and restart-persistence pass | Packaged service preserves state across restart |

The PostgreSQL checks used a disposable local database. Its server and the Spring process were stopped after validation.

The added local regressions exercise behavior that can lose or misrepresent investigation knowledge:

- Source, cited facts, owner files, dependency direction/membership and recorded context changes invalidate reviews. Unchanged scans preserve applicability. Reverts and reappearing candidates cannot revive an invalidated review.
- History remains append-only; a later review supersedes earlier ranking influence. Current counterevidence lowers priority without removing the candidate or changing severity.
- Context and backlog agree on priority before limiting. Scan and annotation revisions invalidate pagination; malformed cursors fail instead of silently restarting.
- Failed CLI scans preserve the prior schema and snapshot. Search-policy changes require and rebuild the lexical projection, including when source facts are unchanged.
- Identifier spellings, lifecycle vocabulary, exact-symbol lookup, named file owners and explicit broader-match limits have controlled retrieval fixtures. CLI input cannot silently discard extra query words; MCP review access remains read-only.

## Reproducible projection exercise

Run `npm run build`, then `node scripts/benchmark-local.mjs 10000`. This existing benchmark creates one synthetic component, publishes initial/unchanged/one-change scans and performs 100 selective search-plus-context requests.

| Measurement | Observed |
| --- | ---: |
| Initial / unchanged / one-change publication | 266 / 59 / 68 ms |
| Changed-fact counts | 10,000 / 0 / 1 |
| Search + context p50 / p95 / p99 | 0.161 / 0.216 / 0.283 ms |
| SQLite bytes after close | 20,504,576 |
| Process peak RSS bytes | 185,909,248 |

This is one local run. It excludes compiler extraction, candidate ranking, retained reviews and remote-service work. It is not directly comparable to the larger workload in the [1.1 report](VALIDATION_1_1.md), and does not establish production capacity or agent efficiency.

Additional synthetic development probes covered broad FTS matches, many unrelated candidates, high-degree dependency owners and repeated historical reviews. They identified repeated hashing and unindexed lookups; the [design decision](decisions/002-investigation-feedback.md) records the resulting fixes and remaining limits. These diagnostic probes are not a standardized production benchmark.

## Agent outcome boundary

The earlier controlled lifecycle calibration produced successful repairs both with and without retrieval. It did not demonstrate an efficiency benefit. The tasks and lexical examples that informed this implementation are development data, not a held-out evaluation of 1.2.

Three senior agent review roles independently examined maintainability, performance and simplicity. Their findings improved the implementation; they do not constitute independent human certification or establish detector precision. No new detector is enabled in this change.

The next [pilot gate](PILOT_PLAN.md) must measure source-owner discovery and accepted patches on new symptom-only tasks, including intentional negative controls and stale review handling. Runtime dependency coverage, incremental compiler parsing, production recovery and representative end-to-end benefit remain unestablished.
