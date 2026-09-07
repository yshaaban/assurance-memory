#!/usr/bin/env node
import { randomBytes, createHash } from "node:crypto";
import { mkdir, writeFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";

// Run in an operator-owned directory outside agent worktrees. Never print bearer tokens.
const destination = resolve(process.argv[2] ?? "../assurance-secrets");
const tenant = process.argv[3] ?? "demo", workspace = process.argv[4] ?? "demo";
if (![tenant, workspace].every(value => /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(value))) throw new Error("Invalid tenant/workspace");
await mkdir(destination, { recursive: true, mode: 0o700 });
const accounts = ["reader", "agent-a", "agent-b", "scanner", "runner", "maintainer"];
const credentials = {};
const server = accounts.map(id => {
  const token = randomBytes(32).toString("base64url"); credentials[id] = token;
  const role = id.startsWith("agent-") ? "AGENT" : id.toUpperCase();
  return { id, tenant, tokenSha256: createHash("sha256").update(token).digest("hex"), roles: [role], workspaces: [workspace],
    checkers: role === "RUNNER" ? ["unit-tests", "protocol-model", "static-check", "benchmark", "release-gate"] : [] };
});
await writeFile(`${destination}/auth.json`, `${JSON.stringify(server, null, 2)}\n`, { mode: 0o644, flag: "wx" });
await writeFile(`${destination}/credentials.json`, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600, flag: "wx" });
await writeFile(`${destination}/compose.env`, `DB_PASSWORD=${randomBytes(32).toString("base64url")}\nASSURANCE_AUTH_FILE_PATH=${await realpath(destination)}/auth.json\n`, { mode: 0o600, flag: "wx" });
process.stdout.write(`Created hashed server credentials and private operator credentials in ${destination}\nAssign one agent token per worker; never share scanner, runner or maintainer tokens with agents.\n`);
