#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { dirname, resolve } from 'node:path';
import { realpath, readFile, stat } from 'node:fs/promises';
import { localQuery } from './local-query.js';
import { LocalIndex } from './local-index.js';
import { analyzeComponent, loadConfig } from './scan.js';

const { positionals, values } = parseArgs({ allowPositionals: true, options: {
  input: { type: 'string' }, category: { type: 'string' }, config: { type: 'string' }, db: { type: 'string' }, limit: { type: 'string' }, after: { type: 'string' }, help: { type: 'boolean' },
} });
async function main(): Promise<void> {
  const command = positionals[0];
  if (!command || values.help) {
    process.stdout.write(`Assurance local investigation (Node 24.16+)\n\n  assurance-local scan --config workspace.json [--db index.sqlite]\n  assurance-local status --db index.sqlite\n  assurance-local search "retry payment" --db index.sqlite [--limit 20]\n  assurance-local backlog --db index.sqlite [--limit 20] [--after CURSOR] [--category SIMPLIFICATION]\n  assurance-local context SUBJECT_ID --db index.sqlite [--limit 20]\n  assurance-local impact SUBJECT_ID --db index.sqlite [--limit 20]\n  assurance-local review --input review.json --db index.sqlite\n  assurance-local reviews CANDIDATE_ID --db index.sqlite [--limit 20] [--after CURSOR]\n  assurance-local drift SNAPSHOT --db index.sqlite [--limit 20] [--after ROW_ID]\n\nAll output is JSON. Local candidates do not issue assurance or execute repository commands.\n`);
    return;
  }
  const specification: Record<string, { arguments: number; options: string[] }> = {
    scan: { arguments: 0, options: [] }, status: { arguments: 0, options: [] },
    search: { arguments: 1, options: ['limit'] }, context: { arguments: 1, options: ['limit'] }, impact: { arguments: 1, options: ['limit'] },
    backlog: { arguments: 0, options: ['limit', 'category', 'after'] }, drift: { arguments: 1, options: ['limit', 'after'] },
    review: { arguments: 0, options: ['input'] }, reviews: { arguments: 1, options: ['limit', 'after'] },
  };
  const spec = specification[command];
  if (!spec) throw new Error('Unknown command; use --help');
  if (positionals.length !== spec.arguments + 1)
    throw new Error(`${command} expects ${spec.arguments} positional argument(s); quote multi-word search queries`);
  for (const name of Object.keys(values)) if (!['db', 'config', 'help', ...spec.options].includes(name))
    throw new Error(`--${name} is not supported by ${command}`);
  const configPath = values.config ? resolve(values.config) : undefined;
  if (!values.db && !configPath) throw new Error('--db is required (scan defaults beside --config)');
  const config = command === 'scan' ? await (async () => {
    if (!configPath) throw new Error('--config is required');
    const loaded = await loadConfig(configPath);
    if (!Object.keys(loaded.components).length) throw new Error('Workspace must have at least one component');
    return loaded;
  })() : undefined;
  const path = values.db ? resolve(values.db) : resolve(dirname(configPath!), '.assurance-cache/index.sqlite');
  if (command === 'review') {
    // Review cannot silently migrate an old projection without the requested rescan.
    const check = new LocalIndex(path, true); check.close();
  }
  const index = new LocalIndex(path, command !== 'scan' && command !== 'review', command === 'scan');
  const count = values.limit === undefined ? 20 : Number(values.limit);
  let output: unknown;
  try {
    switch (command) {
      case 'scan': {
        index.begin(config!.workspace, config!);
        const components: unknown[] = [];
        for (const [id, component] of Object.entries(config!.components).sort(([a], [b]) => a.localeCompare(b))) {
          const root = await realpath(resolve(dirname(configPath!), component.root));
          process.stderr.write(`Analyzing ${id}\n`);
          const start = performance.now();
          const result = await analyzeComponent(undefined, id, root, component);
          components.push({ id, ...index.ingest(id, root, result), elapsedMs: Math.round(performance.now() - start), coverage: result.coverage });
        }
        output = { snapshot: index.commit(Object.keys(config!.components)), database: path, components, summary: index.summary() };
        break;
      }
      case 'review': {
        if (!values.input) throw new Error('--input is required for review');
        const inputPath = resolve(values.input);
        if ((await stat(inputPath)).size > 65536) throw new Error('Review input exceeds 65536 bytes');
        const input = JSON.parse(await readFile(inputPath, 'utf8'));
        output = { review: index.addReview(input), reviewRevision: index.reviewRevision() };
        break;
      }
      case 'reviews': case 'status': case 'search': case 'backlog': case 'context': case 'impact': case 'drift':
        output = localQuery(index, command, { limit: count, category: values.category, query: positionals[1], id: positionals[1],
          snapshot: Number(positionals[1]), after: command === 'drift' ? Number(values.after ?? 0) : values.after });
        break;
      default: throw new Error('Unknown command; use --help');
    }
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } finally { index.close(); }
}
void main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : 'Command failed'}\n`); process.exitCode = 1; });
