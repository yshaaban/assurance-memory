# Bounded investigation pilot harness

`scripts/pilot/harness.py` runs evaluator-owned task studies with Python's standard library. It accepts a provider executable and argument list; no provider SDK or shell command interpolation is required. The JSONL metrics adapter understands Codex completion usage and command events. Other providers retain their raw output, with unsupported usage reported as unknown.

Run its behavior checks with:

```sh
python3 -m unittest discover -s scripts/pilot -p 'test_*.py'
```

Keep task cards, source snapshots, hidden tests, solutions, private identifiers, owner labels and run artifacts outside the public repository. The harness ships no application task solutions. Creating a manifest or running `validate`/`freeze` makes no provider request. Run studies only within the user's authorized spend and scope.

## Manifest contract

A manifest uses `schemaVersion: 1` and these fields:

| Field | Meaning |
| --- | --- |
| `studyId`, `seed`, `repeats` | Study identity, deterministic integer random seed, and fresh repeats |
| `outputRoot` | Absolute evaluator artifact directory separate from every task base |
| `maxConcurrency` | One or two simultaneous agent processes |
| `provider.argv` | Executable plus separate arguments, with `{workspace}`, `{output}`, `{task}`, `{arm}`, `{seed}` placeholders |
| `provider.version`, `model`, `settings` | Recorded pinned provider/runtime settings; never include credentials |
| `budgets.timeoutSeconds` | Same wall ceiling for every arm, greater than zero and at most 720 seconds |
| `commonPrompt` | Identical experiment instructions for all arms |
| `arms` | Unique `id`, optional `promptSuffix` and evaluator-owned `prepare` argument lists |
| `tasks` | Unique `id`, `family`, absolute `base`, symptom-only `prompt`, `productionRoots`, `protectedPaths`, `owners`, `oracle`, and optional `prepare` lists |
| `protectedInputs` | Absolute files to hash at freeze time: oracle scripts/tests, task cards, tool builds and other evaluator policy |

Task family is `repair`, `simplification`, or `no-change`. Each owner has a relative `path` and a `rationale`; studies should also declare symbol/unit, primary or boundary role, necessity, valid alternative consumer paths, and ambiguity before agent runs. Equivalent consumer alternatives count as one necessary boundary group. Task oracles use an argument list under `oracle.argv`, optionally a timeout, and can reference `{evaluation}` for the trusted evaluation copy. Preparation hooks can reference `{artifacts}`; they run before the agent and their command, elapsed time and output are retained. Do not put solution-bearing setup output in the candidate workspace.

Source roots describe a bounded subsystem, without naming the expected repair file in the task prompt. `protectedPaths` adds glob exclusions to the built-in test/spec/fixture/config/AGENTS exclusions. Explicitly protect project-specific setup, configuration and executable harness files. New focused tests are archived as supplemental work; existing protected files cannot be replaced. Place all task-specific oracle policy outside the agent workspace.

A minimal provider stanza might be:

```json
{
  "argv": ["provider-cli", "--json", "--directory", "{workspace}", "--output", "{output}", "-"],
  "version": "PINNED_VERSION",
  "model": "PINNED_MODEL",
  "settings": {"reasoning": "PINNED_SETTING"}
}
```

The exact task prompt is sent to stdin. Supported placeholders are replaced in one pass; other braces, including literal or nested JSON arguments, remain unchanged. `{output}` resolves to `PILOT_FINAL_RESPONSE.md` in the candidate workspace. Agents may separately write their detailed report to `PILOT_RESULT.md`; the provider final response cannot overwrite that report. The artifacts are archived as `result.md` and `authored-report.md`, respectively. Child processes receive an explicit runtime/home/locale environment allowlist, including HOME and CODEX_HOME for saved CLI authentication discovery. Unrelated credential variables are excluded. The harness records no environment values and does not read account credentials. Provider configuration/authentication remains the responsibility of the installed CLI and evaluator.

## Freeze and execution

```sh
python3 scripts/pilot/harness.py validate /absolute/private/manifest.json
python3 scripts/pilot/harness.py freeze /absolute/private/manifest.json
python3 scripts/pilot/harness.py run /absolute/private/manifest.json
python3 scripts/pilot/harness.py summarize /absolute/private/manifest.json
```

`freeze` records manifest/harness/input hashes, complete source inventories excluding dependency/cache directories, owner labels and a seeded randomized schedule. Every task/arm pair appears once within each repeat. `run` verifies those frozen inputs before launch, after each completed run, and after every batch. An integrity failure records a rejected result and stops subsequent batches. It refuses to overwrite any existing run. `--run-id` selects an existing assigned row; it does not create a replacement run. After an interrupted orchestration, invoke each unstarted row explicitly and retain all partial/failed rows in the denominator.

Freeze dependency/runtime/build digests explicitly as protected inputs when they matter to interpretation. Dependency trees are copied for isolation but excluded from source inventories for cost reasons; the harness does not certify lockfile reproducibility or execute a fresh install. On macOS, copies use copy-on-write cloning. Other platforms use ordinary copies. Every candidate has a separate workspace and no inherited conversation; the provider invocation must request its supported ephemeral mode when needed.

Before freezing, prove the protected oracle passes the intact baseline and fails a controlled regression. For a simplification, also freeze the named future change and a reviewer acceptance rule; passing tests and fewer lines are insufficient. For an intentional no-change task, freeze the expected source-supported explanation and a harmful-change rejection case. Run the same oracles after each agent exits.

Each assigned run captures exact prompt, argument list, JSONL trace, stderr, observed command count, observed token usage, elapsed time, timeout status, preparation, changed-path inventory, candidate patch and changed production files. Timeout cleanup terminates the process group and escalates remaining group members to kill even if the leader has already exited. `chargedSeconds` assigns at least the full wall budget to provider failures/timeouts, harness/integrity failures, protected-check failures and rejected outcomes; raw elapsed time is retained separately. Integrity failures and failures before provider launch have explicit counters. Unstarted assignments remain pending in the denominator, rather than becoming zero-cost successes. Missing token usage stays `null`, not zero. Do not infer dollar cost without actual provider billing evidence.

## Independent evaluation and review

After the agent exits, the evaluator copies the trusted task base and overlays only permitted changed production files, including deletions. It rejects candidate symlinks, records changes outside scope, retains original tests/configuration and runs the evaluator-owned oracle. Candidate tests/configuration cannot replace those checks. Protected test success is separate from scope compliance and reviewer acceptance; `accepted` remains `null` until independent review.

Reviewers should record a blinded identifier, accepted mechanism/scope, severe regressions, source-supported no-change or simplification reasoning, and necessary-source recall with the evidence for each unit actually read. A filename in a search result is weaker than inspected source. Record whether a primary owner was inspected before editing, broad/unnecessary reads and ambiguous owner labels. Raw command traces support this audit but cannot automatically prove comprehension. Do not convert a lexical owner match into call-graph recall. Keep production-mechanism acceptance separate from protocol eligibility: append audited external-read deviations without rewriting blinded mechanism judgments or removing assigned runs/costs. Preserve the exact executed harness revision or byte copy when later harness fixes differ from the frozen study.

The write sandbox and separate directories do **not** provide hermetic read isolation. Task instructions forbid protected/original/sibling reads, and reviewers audit the recorded trace; this cannot prove the absence of covert reads. The candidate code itself executes during protected tests. Use stronger OS/container isolation if adversarial read containment is part of the study's threat model.

Report all assigned tasks, including launch/preparation failures, timeouts and unresolved reviews. Pair protected outcomes with owner recall; separate initial index/preparation cost from agent time and include both in any efficiency interpretation. Repeated runs of one task are correlated. A small bounded study may identify misses and justify fresh tasks; it cannot establish causal efficiency or broad product value.
