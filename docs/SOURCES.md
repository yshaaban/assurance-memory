# Primary technical references

These references informed semantics and compatibility choices. They do not validate this implementation or its performance. Retrieved/checked on 2026-09-06. Version pins are deliberate compatibility choices, not claims of being the latest secure release.

| Topic | Primary source | Applied distinction |
|---|---|---|
| Spring Boot 4.0.3 | https://spring.io/blog/2026/02/19/spring-boot-4-0-3-available-now | Release exists; dependency pin is intentional |
| Spring transaction interception | https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/annotations.html | Default proxy self-invocation is not equivalent to external interception; weaving/proxy mode matters |
| TypeScript compiler API | https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API | Program, symbols/types and compiler-backed extraction rather than text-only indexing |
| PostgreSQL locking | https://www.postgresql.org/docs/current/explicit-locking.html | Explicit row-lock coordination across service replicas |
| PostgreSQL isolation | https://www.postgresql.org/docs/current/transaction-iso.html | Repeatable-read view within a read transaction, separate from serialized writer convention |
| MCP stdio compatibility | https://modelcontextprotocol.io/specification/2025-06-18/basic/transports | JSON-RPC messages separated by newline, stdout reserved for protocol messages |
| MCP lifecycle | https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle | Initialization and protocol-version negotiation |
| MCP tools | https://modelcontextprotocol.io/specification/2025-06-18/server/tools | Tool schemas and results are not backend authority grants |
| CompletableFuture | https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/CompletableFuture.html | Cancellation of the future is distinct from stopping underlying work |
| Node AbortController | https://nodejs.org/api/globals.html | Cancellation signals depend on supporting APIs and explicit propagation |

No Prove2Me source code is incorporated. The conceptual inspiration is the earlier conversation's immutable claims, decomposition and independent evidence; the source here is a separate implementation for software obligations.

## Evolution references (2026-09-07)

- Prove2Me's immutable targets, checked sketches and mission decomposition: https://prove2.me/about
- Prove2Me paper: https://arxiv.org/abs/2608.28433
- Node's built-in SQLite API: https://nodejs.org/download/release/v24.16.0/docs/api/sqlite.html

The local FTS5 compatibility requirement was established by executable tests on Node 24.16.0 and a negative run on Node 22.13.1, rather than inferred from the mere existence of `node:sqlite`.
