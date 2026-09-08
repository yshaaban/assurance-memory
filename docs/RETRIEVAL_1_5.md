# Independent retrieval check

The root evaluator authored five synthetic adversarial tasks after ranking commit `8472320` was frozen and before scoring. That worktree implementation was imported into the public branch as `5efb73f` with identical ranking source. The implementation engineer did not see these tasks or labels. This is separation between evaluator and implementer, not a random production sample or independent human certification. The corpus and its pre-score hashes are now public under `scripts/relevance/independent`.

The [raw result](../scripts/relevance/results/independent-reserved.json) records the exact compiled implementation digest, source-label groups, all task outcomes, response bytes and rotated warm-query timings. It was scored once. No failed task was replaced or used to tune the ranking. The runner also emits a generic “not independently blinded task labels” limitation inherited from its original author-known corpus. That literal raw field is retained: here the evaluator authored the labels independently of the implementation engineer, but the evaluator knew them and the study had no external human blinding. The corpus-specific frozen protocol records that narrower separation.

| Measure | Previous brief | New brief | Fixed ordinary search |
| --- | ---: | ---: | ---: |
| Owners | 3/4 | 4/4 | 4/4 |
| Consumers | 2/3 | 3/3 | 3/3 |
| Intentional counterexamples | 2/2 | 1/2 | 1/2 |
| Irrelevant file entries | 2 | 2 | 7 |
| Total brief bytes | 32,482 | 37,507 | 5,976 |
| Total complete packet bytes | 42,744 | 47,769 | 16,238 |
| Median warm query | 0.689 ms | 1.204 ms | 4.312 ms |
| p95 warm query | 1.759 ms | 2.465 ms | 8.518 ms |

The new brief retrieves the labeled owners and consumers but loses an unnamed independent retry-budget counterexample when the task explicitly names delay and delivery functions. Exact-anchor file selection intentionally excludes lower-confidence lexical files, exposing the omission count and a follow-up instruction. The two irrelevant entries remain in the denominator. This supports a narrow owner-retrieval improvement and exposes a counterexample-discovery gap. It does not establish a uniformly better investigation, lower total cost or faster agent work.

Complete packet comparisons replace the nested brief in the same measured task-start envelope; they are not executions of a historical task hook. Ordinary search is a fixed case-insensitive `rg` OR over task words, two context lines and the first five path-sorted matching files, not an adaptive engineer. Its lower byte cost matters. Timings exclude indexing; the raw rows retain current scan/preparation time separately. Zero-label tasks contribute to bytes and irrelevant entries without invented recall. A returned locator is an opportunity to inspect source, not evidence it was understood.

The implementation engineer's separate [development and author-known reserved results](../scripts/relevance/README.md) are smaller public authored fixtures. Their stronger outcomes should not override this independent failure.

After scoring, a separate code reviewer found that an explicit basename including an extension, such as `csvWriter.ts`, could be omitted beside another exact symbol. A focused mixed-symbol/filename regression now covers the fix. The held-out rows were not rescored after that change or after task-packet alias/freshness fixes. Their recorded digests identify the measured revision; final release behavior is covered by regression tests and the separately frozen project pilot.

To run a new diagnostic against the current build, choose a new output filename:

```sh
npm run build
node scripts/relevance/run.mjs --split held-out --output .local/new-independent-diagnostic.json --corpus scripts/relevance/independent
```

The published tasks are now development data. A subsequent efficacy claim needs fresh tasks, with owner, consumer and intentional-counterexample groups labeled separately before implementation changes.

Follow-up investigation is tracked in [issue #13](https://github.com/yshaaban/assurance-memory/issues/13), including prior-owner changes, stale/absent source notes and intentional counterexample retrieval.
