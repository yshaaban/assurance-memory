> Reference guide imported from 1.0.0. Commands run from the repository root. Original validation/version statements are historical; consult [1.4 validation](VALIDATION_1_4.md) for current results.

# Assurance Memory

**An executable, requirement-centered coordination and memory service for agents working on TypeScript/JavaScript and Java/Spring codebases.**

This repository implements the assurance-capsule concept: immutable requirements, explicit reviewed arguments, versioned implementation facts, scoped evidence, counterexamples, agent plans, fenced leases, and technical-debt decisions. A graph edge is not a proof, an agent note is not policy, a passing retry cannot erase a failure for the same obligation generation, and accepting debt does not make a violated requirement true.

This is substantial working source, not an architecture-only scaffold. It is also **not a claim that every form of drift is automatically detectable or that an unmeasured deployment will scale to every enterprise codebase**. Read [verification](VERIFICATION.md), [coverage](DRIFT_COVERAGE.md), and [scaling](SCALING.md) before using it as a release authority.

## What is implemented

| Layer | Implementation |
|---|---|
| Assurance kernel | Dependency-free Java 21; immutable claim revisions; AND/OR arguments; scope-membership-aware invalidation; historical snapshots; counterevidence; checker queues; debt lifecycle |
| Durable service | Spring Boot 4.0.3 adapter; PostgreSQL JDBC store and migration; tenant/workspace isolation; optimistic updates; workspace writer fencing; event log |
| Agent integration | Strict TypeScript SDK, CLI, 17 agent-facing MCP tools, context pagination, explicit plan rebasing, leases, handoffs, provenance and staleness |
| Analysis | TypeScript compiler API; JDK compiler tree API; framework/lifecycle candidate rules; configuration/schema/dependency fingerprints; external TS type-input digests |
| Independent execution | Allowlisted checker configuration outside worktrees; immutable Git inputs; protected checker scopes; sanitized child environment; Docker isolation; artifact digests; late-result rejection |
| Behavioral checks | Finite-state safety checker with replayable counterexamples; causal forbidden-order trace checker; workload-aware latency/rejection/error budgets |
| Delivery | Docker Compose; CI workflow; Java, TypeScript and HTTP/MCP regression tests; real-PostgreSQL test profile; Spring restart-persistence smoke script |

**Locally verified:** 24 Java kernel scenarios / 76 assertions; 18 Node tests including live TypeScript-to-Java HTTP and MCP integration; a 10,000-fact / 100-obligation synthetic invalidation exercise; the demonstration command. Spring/Maven dependency resolution, PostgreSQL execution, and Docker execution were unavailable in the authoring environment and are explicitly not reported as passing. The repository includes those verification paths.

## Requirements

Use a full **JDK 21**, **Node.js 22**, and npm. The JDK is necessary for compiler-tree analysis; a JRE-only image is insufficient. Maven 3.9+ and PostgreSQL 17+ are needed for the durable service. Docker/Compose are optional deployment and checker-execution paths.

The source pins TypeScript 5.8.3, Node 22 type definitions 22.19.7, and Spring Boot 4.0.3. These are compatibility selections, not assertions that they are the newest or currently security-cleared versions. Dependency downloads were unavailable during creation, so a package lock was not fabricated. Generate and review `package-lock.json` during your connected build, retain it, and use `npm ci` thereafter. Pin CI actions and deployment images by audited immutable digests in your environment.

## Run the complete local demonstration

```bash
npm install --ignore-scripts
npm test
npm run demo
```

The demo selects an available loopback port, starts the **non-durable** JDK server, scans deliberately unsafe TypeScript and Spring fixtures, approves example requirements, prepares an agent plan, reports blocked obligations, and checks safe/unsafe cancellation models. It then shuts the temporary server down. Set `DEMO_PORT` to choose a specific port.

The demo intentionally does not manufacture passing evidence. It should end with a safe model result, an unsafe model counterexample, and unresolved application obligations still blocked.

To keep a development server running interactively:

```bash
bash scripts/test-java.sh
java -cp .build/java dev.assurance.core.DevServer 8097
```

In another terminal:

```bash
export ASSURANCE_URL=http://127.0.0.1:8097
export ASSURANCE_WORKSPACE=demo
export ASSURANCE_TOKEN=demo-scanner-token
node packages/agent/dist/src/cli.js scan --config examples/workspace.json
```

The fixed `demo-{reader,agent,scanner,runner,maintainer}-token` credentials exist **only in the loopback development harness**. Never use that server or those credentials as a production service.

## Run Spring Boot and PostgreSQL

Generate independently scoped credentials outside agent-writable repositories:

```bash
node scripts/init-auth.mjs ../assurance-secrets demo demo

docker compose --env-file ../assurance-secrets/compose.env up --build
```

Compose publishes only `127.0.0.1:8080`. The generated directory contains `auth.json` with hashes, `credentials.json` with bearer tokens, and a private Compose environment file. Give each agent its own AGENT token; keep SCANNER, RUNNER and MAINTAINER credentials in separate operator-controlled processes. The server rejects credentials that combine those authority roles.

For a non-container deployment:

```bash
mvn -B -ntp package
export JDBC_URL=jdbc:postgresql://localhost:5432/assurance
export DB_USER=assurance
# Supply DB_PASSWORD using your secret manager or a protected shell environment.
export ASSURANCE_AUTH_FILE=/absolute/operator/path/auth.json
java -jar services/server/target/assurance-server-1.0.0.jar
```

TLS, credential rotation, backup/restore, database access policy, externally immutable audit storage, and organization-specific authorization must be configured before exposure beyond a trusted environment. [Security](SECURITY.md) defines what the supplied service does and does not enforce.

### Execute the durable-adapter verification

Against a disposable PostgreSQL database, set `JDBC_URL`, `DB_USER`, and `DB_PASSWORD`, then run:

```bash
mvn -B -ntp -Ppostgres-it verify
bash scripts/test-spring.sh
```

The first command tests real database locking, rollback, tenant isolation, keyset pagination and repeatable reads. The second starts the packaged Spring service, creates a controlled assurance flow, restarts the process, and checks persisted evidence and release-receipt applicability. It does not substitute an in-memory database for PostgreSQL.

## Configure a large codebase

Partition by build module, service, bounded package group, or lifecycle ownership boundary—not arbitrary equal-sized file chunks. Example:

```json
{
  "workspace": "payments",
  "components": {
    "gateway": {
      "root": "../application/gateway",
      "tsconfig": "tsconfig.json",
      "layers": [
        {"name": "domain", "match": "src/domain/**", "mayImport": []},
        {"name": "infra", "match": "src/infra/**", "mayImport": ["domain"]}
      ]
    },
    "settlement": {
      "root": "../application/settlement",
      "maxFiles": 20000
    }
  }
}
```

Paths are relative to the workspace configuration. Supply digest-valued `environment` entries for actual runtime, resolved artifact/classpath, deployment, schema, feature-flag and workload assumptions. Never put secret values in those entries. The scanner automatically includes its Node version and resolved external TypeScript source/type inputs; it does **not** claim those describe your deployed runtime or complete Java dependency resolution.

Remote Java analysis is parse-only and explicitly reports partial semantics. Local attributed Java analysis accepts `javaClasspath` and `javaCoreClassPath`; see [analysis and coverage](DRIFT_COVERAGE.md). Do not casually enable `allowPartialAnalysis`: it is an explicit reviewed concession, not a way to make an unexplained red badge disappear.

## Use it from an agent

```ts
import { AssuranceClient } from "@assurance-memory/agent";

const assurance = new AssuranceClient({
  baseUrl: process.env.ASSURANCE_URL!,
  workspace: "payments",
  token: process.env.ASSURANCE_TOKEN!,
});

const context = await assurance.expandObligations(await assurance.prepare({
  intent: "Fix cancellation cleanup without weakening tenant isolation",
  components: ["gateway", "settlement"],
  writeSelectors: ["component:gateway", "component:settlement"],
}));

await assurance.acquire(context.plan.id, 300);
// Read every mandatory requirement and existing counterexample before editing.
// Perform changes in an isolated Git worktree; renew the lease while working.
const beforePublication = await assurance.validate(context.plan.id);
```

A newly published snapshot deliberately makes the previous plan stale. Release old leases and prepare a new plan with `supersedes: oldPlanId`; never silently rebase the context. Independent runners assess the new generations. Only a RUNNER with `release-gate` permission can issue an exact-manifest receipt. Agents cannot do that through MCP.

Leases coordinate service-side intent and gate operations. They do not intercept arbitrary filesystem writes. Branch protection and a trusted merge queue must validate the exact source manifest and use Git compare-and-swap when applying a receipt. The receipt is not a signed attestation or a distributed transaction with Git.

## Connect MCP

Configure a stdio MCP server in your agent client using this executable and environment. The JSON below describes a common client configuration shape; the client controls the exact surrounding format.

```json
{
  "mcpServers": {
    "assurance-memory": {
      "command": "node",
      "args": ["/absolute/path/assurance-memory/packages/agent/dist/src/mcp.js"],
      "env": {
        "ASSURANCE_URL": "https://assurance.internal.example",
        "ASSURANCE_WORKSPACE": "payments",
        "ASSURANCE_TOKEN": "SET_FROM_YOUR_AGENT_SECRET_PROVIDER"
      }
    }
  }
}
```

The bridge implements the pinned MCP `2025-06-18` stdio compatibility revision. It exposes requirement/context/evidence retrieval, plans, leases, memory, debt proposals and rechecks. It exposes no command execution, policy approval, scan publication, checker-result submission, or release issuance. Tool annotations are descriptive; backend authorization is the actual boundary.

## Reading order

[Agent protocol](AGENT_PROTOCOL.md) explains the end-to-end workflow. [Architecture](ARCHITECTURE.md) defines identities and invariants. [API](API.md) documents all operations. [Drift coverage](DRIFT_COVERAGE.md) separates candidate detection from established evidence. [Scaling](SCALING.md), [security](SECURITY.md), and [verification](VERIFICATION.md) describe deployment constraints and measured results. [Sources](SOURCES.md) records primary technical references.

## Repository map

```text
packages/agent/src/     SDK, compiler analyzer, scanner, checker runner, MCP, CLI, NFRs
packages/agent/test/    Unit, HTTP, immutable-runner and MCP integration tests
services/core/         Dependency-free Java assurance kernel and compiler adapter
services/server/       Spring Boot adapter and real-PostgreSQL integration test
examples/              Deliberately unsafe inputs, capsules, finite models, agent guide
schemas/               JSON Schemas for integration/editor validation
scripts/               Credential initialization, demonstration, deployment smoke checks
verification/          Recorded local test and synthetic exercise outputs
.github/workflows/     Connected-build CI, including Spring/PostgreSQL verification
```
