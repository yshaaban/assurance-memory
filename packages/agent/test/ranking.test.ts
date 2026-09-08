import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TypeScriptAnalyzer } from '../src/analyzer.js';
import { opportunities } from '../src/investigation.js';
import type { AnalysisResult, Fact } from '../src/types.js';
import { sha256, subjectId } from '../src/util.js';

async function temporary(action: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'assurance-ranking-'));
  try { await action(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test('real adapter warnings remain visible in tests with explained lower priority and stable identities', async () => temporary(async root => {
  await mkdir(join(root, 'src')); await mkdir(join(root, 'test'));
  const production = join(root, 'src/release.ts'), fixture = join(root, 'test/release.test.ts');
  // A best-effort cleanup is a plausible intentional catch, but syntax alone cannot establish its contract.
  const source = 'export function release(unsubscribe: () => void): void { try { unsubscribe(); } catch {} }';
  await writeFile(production, source); await writeFile(fixture, source);
  const analyzer = new TypeScriptAnalyzer();
  const result = analyzer.analyze('app', root, [production, fixture]);
  const candidates = opportunities(result).filter(candidate => candidate.ruleId === 'TS_EMPTY_CATCH');
  assert.equal(result.findings.filter(finding => finding.ruleId === 'TS_EMPTY_CATCH').length, 2);
  assert.equal(candidates.length, 2, 'ranking must not remove a potentially intentional warning');
  const live = candidates.find(candidate => candidate.path === 'src/release.ts')!;
  const intentionalTest = candidates.find(candidate => candidate.path === 'test/release.test.ts')!;
  assert.equal(live.sourceRole, 'PRODUCTION'); assert.equal(intentionalTest.sourceRole, 'TEST');
  assert.equal(live.severity, 'HIGH'); assert.equal(intentionalTest.severity, 'HIGH');
  assert.equal(live.baseScore, 90); assert.equal(intentionalTest.baseScore, live.baseScore);
  assert.equal(live.score, live.baseScore); assert.equal(intentionalTest.score, live.score - 25);
  assert.equal(candidates[0]!.id, live.id);
  assert.ok(intentionalTest.rankingReasons.some(reason => /tests tag/.test(reason)));
  assert.ok(intentionalTest.rankingReasons.some(reason => /subtract 25/.test(reason) && /retain the warning/.test(reason)));
  assert.ok(live.rankingReasons.some(reason => /not a calibrated defect probability/.test(reason)));
  assert.equal(live.confidence, 'STATIC_CANDIDATE'); assert.equal(intentionalTest.confidence, live.confidence);

  await writeFile(fixture, '\n\n' + source);
  const moved = opportunities(analyzer.analyze('app', root, [production, fixture]))
    .find(candidate => candidate.path === intentionalTest.path && candidate.ruleId === intentionalTest.ruleId)!;
  assert.equal(moved.id, intentionalTest.id); assert.equal(moved.score, intentionalTest.score);
  assert.equal(moved.baseScore, intentionalTest.baseScore); assert.notEqual(moved.line, intentionalTest.line);
}));

test('an observed catch chain remains an investigation candidate without analyzer proof of its lifecycle contract', async () => temporary(async root => {
  const path = join(root, 'release.ts');
  await writeFile(path, 'export function release(work: () => Promise<void>): void { work().catch(() => {}); }');
  const result = new TypeScriptAnalyzer().analyze('app', root, [path]);
  assert.ok(result.findings.some(finding => finding.ruleId === 'TS_FLOATING_PROMISE'));
  const candidate = opportunities(result).find(item => item.ruleId === 'TS_FLOATING_PROMISE')!;
  assert.equal(candidate.sourceRole, 'PRODUCTION'); assert.equal(candidate.score, 90);
  assert.equal(candidate.baseScore, 90); assert.equal(candidate.confidence, 'STATIC_CANDIDATE');
  assert.match(candidate.nextStep, /seek a counterexample/);
  assert.ok(candidate.evidenceNeeded.some(evidence => /intended|contract/.test(evidence)));
}));

test('branch concentration explains a change-surface hypothesis without escalating priority with raw counts', async () => temporary(async root => {
  const path = join(root, 'selection.ts');
  const source = (name: string, guards: number) => `export function ${name}(value: number): number {\n` +
    Array.from({ length: guards }, (_, index) => `if (value === ${index}) return ${index};`).join('\n') + '\nreturn -1;\n}';
  await writeFile(path, source('smallPolicy', 10) + '\n' + source('largerPolicy', 30));
  const result = new TypeScriptAnalyzer().analyze('app', root, [path]);
  const candidates = opportunities(result).filter(candidate => candidate.ruleId === 'DESIGN_BRANCH_CONCENTRATION');
  assert.equal(candidates.length, 2);
  for (const candidate of candidates) {
    assert.equal(candidate.category, 'SIMPLIFICATION'); assert.equal(candidate.severity, 'MEDIUM');
    assert.equal(candidate.baseScore, 60); assert.equal(candidate.score, 60);
    assert.equal(candidate.confidence, 'STATIC_CANDIDATE');
    assert.ok(candidate.rankingReasons.some(reason => /Branch count alone does not justify a refactor/.test(reason)));
    assert.match(candidate.nextStep, /likely feature or policy change/);
    assert.ok(candidate.evidenceNeeded.includes('Before/after behavior tests and change-surface comparison'));
  }
}));

test('source roles use explicit adapter metadata and conservative paths while preserving all finding identities', () => {
  const inputs: Array<{ path: string; language: Fact['language']; tags: string[]; role: 'TEST' | 'PRODUCTION' | 'CONFIGURATION' }> = [
    { path: 'checks/negative.ts', language: 'TS', tags: ['tests'], role: 'TEST' },
    { path: 'src/test/java/example/ResourceCheck.java', language: 'JAVA', tags: [], role: 'TEST' },
    { path: 'src/client.spec.mjs', language: 'JS', tags: [], role: 'TEST' },
    { path: 'test/fixtures/settings.yaml', language: 'CONFIG', tags: [], role: 'TEST' },
    { path: 'settings.yaml', language: 'CONFIG', tags: [], role: 'CONFIGURATION' },
    { path: 'src/testing-utils.ts', language: 'TS', tags: [], role: 'PRODUCTION' },
  ];
  const facts: Fact[] = inputs.map(({ path, language, tags }) => {
    const locator = `${path}#file`;
    return { id: subjectId('app', locator), locator, path, language, tags, kind: 'FILE',
      contentHash: sha256(path), signatureHash: sha256('file'), effects: [], metrics: {}, line: 1 };
  });
  const result: AnalysisResult = { facts, findings: facts.flatMap(fact => [
    { subjectId: fact.id, ruleId: 'EXISTING_RESOURCE_WARNING', line: 1, severity: 'HIGH' as const, message: 'Inspect the release contract.' },
    { subjectId: fact.id, ruleId: 'EXISTING_TEST_COVERAGE', line: 1, severity: 'MEDIUM' as const, message: 'Inspect the evidence gap.' },
  ]), coverage: { discovery: 'COMPLETE', semantic: 'PARTIAL', limitations: [] }, rulesExecuted: [], analyzer: 'adapter-fixture' };
  const candidates = opportunities(result);
  assert.equal(candidates.length, result.findings.length);
  for (const input of inputs) {
    const matches = candidates.filter(candidate => candidate.path === input.path);
    assert.equal(matches.length, 2);
    for (const candidate of matches) {
      assert.equal(candidate.sourceRole, input.role);
      assert.equal(candidate.id, sha256(`${candidate.subjectId}:${candidate.ruleId}`));
      assert.equal(candidate.score, candidate.baseScore - (input.role === 'TEST' && candidate.category === 'RELIABILITY' ? 25 : 0));
    }
  }
  assert.deepEqual(opportunities({ ...result, facts: [...facts].reverse(), findings: [...result.findings].reverse() }), candidates);
});
