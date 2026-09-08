# Local investigation and agent workflow

## Scan once, then retrieve small units

Build with `npm ci --ignore-scripts && npm run build`. The local CLI is `node packages/agent/dist/src/local-cli.js`; the workspace package also declares the `assurance-local` executable.

```sh
node packages/agent/dist/src/local-cli.js scan --config workspace.json --db .assurance-cache/index.sqlite
node packages/agent/dist/src/local-cli.js status --db .assurance-cache/index.sqlite
node packages/agent/dist/src/local-cli.js investigate "callbacks arriving after cancellation" --db .assurance-cache/index.sqlite --limit 5 --max-bytes 24000
node packages/agent/dist/src/local-cli.js backlog --db .assurance-cache/index.sqlite --limit 10 --category SIMPLIFICATION
node packages/agent/dist/src/local-cli.js search "payment retry" --db .assurance-cache/index.sqlite
node packages/agent/dist/src/local-cli.js context SUBJECT_ID --db .assurance-cache/index.sqlite
node packages/agent/dist/src/local-cli.js impact SUBJECT_ID --db .assurance-cache/index.sqlite --limit 100
node packages/agent/dist/src/local-cli.js drift 2 --db .assurance-cache/index.sqlite
```

`investigate` turns a task into a bounded source brief using the existing lexical query. It includes source locations, owners, coverage and compact candidate/review context in one scan/review snapshot. Inspect term selection, `candidateCoverage`, omitted IDs and truncation before reading the cited implementation. The default covers five files and 24,000 compact JSON bytes, not complete task context; source-level candidate queries cover at most three visible subjects per entry.

`search` normalizes camelCase, underscores and a small explicit set of morphology aliases over locators, tags and effects. It tries all terms first and broadens only after zero all-term matches, reporting `matchMode: ANY_TERM`. Exact symbol/file boosts and per-item `rankingReasons` explain bounded reranking; `candidatePoolTruncated` reports pool exhaustion. It does not embed code or index raw file bodies. Read the cited source using ordinary repository tools.

`context` returns the subject, compact component metadata, candidate/review summaries, direct import neighbors, lexical `owners` and nearby `localSymbols`. The symbol fields are navigation hints, not call edges. Component metadata omits environment/rule inventories and caps coverage limitations at eight with a truncation flag; use `status` for full diagnostics. `impact` follows reverse imports transitively, handles cycles, and supplies a predecessor for each affected file. A `truncated` result means the supplied node budget is insufficient. Imports are potential change dependencies; they are not behavioral call-graph proofs. Currently this projection uses component-local TS/JS `IMPORT:` summaries.

`backlog` retains original severity and `baseScore`, and explains its effective `score` through `sourceRole` and `rankingReasons`. Test-source reliability warnings receive a 25-point discount; the latest applicable local counterevidence note subtracts another 20. All candidates remain visible. Scores are triage priorities, not debt cost or defect probability, and branch count alone does not justify a refactor. Use the returned opaque `next` as `--after`; a new scan or review revision invalidates it rather than silently skipping work. Drift pages retain numeric row cursors.

Candidates include existing lifecycle/reliability rules, duplicate implementations, large functions, import cycles, layer violations, plus concentrated conditional decisions and mixed effect ownership. Every item states the evidence needed before acting.

## Iterate on a candidate

1. Check scan coverage and source revision. Rescan a changed checkout.
2. Choose a candidate and retrieve its context and import impact.
3. Read its actual implementation and callers. Identify the expected behavior and likely next change.
4. Decide whether it is a defect, an intentional boundary, or a simplification opportunity. Capture an explicit counterexample or a before/after change-surface argument. Preserve a source-bound local note with CLI `review`; it remains untrusted and does not approve the conclusion.
5. If shared assurance is needed, propose the requirement and repayment obligations through the service. A maintainer reviews them; independent checkers supply evidence.
6. Make a bounded change and run the relevant behavior checks. Rescan and inspect drift. A disappearing candidate means it was not detected in that scan; it does **not** close a reviewed debt obligation.

Local findings are not automatically uploaded as approved requirements or evidence. Source and finding text remain untrusted data in both CLI and MCP output.

## Preserve a local investigation note

Use the current candidate ID and snapshot in a `review.json` file:

```json
{
  "candidateId": "<candidate digest>",
  "expectedSnapshot": 2,
  "disposition": "COUNTEREVIDENCE",
  "author": "reviewer",
  "reason": "Failure is handled by the documented fallback owner.",
  "evidence": "Inspected the fallback and ran the focused rejection-path test."
}
```

```sh
node packages/agent/dist/src/local-cli.js review --input review.json --db .assurance-cache/index.sqlite
node packages/agent/dist/src/local-cli.js reviews CANDIDATE_ID --db .assurance-cache/index.sqlite --limit 10
```

Choose `COUNTEREVIDENCE` to record why the structural warning may be intentional, or `INVESTIGATE` to record work still needed. The input is bounded to 65,536 bytes and may cite up to 32 additional fact IDs. Review text is a user report; the tool does not execute it, fetch evidence links, or authenticate its author. Full fields and limits are in the [local reference](LOCAL_REFERENCE.md#local-reviews-and-counterevidence).

Notes append rather than overwrite. Only the latest `CURRENT` counterevidence note changes ranking. Source/file, direct-import content or membership, cited-fact, candidate and context/policy changes make prior notes stale; disappearance is reported as `CANDIDATE_ABSENT`. An unchanged scan keeps applicability, but reverting a changed source does not revive an invalidated note. Inspect and append a fresh note when appropriate. Review-history pagination pins the candidate, scan and review revision; restart after any pin changes.

Local applicability is not assurance. A note never removes a candidate, establishes a requirement, or closes debt. For stronger proposed ownership/retry/lifecycle detectors, consult the [gated backlog](DETECTOR_BACKLOG.md) rather than treating ordinary branch counts as proof.

## Transfer retained notes and check reuse

```sh
node packages/agent/dist/src/local-cli.js review-export --db .assurance-cache/index.sqlite --output retained-reviews.json
node packages/agent/dist/src/local-cli.js review-import --db recovered/index.sqlite --input retained-reviews.json
```

Keep the archive private and unchanged. It preserves distinct originating notes and their captures, including stale or absent history, within 10,000 records and 16 MiB. Import is idempotent and keeps restored records stale or absent; it never displaces a locally submitted review. Inspect the new source and append a fresh review if the reasoning still applies. A full SQLite backup additionally preserves drift, scans and each local restore event. See [review archives](REVIEW_ARCHIVES.md) and the [schema/recovery contract](LOCAL_REFERENCE.md#scan-and-status).

The opt-in [lifecycle lab](LIFECYCLE_LAB.md) executes pinned synthetic implementations against an independent explicit contract. Run its [reuse example](../examples/lifecycle-lab/reuse.mjs) with `node examples/lifecycle-lab/reuse.mjs` to carry a report into the existing investigation/review workflow. Lab results require source and assumption pins; they add neither an alternate review store nor a production scanner rule. Run `npm run test:lab` for the behavioral checks.

## Workspace boundaries and Java

Choose one component per build target, with at most 50,000 extracted facts and 20,000 source/config files by default (configurable discovery ceiling: 50,000 files). All indexed components must participate in a workspace scan. Changing a component root or dropping an indexed component requires a new index after preserving the old database with a SQLite-consistent backup; it cannot silently erase a component's findings or review history.

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

The exact outer configuration belongs to the client. Local mode opens SQLite read-only and exposes eight tools: investigate, status, search, backlog, context, impact, drift and candidate review history (`assurance_local_reviews`). Scan, append reviews and export/import archives through the CLI; MCP has no local mutation tool. The service token is unnecessary. Remove `ASSURANCE_LOCAL_DB` to use the original authenticated service tools instead; local mode never falls back to a remote mutation.

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

Version 1.3.0 uses schema 3. CLI `scan` validates configuration before writable open, then commits schema-1/2 migration and search rebuild with the first successful scan. A failed upgrade scan retains the previous schema and snapshot. Queries/MCP, archive export, review append and imports into existing indexes require the compatible schema. Preserve a SQLite-consistent backup first: schema-2 export cannot bypass migration if the original source inventory is unavailable.

An upgrade can change the scanner implementation digest and make existing reviews stale despite unchanged application source. History survives; current applicability across tool versions is not promised. Toggling `--profile` with the same scanner build does not change fact or context identities.

After changing the compiled search policy, rebuild/restart the tool and run `scan` again. The stored `searchPolicyDigest` must match before read-only access, including `status`, or review append. The scan rebuilds search metadata even for unchanged facts. Reads do not extract source or rebuild the index. Search-only metadata changes do not invalidate reviews or create source drift; the CLI scan still advances its snapshot and checks source/context applicability.

The index uses SQLite WAL, one writer per workspace, and one atomic transaction across the configured scan, including pending migration, search rebuild and review invalidation. Readers retain the last committed state, subject to schema/search-policy compatibility. Failed scans roll back these changes with source facts, findings, drift and snapshot metadata. A compiler is instantiated per component; the CLI does not retain every component's AST.

Persistence updates changed facts and FTS rows; unchanged rows are reused. **Compiler extraction still runs on every scan.** Use `scan --profile` to separate analysis, ingestion and reconciliation plus commit. The [investigation scale report](INVESTIGATION_SCALE.md) measures both synthetic review/query work and frozen-component extraction. Incremental compiler-result reuse is not implemented; any future path must preserve complete input and membership equivalence.

`investigate` defaults to five files and 24,000 compact JSON bytes, with ceilings of twenty files and 128,000 bytes. Other bounded queries default to twenty records with a ceiling of 200. MCP also bounds response bytes. The scanner stores extracted metadata and drift history rather than raw source bodies; local review text is also stored and may include excerpts. Paths, identifiers and annotations can still be sensitive. Keep the database with the workspace. Drift and append-only review history grow without automatic retention. Source metadata can be rebuilt, but this database may be the only copy of its review records. Preserve it with SQLite-consistent backup tooling before replacement or deletion, and retain the old copy for review-history lookup. Copying only a live main database file can miss committed WAL data. The service owns authoritative assurance/evidence history and does not automatically copy local annotations.
