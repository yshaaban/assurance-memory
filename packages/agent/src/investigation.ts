import type { AnalysisResult, Fact, Finding } from './types.js';
import { sha256 } from './util.js';

export interface Opportunity {
  id: string;
  subjectId: string;
  ruleId: string;
  category: 'SIMPLIFICATION' | 'INCONSISTENCY' | 'RELIABILITY' | 'COVERAGE';
  severity: Finding['severity'];
  score: number;
  path: string;
  line: number;
  message: string;
  nextStep: string;
  evidenceNeeded: string[];
  confidence: 'STATIC_CANDIDATE';
}

/** Priorities order investigation; they never estimate money or establish a violated contract. */
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
    unique.set(id, { ...finding, id, category, path: fact.path, confidence: 'STATIC_CANDIDATE',
      score: ({ HIGH: 80, MEDIUM: 50, LOW: 20 })[finding.severity] + (fact.tags.includes('boundaries') ? 10 : 0),
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
