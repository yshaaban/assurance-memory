#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { clientFromEnvironment } from "./client.js";
import { loadConfig, publishComponent } from "./scan.js";
import { fingerprintGitScope, JobRunner, loadRunnerConfiguration } from "./runner.js";
import { evaluateLatency } from "./nfr.js";

const { positionals, values } = parseArgs({ allowPositionals: true, options: {
  config: { type: "string" }, component: { type: "string" }, json: { type: "string" },
  components: { type: "string" }, selectors: { type: "string" }, intent: { type: "string" },
  supersedes: { type: "string" }, once: { type: "boolean" }, "unsafe-local": { type: "boolean" },
  root: { type: "string" }, patterns: { type: "string" }, help: { type: "boolean" },
} });
const print = (value: unknown) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
const required = (value: string | undefined, name: string) => { if (!value) throw new Error(`${name} is required`); return value; };
async function input(): Promise<any> {
  const path = required(values.json, "--json FILE (or - for stdin)");
  if (path !== "-") return JSON.parse(await readFile(path, "utf8")) as unknown;
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of process.stdin) { const bytes = Buffer.from(chunk); size += bytes.length; if (size > 8_000_000) throw new Error("Input too large"); chunks.push(bytes); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}
async function main(): Promise<void> {
  const command = positionals[0];
  if (!command || values.help) {
    process.stdout.write(`Assurance Memory CLI\n\nEnvironment: ASSURANCE_URL, ASSURANCE_WORKSPACE, ASSURANCE_TOKEN\n\nCommands:\n  scan --config workspace.json [--component id]\n  call operation.name --json request.json\n  prepare --components a,b --selectors component:a,component:b --intent "change" [--supersedes plan-id]\n  validate PLAN_ID\n  model --json model.json\n  trace --json trace.json\n  nfr --json {envelope,batch}.json\n  runner --config /operator/runner.json [--once] [--unsafe-local]\n  fingerprint --root repository --patterns '**/*.test.ts,package.json'\n\nUse independently scoped AGENT, SCANNER, RUNNER, and MAINTAINER credentials.\n`);
    return;
  }
  if (command === "fingerprint") { print(await fingerprintGitScope(resolve(required(values.root, "--root")), required(values.patterns, "--patterns").split(","))); return; }
  if (command === "nfr") { const body = await input(); print(evaluateLatency(body.envelope, body.batch)); return; }
  const client = clientFromEnvironment();
  switch (command) {
    case "call": print(await client.call(required(positionals[1], "operation.name"), await input())); break;
    case "model": print(await client.call("models.check", await input())); break;
    case "trace": print(await client.call("traces.check", await input())); break;
    case "validate": print(await client.validate(required(positionals[1], "PLAN_ID"))); break;
    case "prepare": {
      const request: Parameters<typeof client.prepare>[0] = { intent: required(values.intent, "--intent"), components: required(values.components, "--components").split(","), writeSelectors: required(values.selectors, "--selectors").split(",") };
      if (values.supersedes) request.supersedes = values.supersedes;
      print(await client.expandObligations(await client.prepare(request))); break;
    }
    case "scan": {
      const path = resolve(required(values.config, "--config")), configuration = await loadConfig(path);
      if (configuration.workspace !== (process.env.ASSURANCE_WORKSPACE ?? "demo")) throw new Error("Configuration workspace differs from authenticated API workspace selection");
      const components = values.component ? [values.component] : Object.keys(configuration.components);
      for (const component of components) {
        const config = configuration.components[component]; if (!config) throw new Error(`Unknown component ${component}`);
        print({ component, ...(await publishComponent(client, component, resolve(dirname(path), config.root), config)) });
      }
      break;
    }
    case "runner": {
      const configuration = await loadRunnerConfiguration(required(values.config, "--config"));
      const runner = new JobRunner(client, configuration, values["unsafe-local"] ?? false);
      let stopped = false; process.on("SIGINT", () => { stopped = true; }); process.on("SIGTERM", () => { stopped = true; });
      do { const result = await runner.runOne(); if (result.claimed || values.once) print(result); if (!result.claimed && !values.once) await new Promise(resolve => setTimeout(resolve, 2000)); }
      while (!values.once && !stopped);
      break;
    }
    default: throw new Error(`Unknown command ${command}; use --help`);
  }
}
void main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : "Command failed"}\n`); process.exitCode = 1; });
