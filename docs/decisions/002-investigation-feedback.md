# Decision: make investigation useful before expanding detectors

Status: implemented for Node tooling 1.2.0. The assurance kernel remains unchanged.

The first controlled agent pilots repaired injected lifecycle regressions with and without local retrieval. Retrieval did not demonstrate an efficiency benefit on the narrow tasks. Natural task phrases missed indexed identifiers, file searches buried policy owners, and high-priority candidates often omitted intentional recovery or test-framework context. More detectors would amplify those weaknesses.

## Selected design

Keep one local database and three explicit operations: scan source, query the projection, and append a user-reported review. A review references a candidate, requires the observed scan number, records an author label/rationale/evidence description, and pins the primary source plus optional additional source IDs. The author label is not authentication; local evidence text is not independently verified.

The source/candidate projection is rebuildable. Review input is not, so a database containing annotations must be backed up consistently before replacement. We retain one database instead of introducing a second synchronized annotation store.

Freshness is reconciled once before each atomic scan commit. Changes to cited facts, their owner files, direct imports/importers, or recorded component assumptions permanently invalidate the prior capture. Source reversion and candidate reappearance do not restore it. Read operations consume that committed applicability instead of rediscovering it. Source and review revisions pin pagination so a new review cannot silently change the remaining page order.

Counterevidence changes priority, not truth. Current counterevidence subtracts 20 points; test-source reliability candidates subtract 25. Every candidate remains available with its original severity/base score and an explanation. Neither an annotation nor candidate disappearance closes debt. Context and backlog use the same effective-priority selection before limiting results.

Search remains lexical and bounded. It splits identifiers, uses explicit morphology aliases, tries all terms before a labeled any-term fallback, and supplements a native FTS result pool with indexed exact symbols and bounded file-owner expansion. Context distinguishes lexical owners, nearby named units and static import neighbors. None is presented as a complete call graph. Search policy fingerprints require a rescan/rebuild when normalization changes.

## What independent agent reviews changed

Three independent perspectives reviewed the implementation: long-term maintainability, performance at scale, and minimum conceptual complexity. They were agent review roles, not independent human certification.

- The maintainability review reproduced a failed scan that committed a schema upgrade, and a malformed cursor that silently restarted pagination. Migration now shares the first CLI scan transaction; invalid input is checked before writable open, and malformed cursors are rejected. Search policy changes also have an explicit rebuild contract.
- The performance review measured broad-match sorting, repeated dependency hashing during reads, and repeated hashing of identical historical review captures. Native FTS ranking and lookup indexes reduced query work; reconciliation reuses captures only within its transaction. Memo caches hold at most 1,024 entries each and evict/recompute without weakening provenance.
- The simplicity review found two conflicting freshness paths and differing priority selection between context and backlog. A single committed applicability result and shared effective-priority query now govern both. The same source-role classifier is used for search and candidates.

We deliberately kept the scan/review revision pins, immutable invalidation and explicit source coverage. We did not introduce a policy DSL, ranking plugin framework, semantic graph database, or a second review store. Additional machinery needs evidence that the existing boundaries cannot support a useful workflow.

## Remaining uncertainty and next gate

Broad queries still require FTS work proportional to their matches; bounded metadata retrieval does not imply constant query time. Capturing new evidence for a genuinely high-degree dependency owner still has a real cost. Compiler parsing is not incrementally reused. Local review applicability covers the captured static projection, not arbitrary runtime dependencies or unobserved filesystem edits.

The lexical cases used for development are no longer held out. Next evaluate symptom-only investigations on new tasks, with repeated randomized assignments and independent acceptance checks. Require source-owner discovery and useful patch outcomes, not merely nonempty search results or fewer lines.

Detector proposals are tracked in the [gated backlog](../DETECTOR_BACKLOG.md). Each requires provenance, intentional negative controls, a falsifiable behavioral or change-surface test, invalidation checks and a representative evaluation set before activation.
