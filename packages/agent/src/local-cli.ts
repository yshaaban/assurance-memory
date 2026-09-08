#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { dirname, resolve } from 'node:path';
import { realpath, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { localQuery } from './local-query.js';
import { LocalIndex } from './local-index.js';
import { LOCAL_REVIEW_ARCHIVE_LIMITS, parseReviewArchive } from './local-review-archive.js';
import { analyzeComponent, loadConfig, type ScanProfile } from './scan.js';

const { positionals, values } = parseArgs({ allowPositionals: true, options: {
  input: { type: 'string' }, output: { type: 'string' }, profile: { type: 'boolean' }, 'max-bytes': { type: 'string' }, category: { type: 'string' }, config: { type: 'string' }, db: { type: 'string' }, limit: { type: 'string' }, after: { type: 'string' }, help: { type: 'boolean' },
} });
async function main(): Promise<void> {
  const command = positionals[0];
  if (!command || values.help) {
    process.stdout.write(`Assurance local investigation (Node 24.16+)\n\n  assurance-local scan --config workspace.json [--db index.sqlite] [--profile]\n  assurance-local status --db index.sqlite\n  assurance-local investigate "describe the behavior or change" --db index.sqlite [--limit 5] [--max-bytes 24000]\n  assurance-local search "retry payment" --db index.sqlite [--limit 20]\n  assurance-local backlog --db index.sqlite [--limit 20] [--after CURSOR] [--category SIMPLIFICATION]\n  assurance-local context SUBJECT_ID --db index.sqlite [--limit 20]\n  assurance-local impact SUBJECT_ID --db index.sqlite [--limit 20]\n  assurance-local review --input review.json --db index.sqlite\n  assurance-local reviews CANDIDATE_ID --db index.sqlite [--limit 20] [--after CURSOR]\n  assurance-local review-export --output reviews.json --db index.sqlite\n  assurance-local review-import --input reviews.json --db index.sqlite\n  assurance-local drift SNAPSHOT --db index.sqlite [--limit 20] [--after ROW_ID]\n\nAll output is JSON. Local candidates do not issue assurance or execute repository commands.\n`);
    return;
  }
  const specification: Record<string, { arguments: number; options: string[] }> = {
    scan: { arguments: 0, options: ['profile'] }, status: { arguments: 0, options: [] },
    search: { arguments: 1, options: ['limit'] }, context: { arguments: 1, options: ['limit'] }, impact: { arguments: 1, options: ['limit'] },
    investigate: { arguments: 1, options: ['limit', 'max-bytes'] },
    backlog: { arguments: 0, options: ['limit', 'category', 'after'] }, drift: { arguments: 1, options: ['limit', 'after'] },
    review: { arguments: 0, options: ['input'] }, reviews: { arguments: 1, options: ['limit', 'after'] },
    'review-export': { arguments: 0, options: ['output'] }, 'review-import': { arguments: 0, options: ['input'] },
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
  let archiveInput: Buffer | undefined;
  if (command === 'review-import') {
    if (!values.input) throw new Error('--input is required for review-import');
    const inputPath = resolve(values.input);
    if ((await stat(inputPath)).size > LOCAL_REVIEW_ARCHIVE_LIMITS.bytes) throw new Error('Review archive exceeds byte limit');
    archiveInput = await readFile(inputPath);
    parseReviewArchive(archiveInput); // Reject corruption before opening or creating a database.
  }
  if (command === 'review-export' && !values.output) throw new Error('--output is required for review-export');
  if (command === 'review' || command === 'review-import' && existsSync(path)) {
    // Review cannot silently migrate an old projection without the requested rescan.
    const check = new LocalIndex(path, true); check.close();
  }
  const openedAt = performance.now();
  const index = new LocalIndex(path, !['scan', 'review', 'review-import'].includes(command), command === 'scan');
  const indexOpenMs = performance.now() - openedAt;
  const count = values.limit === undefined ? command === 'investigate' ? 5 : 20 : Number(values.limit);
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
          let analysis: ScanProfile | undefined;
          const result = await analyzeComponent(undefined, id, root, component, undefined,
            values.profile ? profile => { analysis = profile; } : undefined);
          const projectionStart = performance.now();
          const counts = index.ingest(id, root, result);
          components.push({ id, ...counts, elapsedMs: Math.round(performance.now() - start), coverage: result.coverage,
            ...(analysis ? { profile: { analysis, projectionMs: performance.now() - projectionStart } } : {}) });
        }
        const commitStart = performance.now();
        const snapshot = index.commit(Object.keys(config!.components));
        const commitMs = performance.now() - commitStart;
        output = { snapshot, database: path, components, summary: index.summary(),
          ...(values.profile ? { profile: { indexOpenMs, commitMs, totalMs: performance.now() - openedAt,
            scope: 'Analysis includes compiler and source validation; projection is SQLite ingestion; commit includes review reconciliation. Memory is process-wide.' } } : {}) };
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
      case 'review-export': {
        const archive = index.exportReviews();
        const outputPath = resolve(values.output!);
        await writeFile(outputPath, archive, { flag: 'wx', mode: 0o600, flush: true });
        output = { archive: outputPath, bytes: Buffer.byteLength(archive), ...parseReviewArchive(archive).source,
          authority: 'USER_REPORTED_LOCAL_ANNOTATION', meaning: 'Complete originating-review archive, not a SQLite audit-event backup; source captures remain private.' };
        break;
      }
      case 'review-import': output = { ...index.importReviews(archiveInput!),
        meaning: 'Restored history is stale and never supersedes local review priority. Inspect source before appending a fresh review.' }; break;
      case 'investigate': case 'reviews': case 'status': case 'search': case 'backlog': case 'context': case 'impact': case 'drift':
        output = localQuery(index, command, { limit: count, category: values.category, query: positionals[1], task: positionals[1], id: positionals[1],
          maxBytes: values['max-bytes'] === undefined ? undefined : Number(values['max-bytes']),
          snapshot: Number(positionals[1]), after: command === 'drift' ? Number(values.after ?? 0) : values.after });
        break;
      default: throw new Error('Unknown command; use --help');
    }
    // The investigation budget covers compact JSON payload bytes, excluding the terminal newline.
    process.stdout.write(`${JSON.stringify(output, null, command === 'investigate' ? undefined : 2)}\n`);
  } finally { index.close(); }
}
void main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : 'Command failed'}\n`); process.exitCode = 1; });
