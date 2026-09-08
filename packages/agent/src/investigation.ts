import type { AnalysisResult, Fact, Finding } from './types.js';
import { sha256 } from './util.js';

export interface Opportunity {
  id: string;
  subjectId: string;
  ruleId: string;
  category: 'SIMPLIFICATION' | 'INCONSISTENCY' | 'RELIABILITY' | 'COVERAGE';
  severity: Finding['severity'];
  baseScore: number;
  score: number;
  sourceRole: 'TEST' | 'PRODUCTION' | 'CONFIGURATION';
  rankingReasons: string[];
  path: string;
  line: number;
  message: string;
  nextStep: string;
  evidenceNeeded: string[];
  confidence: 'STATIC_CANDIDATE';
}

export function classifySourceRole(fact: Fact): { role: Opportunity['sourceRole']; reason: string } {
  if (fact.tags.includes('tests')) return { role: 'TEST', reason: 'TEST source role inferred from the tests tag.' };
  const path = fact.path.replace(/\\/g, '/');
  if (/(?:^|\/)(?:__tests__|test|tests)(?:\/|$)|\.(?:spec|test)\.[cm]?[jt]sx?$/.test(path))
    return { role: 'TEST', reason: 'TEST source role inferred from a conventional test path.' };
  if (fact.language === 'CONFIG') return { role: 'CONFIGURATION', reason: 'CONFIGURATION source role follows the adapter language.' };
  return { role: 'PRODUCTION', reason: 'PRODUCTION source role is the default for code without test tags or a conventional test path.' };
}

/** Priorities order investigation; they are not defect probabilities, valuations or proof. */
export function opportunities(result: AnalysisResult): Opportunity[] {
  const facts = new Map(result.facts.map(f => [f.id, f]));
  const findings = [...result.findings];
  for (const fact of result.facts) {
    if (fact.kind !== 'FUNCTION' || fact.tags.includes('tests')) continue;
    if ((fact.metrics.guards ?? 0) >= 10) findings.push({ subjectId: fact.id, ruleId: 'DESIGN_BRANCH_CONCENTRATION', line: fact.line,
      severity: 'MEDIUM', message: `${fact.metrics.guards} conditional decisions share one function; inspect policy ownership and independent reasons to change.` });
    if (fact.effects.filter(effect => ['WRITE_DB_CANDIDATE', 'PUBLISH', 'SPAWN_OR_SUBSCRIBE', 'RETRY', 'ACQUIRE'].includes(effect)).length >= 3)
      findings.push({ subjectId: fact.id, ruleId: 'DESIGN_MIXED_OWNERSHIP', line: fact.line, severity: 'MEDIUM',
        message: 'This function combines at least three state, delivery, scheduling, retry, or resource effects; identify each state and failure owner.' });
  }
  const unique = new Map<string, Opportunity>();
  for (const finding of findings) {
    const fact = facts.get(finding.subjectId);
    if (!fact) throw new Error(`Finding refers to missing subject: ${finding.subjectId}`);
    const category = /DESIGN_|DUPLICATE|LARGE_FUNCTION|LARGE_METHOD|IMPORT_CYCLE/.test(finding.ruleId) ? 'SIMPLIFICATION'
      : /LAYER_|CONTEXT|ABORT_NOT_FORWARDED/.test(finding.ruleId) ? 'INCONSISTENCY'
      : /TYPE_|ANY_|TEST_|DYNAMIC/.test(finding.ruleId) ? 'COVERAGE' : 'RELIABILITY';
    const id = sha256(`${finding.subjectId}:${finding.ruleId}`);
    const severityScore = ({ HIGH: 80, MEDIUM: 50, LOW: 20 })[finding.severity];
    const boundaryScore = fact.tags.includes('boundaries') ? 10 : 0;
    const baseScore = severityScore + boundaryScore;
    const source = classifySourceRole(fact);
    const testDiscount = source.role === 'TEST' && category === 'RELIABILITY' ? 25 : 0;
    const rankingReasons = [`Severity ${finding.severity} contributes ${severityScore} investigation priority points.`,
      ...(boundaryScore ? ['Boundary tag adds 10 investigation priority points.'] : []), source.reason,
      ...(testDiscount ? ['Test-source reliability candidate: subtract 25 priority points; retain the warning because intentional test behavior is not established.'] : []),
      'Priority is a triage policy, not a calibrated defect probability or evidence of a violated contract.'];
    if (finding.ruleId === 'DESIGN_BRANCH_CONCENTRATION')
      rankingReasons.push('Branch count alone does not justify a refactor; establish a concrete change scenario and duplicated or scattered policy first.');
    unique.set(id, { ...finding, id, category, path: fact.path, confidence: 'STATIC_CANDIDATE',
      baseScore, score: baseScore - testDiscount, sourceRole: source.role, rankingReasons,
      nextStep: category === 'SIMPLIFICATION'
        ? 'Name a likely feature or policy change, inspect callers and ownership, and compare its current change surface with one simpler design.'
        : 'Read the source and its callers, identify the intended contract, and seek a counterexample before proposing a change.',
      evidenceNeeded: ['Source and caller inspection at this snapshot', 'An explicit behavior contract and its assumptions',
        category === 'SIMPLIFICATION' ? 'Before/after behavior tests and change-surface comparison' : 'A targeted check that can fail for the suspected mechanism'],
    });
  }
  return [...unique.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

export function driftFields(before: Fact, after: Fact): string[] {
  return (['contentHash', 'signatureHash', 'tags', 'effects', 'metrics', 'path', 'locator', 'kind', 'language'] as const)
    .filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}
