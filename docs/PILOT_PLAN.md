# Investigation pilots: measuring agent outcomes

Status: proposed evaluation protocol. Pilot outcomes are not yet measured. Repository-specific task choices and private source reports stay outside the public repository.

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
- Model/version/settings, provider/harness version, allowed tools, time/token ceiling and run seed.

Keep solutions, hidden tests and reviewer notes outside agent-visible worktrees and searchable history. A historical task's fixed revision is an oracle input, never part of its agent prompt. New tests written by the agent are useful supplemental evidence; they cannot replace protected checks. Record any changed test or configuration surface explicitly.

Create disposable worktrees from the frozen base. Do not run against someone's active dirty checkout. For uncommitted work that matters, preserve an explicit local snapshot and its content digest before constructing a pilot base; never reset or stash another person's work just to obtain a clean trial.

## Stage 1: six-run harness smoke test

Choose two tasks: one lifecycle/behavior repair and one bounded simplification. Run each under all three arms:

| Arm | Agent tools and context |
|---|---|
| A — existing workflow | The repository's normal instructions, file reads, text search, compiler and test tools |
| B — local investigation | Everything in A, plus the pinned local index and read-only MCP search/context/impact/backlog/drift tools |
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

The current index is an as-of-scan view. It does not watch the filesystem automatically. The harness must explicitly rescan between source mutations; tests should catch a workflow that forgets this step.

## Stage 3: repeated work and multiple agents

Only after the paired trial shows value, run a sequence of related changes within one reviewed mission. Measure evidence reuse, handoff fidelity, stale-plan recovery, lease contention, and the amount of human review amortized over subsequent work. Then introduce competing agents in separate worktrees with independently scoped credentials.

Do not equate a service-side head promotion or release receipt with an actual Git merge. The external integration must enforce the exact manifest and commit. Cross-repository contracts, federation and automatic distributed extraction remain separate product hypotheses.

## Immediate deliverables

1. A private repository inventory with clean base choices and concrete target/test commands.
2. Two reviewer-approved task cards and protected oracles for the six-run smoke test.
3. A provider-neutral run manifest and artifact layout; no hidden state shared across arms.
4. A harness adapter that can launch an agent, capture tool traces/cost and return a candidate commit.
5. A blinded review sheet and a report that includes failed runs and the preparation cost.

The first next action is to freeze the clean calibration repository and review two task cards. Do not expand the detector catalog until the existing candidates demonstrate value in that loop.
