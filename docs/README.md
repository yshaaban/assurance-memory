# Documentation

Assurance Memory has two connected workflows: local source investigation and optional shared assurance. Start locally, then add reviewed requirements and independent evidence where they help your team preserve engineering knowledge.

## Start and operate

| Guide | Use it for |
| --- | --- |
| [Getting started](GETTING_STARTED.md) | Install, run the fixture, scan a TS/JS or Java project, query results, and connect MCP |
| [Local reference](LOCAL_REFERENCE.md) | Task briefs, workspace configuration, eight CLI/MCP query contracts, scan profiling, local reviews, archive commands, migration, pagination and limits |
| [Local workflow](LOCAL_WORKFLOW.md) | Choose a candidate, retrieve context, validate a hypothesis, retain source-bound counterevidence, and inspect drift after changes |
| [Review archives](REVIEW_ARCHIVES.md) | Export complete originating annotations, restore stale history, preserve provenance and distinguish archives from full SQLite backups |
| [Troubleshooting](TROUBLESHOOTING.md) | Diagnose runtime, compiler, schema migration, review applicability, pagination, and service failures |
| [Security boundary](SECURITY.md) | Understand metadata sensitivity, authorization, checker isolation, and deployment limits |
| [Releasing](RELEASING.md) | Prepare and verify a publication or release |

## Understand and integrate

| Guide | Use it for |
| --- | --- |
| [Concepts](CONCEPTS.md) | Distinguish source facts, candidates, requirements, arguments, evidence, and debt |
| [Architecture](ARCHITECTURE.md) | Understand identities, storage boundaries, invalidation, and authority |
| [Agent protocol](AGENT_PROTOCOL.md) | Follow the reviewed requirement, plan, lease, checker, and handoff workflow |
| [API](API.md) | Integrate with the assurance service operation interface |
| [Schemas](../schemas/README.md) | Find the JSON contracts supplied for integrations |
| [Reference service guide](REFERENCE_README.md) | Find the imported service/deployment workflow; historical validation is explicitly labeled |

## Evaluate and extend

| Guide | Use it for |
| --- | --- |
| [Foundation decision](decisions/001-foundation.md) | Read the Assurance Memory vs. ContractGraph comparison and the Prove2Me-inspired design decision |
| [Investigation feedback decision](decisions/002-investigation-feedback.md) | Understand the 1.2 retrieval, ranking and review lifecycle choices and what independent agent reviews changed |
| [Task investigation decision](decisions/003-task-investigation.md) | Understand the 1.3 task brief, archive, lab and evaluation boundaries, contract preservation and measured scorecard |
| [Drift and analysis coverage](DRIFT_COVERAGE.md) | Understand which changes are tracked and what the analyzers cannot establish |
| [Scaling](SCALING.md) | Choose partitions and assess concurrency, retrieval, and storage limits |
| [Investigation scale diagnostics](INVESTIGATION_SCALE.md) | Reproduce bounded task/review workloads and separate compiler analysis, ingestion and reconciliation costs |
| [1.1 validation report](VALIDATION_1_1.md) | Inspect measured regression, durable service, and projection benchmark results |
| [1.2 validation report](VALIDATION_1_2.md) | Inspect retrieval/review regression results, service checks and the remaining agent-outcome gate |
| [1.3 validation report](VALIDATION_1_3.md) | Inspect task-brief/archive, lifecycle/reuse and durable-service validation, with version and outcome boundaries |
| [Frozen agent pilot results](VALIDATION_1_3_PILOTS.md) | Inspect all 16 outcomes, blind acceptance, source-owner recall, tool uptake, provider counters and protocol deviations |
| [Verification model](VERIFICATION.md) | Understand the distinction between model checks, implementation checks, and historical results |
| [Pilot plan](PILOT_PLAN.md) | Design a representative large-project evaluation and its acceptance gates |
| [Pilot harness](PILOT_HARNESS.md) | Freeze inputs, run bounded randomized assignments, protect evaluation and retain complete outcome denominators |
| [Lifecycle admission lab](LIFECYCLE_LAB.md) | Execute pinned synthetic implementations against an independent contract and inspect replayable divergence witnesses |
| [Gated detector backlog](DETECTOR_BACKLOG.md) | Review proposed mechanisms, required facts, negative controls and graduation criteria; these detectors are not shipped |
| [Extending the project](EXTENDING.md) | Add analysis or retrieval capabilities while preserving the assurance boundary |
| [Contributing](../CONTRIBUTING.md) | Set up development, select relevant tests, and prepare a pull request |
| [Sources](SOURCES.md) | Consult primary technical references |

## Read by task

- **I want an agent to find and review simplification opportunities:** [getting started](GETTING_STARTED.md) → [local workflow](LOCAL_WORKFLOW.md) → [local reference](LOCAL_REFERENCE.md).
- **I want reviewed behavior to survive changes:** [concepts](CONCEPTS.md) → [agent protocol](AGENT_PROTOCOL.md) → [API](API.md).
- **I want to evaluate this on a monorepo:** [scaling](SCALING.md) → [scale diagnostics](INVESTIGATION_SCALE.md) → [pilot plan](PILOT_PLAN.md) → [pilot harness](PILOT_HARNESS.md).
- **I want to add a detector or improve extraction:** [contributing](../CONTRIBUTING.md) → [extending](EXTENDING.md) → [gated detector backlog](DETECTOR_BACKLOG.md) → [coverage](DRIFT_COVERAGE.md).

Version 1.3.0 uses local schema 3 and adds task-oriented briefs, retained review archives, profiling and bounded evaluation tools. Local MCP exposes eight read-only tools; scanning, migration, review append and archive operations use the CLI. Restored annotations require local re-review. Preserve a SQLite-consistent backup for full source/drift/review/restore history. The assurance kernel remains the authority for reviewed requirements, evidence applicability, counterevidence and debt decisions. A brief, a lab observation or a current user note cannot establish complete application correctness. The 1.1 and 1.2 reports retain historical evidence; [1.3 validation](VALIDATION_1_3.md) distinguishes current implementation checks from the separately frozen pilot revision.
