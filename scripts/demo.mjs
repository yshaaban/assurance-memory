import { AssuranceClient } from "../packages/agent/dist/src/client.js";
import { publishComponent } from "../packages/agent/dist/src/scan.js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
const baseUrl = `http://127.0.0.1:${process.env.DEMO_PORT ?? "8080"}`;
let ready = false;
for (let i = 0; i < 100; i++) { try { if ((await fetch(`${baseUrl}/health`)).ok) { ready = true; break; } } catch {} await new Promise(r => setTimeout(r, 100)); }
if (!ready) throw new Error("Demo server did not start");
const client = role => new AssuranceClient({ baseUrl, workspace: "demo", token: `demo-${role}-token` });
const scanner = client("scanner"), reviewer = client("maintainer"), agent = client("agent");
for (const [component, folder] of [["gateway", "ts"], ["worker", "java"]]) {
  const result = await publishComponent(scanner, component, resolve(`examples/fixtures/${folder}`), { root: `fixtures/${folder}` });
  console.log(`Published ${component}: ${result.head.factCount ?? "component"} facts, ${result.head.coverage.semantic} semantics`);
  await reviewer.approveClaim(JSON.parse(await readFile(`examples/capsules/${component}.json`, "utf8")));
}
const prepared = await agent.prepare({ intent: "Repair task ownership and cancellation boundaries", components: ["gateway", "worker"], writeSelectors: ["component:gateway", "component:worker"] });
await agent.acquire(prepared.plan.id);
const assessment = await agent.validate(prepared.plan.id);
console.log(JSON.stringify({ plan: prepared.plan.id, mandatoryClaims: prepared.mandatoryClaimPins, releaseDisposition: assessment.disposition, blockers: assessment.blockers }, null, 2));
for await (const row of agent.pages("findings.list", { limit: 20 })) console.log(`${row.value.component}: ${row.value.ruleId} — ${row.value.message}`);
for (const kind of ["safe", "unsafe"]) {
  const result = await agent.call("models.check", JSON.parse(await readFile(`examples/models/cancellation-${kind}.json`, "utf8")));
  console.log(`${kind} cancellation model: ${result.status}`);
}
console.log("Demo complete. UNKNOWN obligations remain blocked; no synthetic green evidence was supplied.");
