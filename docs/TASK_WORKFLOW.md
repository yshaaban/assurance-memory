# Deliver context at task start

`scripts/task-context.mjs` refreshes a local index and produces a task packet before an agent begins work. It uses the existing scan, investigation and review-archive APIs; it adds no knowledge store, detector, provider dependency or assurance authority. **Keep each index with its physical checkout.** Carry review archives and plain notes when work moves to another checkout.

```sh
npm run build
mkdir -p .local/task
# Write the actual maintenance request to .local/task/task.txt.
# Optionally put earlier investigation notes in .local/task/notes.md.
npm run task-context -- \
  --config /absolute/path/to/workspace.json \
  --db /absolute/path/to/index.sqlite \
  --task .local/task/task.txt \
  --notes .local/task/notes.md \
  --output .local/task/context.json
```

Deliver the task and the resulting JSON to your agent through its normal prompt or attachment mechanism. The hook does not invoke an agent, modify application source, run application checks or publish anything. Keep packets private: they contain source locations and retained reasoning. Use a new output filename for each attempt. Packet output must be separate from the index and its WAL/SHM sidecars; aliases of those paths are rejected before creating the packet or scanning. An existing output is never overwritten; a failed scan, import or query removes the incomplete output and returns a nonzero exit status. Completed scans and imports remain committed even if a later packet query fails.

## Move reasoning between checkouts

An index records the real filesystem root of each component. Copying its SQLite file into another checkout does not move that binding. A scan against a different root is rejected, even when the component identifier and source bytes match. This protects the source context captured by existing reviews.

For a new checkout, select a new index path and explicitly supply a portable [review archive](REVIEW_ARCHIVES.md). Choose the paths named by these shell variables for your previous index, new checkout configuration, task, notes, archive and new packet:

```sh
# Close every connection to the previous index and stop index/output writers first.
npm run task-handoff -- --db "$prior_index" --output "$review_archive" --quiescent
npm run task-context -- \
  --config "$checkout_config" \
  --db "$new_index" \
  --task "$task_file" \
  --notes "$notes_file" \
  --review-archive "$review_archive" \
  --output "$new_packet"
```

`--review-archive` requires an absent destination database path, including absent SQLite sidecars. The hook validates the complete archive before creating the index or packet, scans the new checkout, imports the exact validated bytes through the existing review API, then produces the investigation. The archive limit remains 16 MiB and 10,000 originating records; malformed, corrupt or over-limit inputs fail without importing a prefix. Archive input is optional and independent of plain `--notes`.

Restored observations preserve original captures, provenance and history. Candidate reviews are `STALE` when their candidate exists and `CANDIDATE_ABSENT` when it does not. Source observations are `STALE` when their exact selected fact exists and `SOURCE_ABSENT` otherwise. Restoration never creates a missing candidate or source or establishes current applicability, including after an unchanged rescan. Inspect current source and append a new local review when warranted. Preserve the old index and archive; the hook never rewrites root bindings or deletes an old database.

`task-handoff` supplies the task-end export boundary using the existing review archive API. **Close every index connection and stop all concurrent index and output writers before passing `--quiescent`.** The flag acknowledges that precondition; it does not close connections, acquire application-wide locks or establish quiescence automatically. Provider exit alone is insufficient if background processes remain. This is not an online backup procedure.

The helper streams hashes of the complete database and existing WAL/SHM files, copies them into disposable scratch beside the output, and opens only that copy for export. It validates the complete archive, verifies the copied bytes and checks that the original index files remain unchanged before publication. This prevents an ordinary read-only SQLite export from updating the original sidecars. Hash checks detect observed changes; they do not make a concurrently copied database transactionally consistent.

The output parent must exist. A new archive is created exclusively with owner-only permissions. If intentionally replacing a carried archive, add `--replace`: the existing file must itself be a valid complete archive, and the validated new archive replaces it atomically. Other existing files are rejected. Output must be separate from the index and its sidecars. This replacement contract requires a sole output writer; it is not a compare-and-swap protocol for concurrent writers. Scratch is discarded, and only the review archive moves to the next checkout. The helper reports source provenance, record/byte counts, index-file hashes and measured phase costs; it does not rescan, append a review or establish current applicability. See [longitudinal integration](LONGITUDINAL_PILOTS.md#integrating-task-context) for use as a frozen finalizer.

A new per-checkout index has no previous local source snapshot to compare. The packet therefore reports `sourceChanges.availability: UNAVAILABLE_ACROSS_INDEX_ROOTS`, rather than an empty list claiming there was no drift. A review archive carries observations and source captures, not the old source-fact/drift database. Later tasks in the same checkout can reuse that new index normally, without `--review-archive`, and report changes between its local snapshots.

The scan and review import are separate committed operations. A later failure leaves the new index available for inspection; the incomplete packet is removed. The archive option does not automatically replace or reset that index on retry. Select another new index path or inspect/recover the existing one through the ordinary local commands.

## What the packet says

| Field | Meaning |
| --- | --- |
| `task` | Exact UTF-8 text, input byte count and SHA-256 |
| `retainedNotes` | Optional exact UTF-8 prose, hash and explicit `UNVERIFIED_USER_TEXT` / `NOT_ESTABLISHED` labels |
| `investigation` | Existing bounded lexical brief, source anchors, candidates, review states and explicit omissions |
| `reviewImport` | Optional import counts, archive source/digests and the explicit `STALE_OR_SUBJECT_ABSENT` boundary |
| `sourceChanges` | Up to 100 changes between snapshots in the same index, with `hasMore`/`next`; explicit unavailability when importing into a new checkout index |
| `preparation` | Measured hook and scan costs, component coverage and extraction/projection profiles |

The hook checks scan and review revisions before completing the packet. It rejects a concurrent scan or review change observed across its queries. Source freshness still means **as of the scan**: the hook does not lock the application against subsequent edits.

`--limit` defaults to five files and accepts 1–20. `--max-bytes` defaults to 24,000 and accepts 4,096–128,000. These limits apply to the nested investigation brief, not the entire packet. Task text is limited to 2,000 characters and 8,000 UTF-8 bytes. Optional notes have a separate 65,536-byte complete-or-fail limit. BOMs and line endings in retained notes are preserved. Invalid UTF-8 and oversized inputs fail; no prose is silently shortened. Parent directories must already exist, and the output is created with owner-only permissions.

## Close one change before starting the next

1. State the requested behavior and identify its source owner and relevant consumers. Read source to assess the brief's suggestions and omissions.
2. Implement the bounded change and run behavior checks. Preserve independently changing responsibilities even when their code looks similar.
3. Retain the reasoning that is expensive to reconstruct: rejected hypotheses, concrete counterexamples, intentional differences, changed assumptions, actual checks and unresolved uncertainty. Include source references. A copied summary of the code often adds less value.
4. Use the [local review workflow](LOCAL_REFERENCE.md) to append a note against exactly one existing `candidateId` or `sourceId`. [Source observations](SOURCE_OBSERVATIONS.md) retain reasoning about ordinary source even when no detector finding exists. Keep other prose explicitly unverified. Close all index connections and run `task-handoff` when the next task will use a different checkout.
5. Start the next task with another scan and packet. Reuse the index only in the same checkout; use a fresh index plus review archive after moving roots. Use available source changes and original captures to decide what to inspect again. A passing previous check, unchanged prose or restored archive does not establish current applicability.

Source observations share candidate reviews' append-only history, captures, invalidation and archives. They never change candidate ranking or create assurance authority. A `CURRENT` note means its indexed capture still applies as of the scan; it does not verify the author's reasoning. Changed or deleted source, dependency membership and captured context require inspection and explicit re-review. Reversion never revives an invalidated judgment. The service's reviewed claims, evidence and debt obligations remain available when authoritative coordination is needed.

## Evaluate contribution

Automatic delivery establishes availability. Inspect traces and decisions to determine whether the context was used, whether it identified a necessary owner, and whether retained reasoning helped or misled the agent. Count preparation, agent time, review and rework together. The [longitudinal pilot guide](LONGITUDINAL_PILOTS.md) implements separate source/notes histories, immutable assignments and review gates. Its ordinary-tools arm receives the same opportunity to retain notes; later prose can differ because the agents' investigations differ.

Tests exercise real scanning across a source change, note preservation, failed-scan cleanup, invalid bounds before indexing, refusal to replace a previous packet and execution through a symlinked script path. A real scanner candidate is reviewed, exported and restored across different roots; tests preserve the original index, reject moving its root, retain original archive records, keep restored observations stale after rescan, and retain absent-candidate history without recreating a candidate. Corrupt and oversized archives fail before index/output creation. These are integration checks of delivery and freshness reporting, not evidence of an agent efficiency benefit.
