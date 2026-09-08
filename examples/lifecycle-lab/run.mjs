import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runLifecycleLab, verifyLifecycleSources } from '../../packages/agent/dist/src/lifecycle-lab.js';
import { cases, traces } from './traces.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const contracts = JSON.parse(readFileSync(new URL('./contracts.json', import.meta.url), 'utf8'));
if (process.argv.slice(2).some(arg => arg !== '--summary')) {
  process.stderr.write('Usage: node examples/lifecycle-lab/run.mjs [--summary]\n');
  process.exitCode = 2;
} else {
  // Check fixed fixture bytes before importing executable fixture modules.
  const gaps = Object.values(contracts).flatMap(contract => verifyLifecycleSources(root, contract, {
    sourcePath: 'examples/lifecycle-lab/adapter.mjs',
  }).gaps);
  if (gaps.length) {
    process.stdout.write(`${JSON.stringify({ status: 'UNKNOWN', evidence: 'NOT_EXECUTED', gaps }, null, 2)}\n`);
    process.exitCode = 1;
  } else {
    const { adapters } = await import('./adapter.mjs');
    const reports = cases.map(([implementation, trace]) => runLifecycleLab(root, contracts[implementation], traces[trace], adapters[implementation]));
    const output = process.argv.includes('--summary') ? reports.map(report => ({
      contract: report.contractId, trace: report.traceId, status: report.conclusion.status,
      evidence: report.evidence, firstDivergence: report.conclusion.witnesses[0]?.obligation ?? null,
      finalState: report.observations.at(-1)?.after ?? null, gaps: report.conclusion.gaps,
    })) : reports;
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    // Deliberate unsafe fixtures are expected violations; incomplete runs are errors.
    if (reports.some(report => report.conclusion.status === 'UNKNOWN')) process.exitCode = 1;
  }
}
