# Validation of the investigation workflow in 1.3

Executed locally on 2026-09-08 with Node 24.16.0, JDK 21.0.12.1 and PostgreSQL 17 on macOS arm64. Node tooling is 1.3.0; Java modules remain 1.0.0. The local projection uses schema 3. These results describe the implemented behavior and bounded exercises; they do not establish production capacity or a coding-agent efficiency benefit.

## Regression and durable service

| Check | Observed result | Scope |
| --- | --- | --- |
| `npm test` | 121 Node tests; 25 Java scenarios / 85 assertions; 11 Python harness tests pass | Extraction, SQLite, CLI/MCP, assurance behavior and evaluator harness |
| `mvn -B -ntp -Ppostgres-it verify` | Build succeeds; 10 PostgreSQL assertions pass | Persistence, rollback, concurrency and isolation |
| `bash scripts/test-spring.sh` | Seed and restart-persistence pass | Packaged service state survives restart |
| `node examples/lifecycle-lab/run.mjs --summary` | 13 executed fixture cases: 3 expected violations and 10 no-violation observations | Delayed callbacks, replacement owners, absorbing/restartable behavior and accepted current traffic |
| `node examples/lifecycle-lab/reuse.mjs` | Change/revert/recheck/review/recovery sequence completes | Actual pinned public fixture callbacks connected to the existing review store |

PostgreSQL used a disposable local database. The database server and Spring process were stopped after validation. The Python harness tests make no provider calls. CI also runs the existing 10,000-fact projection benchmark, the small investigation workload and the lifecycle fixture matrix.

## Task brief and retained reasoning

The new task entry point composes existing index queries within one SQLite read transaction. CLI and MCP share the operation. Tests cover enclosing source owners, attached current counterevidence, restored base priority after staleness, partial compiler coverage, strict input limits, empty lexical retrieval and omitted entries under a small response budget.

Candidate lookup is explicitly bounded to three visible subjects per file entry. A regression places a finding on an omitted nearby symbol and checks that the brief exposes its ID for follow-up and reports truncation. An empty candidate list is not a claim that the file contains no candidates. Separate checks confirm exact compact JSON byte accounting, including a 10,001-byte decimal boundary; the CLI newline and MCP transport envelope are outside that payload budget.

The source-pinned lifecycle reuse example executes the guarded public fixture and records its finite observations as user-reported counterevidence. Its opportunity is explicitly a manually registered workflow fixture, not a scanner detection. The sequence demonstrates:

1. An unchanged rescan retains a current review and its priority adjustment.
2. A captured source edit makes that review stale. Old lab pins cause `UNKNOWN` / `NOT_EXECUTED` before invoking the changed source.
3. Restoring the original source bytes does not revive the review.
4. A new successful execution still requires a fresh local review submission.
5. An independent unchanged component retains its own current review.
6. Exported current annotations restore as permanently stale and cannot lower priority.

The lab report also binds the initialized compiled checker and utility bytes. A mismatch before execution prevents adapter invocation; a mismatch during execution yields unknown applicability. The reuse example captures that implementation digest and Node runtime identity in component context. A regression varies those context inputs while keeping source, contract and trace fixed, checking permanent review invalidation after change and revert.

This is selective reuse under explicitly stable component context. The captured source revision and scanner implementation remain conservative invalidation inputs: a new repository revision or tool build can stale reviews without a behavior change. The example does not establish cross-commit minimal invalidation or authenticate the reviewer's reasoning.

## Archive recovery and compatibility

Archive checks cover history beyond the 200-row query page, disappeared candidates/components, original captures and invalidations, repeated imports, returning an archive to its origin, multiple recovery hops and consistent WAL readers. Imported annotations never displace locally submitted review priority; backlog, context and task briefs agree on that behavior.

Malformed/corrupt/noncanonical archives, duplicate records, unsupported fields and oversized complete archives are rejected. CLI corruption validation precedes database creation. Export uses an exclusive output file with owner-only permissions; it cannot overwrite an existing archive. Import is atomic, including its revision, under both its savepoint and the caller's transaction. Fabricated but correctly checksummed provenance remains stale user-reported data.

An invalidation can converge with an already imported historical record. The regression preserves both SQLite audit rows while exporting their identical originating record once. This distinguishes the portable originating-note archive from a complete SQLite restore-event backup. See [archive semantics and limits](REVIEW_ARCHIVES.md).

Failed scans preserve the previous schema, source snapshot, review history and query view. A successful schema-2 migration retains existing records. Schema-3 indexes reject older incompatible tools; read-only commands do not migrate an old index. If the original source inventory cannot be scanned, preserve a SQLite-consistent backup and compatible historical tooling. No archive-only migration or automatic history deletion was added.

## Scale and outcome boundaries

The [investigation workload report](INVESTIGATION_SCALE.md) records synthetic 2,000/20,000-fact runs, 250/2,000 incoming dependencies, 100/500 retained reviews and two frozen application component profiles. Both synthetic presets assert unchanged drift, invalidation beyond dependency pagination, permanent staleness, bounded JSON and complete archive recovery.

TypeScript analysis accounted for approximately 97–98% of the measured unchanged scan time. Profiling measurements stay outside indexed source/context identity; toggling `--profile` within the same build preserves source results and review freshness. The measurements support an equivalence-gated incremental-analysis experiment, but this release keeps full extraction. Shared-host timings, repeated reviews of one owner and partial semantic coverage limit generalization.

The separate [agent pilot report](VALIDATION_1_3_PILOTS.md) records the frozen 1.2 tool comparison conducted during this work. It is not an outcome evaluation of the new 1.3 task entry point. Protected tests, independent acceptance review, necessary-source inspection and provider costs remain distinct measurements. Private task sources, expected owners, hidden tests, traces and raw reports are excluded from this repository.

Senior agent perspectives on maintenance, performance, simplicity and correctness found and corrected concrete integration defects. The reviewers are AI agents, not independent human certification. The lifecycle lab remains opt-in development infrastructure. No production detector was enabled, no local report gained assurance authority, and no incremental compiler-result cache was introduced.
