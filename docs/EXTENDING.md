# Extending detectors, languages and retrieval

An extension should make a useful investigation easier while preserving the distinction between a candidate and an established obligation. Keep policy and evidence authority in the assurance kernel. Follow [AGENTS.md](../AGENTS.md), use [concepts](CONCEPTS.md) for the semantics, and consult [the local reference](LOCAL_REFERENCE.md) for user-visible query contracts.

## Where changes belong

| Concern | Current owner |
|---|---|
| TS/JS syntax, types, signatures, tags, effects and source rules | [analyzer.ts](../packages/agent/src/analyzer.ts) |
| TS/JS and configuration rule manifests | [rules.ts](../packages/agent/src/rules.ts) |
| Discovery, configuration rules, component/environment pinning, adapter invocation | [scan.ts](../packages/agent/src/scan.ts) |
| Java parsing/attribution and Java rule manifest | [JavaAnalyzer.java](../services/core/src/main/java/dev/assurance/core/JavaAnalyzer.java) |
| Content fingerprints for compiler classpaths | [dependency-inputs.ts](../packages/agent/src/dependency-inputs.ts) |
| Candidate categories, base/source-role scores, ranking explanations, evidence prompts and local design heuristics | [investigation.ts](../packages/agent/src/investigation.ts) |
| Local persistence, schema migration, atomic ingestion, review-adjusted ranking and import traversal | [local-index.ts](../packages/agent/src/local-index.ts) |
| Search token normalization, bounded reranking and lexical symbol navigation | [local-search.ts](../packages/agent/src/local-search.ts) |
| Append-only local review captures, applicability and invalidation | [local-review.ts](../packages/agent/src/local-review.ts) |
| Task-brief composition and explicit candidate/byte coverage | [local-investigate.ts](../packages/agent/src/local-investigate.ts) |
| Canonical review archive format, bounds and integrity validation | [local-review-archive.ts](../packages/agent/src/local-review-archive.ts) |
| Explicit lifecycle contract, independent oracle and trusted adapter execution | [lifecycle-lab.ts](../packages/agent/src/lifecycle-lab.ts) |
| Frozen evaluator inputs, randomized assignments and protected candidate evaluation | [pilot harness](../scripts/pilot/harness.py) |
| Shared local query validation, snapshots and pagination | [local-query.ts](../packages/agent/src/local-query.ts) |
| CLI options and stdio MCP transport/tool schemas | [local-cli.ts](../packages/agent/src/local-cli.ts), [mcp.ts](../packages/agent/src/mcp.ts) |
| Approved claim/evidence applicability and argument semantics | [Claims.java](../services/core/src/main/java/dev/assurance/core/Claims.java) |
| Reviewed work-frontier discovery | [Frontier.java](../services/core/src/main/java/dev/assurance/core/Frontier.java) |

A new static rule usually belongs in its language adapter. A rule over existing compact facts can belong in `investigation.ts`. A query should share behavior through `local-query.ts` before being exposed through both CLI and MCP. Do not copy policy into a local detector, embed repository-specific shell execution in discovery, or build a second approval service around a search result.

## Candidate classification and scoring

`opportunities(result)` starts with the adapter's findings and adds two local heuristics. Both apply only to `kind: FUNCTION` facts without a `tests` tag:

| Rule | Trigger | Severity |
|---|---|---|
| `DESIGN_BRANCH_CONCENTRATION` | `metrics.guards >= 10` | `MEDIUM` |
| `DESIGN_MIXED_OWNERSHIP` | At least three recognized effects from `WRITE_DB_CANDIDATE`, `PUBLISH`, `SPAWN_OR_SUBSCRIBE`, `RETRY`, `ACQUIRE` | `MEDIUM` |

Adapters emit deduplicated effect summaries, so the second rule normally counts different effect labels, not three call sites. TS/JS function guards currently count `if` statements and conditional expressions; they are not cyclomatic complexity. Java uses `kind: METHOD`, so these two postprocessing heuristics do not currently run on Java methods. Extending them to Java requires an explicit decision about metrics and effect comparability.

Category assignment is a first-match rule-name regular expression, not a learned classifier:

| Match in `ruleId`, evaluated in order | Category |
|---|---|
| `DESIGN_`, `DUPLICATE`, `LARGE_FUNCTION`, `LARGE_METHOD` or `IMPORT_CYCLE` | `SIMPLIFICATION` |
| `LAYER_`, `CONTEXT` or `ABORT_NOT_FORWARDED` | `INCONSISTENCY` |
| `TYPE_`, `ANY_`, `TEST_` or `DYNAMIC` | `COVERAGE` |
| Otherwise | `RELIABILITY` |

The rule name therefore affects product behavior. `JAVA_LARGE_METHOD` and `TS_LARGE_FUNCTION` are simplification candidates. `SPRING_FIELD_INJECTION` and `JAVA_REFLECTION_UNKNOWN` currently fall through to reliability even though their mechanisms also concern design or coverage. A new name containing `TEST_` will be classified as coverage unless an earlier expression matches. Inspect the category deliberately when adding a rule; do not rely on its prose message.

Priority is:

```text
baseScore = severityBase + boundaryBonus
score = baseScore - testReliabilityDiscount - currentCounterevidenceDiscount
severityBase: HIGH = 80; MEDIUM = 50; LOW = 20
boundaryBonus: +10 for the "boundaries" tag; otherwise 0
testReliabilityDiscount: 25 only when sourceRole is TEST and category is RELIABILITY
currentCounterevidenceDiscount: 20 only for the latest CURRENT COUNTEREVIDENCE review
```

Backlog order is descending effective score then ascending candidate ID. Original severity and `baseScore` remain unchanged; discounts are additive and can produce negative scores. These are triage weights, not confidence, exploitability, incident probability or money. `rankingReasons` explains each contribution. A boundary tag is an extractor heuristic, not evidence of a public production API.

`sourceRole` is inferred as `TEST` from a `tests` tag or a conventional test directory/TS-JS filename; otherwise `CONFIG` language becomes `CONFIGURATION`, and remaining code defaults to `PRODUCTION`. Configuration fixtures under test paths therefore have role `TEST`. Role classification does not establish that a warning is intentional. Test warnings and locally reviewed candidates remain visible; other source/category priorities are preserved.

The latest local review affects ranking only while its captured source/context is current. `INVESTIGATE`, stale, absent or missing reviews produce no review discount. Review history does not stack discounts or suppress a rule. Branch concentration explicitly warns that count alone cannot justify refactoring: establish a concrete change scenario and scattered or duplicated policy first.

Every candidate contains its source subject, path/line, rule ID, message, severity, category, `baseScore`, effective `score`, `sourceRole`, `rankingReasons`, `confidence: STATIC_CANDIDATE`, `nextStep` and `evidenceNeeded`. Simplification prompts ask for a likely future change, ownership/caller inspection, behavior checks and a before/after change-surface comparison. Other categories ask for an explicit contract and a check that can fail for the suspected mechanism. A finding with no matching fact fails ingestion.

Identity is `sha256(subjectId + ':' + ruleId)`. Multiple sites of one rule on the same subject collapse to one record; this is not a per-occurrence diagnostic inventory. Adapter deduplication retains the first finding for that pair. The local projection records first/last-seen scans and disappearance. Disappearance can result from a code change, rule change, subject identity movement or loss of semantic detection. It is not evidence of repayment or even necessarily a fix.

## Retrieval and local review extensions

Search normalization and ranking are lexical presentation policy. The implementation splits identifier boundaries and uses a small explicit alias map; it tries all terms before a reported any-term fallback. Preserve the 500-character/20-normalized-term query bounds, 200–1,000-row lexical pool, indexed exact-symbol lookup (`limit + 1` rows), owner expansion (at most five files with `limit + 1` rows each), exhaustion flags and exact-match explanations. The combined reranking input may exceed the lexical pool; do not present that pool as the total metadata bound. Do not silently drop terms, relabel a broader match as exact, or turn `owners`/`localSymbols` locator navigation into call-graph assertions. Context compacts metadata, so preserve its explicit limitation count/truncation flag and the full `status` path.

Local schema 3 retains append-only review records and permanent invalidations, and adds archive provenance plus explicit local-submission precedence. Restored notes must remain stale or absent and cannot supersede destination submissions. Source facts are rebuildable, but the database may be the only copy of local annotations; preserve it with SQLite-consistent backup tooling before replacement. Do not treat an annotated database as disposable cache. Read-only access must reject older schemas. CLI scan validates configuration before writable open and commits pending schema migration/search rebuild with its first successful scan; errors or close before commit roll them back. A CLI annotation append requires a compatible index and the expected current scan. Read paths share scan/review revision pins through `local-query.ts`; backlog cursors also pin category, and review-history cursors pin candidate ID. Both reject stale continuations. Local MCP has eight read-only tools with no annotation write, archive or migration tool. A task brief composes bounded existing queries inside their common read transaction; it owns no additional persistence or freshness state.

Preserve explicit task-term reduction, grouped-hit limits, candidate coverage for at most three source subjects per entry and whole-entry omission under the compact JSON budget. Every derived truncation must reach the enclosing brief. Archive imports use one complete transaction, preserve original provenance and deduplicate unchanged originating records; checksums cannot authenticate an author or grant applicability. See the [archive contract](REVIEW_ARCHIVES.md) and [1.3 design decision](decisions/003-task-investigation.md).

The stored `searchPolicyDigest` hashes compiled `local-search.js` separately from candidate policy. A mismatch rejects read-only opens until scan rebuilds FTS from indexed facts, including unchanged rows. Preserve that check when changing normalization or aliases. Queries must not extract source or rebuild search metadata. Search-only rebuilds do not advance source/review revisions or invalidate review captures; ordinary scan publication still advances the snapshot and reconciles applicability. Test changed policy against unchanged facts, failed upgrade rollback, and retained review history. Rebuild and restart processes after compiled policy changes because the digest is computed on module load.

Review captures bind candidate/source facts, containing files, the complete stored direct-import/importer membership, optional cited facts and component context. Reconcile within the scan transaction before commit. A no-op scan keeps a capture current, whereas source, membership, cited-fact, context or candidate-policy changes invalidate it permanently. A revert cannot revive that capture. Test failed scans, new dependencies, stale cursors, review supersession and delete/reappear sequences; untrusted local text never becomes kernel evidence or a global false-positive suppression.

The [gated detector backlog](DETECTOR_BACKLOG.md) describes proposed duplicate-owner, retry/concurrency, lifecycle and normalization investigations. Each entry names required facts, intentional negative controls, validation and graduation criteria. The [lifecycle lab](LIFECYCLE_LAB.md) advances one proposal with explicit synthetic contracts, not a production scanner rule. Preserve current structural warnings, including caught/detached work, until the relevant analyzer or applicable review provides stronger evidence; `.catch` syntax alone does not prove complete failure/lifecycle ownership.

## Current rule families

The following table describes candidates, not proven defects. It is a navigation guide to the source; framework and caller context can change the conclusion.

| Rule(s) | What the implementation looks for | Validation question |
|---|---|---|
| `TS_FLOATING_PROMISE` | Promise-like result discarded as an expression statement | Who observes failure and owns completion/cancellation? |
| `TS_DETACHED_ASYNC` | Unjoined async `forEach`, discarded async `map`, or explicit `void` detachment | Is detached work deliberate, bounded and joined/cleaned up by an owner? |
| `TS_UNBOUNDED_FANOUT` | `Promise.all` over a `map` call | Is input size or admission actually bounded elsewhere? |
| `TS_TIMER_CLEANUP`, `TS_LISTENER_CLEANUP`, `TS_SUBSCRIPTION_CLEANUP` | Allocation/registration without selected cleanup names in the same file | Does another lifecycle owner perform cleanup on every relevant path? |
| `TS_EMPTY_CATCH` | Empty catch block in a function | Is suppression intentional, observable and safe under the failure contract? |
| `TS_ANY_BOUNDARY` | `any` in a recognized boundary's parameters/return | What constrains values at runtime and downstream? |
| `TS_TYPE_SUPPRESSION` | `@ts-ignore` or `@ts-nocheck` marker | What uncertainty was introduced, and what check replaces it? |
| `TS_DYNAMIC_CODE` | `eval` or `new Function` | Which behavior is outside the static model? |
| `TS_ABORT_NOT_FORWARDED` | Function accepts a signal but `fetch` lacks an obvious option/spread forwarding it | Does cancellation reach the actual operation through a wrapper? |
| `TS_SYNC_IO` | Selected synchronous I/O, process or crypto call names outside tests | Is this execution context allowed to block within its budget? |
| `TS_UNVALIDATED_DESERIALIZATION` | `JSON.parse` at a recognized public boundary | Is schema validation performed before values are trusted? |
| `TS_LAYER_VIOLATION` | Resolved component-local import violates configured first-matching layers | Is the dependency forbidden, or is layer configuration wrong? |
| `TS_IMPORT_CYCLE` | Strongly connected static import group, including self-import | Does initialization/order or shared ownership create a concrete liability? |
| `TS_TEST_DISABLED`, `TS_TEST_EXCLUSIVE` | Selected test `.skip`, `.todo` or `.only` calls | Which requirement scenarios are excluded from evidence? |
| `TS_LARGE_FUNCTION` | Function spans more than 100 source lines | Which likely change has too many coupled reasons or responsibilities? |
| `TS_DUPLICATE_IMPLEMENTATION` | Equal comment-free printer output for bodies of functions at least 10 lines long | Must these copies evolve together, and would sharing improve ownership? |
| `TS_NESTED_RETRY` | Syntactically nested `retry`/`retryWhen` calls within the visited function | Do attempt limits multiply across actual runtime layers? |
| `SPRING_SELF_INVOCATION`, `SPRING_ASYNC_SELF_INVOCATION` | Same-class calls to annotated methods | Which interception mode is deployed, and is the expected advice applied? |
| `SPRING_PRIVATE_TRANSACTION` | Private method with a transaction annotation | Can the configured proxy/weaving mode intercept this boundary? |
| `SPRING_FIELD_INJECTION` | `Autowired` field | Would explicit construction make a relevant dependency/ownership change easier? |
| `SPRING_REACTIVE_BLOCK` | Blocking call pattern in a recognized reactive context | What scheduler/thread and admission budget execute this path? |
| `JAVA_EMPTY_CATCH`, `JAVA_INTERRUPTION_SWALLOWED` | Empty catch or interruption catch without obvious rethrow/restoration | Is failure or cooperative stopping lost on the relevant exceptional path? |
| `JAVA_UNBOUNDED_EXECUTOR` | Selected executor factories | What bounds threads, queue growth, admission and shutdown time? |
| `JAVA_EXECUTOR_CLEANUP`, `JAVA_THREADLOCAL_CLEANUP` | Selected resource creation/storage without same-file cleanup names | Is cleanup owned externally, including exceptional/terminal paths? |
| `JAVA_CANCEL_IS_NOT_STOP` | Cancellation call pattern | Does underlying execution and its side effects actually stop? |
| `JAVA_REFLECTION_UNKNOWN` | Selected reflective behavior | What runtime binding or framework model is needed? |
| `JAVA_TEST_DISABLED` | Disabled/ignored test annotations | Which scenarios were removed from the executed suite? |
| `JAVA_MANUAL_RESOURCE` | Selected resource construction without obvious try-with-resources ownership | Is ownership transferred, or can exceptional cleanup be missed? |
| `JAVA_LARGE_METHOD` | Method spans more than 100 source lines | Is a likely future change spread across unrelated responsibilities? |
| `JAVA_SQL_CONCATENATION` | String concatenation passed to selected SQL call names | Are values trusted or independently parameter-bound? |
| `CONFIG_TEST_SKIP` | Selected Maven/test skip settings set to true | Does the actual CI profile still execute the required checks? |
| `CONFIG_FLOATING_DEPENDENCY` | Selected unpinned dependency values in `package.json` | Is a reviewed resolved lock/context available? |
| `CONFIG_FLOATING_IMAGE` | Selected Docker/YAML image references using `latest` | Is the deployed image content pinned elsewhere? |
| `CONFIG_DESTRUCTIVE_MIGRATION` | `DROP TABLE`/`DROP COLUMN` marker in SQL | What makes rollout, rollback and mixed versions safe? |
| `CONFIG_UNBOUNDED_QUEUE` | Selected queue values such as -1, 0 or `unbounded` | What does that value mean in this framework? |
| `CONFIG_PRIVATE_KEY` | Private-key header marker | Is credential material exposed and does it need rotation/removal? The key value is not copied into the finding. |

Service publication also creates `DELTA_API_SIGNATURE`, `DELTA_EFFECTS`, `DELTA_TEST_ASSERTIONS`, `DELTA_GUARD_REMOVAL` and `DELTA_MIGRATION_MUTATED` candidates for selected observed changes. These are implemented in [Scans.java](../services/core/src/main/java/dev/assurance/core/Scans.java); they are not automatically copied into the local backlog. The local `drift` query instead exposes before/after fact/context differences.

## Extraction and coverage limits

Coverage has two independent axes:

| Field | Meaning |
|---|---|
| `discovery: COMPLETE` | No detected omission/error within the declared recognized inventory and scan policy |
| `discovery: PARTIAL` | Detected omissions, syntax failures or other discovery gaps |
| `semantic: RESOLVED` | The adapter did not encounter the unresolved conditions it reports for its modeled analysis |
| `semantic: PARTIAL` | Type/configuration diagnostics, missing attribution, dynamic behavior or summary bounds leave reported uncertainty |

`COMPLETE` is not all-language coverage. Unsupported files are outside discovery, and explicit exclusions intentionally narrow its universe. `RESOLVED` is not a whole-program proof, exhaustive effect set or guarantee that every detector was sound. The limitations list remains meaningful even with both fields favorable.

Local publication rejects partial discovery and rolls back the entire workspace scan. The service can retain omitted facts during a partial component publication, but cannot use those omissions as deletion/absence evidence. Semantic partiality may be stored in the local index; read it before interpreting candidate absence or import impact.

### TypeScript and JavaScript

The analyzer uses the TypeScript compiler API with `noEmit`, a concrete component inventory and effective compiler options. It resolves signatures and some Promise-like results, but many effect labels and lifecycle rules match call/property names. A method called `save` is only a database-write candidate; a real write behind a differently named wrapper can be missed. Same-file cleanup heuristics do not establish path-sensitive pairing or external ownership.

The import graph records resolved `ImportDeclaration` targets in the same extracted component. It includes type-only imports without distinguishing runtime modality. It does not project `export … from`, `require`, dynamic `import()`, cross-component links or calls. Files loaded only as compiler dependencies affect the input digest but are not navigation nodes. A `truncated: false` impact result can still omit those relationships.

Function/file effect summaries cap at 120 entries; TS truncation marks semantic coverage partial. File-level import edges come from that bounded effect summary. Type errors, unreadable/configuration diagnostics, solution references, unresolved imports, dynamic calls, suppressed checking and `any` boundaries can also mark semantics partial. Syntax errors mark discovery partial. A clean compiler pass does not prove interprocedural lifecycle, cancellation, transaction or scheduling behavior.

The scanner supplies discovered root files, so a tsconfig's `include`/`exclude` inventory is not authoritative for scanning. Solution projects must be split into concrete target components. Dependency and compiler option changes are fingerprinted, including resolved external source/type inputs, but scanning a mutable working tree is not filesystem snapshot isolation. Use immutable checkouts for authoritative publication.

Named identities are derived from locators; anonymous callbacks and repeated names in separate scopes use source positions when necessary to avoid collisions. Movement may then create additions/removals and conservative invalidation. Duplicate-body detection compares normalized printed bodies, not semantic equivalence or renamed-variable clones; comments are removed, identifiers are retained.

### Java

The supplied adapter uses the JDK 21 tree/compiler API with annotation processing disabled. Remote Java analysis parses source without caller-controlled server classpaths and explicitly reports partial semantics. Local analysis requires a complete bounded source batch plus actual compiler inputs. Compiler errors or detected reflective/dynamic uncertainty can leave attribution partial.

Each Java request is limited to 2,000 source files and 5,000,000 source bytes. Local attributed scanning cannot split one module into arbitrary remote parser batches and still claim equivalent attribution. Its subprocess has a 120-second timeout and 32,000,000-byte stdout bound. Compiler-input hashing is bounded to 100,000 files / 512,000,000 bytes; input content is checked before and after extraction. Supply resolved classpath roots; internal classpath symlinks and unsupported filesystem entries fail.

Classpath contents, adapter classes and the Java runtime are fingerprinted. This does not execute a Spring application context, establish transaction proxy/weaving behavior, resolve every dynamic dispatch path, validate Hibernate queries, model Reactor scheduling or verify native-image behavior. Java file facts currently contain no projected `IMPORT:` edges, and Java methods are not processed by the two local `FUNCTION` design rules.

### Configuration and unsupported languages

Recognized configuration is fingerprinted and checked with selected patterns. Files can be malformed yet still produce content facts; a build/parser checker must establish configuration validity. Markdown is retained as an intent-source fingerprint, not interpreted as approved policy. Environment values supplied by an operator are digests, not secret storage.

There is no full API-schema compatibility engine, historical migration replay, CVE feed, SBOM validation, dependency-confusion analysis or effective deployment resolver. Python, Go, Rust and other languages do not currently have semantic adapters. A workspace dominated by unrecognized language files can therefore produce few or no facts with complete discovery of its declared supported inventory. Do not interpret that as a clean repository.

## Adding or changing a detector

1. **State the mechanism and decision it helps.** Describe a likely defect or future-change cost, its assumptions, an intentional example that should not cause action, and a falsifiable validation step. Avoid a generic “complexity is bad” rule.
2. **Choose the smallest owner.** Extract language meaning in the adapter. Derive language-independent investigation presentation from compact facts only when those facts support the interpretation. Keep new rule output as candidates.
3. **Define stable identity and coverage.** Preserve subject identities where possible. Decide how multiple sites collapse. Make unresolved behavior and output budgets explicit; never silently truncate an inventory or convert unsupported analysis into absence evidence.
4. **Version its applicability.** Add source rules to the executed manifest and update analyzer/checker versions when semantics change. The scanner hashes its implementation inputs. The local index additionally records `candidatePolicyDigest`, a digest of compiled `investigation.js`; a changed postprocessing policy produces `CONTEXT_CHANGED` on the next scan. Rebuild and restart scanner processes after code changes because that digest is computed when the module loads.
5. **Check presentation.** Confirm category, source role, original/effective score, ranking explanations, source location, evidence prompt and confidence. Preserve candidate identity and visibility when adjusting rank. New categories require coordinated type, query validation, CLI documentation and MCP schema changes. Queries must remain shared between CLI and MCP.
6. **Exercise dangerous boundaries.** Test a true mechanism, an intentional boundary/false-positive case, relevant edits, deletion/new membership, missing inputs, stale reads/cursors and rule removal where applicable. Assert observable results and retained uncertainty, not SQL statement spelling.
7. **Measure usefulness.** Label a representative sample with maintainers; report useful precision by rule, false-confidence cases and missed seeded mechanisms. Compare the cost of finding and validating work with the tool to the existing workflow.

The service's executed-rule manifest prevents removing a rule from being reported as a fix: an omitted old finding becomes `UNKNOWN` unless complete applicable execution supports `NOT_OBSERVED`. Local disappearance is simpler bookkeeping and does not carry that same finding-state policy. `candidatePolicyDigest` makes postprocessor changes visible; it does not transform disappeared local candidates into approved resolution evidence.

## Adding a language adapter

Do not begin by promising another language is “supported.” Define the bounded build targets and semantic questions the adapter can answer. The current interfaces are compact enough for an incremental adapter, but not sufficient to justify arbitrary-language assurance by themselves.

The adapter contract returns `AnalysisResult`: facts, findings, discovery/semantic coverage with limitations, a deterministic executed-rule manifest and analyzer identity. Every fact needs `id`, locator, safe component-relative path, language, kind, content/signature hashes, sorted tags/effects, numeric metrics and line. Every finding must name an emitted fact and executed rule. See [types.ts](../packages/agent/src/types.ts), [schemas](../schemas/README.md) and service validation in `Scans.java`.

| Extension surface | Required design decision |
|---|---|
| File discovery | Recognized extensions/manifests, generated/excluded inputs, symlink policy, byte/file budgets and deletion safety |
| Build context | Actual compiler/interpreter inputs, module options, generated types and external dependency contents; avoid executing repository-owned build commands during discovery |
| Identity | Stable locator rules for overloads, nested scopes, anonymous constructs, moves and renames; collisions must fail visibly |
| Source summaries | Which tags/effects are heuristic versus resolved, and what each metric measures in this language |
| Navigation | Direction, target identity, modality and completeness of new edges; an import edge must not become a behavioral impact assertion |
| Runtime boundary | Framework hooks, dynamic dispatch, macros/code generation, reflection, FFI and deployment assumptions outside extraction |
| Transport | Bounded process/API requests, cancellation/timeouts, output limits and metadata handling |
| Compatibility | TypeScript `Fact.language` union, schemas, adapter dispatch, rule manifests, fingerprints and version migration |
| Validation | Real project targets, unresolved/negative cases, stable identity, new membership, dependency overwrite and rollback under partial analysis |

The local projection currently derives edges only from `IMPORT:` summaries targeting `path#file` within the same component. A richer language adapter may need a typed edge model. Introduce it with explicit schema/versioning and query semantics; do not encode incompatible relationships into `IMPORT:` just to reuse the existing graph traversal.

For a new independently executed checker, use the existing operator-controlled runner workflow. Declare checker identity/version, exact workload/model assumptions, artifact content digest, completeness and limitations. A result-producing utility such as `models.check` does not itself submit authoritative evidence; the authorized job/evidence path controls applicability.

## Validation and scale acceptance

Use Node 24.16+ and JDK 21. The repository's required core check is:

```sh
npm test
```

The focused local suite is:

```sh
npm run test:local
```

Run the focused suite during local iteration and `npm test` after changes to shared extraction, MCP or core behavior. For storage/service changes, also run the real PostgreSQL profile and Spring restart smoke workflow documented in [the README](../README.md) and [verification](VERIFICATION.md). Do not add tests for cosmetic documentation changes or tests that merely repeat the implementation; use them to cover invalidation, deletion, false confidence and consistency risks.

Keep parser and projection measurements separate. Record input language/build target, recognized files/facts, coverage, cold/warm conditions, memory, duration and relevant query latency. A synthetic 100,000-fact SQLite exercise says nothing by itself about the compiler cost of a real 100,000-fact project. A larger partition or page limit is not a scale improvement unless its transaction duration, memory and bounded-result semantics remain acceptable.

Before broader use, establish project-specific acceptance criteria for useful candidate precision, known-change invalidation recall, source-context usefulness and observed simplification benefit. For the service, include writer contention, queue age, stale leases, crash/retry, artifact availability and external merge/deployment enforcement. [Scaling](SCALING.md) and [verification](VERIFICATION.md) describe current constraints and measured evidence. Report failed or unmeasured criteria explicitly.

## Contribution checklist

- The change explains a real investigation or assurance question and names its assumptions.
- Every candidate keeps source provenance and a validation step; no score or source text acquires policy authority.
- Rules, analyzer/checker versions, dependency inputs and candidate policy changes remain visible to applicability/drift.
- Missing inputs, new/removed subjects, identity collisions and limits retain uncertainty or fail atomically.
- CLI and MCP share read semantics, consistent scan/review pins and honest truncation/pagination; review append remains an explicit CLI write.
- Migration, review invalidation and source reversion preserve append-only history and do not restore stale applicability.
- Behavior tests cover the relevant failure boundary; measurements distinguish synthetic projection cost from real extraction.
- User documentation states the new capability and the conditions in which it cannot answer the question.
