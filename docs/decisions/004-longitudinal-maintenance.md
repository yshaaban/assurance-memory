# Decision 004: evaluate retained reasoning through successive maintenance changes

Status: accepted for the bounded 1.4 investigation pilot. This decision records the strategy and gaps identified before provider execution; it contains no results from that study.

## Decision

Deliver the existing investigation brief automatically when a maintenance task starts, and evaluate whether retained reasoning makes a later change easier and safer. Compare ordinary coding tools with plain retained notes against the same capabilities plus current investigation context and explicit scan drift. Keep the assurance kernel as the only authority for approved claims, evidence and debt closure.

The earlier study observed no use of the optional local CLI in its tool-enabled arm. That observation does not explain the lack of use or establish the value of automatic delivery. Delivering context removes one discovery step and creates a testable product hypothesis: the agent can use relevant source, prior counterevidence and visible changes without first deciding to invoke a separate tool. Context delivery, reading, comprehension and useful contribution remain separate outcomes.

The target maintenance loop is:

1. Inspect current source and identify the contract and its owner.
2. Make a bounded change and run an independent check.
3. Retain the reason for the decision, rejected alternatives and unresolved assumptions.
4. Revisit that reasoning after an explicit policy change.
5. Preserve intentional differences when a proposed simplification would erase them.

This applies the foundation's interest in reusable decomposition to ordinary engineering work. Tests and source-supported explanations have the scope of their checks; they do not acquire the guarantees of a formal proof.

## Use the existing concepts and expose the missing capability

The task-start adapter composes the existing scan, investigation and drift interfaces. It produces a delivery artifact, with bounded output and explicit omissions. SQLite continues to own the source projection and local review history. The adapter does not add a graph, a competing review store or an approval service.

Mission preparation exposed a useful limitation: relevant maintenance reasoning can concern an owner for which the scanner has produced no local candidate. Local reviews currently attach to candidates. A candidate-free owner therefore cannot receive that reasoning through the existing candidate review interface, even when source search can find the owner.

Do not manufacture a candidate or activate a detector merely to obtain somewhere to store a note. Preserve the handoff as explicitly unverified text in both study arms, and deliver current scan drift in the treatment arm. A changed-source list helps the agent decide what to inspect; it does not determine whether a prose argument remains applicable. An unchanged list does not establish that the argument was correct or that its assumptions are complete.

| Item | Meaning and owner | Boundary |
| --- | --- | --- |
| Source fact or drift row | Scanner observation under captured source and analysis context | May guide investigation; semantic coverage and omissions remain explicit |
| Plain handoff | Retained observations, hypotheses and counterevidence | Unverified text; no automatic freshness or approval claim |
| Local candidate review | User-reported annotation with existing capture and invalidation semantics | Applicability is tied to its captured candidate/context; `CURRENT` does not establish correctness |
| Approved claim | Immutable requirement revision managed by the assurance kernel | Source observations and local reviews cannot create its authority |
| Checker result | Outcome of a specified check against specified inputs and assumptions | Supports only the tested obligation and coverage; it cannot silently substitute for the claim or its approval policy |

If longitudinal use shows that reasoning on candidate-free owners is valuable, investigate a narrow extension of local review subjects. Any extension must reuse the existing capture, dependency/context invalidation, history and restore rules. It must account for newly applicable dependencies and scope membership, preserve stale counterevidence after reversion, and define disappearance and archive behavior. A new subject kind is justified only by validated use and behavior tests; this decision does not introduce it. The service already has claims, debt and a mission frontier, so approved obligations continue through that existing path.

## Bounded comparison

Use two private project missions, with three ordered cycles per mission and two arms: at most twelve assigned stages. The sequence includes a real repair, an explicit future policy change and an investigation with an intentional no-change outcome. Freeze task contracts, owner groups, source inputs, relevant runtime/tool inputs, checks, review criteria and assignment order before launching providers. Keep project identities, paths, task cards, reference repairs and detailed traces private.

Both arms begin with the same ordinary tools and initial plain notes, and have the same opportunity to write and retain handoffs. Each arm carries its own accepted source history and its own accumulated notes into a fresh agent session for the next cycle. Later notes are not assumed to be identical: differences produced by earlier work are part of that arm's history. The treatment additionally receives current source investigation and scan drift at task start; this is additional information whose preparation cost must be measured.

The evaluator retains trusted checks and overlays only permitted production changes onto the trusted stage input. A known real defect may fail the new requirement check in the initial source; existing regression checks must still pass, a private reference change must pass the new contract, and harmful controls must be rejected. A failed or independently rejected stage blocks its descendants. Do not repair that source for the agent or select another attempt. Preserve every assignment, failed outcome and blocked descendant in the denominator.

Protected checks and independent mechanism/scope review serve different purposes. Reviewers should inspect the patch, explanation and concrete consumer behavior, including why a proposed consolidation is safe or unnecessary. Trace review records inspected owners and observed use of prior reasoning. A source filename in a search result does not prove that its contract was understood. Separate workspaces and trace audits do not establish hermetic read isolation.

## Measure maintenance value

Record preparation, provider execution, validation, reviewer effort and rework separately. Record missing or unmetered effort explicitly. Show failure penalties separately from observed elapsed cost, and avoid adding overlapping orchestration and provider time twice. Provider usage counters are not a billing statement.

The important outcomes are accepted behavior, missed impacts, stale-reasoning errors, repeated investigations avoided, retained counterevidence used, and the edit surface of the named future policy change. Count changed policy owners and duplicated new rules alongside any reduction in files or concepts. A small diff can still miss a consumer; an intentional no-change decision can be useful without reducing line count.

Automatic delivery succeeds only if the context contributes to correct work at an acceptable total cost. If ordinary tools and plain notes perform as well, simplify the default workflow in response to that evidence. Two missions can expose product gaps and motivate a larger study; they cannot establish general efficiency or production capacity. A mission without a relevant local review candidate also cannot establish the utility of source-bound review freshness.

## Detector and performance gates

Preparation in two private projects identified inconsistencies involving path admission or canonicalization. This is enough to investigate the existing [divergent-normalization hypothesis](../DETECTOR_BACKLOG.md#divergent-normalization-at-entry-points), with exact domain and trust-boundary evidence. It is not enough to enable a detector, infer an exploit, or assume all similar normalizers should share an implementation. Preserve intentional differences in identity, presentation, admission and trusted inputs as negative controls. Any detector proposal still needs independently reviewed examples, falsifiable checks, explicit coverage gaps and measured extraction cost.

Keep full scans as the correctness baseline. Investigate compiler reuse only when measured task-start waiting or memory pressure makes it relevant. Reuse must match complete fresh-scan results, including changed dependencies, previously unresolved imports, new scope members, compiler configuration and analyzer context. Measure validation cost, end-to-end latency and bounded retained memory before changing the default. Fast retrieval alone does not justify a compiler cache, and cached observations cannot refresh an invalidated review.

See the [preceding task-context decision](003-task-investigation.md), [pilot harness](../PILOT_HARNESS.md), [review archive contract](../REVIEW_ARCHIVES.md) and [scan diagnostics](../INVESTIGATION_SCALE.md) for the existing mechanisms and their limits. Aggregate study outcomes belong in a separate validation report.
