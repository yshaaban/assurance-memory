import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { TypeScriptAnalyzer } from "../src/analyzer.js";
import { sha256, glob, stronglyConnected, subjectId, portablePath } from "../src/util.js";
import { percentile, evaluateLatency, retryAmplification, type LatencyEnvelope } from "../src/nfr.js";
import { childEnvironment, protectedDigest, runCommand } from "../src/runner.js";
import { AssuranceClient } from "../src/client.js";
import { analyzeComponent } from "../src/scan.js";

async function temporary<T>(action: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "assurance-unit-"));
  try { return await action(root); } finally { await rm(root, { recursive: true, force: true }); }
}
test("stable subject identities, glob semantics and path containment", () => {
  assert.equal(subjectId("a", "src/a.ts#f"), sha256("a:src/a.ts#f"));
  assert.notEqual(subjectId("a", "src/a.ts#f"), subjectId("b", "src/a.ts#f"));
  assert.equal(glob("**/*.ts", "a.ts"), true);
  assert.equal(glob("src/*.ts", "src/deep/a.ts"), false);
  assert.equal(glob("src/**", "src/deep/a.ts"), true);
  assert.throws(() => portablePath("/tmp/repo", "/tmp/elsewhere/a.ts"));
});
test("iterative SCC handles cycles and long graphs without recursive stack growth", () => {
  const graph = new Map<string, Set<string>>();
  for (let i = 0; i < 10000; i++) graph.set(`${i}`, new Set(i < 9999 ? [`${i + 1}`] : ["9998"]));
  const groups = stronglyConnected(graph);
  assert.ok(groups.some(group => group.length === 2 && group.includes("9998")));
});
test("compiler analyzer detects lifecycle drift candidates without claiming proof", async () => {
  const root = resolve("examples/fixtures/ts"), path = join(root, "lifecycle.ts");
  const result = new TypeScriptAnalyzer().analyze("gateway", root, [path]);
  const rules = new Set(result.findings.map(finding => finding.ruleId));
  for (const rule of ["TS_FLOATING_PROMISE", "TS_DETACHED_ASYNC", "TS_TIMER_CLEANUP", "TS_EMPTY_CATCH", "TS_ANY_BOUNDARY"]) assert.ok(rules.has(rule), rule);
  assert.ok(result.facts.some(fact => fact.tags.includes("writers")));
  assert.ok(result.facts.every(fact => /^[a-f0-9]{64}$/.test(fact.id)));
});
test("compiler analyzer detects layer cycles and preserves named identities across line movement", async () => temporary(async root => {
  await mkdir(join(root, "domain")); await mkdir(join(root, "infra"));
  const a = join(root, "domain/a.ts"), b = join(root, "infra/b.ts");
  await writeFile(a, 'import { b } from "../infra/b.js"; export function a(): number { return b(); }');
  await writeFile(b, 'import { a } from "../domain/a.js"; export function b(): number { return a(); }');
  const analyzer = new TypeScriptAnalyzer(), config = { root, layers: [{ name: "domain", match: "domain/**", mayImport: [] }, { name: "infra", match: "infra/**", mayImport: ["domain"] }] };
  const first = analyzer.analyze("app", root, [a, b], config);
  assert.ok(first.findings.some(f => f.ruleId === "TS_LAYER_VIOLATION"));
  assert.ok(first.findings.some(f => f.ruleId === "TS_IMPORT_CYCLE"));
  const named = first.facts.find(f => f.locator === "domain/a.ts#a")!;
  await writeFile(a, '\n\nimport { b } from "../infra/b.js"; export function a(): number { return b(); }');
  const second = analyzer.analyze("app", root, [a, b], config);
  assert.equal(second.facts.find(f => f.locator === named.locator)?.id, named.id);
}));
test("syntax and dynamic behavior remain visible as partial coverage", async () => temporary(async root => {
  const path = join(root, "dynamic.ts");
  await writeFile(path, 'export function dynamic(x: string) { return eval(x); }');
  const analyzer = new TypeScriptAnalyzer();
  const result = analyzer.analyze("app", root, [path]);
  assert.equal(result.coverage.semantic, "PARTIAL");
  assert.ok(result.findings.some(f => f.ruleId === "TS_DYNAMIC_CODE"));
  await writeFile(path, 'export function broken( {');
  assert.equal(analyzer.analyze("app", root, [path]).coverage.discovery, "PARTIAL");
}));
test("skipped symlinks prevent complete source discovery", async () => temporary(async root => {
  await writeFile(join(root, "a.ts"), "export const a = 1;");
  await symlink("a.ts", join(root, "linked.ts"));
  const client = new AssuranceClient({ baseUrl: "http://127.0.0.1:1", token: "unused", workspace: "demo" });
  const result = await analyzeComponent(client, "app", root, { root });
  assert.equal(result.coverage.discovery, "PARTIAL");
}));
const envelope: LatencyEnvelope = { profileDigest: sha256("profile"), minimumAttempts: 2, percentile: 0.99,
  latencyBudgetMs: 100, maximumErrorRatio: 0, maximumRejectionRatio: 0.1, concurrency: [1, 100], payloadBytes: [1, 10000] };
const observations = [1, 2].map(id => ({ id: `${id}`, outcome: "SUCCESS" as const, durationMs: 50, concurrency: 10, payloadBytes: 100 }));
test("NFR margins, errors and rejected populations cannot be hidden", () => {
  const good = { profileDigest: envelope.profileDigest, declaredAttempts: 2, completePopulation: true, observations };
  assert.equal(evaluateLatency(envelope, good).result, "PASS");
  assert.equal(evaluateLatency(envelope, good).measurements.latencyMarginMs, 50);
  assert.equal(evaluateLatency(envelope, { ...good, observations: [observations[0]!, { ...observations[1]!, outcome: "REJECTED" }] }).result, "FAIL");
  assert.equal(evaluateLatency(envelope, { ...good, observations: [observations[0]!, { ...observations[1]!, outcome: "ERROR", durationMs: 1000 }] }).measurements.latencyMs, 1000);
  assert.equal(evaluateLatency(envelope, { ...good, completePopulation: false }).result, "UNKNOWN");
  assert.equal(evaluateLatency(envelope, { ...good, profileDigest: sha256("different") }).result, "UNKNOWN");
  assert.throws(() => evaluateLatency(envelope, { ...good, observations: [observations[0]!, observations[0]!] }));
});
test("budget arithmetic uses percentile order statistics and multiplicative retries", () => {
  assert.equal(percentile([100, 5, 2], 0.5), 5);
  assert.equal(retryAmplification([3, 4, 2]), 24);
  assert.throws(() => retryAmplification([Number.MAX_SAFE_INTEGER, 2]));
  assert.throws(() => percentile([], 0.99));
});
test("runner strips parent secrets, has a real timeout and uses shell:false", async () => temporary(async root => {
  process.env.ASSURANCE_TOKEN = "must-not-leak";
  process.env.EXTRA_TEST_SECRET = "also-private";
  assert.equal(childEnvironment().ASSURANCE_TOKEN, undefined);
  const clean = await runCommand(process.execPath, ["-e", "process.stdout.write(String(process.env.ASSURANCE_TOKEN));"], root, 5000);
  assert.equal(clean.stdout, "undefined"); assert.equal(clean.exitCode, 0);
  const timed = await runCommand(process.execPath, ["-e", "setInterval(()=>{},1000)"], root, 150);
  assert.equal(timed.incomplete, true);
}));
test("protected checker scopes bind content and new scope membership", async () => temporary(async root => {
  await writeFile(join(root, "a.test.ts"), "assert(true)");
  const initial = await protectedDigest(root, ["a.test.ts"], ["**/*.test.ts"]);
  await writeFile(join(root, "b.test.ts"), "assert(false)");
  assert.notEqual(await protectedDigest(root, ["a.test.ts", "b.test.ts"], ["**/*.test.ts"]), initial);
  await assert.rejects(() => protectedDigest(root, ["a.test.ts"], ["**/*.java"]));
}));
test("SDK rejects credential-bearing URLs, insecure remote transport and invalid workspaces", () => {
  assert.throws(() => new AssuranceClient({ baseUrl: "http://production.example", token: "x", workspace: "demo" }));
  assert.throws(() => new AssuranceClient({ baseUrl: "https://x:y@example.org", token: "x", workspace: "demo" }));
  assert.throws(() => new AssuranceClient({ baseUrl: "http://127.0.0.1", token: "x", workspace: "../bad" }));
});

test("resolved external type content changes the dependency context digest", async () => temporary(async root => {
  await mkdir(join(root, "node_modules/example"), { recursive: true });
  await writeFile(join(root, "node_modules/example/package.json"), JSON.stringify({ name: "example", types: "index.d.ts" }));
  const declaration = join(root, "node_modules/example/index.d.ts"), source = join(root, "a.ts");
  await writeFile(declaration, "export declare function external(): number;");
  await writeFile(source, 'import { external } from "example"; export const n = external();');
  const analyzer = new TypeScriptAnalyzer();
  const first = analyzer.analyze("app", root, [source]).dependencyDigest;
  await writeFile(declaration, "export declare function external(): string;");
  assert.notEqual(analyzer.analyze("app", root, [source]).dependencyDigest, first);
}));
