> Historical 1.0.0 authoring report. Some download-era `.log` files mentioned below are not included in Git. Commands, runtime requirements and counts below describe that original environment. For the current checked-in release, use [1.3 validation](VALIDATION_1_3.md) and [getting started](GETTING_STARTED.md).

# Verification report

Recorded during creation on September 6, 2026. This report distinguishes executed checks from supplied but unexecuted deployment paths. It is not a production acceptance certificate.

## Executed

| Check | Result | Scope and retained evidence |
|---|---|---|
| Java kernel regression | **24 scenarios, 76 assertions passed** | Strict JSON, transactional rollback, optimistic concurrency, new-scope-member invalidation, immutable snapshots, stale evidence, freshness, sticky failure evidence, requirement authority, arguments/cycles, fenced agent work, debt disposition, memory staleness, finite models, causal traces, Java candidate extraction and HTTP authorization. `verification/java.log` and the combined `verification/tests.log`. |
| TypeScript strict build | **Passed** | Compiler checks for SDK, CLI, scanner, MCP, runner, NFR checks and tests. TypeScript 5.8.3 with `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. |
| Node regression suite | **18 tests passed: 12 unit + 6 integration** | Actual compiler extraction; 10,000-node iterative graph traversal; incomplete discovery and external-type digest changes; NFR accounting; immutable Git runner inputs; protected checker-scope tampering; child credential exclusion; live HTTP and MCP; stale evidence and gate receipts. `verification/tests.log`. |
| Local demonstration | **Passed** | Actual scan/requirement/plan flow and safe/unsafe cancellation models. Unresolved application obligations intentionally stay blocked. `verification/demo.log`. |
| Synthetic impact exercise | **Passed** | 10,000 generated facts and 100 scope-bound obligations; changing one fact invalidates exactly the matching obligation. One in-memory run, not PostgreSQL or production measurement. `verification/scale.json`. |
| PostgreSQL test source compilation | **Passed with JDK** | `JdbcStoreSelfTest.java` is dependency-free at compile time. Compilation does not establish actual database behavior. |
| Delivery consistency | **Passed** | JSON/Schema/example validation, YAML/XML parsing, shell/Node script syntax and local Markdown link checks. See `verification/delivery.log`. |

The combined test suite starts an actual loopback JDK HTTP service running the same kernel/router used by the Spring adapter. It does **not** start Spring or substitute an in-memory database result for a PostgreSQL integration result. The checker end-to-end test uses explicitly opted-in local execution with real Git snapshots and subprocesses. Docker isolation was not exercised.

## Test-fixture correction retained

A final repeated run exposed a nondeterministic assertion in the parallel-publication test: one contender used exactly the already-published `v1` input. A no-op can correctly succeed before a different contender changes the head, so the fixture could observe two successful responses without a lost update. The corrected fixture uses twelve distinct, non-base candidate versions; the kernel behavior was not weakened. The failed pre-correction log is retained in `verification/pre-fix-concurrency-fixture.log`, and the final suite plus repeated race runs use the corrected fixture.

## Environment

JDK/javac 21.0.11; Node.js 22.16.0; npm 10.9.2; TypeScript 5.8.3; Node type definitions 22.19.7. Locally available compiler and type packages were used for testing. No dependencies, global package symlinks, generated classes, or compiled TypeScript outputs are bundled in the source archive.

Maven and Docker were unavailable, there was no PostgreSQL service, and dependency downloads could not be completed. Therefore `npm install` from a clean online registry and Maven resolution were **not** verified. No fabricated package lock or fabricated integration logs are included.

## Implemented but not executed here

| Path | Verification supplied | Remaining validation |
|---|---|---|
| Spring Boot adapter and package | Maven multi-module build; CI workflow | Resolve Spring Boot 4.0.3 dependencies and compile/package against the real framework. |
| PostgreSQL persistence | `mvn -B -ntp -Ppostgres-it verify` | Execute 10 database assertions: migration, persistence, tenant isolation, rollback/events, concurrent CAS, repeatable reads, pagination. |
| Spring restart persistence | `bash scripts/test-spring.sh` | Starts packaged Spring, seeds evidence/receipt, restarts, and checks persistence against a disposable database. |
| Docker deployment and runner | Dockerfiles, Compose and digest-pinned runner execution path | Build/start on your Docker host; exercise filesystem, process, network and resource isolation. |
| Representative large repository | Partition controls and synthetic test | Measure real parsing coverage, SQL publication latency, contention, queue age, recall/precision, memory and failure recovery. |
| Adversarial production deployment | Role separation and documented boundaries | Independent security review; TLS/rotation; repository ACL requirements; protected CI policy; backup/restore; external audit retention. |

## Reproduce the executed checks

Use JDK 21, Node 22 and a connected package environment:

```bash
npm install --ignore-scripts
npm test
npm run demo
java -Xmx1g -cp .build/java dev.assurance.core.ScaleSelfTest 10000
```

The timings in the retained scale report are observations from one authoring-machine run, not acceptance thresholds. Test IDs, assertions and code are shipped so failures can be investigated rather than concealed by a badge. Generate and review a lockfile in a connected build; use `npm ci` for subsequent reproducible installation.

## What the results do not establish

The suite does not establish complete call/data-flow analysis, automatic extraction of all Spring behavior, model-to-code conformance, unbounded liveness/fairness, absence of security flaws, or every cause of drift/debt. It does not show million-line production performance, cross-workspace graph federation, disaster recovery or an atomic transaction between Git and the service. Candidate rules are review prompts, not proofs. Evidence policies must match the actual guarantees and include project-specific trusted checkers.

See [coverage](DRIFT_COVERAGE.md), [scaling](SCALING.md), [security](SECURITY.md), and [agent protocol](AGENT_PROTOCOL.md) before delegating release authority.
