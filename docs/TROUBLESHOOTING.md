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
| Cannot open the database, or `Index needs initialization or schema migration; run scan with this tool first` | Run a successful `scan` with the new tool before read-only queries or review append. Version 1.4.0 validates scan configuration before writable open, then commits schema-1/2 migration to schema 3 and search rebuild with the successful scan. Failure retains the previous schema and snapshot. MCP/read-only access, including `review-export`, does not migrate. Without `--db`, scan selects the index beside its configuration file. |
| `Search policy changed; run scan with this tool before querying` | The stored search-policy digest differs from compiled `local-search.js`. Rebuild/restart the tool after code changes, then run a successful `scan` to rebuild search metadata, including unchanged facts. This gate also applies to `status`, MCP and review append. Queries do not rebuild the index. Preserve the database and its reviews; no replacement is needed. |
| `Database belongs to a different workspace` | One index belongs to one workspace. Use a separate database path for a different workspace; preserve the existing database and its reviews. |
| `Component root changed` | Resolved component roots are part of the indexed inventory. After moving a checkout or repartitioning, preserve the old database with a SQLite-consistent backup, then use a new index path; reviews transfer only through an explicit archive import and remain stale or absent; source identities are not remapped. |
| `Every indexed component must be scanned` | A scan omitted a previously indexed component. Restore the complete configuration, or preserve the old database and its reviews before starting a new index for the changed inventory. |
| `Index schema is newer than this tool` | Use a compatible tool revision. Preserve local review history with a SQLite-consistent backup before any replacement; source reconstruction does not recover annotations. |
| Database is busy or locked | The local index allows one writer per workspace and waits up to five seconds for lock contention. Let the active scan finish and retry; serialize scheduled scans for that index. |

Source metadata is rebuildable; local review records are not. The database may be their only copy. Before replacement, deletion or moving to a new inventory, preserve it using SQLite-consistent backup tooling, such as the SQLite backup API, and retain that copy for history lookup. SQLite WAL files may contain committed data while connections are open; copying only a live main file is not a reliable backup. The service does not automatically retain these local annotations. [Review archives](REVIEW_ARCHIVES.md) transfer bounded distinct originating notes with permanently stale applicability; they do not replace the full backup of local restore events. A schema-2 index cannot be exported with 1.3 until a successful scan migrates it. If the original source inventory cannot be scanned, keep the backup and compatible historical tooling for history lookup; do not manually change `user_version`.

## TypeScript coverage and source discovery

**Discovery is complete but semantics are partial.** These are separate assessments. Inspect `status` component `coverage.limitations` for full compiler diagnostics and declared analyzer gaps. `context` shows at most eight limitations and exposes `limitationCount`/`limitationsTruncated`; it omits environment and executed-rule inventories. Resolve dependencies and choose the actual build-target tsconfig. Complete discovery does not imply complete type resolution or behavioral coverage.

**A monorepo root tsconfig produces unexpected diagnostics.** A solution tsconfig may contain only references. Configure one component per concrete target and point `tsconfig` to that target's effective configuration. Component roots resolve against the workspace JSON location; tsconfig paths resolve against the component root.

**`Incomplete discovery ... previous snapshot retained`.** Symlinks and oversized recognized inputs can make discovery partial. Inspect the listed omissions. Select real source roots, adjust a justified `maxFileBytes` bound, or declare intentional exclusions in configuration. Exclusions narrow the declared inventory and should be reviewed as coverage choices. Local scans will not publish incomplete discovery as source deletions.

**`Component exceeds its file limit` or the 50,000-fact partition bound.** Split by build target or a meaningful package boundary. Preserve the current database and its review history with a SQLite-consistent backup before using a new index for the changed inventory. Increasing the file limit cannot increase the hard fact bound. See [scaling](SCALING.md).

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
| `Index changed; restart backlog pagination` | The cursor's scan, review revision or category no longer matches. Restart without `--after`; keep the category stable. Even an unchanged scan or a newly appended annotation requires a fresh page. |
| Invalid backlog/review cursor or JSON parsing error | Pass the exact opaque `next` string to the same query/candidate/category. Drift cursors are numeric and are not interchangeable. |
| `Invalid drift cursor` | Use a positive numeric snapshot and a nonnegative numeric row cursor returned by that snapshot's drift page. |
| `Unknown subject ID; search first` | Use a search result's `id` or candidate's `subjectId`, not a candidate ID or path. After a rescan, search again if a declaration moved or disappeared. |
| `Unknown candidate category` | Use uppercase `SIMPLIFICATION`, `INCONSISTENCY`, `RELIABILITY`, or `COVERAGE`; omit the option for all categories. |
| `limit must be 1..200` | Supply an integer in that range. |
| Search returns nothing | Search indexes locators, tags and effects, not source bodies or review prose. Check normalized `terms`; the any-term fallback runs only after zero all-term matches. Try a narrower symbol/file name or search source with `rg`. |
| Search reports `ANY_TERM` | No all-term match existed; these results match only part of the normalized query. Read `meaning` and narrow the query before relying on relevance. |
| `Query exceeds 20 normalized terms` | The query is rejected without dropping words. Supply at most 20 distinct normalized terms and at most 500 characters. |
| `candidatePoolTruncated: true` | The lexical pool, exact-symbol lookup or file-seed limit was reached. Separate bounded symbol/owner lookups can add metadata beyond the 200–1,000-row lexical pool. Narrow the query; raising the result limit cannot make search exhaustive. |
| Context/impact says `truncated: true` | A result budget was reached. Increase the limit up to 200 or investigate smaller areas; do not interpret the page as a complete graph. `owners`/`localSymbols` are lexical navigation, not call edges. |
| Context omits environment/rules or lists only eight limitations | This is deliberate metadata compaction. Read `metadataDetail`, `limitationCount` and `limitationsTruncated`, then use `status` for full diagnostics. |
| Investigation omits files or shows no candidate for a visible symbol | File, term, response-byte and subject limits are explicit. Inspect `candidateCoverage.queriedSubjectIds` / `omittedSubjectIds` and `omittedEntryIds`; query `context` for omitted subjects. The brief is not a complete file inventory. |
| `Investigation limit must be 1..20 files` or byte-budget error | Use a file count from 1–20 and `--max-bytes` from 4,096–128,000. Default values are 5 and 24,000; a small byte budget can omit all entries. |

An empty backlog, empty impact set, or disappearing candidate is not a correctness result. Impact currently follows component-local TS/JS imports, and candidate coverage depends on implemented rules. Read the [coverage guide](DRIFT_COVERAGE.md) before interpreting absence.

## Local annotations and ranking

| Symptom | Cause and next action |
| --- | --- |
| `Index snapshot changed; inspect the candidate again before reviewing` | `expectedSnapshot` is stale. Read the candidate at the current scan and reassess the note before submitting it. |
| `Candidate is absent from the current snapshot` or `Cited source is absent` | Review append requires an emitted candidate and existing cited facts. Search the new source; retained historical notes are read with `reviews`. |
| `Review input exceeds 65536 bytes`, a field limit error, or `Unknown review field` | Use one bounded JSON object with only the documented fields. `reason` is at most 2,000 characters, `evidence` 8,000, and optional `factIds` at most 32 entries. See the [review input contract](LOCAL_REFERENCE.md#local-reviews-and-counterevidence). |
| `Index changed; restart review pagination` | Scan, review revision or candidate ID differs from the cursor. Restart without `--after`; keep the candidate stable. |
| Review is `STALE` after a small edit or a new importer | Captures include the source, containing file, direct imports/importers, cited facts and component context. Those changes conservatively invalidate the note. Inspect the new source and append a fresh note if justified. |
| Review stays stale after reverting source | Invalidation is permanent. A revert cannot revive a previous capture; append a new source-bound review. |
| Review becomes stale after upgrading with unchanged source | Scanner implementation is captured context. A 1.2-to-1.3 rescan may change that digest; retained history survives, while current applicability requires review. Toggling `--profile` within the same build does not change that digest. |
| Imported review is stale or appears before a local note in history | Restore permanently requires re-review. History sorts by local insertion ID; effective priority still prefers locally submitted reviews over imports. |
| Archive export reports a size/record limit or refuses an existing output file | Complete archives are limited to 16 MiB and 10,000 distinct originating records. Preserve a SQLite-consistent backup for larger/full histories. Choose a fresh output path; export does not overwrite files. |
| Archive integrity/canonical JSON validation fails | Use the original exported bytes. Reformatting, reordered records or content changes are rejected. Checksums detect corruption, not authenticated origin. |
| Review says `CANDIDATE_ABSENT` | The candidate is no longer currently emitted. This is detector lifecycle state, not debt closure; the old review remains available. |
| Score fell but severity did not | `baseScore` retains severity/boundary priority. Test-source reliability subtracts 25; a latest `CURRENT` `COUNTEREVIDENCE` note subtracts 20 more. `rankingReasons` and `review` explain the effective score. |
| A reviewed warning still appears | Reviews never hide candidates. Only the latest applicable counterevidence note changes rank; `INVESTIGATE`, stale or absent notes do not. Local review text is not authoritative proof. |
| MCP cannot add a note | Local MCP has eight read-only tools, including `assurance_local_reviews`. Use CLI `review --input FILE` to append. |

Reviews are append-only user reports. Correct one with a new record; do not edit SQLite rows or treat `CURRENT` as confirmation that its reasoning is true. Review changes advance `reviewRevision` and invalidate backlog/review-history cursors even when no source scan occurred.

## Optional service and durable verification

**The service CLI requests `ASSURANCE_URL` or credentials during a local task.** `packages/agent/dist/src/cli.js` is the service client; use `local-cli.js` for SQLite. For MCP, set `ASSURANCE_LOCAL_DB` to select local read-only mode.

**The Spring service refuses to start without authentication or database settings.** The durable server requires `ASSURANCE_AUTH_FILE` and `DB_PASSWORD`. Set `JDBC_URL` and `DB_USER` for your provisioned PostgreSQL database; otherwise they default to the local `assurance` database/user. Generate scoped authentication with `scripts/init-auth.mjs`. The fixed demo tokens belong only to the temporary loopback harness.

**`init-auth.mjs` reports that a file exists.** The generator intentionally does not overwrite credential files. Reuse the existing protected configuration, or choose a new operator directory for a separate deployment.

**`test-spring.sh` asks you to run Maven first.** Run `mvn -B -ntp -Ppostgres-it verify` against a disposable PostgreSQL database, then the restart script. It expects `services/server/target/assurance-server-1.0.0.jar` and uses loopback port 8099. Check that port is free.

**A requirement remains blocked after a green retry.** Same-generation counterevidence remains visible. Review the exact requirement revision, evidence generation, coverage, and argument applicability through the service; accepting debt or rerunning a checker does not make a violated requirement true. See [agent protocol](AGENT_PROTOCOL.md).

## Reporting an issue

Include the exact command, exit status, runtime versions, expected/actual behavior, relevant coverage limitations, and a small synthetic fixture. For pagination or invalidation failures, include the sequence of scans and queries. Redact credentials, proprietary identifiers, absolute personal paths, and private index/report contents. See [contributing](../CONTRIBUTING.md) for the expected development and review workflow.
