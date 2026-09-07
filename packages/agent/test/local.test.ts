import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalIndex } from '../src/local-index.js';
import { subjectId, sha256 } from '../src/util.js';
import { analyzeComponent } from '../src/scan.js';
import type { Fact } from '../src/types.js';

const fact = (name: string, extra: Partial<Fact> = {}): Fact => ({ id: subjectId('app', `${name}.ts#file`), locator: `${name}.ts#file`,
  path: `${name}.ts`, kind: 'FILE', language: 'TS', contentHash: sha256(name), signatureHash: sha256('sig'),
  tags: ['all', 'files'], effects: [], metrics: { lines: 12 }, line: 1, ...extra });
const scan = (facts: Fact[], overrides = {}) => ({ facts, findings: [], coverage: { discovery: 'COMPLETE' as const,
  semantic: 'RESOLVED' as const, limitations: [] }, rulesExecuted: [], analyzer: 'test-1', sourceRevision: 'rev',
  configurationDigest: 'config', environment: {}, ...overrides });
function publish(index: LocalIndex, facts: Fact[], overrides = {}) {
  index.begin('test', {}); const result = index.ingest('app', '/app', scan(facts, overrides)); index.commit(['app']); return result;
}

test('persistent search, direct reverse imports, deletions, signatures and new membership', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'assurance-index-')); const path = join(dir, 'index.sqlite');
  let index = new LocalIndex(path);
  try {
    const a = fact('payment', { effects: ['IMPORT:retry.ts'] }), b = fact('retry');
    assert.equal(publish(index, [a, b]).added, 2);
    assert.equal(index.search('payment')[0]!.id, a.id);
    assert.equal(index.context(b.id).neighbors[0].id, a.id);
    index.close(); index = new LocalIndex(path);
    assert.equal(index.search('retry').length, 2);
    assert.equal(publish(index, [a, b]).unchanged, 2);
    assert.equal(index.changes(2).items.length, 0);
    const result = publish(index, [{ ...a, signatureHash: sha256('changed'), effects: [] }, fact('new')]);
    assert.deepEqual(result, { added: 1, changed: 1, removed: 1, unchanged: 0 });
    assert.deepEqual(new Set(index.changes(3).items.map((r: any) => r.kind)), new Set(['ADDED', 'CHANGED', 'REMOVED']));
    assert.equal(index.search('retry').length, 0);
  } finally { index.close(); await rm(dir, { recursive: true }); }
});

test('failed workspace scan is atomic, and incomplete discovery cannot erase facts', () => {
  const index = new LocalIndex(':memory:');
  try {
    publish(index, [fact('a')]);
    index.begin('test', {});
    index.ingest('app', '/app', scan([fact('b')]));
    assert.throws(() => index.ingest('broken', '/broken', scan([], { coverage: { discovery: 'PARTIAL', semantic: 'PARTIAL', limitations: [] } })), /Incomplete/);
    index.rollback();
    assert.equal(index.revision(), 1);
    assert.equal(index.search('a').length, 1);
    assert.equal(index.search('b').length, 0);
    assert.throws(() => index.begin('different-workspace', {}), /different workspace/);
    assert.equal(index.revision(), 1);
  } finally { index.close(); }
});

test('candidate identity, stable keyset pages, resolution and reappearance retain provenance', () => {
  const index = new LocalIndex(':memory:'); const facts = Array.from({ length: 9 }, (_, i) => fact(`file${i}`));
  const findings = facts.map(f => ({ subjectId: f.id, ruleId: 'TS_LARGE_FUNCTION', line: 1, severity: 'LOW' as const, message: 'Candidate' }));
  try {
    publish(index, facts, { findings });
    let page = index.backlog(2); const ids: string[] = [];
    while (true) { ids.push(...page.items.map((r: any) => r.id)); if (!page.hasMore) break; page = index.backlog(2, page.next); }
    assert.equal(new Set(ids).size, 9);
    assert.equal(index.backlog().items[0].confidence, 'STATIC_CANDIDATE');
    publish(index, facts);
    assert.equal(index.backlog().items.length, 0);
    publish(index, facts, { findings });
    assert.equal(index.backlog().items[0].firstSeen, 1);
    assert.equal(index.backlog().items[0].lastSeen, 3);
    assert.throws(() => index.search('x', 201), /limit/);
    assert.deepEqual(index.search('" OR *'), []);
  } finally { index.close(); }
});

test('WAL readers see previous committed snapshot during writer staging', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'assurance-wal-'));
  const writer = new LocalIndex(join(dir, 'index.sqlite'));
  let reader: LocalIndex | undefined;
  try {
    publish(writer, [fact('old')]);
    writer.begin('test', {}); writer.ingest('app', '/app', scan([fact('new')]));
    reader = new LocalIndex(join(dir, 'index.sqlite'));
    assert.equal(reader.read(() => reader!.revision()), 1);
    assert.equal(reader.search('old').length, 1);
    writer.commit(['app']);
    assert.equal(reader.search('new').length, 1);
  } finally { reader?.close(); writer.close(); await rm(dir, { recursive: true }); }
});

test('environment changes invalidate context even when source facts are unchanged', () => {
  const index = new LocalIndex(':memory:');
  try {
    publish(index, [fact('a')]); publish(index, [fact('a')], { environment: { runtime: sha256('new') } });
    assert.deepEqual(index.changes(2).items.map((r: any) => r.kind), ['CONTEXT_CHANGED']);
    index.begin('test', {});
    assert.throws(() => index.commit([]), /Every indexed component/); index.rollback();
    index.begin('test', {});
    assert.throws(() => index.ingest('app', '/other', scan([])), /root changed/); index.rollback();
  } finally { index.close(); }
});

test('real compiler scan surfaces candidates locally without service credentials', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'assurance-source-')); const index = new LocalIndex(':memory:');
  try {
    await writeFile(join(dir, 'handler.ts'), 'export async function handler() { try { await Promise.resolve(); } catch {} }\n');
    const result = await analyzeComponent(undefined, 'app', dir, { root: dir });
    index.begin('fixture', {}); index.ingest('app', dir, result); index.commit(['app']);
    assert.ok(index.backlog().items.some((r: any) => r.ruleId === 'TS_EMPTY_CATCH'));
    assert.ok(index.search('handler').length > 0);
    await writeFile(join(dir, 'handler.ts'), 'export function handler() { return 1; }\n');
    const after = await analyzeComponent(undefined, 'app', dir, { root: dir });
    index.begin('fixture', {}); index.ingest('app', dir, after); index.commit(['app']);
    assert.equal(index.backlog().items.some((r: any) => r.ruleId === 'TS_EMPTY_CATCH'), false);
    assert.ok(index.changes(2).items.some((r: any) => r.fields.includes('signatureHash')));
  } finally { index.close(); await rm(dir, { recursive: true }); }
});

test('classpath fingerprints change for overwritten and newly added compiler dependencies', async () => {
  const { dependencyInputs } = await import('../src/dependency-inputs.js');
  const dir = await mkdtemp(join(tmpdir(), 'assurance-classpath-'));
  try {
    await writeFile(join(dir, 'Library.class'), 'first');
    const before = await dependencyInputs([dir]);
    await writeFile(join(dir, 'Library.class'), 'second');
    const changed = await dependencyInputs([dir]);
    assert.notEqual(before, changed);
    await writeFile(join(dir, 'New.class'), 'new');
    assert.notEqual(changed, await dependencyInputs([dir]));
  } finally { await rm(dir, { recursive: true }); }
});

test('frontier pagination rejects a changed local snapshot', async () => {
  const { localQuery } = await import('../src/local-query.js');
  const index = new LocalIndex(':memory:');
  const facts = [fact('a'), fact('b')];
  const findings = facts.map(f => ({ subjectId: f.id, ruleId: 'TS_LARGE_FUNCTION', line: 1, severity: 'LOW' as const, message: 'Candidate' }));
  try {
    publish(index, facts, { findings });
    const first = localQuery(index, 'backlog', { limit: 1 });
    assert.ok(first.next);
    assert.equal((localQuery(index, 'backlog', { category: 'COVERAGE' }).items as unknown[]).length, 0);
    assert.throws(() => localQuery(index, 'backlog', { after: first.next, category: 'SIMPLIFICATION' }), /Index changed/);
    assert.equal((localQuery(index, 'backlog', { limit: 1, after: first.next }).items as unknown[]).length, 1);
    publish(index, facts, { findings });
    assert.throws(() => localQuery(index, 'backlog', { after: first.next }), /Index changed/);
    assert.throws(() => localQuery(index, 'search', { limit: '20' }), /limit/);
  } finally { index.close(); }
});

test('local MCP process exposes bounded read-only tools without credentials or a service', async () => {
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const dir = await mkdtemp(join(tmpdir(), 'assurance-mcp-local-'));
  const path = join(dir, 'index.sqlite');
  const index = new LocalIndex(path); publish(index, [fact('payment')]); index.close();
  try {
    const input = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'assurance_local_search', arguments: { query: 'payment' } } },
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'assurance_local_search', arguments: { query: 'payment', limit: -1 } } },
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'assurance_propose_requirement', arguments: {} } },
    ].map(m => JSON.stringify(m)).join('\n') + '\n';
    const child = spawnSync(process.execPath, [fileURLToPath(new URL('../src/mcp.js', import.meta.url))], {
      input, encoding: 'utf8', timeout: 10000, env: { PATH: process.env.PATH, ASSURANCE_LOCAL_DB: path } });
    assert.equal(child.status, 0, child.stderr);
    const messages = child.stdout.trim().split('\n').map(line => JSON.parse(line));
    const tools = messages.find(m => m.id === 2).result.tools;
    assert.equal(tools.length, 6);
    assert.ok(tools.every((tool: any) => tool.annotations.readOnlyHint));
    assert.equal(messages.find(m => m.id === 3).result.structuredContent.items.length, 1);
    assert.equal(messages.find(m => m.id === 4).result.isError, true);
    assert.equal(messages.find(m => m.id === 5).error.code, -32602);
  } finally { await rm(dir, { recursive: true }); }
});

test('transitive impact handles cycles and exposes node-budget exhaustion', () => {
  const index = new LocalIndex(':memory:');
  try {
    const a = fact('a', { effects: ['IMPORT:c.ts'] });
    const b = fact('b', { effects: ['IMPORT:a.ts'] });
    const c = fact('c', { effects: ['IMPORT:b.ts'] });
    publish(index, [a, b, c]);
    assert.equal(index.impact(a.id, 1).truncated, true);
    const impact = index.impact(a.id, 10);
    assert.equal(impact.truncated, false);
    assert.deepEqual(impact.affected.map((r: any) => [r.id, r.via, r.distance]), [[b.id, a.id, 1], [c.id, b.id, 2]]);
  } finally { index.close(); }
});

test('repeated local function names in different callbacks retain distinct source identities', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'assurance-scopes-'));
  try {
    await writeFile(join(dir, 'scope.ts'), `
      function file() { return 3; }
      [1].forEach(() => { const handler = () => 1; handler(); });
      [2].forEach(() => { const handler = () => 2; handler(); });
    `);
    const result = await analyzeComponent(undefined, 'app', dir, { root: dir });
    const handlers = result.facts.filter(f => f.locator.includes('#handler@declaration:'));
    assert.equal(handlers.length, 2);
    assert.notEqual(handlers[0]!.id, handlers[1]!.id);
    assert.ok(result.coverage.limitations.some(s => s.includes('Repeated local declaration')));
  } finally { await rm(dir, { recursive: true }); }
});

test('effective compiler options outside source root participate in context identity', async () => {
  const { mkdir } = await import('node:fs/promises');
  const dir = await mkdtemp(join(tmpdir(), 'assurance-options-'));
  try {
    const root = join(dir, 'src'); await mkdir(root);
    await writeFile(join(root, 'a.ts'), 'export function a() { return 1; }');
    const config = { root, tsconfig: '../tsconfig.json' };
    await writeFile(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true } }));
    const before = await analyzeComponent(undefined, 'app', root, config);
    await writeFile(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: false } }));
    const after = await analyzeComponent(undefined, 'app', root, config);
    assert.notEqual(before.environment.typescriptInputs, after.environment.typescriptInputs);
  } finally { await rm(dir, { recursive: true }); }
});

test('Java large methods appear in the simplification backlog', () => {
  const index = new LocalIndex(':memory:');
  try {
    const method = fact('service', { language: 'JAVA', kind: 'METHOD' });
    publish(index, [method], { findings: [{ subjectId: method.id, ruleId: 'JAVA_LARGE_METHOD', line: 1, severity: 'LOW', message: 'Large method candidate' }] });
    assert.equal(index.backlog(20, undefined, 'SIMPLIFICATION').items.length, 1);
  } finally { index.close(); }
});

test('changing the candidate implementation emits context drift across process restarts', async () => {
  const { copyFile, readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { spawnSync } = await import('node:child_process');
  const dir = await mkdtemp(join(tmpdir(), 'assurance-policy-'));
  try {
    for (const name of ['local-index.js', 'investigation.js', 'util.js']) {
      await copyFile(fileURLToPath(new URL(`../src/${name}`, import.meta.url)), join(dir, name));
    }
    await writeFile(join(dir, 'package.json'), '{"type":"module"}');
    await writeFile(join(dir, 'probe.mjs'), `
      import { LocalIndex } from './local-index.js';
      const index = new LocalIndex(process.argv[2]);
      index.begin('policy-probe', {});
      index.ingest('app', '/app', { facts: [], findings: [], rulesExecuted: [], analyzer: 'test', sourceRevision: 'fixed',
        configurationDigest: 'fixed', environment: {}, coverage: { discovery: 'COMPLETE', semantic: 'RESOLVED', limitations: [] } });
      const revision = index.commit(['app']);
      console.log(JSON.stringify(index.changes(revision)));
      index.close();
    `);
    const run = () => {
      const processResult = spawnSync(process.execPath, [join(dir, 'probe.mjs'), join(dir, 'index.sqlite')], { encoding: 'utf8', timeout: 10000 });
      assert.equal(processResult.status, 0, processResult.stderr);
      return JSON.parse(processResult.stdout);
    };
    assert.equal(run().items.length, 0);
    const policyPath = join(dir, 'investigation.js');
    await writeFile(policyPath, (await readFile(policyPath, 'utf8')) + '\n// Updated candidate policy build.\n');
    assert.deepEqual(run().items.map((item: any) => item.kind), ['CONTEXT_CHANGED']);
    assert.equal(run().items.length, 0);
  } finally { await rm(dir, { recursive: true }); }
});
