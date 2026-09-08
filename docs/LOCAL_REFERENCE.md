# Local CLI and MCP reference

This reference describes the implementation in version 1.4.0. Start with the [local workflow](LOCAL_WORKFLOW.md) for a walkthrough, [concepts](CONCEPTS.md) for the authority model, and [extension guide](EXTENDING.md) for detector behavior. The local index is an optional SQLite projection; the assurance service is a separate, authoritative workflow.

## Executables and prerequisites

Use the official Node 24.16+ build with SQLite FTS5. From the repository root:

```sh
npm ci --ignore-scripts
npm run build
node packages/agent/dist/src/local-cli.js --help
```

The workspace declares three executable names:

| Name | Built entry point | Purpose |
|---|---|---|
| `assurance-local` | `packages/agent/dist/src/local-cli.js` | Scan into a local index and query it |
| `assurance-mcp` | `packages/agent/dist/src/mcp.js` | Local or authenticated service MCP bridge |
| `assurance` | `packages/agent/dist/src/cli.js` | Service publication, plans, runner and checks |

The examples use explicit `node` paths so they do not depend on a global installation or shell link. `npm run local -- …` invokes the local entry point, but npm may print its own script banner: invoke `node` directly when stdout must contain only JSON.

Successful local commands write one JSON object to stdout. Scan progress goes to stderr. Errors write a message to stderr and exit with status 1. Queries open an existing database read-only; run `scan` first. `review` appends a local annotation; `review-import` restores archived annotations in a separate transaction. Archive export reads without mutating the index. The local CLI does not require service credentials.

## Workspace configuration

```json
{
  "workspace": "payments",
  "components": {
    "api": {
      "root": "../payments/packages/api",
      "tsconfig": "tsconfig.json",
      "exclude": ["generated/**", "vendor/**"],
      "maxFiles": 20000,
      "maxFileBytes": 1000000,
      "layers": [
        { "name": "domain", "match": "src/domain/**", "mayImport": [] },
        { "name": "http", "match": "src/http/**", "mayImport": ["domain"] }
      ]
    }
  }
}
```

| Field | Meaning and default |
|---|---|
| `workspace` | String identifying the inventory. A database already assigned to another workspace is rejected. |
| `components` | Nonempty object for local scans. Component IDs match `[A-Za-z0-9][A-Za-z0-9_.-]{0,49}`. |
| `components.<id>.root` | Required directory; relative to the workspace JSON file. Resolved to its real path for local ingestion. |
| `tsconfig` | Optional compiler configuration; relative to the component root. Concrete build target configurations are supported. Solution references are not expanded. |
| `exclude` | Optional component-relative glob patterns. Supported syntax is `*`, `**`, `**/` and `?`; this is not a full gitignore implementation. |
| `layers` | Optional ordered list of `{name, match, mayImport}`. The first matching layer classifies a path. A resolved import between different known layers must be in the source layer's `mayImport`. |
| `maxFiles` | Recognized source/configuration file ceiling, default 20,000; accepted range 1–50,000. Exceeding it fails the scan. |
| `maxFileBytes` | Per-file ceiling, default 1,000,000 bytes; accepted range 1–5,000,000. Oversized recognized files make discovery partial, so a local scan cannot publish. |
| `environment` | Optional map of assumption names to 64-character lowercase SHA-256 digests. Supply digests of effective deployment/runtime inputs when relevant. Scanner-owned keys overwrite matching supplied keys. |
| `javaClasspath` | Array of actual Java compiler inputs, resolved relative to the component root. An empty array is valid for JDK-only source. Required for local Java scanning. |
| `javaCoreClassPath` | Classpath containing the supplied JDK adapter, resolved relative to the component root. Required alongside `javaClasspath`. |

Build the Java adapter with JDK 21 using `bash scripts/test-java.sh`. A typical `javaCoreClassPath` is the absolute path to this repository's `.build/java`. Dependency resolution occurs outside the scanner; it does not run Maven, Gradle or package scripts.

**Inventory detail:** discovery determines the TypeScript program's root files. `tsconfig` contributes compiler options; its `files`, `include` and `exclude` lists do not replace the scanner's inventory. Use component roots and the workspace's `exclude` for scan boundaries. External sources/types loaded by the compiler affect its dependency digest but do not become component facts.

Discovery recognizes TS/JS variants (`.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`), Java, and selected configuration/document formats. It always excludes `node_modules`, `.git`, `target`, `dist`, `build`, `.build`, `.next`, `coverage`, `.gradle` and `.assurance-cache`. It does not ingest `.env`, `.env.*` or `auth.json`. Nonexcluded symlinks make discovery partial; they are not traversed. See [extraction limits](EXTENDING.md#extraction-and-coverage-limits) before interpreting absence.

## Local command overview

```text
assurance-local scan --config FILE [--db FILE] [--profile]
assurance-local status --db FILE
assurance-local investigate TASK --db FILE [--limit N] [--max-bytes N]
assurance-local search QUERY --db FILE [--limit N]
assurance-local backlog --db FILE [--limit N] [--category CATEGORY] [--after CURSOR]
assurance-local context SUBJECT_ID --db FILE [--limit N]
assurance-local impact SUBJECT_ID --db FILE [--limit N]
assurance-local review --input FILE --db FILE
assurance-local reviews CANDIDATE_ID --db FILE [--limit N] [--after CURSOR]
assurance-local review-export --output FILE --db FILE
assurance-local review-import --input FILE --db FILE
assurance-local drift SNAPSHOT --db FILE [--limit N] [--after ROW_ID]
```

| Option | Contract |
|---|---|
| `--db FILE` | Absolute or current-directory-relative database path. |
| `--config FILE` | Required by `scan`. If `--db` is omitted, select `.assurance-cache/index.sqlite` beside this JSON file. Queries can also use `--config` solely to select this default path; they do not reload or validate the configuration. |
| `--limit N` | `investigate`: 1–20 files, default **5**. Other bounded queries: 1–200 records, default **20**. |
| `--max-bytes N` | `investigate` only: compact JSON budget of 4,096–128,000 UTF-8 bytes, default **24,000**. |
| `--profile` | `scan` only: add analysis phase timings, ingestion time, commit time and analysis-stage process memory. |
| `--category CATEGORY` | Backlog filter: `SIMPLIFICATION`, `INCONSISTENCY`, `RELIABILITY` or `COVERAGE`. Omission includes all categories. Case-sensitive. |
| `--after CURSOR` | Backlog/review-history opaque string cursor or drift's nonnegative numeric row cursor. Their formats are not interchangeable. |
| `--input FILE` | `review`: one JSON object, at most 65,536 bytes. `review-import`: unchanged canonical archive, at most 16 MiB. Neither reads stdin. |
| `--output FILE` | Required by `review-export`; create a private archive file without overwriting an existing path. |
| `--help` | Print help without opening the index. |

Commands reject unsupported options and unexpected positional arguments. Quote multi-word tasks and search queries. There is no local `--component`: every configured component participates in a scan.

## Scan and status

```sh
node packages/agent/dist/src/local-cli.js scan --config examples/local-workspace.json
node packages/agent/dist/src/local-cli.js status --db examples/.assurance-cache/index.sqlite
```

`scan` returns `{snapshot, database, components, summary}`. Each entry in `components` contains `id`, counts of `added`, `changed`, `removed` and `unchanged` facts, `elapsedMs`, and `coverage`. The database path is absolute. The first committed local snapshot is 1. Every successful scan creates another snapshot, including scans with no changed facts; this differs from service component heads, which can remain stable on no-op publication.

With `--profile`, each component adds `profile.analysis` and `profile.projectionMs`. Analysis separates discovery, TypeScript work, Java work, configuration, source validation and context construction, with file/fact counts and process RSS/peak RSS sampled at analysis completion. The top-level `profile` reports index-open time, commit time and total time after configuration loading. Commit includes review reconciliation and SQLite durability work. These timings do not isolate TypeScript parsing from checking or fact extraction, and memory is process-wide. See [workload diagnostics](INVESTIGATION_SCALE.md).

`status` returns the same summary shape embedded by `scan`:

| Field | Meaning |
|---|---|
| `workspace`, `snapshot` | Index identity and latest committed local scan number |
| `schemaVersion`, `reviewRevision` | Local schema version (3) and annotation revision; append or permanent invalidation advances the latter |
| `searchPolicyDigest` | Digest of compiled search policy, matched against the policy used to build stored search metadata |
| `facts`, `opportunities` | Total current facts and currently emitted candidates |
| `components` | Up to 200 components, sorted by ID; each includes root, snapshot, source revision, coverage, analyzer, rules, configuration/environment digests, `candidatePolicyDigest`, `factCount` and `findingCount` |
| `componentsTruncated` | More than 200 components exist; this flag does not mean their facts were omitted from scanning |
| `authority` | `LOCAL_INVESTIGATION_ONLY` |
| `freshness` | `AS_OF_SCAN; rescan before editing or relying on absence` |
| `history` | Retention reminder: source metadata is rebuildable, but local review history must be preserved before database replacement |

Counts and paths depend on your checkout. This is an illustrative excerpt, with the component details omitted:

```json
{
  "workspace": "payments",
  "snapshot": 2,
  "schemaVersion": 3,
  "reviewRevision": 0,
  "facts": 1200,
  "opportunities": 43,
  "componentsTruncated": false,
  "authority": "LOCAL_INVESTIGATION_ONLY",
  "freshness": "AS_OF_SCAN; rescan before editing or relying on absence"
}
```

Version 1.4.0 uses local schema 3. CLI `scan` validates configuration before writable open and commits schema-1/2 migration, normalized search rebuild and source publication together. Schema 3 preserves archive provenance and the precedence of locally submitted reviews. A failed upgrade scan retains the previous schema and source snapshot. Read-only queries, MCP and `review-export` reject older indexes; review append and imports into an existing index also require migration first. Schema versions newer than 3 are rejected.

In particular, `review-export` cannot recover directly from schema 2. Preserve a SQLite-consistent backup before migration. If the original source inventory cannot be scanned successfully, retain that database and a compatible historical tool for reading its history; this version supplies no archive-only migration or manual schema-version bypass. A missing destination may be initialized by `review-import` before its first source scan, with restored candidates initially absent.

The scanner implementation digest participates in captured environment context. A 1.2-to-1.3 rescan can therefore make old reviews stale with unchanged application source; history is preserved, but current applicability across the upgrade is not guaranteed. Enabling `--profile` with the same scanner build changes timing output only.

The index also records `searchPolicyDigest`, a digest of compiled `local-search.js`. If the tool's search policy changes, read-only access (including `status` and MCP) and review append/import into an existing index reject the old projection until a successful `scan` rebuilds search metadata, even when source facts are unchanged. Rebuild and restart tool processes after code changes; the digest is computed on module load. Read-only queries check stored metadata without extracting source or rebuilding search. A search-only rebuild does not itself change source/review revisions, produce source/context drift or invalidate reviews; the accompanying CLI scan still creates a new snapshot and checks ordinary source/context applicability.

The database uses SQLite WAL and a 5-second busy timeout. A workspace scan begins one write transaction before extraction, ingests components in sorted ID order and commits them together. Readers retain the prior committed state, subject to schema/search-policy compatibility. Errors roll back pending migration, search metadata, facts, candidates, review invalidations, drift and snapshot metadata together. All previously indexed components must still be present and rescanned. To remove a component from the inventory or change its root, use a new index after preserving the old database and its review history with a SQLite-consistent backup. A new component ID alone does not permit silently dropping an old component.

## Task investigation

```sh
node packages/agent/dist/src/local-cli.js investigate "callbacks arriving after cancellation" --db examples/.assurance-cache/index.sqlite --limit 5 --max-bytes 24000
```

`TASK` is a nonempty string of at most 2,000 characters; NUL is rejected. The query selects the first 12 distinct non-stopword normalized terms that fit within 384 UTF-8 bytes. `ignoredStopwordCount`, `omittedTermCount` and `termSelection` disclose that reduction. It uses the existing lexical search and groups its bounded hits by component/file; it does not infer a behavioral contract or run a model.

The brief contains `snapshot`, `reviewRevision`, task digest/preview, `authority`, `freshness`, `retrieval`, `entries`, `omittedEntryIds`, `truncated`, `budget`, `nextSteps` and `limitations`. Each entry includes source/match locations and hashes, lexical owners, nearby symbols, import neighbors, source revision, coverage and up to four candidates with compact review summaries. Candidate reads cover at most three visible source subjects per entry. `candidateCoverage.queriedSubjectIds` and `omittedSubjectIds` make that boundary explicit; an empty candidate list is not a file-wide absence claim. Review text remains untrusted data.

`retrieval.matchingFileCount` describes the grouped bounded hit set, not every matching file in the index. Pool, term, file, subject and entry limits propagate truncation. Entries that cannot fit are omitted whole and their primary IDs appear in `omittedEntryIds`; other limits are disclosed by their respective flags. A small budget may return no entries. Use the returned follow-up context/review IDs or a narrower task; there is no continuation cursor.

`budget.responseBytes` counts `JSON.stringify(brief)` in UTF-8 and cannot exceed `maxBytes`. CLI investigation output uses compact JSON; its trailing newline adds one framing byte. MCP counts the structured payload, not the duplicated text block or JSON-RPC envelope, against this investigation budget. The byte ceiling bounds returned content, not FTS work or query CPU time.

## Search

```sh
node packages/agent/dist/src/local-cli.js search "payment retry" --db examples/.assurance-cache/index.sqlite --limit 10
```

Search indexes **locators, tags and effects**, plus their normalized tokens. It does not index raw source bodies, comments, finding messages, review text or embeddings. Normalization splits camelCase/acronym boundaries and punctuation/underscores, lowercases words, and applies a small explicit alias map: for example, `disposal` → `dispose`, `hydration` → `hydrate`, `cancellation` → `cancel`, and `retries` → `retry`. This is lexical normalization, not general stemming or semantic search; the complete map lives in [local-search.ts](../packages/agent/src/local-search.ts).

Input is limited to 500 characters and **at most 20 distinct normalized terms**. Exceeding either limit fails instead of dropping terms. Terms are quoted for FTS5, so user-supplied FTS syntax does not enable wildcard, prefix or phrase queries. All terms are tried with `AND` first. Only when that yields zero rows and there is more than one term does the query broaden to `OR`.

Response fields:

| Field | Meaning |
|---|---|
| `snapshot`, `items` | Scan number and bounded fact results |
| `matchMode` | `ALL_TERMS`, `ANY_TERM` for the explicit broader fallback, or `EMPTY` for input without searchable terms |
| `terms` | Distinct normalized query terms actually used |
| `limited` | Always `true`: search returns a bounded top set and has no continuation cursor |
| `hasMore` | More results exist beyond the returned page or the reranking pool was exhausted |
| `candidatePoolLimit` | Lexical pool ceiling `max(200, limit × 5)`: 200–1,000 rows, plus the separately bounded exact-symbol/file-owner lookups below |
| `candidatePoolTruncated` | The lexical pool, exact-symbol lookup or file-seed limit was exceeded |
| `ownerExpansionFileLimit`, `ownerExpansionPerFileLimit` | Expand at most five matching seed files, reading at most `limit + 1` overview/named-function rows per file |
| `meaning` | Interpretation of the match mode and its limits |

For `EMPTY`, the response has empty `items`/`terms`, `hasMore: false` and no pool/meaning fields. `ANY_TERM` may also return no rows. The fallback is reported so partial lexical overlap cannot be mistaken for an all-term match.

The lexical pool is read in native FTS5 rank order. An indexed exact-symbol lookup considers the lowercase query and its compact spelling, with at most `limit + 1` matches. Matching lexical file seeds also receive the bounded owner expansion above. The union is deduplicated and reranked, so total metadata considered can exceed `candidatePoolLimit`; before deduplication its upper bound is that pool plus `6 × (limit + 1)` lookup rows. Exact symbol/file matches receive explicit boosts; file matches favor the overview and named top-level functions, and test-source metadata gets a small retrieval penalty. Items expose `matchedTerms`, `rankingReasons`, reranked `rank` and `lexicalRank` (0 where an added lookup row carries no FTS rank). Lower `rank` sorts first, then lower `lexicalRank`, then subject ID. These search ranks are separate from backlog scores and are not calibrated confidence. Pool exhaustion prevents an exhaustive ranking claim; narrow the query and read the source.

A fact result includes fields such as:

```json
{
  "id": "<64-character subject digest>",
  "component": "api",
  "locator": "src/payment.ts#charge",
  "path": "src/payment.ts",
  "language": "TS",
  "kind": "FUNCTION",
  "contentHash": "<64-character digest>",
  "signatureHash": "<64-character digest>",
  "tags": ["all", "boundaries", "functions"],
  "effects": ["RETRY"],
  "metrics": { "lines": 12, "guards": 1, "assertions": 0 },
  "line": 8,
  "matchedTerms": ["charge"],
  "rankingReasons": ["EXACT_SYMBOL"],
  "rank": -10100,
  "lexicalRank": 0
}
```

The numbers are illustrative. Obtain real IDs from search/backlog; paths and line numbers are relative to the component's recorded root and scan.

## Backlog and pagination

```sh
node packages/agent/dist/src/local-cli.js backlog --db examples/.assurance-cache/index.sqlite --category SIMPLIFICATION --limit 10
node packages/agent/dist/src/local-cli.js backlog --db examples/.assurance-cache/index.sqlite --category SIMPLIFICATION --limit 10 --after '<returned next value>'
```

Response: `{snapshot, reviewRevision, items, hasMore, next}`. Candidates sort by effective `score` descending, then ID ascending. `baseScore` retains severity priority plus the boundary bonus. `score` subtracts 25 for `TEST`-source `RELIABILITY` candidates and another 20 when the latest local review is `CURRENT` `COUNTEREVIDENCE`. Discounts retain every candidate and its original severity; they do not estimate debt cost or failure probability. `sourceRole`, `rankingReasons` and a `review` summary (or null) explain the result. [Candidate rules](EXTENDING.md#candidate-classification-and-scoring) describe the exact mapping.

An illustrative one-item page, with only selected ranking explanations shown:

```json
{
  "snapshot": 2,
  "reviewRevision": 0,
  "items": [
    {
      "id": "<candidate digest>",
      "component": "api",
      "subjectId": "<subject digest>",
      "ruleId": "DESIGN_BRANCH_CONCENTRATION",
      "category": "SIMPLIFICATION",
      "severity": "MEDIUM",
      "baseScore": 60,
      "score": 60,
      "sourceRole": "PRODUCTION",
      "rankingReasons": [
        "Severity MEDIUM contributes 50 investigation priority points.",
        "Boundary tag adds 10 investigation priority points.",
        "Branch count alone does not justify a refactor; establish a concrete change scenario and duplicated or scattered policy first."
      ],
      "review": null,
      "firstSeen": 1,
      "lastSeen": 2,
      "resolved": null,
      "path": "src/payment.ts",
      "line": 8,
      "message": "10 conditional decisions share one function; inspect policy ownership and independent reasons to change.",
      "confidence": "STATIC_CANDIDATE",
      "nextStep": "Name a likely feature or policy change, inspect callers and ownership, and compare its current change surface with one simpler design.",
      "evidenceNeeded": [
        "Source and caller inspection at this snapshot",
        "An explicit behavior contract and its assumptions",
        "Before/after behavior tests and change-surface comparison"
      ]
    }
  ],
  "hasMore": true,
  "next": "<opaque cursor returned by this page>"
}
```

The opaque cursor pins the scan snapshot, `reviewRevision`, category, last effective score and last ID. Continue with the same category and returned cursor while `hasMore` is true. Page size may change. A new successful scan (including an unchanged scan), an appended/invalidated review, or changing the category causes `Index changed; restart backlog pagination`. Restart at the first page; do not manufacture or edit cursors. On the final page `next` is null.

Candidate identity is SHA-256 of `subjectId + ':' + ruleId`. Multiple sites of the same rule on one subject collapse to one candidate. `firstSeen` survives disappearance and reappearance; `lastSeen` records its latest emitted scan. Internally `resolved` records the scan in which it stopped being emitted. The backlog only returns unresolved rows, so its `resolved` is null. This lifecycle is detector bookkeeping, **not reviewed debt closure**. There is currently no CLI query for historical resolved candidates.

## Context

```sh
node packages/agent/dist/src/local-cli.js context '<subject ID>' --db examples/.assurance-cache/index.sqlite --limit 20
```

The response includes `snapshot`, `reviewRevision`, `subject`, `component`, `metadataDetail`, `neighbors`, `owners`, `localSymbols`, `symbolsTruncated`, `symbolMeaning`, `opportunities`, `truncated`, `trust`, `coverage` and `nextStep`.

- `subject` is the selected fact. `component` is compact scan metadata: it omits `environment` and `rulesExecuted`, and includes at most eight `coverage.limitations` with `limitationCount` and `limitationsTruncated`. Use `status` for the full component metadata and limitation list; this reduction does not narrow the recorded scan.
- `opportunities` contains candidates attached to that exact subject, with local review summaries and effective scores. A function query does not automatically include file-level findings.
- `neighbors` contains direct imported/importing files for the subject's containing file.
- `owners` uses matching locator prefixes for lexical containment. `localSymbols` lists nearby same-file declarations, preferring named units. Their brief records include identity, location, kind, effects and metrics. Neither field represents callers, resolved data flow or behavioral dependencies.

Each result collection is bounded by `limit`. `symbolsTruncated` reports incomplete symbol navigation; `truncated` is true if neighbors, candidates or symbol navigation exceed their bounds. The separate `component.coverage.limitationsTruncated` flag reports compacted diagnostic text. There is no context pagination cursor.

Context is a navigation aid with no raw source or mandatory assurance obligation set. Source, finding and review text remain untrusted. Read the cited implementation and use service `plans.prepare` when approved obligations are needed. Unknown subject IDs fail with `Unknown subject ID; search first`.

## Local reviews and counterevidence

Local reviews preserve a source-bound investigation note and influence triage. They are **user-reported, untrusted annotations**, not independently checked evidence, approved requirements, or debt resolution. `author` is supplied text, not an authenticated identity; `reason` and `evidence` are stored text, not instructions to execute or URLs the tool follows.

Create `review.json` using a candidate ID and scan number returned by backlog/context:

```json
{
  "candidateId": "<candidate digest>",
  "expectedSnapshot": 2,
  "disposition": "COUNTEREVIDENCE",
  "author": "reviewer",
  "reason": "The caught cleanup failure is intentional under the release contract.",
  "evidence": "Source inspection and the throwing-cleanup test show that credentials and timers still clear.",
  "factIds": ["<supporting source fact digest>"]
}
```

```sh
node packages/agent/dist/src/local-cli.js review --input review.json --db examples/.assurance-cache/index.sqlite
node packages/agent/dist/src/local-cli.js reviews '<candidate ID>' --db examples/.assurance-cache/index.sqlite --limit 10
```

| Input | Contract |
|---|---|
| JSON file | One object, at most 65,536 bytes; unknown fields are rejected |
| `candidateId` | Required nonempty string, at most 200 characters; candidate must currently be emitted |
| `expectedSnapshot` | Required positive safe integer equal to the current scan; stale input fails rather than rebinding |
| `disposition` | Exactly `COUNTEREVIDENCE` or `INVESTIGATE` |
| `author`, `reason`, `evidence` | Required nonempty strings, at most 200, 2,000 and 8,000 characters respectively; NUL is rejected |
| `factIds` | Optional array of at most 32 additional source IDs, each at most 200 characters; every cited fact must exist; the primary source is always included |

`review` appends in a write transaction and returns `{review, reviewRevision}`. History is append-only: correct an earlier note by appending a new one. The latest locally submitted review controls the ranking adjustment when one exists; restored history cannot displace it. Without a local submission, the latest imported record is shown with stale or absent state and no discount. A current `COUNTEREVIDENCE` note subtracts 20 from the existing source-adjusted score; a latest `INVESTIGATE` note makes no review discount. Multiple historical notes do not stack discounts, and no disposition removes the candidate.

Each record stores the candidate, primary/cited source facts, containing file facts, fingerprints/counts of all direct imports and importers, and component context. Scan reconciliation permanently invalidates a record after a captured source/file, cited fact, direct dependency content or membership, candidate, context or ranking-policy change. This includes newly added direct dependencies. A truly unchanged scan preserves applicability, although its new scan number still invalidates pagination cursors. These pins cover the stored direct import projection, not every runtime dependency.

| `state` | Meaning |
|---|---|
| `CURRENT` | The annotation still matches its captured indexed source/context |
| `STALE` | Its capture changed or it was permanently invalidated; no ranking discount |
| `CANDIDATE_ABSENT` | The candidate is no longer currently emitted; history remains available |

Invalidation is append-only and prevents resurrection: reverting source or reintroducing a candidate does not make an invalidated note current again. Inspect the new snapshot and append a fresh review if the reasoning still applies. This does not establish the truth of a `CURRENT` note; applicability and evidence quality are separate.

`reviews` returns `{snapshot, reviewRevision, items, hasMore, next}`, newest record first. Each item includes the source capture, `fingerprint`, `state`, `invalidation` (or null), `authority: USER_REPORTED_LOCAL_ANNOTATION` and `freshness: AS_OF_SCAN`. Continue with the returned opaque `next` while `hasMore`; the cursor pins scan, review revision and candidate ID. A change to any pin produces `Index changed; restart review pagination`. Page size may change. Review append is CLI-only; local MCP exposes history reads, not a write tool.

## Review archive commands

```sh
node packages/agent/dist/src/local-cli.js review-export --db .assurance-cache/index.sqlite --output retained-reviews.json
node packages/agent/dist/src/local-cli.js review-import --db recovered/index.sqlite --input retained-reviews.json
```

Export reads one consistent snapshot and writes a new file with private creation permissions; an existing output path is rejected. Its JSON summary reports archive path, bytes and source workspace/scan/review revision. Import validates canonical JSON and integrity before opening storage, then appends the complete archive in one transaction. Its result includes `imported`, `skipped`, `total`, `reviewRevision` and archive `digest`. Repeating identical imports skips records without advancing revision.

The archive carries every distinct originating annotation, including superseded and absent-candidate history, up to 10,000 records and 16 MiB. Exceeding a complete-export bound fails; it does not export a successful prefix. Restore retains original captures and provenance but adds a permanent `ARCHIVE_RESTORE_REQUIRES_REVIEW` invalidation. It cannot produce current counterevidence, supersede a local submission or remap source identities. Preserve a full SQLite backup for source projections, drift and every local restore event. See [review archives](REVIEW_ARCHIVES.md) for format, trust and recovery details, and the schema-2 restriction under [scan and status](#scan-and-status).

## Import impact

```sh
node packages/agent/dist/src/local-cli.js impact '<subject ID>' --db examples/.assurance-cache/index.sqlite --limit 100
```

Response: `{snapshot, seed, affected, truncated, modality, meaning}`. The seed is the subject's containing file ID. A breadth-first traversal follows incoming imports within that component. Each affected file has `{id, path, via, distance}`: `via` is the predecessor toward the seed and `distance` is the number of import edges. The seed itself is excluded; cycles do not repeatedly return a file.

```json
{
  "snapshot": 2,
  "seed": "<changed file ID>",
  "affected": [
    { "id": "<importer ID>", "path": "src/http.ts", "via": "<changed file ID>", "distance": 1 },
    { "id": "<transitive importer ID>", "path": "src/server.ts", "via": "<importer ID>", "distance": 2 }
  ],
  "truncated": false,
  "modality": "STATIC_IMPORT_REACHABILITY",
  "meaning": "Potential change surface through component-local imports; not semantic behavioral impact or complete call-graph coverage"
}
```

`limit` budgets affected nodes, with an additional bounded per-node adjacency read. `truncated` conservatively reports budget exhaustion. Rerun with a larger limit up to 200; there is no continuation cursor. `truncated: false` only means this traversal completed within the **stored import projection**. It does not fill extractor gaps, cross-component links, dynamic imports, calls or runtime dependencies. See [extraction limits](EXTENDING.md#extraction-and-coverage-limits).

## Drift

```sh
node packages/agent/dist/src/local-cli.js drift 2 --db examples/.assurance-cache/index.sqlite --limit 50
node packages/agent/dist/src/local-cli.js drift 2 --db examples/.assurance-cache/index.sqlite --limit 50 --after 123
```

`SNAPSHOT` is one positive integer identifying **the scan that recorded the changes**. This is not an arbitrary two-snapshot diff or “all changes since” query. First scans record initial facts as `ADDED`. No-op scans can have empty drift.

Response: `{items, hasMore, next}`. Unlike the other local read responses, drift has no top-level `snapshot`; each row includes its snapshot. Rows sort by increasing numeric `id`. Continue with the same requested snapshot and `--after` set to `next`. Use `hasMore` to stop: `next` remains the last row ID, or the supplied `after` for an empty page, even when pagination is complete. New scans do not invalidate drift cursors because committed drift rows are immutable. An unknown positive snapshot returns an empty page; it does not prove that the snapshot existed.

| `kind` | Payload |
|---|---|
| `ADDED` | Subject, component, path, line, `fields: []`, `before: null`, `after: <fact>` |
| `CHANGED` | Subject, component, path, line, changed field names, before/after facts |
| `REMOVED` | Subject, component, old path and line, `before: <fact>`, `after: null` |
| `CONTEXT_CHANGED` | Component as subject; previous/current component metadata in `before` and `after` |

Fact changes compare `contentHash`, `signatureHash`, `tags`, `effects`, `metrics`, `path`, `locator`, `kind` and `language`. A line-number-only change updates stored metadata but is not itself a `CHANGED` row. A locator/identity change commonly appears as removal plus addition. Context drift compares configuration digest, environment, analyzer, coverage and the compiled investigation policy's `candidatePolicyDigest`. Rebuild and restart scanner processes after changing that policy; its digest is computed on module load. A source revision label alone does not create context drift. Changing findings alone does not create fact drift.

## Eight local MCP tools

Set `ASSURANCE_LOCAL_DB` to select local mode before launching the existing bridge:

```json
{
  "mcpServers": {
    "assurance-local": {
      "command": "node",
      "args": ["/absolute/path/assurance-memory/packages/agent/dist/src/mcp.js"],
      "env": {
        "ASSURANCE_LOCAL_DB": "/absolute/path/index.sqlite"
      }
    }
  }
}
```

The outer client configuration may differ; this is a conventional server declaration, not a client-specific installation command. Use an absolute database path because the bridge resolves relative paths against its process working directory. Its parent directory and WAL sidecars must remain accessible to SQLite; do not replace an active database underneath the process.

| Tool | Required arguments | Optional arguments | Result |
|---|---|---|---|
| `assurance_local_investigate` | `task` string, 1–2,000 characters | `limit` 1–20; `maxBytes` 4,096–128,000 | Same task brief as CLI `investigate` |
| `assurance_local_status` | `{}` | None | Same as CLI `status` |
| `assurance_local_search` | `query` string, at most 500 characters | `limit` | Same as CLI `search` |
| `assurance_local_backlog` | `{}` | `category`, `after` string, `limit` | Same as CLI `backlog` |
| `assurance_local_context` | `id` string | `limit` | Same as CLI `context` |
| `assurance_local_impact` | `id` string | `limit` | Same as CLI `impact` |
| `assurance_local_drift` | `snapshot` integer, at least 1 | `after` integer, at least 0; `limit` | Same as CLI `drift` |
| `assurance_local_reviews` | Candidate `id` string | `after` opaque string, `limit` | Same as CLI `reviews` |

Investigation defaults to five files and 24,000 compact JSON bytes; its file ceiling is 20. Other bounded query limits default to 20 and accept 1–200. The same `localQuery` function implements CLI and MCP reads. The MCP schemas advertise bounded strings for IDs; the shared local query layer further limits strings to 2,000 characters. Valid subject IDs are the returned 64-character digests. Tool arguments must be objects, including `{}` for status. Unknown or missing properties are rejected.

Local mode exposes exactly these eight tools, all annotated read-only. It opens the database read-only, does not scan or append reviews, and does not expose remote proposal, approval, evidence or lease operations. Use CLI `scan` for schema migration, `review` to append an annotation, and `review-export`/`review-import` for archives. A failed local open does not fall back to remote mode. Remove `ASSURANCE_LOCAL_DB` and configure service credentials to use the separate [service tool surface](AGENT_PROTOCOL.md).

The bridge uses newline-delimited JSON-RPC over stdio and protocol version `2025-06-18`. Initialize before `tools/list` or `tools/call`. A request example:

```jsonl
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"example-client","version":"1"}}}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"assurance_local_backlog","arguments":{"category":"SIMPLIFICATION","limit":10}}}
```

Successful calls return both JSON as `result.structuredContent` and the same serialized JSON as a text content block, with `isError: false`. Query errors return a text content block with `isError: true`; transport/method errors use JSON-RPC `error`. The bridge limits request lines to 1,000,000 bytes, serialized tool results to 4,000,000 bytes and active requests to 8. Oversized results fail instead of silently omitting data. Lower the page/node limit; `status` has no size-tuning parameter, so a workspace whose status cannot fit requires a smaller inventory or an implementation improvement.

## Snapshot and retention rules

Each local read uses one SQLite read transaction for its revision and rows. Separate calls can observe different committed scans, so compare their `snapshot` values before combining results. Backlog and review-history cursors pin both scan and annotation revisions across calls; other current-state queries have no historical snapshot selector. Compare `reviewRevision` as well when combining candidate or review results. Drift provides historical changes, not arbitrary historical search/context. The source itself is outside this SQLite transaction: rescan a changed checkout before relying on its metadata.

The scanner stores metadata and before/after drift facts, not full source bodies. Local review reason/evidence text is stored as supplied and may include excerpts. Absolute roots, symbols, paths, revisions, findings and review text may disclose repository information. Keep the database within the repository's normal access boundary and exclude it from Git.

Source projections can be rebuilt, but the SQLite database may hold the **only copy of local review records and their invalidation history**. Do not delete or replace it as disposable cache once annotations exist. Before moving to a new inventory or replacing an index, preserve the old database using SQLite-consistent backup tooling, such as the SQLite backup API, and retain that backup. Copying only a live main file can omit committed WAL data.

History has no automatic compaction or retention. A review archive transfers distinct originating annotations and captured provenance, with permanent restore invalidation; it does not transfer live applicability, remap component/source IDs, or preserve every local restore event. Snapshot numbers, local insertion IDs and cursors belong to their original database. Keep a SQLite-consistent backup for full history and follow the [archive contract](REVIEW_ARCHIVES.md) for bounded transfer. Durable authoritative evidence and decisions remain in the separate service; that service does not automatically back up local annotations.

## Separate service CLI

The service CLI is `node packages/agent/dist/src/cli.js`. It is not selected by `ASSURANCE_LOCAL_DB`. Except for `fingerprint` and `nfr`, commands use the authenticated service client. Configure `ASSURANCE_URL`, `ASSURANCE_WORKSPACE` and the appropriate `ASSURANCE_TOKEN`; see the [API](API.md) and [agent protocol](AGENT_PROTOCOL.md) for authority and request schemas.

| Command | Options/arguments | Behavior |
|---|---|---|
| `scan` | `--config FILE`, optional `--component ID` | Publishes configured components individually to the service. Workspace must match `ASSURANCE_WORKSPACE` (default `demo`). This is not the local all-component SQLite transaction. |
| `call OPERATION` | `--json FILE` or `--json -` | Sends the supplied JSON object to an API operation. |
| `prepare` | `--components a,b --selectors component:a,component:b --intent TEXT`, optional `--supersedes ID` | Prepares a plan and expands remaining mandatory claim details. |
| `validate PLAN_ID` | Positional plan ID | Reads current plan validation. |
| `model` | `--json FILE` or `-` | Calls `models.check`; does not submit authoritative evidence. |
| `trace` | `--json FILE` or `-` | Calls `traces.check`; does not submit authoritative evidence. |
| `nfr` | `--json FILE` or `-`, containing `{envelope, batch}` | Evaluates the local latency envelope without service authentication. |
| `runner` | `--config FILE`, optional `--once`, `--unsafe-local` | Runs configured checker jobs. Use operator-owned configuration and the [security model](SECURITY.md); `--unsafe-local` is an explicit escape from normal isolation. |
| `fingerprint` | `--root DIR --patterns 'glob,glob'` | Computes a Git scope fingerprint locally. |
| `--help` | No service required | Shows help. |

For `--json -`, stdin JSON is limited to 8,000,000 bytes. Service operation payloads have their own validation limits. Runner commands execute checks under a separate authority: local scanning does not grant that authority. Reviewed mission decomposition and `claims.frontier` are documented in [concepts](CONCEPTS.md#the-reviewed-mission-frontier).

## Implementation map

Search normalization and lexical context live in [local-search.ts](../packages/agent/src/local-search.ts); task-brief composition lives in [local-investigate.ts](../packages/agent/src/local-investigate.ts). Review capture, invalidation and restore transactions live in [local-review.ts](../packages/agent/src/local-review.ts), with the bounded canonical archive format in [local-review-archive.ts](../packages/agent/src/local-review-archive.ts). CLI/MCP share [local-query.ts](../packages/agent/src/local-query.ts); [local-cli.ts](../packages/agent/src/local-cli.ts), [local-index.ts](../packages/agent/src/local-index.ts), [scan.ts](../packages/agent/src/scan.ts) and [mcp.ts](../packages/agent/src/mcp.ts) own transport, persistence and scan boundaries. Run `npm run test:local` for investigation, archive and existing local behavior checks.
