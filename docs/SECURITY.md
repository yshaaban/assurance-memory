# Security boundary and deployment review

## What is enforced

Bearer credentials are hashed with SHA-256 and compared in constant time. Generated tokens use 256 bits of randomness. Low-entropy user passwords are not suitable replacements. Tenant and actor identity come only from the authenticated principal, never from caller-supplied tenant headers. Every store query is tenant/workspace-scoped. Credentials cannot combine independent authority roles. Only authorized checker identities can lease/complete their jobs; release receipts need the separate `release-gate` grant.

Agents can propose policy and debt, not approve either. Their memory remains descriptive. MCP has an explicit agent-only operation allowlist, a message-size limit and bounded active requests; no shell or arbitrary URL fetch is exposed. Repository prose is never passed to an `eval` implementation. The finite model language has a closed operator set and rejects unknown model/transition keys rather than silently dropping misspelled guards.

Source scan sessions are scanner-owned. Publication uses compare-and-swap. Plans, evidence and decisions are exact-context-pinned. Idempotency keys are actor-bound and input-bound. Job and plan ownership use server-time expiry and monotonically increasing fences. Green reruns do not erase same-generation failures.

The checker runner uses clean immutable Git objects, rejects dirty revisions, symlinks and submodules without an explicit adapter, verifies materialized file contents against Git blob IDs, checks protected harness scopes, and strips parent secrets from child environments. Docker execution uses no network, read-only sources, dropped capabilities and explicit memory/process/CPU constraints. Artifact files are private and content-digested.

## What is not enforced

This is not an OIDC/OAuth identity service, a secrets manager, a mandatory access-control layer over files, a hardened multi-tenant sandbox service, or a cryptographically verifiable supply-chain ledger. API authentication is static service-account configuration and requires restart/rollout for configuration changes. Use a trusted TLS boundary; do not expose internal HTTP externally.

Workspace is the access-control boundary. There is no per-symbol/per-document ACL inside one workspace. Separate restricted repositories into separately authorized workspaces; the implementation does not automatically federate assurance across them. Scope summaries can disclose architecture even without raw source. Tenant administrators/database administrators and the runner host are trusted.

A SCANNER can lie about facts or environment, a RUNNER can fabricate evidence, and a MAINTAINER can approve a wrong requirement. Their separation makes these risks governable; it does not make privileged actors mathematically trustworthy. Deploy independently reproducible runners, signed artifacts, human review and external audit retention for higher assurance.

The server does not fetch evidence URIs and does not verify remote artifact bytes. The bundled runner computes a digest over its artifact and stores it locally; move artifacts into an access-controlled durable object store and add independent verification before treating them as long-lived evidence. A release receipt is a database record, not a cryptographic signature or an atomic Git/deployment action.

The local executor is deliberately named unsafe. `shell:false` and a sanitized environment do not make arbitrary code safe on a shared host. Docker daemon access is powerful; run trusted workers on dedicated nodes and consider stronger isolation for hostile repositories. Denial of service through many valid calls needs gateway quotas and tenant budgets beyond the in-process semaphores.

## Before production exposure

Use TLS; individually scoped rotated identities; restricted network access to PostgreSQL; operator-owned scanner/runner definitions; protected merge paths; isolated build workers; audited image and dependency digests; backup/restore tests; bounded storage/retention policies; per-workspace quotas; external audit export; and tested framework/runtime adapters. Pin transitive dependencies and CI actions after reviewing them. Supplied image tags and release pins are not a security attestation.

Do not put raw credentials, customer data, full sensitive traces or private key material into notes or artifact metadata. The scanner avoids dotenv/auth files and stores source hashes rather than raw source, but method names, paths, findings, models, notes and supplied contexts can still be sensitive. The Java analysis API necessarily receives the submitted Java source for parsing; deploy it within the appropriate trust boundary.

Local counterevidence records are user-reported annotations. Author names are labels, not authenticated reviewer identities, and evidence text is not independently verified. Current records affect investigation priority only; they cannot approve policy, establish behavior or close debt. Source/compiler context changes withdraw their ranking influence on the next explicit scan. Preserve reviewed databases with a SQLite-consistent backup before replacement.
