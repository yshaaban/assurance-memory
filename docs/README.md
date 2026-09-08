# Documentation

Assurance Memory has two connected workflows: local source investigation and optional shared assurance. Start locally, then add reviewed requirements and independent evidence where they help your team preserve engineering knowledge.

## Start and operate

| Guide | Use it for |
| --- | --- |
| [Getting started](GETTING_STARTED.md) | Install, run the fixture, scan a TS/JS or Java project, query results, and connect MCP |
| [Local reference](LOCAL_REFERENCE.md) | Workspace configuration, CLI/MCP query contracts, normalized search, source-aware ranking, local review records, atomic scan upgrades, search-policy freshness, pagination, and limits |
| [Local workflow](LOCAL_WORKFLOW.md) | Choose a candidate, retrieve context, validate a hypothesis, retain source-bound counterevidence, and inspect drift after changes |
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
| [Drift and analysis coverage](DRIFT_COVERAGE.md) | Understand which changes are tracked and what the analyzers cannot establish |
| [Scaling](SCALING.md) | Choose partitions and assess concurrency, retrieval, and storage limits |
| [1.1 validation report](VALIDATION_1_1.md) | Inspect measured regression, durable service, and projection benchmark results |
| [1.2 validation report](VALIDATION_1_2.md) | Inspect retrieval/review regression results, service checks and the remaining agent-outcome gate |
| [Verification model](VERIFICATION.md) | Understand the distinction between model checks, implementation checks, and historical results |
| [Pilot plan](PILOT_PLAN.md) | Design a representative large-project evaluation and its acceptance gates |
| [Gated detector backlog](DETECTOR_BACKLOG.md) | Review proposed mechanisms, required facts, negative controls and graduation criteria; these detectors are not shipped |
| [Extending the project](EXTENDING.md) | Add analysis or retrieval capabilities while preserving the assurance boundary |
| [Contributing](../CONTRIBUTING.md) | Set up development, select relevant tests, and prepare a pull request |
| [Sources](SOURCES.md) | Consult primary technical references |

## Read by task

- **I want an agent to find and review simplification opportunities:** [getting started](GETTING_STARTED.md) → [local workflow](LOCAL_WORKFLOW.md) → [local reference](LOCAL_REFERENCE.md).
- **I want reviewed behavior to survive changes:** [concepts](CONCEPTS.md) → [agent protocol](AGENT_PROTOCOL.md) → [API](API.md).
- **I want to evaluate this on a monorepo:** [scaling](SCALING.md) → [current validation](VALIDATION_1_2.md) → [pilot plan](PILOT_PLAN.md).
- **I want to add a detector or improve extraction:** [contributing](../CONTRIBUTING.md) → [extending](EXTENDING.md) → [gated detector backlog](DETECTOR_BACKLOG.md) → [coverage](DRIFT_COVERAGE.md).

Version 1.2.0 adds normalized bounded retrieval and append-only, source-bound local review notes. Local MCP exposes seven read-only tools; scanning, migration and review append use the CLI. The source projection is rebuildable, but its SQLite database may hold the only copy of local review records. Preserve it with a SQLite-consistent backup before replacement or deletion. The assurance kernel remains the authority for reviewed requirements, evidence applicability, counterevidence, and debt decisions. Neither a missing candidate, a current user-reported note, nor a successful source scan establishes that application behavior is correct. The 1.1 validation report records that release's evidence, not a validation claim for 1.2.
