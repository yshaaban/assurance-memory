import { readdir, lstat, readFile, realpath } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { dependencyInputs } from "./dependency-inputs.js";
import { TypeScriptAnalyzer } from "./analyzer.js";
import { AssuranceClient } from "./client.js";
import { CONFIG_RULES } from "./rules.js";
import type { AnalysisResult, ComponentConfig, Fact, Finding, Head, WorkspaceConfig } from "./types.js";
import { deduplicateFindings, glob, portablePath, sha256, subjectId } from "./util.js";

const excludedDirectories = new Set(["node_modules", ".git", "target", "dist", "build", ".build", ".next", "coverage", ".gradle", ".assurance-cache"]);
const script = /\.[cm]?[jt]sx?$/;
const configExtensions = new Set([".json", ".yaml", ".yml", ".xml", ".sql", ".proto", ".graphql", ".properties", ".md"]);
interface Discovery { files: string[]; limitations: string[]; complete: boolean }

/** Does not follow symlinks or traverse build/dependency directories. Exclusions are part of the scan-policy digest. */
export async function discover(root: string, config: ComponentConfig): Promise<Discovery> {
  const files: string[] = [], limitations: string[] = [];
  const maximum = config.maxFiles ?? 20_000, fileMaximum = config.maxFileBytes ?? 1_000_000;
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 50_000) throw new Error("maxFiles must be 1..50000");
  if (!Number.isInteger(fileMaximum) || fileMaximum < 1 || fileMaximum > 5_000_000) throw new Error("maxFileBytes must be 1..5000000");
  let complete = true;
  const stack = [resolve(root)];
  while (stack.length) {
    const directory = stack.pop()!;
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = resolve(directory, entry.name), relative = portablePath(root, path);
      if (excludedDirectories.has(entry.name) || config.exclude?.some(pattern => glob(pattern, relative))) continue;
      if (entry.isSymbolicLink()) { complete = false; limitations.push(`Symlink omitted: ${relative}`); continue; }
      if (entry.isDirectory()) { stack.push(path); continue; }
      if (!entry.isFile()) continue;
      // Never ingest dotenv files or private credential stores as raw source/configuration.
      if (entry.name === ".env" || entry.name.startsWith(".env.") || entry.name === "auth.json") continue;
      const recognized = script.test(path) || path.endsWith(".java") || configExtensions.has(extname(path)) || /(?:^|\/)(?:Dockerfile|Containerfile|gradle\.lockfile|yarn\.lock|build\.gradle(?:\.kts)?|settings\.gradle(?:\.kts)?|\.nvmrc|\.java-version|\.jvmopts)$/.test(relative);
      if (!recognized) continue;
      const stat = await lstat(path);
      if (stat.size > fileMaximum) { complete = false; limitations.push(`Oversized input omitted: ${relative}`); continue; }
      files.push(path);
      if (files.length > maximum) throw new Error("Component exceeds its file limit; split the scan instead of publishing incomplete deletions");
    }
  }
  return { files: files.sort(), limitations: limitations.slice(0, 80), complete };
}

function configFact(component: string, path: string, source: string, findings: Finding[]): Fact {
  const locator = `${path}#file`, id = subjectId(component, locator);
  const tags = new Set(["all", "files", "configuration"]);
  const add = (ruleId: string, message: string, severity: Finding["severity"] = "HIGH") => findings.push({ subjectId: id, ruleId, line: 1, severity, message });
  if (/(?:package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|pom\.xml|gradle\.lockfile)$/.test(path)) tags.add("dependencies");
  if (/\.(?:sql|proto|graphql)$/.test(path) || /openapi|swagger/.test(path)) { tags.add("schema"); tags.add("boundaries"); }
  if (/(?:migration|changelog|flyway)/i.test(path) && /\.(?:sql|xml|ya?ml)$/.test(path)) tags.add("migrations");
  if (/\.(?:md)$/.test(path)) { tags.add("intent-sources"); tags.delete("configuration"); }
  if (/(?:skipTests|maven\.test\.skip)\s*(?:>|[:=])\s*true/i.test(source)) add("CONFIG_TEST_SKIP", "Build configuration appears to skip tests; check whether CI evidence still covers this component");
  if (/\bFROM\s+[^\s]+:latest\b|\bimage:\s*[^\s]+:latest\b/i.test(source)) add("CONFIG_FLOATING_IMAGE", "Deployment/build image uses a floating latest tag; runtime context is not immutable");
  if (/\bDROP\s+(?:TABLE|COLUMN)\b/i.test(source) && path.endsWith(".sql")) add("CONFIG_DESTRUCTIVE_MIGRATION", "Destructive schema operation needs rollout, rollback and mixed-version compatibility obligations");
  if (/(?:queue[-_.]?(?:capacity|size)|max[-_.]?queue)\s*[:=]\s*(?:-1|0|unbounded)\b/i.test(source)) add("CONFIG_UNBOUNDED_QUEUE", "Queue configuration may encode unbounded buffering; confirm framework-specific semantics");
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(source)) add("CONFIG_PRIVATE_KEY", "A private-key marker is present; no secret value was copied into the graph");
  if (path.endsWith("package.json")) {
    try {
      const data = JSON.parse(source) as Record<string, unknown>;
      for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
        const dependencies = data[field];
        if (dependencies && typeof dependencies === "object" && Object.values(dependencies).some(v => typeof v === "string" && /^(?:\*|latest|next)$|^git\+.*#(?:main|master)$/.test(v))) {
          add("CONFIG_FLOATING_DEPENDENCY", "Dependency manifest contains an unpinned source/range; verify a resolved lock and provenance", "MEDIUM");
        }
      }
    } catch { /* A compiler/build checker must establish configuration validity. The content is still fingerprinted. */ }
  }
  return { id, locator, path, language: "CONFIG", kind: "CONFIG", contentHash: sha256(source),
    signatureHash: sha256(source), tags: [...tags].sort(), effects: [], metrics: { lines: source.split(/\r?\n/).length }, line: 1 };
}
async function localJava(classPath: string, body: unknown): Promise<AnalysisResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn("java", ["-cp", classPath, "dev.assurance.core.JavaScanMain"], { stdio: ["pipe", "pipe", "pipe"],
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", LANG: "C.UTF-8" } });
    const output: Buffer[] = []; let size = 0; const errors: Buffer[] = [];
    const timeout = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Local Java analyzer timed out")); }, 120_000);
    child.stdout.on("data", (data: Buffer) => { size += data.length; if (size > 32_000_000) child.kill("SIGKILL"); else output.push(data); });
    child.stderr.on("data", (data: Buffer) => { if (errors.reduce((a, b) => a + b.length, 0) < 8000) errors.push(data); });
    child.on("error", error => { clearTimeout(timeout); reject(error); });
    child.on("close", code => {
      clearTimeout(timeout);
      if (code !== 0 || size > 32_000_000) { reject(new Error("Local Java analysis failed; inspect compiler/classpath configuration")); return; }
      try { resolveResult(JSON.parse(Buffer.concat(output).toString("utf8")) as AnalysisResult); } catch { reject(new Error("Invalid local Java analyzer response")); }
    });
    child.stdin.end(JSON.stringify(body));
  });
}
export interface ScanProfile {
  phaseMs: Record<string, number>;
  elapsedMs: number;
  files: number;
  facts: number;
  processRssBytes: number;
  processPeakRssBytes: number;
}
export async function analyzeComponent(client: AssuranceClient | undefined, component: string, root: string,
  config: ComponentConfig, analyzer = new TypeScriptAnalyzer(), onProfile?: (profile: ScanProfile) => void): Promise<AnalysisResult & { sourceRevision: string; configurationDigest: string; environment: Record<string, string> }> {
  const started = performance.now(); let phaseStart = started;
  const phaseMs: Record<string, number> = {};
  const checkpoint = (phase: string) => { const now = performance.now(); phaseMs[phase] = now - phaseStart; phaseStart = now; };
  root = await realpath(resolve(root));
  const discovery = await discover(root, config);
  checkpoint('discovery');
  const scripts = discovery.files.filter(path => script.test(path));
  const tsResult = scripts.length ? analyzer.analyze(component, root, scripts, config) : undefined;
  checkpoint('typescript');
  const facts: Fact[] = [...(tsResult?.facts ?? [])], findings: Finding[] = [...(tsResult?.findings ?? [])];
  const limitations = [...discovery.limitations, ...(tsResult?.coverage.limitations ?? [])];
  let complete = discovery.complete && tsResult?.coverage.discovery !== "PARTIAL";
  let semantic = tsResult?.coverage.semantic !== "PARTIAL";
  const rules = new Set<string>([...CONFIG_RULES, ...(tsResult?.rulesExecuted ?? [])]);
  const javaFiles = discovery.files.filter(path => path.endsWith(".java"));
  const javaInputs = javaFiles.length && config.javaClasspath
    ? [...config.javaClasspath.map(path => resolve(root, path)), resolve(root, config.javaCoreClassPath ?? ".build/java")] : [];
  const javaDigest = javaInputs.length ? await dependencyInputs(javaInputs) : undefined;
  const javaBodies = await Promise.all(javaFiles.map(async path => ({ path: portablePath(root, path), source: await readFile(path, "utf8") })));
  // A local attributed run needs the entire component source set. Remote parser batches remain explicitly partial.
  const batches: typeof javaBodies[] = [];
  if (config.javaClasspath) batches.push(javaBodies);
  else {
    let batch: typeof javaBodies = [], bytes = 0;
    for (const file of javaBodies) {
      if (bytes + Buffer.byteLength(file.source) > 4_500_000 || batch.length >= 100) { batches.push(batch); batch = []; bytes = 0; }
      batch.push(file); bytes += Buffer.byteLength(file.source);
    }
    if (batch.length) batches.push(batch);
  }
  for (const files of batches) {
    if (!files.length) continue;
    let result: AnalysisResult;
    if (config.javaClasspath) {
      if (!config.javaCoreClassPath) throw new Error("javaCoreClassPath is required for local attributed analysis");
      result = await localJava(resolve(root, config.javaCoreClassPath), { component, files, resolveTypes: true,
        classpath: config.javaClasspath.map(path => resolve(root, path)) });
    } else {
      if (!client) throw new Error("Local Java scans require javaClasspath and javaCoreClassPath; build the JDK adapter first");
      result = await client.call<AnalysisResult>("analysis.java", { component, files });
    }
    facts.push(...result.facts); findings.push(...result.findings); result.rulesExecuted.forEach(rule => rules.add(rule));
    limitations.push(...result.coverage.limitations); complete &&= result.coverage.discovery === "COMPLETE"; semantic &&= result.coverage.semantic === "RESOLVED";
  }
  checkpoint('java');
  for (const path of discovery.files.filter(path => !script.test(path) && !path.endsWith(".java"))) facts.push(configFact(component, portablePath(root, path), await readFile(path, "utf8"), findings));
  checkpoint('configuration');
  // Detect working-tree mutation during collection rather than publishing a mixture of file versions.
  for (const fact of facts.filter(fact => fact.kind === "FILE" || fact.kind === "CONFIG")) {
    if (sha256(await readFile(resolve(root, fact.path))) !== fact.contentHash) throw new Error(`Source changed during scan: ${fact.path}; retry from an immutable checkout`);
  }
  const finalDiscovery = await discover(root, config);
  if (JSON.stringify(finalDiscovery.files) !== JSON.stringify(discovery.files)) throw new Error("Source membership changed during scan; retry from an immutable checkout");
  complete &&= finalDiscovery.complete; limitations.push(...finalDiscovery.limitations);
  const unique = new Map<string, Fact>();
  for (const fact of facts) { if (unique.has(fact.id)) throw new Error("Duplicate subject identity; scan cannot be published safely"); unique.set(fact.id, fact); }
  if (unique.size > 50_000) throw new Error("Component exceeds the server's 50000-fact partition bound");
  checkpoint('sourceValidation');
  let sourceRevision: string;
  try {
    const git = (args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 }).trim();
    sourceRevision = git(["rev-parse", "HEAD"]);
    if (git(["status", "--porcelain", "--untracked-files=all"])) sourceRevision += `+dirty:${sha256(JSON.stringify([...unique.values()].map(f => [f.id, f.contentHash]))).slice(0, 16)}`;
  } catch { sourceRevision = `working-tree:${sha256(JSON.stringify([...unique.values()].map(f => [f.id, f.contentHash])))}`; }
  const environment: Record<string, string> = { ...(config.environment ?? {}), node: sha256(process.version) };
  if (tsResult?.dependencyDigest) environment.typescriptInputs = tsResult.dependencyDigest;
  if (javaDigest) {
    if (javaDigest !== await dependencyInputs(javaInputs)) throw new Error("Java compiler inputs changed during scan; retry from pinned inputs");
    environment.javaInputs = javaDigest;
    const runtime = spawnSync("java", ["-version"], { encoding: "utf8", timeout: 10000 });
    if (runtime.status !== 0) throw new Error("Cannot fingerprint the Java compiler runtime");
    environment.javaRuntime = sha256(runtime.stdout + runtime.stderr);
  }
  environment.scannerImplementation = sha256(JSON.stringify(await Promise.all(
    ["scan.js", "analyzer.js", "rules.js", "util.js", "dependency-inputs.js"].map(async name => sha256(await readFile(new URL(name, import.meta.url)))))));
  for (const digest of Object.values(environment)) if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error("Environment context must use SHA-256 digests; do not place secrets in scanner configuration");
  const result = { facts: [...unique.values()].sort((a, b) => a.id.localeCompare(b.id)), findings: deduplicateFindings(findings),
    rulesExecuted: [...rules].sort(), analyzer: `${tsResult?.analyzer ?? "no-ts"}+jdk-tree-21/1.0.0+config/1.0.0`,
    coverage: { discovery: complete ? "COMPLETE" as const : "PARTIAL" as const, semantic: semantic ? "RESOLVED" as const : "PARTIAL" as const,
      limitations: [...new Set(limitations)].slice(0, 100) },
    sourceRevision, configurationDigest: sha256(JSON.stringify(config)), environment };
  checkpoint('context');
  onProfile?.({ phaseMs, elapsedMs: performance.now() - started, files: discovery.files.length, facts: unique.size,
    processRssBytes: process.memoryUsage().rss, processPeakRssBytes: process.resourceUsage().maxRSS * 1024 });
  return result;
}
export async function publishComponent(client: AssuranceClient, component: string, root: string,
  config: ComponentConfig): Promise<{ head: Head; impactedClaims: string[] }> {
  const before = (await client.heads())[component]?.head ?? "";
  const result = await analyzeComponent(client, component, root, config);
  const scan = await client.call<{ id: string }>("scan.start", { component, expectedHead: before,
    sourceRevision: result.sourceRevision, environment: result.environment, configurationDigest: result.configurationDigest,
    expectedFacts: result.facts.length, coverage: result.coverage, analyzer: result.analyzer, rulesExecuted: result.rulesExecuted });
  for (let offset = 0; offset < Math.max(result.facts.length, result.findings.length); offset += 500) {
    await client.call("scan.batch", { scanId: scan.id, facts: result.facts.slice(offset, offset + 500), findings: result.findings.slice(offset, offset + 500) });
  }
  return client.call("scan.commit", { scanId: scan.id });
}
export async function loadConfig(path: string): Promise<WorkspaceConfig> {
  const config = JSON.parse(await readFile(path, "utf8")) as WorkspaceConfig;
  if (!config || typeof config.workspace !== "string" || !config.components || typeof config.components !== "object") throw new Error("Invalid workspace configuration");
  for (const [id, component] of Object.entries(config.components)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,49}$/.test(id) || typeof component.root !== "string") throw new Error("Invalid component configuration");
  }
  return config;
}
