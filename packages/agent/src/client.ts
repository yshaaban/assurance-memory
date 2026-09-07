import { randomUUID } from "node:crypto";
import type { ClaimInput, ContextPack, Head, Job, JsonObject, Page, Row } from "./types.js";

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string,
              public readonly requestId?: string) {
    super(message); this.name = "ApiError";
  }
}
export interface ClientOptions {
  baseUrl: string;
  workspace: string;
  token: string;
  timeoutMs?: number;
  retries?: number;
  allowInsecureHttp?: boolean;
}
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** Retries retain the SAME idempotency key. A conflict is never silently rebased or retried. */
export class AssuranceClient {
  private readonly base: URL;
  constructor(private readonly options: ClientOptions) {
    this.base = new URL(options.baseUrl);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(this.base.hostname);
    if (this.base.protocol !== "https:" && !(this.base.protocol === "http:" &&
        (loopback || options.allowInsecureHttp))) {
      throw new Error("Use HTTPS outside loopback, or explicitly allow trusted internal HTTP");
    }
    if (this.base.username || this.base.password || this.base.search || this.base.hash) {
      throw new Error("API URL must not contain credentials, query parameters, or a fragment");
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(options.workspace) || !options.token) {
      throw new Error("A valid workspace and bearer token are required");
    }
  }
  async call<T = JsonObject>(operation: string, body: unknown = {}, options: {
    idempotencyKey?: string; signal?: AbortSignal;
  } = {}): Promise<T> {
    if (!/^[a-z]+\.[a-z]+$/.test(operation)) throw new Error("Invalid operation name");
    const key = options.idempotencyKey ?? randomUUID();
    const payload = JSON.stringify(body);
    if (Buffer.byteLength(payload) > 8_000_000) throw new Error("Request exceeds the API body limit");
    const retries = this.options.retries ?? 2;
    for (let attempt = 0; ; attempt++) {
      try {
        const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 30_000);
        const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
        const response = await fetch(new URL(`/v1/${this.options.workspace}/${operation}`, this.base), {
          method: "POST", redirect: "error", signal,
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.options.token}`,
            "Idempotency-Key": key }, body: payload,
        });
        const bytes: Uint8Array[] = [];
        let size = 0;
        if (response.body) {
          const reader = response.body.getReader();
          try {
            while (true) {
              const part = await reader.read(); if (part.done) break;
              size += part.value.length;
              if (size > 32_000_000) { await reader.cancel(); throw new Error("Response too large; paginate the request"); }
              bytes.push(part.value);
            }
          } finally { reader.releaseLock(); }
        }
        const text = Buffer.concat(bytes).toString("utf8");
        let decoded: unknown;
        try { decoded = JSON.parse(text); } catch { throw new ApiError(response.status, "INVALID_RESPONSE", "Service returned non-JSON content"); }
        if (!response.ok) {
          const error = isObject(decoded) && isObject(decoded.error) ? decoded.error : {};
          const code = typeof error.code === "string" ? error.code : "API_ERROR";
          const message = typeof error.message === "string" ? error.message : `API request failed (${response.status})`;
          throw new ApiError(response.status, code, message, response.headers.get("x-request-id") ?? undefined);
        }
        return decoded as T;
      } catch (error) {
        const retryable = error instanceof ApiError ? error.status >= 500 || error.status === 429
          : error instanceof TypeError || (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name));
        if (!retryable || attempt >= retries || options.signal?.aborted) throw error;
        await pause(Math.min(2000, 100 * 2 ** attempt) + Math.floor(Math.random() * 75));
      }
    }
  }
  async *pages<T>(operation: string, input: Record<string, unknown> = {}): AsyncGenerator<T> {
    let after = "";
    while (true) {
      const page = await this.call<Page<T>>(operation, { ...input, after, limit: input.limit ?? 200 });
      for (const row of page.items) yield row;
      if (!page.hasMore) return;
      if (!page.next || page.next === after) throw new Error("Server returned a non-progressing cursor");
      after = page.next;
    }
  }
  async heads(): Promise<Record<string, Head>> {
    const heads: Record<string, Head> = {};
    for await (const row of this.pages<Row<Head>>("heads.list")) heads[row.id] = row.value;
    return heads;
  }
  approveClaim(input: ClaimInput): Promise<JsonObject> { return this.call("claims.approve", input); }
  prepare(input: { intent: string; components: string[]; writeSelectors: string[]; limit?: number;
    supersedes?: string }): Promise<ContextPack> { return this.call("plans.prepare", input); }
  /** Explicitly expands all mandatory claim details. A similarity search is never substituted. */
  async expandObligations(pack: ContextPack): Promise<ContextPack> {
    const details = [...pack.claimDetails];
    for (const id of pack.remainingClaimIds) details.push(await this.call("claims.explain", { id }));
    return { ...pack, claimDetails: details, remainingClaimIds: [], claimDetailsTruncated: false };
  }
  acquire(planId: string, ttlSeconds = 300): Promise<JsonObject> {
    return this.call("leases.acquire", { planId, ttlSeconds });
  }
  validate(planId: string): Promise<JsonObject> { return this.call("plans.validate", { planId }); }
  claimJob(checkers: string[], ttlSeconds = 90): Promise<{ job: Job | null }> {
    return this.call("jobs.claim", { checkers, ttlSeconds });
  }
}
export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function clientFromEnvironment(): AssuranceClient {
  const token = process.env.ASSURANCE_TOKEN;
  if (!token) throw new Error("ASSURANCE_TOKEN is required");
  return new AssuranceClient({ baseUrl: process.env.ASSURANCE_URL ?? "http://127.0.0.1:8080",
    workspace: process.env.ASSURANCE_WORKSPACE ?? "demo", token,
    allowInsecureHttp: process.env.ASSURANCE_ALLOW_INSECURE_HTTP === "true" });
}
