# Assurance Memory

**Help coding agents find technical debt, retrieve the right source context, and keep engineering knowledge useful as a codebase changes.**

Assurance Memory is an investigation and assurance layer for TypeScript, JavaScript, and Java projects. Start with a local SQLite index that surfaces simplification candidates, inconsistent boundaries, reliability risks, and drift. Add the optional Java service when a team needs reviewed requirements, reusable arguments, independent evidence, and explicit debt repayment obligations.

The project is ready for **bounded large-project investigation pilots**. It has working extraction, persistent queries, MCP integration, and a tested assurance kernel. Detector precision and production capacity still need validation on representative projects.

[Get started](docs/GETTING_STARTED.md) · [Documentation](docs/README.md) · [Concepts](docs/CONCEPTS.md) · [Contribute](CONTRIBUTING.md) · [Pilot plan](docs/PILOT_PLAN.md)

## Why this exists

Large codebases contain more context than an agent can usefully read in one session. An import graph helps navigation, but it does not explain which behavior matters, whether an old conclusion still applies, or what evidence would justify a simplification.

Assurance Memory connects two workflows:

1. **Investigate cheaply.** Scan a concrete build target, choose a candidate, retrieve its source and dependency context, and inspect what changed since the previous scan.
2. **Preserve reviewed knowledge.** Express important requirements as explicit claims and reviewed AND/OR arguments. Track the code, assumptions, checks, and counterexamples on which their current assessment depends.

The inspiration from Prove2Me is reusable decomposition and an explicit frontier of unresolved work. This is an engineering adaptation: a test result or reviewed software argument does not carry the guarantees of a formal proof. The [foundation decision](docs/decisions/001-foundation.md) compares the original Assurance Memory and ContractGraph implementations and explains the choice.

## Try the local workbench

Use the official **Node.js 24.16+** build, npm, and Git. TS/JS investigation needs no database service or model-provider account.

```sh
git clone https://github.com/yshaaban/assurance-memory.git
cd assurance-memory
npm ci --ignore-scripts
npm run build

node packages/agent/dist/src/local-cli.js scan --config examples/local-workspace.json
node packages/agent/dist/src/local-cli.js status --db examples/.assurance-cache/index.sqlite
node packages/agent/dist/src/local-cli.js backlog --db examples/.assurance-cache/index.sqlite --limit 10
node packages/agent/dist/src/local-cli.js search lifecycle --db examples/.assurance-cache/index.sqlite
```

Commands print JSON. The deliberately unsafe fixture should produce investigation candidates. Read the returned source locations and evidence requirements before deciding whether a candidate represents debt.

The [getting started guide](docs/GETTING_STARTED.md) walks through your own TS/JS project, attributed Java analysis, pagination, drift, and MCP. All examples run from the repository checkout; no npm registry installation is required.

## What is implemented

| Capability | What you get | Boundary |
| --- | --- | --- |
| Candidate backlog | Ranked simplification, inconsistency, reliability, and coverage candidates with provenance and suggested checks | A candidate is a hypothesis, not a confirmed defect or a debt valuation |
| Source search | SQLite FTS5 over locators, tags, and extracted effects | Raw source bodies and embeddings are not indexed |
| Context and impact | Source metadata, direct import neighbors, transitive reverse imports with predecessor witnesses | Import navigation currently covers component-local TS/JS imports; it is not a complete call graph |
| Drift | Added/removed subjects, changed signatures/effects, compiler inputs, and environment context | Results describe the most recent committed scan, not live filesystem state |
| Local MCP | Six read-only status, search, backlog, context, impact, and drift tools | Scanning remains an explicit CLI action |
| Reviewed assurance | Immutable requirement revisions, AND/OR arguments, unresolved frontier, evidence applicability, persistent counterevidence | Review and independent checkers remain necessary |
| Agent coordination | Snapshot-pinned plans, fenced leases, explicit rebasing, debt proposals, and service-side release receipts | Actual Git promotion requires an external trusted integration |

Local scans publish atomically across the configured workspace. Incomplete discovery cannot erase prior findings. Readers see a consistent committed snapshot, and backlog cursors reject changed snapshots or category filters.

## Local investigation or shared assurance

| | Local investigation | Optional assurance service |
| --- | --- | --- |
| Purpose | Find and inspect useful engineering work | Coordinate reviewed requirements and evidence |
| Runtime | Node 24.16+; JDK 21 for Java extraction | JDK 21, Maven 3.9+, PostgreSQL 17+; Node for agent tooling |
| Storage | One disposable SQLite index per workspace | Durable PostgreSQL records |
| Agent entry point | Local CLI or local MCP | SDK, service CLI, or authenticated MCP |
| Authority | Source-derived investigation only | Kernel-enforced requirement, evidence, and debt lifecycle |

To try the service workflow without PostgreSQL, install a full JDK 21 and run `npm run demo`. It starts a temporary loopback development service, exercises safe/unsafe cancellation models, and shuts down. See [optional service setup](docs/GETTING_STARTED.md#optional-assurance-service) for the distinction between this demo and durable deployment.

## Evidence and scale

The [1.1 validation report](docs/VALIDATION_1_1.md) records Node and Java regression tests, real PostgreSQL transaction checks, a Spring restart test, and a real application scan. A synthetic **100,000-fact** local projection published initially in **15.5 seconds** on the recorded development machine. That measurement excludes compiler parsing and is not a production capacity claim.

```sh
npm test                                # Node + JDK 21; includes HTTP/MCP tests
npm run test:local                      # Focused local SQLite/CLI/MCP checks
node scripts/benchmark-local.mjs 100000 # Synthetic projection benchmark
```

The current scanner extracts every configured component on each scan. Default discovery limits are 20,000 files per component, with a configurable 50,000-file ceiling and a 50,000-fact bound. The Java adapter has tighter request limits. Query results are bounded, and local drift history has no automatic retention. See [scaling](docs/SCALING.md) and the [local reference](docs/LOCAL_REFERENCE.md) before choosing partitions.

The [pilot plan](docs/PILOT_PLAN.md) defines how to measure useful candidate precision, retrieval quality, invalidation behavior, and simplification outcomes on larger projects.

## Documentation and contribution

Start with the [documentation index](docs/README.md). The [contributor guide](CONTRIBUTING.md) explains development setup, implementation ownership, and the test matrix. [Troubleshooting](docs/TROUBLESHOOTING.md) covers compiler configuration, Java classpaths, SQLite, scan rollback, and service setup. The [security boundary](docs/SECURITY.md) describes how local metadata, agent authority, and trusted service roles are handled.

Bug reports should include a minimal reproducible fixture, runtime versions, the command, and relevant coverage output. Keep private source, local index files, credentials, and unsanitized scan reports out of public issues.
