# Documentation

Assurance Memory has two connected workflows: local source investigation and optional shared assurance. Start locally, then add reviewed requirements and independent evidence where they help your team preserve engineering knowledge.

## Start and operate

| Guide | Use it for |
| --- | --- |
| [Getting started](GETTING_STARTED.md) | Install, run the fixture, scan a TS/JS or Java project, query results, and connect MCP |
| [Local reference](LOCAL_REFERENCE.md) | Workspace configuration, CLI/MCP query contracts, candidate categories, pagination, and limits |
| [Local workflow](LOCAL_WORKFLOW.md) | Choose a candidate, retrieve context, validate a hypothesis, and inspect drift after changes |
| [Troubleshooting](TROUBLESHOOTING.md) | Diagnose runtime, compiler, SQLite, pagination, and service failures |
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
| [Drift and analysis coverage](DRIFT_COVERAGE.md) | Understand which changes are tracked and what the analyzers cannot establish |
| [Scaling](SCALING.md) | Choose partitions and assess concurrency, retrieval, and storage limits |
| [1.1 validation report](VALIDATION_1_1.md) | Inspect measured regression, durable service, and projection benchmark results |
| [Verification model](VERIFICATION.md) | Understand the distinction between model checks, implementation checks, and historical results |
| [Pilot plan](PILOT_PLAN.md) | Design a representative large-project evaluation and its acceptance gates |
| [Extending the project](EXTENDING.md) | Add analysis or retrieval capabilities while preserving the assurance boundary |
| [Contributing](../CONTRIBUTING.md) | Set up development, select relevant tests, and prepare a pull request |
| [Sources](SOURCES.md) | Consult primary technical references |

## Read by task

- **I want an agent to find simplification opportunities:** [getting started](GETTING_STARTED.md) → [local workflow](LOCAL_WORKFLOW.md) → [local reference](LOCAL_REFERENCE.md).
- **I want reviewed behavior to survive changes:** [concepts](CONCEPTS.md) → [agent protocol](AGENT_PROTOCOL.md) → [API](API.md).
- **I want to evaluate this on a monorepo:** [scaling](SCALING.md) → [validation](VALIDATION_1_1.md) → [pilot plan](PILOT_PLAN.md).
- **I want to add a detector or improve extraction:** [contributing](../CONTRIBUTING.md) → [extending](EXTENDING.md) → [coverage](DRIFT_COVERAGE.md).

The local index is a disposable investigation projection. The assurance kernel remains the authority for reviewed requirements, evidence applicability, counterevidence, and debt decisions. Neither a missing candidate nor a successful source scan establishes that application behavior is correct.
