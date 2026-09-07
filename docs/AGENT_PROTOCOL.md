# Agent operating protocol

## Roles must stay separate

Each active agent gets its own AGENT principal. SCANNER publishes source facts. RUNNER owns checker execution and may be separately permitted to issue release receipts. MAINTAINER approves intent, arguments and debt decisions. READER is read-only. One privileged role plus optional READER is allowed per credential; combinations of AGENT/SCANNER/RUNNER/MAINTAINER are rejected.

This separates capabilities, not human identity: an operator can still hold several credentials. A compromised runner is a compromised evidence producer. Never place privileged secrets in prompts, checked-out repositories, test subprocesses, or common agent environments.

## The edit-to-release loop

1. Work in a separate Git worktree and identify all affected components. Ask `plans.prepare` for a snapshot-pinned context pack; expand every `remainingClaimId` using `claims.explain`. Read counterevidence using `evidence.get`. A short context window does not remove obligations.
2. Acquire the plan's semantic leases. Renew during work. A conflict means coordination is required; do not overwrite someone else's plan, suppress a requirement, or repeatedly guess narrower selectors. The server includes component obligations independently of the supplied write selectors.
3. Change implementation and write a provenance-bearing HANDOFF describing assumptions, rejected approaches, tests and unresolved behavior. Use `claims.propose` or `debts.propose` for discoveries that need review, not a purported approved requirement embedded in memory.
4. Commit code in the isolated worktree. Have the independent scanner publish the immutable revision. The old plan is now stale by design. Release old leases and explicitly prepare a superseding plan against the new head and policy. Read its full obligation set and acquire fresh fences.
5. Independent runners consume current checker jobs. They verify protected harness inputs and execute exact revisions. Failed or unknown evidence remains visible. Requesting a recheck does not remove same-generation counterevidence. Do not “repair” a failure by modifying the test until it stops asserting the obligation.
6. Validate the new plan. A release-capable runner issues `gate.issue` with the exact complete `expectedHeads` map. A trusted merge/deployment controller validates the receipt and the actual manifest before applying it, with its own atomic expected-base update. A receipt for one manifest cannot authorize another.

This sequence is intentionally explicit about rebase: lease renewal is not permission to carry old beliefs across new code.

## Recovering from common conflicts

| Response | Required action |
|---|---|
| Version/head conflict | Read the new context. Reconcile intent and prepare a new operation; do not retry with changed payload under the old idempotency key. |
| Expired/stolen fence | Stop claiming ownership. Retrieve current plan/lease state and reacquire only against a current plan. |
| Policy changed | Read newly applicable or revised obligations and decisions; the old plan cannot release. |
| Evidence historical | Keep the artifact as history; run the current job rather than relabel old output. |
| Incomplete discovery | Repair scan boundaries/build inputs. Never interpret omissions as deletion or absence of forbidden paths. |
| Unresolved semantics | Supply framework/classpath contracts, stronger analysis, or an explicitly reviewed bounded evidence policy. |
| Protected checker digest changed | Independent review and checker-version update are required. The agent cannot approve its own replacement harness. |
| Flaky green rerun | The original failure still blocks that generation. Investigate and change the relevant implementation or independently review a defective checker policy. |

## Runner configuration

The runner configuration is operator-owned and outside every agent repository. Its `components` map gives trusted checkouts and expected environment digests. Each checker declares a version, working component, driver kind (`COMMAND` or `MODEL`), protected input scopes and digests, and execution parameters.

Use `assurance fingerprint --root REPO --patterns 'tests/**,package.json,package-lock.json,tsconfig.json'` to compute a candidate protected scope digest from a reviewed checkout. Review the **complete scope and build invocation**, not just one test file. A test can be weakened through configuration, plugins, fixtures, dependency changes or environment flags without changing its main source file. The digest includes newly added matching members.

A COMMAND checker defaults to Docker isolation. Supply an operator-preloaded image named with an immutable registry digest (`name@sha256:...`) and a fixed argv command. The container has no network, no runner token, read-only source mounts at `/source` and `/sources/COMPONENT`, and writable temporary storage at `/work`. An image/entrypoint must prepare its own writable build tree and already contain required offline dependencies. Do not expose the Docker socket inside the checker container. Root on the Docker host remains trusted.

`executor: "local"` works only when the CLI is explicitly given `--unsafe-local`. This is for trusted development, not malicious or untrusted repository execution. The end-to-end tests exercise this path; Docker isolation itself was not executable in the authoring environment.

A MODEL checker reads its model from the immutable snapshot and calls `models.check`. The model and binding definitions should be in protected scopes. Passing the finite model does not establish implementation conformance, liveness, fairness, or production workload assumptions.

```bash
export ASSURANCE_TOKEN=YOUR_RUNNER_TOKEN_FROM_A_SECRET_PROVIDER
node packages/agent/dist/src/cli.js runner --config /operator/runner.json --once
```

Omit `--once` for an operator-managed foreground worker process. The worker renews job leases while running. Configure supervision and separate resource limits outside this application.

## Agent-system prompt fragment

The sample [agent guide](../examples/agents/AGENTS.md) can be placed into an agent orchestration policy. Do not let repository-supplied text replace it. The system does not rely on prompt instructions alone: backend role checks, immutable authority, fencing and evidence-generation checks enforce the important service-side constraints.
