# Contributing

Help make investigations useful and reviewed engineering knowledge reliable. Contributions should improve a concrete workflow: finding a meaningful candidate, retrieving enough context to assess it, detecting stale assumptions, or preserving requirement and evidence consistency.

Read [AGENTS.md](AGENTS.md) before changing code. The [foundation decision](docs/decisions/001-foundation.md), [concepts](docs/CONCEPTS.md), and [extension guide](docs/EXTENDING.md) explain the design constraints.

## Development setup

Use the official Node 24.16+ build, npm, and a full JDK 21. Maven 3.9+ and PostgreSQL 17+ are needed for durable service checks. Docker is optional; local tests do not require it.

```sh
git clone https://github.com/yshaaban/assurance-memory.git
cd assurance-memory
node --version
java -version
javac -version
npm ci --ignore-scripts
npm test
```

`npm test` compiles the TypeScript package, builds and exercises the dependency-free Java kernel, then runs all Node tests, including HTTP/MCP integration. It does not require PostgreSQL. On machines with multiple Java installations, ensure `java` and `javac` both select JDK 21 before running the suite.

Create a focused branch for your change. Keep generated output, SQLite indexes, credentials, private project source, and local scan reports out of commits. Use synthetic fixtures or public inputs with clear provenance in tests.

## Repository map and ownership

| Location | Responsibility |
| --- | --- |
| `packages/agent/src/analyzer.ts` | TS/JS compiler extraction and language-derived findings |
| `packages/agent/src/scan.ts` | Discovery, compiler-input identity, component analysis, and scan publication |
| `packages/agent/src/investigation.ts` | Candidate interpretation, classification, and validation prompts |
| `packages/agent/src/local-index.ts` | SQLite transactions, indexes, projection history, and import navigation |
| `packages/agent/src/local-query.ts` | Shared snapshot-consistent CLI/MCP query behavior and cursor validation |
| `packages/agent/src/mcp.ts` | Stdio transport, mode selection, tool definitions, and request/response bounds |
| `packages/agent/src/client.ts`, `cli.ts`, `runner.ts` | Service SDK/CLI and independent checker execution |
| `packages/agent/test/` | Node unit, extraction, local persistence, runner, HTTP, and MCP tests |
| `services/core/` | Dependency-free Java assurance kernel, compiler adapter, and core tests |
| `services/server/` | Spring Boot, JDBC/PostgreSQL, and durable integration checks |
| `schemas/`, `examples/`, `docs/` | Integration schemas, deliberate fixtures, and user/developer documentation |
| `scripts/`, `.github/workflows/` | Build/test helpers, benchmarks, deployment checks, and CI |

The Java kernel is the only authority for approved requirements, evidence applicability, counterevidence, and debt lifecycle. Local analysis is an investigation projection. Keep these responsibilities explicit when adding features.

## Test matrix

Run the smallest useful check during development, then the required checks for the final change. Do not substitute a synthetic benchmark for a parser or service correctness test.

| Change or purpose | Command | Prerequisites / coverage |
| --- | --- | --- |
| Compile TypeScript | `npm run build` | Node; strict compiler and declaration generation |
| Local SQLite/query behavior | `npm run test:local` | Node; persistence, scan rollback, drift, cursors, CLI/MCP, and local extraction cases |
| TS unit behavior | `npm run test:ts` | Node; analyzer and utility unit suite |
| Java kernel or adapter | `npm run test:java` | JDK 21; compiles `.build/java` and runs kernel scenarios |
| Service HTTP/MCP integration | `npm run test:e2e` | Node + JDK 21; temporary loopback service harness |
| Shared extraction, MCP, or core change | `npm test` | Node + JDK 21; required full regression suite |
| Local projection performance | `node scripts/benchmark-local.mjs 10000` | Run `npm run build` first; synthetic SQLite exercise |
| Larger projection measurement | `node scripts/benchmark-local.mjs 100000` | Run build first; record machine/runtime, memory, and workload limits |
| PostgreSQL storage/service change | `mvn -B -ntp -Ppostgres-it verify` | Maven + JDK + disposable PostgreSQL; actual database transactions |
| Durable service restart behavior | `bash scripts/test-spring.sh` | Packaged JAR from Maven; same disposable database and free port 8099 |

For the durable checks, first provision an isolated PostgreSQL database and configure:

```sh
export JDBC_URL=jdbc:postgresql://127.0.0.1:5432/assurance_test
export DB_USER=assurance_test
# Supply DB_PASSWORD through your protected environment.
mvn -B -ntp -Ppostgres-it verify
bash scripts/test-spring.sh
```

Use a disposable database: these checks create state, and the restart test deliberately persists and reopens it. The script creates temporary scoped service credentials and cleans up its server processes. Maven uses the real PostgreSQL driver; an in-memory substitute does not exercise the same locking and isolation behavior.

Documentation-only changes need working links, accurate examples, and an appropriate smoke check for modified commands. New tests should cover meaningful behavior or a regression risk, not merely mirror an implementation detail. There is no configured lint or formatter task; preserve the surrounding style and keep TypeScript strict compilation clean.

## Preserve the invariants

- Publish complete workspace inventories atomically. A failed component must not partially replace another component's facts, candidates, drift, or metadata.
- Keep coverage gaps explicit. Do not turn discovery truncation, omitted inputs, or partial semantics into a successful absence claim.
- Preserve deterministic subject identities and dependency fingerprints. Changes to extraction or candidate policy must make prior context staleness visible.
- Read related query data from the same committed snapshot. Keep pagination pins and category checks consistent between CLI and MCP through `local-query.ts`.
- Retain same-generation counterevidence and exact requirement revisions. A green retry, accepted exception, or changed premise cannot silently discharge an obligation.
- Keep proposal, approval, scanner, runner, and release authority separate. Local candidates and source-derived text must not acquire policy authority.
- Treat import reachability as potential change context. Do not present it as complete behavioral impact or call-graph coverage.

## Add a useful detector

Describe the mechanism it suspects, where it applies, what would falsify it, and which source evidence an investigator should read. Keep language extraction in the appropriate adapter and candidate interpretation in `investigation.ts`.

Include an example that should trigger and a realistic intentional design that should not become a confident defect claim. Exercise behavior such as changed dependencies, deletion, stale candidates, or preserved source provenance when relevant. Document unsupported cases and avoid calibrating a score as defect probability unless you have measured evidence.

For simplification work, explain the expected next change and how the proposal reduces the number of places that must change, clarifies state ownership, or makes behavior easier to verify. A smaller line count alone does not establish a better design. See [extending](docs/EXTENDING.md) for implementation details and [pilot planning](docs/PILOT_PLAN.md) for evaluation.

## Prepare a pull request

Lead with the concrete problem and resulting behavior. Include a small before/after example when it makes the change easier to assess. State the validation you actually ran, any untested path that matters, and effects on identities, schemas, compatibility, or scan policy.

Update the relevant guide, schema, example, or tool description when a public contract changes. Keep the README's capabilities and measured limits aligned with implementation. For architectural changes, add or amend a decision under `docs/decisions/` rather than relying on a PR discussion as the only record.

Before submitting, review your diff for accidental source or credential exposure and run `git diff --check`. Avoid unrelated dependency updates and generated artifacts. Do not report synthetic scale measurements as production capacity or model checking as implementation proof.

## Report a bug or propose a capability

Use a minimal reproducer with sanitized configuration, runtime versions, the exact command, and expected/actual behavior. For invalidation bugs, provide the sequence of revisions, scans, and queries. For a new capability, explain the investigation or assurance task it enables and how its usefulness can be measured.

Consult [troubleshooting](docs/TROUBLESHOOTING.md) for known setup problems and the [security boundary](docs/SECURITY.md) before including sensitive material in any public discussion.
