# Investigation workload diagnostics

Observed on 2026-09-08 with Node 24.16.0 on macOS arm64. The 1.3 work adds a reproducible investigation workload and optional CLI scan profiling. It does not add a compiler-result cache or a retention policy.

The synthetic tables below were refreshed for the 1.3 implementation with explicit `candidateCoverage` and distinct-origin archive deduplication. They use the checked-in `small`/`larger` presets and supersede earlier development measurements without those fields. The frozen-component profiles cover the same scan instrumentation and are reported separately.

The actionable finding is that TypeScript analysis dominates unchanged scans in the two frozen project components measured here. SQLite ingestion was a small fraction of elapsed time. Incremental extraction merits a controlled experiment; these measurements establish neither cache correctness nor a speedup from caching.

All timings below are diagnostics from one shared host, with up to two independent agent pilot processes potentially active. They are not controlled speed comparisons, production capacity, or evidence that an agent completes a task faster. Initial scans used fresh indexes; operating-system file caches were not cleared. The frozen components are development data, not held-out evaluation tasks.

## Reproduce the bounded synthetic exercise

```sh
npm run build
node scripts/benchmark-investigation.mjs small
node scripts/benchmark-investigation.mjs larger
```

Each invocation uses disposable SQLite databases, prints JSON and removes its databases. Run the presets sequentially in separate processes. The script reports fixture construction separately from scan ingestion and reconciliation plus commit. Compiler extraction, command startup, remote service operations and agent outcomes are excluded. Query time covers `localQuery('investigate', {task, limit, maxBytes})`, including the implementation's response-size accounting; the independent byte assertion runs outside the timer.

Every fact matches the broad lexical task. Each workload has one file owner with many incoming imports, a named function candidate and repeated reviews of that same candidate. Other source candidates remain present, so retrieval and context run against a populated opportunity index.

| Workload | Small | Larger |
| --- | ---: | ---: |
| Components / facts | 1 / 2,000 | 1 / 20,000 |
| Candidates | 400 | 4,000 |
| Incoming owner dependencies | 250 | 2,000 |
| Retained reviews of one candidate | 100 | 500 |
| Initial ingestion, ms | 34.9 | 347.4 |
| Unchanged ingestion with reviews, two runs, ms | 9.3–9.6 | 104.1–104.3 |
| Unchanged reconciliation + commit without reviews, ms | 0.8 | 11.3 |
| Unchanged reconciliation + commit with reviews, two runs, ms | 2.7–4.0 | 26.5–31.2 |
| Dependency change ingestion / reconciliation + commit, ms | 9.7 / 3.5 | 104.3 / 29.9 |
| Dependency revert ingestion / reconciliation + commit, ms | 10.2 / 0.8 | 105.1 / 13.4 |
| Review append p50 / p95, ms | 1.08 / 1.26 | 9.54 / 10.11 |
| Final source database, bytes | 4,947,968 | 45,916,160 |
| Process peak RSS, bytes | 208,715,776 | 412,893,184 |

Commit includes SQLite durability work and review reconciliation; it is not an isolated reconciliation timer. RSS is the whole benchmark process, including generated facts, query objects, archives and the source and restored indexes. Repeated reviews share a candidate and captured source set, exercising the existing reconciliation fingerprint reuse. This does not characterize thousands of distinct reviewed owners or captures beyond that reuse working set.

The investigation measurements below use retained **current** reviews, with 20 repeated queries per case. The script also exercises the same queries before reviews and after permanent invalidation. These small samples do not estimate a production tail-latency distribution.

| Query case | File limit / byte budget | Small p50 / p95, ms | Larger p50 / p95, ms | Small / larger JSON bytes |
| --- | ---: | ---: | ---: | ---: |
| Broad task, minimum budget | 20 / 4,096 | 8.24 / 8.71 | 18.31 / 19.25 | 2,725 / 2,725 |
| Broad task, defaults | 5 / 24,000 | 3.39 / 3.75 | 12.19 / 12.68 | 12,699 / 11,648 |
| Broad task, maximum budget | 20 / 128,000 | 8.49 / 8.79 | 18.72 / 19.19 | 35,069 / 36,120 |
| Exact named owner | 1 / 24,000 | 0.42 / 0.45 | 1.90 / 1.99 | 5,954 / 5,954 |

The minimum-budget case returned zero entries and explicit omitted IDs; default and maximum cases returned five and twenty. Broad retrieval disclosed its exhausted candidate pool and incomplete output. A small output budget does not imply equally small query work: the minimum-budget case still starts with a twenty-file request and evaluates entries before omitting them. Byte limits bound output, not the number of matching index rows examined.

| Archive operation | Small | Larger |
| --- | ---: | ---: |
| Complete records / archive bytes | 100 / 325,688 | 500 / 1,628,988 |
| Export current reviews, ms | 12.0 | 58.6 |
| Import into separately scanned index, ms | 7.9 | 40.4 |
| Repeat import, all records skipped, ms | 6.0 | 25.7 |
| Re-export, ms | 12.1 | 52.6 |

Assertions cover zero drift on unchanged scans, exact changed-fact counts, all retained reviews invalidating when a dependency beyond the first 200-row page changes, and permanent staleness after a revert. They also check current counterevidence changes priority without deleting a candidate, exact JSON-byte accounting, explicit broad-search truncation, complete paginated history, archive import idempotency and original record digests after re-export. Reviews exported while current restore as stale and cannot lower priority. Stale history also exports completely. The exercise fails if an assertion fails.

Archives remain subject to the existing 10,000-record and 16 MiB limits. This exercise stays below those limits and does not measure multi-month retention growth, archival deletion or recovery of the complete SQLite database.

## Profile real extraction separately

On a frozen checkout, copy its scan configuration and use a disposable database:

```sh
node packages/agent/dist/src/local-cli.js scan --config workspace.json --db profile.sqlite --profile
node packages/agent/dist/src/local-cli.js scan --config workspace.json --db profile.sqlite --profile
node packages/agent/dist/src/local-cli.js scan --config workspace.json --db profile.sqlite --profile
```

The first invocation creates the index; the next two are unchanged repeats in fresh CLI processes. Keep the complete profile output private: scan summaries can contain source paths and workspace identifiers. The following aggregates describe two frozen application components. Their source files and original pilot indexes were not modified.

| Measurement | Component A | Component B |
| --- | ---: | ---: |
| Discovered files / facts | 404 / 12,407 | 887 / 20,493 |
| Initial scan total, ms | 7,764 | 8,690 |
| Unchanged scan total, two runs, ms | 6,914–6,937 | 8,016–8,110 |
| TypeScript stage on unchanged scans, ms | 6,762–6,783 | 7,775–7,840 |
| Source discovery on unchanged scans, ms | 17–19 | 22–26 |
| Source revalidation on unchanged scans, ms | 31–32 | 68–69 |
| Context construction on unchanged scans, ms | 26–27 | 33–37 |
| SQLite ingestion on unchanged scans, ms | 72–73 | 113–132 |
| Reconciliation + commit on unchanged scans, ms | 2–3 | 2–4 |
| Analysis-stage process peak RSS across runs, decimal GB | 1.11–1.13 | 1.35 |
| Changed facts on each unchanged repeat | 0 | 0 |

TypeScript accounts for approximately 97–98% of unchanged total elapsed time. That stage includes program construction, type checking, diagnostics, fact extraction and dependency fingerprinting; these profiles do not distinguish those substeps. Peak RSS is sampled during analysis and is not a complete scan-wide allocation profile. There were no retained reviews in these project indexes, so their commit costs cannot characterize review reconciliation at scale.

Both components reported complete discovery and partial semantic coverage; each returned the capped 100-item limitation list. Fact counts and unchanged drift therefore establish stable extracted inventories, not complete behavioral understanding or successful compilation of each project. The next profile should include a representative build target with resolved compiler inputs.

## Decision on incremental extraction

Leave the full-scan behavior in place for this release. The measured cost supports investigating incremental TypeScript work, but the existing profiles do not establish a correct cache key or the benefit of a proposed implementation. The analyzer already accepts an earlier TypeScript `Program` within one analyzer instance; separate CLI invocations do not preserve it. A measured experiment with that existing reuse path is a smaller first step than persisting analyzed results.

Before accepting an incremental path, compare its complete sorted facts, findings, executed rules, coverage, dependency context and publication effects with independent full scans. Exercise unchanged inputs, source edits and reverts, added and removed files, newly resolvable imports, transitive declaration changes, compiler options and configuration inheritance, package resolution changes, scanner/rule versions and environment changes. Preserve discovery and source-mutation checks. A key based only on previously seen files or their timestamps cannot establish equivalence when new inputs become applicable.

Measure parsing, checking, extraction and dependency hashing separately in that experiment. Record repeated initial, unchanged and one-file-edit latency alongside RSS, eviction behavior and the cost of validating every reusable input. The roughly 1.1–1.35 GB analysis-stage peaks make memory retention a first-class constraint for a long-lived compiler process. Adopt reuse only after equivalence checks pass and end-to-end improvement survives those validation costs; no such benefit is claimed here.

A subsequent bounded synthetic differential probe exercised the existing analyzer instance's `oldProgram` path against a fresh analyzer at one fixed root. All thirteen frozen input states produced equal complete sorted analysis results: facts, findings, executed rules, coverage and dependency digest. States covered two unchanged repeats, source edit/revert, added/removed source, an unresolved import becoming resolvable, a transitive declaration edit, compiler-option changes, inherited-configuration changes and a full revert. Arm order alternated and input hashes were checked before and after each arm. The source edit removes a real structural warning and reversion restores it, so finding equivalence is non-vacuous. Two unchanged reuse observations were 23.1 and 14.7 ms, versus 20.5 and 20.5 ms fresh; the mixed result does not establish useful benefit. This was direct extraction of a tiny synthetic component, with both arms sharing a process and no discovery, publication or cache-validation work. It narrows an equivalence question for those inputs, not the remaining production cache or memory-retention gate. Probe code and detailed artifacts remain private development diagnostics.
