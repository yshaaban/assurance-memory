# Longitudinal investigation pilots

`scripts/pilot/longitudinal.py` tests whether a later maintenance change benefits from retained reasoning about an earlier change. It extends the bounded runner with separate source and knowledge lineages, explicit review gates and verified resumption. It uses Python's standard library and imports the existing [pilot harness](PILOT_HARNESS.md) for process execution, source overlays and provider trace metrics.

A mission is an ordered sequence of maintenance tasks in one frozen source snapshot. Every arm starts from the same source and common notes. Later cycles receive that arm's reviewed production result and accumulated handoffs. A new provider process handles each assigned stage; select the provider's ephemeral mode to avoid an unrecorded conversation carrying information between stages.

The intended comparison is ordinary repository tools plus plain notes against the same tools and notes plus a refreshed structured task brief. This evaluates the contribution of task context during repeated changes. It does not establish formal correctness, and automatically delivering a brief does not establish that an agent used it.

## Bounds and assignment

The runner requires exactly two arms, allows one to three ordered cycles per mission, and caps the whole manifest at **12 assigned stages**. Two missions with three cycles and two arms use that complete allowance. There are no repeats or replacement trials in this runner.

The seeded schedule randomizes mission/arm order within each cycle. At most two provider processes overlap. Cycle barriers avoid launching a descendant before its predecessor can be reviewed. Every provider stage has the same wall ceiling, greater than zero and at most 720 seconds. Preparation and optional finalization hooks have 180-second ceilings; protected oracles have separately declared ceilings up to 720 seconds. These are wall limits, not token or billing limits.

Every stage asks for an authored `PILOT_HANDOFF.md`. Its shared UTF-8 byte limit defaults to 32,768 and can be set to 1–65,536 through `budgets.handoffMaxBytes`. The runner checks size before reading the whole file, rejects malformed UTF-8, and fails the assigned stage if the handoff exceeds its limit. It never truncates counterevidence to fit. Missing or empty handoffs remain visible through `knowledgeWritten: false`; the review policy determines whether that omission is acceptable. A study can also request a shorter writing limit in its common prompt.

## Source and knowledge flow

For each stage, the runner performs the following sequence:

1. Verify the frozen manifest, both runner modules, common knowledge inputs, declared evaluator inputs and original source inventories.
2. Require a successful predecessor review, then clone that predecessor's sealed production snapshot into a fresh candidate workspace. The first cycle clones the mission base.
3. Copy declared retained state from that arm's preceding stage. Assemble common notes, previous handoffs and any common knowledge input newly introduced for this cycle.
4. Run evaluator-owned preparation hooks. They may prepare task context and declared retained state, but cannot change source or existing protected inputs.
5. Deliver the exact canonical notes and any additional prepared context in the provider's task prompt. Both arms receive the same handoff instructions and byte limit.
6. After the provider exits, capture the authored handoff, final response, detailed report, trace, usage, patch and inventories. Append the new handoff to the existing notes without editing earlier notes.
7. Build a trusted evaluation tree from the stage's approved input. Overlay only permitted production changes and keep the original tests and configuration. Save the resulting production snapshot before running the oracle.
8. Run protected checks and verify they did not modify production or existing trusted files. Capture those outcomes before optional finalization.
9. If configured and the provider exited normally, run the arm's finalization hooks. They may export updated portable state into declared retained paths, but cannot change source, tests, authored reports/handoffs, canonical input notes, delivered context or captured evidence. Copy retained state after finalization and seal the stage artifacts, source and knowledge. Wait for an independent review before advancing that lineage.

The review decision is written separately with exclusive file creation. A second or concurrent review cannot replace the first decision. The decision references the exact stage seal; a descendant also records the predecessor seal and review hashes. These checks expose accidental changes to completed outputs. They are not a cryptographic attestation by an external authority.

A source snapshot is never replaced by an evaluator-authored repair. A rejected stage blocks its descendants. A harness failure, integrity failure or explicitly abandoned stage also blocks its descendants. Other mission/arm lineages can continue. All assigned descendants remain in the denominator, even when no provider process can run them.

Canonical notes preserve UTF-8 text, including a byte-order mark and CRLF line endings. Original shared knowledge is identical between arms. Subsequent authored handoffs can differ because the arms have independent histories; the runner does not exchange handoffs or candidate solutions between them. Review information parity before launch, and assess this history dependence when interpreting later differences.

## Manifest

All example paths below are placeholders for evaluator-owned private files. No application source, hidden checker, expected owner or solution belongs in a public study manifest.

This miniature manifest assigns one mission, two cycles and two arms: four stages total. Add a third cycle and a second mission for the full twelve-stage design.

```json
{
  "schemaVersion": 1,
  "studyId": "ownership-study",
  "seed": 941,
  "outputRoot": "/path/to/private-study/results",
  "maxConcurrency": 2,
  "provider": {
    "argv": [
      "provider-cli", "--json", "--directory", "{workspace}",
      "--output", "{output}", "-"
    ],
    "version": "PINNED_VERSION",
    "model": "PINNED_MODEL",
    "settings": { "conversation": "fresh-per-stage" }
  },
  "budgets": {
    "timeoutSeconds": 720,
    "handoffMaxBytes": 32768
  },
  "commonPrompt": "Use the provided source and notes. Record uncertainty and counterexamples. Write the detailed mechanism report to PILOT_RESULT.md.",
  "protectedInputs": [
    "/path/to/private-study/check.py",
    "/path/to/private-study/prepare_context.py",
    "/path/to/private-study/export_reviews.py",
    "/path/to/private-study/tool-build.sha256"
  ],
  "arms": [
    { "id": "plain" },
    {
      "id": "structured",
      "retainedPaths": [".pilot-memory"],
      "prepare": [[
        "python3", "/path/to/private-study/prepare_context.py",
        "{workspace}", "{retained}", "{context}",
        "{mission}", "{cycleNumber}"
      ]],
      "finalize": [[
        "python3", "/path/to/private-study/export_reviews.py",
        "node", "{workspace}/.pilot-tools/packages/agent/dist/src/local-cli.js",
        "{workspace}"
      ]]
    }
  ],
  "missions": [{
    "id": "ownership",
    "base": "/path/to/private-study/base",
    "initialKnowledge": "/path/to/private-study/initial-notes.md",
    "productionRoots": ["src"],
    "protectedPaths": ["src/generated/**"],
    "owners": [{
      "path": "src/policy.ts",
      "rationale": "Predeclared policy owner; this label is evaluator-only."
    }],
    "cycles": [
      {
        "id": "1",
        "family": "simplification",
        "prompt": "Apply the frozen first maintenance task described in this card.",
        "oracle": {
          "argv": ["python3", "/path/to/private-study/check.py", "{evaluation}", "{cycleNumber}"],
          "timeoutSeconds": 120
        }
      },
      {
        "id": "2",
        "family": "no-change",
        "prompt": "Investigate the frozen follow-up report and justify whether a change is needed.",
        "knowledgeInputs": ["/path/to/private-study/second-cycle-observation.md"],
        "oracle": {
          "argv": ["python3", "/path/to/private-study/check.py", "{evaluation}", "{cycleNumber}"],
          "timeoutSeconds": 120
        }
      }
    ]
  }]
}
```

Each mission needs a frozen absolute base, common initial knowledge, production roots, predeclared owner labels and ordered cycles. Cycle families are `repair`, `simplification` and `no-change`. Optional cycle `knowledgeInputs` are common to both arms and automatically hashed at freeze time. Optional cycle `prepare` hooks run before the arm's hooks. Optional arm `finalize` hooks run in declared order after the provider outcome is captured. An arm may supply `promptSuffix`; use it only for the declared treatment and audit it for extra solution clues.

`retainedPaths` are bounded, distinct relative paths outside production roots. They use canonical POSIX spelling: aliases such as `./state`, `state/`, repeated separators, `state/./file` and backslashes are rejected. Overlap checks compare path components, including when a production root has a different equivalent spelling. Retained paths cannot overlap each other or use reserved report/context paths or the runner's ignored root directories. They are copied automatically into the same relative location before preparation and archived after any finalization. Every retained-state file is sealed, including files inside cache-like directory names. Symlinks are rejected. Retention does not approve the contents of a database or a prose claim.

Every relative component of a declared retained path, including its leaf, is checked for symlinks at freeze and before preparation, finalization, retained copying and overlay cleanup. A nested path cannot traverse an alias into external data. Checks cover both retained-copy source and destination descendants; a platform alias in the supplied workspace root, such as macOS `/var`, remains supported. The new evaluator-owned `retained-state` capture destination must be absent, so an unexpected hook-created link cannot redirect capture into another directory.

The base must not contain `PILOT_HANDOFF.md`, `PILOT_RESULT.md`, `PILOT_FINAL_RESPONSE.md`, `.pilot-context` or declared retained-state paths. These belong to the experiment, not to its source lineage.

| Placeholder | Value |
| --- | --- |
| `{workspace}` | Fresh candidate project directory |
| `{base}` | This stage's approved source input, readable only by evaluator hooks/checkers |
| `{evaluation}` | Protected evaluation directory, available to the oracle |
| `{artifacts}` | Private artifacts for the current stage |
| `{output}` | Candidate `PILOT_FINAL_RESPONSE.md` |
| `{mission}`, `{task}` | Mission identifier |
| `{cycle}` | Declared cycle identifier |
| `{cycleNumber}` | One-based cycle ordinal |
| `{arm}`, `{seed}` | Assigned arm identifier and deterministic stage seed |
| `{retained}` | Canonical accumulated note file inside `.pilot-context` |
| `{context}` | Existing empty file to populate with additional task context |

Argument expansion is one-pass and replaces only these placeholders. Literal JSON braces and unknown placeholders remain unchanged. Commands are executable/argument lists, never shell strings.

## Integrating task context

The public [`scripts/task-context.mjs`](../scripts/task-context.mjs) composes the existing scan and investigation commands. See the [default task workflow](TASK_WORKFLOW.md) for normal task-start use outside an evaluator study. After building the agent package, its standalone invocation is:

```sh
node scripts/task-context.mjs \
  --config /path/to/workspace-config.json \
  --db /path/to/local-index.sqlite \
  --task /path/to/task.txt \
  --notes /path/to/retained-notes.md \
  --output /path/to/new-task-packet.json
```

It refreshes the configured source, prepares the bounded investigation, includes observed scan changes when a prior snapshot exists in that index, preserves supplied notes and records preparation time. Notes remain unverified user text with freshness not established. The hook does not create review approvals or turn a scanner candidate into proof. Snapshot/review changes detected while assembling a packet cause failure instead of publication of a mixed packet.

Each local index is bound to its physical checkout root. Copying an index into the next cycle's fresh workspace and rescanning it is rejected by the existing root-binding policy. For a portable workflow, retain an exported review archive, scan a **new index for each new checkout**, and supply `--review-archive` to restore observations before investigation. The archive is fully validated before any index/output creation; this option requires a new destination DB and does not delete or rewrite an existing index. Restored observations remain stale or candidate-absent and retain their original captures. The packet reports an import summary and explicit `UNAVAILABLE_ACROSS_INDEX_ROOTS` source drift. It cannot infer cross-checkout changes from a review archive.

Task text is limited to 2,000 characters and 8,000 input bytes. Notes, when supplied, use a separate 65,536-byte complete-or-fail limit. The investigation defaults to five files and a 24,000-byte nested brief; optional limits are validated before scanning. Those limits do not describe the size of the entire JSON packet, which also contains notes, scan changes and profile data. Change rows expose pagination rather than silently claiming a complete list.

The output path must be new: exclusive creation prevents an earlier packet from masquerading as a successful new result. Failed preparation removes the incomplete output. Use an output location outside indexed production source so the packet itself does not become part of the scan.

For a longitudinal preparation wrapper:

- Put the copied tool build in `.pilot-tools`. Keep each new checkout's index in its disposable `.pilot-context` area. Use a declared retained path such as `.pilot-memory` for portable review archives, rather than copying an index into the next source root.
- Supply the actual current cycle task, using a task file under `.pilot-context` or an evaluator-owned frozen input.
- Write the task packet to a new `.pilot-context/task-packet.json`, then copy its content into `{context}`. Passing `{context}` directly as `--output` fails because the runner has already created that file.
- Omit `--notes` when canonical notes are already delivered by the runner, so the structured arm does not receive a second copy. The notes remain complete and visible alongside the additional brief.
- If an archive was retained, pass it as `--review-archive` while scanning the fresh per-checkout index. Configure an optional arm `finalize` command to export existing local review history into that retained area after the agent completes its work. Declaring a retained path alone does not create an archive.
- Freeze that preparation/export lifecycle before launch. Treat unavailable cross-root drift and restored-review staleness as observed limits; do not carry a copied database into a different checkout, rewrite root bindings or relax invalidation during a frozen study.

The runner copies declared state without assigning it portability semantics. Its optional finalization phase supplies the export boundary; the configured command still uses the existing `review-export` interface. When no applicable candidate exists, keep the handoff as unverified prose and report the gap instead of fabricating a review.

SQLite can update adjacent WAL/SHM files even when `review-export` opens the database read-only. A direct export against the candidate index therefore violates this runner's finalizer write boundary. Keep that boundary: export from a disposable copy of the **quiescent** index and its existing sidecars, inside the declared retained directory. All SQLite connections must be closed and no concurrent writer may operate during the copy. Provider exit alone does not establish this if it left background processes running. This is a closed-file transfer, not an online backup procedure.

Because `review-export` also refuses to overwrite an existing output, write the archive to a new temporary filename, clean up the copied index, verify the original database/sidecars remain unchanged, then replace the carried archive. The evaluator-owned `export_reviews.py` referenced by the miniature manifest could contain:

```python
from pathlib import Path
import hashlib
import shutil
import subprocess
import sys
import tempfile

node, cli, workspace = sys.argv[1:]
workspace = Path(workspace)
retained = workspace / '.pilot-memory'
retained.mkdir(exist_ok=True)
database = workspace / '.pilot-context' / 'index.sqlite'
if not database.is_file():
    raise FileNotFoundError(database)

def file_digest(path):
    checksum = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            checksum.update(chunk)
    return checksum.hexdigest()

def index_files():
    return {suffix: file_digest(Path(str(database) + suffix))
            if Path(str(database) + suffix).exists() else None
            for suffix in ('', '-wal', '-shm')}

# Precondition: all index connections are closed; no concurrent writers.
before = index_files()
output = None
try:
    with tempfile.TemporaryDirectory(prefix='review-export-', dir=retained) as directory:
        snapshot = Path(directory) / 'index.sqlite'
        output = retained / (Path(directory).name + '.json')  # New exclusive output.
        for suffix, checksum in before.items():
            if checksum is not None:
                shutil.copyfile(str(database) + suffix, str(snapshot) + suffix)
        subprocess.run([
            node, cli, 'review-export', '--db', str(snapshot), '--output', str(output),
        ], check=True)
    if index_files() != before:
        raise RuntimeError('Original index or sidecars changed during export')
    output.replace(retained / 'reviews.json')
finally:
    if output is not None:
        output.unlink(missing_ok=True)
```

This exports existing observations; it does not rescan the temporary database against another source root, invent a candidate, append a review or change any earlier capture. The temporary database is discarded; only the archive crosses to the next checkout. The next cycle's preparation imports `.pilot-memory/reviews.json` into its new index. The preceding stage retains its own immutable archive copy. A failed export leaves the carried archive untouched, records an integration failure and blocks dependent stages. Before/after hashes detect changes but do not make a concurrently copied database transactionally consistent; the quiescence requirement still applies.

Finalizers receive the same placeholder expansion and process environment as preparation hooks. Their command, stdout, stderr, elapsed time and observed write violations are retained separately. The runner compares complete workspace and captured-artifact inventories before and after finalization, allowing file changes only under declared retained paths and the runner's own hook logs. An unexpected hook-created `review.json` is moved into a non-authoritative quarantine artifact with its bytes preserved, whether it is a file, directory or symlink, so it cannot become a review decision or break failure reporting. Other detected evidence changes also fail the stage; they are not accepted as agent work.

Complete finalization inventories include dependency, installed-tool and cache files in both the candidate workspace and captured source that ordinary source inventories exclude. Hashing both trees before and after finalization has a real cost and runs only when `finalize` is configured. Symlink entries are compared by link text without following external targets, so ordinary `node_modules/.bin` links remain usable. These checks cannot observe writes through a link to an external target or provide filesystem containment. Keep finalizers evaluator-owned and frozen; carried retained state continues to reject symlinks entirely.

Preparation outputs are additional evidence to investigate. Check that the wrapper adds no evaluator conclusions, hidden checker results, expected repair paths or reviewer judgments. Record build/runtime digests as protected inputs. A digest text file is an attestation supplied by the evaluator; the runner does not recompute the external build from that file automatically.

## Freeze, run and review

```sh
python3 scripts/pilot/longitudinal.py validate /path/to/private-study/manifest.json
python3 scripts/pilot/longitudinal.py freeze /path/to/private-study/manifest.json
python3 scripts/pilot/longitudinal.py run /path/to/private-study/manifest.json
```

`validate`, `freeze`, `verify` and `summarize` make no provider request. `freeze` requires an empty output directory and exclusively creates the frozen record. It hashes both Python runner modules, the exact manifest, common note files, source inventories and all explicitly declared protected inputs. Include oracle scripts, additional test fixtures, preparation scripts, task cards, runtime/build manifests and relevant workflow guidance in `protectedInputs` before launch.

The first `run` starts eligible assignments and leaves later cycles waiting for reviews. Review each completed stage through a private JSON decision:

```json
{
  "accepted": true,
  "reviewer": "independent-reviewer",
  "rationale": "The protected outcomes, actual production mechanism and bounded scope satisfy the frozen acceptance rule.",
  "effortSeconds": 180,
  "outcomes": {
    "missedImpacts": 0,
    "staleReasoningErrors": 0,
    "futurePolicyEditOwners": 1,
    "repeatedInvestigationAvoided": null
  }
}
```

`outcomes` is an evaluator-defined object, not a computed correctness score. Freeze its meanings and acceptance rule before launch. Use `null` for an unmeasured result. `effortSeconds` is nonnegative or `null` when reviewer effort was not metered; unknown time is not zero.

```sh
python3 scripts/pilot/longitudinal.py review /path/to/private-study/manifest.json \
  --stage-id ownership--plain--1 --decision /path/to/private-study/review-plain-1.json
python3 scripts/pilot/longitudinal.py run /path/to/private-study/manifest.json
python3 scripts/pilot/longitudinal.py verify /path/to/private-study/manifest.json
python3 scripts/pilot/longitudinal.py summarize /path/to/private-study/manifest.json
```

A review cannot accept provider failure/timeout, protected-check failure, a harness/integrity failure or rejected source-scope changes. Protected-check success alone leaves `accepted: null`. Reviewers must assess actual ownership, missed impacts, intentional behavioral differences and the source support for retained claims. Use blinded packets where feasible and disclose when treatment-specific reasoning makes blinding incomplete.

`run --stage-id ID` selects one existing assignment. Running again reuses only sealed outputs whose integrity verifies; it does not rerun them. An existing stage without a seal is an incomplete assignment. After confirming its provider process has stopped, explicitly abandon it with a reason:

```sh
python3 scripts/pilot/longitudinal.py abandon /path/to/private-study/manifest.json \
  --stage-id ownership--plain--1 --reason "Execution was interrupted; preserve the assigned failure."
```

Abandonment preserves existing artifacts, seals the failure and blocks dependent stages. It does not terminate a process, repair a candidate, reset its source or create a replacement trial. A corrupted sealed stage is refused rather than silently reconstructed. Retain partial/failed assignments and investigate the orchestration error separately.

## Measures and interpretation

The output records all assignments and reports accepted, pending, incomplete and blocked counts separately. It retains provider failures, protected-check failures, harness/integrity failures, preparation times, provider elapsed time, finalization time, orchestration time, declared reviewer effort and missing usage. Raw provider traces and commands remain available for independent auditing.

`orchestrationSeconds` covers each started stage's cloning, preparation, provider, oracle, finalization, artifact capture and integrity verification. Provider, preparation and finalization time are components of that interval; do not add them again to orchestration time. `finalizationSeconds` includes the phase's full elapsed time; `finalizationHookSeconds` and `finalizationInventorySeconds` expose command execution and inventory checks within it. Summed concurrent-stage intervals are not the study's elapsed wall time. Initial task construction, oracle validation, manual review preparation and later rework need their own effort ledger. Unknown reviewer or provider usage remains explicitly unknown; a partial ledger cannot support a claim about total cost.

`finalizationFailures` identifies integration failures within `harnessFailures`; the counts are not disjoint. A failed export or forbidden finalizer edit preserves the captured provider exit/usage and protected-check outcome instead of turning it into a model failure or a missed source owner. The stage cannot be accepted, and dependent assignments remain blocked. A failed/timed-out provider skips configured finalization; `finalizationSkipped` records that case separately.

`chargedSeconds` is a conservative budget score. Rejected/failed stages and blocked descendants are charged at least the full provider wall ceiling, including stages with no provider launch. Actual observed time and `providerStages` remain separate. This keeps failure visible without claiming that an unlaunched stage incurred model usage or billing.

A useful pilot predeclares and records:

- Whether a concrete later policy change touches fewer independent owners, and whether the preserved behavior remains correct.
- Whether earlier rejected hypotheses or intentional differences prevent an unnecessary change, with inspected source supporting that judgment.
- Repeated investigations avoided, useful notes actually consulted, missed impacts and stale reasoning errors. A filename mention or delivered brief does not prove consultation or understanding.
- Agent, preparation, reviewer and rework effort, including unsuccessful assignments and context-generation cost.
- Whether each useful observation depended on structured retrieval/freshness, ordinary source tools or plain notes alone.

Demonstrate protected checks before freezing: the baseline should meet its declared contract, and a controlled harmful alternative should fail. Each new cycle needs its own predeclared oracle and acceptance rule. A simplification needs a concrete future change whose ownership can be evaluated; fewer lines or concepts alone are insufficient. An intentional no-change cycle needs both a source-supported explanation and a harmful-change rejection case.

Three dependent cycles in one mission are correlated observations. Twelve assigned stages are not twelve independent projects. Different predecessor implementations and notes can affect later effort, and a blocked lineage produces informative missing opportunities rather than a matched speed comparison. Report these trajectories and denominators without a broad causal or production-capacity claim. If ordinary tools and plain notes perform equally well, that is evidence to simplify the default integration.

## Isolation and reproducibility limits

The runner copies application source; it does not change original application worktrees. Trusted evaluation starts from approved source and restores original tests/configuration instead of accepting candidate replacements. Candidate production code still executes during protected checks.

Source inventories inherit the original harness's exclusions for Git, dependency trees, installed pilot tools and common runtime caches. Those directories may be copied, but source hashes do not certify their contents. Pin relevant runtime/dependency/build inventories separately. Declared retained state has no such exclusions: all its files are bound to the stage seal.

Separate workspaces, limited child environment variables, a provider write sandbox when configured, frozen hashes and command-trace review do not provide hermetic read isolation. Freeze the permitted installed workflow inputs equally for both arms, instruct agents about evaluator/original/sibling read boundaries, and report deviations independently from mechanism acceptance. Use stronger OS/container controls if containment itself is the claim under investigation.

## Provider-free behavior checks

```sh
python3 -m unittest discover -s scripts/pilot -p 'test_*.py'
```

The longitudinal tests run local fake-provider subprocesses. They check three-cycle source/note/state carry-forward, repeated archive replacement through finalization, ordinary dependency symlinks, forbidden finalizer edits, quarantined review artifacts, separate export/model failures, canonical retained paths, arm separation, seeded assignment, review gates, rejection cascades, resumable sealed outputs, explicit abandonment, protected-test tampering, oracle mutation, source-changing preparation, concurrent review decisions, hidden retained-state symlinks, retained-byte tampering and the shared UTF-8 handoff cap. The full suite also exercises the original runner's process-group timeout cleanup and failure accounting. These tests make no model-provider request and do not constitute results from a real application pilot.
