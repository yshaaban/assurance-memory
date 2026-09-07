# Troubleshooting

Start by checking the command's stderr, `node --version`, and the most recent local `status` output. A scan error can leave a valid older snapshot available; inspect its freshness before relying on it. All commands below run from the repository root.

## Node and SQLite

**`Local investigation requires SQLite FTS5` or `no such module: fts5`.** Use the official Node 24.16+ build. The local workbench depends on the SQLite version and compile options bundled with Node; installing a separate `sqlite3` executable does not repair Node's runtime. The recorded Node 22.13.1 compatibility run failed SQLite cases because FTS5 was unavailable.

**Node emits an experimental SQLite warning.** It may print a warning to stderr while the command succeeds. Check the exit status and parse stdout as JSON separately from stderr. Do not combine the streams when feeding results into a JSON consumer.

**`Cannot find module .../dist/src/local-cli.js`.** Build from the checkout root:

```sh
npm ci --ignore-scripts
npm run build
```

**Your agent client fails although the CLI works.** The client may launch a different Node executable or working directory. Use absolute paths for the MCP entry point and database; configure the command to resolve the same supported Node runtime that works in your terminal.

## Index location, history, and concurrent scans

| Symptom | Cause and next action |
| --- | --- |
| `--db is required` | Queries need an index path. For the supplied fixture, use `--db examples/.assurance-cache/index.sqlite`. |
| Cannot open the database, or `Initialize this index with the scan command first` | Run `scan` before any read-only query. Without `--db`, scan creates the index beside its configuration file, not necessarily beside your shell's current directory. |
| `Database belongs to a different workspace` | One index belongs to one workspace. Select a new database path for a different workspace name. |
| `Component root changed` | Resolved component roots are part of the indexed inventory. After moving a checkout or repartitioning, use a fresh index path. |
| `Every indexed component must be scanned` | A scan omitted a previously indexed component. Restore the complete configuration or deliberately start a new index for the new inventory. |
| `Index schema is newer than this tool` | Use a compatible tool revision. To regenerate disposable local data, scan into a new path. |
| Database is busy or locked | The local index allows one writer per workspace and waits up to five seconds for lock contention. Let the active scan finish and retry; serialize scheduled scans for that index. |

Use a new `--db` path when resetting a disposable projection. Keep an old database only if its drift history is useful, and close active readers/writers before archiving it. SQLite WAL files may contain committed data while connections are open; copying only the main file during an active scan is not a reliable backup.

## TypeScript coverage and source discovery

**Discovery is complete but semantics are partial.** These are separate assessments. Inspect `coverage.limitations` for compiler diagnostics and declared analyzer gaps. Resolve dependencies and choose the actual build-target tsconfig. Complete discovery does not imply complete type resolution or behavioral coverage.

**A monorepo root tsconfig produces unexpected diagnostics.** A solution tsconfig may contain only references. Configure one component per concrete target and point `tsconfig` to that target's effective configuration. Component roots resolve against the workspace JSON location; tsconfig paths resolve against the component root.

**`Incomplete discovery ... previous snapshot retained`.** Symlinks and oversized recognized inputs can make discovery partial. Inspect the listed omissions. Select real source roots, adjust a justified `maxFileBytes` bound, or declare intentional exclusions in configuration. Exclusions narrow the declared inventory and should be reviewed as coverage choices. Local scans will not publish incomplete discovery as source deletions.

**`Component exceeds its file limit` or the 50,000-fact partition bound.** Split by build target or a meaningful package boundary and use a new index for the changed inventory. Increasing the file limit cannot increase the hard fact bound. See [scaling](SCALING.md).

**`Source changed during scan`, `Source membership changed during scan`, or changed compiler inputs.** Stop edits, code generation, and dependency installation during extraction, then retry. A stable checkout is required to avoid mixing source versions. The failed workspace transaction rolls back.

**Unsupported-language files do not appear.** TS/JS and Java are the semantic adapters. Recognized configuration files receive fingerprints and limited configuration rules. Other languages are outside declared semantic coverage; an empty result does not establish that their code is debt-free.

## Java compiler and classpath

**`java` or `javac` cannot be found, or Java reports `release version 21 not supported`.** Install/select a full JDK 21 and put its `bin` directory on `PATH`. Check both `java -version` and `javac -version`. `JAVA_HOME` alone may not change which executable the local scanner launches: it invokes `java` from `PATH` in a restricted child environment.

**`Local Java scans require javaClasspath and javaCoreClassPath`.** Run `bash scripts/test-java.sh` to build the adapter, then configure both fields. Use `javaClasspath: []` for JDK-only source. Omitting it selects the remote parser path, which the local CLI cannot use.

**`javaCoreClassPath is required` or local Java analysis fails.** `javaCoreClassPath` must resolve to the compiled adapter directory, usually this checkout's `.build/java`. Application dependencies belong in `javaClasspath`. Relative paths in both fields resolve against the component root. Rebuild the adapter after changing Java source.

**A Spring or other framework project has unresolved types.** Supply the project's resolved dependencies as JARs/class directories. The scanner does not resolve Maven/Gradle dependencies for you. The remote Java parser may inspect framework syntax with partial semantics; local attributed analysis needs the actual dependency inputs.

**Java analysis times out or exceeds request bounds.** The local adapter has a 120-second timeout, a 32 MB response bound, and a request limit of 2,000 Java files / five megabytes. Select smaller coherent source components. The broader TS discovery limits do not override Java adapter bounds.

## Query results and pagination

| Symptom | Explanation |
| --- | --- |
| `Index changed; restart backlog pagination` | The cursor's snapshot or category no longer matches. Restart without `--after`; keep the category stable while paging. |
| Invalid backlog cursor or JSON parsing error | Pass the exact opaque `next` string. A drift cursor is numeric and cannot be used for backlog. |
| `Invalid drift cursor` | Use a positive numeric snapshot and a nonnegative numeric row cursor returned by that snapshot's drift page. |
| `Unknown subject ID; search first` | Use a search result's `id` or candidate's `subjectId`, not a candidate ID or path. After a rescan, search again if a declaration moved or disappeared. |
| `Unknown candidate category` | Use uppercase `SIMPLIFICATION`, `INCONSISTENCY`, `RELIABILITY`, or `COVERAGE`; omit the option for all categories. |
| `limit must be 1..200` | Supply an integer in that range. |
| Search returns nothing | Search indexes locators, tags, and effects; all supplied tokens must match. Try fewer tokens or search the source directly with `rg`. |
| Context/impact says `truncated: true` | The result budget was reached. Increase the limit up to 200 or investigate smaller source areas; do not interpret the page as a complete graph. |

An empty backlog, empty impact set, or disappearing candidate is not a correctness result. Impact currently follows component-local TS/JS imports, and candidate coverage depends on implemented rules. Read the [coverage guide](DRIFT_COVERAGE.md) before interpreting absence.

## Optional service and durable verification

**The service CLI requests `ASSURANCE_URL` or credentials during a local task.** `packages/agent/dist/src/cli.js` is the service client; use `local-cli.js` for SQLite. For MCP, set `ASSURANCE_LOCAL_DB` to select local read-only mode.

**The Spring service refuses to start without authentication or database settings.** The durable server requires `ASSURANCE_AUTH_FILE` and `DB_PASSWORD`. Set `JDBC_URL` and `DB_USER` for your provisioned PostgreSQL database; otherwise they default to the local `assurance` database/user. Generate scoped authentication with `scripts/init-auth.mjs`. The fixed demo tokens belong only to the temporary loopback harness.

**`init-auth.mjs` reports that a file exists.** The generator intentionally does not overwrite credential files. Reuse the existing protected configuration, or choose a new operator directory for a separate deployment.

**`test-spring.sh` asks you to run Maven first.** Run `mvn -B -ntp -Ppostgres-it verify` against a disposable PostgreSQL database, then the restart script. It expects `services/server/target/assurance-server-1.0.0.jar` and uses loopback port 8099. Check that port is free.

**A requirement remains blocked after a green retry.** Same-generation counterevidence remains visible. Review the exact requirement revision, evidence generation, coverage, and argument applicability through the service; accepting debt or rerunning a checker does not make a violated requirement true. See [agent protocol](AGENT_PROTOCOL.md).

## Reporting an issue

Include the exact command, exit status, runtime versions, expected/actual behavior, relevant coverage limitations, and a small synthetic fixture. For pagination or invalidation failures, include the sequence of scans and queries. Redact credentials, proprietary identifiers, absolute personal paths, and private index/report contents. See [contributing](../CONTRIBUTING.md) for the expected development and review workflow.
