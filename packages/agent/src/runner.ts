import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, mkdir, rm, lstat, realpath } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { AssuranceClient } from "./client.js";
import { glob, sha256 } from "./util.js";
import type { Job } from "./types.js";

export interface ProtectedScope { component: string; patterns: string[]; digest: string }
export interface CheckerConfiguration {
  version: string;
  kind: "COMMAND" | "MODEL";
  workingComponent: string;
  protectedScopes: ProtectedScope[];
  command?: string[];
  executor?: "docker" | "local";
  image?: string;
  modelPath?: string;
  timeoutMs?: number;
  repeats?: number;
  memoryMb?: number;
  cpus?: number;
}
export interface RunnerConfiguration {
  artifactRoot: string;
  components: Record<string, { root: string; environment: Record<string, string> }>;
  checkers: Record<string, CheckerConfiguration>;
}
interface Snapshot { root: string; files: string[] }
export interface CommandResult { exitCode: number | null; stdout: string; stderr: string; incomplete: boolean }

/** Intentionally small child environment: runner/API/cloud credentials never enter test processes. */
export function childEnvironment(): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH ?? "/usr/bin:/bin", LANG: "C.UTF-8", TZ: "UTC", CI: "true",
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
}
function git(root: string, args: string[]): Buffer {
  return execFileSync("git", ["-C", root, "-c", "core.hooksPath=/dev/null", ...args], {
    env: childEnvironment(), maxBuffer: 32_000_000, timeout: 120_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
}
/** Builds a private immutable input copy from Git objects, not a mutable agent working tree.
 * Symlinks and submodules fail closed until an explicit materialization model is added. */
async function materialize(root: string, revision: string, destination: string): Promise<Snapshot> {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(revision)) throw new Error("Checker requires a clean immutable Git revision, not a dirty/working-tree scan");
  root = await realpath(root);
  const top = git(root, ["rev-parse", "--show-toplevel"]).toString("utf8").trim();
  const prefix = relative(top, root).replaceAll("\\", "/");
  if (prefix.startsWith("..")) throw new Error("Component root is outside its Git repository");
  const tree = prefix ? `${revision}:${prefix}` : revision;
  const entries = git(root, ["ls-tree", "-r", "-z", tree]).toString("utf8").split("\0").filter(Boolean).map(line => {
    const match = /^(\d+) (\w+) ([a-f0-9]+)\t([\s\S]+)$/.exec(line);
    if (!match) throw new Error("Invalid Git tree entry");
    const mode = match[1]!, type = match[2]!, oid = match[3]!, path = match[4]!;
    if (!["100644", "100755"].includes(mode) || type !== "blob") throw new Error("Symlink/submodule input requires an explicit materialization adapter");
    if (path.startsWith("/") || path.split("/").includes("..") || path.includes("\\") || /[\r\n\0]/.test(path)) throw new Error("Unsafe Git tree path");
    return { path, oid };
  });
  if (entries.length > 100_000) throw new Error("Runner source partition exceeds 100000 files");
  await mkdir(destination, { recursive: true, mode: 0o755 });
  const archive = `${destination}.tar`;
  git(root, ["archive", "--format=tar", `--output=${archive}`, tree]);
  execFileSync("tar", ["--extract", `--file=${archive}`, `--directory=${destination}`, "--no-same-owner", "--no-same-permissions"], {
    env: childEnvironment(), timeout: 120_000, stdio: ["ignore", "pipe", "pipe"],
  });
  await rm(archive, { force: true });
  // Git export attributes can change archive content. Verify every resulting blob, so they cannot hide a protected input.
  for (const entry of entries) {
    const path = resolve(destination, entry.path);
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16_000_000) throw new Error("Invalid/oversized materialized input");
    const bytes = await readFile(path);
    const digest = createHash(entry.oid.length === 40 ? "sha1" : "sha256")
      .update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    if (digest !== entry.oid) throw new Error("Archive input differs from its Git object (check export attributes)");
  }
  return { root: destination, files: entries.map(entry => entry.path).sort() };
}
export async function protectedDigest(root: string, files: string[], patterns: string[]): Promise<string> {
  if (!patterns.length || patterns.length > 100) throw new Error("Declare protected test/model/build input patterns");
  const members = files.filter(path => patterns.some(pattern => glob(pattern, path))).sort();
  if (!members.length) throw new Error("Protected scope is empty; refusing a vacuous checker definition");
  const fingerprints: Array<[string, string]> = [];
  for (const path of members) fingerprints.push([path, sha256(await readFile(resolve(root, path)))]);
  return sha256(JSON.stringify(fingerprints));
}
export async function fingerprintGitScope(root: string, patterns: string[]): Promise<{ digest: string; members: string[] }> {
  const files = git(root, ["ls-files", "-z"]).toString("utf8").split("\0").filter(Boolean);
  const members = files.filter(path => patterns.some(pattern => glob(pattern, path))).sort();
  return { digest: await protectedDigest(root, files, patterns), members };
}
export function runCommand(executable: string, args: string[], cwd: string, timeoutMs: number,
  signal?: AbortSignal): Promise<CommandResult> {
  return new Promise(resolveResult => {
    const child = spawn(executable, args, { cwd, env: childEnvironment(), shell: false,
      detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", bytes = 0, incomplete = false;
    const kill = () => {
      incomplete = true;
      if (child.pid) { try { process.kill(process.platform === "win32" ? child.pid : -child.pid, "SIGKILL"); } catch { /* already exited */ } }
    };
    const collect = (target: "stdout" | "stderr", data: Buffer) => {
      bytes += data.length;
      if (bytes > 2_000_000) { kill(); return; }
      if (target === "stdout") stdout += data.toString("utf8"); else stderr += data.toString("utf8");
    };
    child.stdout.on("data", (data: Buffer) => collect("stdout", data));
    child.stderr.on("data", (data: Buffer) => collect("stderr", data));
    const timeout = setTimeout(kill, timeoutMs);
    signal?.addEventListener("abort", kill, { once: true });
    if (signal?.aborted) kill();
    child.on("error", () => { incomplete = true; });
    child.on("close", code => {
      clearTimeout(timeout); signal?.removeEventListener("abort", kill);
      resolveResult({ exitCode: code, stdout, stderr, incomplete });
    });
  });
}

/** The configuration must be operator-owned, outside agent-writable repositories. It is not loaded from a job payload. */
export class JobRunner {
  constructor(private readonly client: AssuranceClient, private readonly config: RunnerConfiguration,
    private readonly allowUnsafeLocal = false) {}
  async runOne(): Promise<{ claimed: boolean; applied?: boolean; result?: string; artifactDigest?: string }> {
    const response = await this.client.claimJob(Object.keys(this.config.checkers), 90);
    if (!response.job) return { claimed: false };
    const job = response.job;
    const abort = new AbortController();
    let heartbeatBusy = false;
    const timer = setInterval(() => {
      if (heartbeatBusy) return; heartbeatBusy = true;
      void this.client.call("jobs.heartbeat", { jobId: job.id, fence: job.fence, ttlSeconds: 90 })
        .catch(() => abort.abort()).finally(() => { heartbeatBusy = false; });
    }, 25_000);
    const temporary = await mkdtemp(join(tmpdir(), "assurance-check-"));
    const artifact: Record<string, unknown> = { jobId: job.id, revision: job.revision, generation: job.generation,
      checker: job.check, contexts: job.contexts, startedAt: new Date().toISOString(), outputs: [] };
    let outcome: "PASS" | "FAIL" | "UNKNOWN" = "UNKNOWN";
    let coverage: "COMPLETE" | "PARTIAL" = "PARTIAL";
    const limitations: string[] = [];
    try {
      const checker = this.config.checkers[job.check.checker];
      if (!checker || checker.version !== job.check.version) throw new Error("Operator checker configuration/version does not match the required checker");
      if (!checker.protectedScopes?.length) throw new Error("Checker requires pinned protected test/model/build scopes");
      const snapshots: Record<string, Snapshot> = {};
      for (const [component, context] of Object.entries(job.contexts)) {
        const local = this.config.components[component];
        if (!local) throw new Error(`No operator checkout mapping for component ${component}`);
        for (const [name, digest] of Object.entries(context.environment)) if (local.environment[name] !== digest) throw new Error(`Environment attestation differs for ${component}/${name}`);
        snapshots[component] = await materialize(resolve(local.root), context.sourceRevision, join(temporary, component));
      }
      for (const protectedScope of checker.protectedScopes) {
        const snapshot = snapshots[protectedScope.component];
        if (!snapshot) throw new Error("Protected scope refers to an unassessed component");
        const digest = await protectedDigest(snapshot.root, snapshot.files, protectedScope.patterns);
        if (digest !== protectedScope.digest) throw new Error("Protected checker inputs changed; independent approval and a checker-version update are required");
      }
      const working = snapshots[checker.workingComponent];
      if (!working) throw new Error("Checker working component is outside the assessed manifest");
      artifact.protectedScopes = checker.protectedScopes;
      limitations.push("Environment context matches operator-provided digests; deployment equivalence is a separate obligation");
      if (checker.kind === "MODEL") {
        if (job.check.kind !== "MODEL" || !checker.modelPath) throw new Error("Model checker kind/path does not match the evidence policy");
        if (!working.files.includes(checker.modelPath)) throw new Error("Model path is not an immutable snapshot input");
        const model = JSON.parse(await readFile(join(working.root, checker.modelPath), "utf8")) as unknown;
        const result = await this.client.call<Record<string, unknown>>("models.check", model);
        artifact.modelResult = result;
        outcome = result.status === "MODEL_SATISFIED" ? "PASS" : result.status === "COUNTEREXAMPLE" ? "FAIL" : "UNKNOWN";
        coverage = outcome === "UNKNOWN" ? "PARTIAL" : "COMPLETE";
        limitations.push("A model result does not establish implementation conformance or liveness");
      } else {
        if (!checker.command?.length || checker.command.some(arg => typeof arg !== "string" || arg.includes("\0"))) throw new Error("Trusted command argv is required");
        const repeat = checker.repeats ?? 1, timeout = checker.timeoutMs ?? 120_000;
        if (!Number.isInteger(repeat) || repeat < 1 || repeat > 20 || timeout < 100 || timeout > 3_600_000) throw new Error("Checker bounds are invalid");
        const outputs: CommandResult[] = [];
        for (let attempt = 0; attempt < repeat; attempt++) {
          if (abort.signal.aborted) throw new Error("Checker lease was lost");
          let result: CommandResult;
          if (checker.executor === "local") {
            if (!this.allowUnsafeLocal) throw new Error("Local execution is disabled; use Docker isolation or explicitly enable trusted local development");
            limitations.push("Unsafe local development execution is not a security sandbox");
            result = await runCommand(checker.command[0]!, checker.command.slice(1), working.root, timeout, abort.signal);
          } else {
            if (!checker.image || !/@sha256:[a-f0-9]{64}$/.test(checker.image)) throw new Error("Docker checker image must be pinned by digest");
            const name = `assurance-${randomUUID()}`;
            const dockerArgs = ["run", "--name", name, "--rm", "--pull=never", "--network=none", "--read-only",
              "--cap-drop=ALL", "--security-opt=no-new-privileges", "--pids-limit=128", "--user=65532:65532",
              `--memory=${checker.memoryMb ?? 2048}m`, `--cpus=${checker.cpus ?? 2}`, "--env=CI=true",
              "--tmpfs=/tmp:rw,exec,size=256m", "--tmpfs=/work:rw,exec,uid=65532,gid=65532,size=2048m", "--workdir=/work"];
            for (const [component, snapshot] of Object.entries(snapshots)) {
              if (snapshot.root.includes(",")) throw new Error("Unsupported comma in snapshot path");
              dockerArgs.push("--mount", `type=bind,src=${snapshot.root},dst=/sources/${component},readonly`);
            }
            dockerArgs.push("--mount", `type=bind,src=${working.root},dst=/source,readonly`, checker.image, ...checker.command);
            try { result = await runCommand("docker", dockerArgs, temporary, timeout, abort.signal); }
            finally { try { execFileSync("docker", ["rm", "-f", name], { env: childEnvironment(), timeout: 10_000, stdio: "ignore" }); } catch { /* --rm already removed it */ } }
          }
          outputs.push(result);
        }
        artifact.outputs = outputs;
        const incomplete = outputs.some(output => output.incomplete || output.exitCode === null);
        outcome = incomplete ? "UNKNOWN" : outputs.some(output => output.exitCode !== 0) ? "FAIL" : "PASS";
        coverage = incomplete ? "PARTIAL" : "COMPLETE";
        if (repeat > 1) limitations.push(`All ${repeat} repeated executions are retained; one failure cannot be hidden by a later pass`);
      }
    } catch (error) {
      limitations.push(error instanceof Error ? error.message.slice(0, 1500) : "Checker infrastructure failed");
      outcome = "UNKNOWN"; coverage = "PARTIAL";
    } finally {
      clearInterval(timer);
      await rm(temporary, { recursive: true, force: true });
    }
    artifact.finishedAt = new Date().toISOString(); artifact.result = outcome; artifact.coverage = coverage;
    artifact.limitations = [...new Set(limitations)];
    const encoded = JSON.stringify(artifact, null, 2), digest = sha256(encoded);
    const artifactRoot = resolve(this.config.artifactRoot);
    for (const component of Object.values(this.config.components)) {
      const rel = relative(resolve(component.root), artifactRoot);
      if (!rel.startsWith("..") && !rel.startsWith("/")) throw new Error("Artifact store must not be inside an agent repository");
    }
    await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
    await writeFile(join(artifactRoot, `${digest}.json`), encoded, { mode: 0o600, flag: "wx" });
    const finished = await this.client.call<{ applied: boolean }>("jobs.finish", { jobId: job.id, fence: job.fence,
      checkerVersion: job.check.version, result: outcome, coverage, artifactDigest: digest,
      artifactUri: `artifact://local/${digest}`, limitations: artifact.limitations });
    return { claimed: true, applied: finished.applied, result: outcome, artifactDigest: digest };
  }
}
export async function loadRunnerConfiguration(path: string): Promise<RunnerConfiguration> {
  const location = await realpath(resolve(path));
  const configuration = JSON.parse(await readFile(location, "utf8")) as RunnerConfiguration;
  if (!configuration.components || !configuration.checkers || typeof configuration.artifactRoot !== "string") throw new Error("Invalid runner configuration");
  for (const component of Object.values(configuration.components)) {
    component.root = resolve(dirname(location), component.root);
    const rel = relative(component.root, location);
    if (!rel.startsWith("..") && !rel.startsWith("/")) throw new Error("Trusted runner configuration must be outside every agent repository");
  }
  configuration.artifactRoot = resolve(dirname(location), configuration.artifactRoot);
  return configuration;
}
