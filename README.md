# Assurance Memory

**Help coding agents find technical debt, retrieve the right source context, and keep engineering knowledge useful as a codebase changes.**

Assurance Memory is an investigation and assurance layer for TypeScript, JavaScript, and Java projects. Start with a local SQLite index that surfaces simplification candidates, inconsistent boundaries, reliability risks, and drift. Add the optional Java service when a team needs reviewed requirements, reusable arguments, independent evidence, and explicit debt repayment obligations.

The project is ready for **bounded large-project investigation pilots**. It has working extraction, persistent queries, MCP integration, and a tested assurance kernel. Detector precision and production capacity still need validation on representative projects.

[Get started](docs/GETTING_STARTED.md) · [Documentation](docs/README.md) · [Concepts](docs/CONCEPTS.md) · [Contribute](CONTRIBUTING.md) · [Pilot plan](docs/PILOT_PLAN.md) · [Detector backlog](docs/DETECTOR_BACKLOG.md)

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
node packages/agent/dist/src/local-cli.js investigate "lifecycle callbacks after release" --db examples/.assurance-cache/index.sqlite --limit 5 --max-bytes 24000
```

Commands print JSON. The deliberately unsafe fixture should produce investigation candidates. Read the returned source locations and evidence requirements before deciding whether a candidate represents debt.

The [getting started guide](docs/GETTING_STARTED.md) walks through your own TS/JS project, attributed Java analysis, pagination, drift, and MCP. All examples run from the repository checkout; no npm registry installation is required.

## What is implemented

| Capability | What you get | Boundary |
| --- | --- | --- |
| Candidate backlog | Ranked simplification, inconsistency, reliability, and coverage candidates with provenance and suggested checks | A candidate is a hypothesis, not a confirmed defect or a debt valuation |
| Source search | Normalized SQLite FTS5, exact-symbol lookup and explained bounded reranking | Raw source bodies and embeddings are not indexed |
| Task investigation | One bounded brief with source matches, owners, coverage, candidates and retained reviews | Explicit lexical selection; omitted subjects and entries remain visible |
| Task-start delivery | Refresh the index and deliver a task packet with source changes and exact prior notes | Prose remains unverified; delivery is not evidence of useful contribution |
| Context and impact | Lexical owners, nearby symbols, direct import neighbors and transitive reverse imports with predecessor witnesses | Import navigation currently covers component-local TS/JS imports; it is not a complete call graph |
| Drift | Added/removed subjects, changed signatures/effects, compiler inputs, and environment context | Results describe the most recent committed scan, not live filesystem state |
| Local MCP | Eight read-only investigation, status, search, backlog, context, impact, drift and review-history tools | Scanning, review append and archive operations remain explicit CLI actions |
| Retained investigation reviews | Source-bound counterevidence, history and explained priority adjustments | User-reported annotations cannot approve evidence or close debt |
| Review recovery | Bounded, complete archives of distinct originating annotations with original captures | Restored notes require re-review; full SQLite backups preserve every local audit event |
| Lifecycle admission lab | Source-pinned synthetic implementations, explicit contracts and replayable delayed-callback witnesses | Opt-in development checker; no production detector is enabled |
| Reviewed assurance | Immutable requirement revisions, AND/OR arguments, unresolved frontier, evidence applicability, persistent counterevidence | Review and independent checkers remain necessary |
| Agent coordination | Snapshot-pinned plans, fenced leases, explicit rebasing, debt proposals, and service-side release receipts | Actual Git promotion requires an external trusted integration |

Local scans publish atomically across the configured workspace. Incomplete discovery cannot erase prior findings. Readers see a consistent committed snapshot, and backlog cursors reject changed scans, review revisions or category filters.

## Local investigation or shared assurance

| | Local investigation | Optional assurance service |
| --- | --- | --- |
| Purpose | Find and inspect useful engineering work | Coordinate reviewed requirements and evidence |
| Runtime | Node 24.16+; JDK 21 for Java extraction | JDK 21, Maven 3.9+, PostgreSQL 17+; Node for agent tooling |
| Storage | One SQLite source projection plus retained local review records per workspace | Durable PostgreSQL records |
| Agent entry point | Local CLI or local MCP | SDK, service CLI, or authenticated MCP |
| Authority | Source-derived investigation only | Kernel-enforced requirement, evidence, and debt lifecycle |

To try the service workflow without PostgreSQL, install a full JDK 21 and run `npm run demo`. It starts a temporary loopback development service, exercises safe/unsafe cancellation models, and shuts down. See [optional service setup](docs/GETTING_STARTED.md#optional-assurance-service) for the distinction between this demo and durable deployment.

## Retrieval and retained counterevidence

Start from a symptom or intended change with `assurance-local investigate "TASK"`. Its default is five files within a 24,000-byte compact JSON budget; use `--limit` and `--max-bytes` to adjust that bounded brief. It reports lexical term selection, candidate coverage and omissions, then points to `context` and `reviews` for follow-up. The same operation is available as `assurance_local_investigate` in local MCP.

Search splits identifiers into words, normalizes a small set of lifecycle terms, and labels broader matches explicitly. Exact symbol lookup and nearby named owners help agents reach policy code without mistaking import neighbors for callers.

Candidates retain their original severity and explain every priority adjustment. Test-source reliability warnings receive lower priority. A current counterevidence review can reduce priority further, but never hides a finding or closes debt. Record a review with `assurance-local review --input review.json`; read its history through the CLI or the read-only `assurance_local_reviews` MCP tool. See the [review input and invalidation contract](docs/LOCAL_REFERENCE.md#local-reviews-and-counterevidence).

Review records are user-reported annotations with captured source provenance. Changed source, dependencies or assumptions invalidate their ranking influence; a later revert does not silently revive an old judgment. Use `review-export --output reviews.json` and `review-import --input reviews.json` to retain originating annotations across indexes. Imports remain stale or absent and never displace a locally submitted review. Preserve a SQLite-consistent backup for complete database recovery. See [review archives](docs/REVIEW_ARCHIVES.md), including schema-3 migration and size limits.

The [1.3 design decision](docs/decisions/003-task-investigation.md) records the task brief, recovery and evaluation boundaries; the [1.2 decision](docs/decisions/002-investigation-feedback.md) records the underlying ranking and review lifecycle. The [lifecycle lab](docs/LIFECYCLE_LAB.md) exercises actual synthetic implementations against an independent contract oracle and keeps results outside the scanner backlog. Production detectors remain [gated work](docs/DETECTOR_BACKLOG.md).

## Evidence and scale

Node tooling is **1.4.0**, with local schema **3**; Java modules remain **1.0.0**. The [task workflow](docs/TASK_WORKFLOW.md) delivers context at task start, and the [longitudinal harness](docs/LONGITUDINAL_PILOTS.md) evaluates successive changes with separate source and notes histories. The [investigation scale report](docs/INVESTIGATION_SCALE.md) separates synthetic query/review costs from real component extraction. TypeScript analysis dominated the measured unchanged scans; no incremental extraction benefit is established.

The [1.4 validation report](docs/VALIDATION_1_4.md) retains all twelve longitudinal assignments: eight accepted submissions, two preparation failures and two blocked descendants. Copying checkout-bound indexes caused the structured arm's second-cycle failures. The portable archive workflow was corrected and checked separately; the incomplete paired comparison establishes no maintenance-speed benefit.

The [1.3 validation report](docs/VALIDATION_1_3.md) records regression, durable-service, archive, task-brief and lifecycle/reuse checks with their measured scope. Agent outcome evidence is reported separately for the frozen tool revision actually used in the study.

The [1.2 validation report](docs/VALIDATION_1_2.md) records that release's 79 Node tests, 25 Java scenarios / 85 assertions, PostgreSQL checks and Spring restart test. Those are historical results, not a test-count claim for 1.3.

The [1.1 validation report](docs/VALIDATION_1_1.md) records Node and Java regression tests, real PostgreSQL transaction checks, a Spring restart test, and a real application scan. A synthetic **100,000-fact** local projection published initially in **15.5 seconds** on the recorded development machine. That measurement excludes compiler parsing and is not a production capacity claim.

```sh
npm test                                # Node + JDK 21 + Python 3; includes HTTP/MCP and harness tests
npm run test:local                      # Focused local SQLite/CLI/MCP checks
npm run test:lab                        # Lifecycle implementation lab and reuse checks
npm run test:pilot                      # Python harness behavior checks; no provider calls
node scripts/benchmark-investigation.mjs small
node scripts/benchmark-investigation.mjs larger
node scripts/benchmark-local.mjs 100000 # Synthetic projection benchmark
```

The current scanner extracts every configured component on each scan. Add `scan --profile` to separate compiler analysis, SQLite ingestion and reconciliation plus commit. Default discovery limits are 20,000 files per component, with a configurable 50,000-file ceiling and a 50,000-fact bound. The Java adapter has tighter request limits. Query results are bounded, and local history has no automatic retention. See [scaling](docs/SCALING.md) and the [local reference](docs/LOCAL_REFERENCE.md) before choosing partitions.

The [completed 16-run pilot](docs/VALIDATION_1_3_PILOTS.md) passed every protected check and blind mechanism review. None of the eight agents offered the optional frozen-1.2 CLI used it; three runs consulted generic workflow skills outside their allowed read scope. These results establish neither a retrieval benefit nor an outcome claim for the new 1.3 brief. The [pilot plan](docs/PILOT_PLAN.md) and [executable harness](docs/PILOT_HARNESS.md) define the next fresh evaluation and preserve all assigned outcomes and costs.

## Documentation and contribution

Start with the [documentation index](docs/README.md). The [contributor guide](CONTRIBUTING.md) explains development setup, implementation ownership, and the test matrix. [Troubleshooting](docs/TROUBLESHOOTING.md) covers compiler configuration, Java classpaths, SQLite, scan rollback, and service setup. The [security boundary](docs/SECURITY.md) describes how local metadata, agent authority, and trusted service roles are handled.

Bug reports should include a minimal reproducible fixture, runtime versions, the command, and relevant coverage output. Keep private source, local index files, credentials, and unsanitized scan reports out of public issues.
