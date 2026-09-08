import { sha256 } from './util.js';
import type { LocalReview, ReviewCapture } from './local-review.js';

/** Complete archives are bounded; exceeding either limit fails without exporting a prefix. */
export const LOCAL_REVIEW_ARCHIVE_LIMITS = Object.freeze({ bytes: 16 * 1024 * 1024, records: 10_000 });
type ObjectValue = Record<string, unknown>;
type ArchivedNote = Pick<LocalReview, 'candidateId' | 'snapshot' | 'disposition' | 'reason' | 'evidence' |
  'author' | 'created' | 'fingerprint' | 'invalidation'> & ReviewCapture;

export interface ReviewArchiveRecord {
  origin: { workspace: string | null; reviewId: number };
  note: ArchivedNote;
}

export interface ReviewArchiveProvenance {
  recordDigest: string;
  origin: ReviewArchiveRecord['origin'];
  originalInvalidation: ArchivedNote['invalidation'];
  archiveDigest: string;
  restoredAt: string;
  targetSnapshot: number;
}

export interface LocalReviewArchive {
  format: 'ASSURANCE_MEMORY_LOCAL_REVIEWS';
  version: 1;
  authority: 'USER_REPORTED_LOCAL_ANNOTATION';
  exportedAt: string;
  source: { workspace: string | null; snapshot: number; reviewRevision: number };
  records: Array<{ sequence: number; digest: string; record: ReviewArchiveRecord }>;
  digest: string;
}

/** Canonical JSON preserves array order and has one spelling for object field order. */
export function archiveCanonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(archiveCanonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as ObjectValue;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${archiveCanonical(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function archiveRecordDigest(record: ReviewArchiveRecord): string { return sha256(archiveCanonical(record)); }

function object(value: unknown, label: string): ObjectValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid archive ${label}`);
  return value as ObjectValue;
}

function fields(value: unknown, keys: string[], label: string): ObjectValue {
  const record = object(value, label);
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== keys.length || actual.some((key, i) => key !== expected[i]))
    throw new Error(`Invalid archive ${label} fields`);
  return record;
}

function string(value: unknown, label: string, maximum: number): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || value.length > maximum)
    throw new Error(`Invalid archive ${label}`);
}

function integer(value: unknown, label: string, minimum = 0): asserts value is number {
  if (!Number.isSafeInteger(value) || typeof value !== 'number' || value < minimum)
    throw new Error(`Invalid archive ${label}`);
}

function digest(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) throw new Error(`Invalid archive ${label} digest`);
}

function timestamp(value: unknown, label: string): void {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value)
    throw new Error(`Invalid archive ${label} timestamp`);
}

function workspace(value: unknown): void { if (value !== null) string(value, 'workspace', 1000); }

/** Bound parser recursion/work independently of the byte and record limits. */
function boundedTree(value: unknown): void {
  const pending = [{ value, depth: 0 }];
  let nodes = 0;
  while (pending.length) {
    const item = pending.pop()!;
    if (++nodes > 500_000 || item.depth > 32) throw new Error('Archive structure exceeds limits');
    if (typeof item.value === 'number' && !Number.isFinite(item.value)) throw new Error('Invalid archive number');
    if (typeof item.value === 'string' && (item.value.length > 1024 * 1024 || item.value.includes('\0')))
      throw new Error('Archive string exceeds limits or contains NUL');
    if (item.value !== null && typeof item.value === 'object') {
      const values = Array.isArray(item.value) ? item.value : Object.values(item.value);
      if (values.length > LOCAL_REVIEW_ARCHIVE_LIMITS.records) throw new Error('Archive collection exceeds limits');
      for (const child of values) pending.push({ value: child, depth: item.depth + 1 });
    }
  }
}

function validateRecord(value: unknown): void {
  const record = fields(value, ['origin', 'note'], 'record');
  const origin = fields(record.origin, ['workspace', 'reviewId'], 'origin');
  workspace(origin.workspace);
  integer(origin.reviewId, 'origin reviewId', 1);
  const note = fields(record.note, ['candidateId', 'snapshot', 'disposition', 'reason', 'evidence', 'author',
    'created', 'fingerprint', 'invalidation', 'candidate', 'sources', 'contexts'], 'note');
  string(note.candidateId, 'candidateId', 200);
  integer(note.snapshot, 'snapshot', 1);
  if (!['COUNTEREVIDENCE', 'INVESTIGATE'].includes(String(note.disposition))) throw new Error('Invalid archive disposition');
  string(note.reason, 'reason', 2000);
  string(note.evidence, 'evidence', 8000);
  string(note.author, 'author', 200);
  timestamp(note.created, 'created');
  digest(note.fingerprint, 'capture');
  if (note.invalidation !== null) {
    const invalidation = fields(note.invalidation, ['snapshot', 'reason'], 'invalidation');
    integer(invalidation.snapshot, 'invalidation snapshot', note.snapshot);
    string(invalidation.reason, 'invalidation reason', 2000);
  }
  const candidate = object(note.candidate, 'candidate');
  if (candidate.id !== note.candidateId) throw new Error('Archive candidate identity mismatch');
  string(candidate.subjectId, 'candidate source ID', 200);
  if (!Array.isArray(note.sources) || note.sources.length < 1 || note.sources.length > 33)
    throw new Error('Archive requires 1..33 captured sources');
  const sourceIds = new Set<string>(), components = new Set<string>();
  for (const value of note.sources) {
    const source = fields(value, ['id', 'component', 'fact', 'ownerFile', 'dependencyFingerprint', 'dependencyCount'], 'source');
    string(source.id, 'source ID', 200);
    string(source.component, 'source component', 200);
    const fact = object(source.fact, 'source fact');
    if (fact.id !== source.id || sourceIds.has(source.id)) throw new Error('Archive source identity mismatch or duplicate');
    sourceIds.add(source.id);
    components.add(source.component);
    if (source.ownerFile !== null) object(source.ownerFile, 'owner file');
    digest(source.dependencyFingerprint, 'dependency');
    integer(source.dependencyCount, 'dependency count');
  }
  if (!sourceIds.has(candidate.subjectId)) throw new Error('Archive is missing the primary source capture');
  if (!Array.isArray(note.contexts) || note.contexts.length !== components.size)
    throw new Error('Archive context coverage mismatch');
  for (const value of note.contexts) {
    const context = fields(value, ['component', 'metadata'], 'context');
    string(context.component, 'context component', 200);
    object(context.metadata, 'context metadata');
    if (!components.delete(context.component)) throw new Error('Archive context identity mismatch or duplicate');
  }
  if (note.fingerprint !== sha256(archiveCanonical({ candidate: note.candidate, sources: note.sources, contexts: note.contexts })))
    throw new Error('Archive capture digest mismatch');
}

export function serializeReviewArchive(payload: Omit<LocalReviewArchive, 'digest'>): string {
  const result = archiveCanonical({ ...payload, digest: sha256(archiveCanonical(payload)) }) + '\n';
  if (Buffer.byteLength(result, 'utf8') > LOCAL_REVIEW_ARCHIVE_LIMITS.bytes)
    throw new Error(`Review archive exceeds ${LOCAL_REVIEW_ARCHIVE_LIMITS.bytes} bytes; preserve a SQLite-consistent backup`);
  // Exports must satisfy precisely the same structural contract as imports.
  parseReviewArchive(result);
  return result;
}

/** A digest detects corruption; it does not authenticate the claimed author or provenance. */
export function parseReviewArchive(input: string | Uint8Array): LocalReviewArchive {
  if ((typeof input !== 'string' && !(input instanceof Uint8Array)) ||
    (typeof input === 'string' ? Buffer.byteLength(input, 'utf8') : input.byteLength) > LOCAL_REVIEW_ARCHIVE_LIMITS.bytes)
    throw new Error(`Review archive must be at most ${LOCAL_REVIEW_ARCHIVE_LIMITS.bytes} bytes`);
  const text = typeof input === 'string' ? input : new TextDecoder('utf-8', { fatal: true }).decode(input);
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('Invalid review archive JSON'); }
  boundedTree(parsed);
  const envelope = fields(parsed, ['format', 'version', 'authority', 'exportedAt', 'source', 'records', 'digest'], 'envelope');
  if (envelope.format !== 'ASSURANCE_MEMORY_LOCAL_REVIEWS' || envelope.version !== 1 ||
    envelope.authority !== 'USER_REPORTED_LOCAL_ANNOTATION') throw new Error('Unsupported review archive format, version or authority');
  timestamp(envelope.exportedAt, 'exportedAt');
  const source = fields(envelope.source, ['workspace', 'snapshot', 'reviewRevision'], 'source provenance');
  workspace(source.workspace);
  integer(source.snapshot, 'source snapshot');
  integer(source.reviewRevision, 'source review revision');
  if (!Array.isArray(envelope.records) || envelope.records.length > LOCAL_REVIEW_ARCHIVE_LIMITS.records)
    throw new Error(`Review archive must contain at most ${LOCAL_REVIEW_ARCHIVE_LIMITS.records} records`);
  digest(envelope.digest, 'integrity');
  const { digest: expected, ...payload } = envelope;
  if (sha256(archiveCanonical(payload)) !== expected) throw new Error('Review archive integrity digest mismatch');
  const canonical = archiveCanonical(envelope);
  if (text !== canonical && text !== canonical + '\n') throw new Error('Review archive must use canonical JSON field ordering and encoding');
  const seen = new Set<string>();
  for (const [index, value] of envelope.records.entries()) {
    const entry = fields(value, ['sequence', 'digest', 'record'], 'entry');
    if (entry.sequence !== index + 1) throw new Error('Archive record order is invalid');
    digest(entry.digest, 'record');
    if (seen.has(entry.digest)) throw new Error('Duplicate archive record');
    seen.add(entry.digest);
    validateRecord(entry.record);
    if (archiveRecordDigest(entry.record as ReviewArchiveRecord) !== entry.digest) throw new Error('Archive record digest mismatch');
  }
  return envelope as unknown as LocalReviewArchive;
}
