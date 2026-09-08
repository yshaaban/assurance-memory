# Validation of Node tooling 1.5

Executed on 2026-09-08 with Node 24.16.0, JDK 21.0.12.1 and PostgreSQL 17 on macOS arm64. The local projection uses schema 4; Java modules remain 1.0.0. Source observations are user-reported investigation data, with no new evidence or approval authority.

## Implementation checks

| Check | Observed result | Scope |
| --- | --- | --- |
| `npm test` | 138 Node tests; 43 Python tests; 25 Java scenarios / 85 assertions pass | Shared extraction, SQLite, CLI/MCP, HTTP, archive lifecycle and pilot boundaries |
| `mvn -B -ntp -Ppostgres-it verify` | Build succeeds; 10 real PostgreSQL assertions pass | Persistence, rollback, concurrency and isolation |
| `bash scripts/test-spring.sh` | Seed and restart-persistence pass | Packaged service survives restart |
| Independent code reviews | Filename selection and task-packet output collision defects fixed; follow-up directory compatibility regression fixed | Architecture/simplicity and integrity/protocol perspectives |
| Independent publication review | No private application source/tasks, secret-shaped values or personal commit emails in reviewed public changes | Read-only review of public diff and history; documentation corrections applied |

The disposable PostgreSQL server and Spring processes were stopped after checks. The full suite passed again after the final release code fixes. Documentation changes do not add new runtime behavior.

Source lifecycle checks exercise real compiler value-only changes, enclosing-file declarations, direct dependency membership, deleted citations, source disappearance/recreation, reversion and explicit re-review. Migration preserves schema-3 records and local precedence; a failed scan rolls back the schema upgrade. Candidate-only version-1 archives remain compatible, while mixed version-2 archives preserve original candidate digests. Imported source notes remain stale or absent and never create findings or discount candidate priority.

A real candidate-free integration goes through scan, source review, quiescent export, fresh-checkout import, brief delivery, explicit re-review and subsequent source invalidation. Export tests preserve original SQLite DB/WAL/SHM bytes, refuse unsafe targets and preserve old archives on failure. Packet tests reject DB/sidecar output aliases before writes while preserving automatic creation of missing index directories. These checks do not prove arbitrary user reasoning correct or make concurrent file copying safe.

## Retrieval and read costs

The [independent retrieval report](RETRIEVAL_1_5.md) preserves all five scored tasks, including a lost intentional counterexample. New ranking retrieves 4/4 owners and 3/3 consumers versus 3/4 and 2/3 previously, but only 1/2 counterexamples versus 2/2. Full packets are larger in this sample. Ordinary fixed search is a separate comparator, not adaptive agent work. The held-out result was not rescored after a separately reviewed filename fix; exact measured implementation hashes remain in the raw report.

A synthetic warm in-memory probe used 1,200 facts, 3,600 source notes and 200 context/history reads. Context median was 0.098 ms after notes, versus 0.092 ms before; p95 was 0.117 ms. History median was 0.029 ms. Reads do not rehash dependencies. These are small local read-path observations, not cold-database or production capacity claims.

## Full-project preflight

Two fresh committed project snapshots were used without editing the original working trees or installing dependencies. Fourteen private controls matched expected outcomes: existing behavior, genuinely failing repair targets, reference fixes, prospective policy changes, intentional no-change cases and harmful broader changes. These controls establish that the bounded oracles discriminate the chosen mechanisms; they are evaluator-authored and remain private.

The first provider-free transport attempt failed because its deterministic driver passed `--json` to a CLI command requiring `--input`. Both structured drivers failed; the two plain drivers completed. The failed artifacts and original driver inputs were retained. No model was invoked and no model trial was replaced.

After correcting the driver, eight deterministic stages passed: two projects, two arms and two successive cycles. Both arms retain plain notes and separately sealed authored tests; those tests remain excluded from protected evaluation. Structured stages create a new physical-root index, export nonempty source history, restore it stale, append explicit local re-review and preserve original files through finalization. A subsequent control exercised the evaluator-owned frozen finalizer against both final preflight indexes and preserved at least two originating source records. No preflight notes or reference changes enter the model-study bases.

Observed first-cycle task preparation in that preflight:

| Snapshot | Configured components | Indexed facts | Task hook wall time | Complete delivered packet |
| --- | ---: | ---: | ---: | ---: |
| Project P | 3 | 34,932 | 16.811 s | 47,959 bytes |
| Project Q | 1 | 10,607 | 6.313 s | 34,082 bytes |

Both reported complete configured discovery. These timings include extraction and task preparation, were collected alongside other preflight work, and cover only the configured components. The nested brief has its own byte limit; complete packets also contain scan coverage and provenance. They are not whole-repository capacity or incremental-scan benchmarks.

## Fresh paired study

The frozen design assigns twelve stages: two fresh missions, two arms and three successive cycles. Both arms receive plain notes and separately sealed authored tests. The structured arm additionally receives fresh task context and source-observation archives. Each provider has a 720-second ceiling, with at most two concurrent providers, ephemeral sessions, the same model/settings and no replacement trials. Only independently accepted production advances to a successor; rejected predecessors leave their dependent assignments blocked.

The provider was Codex CLI 0.153.4 with `gpt-6-astra`, medium reasoning and web search disabled. The copied tool build is pinned to `3de3e13`; source, dependencies, executable paths/bytes, task cards, protected checks, owner groups, generic guidance and review rules were frozen before launch. Both arms have the same guidance access and dependency-copy checks. Evaluator-owned finalization exports history from the frozen tool. The study combines delivery, retrieval and source retention; it cannot isolate the effect of ranking alone.

The anonymous projects below are real committed snapshots. Private application code, task cards, protected checks and raw traces remain unpublished. Study artifacts retain every assignment, failed preflight, sealed source, provider event, immutable decision and blocked descendant. The original project working trees were excluded from candidate mutation, including pre-existing user changes. A final comparison matched their starting HEAD, NUL-delimited Git status and tracked binary diff; untracked file contents were not separately inventoried at the start.

### Outcomes

All twelve assigned outcomes are retained: **eight accepted submissions, two independently rejected submissions and two blocked descendants**. Each arm has four accepted, one rejected and one blocked assignment. All ten providers completed within their ceilings and passed the protected checks; no preparation, harness, integrity or finalization failure occurred in this model study. The failed provider-free preflight remains separate above. No model trial was replaced.

| Project | Cycle | Arm | Provider seconds | Protected checks | Independent decision |
| --- | ---: | --- | ---: | --- | --- |
| P | 1 | Plain | 286.850 | Pass | Accepted |
| P | 1 | Structured | 347.782 | Pass | Accepted |
| P | 2 | Plain | 293.385 | Pass | Accepted |
| P | 2 | Structured | 382.949 | Pass | Accepted |
| P | 3 | Plain | 315.319 | Pass | Accepted; production unchanged |
| P | 3 | Structured | 387.514 | Pass | Accepted; production unchanged |
| Q | 1 | Plain | 314.412 | Pass | Accepted |
| Q | 1 | Structured | 285.709 | Pass | Accepted |
| Q | 2 | Plain | 225.329 | Pass | Rejected |
| Q | 2 | Structured | 258.106 | Pass | Rejected |
| Q | 3 | Plain | — | — | Blocked predecessor; no provider |
| Q | 3 | Structured | — | — | Blocked predecessor; no provider |

The [anonymous machine-readable aggregate](results/longitudinal-1.5.json) preserves all twelve rows, numeric/null outcomes, timing components and available provider counters. Blocked rows have no model-quality, token or provider-time measurement. Private raw artifacts retain original fields and seals; the public artifact uses an explicit whitelist, not automatic redaction of arbitrary source data.

All six accepted repair submissions changed one production owner each. The two accepted final-cycle submissions preserved their predecessor production bytes and added boundary tests. Both rejected candidates were also localized to one owner, so a small edit surface did not establish correct lifecycle behavior. Reviewer-specific policy-site fields are incomplete across schemas and remain null where unreported; no aggregate concept score or measured future-edit reduction is claimed.

One candidate canceled valid replacement work admitted before deferred cleanup; the other allowed obsolete queued work to revive after an epoch value changed away and returned. Independent reviewers reproduced both against the exact submitted hook with real React effect ordering and mocked timers/transport. These are bounded hook-level reproductions, not observed browser incidents. The submitted tests covered different sides of the boundary, and neither protected oracle exposed both. Passing checks therefore did not establish accepted behavior.

### Retained reasoning and delivery

In cycle one, both structured briefs placed the owner first. One owner had no detector candidate, demonstrating actual use of the new source subject. The two archives held seven append-only source records, including counterevidence and a naming correction. In cycle two, all seven records survived import to new physical roots with stale applicability; five prior targets were explicitly re-reviewed and unrelated historical claims were left stale. The resulting archives retained thirteen records, including six new local records. Successful append is observed; a post-append `CURRENT` field was not printed, so it is not inferred from execution logs.

The second-cycle queue brief omitted its owner from all five entries and delivered none of the retained source notes. The agent recovered through the plain handoff, current source and explicit search/context queries. The cache brief included its owner at rank two and delivered a stale source review. Retention worked in these stages, but automatic delivery did not reliably surface the required prior reasoning. Source-note prose is not currently searched or promoted as an independent retrieval channel.

In the final eligible structured stage, the owner returned to rank one with two stale source summaries. Its archive preserved seven imported records and added seven counterevidence records: four prior targets re-reviewed and three new targets. All original captures survived; the final archive held fourteen records. Across the five structured provider stages, the initial brief contained the required owner in four, with the second-cycle miss retained. One search exited unsuccessfully while an asynchronous scan was active; later queries succeeded. A missing-file lookup also remained in the trace. The underlying search stderr was not captured, so the cause is unknown.

Both arms rechecked earlier reasoning and revised it when the new task changed the contract. No unsafe reliance on stale notes was observed across the ten audited provider stages. All eight primary owners were read before edits; contextual pre-edit consumer coverage was 13/14 groups. The remaining group appeared as a search reference before the edit and was read in full afterward. Mechanism acceptance is separate from this weaker protocol observation. Retained authored tests were restored unchanged and rerun in the second cycle; four carried test files were again unchanged and rerun in the final eligible cycle. That cycle had no production edit: both primary owners and all four required consumer groups were inspected separately from the pre-edit denominator. These tests remain untrusted artifacts excluded from protected evaluation.

### Effort and operational cost

The following sums cover five completed provider stages per arm. Blocked assignments contribute no invented duration. These are nested accounting views: stage orchestration includes preparation, provider work, protected evaluation, copying/inventory and finalization. Finalization includes its hook and inventory columns. The residual is derived unitemized overhead, not a separately measured inventory benchmark.

| Recorded duration, seconds | Plain | Structured |
| --- | ---: | ---: |
| Provider elapsed | 1,435.295 | 1,662.060 |
| Preparation hooks | 29.941 | 90.845 |
| Protected evaluation | 9.665 | 10.468 |
| Structured finalization, total | Not configured | 83.954 |
| Finalization hook (included above) | Not configured | 1.643 |
| Finalization inventory (included above) | Not configured | 82.235 |
| Other stage overhead, derived residual | 118.065 | 114.740 |
| Stage orchestration, inclusive | 1,592.966 | 1,962.067 |

No task-end hook is configured in the plain arm; its ordinary sealing work remains in orchestration. Most structured finalization time here came from the evaluator's inventory checks, not archive export itself. Other inventory phases were not separately metered.

| Recorded effort or counter | Plain | Structured |
| --- | ---: | ---: |
| Independent mechanism review, active seconds | 737.061 | 920.352 |
| Provider commands | 87 | 113 |
| Reported input tokens | 3,154,069 | 5,275,128 |
| Reported cached input tokens | 2,866,560 | 4,881,664 |
| Reported output tokens | 39,361 | 43,891 |
| Reported reasoning output tokens | 1,983 | 2,052 |

The available provider counters cover all ten completed submissions; blocked rows remain null. Categories can overlap and must not be added into a token or billing total. These figures describe the recorded runs and include their failed commands/retries. They do not measure model attention, purchase price or a causal tool effect.

Whole runner invocations took **765.233, 765.704 and 821.995 seconds**, totaling **2,352.931 seconds**. They include overlapping stages, repeated verification and summaries, and are a separate wall-time view from the stage sums. Independent mechanism review totaled **1,657.413 active seconds**; pooled trace audits took **1,364.574 active seconds**. Reviewer intervals can overlap with each other and execution, so their sums are effort observations, not elapsed project time.

Measured mission preparation was **1,146.737 active seconds**, and private aggregation preparation was **311.645 active seconds**. Initial reconnaissance, root setup, preflight correction/coordination and final reporting/review coordination were not fully metered. Those components and billing remain **unknown**, not zero. This is a partial measured effort ledger, not a defensible complete cost total. Rework inside recorded provider/reviewer intervals is included; unmetered evaluator rework is not silently assigned to either arm.

The structured arm used more recorded provider time, commands and input tokens in this sample, with equal accepted/failed/blocked counts. The study therefore establishes no net effort advantage. Different conditional source histories, a bundled treatment and the small correlated sample prevent attributing the difference to retrieval or retained notes alone.

### Review and limits

Separate AI reviewers inspected masked candidate packets and actual source mechanisms without seeing arm mappings, provider traces or protected oracle source. Submitted prose could reveal the treatment, so blinding is incomplete. The trace auditor authored the tasks/oracles and is mission familiar; that audit is separate from mechanism acceptance. Recorded commands and seals support the stated actions and integrity checks, not complete model attention or hermetic proof of every possible read.

The missions are fresh relative to earlier path-policy pilots but both concern asynchronous lifecycle ownership. This is a small correlated diagnostic, not a representative project sample or a statistically powered comparison. The earlier independent retrieval counterexample loss remained unresolved at launch; this bounded study investigates the integrated workflow and does not graduate the retrieval-value gate. Failed candidates and blocked successors prevent a claim of complete successful maintenance across all three cycles.

The next investigations are [prior-owner and counterexample retrieval](https://github.com/yshaaban/assurance-memory/issues/13) and [lifecycle counterexamples and pilot acceptance](https://github.com/yshaaban/assurance-memory/issues/14). Known pilot failures become development cases. A further outcome claim requires fresh tasks and independent acceptance, with preparation, review, rework and missing cost components retained. No detector graduates and no net agent-efficiency benefit is established.

## Final path-alias review

After the model study was frozen, an additional APFS probe found that differently cased sidecar output paths could evade string comparisons. Task-start now compares the reserved packet inode/device with every canonical/physical database and sidecar path before opening SQLite, and rejects dangling database leaf symlinks. Task-end uses conservative normalized case-folded path comparisons before copying or publishing. Seven focused integration tests and independent reviewer reproductions pass. These changes harden output paths; the study keeps its exact earlier helper bytes and ordinary non-aliasing paths. No provider was rerun to incorporate the correction.
