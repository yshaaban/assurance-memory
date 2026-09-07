# Local investigation and agent workflow

## Scan once, then retrieve small units

Build with `npm ci --ignore-scripts && npm run build`. The local CLI is `node packages/agent/dist/src/local-cli.js`; the workspace package also declares the `assurance-local` executable.

```sh
node packages/agent/dist/src/local-cli.js scan --config workspace.json --db .assurance-cache/index.sqlite
node packages/agent/dist/src/local-cli.js status --db .assurance-cache/index.sqlite
node packages/agent/dist/src/local-cli.js backlog --db .assurance-cache/index.sqlite --limit 10 --category SIMPLIFICATION
node packages/agent/dist/src/local-cli.js search "payment retry" --db .assurance-cache/index.sqlite
node packages/agent/dist/src/local-cli.js context SUBJECT_ID --db .assurance-cache/index.sqlite
node packages/agent/dist/src/local-cli.js impact SUBJECT_ID --db .assurance-cache/index.sqlite --limit 100
node packages/agent/dist/src/local-cli.js drift 2 --db .assurance-cache/index.sqlite
```

`search` uses literal token conjunction over locators, tags and effects, ranked by SQLite FTS5 BM25. It does not embed code or index raw file bodies. It returns a bounded top set, not an exhaustive inventory. Read the cited source using ordinary repository tools.

`context` returns the subject, component scan metadata, candidate findings and bounded direct import neighbors. `impact` follows reverse imports transitively, handles cycles, and supplies a predecessor for each affected file. A `truncated` result means the supplied node budget is insufficient. Imports are potential change dependencies; they are not behavioral call-graph proofs. Currently this projection uses component-local TS/JS `IMPORT:` summaries.

`backlog` orders candidates by severity plus a small public-boundary bonus. Scores are transparent investigation priorities, not debt cost or defect probability. Use the returned opaque `next` value as `--after` to continue. A new scan invalidates that cursor rather than silently skipping work. Drift pages use immutable snapshot IDs and numeric row cursors.

Candidates include existing lifecycle/reliability rules, duplicate implementations, large functions, import cycles, layer violations, plus concentrated conditional decisions and mixed effect ownership. Every item states the evidence needed before acting.

## Iterate on a candidate

1. Check scan coverage and source revision. Rescan a changed checkout.
2. Choose a candidate and retrieve its context and import impact.
3. Read its actual implementation and callers. Identify the expected behavior and likely next change.
4. Decide whether it is a defect, an intentional boundary, or a simplification opportunity. Capture an explicit counterexample or a before/after change-surface argument.
5. If shared assurance is needed, propose the requirement and repayment obligations through the service. A maintainer reviews them; independent checkers supply evidence.
6. Make a bounded change and run the relevant behavior checks. Rescan and inspect drift. A disappearing candidate means it was not detected in that scan; it does **not** close a reviewed debt obligation.

Local findings are not automatically uploaded as approved requirements or evidence. Source and finding text remain untrusted data in both CLI and MCP output.

## Workspace boundaries and Java

Choose one component per build target, with at most 50,000 extracted facts and 20,000 source/config files by default (configurable discovery ceiling: 50,000 files). All indexed components must participate in a workspace scan. Changing a component root or dropping an indexed component requires a fresh index or a new inventory; it cannot silently erase a component's findings.

For Java, build the adapter with `bash scripts/test-java.sh` using JDK 21. Configure both `javaClasspath` (which can be empty for JDK-only code) and `javaCoreClassPath`:

```json
{
  "workspace": "backend",
  "components": {
    "service": {
      "root": "../backend/src/main/java",
      "javaClasspath": ["/absolute/build/dependencies/library.jar"],
      "javaCoreClassPath": "/absolute/path/assurance-memory/.build/java"
    }
  }
}
```

The resolved classpath contents, adapter classes and Java runtime are fingerprinted. Inputs are checked before and after Java extraction. Missing dependencies and incomplete discovery are errors rather than successful empty scans. The supplied JDK adapter retains its 2,000-file / five-megabyte request bound. Resolve dependencies outside the scanner; it never runs Maven or Gradle on repository instructions.

For TS solution projects, configure concrete target tsconfigs. Effective compiler options and resolved external source/type inputs participate in context identity even when the tsconfig is outside the component's source root. Unsupported languages are outside the declared TS/JS/Java inventory; COMPLETE discovery is not all-language semantic coverage.

## Local MCP

Use the existing bridge in local mode:

```json
{
  "mcpServers": {
    "assurance-local": {
      "command": "node",
      "args": ["/absolute/path/assurance-memory/packages/agent/dist/src/mcp.js"],
      "env": { "ASSURANCE_LOCAL_DB": "/absolute/path/index.sqlite" }
    }
  }
}
```

The exact outer configuration belongs to the client. Local mode opens SQLite read-only and exposes status, search, backlog, context, impact and drift. Scan through the CLI. The service token is unnecessary. Remove `ASSURANCE_LOCAL_DB` to use the original authenticated service tools instead; local mode never falls back to a remote mutation.

## Reviewed mission frontier

With the service running, use `assurance_frontier` over MCP or:

```sh
node packages/agent/dist/src/cli.js call claims.frontier --json frontier.json
```

`frontier.json`:

```json
{ "id": "payments.lifecycle", "limit": 20, "maxClaims": 500 }
```

The result distinguishes local evidence/repair work, missing reviewed decomposition, and unresolved argument alternatives. `allRequired` lists AND blockers inside one argument; separate arguments are OR routes. Changed premise revisions require argument review, not automatic rebinding. Supported routes yield no unnecessary frontier work. Continue with `after` plus the returned `fingerprint`; changing applicability requires restarting pagination. This query does not acquire a lease or replace `plans.prepare` before edits.

## Persistence and limits

The index uses SQLite WAL, one writer per workspace, and one atomic transaction across the configured scan. Readers keep seeing the last committed state. Failed scans roll back source facts, findings, drift and snapshot metadata together. A compiler is instantiated per component; the CLI does not retain every component's AST.

Persistence updates changed facts and FTS rows; unchanged rows are reused. **Compiler extraction still runs on every scan.** There is no unsafe cache based only on a Git commit or path timestamp. The 100,000-fact benchmark measures the projection independently of parsing.

Default queries return 20 records; the ceiling is 200. MCP also bounds response bytes. The database stores extracted metadata and drift history, not raw source bodies, but paths and identifiers can still be sensitive. Keep the database with the workspace. History currently grows without automatic retention; rotate this disposable projection according to disk budget. Keep durable assurance/evidence history in the service.
