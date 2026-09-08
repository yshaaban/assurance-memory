# Retain reasoning about source without a detector finding

A small policy function can matter even when no detector reports it. For example, a display identifier may preserve letter case while a request identifier deliberately normalizes it. A reviewer can retain the reason for keeping those contracts separate against the existing source fact. This does not require creating a scanner candidate, and it does not establish that the reasoning is correct.

Source observations use the same append-only local review records, captures, invalidations and archives as candidate reviews. There is one store and two explicit subject selections: an emitted `candidateId`, or an existing `sourceId`. A source observation has `candidateId: null` and `candidate: null` in its result. It never changes candidate ranking or creates, approves or resolves a finding, requirement or debt.

## Select an existing source

Search for the actual owner, read its source and inspect its indexed context. Use the exact source ID and snapshot returned by the index; paths, query strings and guessed identifiers are not accepted as substitutes.

```sh
assurance-local search 'displayKey' --db .assurance-cache/index.sqlite
assurance-local context '<source ID>' --db .assurance-cache/index.sqlite
```

Write a review file using **exactly one** of `sourceId` or `candidateId`:

```json
{
  "sourceId": "<source ID from search/context>",
  "expectedSnapshot": 2,
  "disposition": "COUNTEREVIDENCE",
  "author": "reviewer",
  "reason": "Display identifiers preserve case because distinct labels are visible to users.",
  "evidence": "Read displayKey and its rendering caller. The request normalizer has a different input contract.",
  "factIds": ["<existing caller source ID>"]
}
```

```sh
assurance-local review --input review.json --db .assurance-cache/index.sqlite
assurance-local reviews '<source ID>' --kind SOURCE --db .assurance-cache/index.sqlite
```

Omit `factIds` when there are no additional selected facts. Every cited fact must exist. The existing review limits apply: IDs and author at most 200 characters, reason 2,000, evidence 8,000, at most 32 additional source IDs, and a CLI input file of at most 65,536 bytes. Strings must be nonempty and contain no NUL. Unknown fields, both subject IDs, missing subjects and an outdated `expectedSnapshot` fail without appending a note.

`reviews` defaults to `--kind CANDIDATE` for compatibility. Source and candidate IDs occupy separate review namespaces even if their text were identical. Pagination pins the subject kind and ID, source snapshot and review revision. `context` returns the latest effective source observation in `sourceReview`, separately from candidate reviews. Local MCP uses the same query implementation: `assurance_local_reviews` accepts `{ "id": "<source ID>", "kind": "SOURCE" }`; it remains read-only.

## What stays current

A capture retains the exact selected fact, its enclosing file fact, any explicitly cited facts, complete direct-import/importer fingerprints and counts, and component context. File content includes value/body changes and additions or removals of declarations. Dependency captures include currently absent targets, so a previously unresolved target appearing changes the capture. A new importer, removed import or changed direct neighbor also invalidates the old judgment. Component context covers analyzer/configuration/environment/coverage and revision changes; this can conservatively invalidate a note beyond its immediate subject.

A scan publishes source changes and permanent review invalidations in one transaction. A failed scan publishes neither. A truly unchanged capture remains `CURRENT`, meaning applicable **as of that scan**, not verified or continuously synchronized with working files. Source edits after the scan remain unobserved until the next successful scan.

A source observation is `SOURCE_ABSENT` when its selected fact is no longer indexed. Otherwise, a permanently invalidated observation is `STALE`. Returning the original bytes or recreating the same fact ID does not revive it. Re-read the new source and explicitly append a new review if the reasoning still applies. Old notes and captures remain available through `reviews --kind SOURCE`, including after deletion, when `context` can no longer look up that fact.

There is no glob, directory, arbitrary natural-language claim or new subject identity. Scope means the selected source/file, explicit citations, direct dependency membership and captured component context. These pins do not promise complete caller discovery, runtime behavior or absence of dependencies. Entire component inventory changes still require the existing new-index workflow; they are not silently adopted.

## Upgrade and transfer

Schema 4 extends the existing review table with mutually exclusive candidate/source columns. Migration preserves original row IDs, body bytes, fingerprints, timestamps, invalidations, revision and local-review precedence. CLI scan commits migration with a successful source scan. Failure rolls the schema and source publication back together. Read-only queries, MCP, exports and review writes against an older index request a scan instead of silently migrating it. Keep a SQLite-consistent backup when upgrading; an old tool rejects schema 4.

[Review archives](REVIEW_ARCHIVES.md) export version 1 when all records are candidate reviews. If any source observation exists, export uses version 2; original candidate records retain their exact record digests and captures. The new importer accepts both versions, and both use the same complete-or-fail size and record limits.

Imported source observations always receive `ARCHIVE_RESTORE_REQUIRES_REVIEW`. They are `STALE` if their exact source exists, or `SOURCE_ABSENT` otherwise. Matching source, a later rescan or reversion cannot promote them to `CURRENT`. Re-export preserves original captures and provenance. Locally submitted observations retain precedence over imported history; import cannot replace a local judgment or fabricate a missing source. Physical checkout changes use a fresh index and an archive, as described in the [task workflow](TASK_WORKFLOW.md).

The behavior tests include a real compiler scan of a candidate-free display policy, value-only edits, new declaration membership, deletion/recreation, direct dependency changes, mixed-version archives, CLI/MCP parity and failed migration from an actual schema-3 table. They validate lifecycle and authority boundaries; they do not prove improved agent outcomes.
