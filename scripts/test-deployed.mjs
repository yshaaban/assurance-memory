import { readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
const directory = process.argv[2], mode = process.argv[3];
if (!directory || !["seed", "verify"].includes(mode)) throw new Error("Usage: node scripts/test-deployed.mjs OPERATOR_DIRECTORY seed|verify");
const credentials = JSON.parse(await readFile(`${directory}/credentials.json`, "utf8"));
const base = `http://127.0.0.1:${process.env.PORT ?? "8099"}`;
const sha = value => createHash("sha256").update(value).digest("hex");
let ready = false;
for (let i = 0; i < 120; i++) { try { if ((await fetch(`${base}/health`)).ok) { ready = true; break; } } catch {} await new Promise(r => setTimeout(r, 250)); }
if (!ready) throw new Error("Spring Boot did not become healthy");
const check = (condition, message) => { if (!condition) throw new Error(message); };
async function call(role, operation, body = {}) {
  const response = await fetch(`${base}/v1/demo/${operation}`, { method: "POST", headers: {
    authorization: `Bearer ${credentials[role]}`, "content-type": "application/json", "idempotency-key": randomUUID(),
  }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(`${operation}: ${response.status} ${JSON.stringify(result)}`);
  return result;
}
if (mode === "seed") {
  const component = `smoke-${Date.now()}`, sourceRevision = "a".repeat(40), subjectId = sha(`${component}:a.ts#file`);
  const scan = await call("scanner", "scan.start", { component, expectedHead: "", sourceRevision, environment: {},
    configurationDigest: sha("smoke"), expectedFacts: 1, coverage: { semantic: "RESOLVED", discovery: "COMPLETE", limitations: [] }, analyzer: "smoke/1", rulesExecuted: [] });
  await call("scanner", "scan.batch", { scanId: scan.id, facts: [{ id: subjectId, locator: "a.ts#file", path: "a.ts", language: "TS", kind: "FILE", contentHash: sha("contents"), signatureHash: sha("signature"), tags: ["all"], effects: [], metrics: {}, line: 1 }], findings: [] });
  const publication = await call("scanner", "scan.commit", { scanId: scan.id });
  const claimId = `${component}.safe`;
  await call("maintainer", "claims.approve", { id: claimId, expectedRevision: 0, statement: "Controlled transport smoke-test obligation, not application assurance", owner: "ci", components: [component], watch: [`component:${component}`], quantification: "ALL_MATCHING", checks: [{ id: "smoke", kind: "TEST", checker: "unit-tests", version: "smoke1", maxAgeSeconds: 3600 }], mode: "DIRECT" });
  const { job } = await call("runner", "jobs.claim", { checkers: ["unit-tests"] });
  check(job?.claimId === claimId, "Use a disposable isolated database for smoke tests");
  await call("runner", "jobs.finish", { jobId: job.id, fence: job.fence, checkerVersion: "smoke1", result: "PASS", coverage: "COMPLETE", artifactDigest: sha("smoke-output"), artifactUri: "artifact://smoke/controlled", limitations: ["Synthetic integration fixture"] });
  const context = await call("agent-a", "plans.prepare", { intent: "Verify durable adapter", components: [component], writeSelectors: [`component:${component}`] });
  await call("agent-a", "leases.acquire", { planId: context.plan.id });
  const gate = await call("runner", "gate.issue", { planId: context.plan.id, expectedHeads: context.plan.heads });
  await writeFile(`${directory}/smoke-state.json`, JSON.stringify({ component, claimId, gateId: gate.id, head: publication.head.head }), { mode: 0o600 });
  console.log("SPRING_SMOKE seed=PASS (restart the server, then verify)");
} else {
  const state = JSON.parse(await readFile(`${directory}/smoke-state.json`, "utf8"));
  const gate = await call("reader", "gate.get", { id: state.gateId });
  check(gate.currentlyApplicable === true, "Stored receipt should survive Spring process restart");
  check(gate.receipt.heads[state.component] === state.head, "Exact source manifest persisted");
  const claim = await call("reader", "claims.explain", { id: state.claimId });
  check(claim.assessment.status === "SUPPORTED", "Evidence survived process restart");
  console.log("SPRING_SMOKE restart-persistence=PASS");
}
