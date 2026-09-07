# Drift and technical-debt coverage

Coverage has three different meanings: a **kernel invariant** that is enforced by the service, a **candidate diagnostic** that flags suspicious code, and an **evidence obligation** that needs project-specific checkers or models. They must not be collapsed into a single “AI confidence” value.

The initial rule manifests contain 20 TypeScript/JavaScript rules, 16 Java/Spring rules, six configuration rules and five snapshot-delta rules: **47 candidate rule IDs**. The framework and configuration patterns are intentionally conservative. There is no claim that 47 patterns cover all causes of drift.

## Agent-scale and assurance drift

| Cause | Implemented handling | Boundary |
|---|---|---|
| Concurrent publication / lost update | Expected-head comparison inside atomic writer transaction | Trusted scanner must analyze the intended source; Git itself is external |
| Stale plan or context | Exact heads, claim revision/generation and policy-epoch pins | Agents can still edit files outside the service; release cannot pretend old context is current |
| Agent crash / lease replacement | Expiry and monotonically increasing fences | Not a filesystem lock |
| Different files, same obligation | Shared semantic claim leases and obligation closure | Conservative: may serialize changes that a stronger analysis could prove independent |
| New bypass/writer path | Scope membership fingerprints include new members | Completeness of the scope extractor remains an obligation |
| Requirement weakening | Immutable revisions and independent approval; agent proposals stay proposed | Human approval can still encode incorrect intent |
| Self-certified evidence | Separate runner authorization and checker allowlists | A compromised authorized runner remains a trusted-producer compromise |
| Stale result from old source | Revision/generation/dependency checks; historical retention | Old results never automatically migrate to new generations |
| Test/build harness weakening | Operator-pinned protected checker scopes plus delta findings | The protected scope must include configuration/plugins/fixtures that control meaning |
| Flaky rerun until green | Same-generation failure stays blocking after later passes | Changes to relevant source or independently reviewed policy require fresh assessment |
| Missing tests / disabled checks | Rule-manifest, context and coverage tracking; skip/disabled/assertion-delta candidates | Assertion count is not semantic test strength |
| Prompt injection in repository or memory | Untrusted descriptive content, allowlisted MCP surface, backend authority checks | Not a general prompt-injection detector or cure for compromised orchestration |
| Incomplete agent handoff | Snapshot-pinned notes, provenance, TTL and explicit context pagination | Narrative accuracy is not guaranteed |
| Expired temporary workaround | Generation-pinned, time-bounded debt decisions; immediate gate expiry checks | Business impact and repayment effort need owner evidence |
| Same content after intervening change | Parent-chained snapshot heads prevent ABA identity reuse | Source provenance must still be trustworthy |
| Configuration/dependency/rule changes | Fingerprints and context invalidation | Actual deployment and Java resolved runtime artifacts need operator-supplied digests |

## TypeScript / JavaScript diagnostics

| Rule IDs | Candidate mechanism |
|---|---|
| TS_FLOATING_PROMISE, TS_DETACHED_ASYNC | Unawaited promise-valued expression; explicit `void` detachment; async `forEach`; discarded async `map` work |
| TS_UNBOUNDED_FANOUT, TS_NESTED_RETRY | Visible `Promise.all(map(...))` fan-out; syntactically nested retry calls |
| TS_TIMER_CLEANUP, TS_LISTENER_CLEANUP, TS_SUBSCRIPTION_CLEANUP | Allocations/registrations without same-file visible cleanup |
| TS_EMPTY_CATCH | Failure information discarded by an empty catch |
| TS_ABORT_NOT_FORWARDED | A function accepts an abort signal, but a direct fetch call does not visibly forward it |
| TS_SYNC_IO | Selected synchronous operations in an execution context that needs review |
| TS_ANY_BOUNDARY, TS_TYPE_SUPPRESSION | Unconstrained public boundary or bypassed type checks |
| TS_DYNAMIC_CODE | Dynamic evaluation/Function constructor outside the extracted behavior graph |
| TS_UNVALIDATED_DESERIALIZATION | JSON parse at a public boundary without an established validation contract |
| TS_LAYER_VIOLATION, TS_IMPORT_CYCLE | Resolved import graph violates declared layers or contains a strongly connected cycle |
| TS_TEST_DISABLED, TS_TEST_EXCLUSIVE | Disabled or exclusive test declarations |
| TS_LARGE_FUNCTION, TS_DUPLICATE_IMPLEMENTATION | Change-locality and synchronized-evolution candidates, not automatic debt valuations |

Compiler errors, dynamic behavior, unresolved imports and truncated effect summaries remain visible as partial semantics. Resolved imported source/type content is digested so a changed declaration does not hide behind an unchanged package name. That digest is not a runtime implementation or supply-chain attestation.

Effects include candidate reads/writes, publication, acquisition/release, spawning/subscription, cancellation requests, blocking operations, retries and required contexts. They are not a complete path-sensitive interprocedural ownership proof. A database wrapper with an unfamiliar method name may evade the `writers` tag. Attach a model/adapter or use a broader component obligation rather than treating that tag as universally complete.

## Java and Spring diagnostics

| Rule IDs | Candidate mechanism |
|---|---|
| SPRING_SELF_INVOCATION, SPRING_ASYNC_SELF_INVOCATION | A local call appears to bypass default proxy interception |
| SPRING_PRIVATE_TRANSACTION | Transactional declaration whose visibility is inconsistent with expected proxy interception |
| SPRING_FIELD_INJECTION | Hidden construction dependencies and lifecycle/change-locality liability |
| SPRING_REACTIVE_BLOCK | Blocking call in a visibly reactive method context |
| JAVA_EMPTY_CATCH, JAVA_INTERRUPTION_SWALLOWED | Lost failure/cancellation information |
| JAVA_UNBOUNDED_EXECUTOR, JAVA_EXECUTOR_CLEANUP | Unbounded pool creation or no same-method visible shutdown |
| JAVA_THREADLOCAL_CLEANUP | Context retention without visible cleanup |
| JAVA_CANCEL_IS_NOT_STOP | CompletableFuture cancellation mistaken for underlying computation termination |
| JAVA_REFLECTION_UNKNOWN | Reflection introduces behavior outside local semantic extraction |
| JAVA_TEST_DISABLED | Disabled tests |
| JAVA_MANUAL_RESOURCE | Resource lifecycle requiring ownership/path review |
| JAVA_LARGE_METHOD | Change-locality candidate |
| JAVA_SQL_CONCATENATION | SQL constructed by concatenation, requiring data-flow/security review |

Remote Java analysis uses the JDK tree API and never claims full type resolution. Full local attribution is opt-in, annotation processing is disabled, and the actual build classpath must be supplied. It still is not whole-program dynamic dispatch, Spring application-context execution, Hibernate query behavior, Reactor scheduling, AspectJ weaving, or native-image verification.

Example local configuration fields, relative to the component root:

```json
{
  "javaCoreClassPath": "/absolute/path/assurance-memory/.build/java",
  "javaClasspath": ["target/classes", "/operator/resolved-dependencies/spring-context.jar"],
  "environment": {"resolvedJavaArtifacts": "REPLACE_WITH_REVIEWED_64_HEX_DIGEST"}
}
```

Use the real complete classpath, not only the illustrative jar above. Local attributed runs currently require the complete source batch within 2,000 files / five megabytes; larger builds need smaller attributed modules or a stronger adapter. An honest PARTIAL result is preferable to a falsely complete one.

## Configuration, schema and evolution

CONFIG_TEST_SKIP, CONFIG_FLOATING_DEPENDENCY, CONFIG_FLOATING_IMAGE, CONFIG_DESTRUCTIVE_MIGRATION, CONFIG_UNBOUNDED_QUEUE and CONFIG_PRIVATE_KEY flag selected configuration risks. Raw source/config contents are not retained in the graph. A key-marker finding does not copy the private key value.

Recognized manifests, lockfiles, Dockerfiles, Gradle files, schema files, migrations and intent documents are fingerprinted. DELTA_API_SIGNATURE, DELTA_EFFECTS, DELTA_TEST_ASSERTIONS, DELTA_GUARD_REMOVAL and DELTA_MIGRATION_MUTATED explain relevant between-snapshot changes. Removing a diagnostic rule does not mark its old findings “fixed”; omitted findings become UNKNOWN unless complete applicable execution supports NOT_OBSERVED.

The system does not perform full OpenAPI/protobuf compatibility checking, migration replay against all historical schemas, CVE intelligence, SBOM verification, license analysis or dependency-confusion detection. Attach those tools as versioned independent checks. A config file being unchanged is not evidence that the effective deployed configuration is unchanged; supply a digest of the effective context.

## State machines, nonfunctional properties and internal lifecycles

The finite checker supports bounded variables for service/request/job/transaction/resource state, ownership, execution epochs and counters. Guards and simultaneous assignments let authors encode communicating machines and shared atomic transitions. Parallel/hierarchical locations must be explicitly encoded; there is no automatic SCXML/XState import or extraction of an exact global machine from arbitrary application code.

Safety invariants, optional deadlock failures and replayable counterexamples are implemented. Liveness/fairness, infinite-state proof, automatic state abstraction, model refinement and implementation conformance are not. Treat those as separate proof/checker integrations, never infer them from MODEL_SATISFIED.

The causal trace checker catches declared forbidden orderings within an execution identity, preserving missing-causality uncertainty. It is not an OpenTelemetry ingestion pipeline, complete runtime monitor, or proof that unobserved paths cannot occur.

The TypeScript NFR evaluator binds workload profile, attempts, concurrency and payload envelope, then evaluates admitted latency plus rejection/error budgets and margins. Missing population or mismatched workload yields UNKNOWN. Retry amplification is multiplicative. Benchmark independence, representative traffic, statistical confidence, memory/backpressure bounds, starvation, distributed failover and recovery-time assurance require project-specific measurement/model obligations.

## Technical debt is an evidence-backed management record

Candidate complexity, duplication or missing cleanup is not automatically debt. A debt proposal needs a mechanism and future-change consequences. Owners can record observed repeated work, incident effort or measured lead-time effects and an explicitly labeled repayment estimate. The implementation does not invent monetary interest rates from syntax or equate all findings with bugs.
