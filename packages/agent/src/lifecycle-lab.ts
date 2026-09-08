import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { sha256 } from './util.js';

/** Opt-in development checker. Never imported by the scanner or active rules. */
export const LIFECYCLE_LAB_VERSION = 'lifecycle-lab/1';
export const LIFECYCLE_LAB_MAX_STEPS = 128;

function checkerBytesDigest(): string {
  return sha256(JSON.stringify({ checker: sha256(readFileSync(new URL(import.meta.url))),
    util: sha256(readFileSync(new URL('./util.js', import.meta.url))) }));
}
const loadedCheckerDigest = checkerBytesDigest();
/** Executable checker/dependency bytes sampled when this module initializes. */
export function lifecycleCheckerDigest(): string { return loadedCheckerDigest; }
function checkerGaps(): string[] {
  try {
    return checkerBytesDigest() === loadedCheckerDigest ? [] : ['Checker implementation bytes changed after module initialization; reload from a pinned build'];
  } catch { return ['Checker implementation bytes are unavailable; reload from a pinned build']; }
}

export interface LifecycleSourcePin {
  path: string;
  sha256: string;
  role: 'IMPLEMENTATION' | 'ADAPTER' | 'MUTATION_BOUNDARY';
}
export interface LifecycleContract {
  id: string;
  protocol: 'versioned-cell/1';
  release: 'ABSORBING' | 'RESTARTABLE';
  target: string;
  sources: LifecycleSourcePin[];
  coverage: {
    callbackRoute: 'RESOLVED' | 'UNRESOLVED';
    mutationOwnership: 'RESOLVED' | 'UNRESOLVED';
    downstreamAdmission: 'RESOLVED' | 'UNRESOLVED';
  };
  assumptions: string[];
}
export type LifecyclePacket = { kind: 'ready' } |
  { kind: 'event' | 'snapshot'; version: number; value: string };
export type LifecycleStep =
  { op: 'acquire'; owner: string; generation: number } |
  { op: 'retain'; owner: string; delivery: string; packet: LifecyclePacket } |
  { op: 'release'; owner: string } |
  { op: 'deliver'; delivery: string };
export interface LifecycleTrace { id: string; steps: LifecycleStep[] }
export interface LifecycleState {
  generation: number | null;
  version: number;
  value: string | null;
  mutations: number;
}
/** Trusted, synchronous adapter supplied by an explicit lab caller. No source eval. */
export interface LifecycleAdapter {
  id: string;
  sourcePath: string;
  create(): {
    acquire(owner: string, generation: number): void;
    retain(owner: string, packet: LifecyclePacket): () => void;
    release(owner: string): void;
    snapshot(): LifecycleState;
  };
}
export interface LifecycleObservation {
  index: number;
  step: LifecycleStep;
  before: LifecycleState;
  after: LifecycleState;
}
export interface LifecycleWitness {
  index: number;
  obligation: 'ACQUISITION' | 'NO_MUTATION_AFTER_RELEASE' | 'NO_MUTATION_FROM_OLD_GENERATION' |
    'NO_MUTATION_BEFORE_READY' | 'ACCEPT_CURRENT_TRAFFIC' | 'IGNORE_OLD_VERSION' | 'CONTROL_HAS_NO_MUTATION';
  explanation: string;
  expected: LifecycleState;
  observed: LifecycleState;
  replay: LifecycleStep[];
}
export interface LifecycleReport {
  checker: typeof LIFECYCLE_LAB_VERSION;
  contractId: string;
  traceId: string;
  evidence: 'EXECUTED_IMPLEMENTATION_ADAPTER' | 'MODEL_ONLY' | 'NOT_EXECUTED';
  digests: { checker: string; source: string; contract: string; trace: string; observations: string; adapter: string | null };
  verifiedSources: LifecycleSourcePin[];
  observations: LifecycleObservation[];
  conclusion: {
    status: 'VIOLATION_OBSERVED' | 'NO_VIOLATION_OBSERVED' | 'UNKNOWN';
    witnesses: LifecycleWitness[];
    gaps: string[];
    limitations: string[];
  };
  candidate: null | {
    kind: 'LIFECYCLE_LAB_INVESTIGATION';
    target: string;
    sourcePins: LifecycleSourcePin[];
    hypothesis: string;
    validation: string;
  };
}

/** JSON canonicalization rejects values that would silently disappear from a digest. */
export function lifecycleDigest(value: unknown): string {
  const canonical = (input: unknown): string => {
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return JSON.stringify(input);
    if (typeof input === 'number' && Number.isFinite(input)) return JSON.stringify(input);
    if (Array.isArray(input)) return `[${input.map(canonical).join(',')}]`;
    if (input && typeof input === 'object' && Object.getPrototypeOf(input) === Object.prototype) {
      const item = input as Record<string, unknown>;
      return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${canonical(item[key])}`).join(',')}}`;
    }
    throw new Error('Lifecycle inputs must be finite JSON values');
  };
  return sha256(canonical(value));
}

function copy<T>(value: T): T { return structuredClone(value); }
function equal(a: unknown, b: unknown): boolean { return lifecycleDigest(a) === lifecycleDigest(b); }
function state(value: LifecycleState): LifecycleState {
  if (!value || (value.generation !== null && (!Number.isSafeInteger(value.generation) || value.generation < 1)) ||
      !Number.isSafeInteger(value.version) || value.version < -1 ||
      (value.value !== null && typeof value.value !== 'string') ||
      !Number.isSafeInteger(value.mutations) || value.mutations < 0 ||
      Object.keys(value).sort().join(',') !== 'generation,mutations,value,version')
    throw new Error('Adapter snapshot does not implement versioned-cell/1');
  return copy(value);
}
const initialState = (): LifecycleState => ({ generation: null, version: -1, value: null, mutations: 0 });

function inputGaps(contract: LifecycleContract, trace: LifecycleTrace): string[] {
  const gaps: string[] = [];
  if (contract.protocol !== 'versioned-cell/1') gaps.push('Unsupported state protocol');
  if (!['ABSORBING', 'RESTARTABLE'].includes(contract.release)) gaps.push('Unresolved release contract');
  if (!contract.id?.trim() || !contract.target?.trim() || !trace.id?.trim()) gaps.push('Missing contract, target or trace identity');
  for (const key of ['callbackRoute', 'mutationOwnership', 'downstreamAdmission'] as const)
    if (contract.coverage?.[key] !== 'RESOLVED') gaps.push(`Unresolved coverage: ${key}`);
  if (!Array.isArray(contract.assumptions) || !contract.assumptions.length || contract.assumptions.some(a => !a.trim()))
    gaps.push('Explicit admission/adapter assumptions are required');
  if (!Array.isArray(trace.steps) || trace.steps.length < 1 || trace.steps.length > LIFECYCLE_LAB_MAX_STEPS)
    gaps.push(`Trace must contain 1..${LIFECYCLE_LAB_MAX_STEPS} steps; no truncation is performed`);
  return gaps;
}

interface Session { generation: number; released: boolean; ready: boolean }
interface Delivery { owner: string; session: Session; packet: LifecyclePacket }
/** Independent oracle: lifecycle transitions are inferred only from trace inputs. */
function judge(contract: LifecycleContract, trace: LifecycleTrace, observations: LifecycleObservation[]):
    { witnesses: LifecycleWitness[]; gaps: string[] } {
  const witnesses: LifecycleWitness[] = [], gaps: string[] = [];
  const sessions = new Map<string, Session>(), deliveries = new Map<string, Delivery>();
  let current: Session | undefined, maximumGeneration = 0, expected = initialState();
  if (observations.length !== trace.steps.length) return { witnesses, gaps: ['Incomplete observation population'] };
  for (let index = 0; index < trace.steps.length; index++) {
    const step = trace.steps[index]!, observation = observations[index]!;
    if (observation.index !== index || !equal(observation.step, step)) return { witnesses, gaps: ['Observation order or trace binding mismatch'] };
    if (index === 0 && !equal(observation.before, initialState())) gaps.push('Adapter did not start from an isolated empty cell');
    if (index > 0 && !equal(observation.before, observations[index - 1]!.after)) gaps.push(`Discontinuous observations at step ${index}`);
    state(observation.before); state(observation.after);
    let obligation: LifecycleWitness['obligation'] = 'CONTROL_HAS_NO_MUTATION';
    let explanation = 'Retaining, releasing, or becoming ready must not mutate the protected cell';
    if (step.op === 'acquire') {
      const previous = sessions.get(step.owner);
      if (!step.owner?.trim() || !Number.isSafeInteger(step.generation) || step.generation < 1) {
        gaps.push(`Invalid acquisition at step ${index}`); break;
      }
      const absorbingRestart = previous?.released && contract.release === 'ABSORBING';
      if (absorbingRestart) {
        obligation = 'NO_MUTATION_AFTER_RELEASE';
        explanation = 'An absorbing owner cannot reacquire after release';
      } else if ((current && !current.released) || step.generation <= maximumGeneration) {
        gaps.push(`Unsupported overlapping owner or non-increasing generation at step ${index}`); break;
      } else {
        current = { generation: step.generation, released: false, ready: false };
        sessions.set(step.owner, current); maximumGeneration = step.generation;
        expected = { generation: step.generation, version: -1, value: null, mutations: expected.mutations + 1 };
        obligation = 'ACQUISITION'; explanation = 'Acquisition starts an empty cell in a fresh generation';
      }
    } else if (step.op === 'retain') {
      const session = sessions.get(step.owner);
      if (!session || session.released || !step.delivery?.trim() || deliveries.has(step.delivery) ||
          !['ready', 'event', 'snapshot'].includes(step.packet?.kind) ||
          (step.packet.kind !== 'ready' && (!Number.isSafeInteger(step.packet.version) || step.packet.version < 0 || typeof step.packet.value !== 'string'))) {
        gaps.push(`Unresolved callback capture or invalid packet at step ${index}`); break;
      }
      deliveries.set(step.delivery, { owner: step.owner, session, packet: step.packet });
    } else if (step.op === 'release') {
      const session = sessions.get(step.owner);
      if (!session) { gaps.push(`Release has no acquired owner at step ${index}`); break; }
      session.released = true;
    } else if (step.op === 'deliver') {
      const delivery = deliveries.get(step.delivery);
      if (!delivery) { gaps.push(`Delivery has no retained callback at step ${index}`); break; }
      const { session, packet } = delivery;
      if (session !== current) {
        obligation = 'NO_MUTATION_FROM_OLD_GENERATION'; explanation = 'A retained callback belongs to a superseded owner/generation';
      } else if (session.released) {
        obligation = 'NO_MUTATION_AFTER_RELEASE'; explanation = 'A retained callback cannot mutate state after its owner releases';
      } else if (packet.kind === 'ready') {
        session.ready = true;
      } else if (!session.ready) {
        obligation = 'NO_MUTATION_BEFORE_READY'; explanation = 'Data is admitted only after the current generation is ready';
      } else if (packet.version <= expected.version) {
        obligation = 'IGNORE_OLD_VERSION'; explanation = 'Duplicate or older versions must not mutate the cell';
      } else {
        expected = { generation: session.generation, version: packet.version, value: packet.value, mutations: expected.mutations + 1 };
        obligation = 'ACCEPT_CURRENT_TRAFFIC'; explanation = 'Ready, current-generation traffic with a newer version must be accepted';
      }
    } else { gaps.push(`Unknown trace operation at step ${index}`); break; }
    // Report the first divergence: later differences can be consequences of this one.
    if (!equal(observation.after, expected) && witnesses.length === 0)
      witnesses.push({ index, obligation, explanation, expected: copy(expected), observed: copy(observation.after), replay: copy(trace.steps.slice(0, index + 1)) });
  }
  return { witnesses, gaps };
}

function report(contract: LifecycleContract, trace: LifecycleTrace, observations: LifecycleObservation[],
    evidence: LifecycleReport['evidence'], verifiedSources: LifecycleSourcePin[], adapter: LifecycleAdapter | null,
    gaps: string[]): LifecycleReport {
  const judged = gaps.length ? { witnesses: [], gaps: [] } : judge(contract, trace, observations);
  gaps = [...gaps, ...judged.gaps];
  const status = gaps.length ? 'UNKNOWN' : judged.witnesses.length ? 'VIOLATION_OBSERVED' : 'NO_VIOLATION_OBSERVED';
  const sources = [...contract.sources].sort((a, b) => `${a.path}:${a.role}`.localeCompare(`${b.path}:${b.role}`));
  return {
    checker: LIFECYCLE_LAB_VERSION, contractId: contract.id, traceId: trace.id, evidence,
    digests: { checker: loadedCheckerDigest, source: lifecycleDigest(sources), contract: lifecycleDigest(contract), trace: lifecycleDigest(trace),
      observations: lifecycleDigest(observations), adapter: adapter ? lifecycleDigest({ id: adapter.id, sourcePath: adapter.sourcePath,
        sources: verifiedSources.filter(pin => pin.role === 'ADAPTER') }) : null },
    verifiedSources: copy(verifiedSources), observations: copy(observations),
    conclusion: { status, witnesses: judged.witnesses, gaps, limitations: [
      'Development fixtures and a finite trace are not held-out validation or proof of all schedules, liveness, or production behavior.',
      'Only the declared versioned cell is observed; uninstrumented writes, asynchronous work, and other targets are outside coverage.',
      'The checker digest binds executable module and util bytes sampled at initialization; it is provenance, not loader attestation or evidence approval.',
      evidence === 'MODEL_ONLY' ? 'Model-only observations do not establish implementation conformance.' :
        evidence === 'NOT_EXECUTED' ? 'Preflight coverage/provenance failed; the implementation adapter was not invoked.' :
          'Source bytes are verified before and after execution; adapter-to-implementation mapping and coverage declarations are trusted assertions, not runtime attestation.',
      'This local report cannot approve requirements, suppress production rules, or close assurance debt.',
    ] },
    candidate: status === 'VIOLATION_OBSERVED' && evidence === 'EXECUTED_IMPLEMENTATION_ADAPTER' ? {
      kind: 'LIFECYCLE_LAB_INVESTIGATION', target: contract.target, sourcePins: copy(verifiedSources),
      hypothesis: judged.witnesses[0]!.explanation,
      validation: `Replay trace ${trace.id} through step ${judged.witnesses[0]!.index}; compare the protected cell with the witness, then run safe and current-generation controls.`,
    } : null,
  };
}

export function verifyLifecycleSources(root: string, contract: LifecycleContract, adapter: Pick<LifecycleAdapter, 'sourcePath'>):
    { verified: LifecycleSourcePin[]; gaps: string[] } {
  const gaps: string[] = [], verified: LifecycleSourcePin[] = [];
  if (!Array.isArray(contract.sources) || !contract.sources.length || contract.sources.length > 32)
    return { verified, gaps: ['Declare 1..32 implementation, mutation-boundary and adapter source pins'] };
  const realRoot = realpathSync(root), paths = new Set<string>();
  for (const pin of contract.sources) {
    if (paths.has(`${pin.path}:${pin.role}`)) { gaps.push(`Duplicate source pin: ${pin.path}:${pin.role}`); continue; }
    paths.add(`${pin.path}:${pin.role}`);
    try {
      const path = resolve(realRoot, pin.path), rel = relative(realRoot, path);
      if (isAbsolute(pin.path) || !pin.path || rel === '..' || rel.startsWith(`..${sep}`) || !/^[a-f0-9]{64}$/.test(pin.sha256) ||
          !['IMPLEMENTATION', 'ADAPTER', 'MUTATION_BOUNDARY'].includes(pin.role))
        throw new Error('invalid relative path or digest');
      if (realpathSync(path) !== path || !lstatSync(path).isFile() || lstatSync(path).size > 1_048_576)
        throw new Error('source must be a regular, non-symlink file of at most 1 MiB');
      if (sha256(readFileSync(path)) !== pin.sha256) throw new Error('source digest mismatch');
      verified.push(copy(pin));
    } catch (error) { gaps.push(`Unverified source ${pin.path}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  for (const role of ['IMPLEMENTATION', 'MUTATION_BOUNDARY', 'ADAPTER'] as const)
    if (!verified.some(pin => pin.role === role)) gaps.push(`Missing verified ${role} source`);
  if (!verified.some(pin => pin.role === 'ADAPTER' && pin.path === adapter.sourcePath)) gaps.push('Adapter identity is not source-pinned');
  return { verified, gaps };
}

/** Executes only the caller's explicitly supplied trusted adapter, never repository text. */
export function runLifecycleLab(root: string, contract: LifecycleContract, trace: LifecycleTrace, adapter: LifecycleAdapter): LifecycleReport {
  contract = copy(contract); trace = copy(trace);
  const sources = verifyLifecycleSources(root, contract, adapter);
  const gaps = [...inputGaps(contract, trace), ...sources.gaps, ...checkerGaps()], observations: LifecycleObservation[] = [];
  let executed = false;
  // Validate supported schedules before invoking any implementation callback.
  if (!gaps.length) {
    const dummy = trace.steps.map((step, index) => ({ index, step, before: initialState(), after: initialState() }));
    gaps.push(...judge(contract, trace, dummy).gaps);
  }
  if (!gaps.length) {
    try {
      executed = true;
      const implementation = adapter.create(), callbacks = new Map<string, () => void>();
      const synchronous = (value: unknown): void => {
        if (value && (typeof value === 'object' || typeof value === 'function') && 'then' in value) {
          // A rejected native Promise must not become an unhandled process error.
          if (value instanceof Promise) void value.catch(() => {});
          throw new Error('Asynchronous adapters are outside the synchronous lab protocol');
        }
      };
      for (const [index, step] of trace.steps.entries()) {
        const before = state(implementation.snapshot());
        if (step.op === 'acquire') synchronous(implementation.acquire(step.owner, step.generation));
        else if (step.op === 'release') synchronous(implementation.release(step.owner));
        else if (step.op === 'retain') {
          const callback = implementation.retain(step.owner, copy(step.packet));
          if (typeof callback !== 'function') throw new Error('Adapter did not resolve retained callback');
          callbacks.set(step.delivery, callback);
        } else synchronous(callbacks.get(step.delivery)!());
        observations.push({ index, step: copy(step), before, after: state(implementation.snapshot()) });
      }
    } catch (error) { gaps.push(`Adapter execution incomplete: ${error instanceof Error ? error.message : String(error)}`); }
  }
  if (executed) gaps.push(...[...verifyLifecycleSources(root, contract, adapter).gaps, ...checkerGaps()]
    .map(gap => `After execution: ${gap}`));
  return report(contract, trace, observations, executed ? 'EXECUTED_IMPLEMENTATION_ADAPTER' : 'NOT_EXECUTED', sources.verified, adapter, gaps);
}

/** External or hand-authored observations are always labelled MODEL_ONLY here. */
export function evaluateLifecycleModel(contract: LifecycleContract, trace: LifecycleTrace, observations: LifecycleObservation[]): LifecycleReport {
  return report(copy(contract), copy(trace), copy(observations), 'MODEL_ONLY', [], null, [...inputGaps(contract, trace), ...checkerGaps()]);
}
