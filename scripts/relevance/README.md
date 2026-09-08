# Deterministic task relevance comparison

This public fixture tests whether a bounded brief contains the specific source owners, consumer groups and intentional-difference examples named in predeclared labels. It does not measure whether an agent reads or benefits from that context. The fixture is small, hand authored and deliberately generic; it is not production-scale evidence.

Run after `npm run build`:

```sh
node scripts/relevance/run.mjs --split development --output /tmp/relevance-development.json
node scripts/relevance/run.mjs --split held-out --output /tmp/relevance-reserved.json
```

Output must be a new file. The runner verifies every SHA-256 in `freeze.json` before scoring and makes no model requests. It reads its fixture, writes disposable indexes under the system temporary directory and removes them on completion. `rg` and the repository's supported Node runtime must be installed.

The fixture, task labels, comparison settings and exact 1.4 brief implementation were frozen in commit `62b5a90` before ranking changes. `held-out.json` is withheld from scoring during development, but its author is the implementation engineer. It is **author-known reserved validation**, not an independently blinded sample. The first development result and subsequent development iterations remain in `results/`; poor relevance and additional bytes are not discarded.

An independent corpus can be scored without changing or tuning the committed implementation:

```sh
node scripts/relevance/run.mjs --split held-out --output /tmp/independent.json --corpus /path/to/frozen-corpus
```

That directory needs `fixture/`, `held-out.json`, and `freeze.json`. The freeze contains `protocol.limit`, `protocol.maxBytes`, `protocol.latencyRepetitions` and `files`, a mapping of relative input filenames to SHA-256 digests. The committed 1.4 comparator is always used. Freeze independent tasks and labels before revealing them to the implementation author; score once after freezing the ranking code and retain misses without tuning to that scored sample.

Each task is `{id, task, owners, consumers, counterexamples}`. The last three fields are arrays of groups: each group lists acceptable exact fact locators such as `queue/leaseOwner.ts#renewLease`. A group scores once if any listed locator appears in a substantive source-bearing entry. `ambiguous: true` and `acceptable: ["path.ts"]` allow ambiguity cases to define relevant files without inventing an owner-recall denominator. Empty-label negative cases remain in irrelevant-entry and byte totals. Fixture owner functions use explicit `export function` declarations, which the ordinary-search scorer maps to declaration and body lines.

The three comparisons are:

- **Previous:** the frozen 1.4 investigation projection, using the same unchanged lexical-search implementation and index.
- **Current:** the shared production `localQuery(..., 'investigate', ...)` path used by CLI and MCP.
- **Ordinary:** literal case-insensitive `rg` OR over normalized non-stopword task words, two context lines, sorted paths, first five matching files and the same response byte limit. A declaration and following body line must both be present to count a labeled function. This fixed script is a simple ordinary-search baseline, not an adaptive agent or experienced human investigation.

For structured briefs, the exact labeled locator must be present in `source`, `matches`, `owners` or `nearbySymbols`. A filename in coverage warnings, an import neighbor, a file overview or an unrelated symbol does not score an owner hit. Irrelevant entries are files outside all predeclared groups and allowed ambiguity paths; the report also counts their serialized bytes. These scores measure retrieval opportunities, not observed substantive reading.

Every task prepares a real task-start packet. Complete packet bytes include the task, scan metadata, coverage warnings, profiling, limitations and trailing newline; they are not assumed to equal the nested brief limit. Comparator byte totals replace only the nested investigation response in that same actual envelope. Plain notes are absent in this controlled fixture. The real current scan/hook preparation interval is reported separately from seven rotated warm query/serialization timings per method. Ordinary `rg` needs no index; do not add the current scan cost to it or present these warm-query times as end-to-end savings.

The task-only ranking uses at most six explicit identifier/path probes and twenty normalized term probes, with per-probe result limits. Exact source mentions stay strongest. When exact mentions resolve, other lexical files are counted as omitted lower-confidence context instead of filling the file quota with weak matches. This can miss relevant consumers that were never named: callers still need to inspect the explicitly bounded import context and search further. Without exact anchors, broad lexical results remain possible and no confidence claim is made.

The byte allocator reserves compact source identity and review summaries across selected files before expanding effects, symbols and explanations. Compact entries explicitly list omitted detail and retain follow-up IDs. Source and candidate reviews retain their reported state, original text truncation markers and history/context pointers; ranking never refreshes a review or grants evidence authority. Every query remains inside the existing read transaction. Ordinary search, aliases, schema and index storage are unchanged.

## Recorded results

The development comparison improved from 3/4 owner groups and 2/3 consumer groups in the previous brief to 4/4 and 3/3 in the final development iteration. Both retrieved the one counterexample group. The initial new implementation retrieved those groups but increased irrelevant entries from five to seven and brief bytes from 38,591 to 52,816; that result remains in `results/development-initial.json`. Exact-anchor file selection reduced the final development count to zero irrelevant entries and 35,355 brief bytes. `results/development-final.json` predates a presentation-only clarification of bounded review coverage; its implementation digest records the exact measured version.

The author-known reserved split was scored once after implementation commit `8472320`; ranking was not changed afterward:

| Measure across seven reserved tasks | Previous brief | Current brief | Ordinary search |
| --- | ---: | ---: | ---: |
| Owner groups retrieved | 3/4 | 4/4 | 3/4 |
| Consumer groups retrieved | 3/4 | 4/4 | 2/4 |
| Counterexample groups retrieved | 1/1 | 1/1 | 1/1 |
| Irrelevant file entries | 10 | 1 | 18 |
| Bytes in irrelevant entries | 21,696 | 2,051 | 11,049 |
| Complete nested response bytes | 56,563 | 46,086 | 15,349 |
| Complete delivered packet bytes | 70,608 | 60,131 | 29,394 |
| Median warm query/serialization time | 1.028 ms | 1.172 ms | 4.419 ms |
| 95th percentile warm query/serialization time | 1.725 ms | 1.745 ms | 7.602 ms |

The current brief still returned one irrelevant file for the ambiguous status task. The previous brief missed the late-mentioned owner and consumer; ordinary search also missed the CSV consumer group because earlier alphabetically ordered broad matches exhausted its five-file window. These failures remain in `results/author-known-reserved.json`. The structured packet is substantially larger than the ordinary-search packet despite having fewer irrelevant files. Small metadata fixtures and a fixed grep script cannot establish saved engineer or model effort.

The full repository test suite passed after the ranking freeze: 126 Node tests, 39 Python tests and 25 Java scenarios / 85 assertions. New behavior tests cover a named owner and separate consumer after noisy prose, helper-heavy retrieval, compact provenance under oversized context, and retained stale counterevidence. Existing shared-query, omission, snapshot/review, CLI and exact byte-accounting checks remain enabled.
