# Investigation pilots: measuring agent outcomes

This document retains the original bounded pilot protocol and its historical evidence. The current source-observation workflow is evaluated separately in [1.5 validation](VALIDATION_1_5.md). Published tasks are development data; follow-up work is tracked in [prior-owner and counterexample retrieval](https://github.com/yshaaban/assurance-memory/issues/13). A completed implementation or accepted repair does not establish net agent benefit.

Status, 2026-09-08: an initial controlled A/B lifecycle calibration is complete. Its four agent runs produced successful repairs in both arms, with no demonstrated efficiency benefit. This checks the calibration tasks and harness; it does not establish general product value or complete the proposed three-arm Stage 1 below. Repository-specific task choices, source and detailed reports stay outside the public repository.

Those tasks and their search phrases have informed development and are now development data. Keep them for regression checks, but exclude them from the next evaluation set. The subsequent completed study conducted during 1.3 development used a frozen **1.2** tool build; it does not evaluate the new 1.3 task brief. Its [separate report](VALIDATION_1_3_PILOTS.md) retains every assigned row and actual tool use. A future 1.3 outcome claim requires fresh tasks and a pinned 1.3 treatment. The executable [pilot harness](PILOT_HARNESS.md) supplies frozen-input checks, randomized assignments and protected evaluation; availability alone cannot establish treatment use, accepted outcomes or an efficiency benefit.

All 16 protected behavior checks and blind mechanism reviews passed, with all 32 necessary source groups inspected. However, none of the eight tool-enabled runs used the optional CLI, and three runs consulted external generic workflow skills. The product-value gate remains unmet. The immediate next experiment should test the 1.3 task entry point on fresh tasks that require combining dispersed sources, with predeclared tool access, generic workflow inputs, read boundaries and complete preparation/context costs. Preserve the existing repair, simplification and intentional no-change controls. Do not expand to the broader study solely because both arms completed these bounded tasks.

## The decision the pilots must answer

Does Assurance Memory help an agent make a correct, useful change in a complex repository with less search and rework, while retaining appropriate uncertainty? Counts of indexed facts, candidates or tool calls cannot answer that question.

We will compare three explanations for value independently:

| Pilot | Question | Primary evidence |
|---|---|---|
| Retrieval and investigation | Can the agent find the code, callers and constraints needed for a real task? | Relevant-source recall, unnecessary reads, correct mechanism explanation, context size and latency |
| Evidence freshness | Does a change invalidate exactly the assumptions that must be revisited? | Known-change detection, new scope membership, stale-context rejection, unaffected evidence reuse |
| End-to-end repair or simplification | Does the agent deliver a behavior-preserving or correctly repaired patch more often or more efficiently? | Protected behavior checks, blinded review, complete task success, total time/tokens/cost, change surface |

The third pilot is the product test. The first two diagnose why it succeeds or fails.

## Candidate experiment designs

| Design | Value | Main risk | Decision |
|---|---|---|---|
| Scan-and-rank dashboard | Cheap way to inspect candidate quality | Can optimize for plausible-looking findings with no effect on completed work | Use only for calibration |
| Historical bug replay | Real examples with known intended behavior | The solution can leak through Git history, tests or task wording | Use a frozen base and external task oracle |
| Controlled drift injection | Exact knowledge of the changed assumption, including missing-edge cases | Artificial mutations can be easier than real failures | Use alongside real tasks |
| Paired agent task trial | Directly measures whether the layer helps complete work | Different context, budgets or model versions can dominate the result | Primary evaluation |
| Concurrent-agent missions | Tests handoffs, contention and evidence reuse | Adds orchestration confounds before basic value is established | Defer until single-agent trials pass |

The non-obvious control is a **stale index**: deliberately change the source or environment after preparing context. An agent that finishes quickly by trusting old information should lose, not receive a retrieval-efficiency bonus.

## Repository selection

Start with one clean TS/JS repository having fast behavioral tests and a clear subsystem boundary. Then use a larger TypeScript/React application with state/lifecycle interactions. Add a second large repository with independent provenance before claiming generality. Treat Git worktrees, copied fixtures and submodules as related data, not independent repositories.

Use concrete build-target tsconfigs. Establish an unchanged baseline before interpreting diagnostics. Incomplete semantic coverage is an experimental condition to report, not a reason to suppress errors. Do not start with unsupported-language projects, sensitive production workflows, or an entire monorepo as one undifferentiated task.

## Stage 0: reproducible task and oracle preparation

For each candidate task, record:

- Task ID and family: lifecycle defect, policy inconsistency, simplification, or dependency/context drift.
- Repository identity, exact base commit, relevant submodule commits, build target and lockfile digests.
- Natural-language task, expected observable behavior, scope exclusions and public project instructions.
- Protected validation commands, oracle inputs and expected results owned by the evaluator.
- Ground-truth source/caller set for retrieval scoring, with a mechanism explanation reviewed separately from the candidate detector.
- Baseline index digest, scanner/candidate-policy digest, coverage gaps and environment fingerprints.
- Search-policy digest, schema version, review revision and any supplied annotation history/applicability state.
- Model/version/settings, provider/harness version, allowed tools, time/token ceiling and run seed.

Keep solutions, hidden tests and reviewer notes outside agent-visible worktrees and searchable history. A historical task's fixed revision is an oracle input, never part of its agent prompt. New tests written by the agent are useful supplemental evidence; they cannot replace protected checks. Record any changed test or configuration surface explicitly.

Create disposable worktrees from the frozen base. Do not run against someone's active dirty checkout. For uncommitted work that matters, preserve an explicit local snapshot and its content digest before constructing a pilot base; never reset or stash another person's work just to obtain a clean trial.

## Bounded gate: a frozen local workflow

Prepare four new task cards: two behavior repairs, one bounded behavior-preserving simplification and one intentional negative control where the highlighted warning does not warrant a production change. Use symptom-only prompts describing observable behavior or a concrete change requirement. Do not supply detector names, symbol names, retrieval phrases or the expected solution. Keep the negative-control label and task-specific acceptance criteria with the evaluator. None of these cards or their phrases may have guided implementation or prompt tuning.

Compare A (existing workflow) with B (the same workflow plus the declared frozen local investigation build). Use two fresh repeats per task and arm: **16 assigned slots in a complete bounded study**. Randomize arm/task order within each repeat, pin model/settings and budgets, and use isolated worktrees, conversations and indexes. This defines the bounded evaluation; it is not a statistical power claim or authorization for further provider spend. Record the exact operations available in that build: the study conducted during 1.3 development used 1.2, whereas a future task-brief evaluation must freeze 1.3. Hold tool and harness revisions fixed during each gate; a task used to diagnose and tune a change becomes development data and needs replacement before a new evaluation.

Before running agents, the evaluator must establish these checks:

| Check | Independent acceptance condition |
|---|---|
| Repair oracle | The unchanged baseline passes and each controlled regression fails a protected behavioral check. Evaluate the submitted production patch with the same check in a disposable copy after the agent exits. Agent-written tests are supplemental. |
| Simplification oracle | Protected behavior checks remain green and a reviewer can explain how the named future change requires less scattered editing/revalidation. A lower branch count or fewer lines is insufficient. |
| Intentional negative controls | Include an intentional test-source reliability warning and a superficially similar production warning. Ranking retains both, preserves severity, identity and `baseScore`, and explains the test-source discount. Reviewers decide whether action is warranted from source behavior; a rank alone cannot decide. |
| Source-owner oracle | Label the necessary production owners and relevant boundary units before any run. Score units actually retrieved, record which primary owner was inspected before editing, and report ambiguous labels. Lexical owner navigation is not evidence of a call graph. |
| Retained-review oracle | A current counterevidence note affects priority without removing the candidate; an unchanged scan retains applicability. A captured source/file, direct-import membership, cited-fact or context/policy change makes it stale, and a revert does not revive it. Review text remains an untrusted local report. |
| Revision and retention oracle | Stale scan/review cursors are rejected. Failed scans preserve the previous committed state and annotation history. Search-policy rebuilds preserve reviews and require a successful scan before compatible reads. |

Run the annotation cases as controlled transitions on evaluator-owned copies: append a note, scan unchanged input, change one captured assumption, rescan, then revert and rescan. Check the expected state and ranking at each step. Include an unaffected candidate as a negative control for invalidation. Use a fresh index/review history for each independent agent run. If task-relevant note content is supplied, make the same content available to A as ordinary artifacts; record B's structured freshness state as part of the treatment. Do not give only B a solution-bearing annotation.

Record whether B actually uses local investigation tools and distinguish treatment assignment from observed use. Zero tool use is not evidence that retrieval was evaluated successfully, and adding forced tool calls after seeing outcomes changes the treatment and requires a fresh frozen study.

The gate report must pair **correct patch outcome with source-owner recall**. Count a repair as successful only when protected checks pass and an independent reviewer accepts its mechanism and scope. For the intentional no-change case, require a source-supported explanation and no harmful patch. Report necessary-unit recall by task and arm, targeting the proposed 90% recall threshold below, with the primary owner inspected before each accepted production change. Report all assigned runs, failures, unnecessary reads, total time/tokens and preparation cost; two repeats cannot establish a reliable efficiency advantage.

Proceed to the broader study only if the harness distinguishes correct repair, weakened validation and intentional no-change outcomes; every defined annotation/freshness control passes; and the source-owner/outcome gate is met without severe regressions. If results are ambiguous or B reduces task success, diagnose the failure and prepare fresh tasks before expanding. Passing this local A/B gate still does not complete the three-arm protocol.

## Stage 1: six-run harness smoke test (proposed broader protocol)

Choose two tasks: one lifecycle/behavior repair and one bounded simplification. Run each under all three arms:

| Arm | Agent tools and context |
|---|---|
| A — existing workflow | The repository's normal instructions, file reads, text search, compiler and test tools |
| B — local investigation | Everything in A, plus the pinned local index and eight read-only MCP investigate/status/search/context/impact/backlog/drift/reviews tools |
| C — reviewed mission | Everything in B, plus reviewed requirements/decomposition, frontier and service-side evidence applicability |

Use the same model, base tree, allowed source, time/token limits and validation oracle. Arm C receives reviewed requirements without access to checker credentials or owner approval. Core requirements must express the task equally well across arms; they must not reveal the answer to only one arm. The added treatment is structured reusable assurance state, not privileged solution information.

Randomize run order. Give each run a fresh worktree, conversation and cache namespace. Capture tool traces and resulting patches. Check that the harness can reproduce baseline behavior, distinguish a real fix from weakened tests, reject an outdated context, and attribute measured cost to the correct run. This is a smoke test, not enough evidence of product benefit.

## Stage 2: paired task bank

If Stage 1 is reproducible, prepare 12 reviewed tasks across three independent repositories, with four task families represented. Run three arms and two independent repeats: **72 agent runs**. This is a proposed bounded study, not an already authorized provider-spend commitment or a statistical power claim.

Keep at least one task from each family out of development. Once a task influences implementation or prompt changes, mark it as development data and replace it in the final evaluation set. Repeated runs of the same task are correlated; report task-level paired differences and uncertainty instead of treating all runs as independent samples.

Analyze retrieval-only versus full mission support separately. If B helps and C does not, improve local retrieval before expanding the assurance service. If C helps only repeated tasks, quantify the amortized cost of reviewing the initial requirements.

## Measurements and proposed acceptance gates

Record the denominator for every rate. Report failures and timeouts at the full assigned budget rather than dropping them from cost or speed summaries.

| Measure | Definition | Proposed gate |
|---|---|---|
| Complete task success | Protected checks pass and blinded reviewer accepts the patch's intended behavior/scope | No drop relative to A; any successful-arm claim includes paired uncertainty |
| Severe regression | Introduced data loss, invalid authority, lifecycle violation or bypass of protected validation | Zero in the reviewed pilot; any occurrence blocks expansion pending diagnosis |
| Investigation precision | Adjudicated actionable candidates / adjudicated candidates, by rule/category | At least 70% in a prespecified stratified sample before broad candidate surfacing |
| Relevant-source recall | Evaluator-labeled necessary source units actually retrieved / necessary units | At least 90% for the bounded task set; report ground-truth ambiguity |
| Efficiency | End-to-end elapsed time and model tokens for all assigned tasks, including index/review preparation | Seek at least 20% improvement with task success retained; show cold and amortized results separately |
| Freshness correctness | Injected assumption changes that produce the expected stale/recheck outcome | All defined freshness cases pass before using the layer as an assurance gate |
| Simplification quality | Named future change becomes smaller to understand/edit/revalidate, with behavior retained | Reviewer explains the reduced change surface; fewer lines alone is insufficient |
| Uncertainty handling | Coverage gaps, bounded impact and stale evidence are surfaced and acted upon | No unexplained promotion of missing/partial evidence into support |

These thresholds are proposed decisions for the pilot, not measured properties of the current implementation. A small pilot with ambiguous results should lead to narrower hypotheses or more tasks, not a claim of statistical equivalence.

## Drift and adversarial cases

Include at least these controlled cases:

1. Add a new writer/endpoint that belongs to an existing all-matching requirement but had no previous graph edge.
2. Replace a compiler dependency's contents without changing its path.
3. Change effective compiler options outside the component source root.
4. Change the local candidate-policy implementation with unchanged application source.
5. Edit/remove a source subject after an agent obtained context; verify cursor/plan freshness handling.
6. Remove a detector or suppress a finding; confirm disappearance does not close reviewed debt.
7. Submit a passing retry after current-generation counterevidence; confirm the failure remains.
8. Change a premise revision while a parent argument remains pinned to the old revision.
9. Exceed a source/graph budget; confirm incomplete inventory is not published as absence.
10. Put instruction-like text in source/memory; confirm it stays data and cannot approve requirements or evidence.
11. Change search normalization with unchanged source facts; require a compatible search rebuild without losing local review history.
12. Keep a local annotation current through an unchanged scan, invalidate it with a captured assumption change, and verify that reverting the source does not revive it.

The current index is an as-of-scan view. It does not watch the filesystem automatically. The harness must explicitly rescan between source mutations; tests should catch a workflow that forgets this step.

## Stage 3: repeated work and multiple agents

Only after the paired trial shows value, run a sequence of related changes within one reviewed mission. Measure evidence reuse, handoff fidelity, stale-plan recovery, lease contention, and the amount of human review amortized over subsequent work. Then introduce competing agents in separate worktrees with independently scoped credentials.

Do not equate a service-side head promotion or release receipt with an actual Git merge. The external integration must enforce the exact manifest and commit. Cross-repository contracts, federation and automatic distributed extraction remain separate product hypotheses.

## Immediate deliverables

1. An archived calibration manifest marking the four completed runs, task cards and search phrases as development data, with the limited repair/efficiency conclusions above.
2. Four reviewer-approved symptom-only task cards, frozen bases, protected behavior checks and source-owner labels for each pinned gate; use fresh cards for a future 1.3 task-brief evaluation.
3. A randomized 16-run A/B manifest with equal budgets, annotation inputs, pinned policy digests and isolated run artifacts; use the [executable harness](PILOT_HARNESS.md) with explicit isolation and protected-input checks.
4. Evaluator fixtures for intentional warnings and unchanged/stale/revert annotation transitions, with expected outcomes fixed before agent runs.
5. A blinded review sheet and paired report including correct patch outcomes, source-owner recall, failures and full preparation/run cost.

Before scheduling a study, freeze and independently review fresh task cards and their oracles, then run the deterministic annotation controls. Finish all assigned rows and independent outcome review before publishing a gate conclusion. Keep new detector proposals in the [gated detector backlog](DETECTOR_BACKLOG.md) until the current workflow demonstrates value. The [local reference](LOCAL_REFERENCE.md) defines the shipped retrieval, ranking and annotation contracts; this document defines how to evaluate their usefulness.
