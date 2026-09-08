import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { sha256, subjectId } from './util.js';
import { archiveCanonical as canonical, archiveRecordDigest, LOCAL_REVIEW_ARCHIVE_LIMITS, parseReviewArchive,
  serializeReviewArchive, type LocalReviewArchive, type ReviewArchiveProvenance, type ReviewArchiveRecord } from './local-review-archive.js';

export type LocalReviewDisposition = 'COUNTEREVIDENCE' | 'INVESTIGATE';
export type LocalReviewState = 'CURRENT' | 'STALE' | 'CANDIDATE_ABSENT';
type ObjectValue = Record<string, unknown>;

export interface LocalReviewInput {
  candidateId: string;
  expectedSnapshot: number;
  disposition: LocalReviewDisposition;
  reason: string;
  evidence: string;
  author: string;
  factIds?: string[];
}

export interface ReviewSource {
  id: string;
  component: string;
  fact: ObjectValue;
  ownerFile: ObjectValue | null;
  dependencyFingerprint: string;
  dependencyCount: number;
}

export interface ReviewCapture {
  candidate: ObjectValue;
  sources: ReviewSource[];
  contexts: Array<{ component: string; metadata: ObjectValue }>;
}

export interface LocalReview extends ReviewCapture {
  id: number;
  candidateId: string;
  snapshot: number;
  disposition: LocalReviewDisposition;
  reason: string;
  evidence: string;
  author: string;
  created: string;
  fingerprint: string;
  state: LocalReviewState;
  invalidation: { snapshot: number; reason: string } | null;
  authority: 'USER_REPORTED_LOCAL_ANNOTATION';
  freshness: 'AS_OF_SCAN';
  archive?: ReviewArchiveProvenance;
}

/** The caller migrates user_version and owns the surrounding transaction. */
export const LOCAL_REVIEW_SCHEMA = `
  CREATE TABLE IF NOT EXISTS local_reviews(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    candidateId TEXT NOT NULL,
    snapshot INTEGER NOT NULL,
    disposition TEXT NOT NULL CHECK(disposition IN ('COUNTEREVIDENCE','INVESTIGATE')),
    created TEXT NOT NULL,
    body TEXT NOT NULL,
    fingerprint TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS local_reviews_candidate ON local_reviews(candidateId,id DESC);
  CREATE INDEX IF NOT EXISTS local_reviews_effective ON local_reviews(candidateId,
    CASE WHEN json_type(body,'$.archive') IS NULL THEN 0 ELSE 1 END,id DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS local_reviews_archive_digest ON local_reviews(json_extract(body,'$.archive.recordDigest'))
    WHERE json_type(body,'$.archive')='object';
  CREATE TABLE IF NOT EXISTS local_review_invalidations(
    reviewId INTEGER PRIMARY KEY,
    snapshot INTEGER NOT NULL,
    reason TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS local_review_meta(
    id INTEGER PRIMARY KEY CHECK(id=1),
    revision INTEGER NOT NULL
  );
  INSERT OR IGNORE INTO local_review_meta VALUES(1,0);
  CREATE TRIGGER IF NOT EXISTS local_reviews_no_update BEFORE UPDATE ON local_reviews
    BEGIN SELECT RAISE(ABORT,'Local review history is append-only'); END;
  CREATE TRIGGER IF NOT EXISTS local_reviews_no_delete BEFORE DELETE ON local_reviews
    BEGIN SELECT RAISE(ABORT,'Local review history is append-only'); END;
  CREATE TRIGGER IF NOT EXISTS local_review_invalidations_no_update BEFORE UPDATE ON local_review_invalidations
    BEGIN SELECT RAISE(ABORT,'Local review invalidations are append-only'); END;
  CREATE TRIGGER IF NOT EXISTS local_review_invalidations_no_delete BEFORE DELETE ON local_review_invalidations
    BEGIN SELECT RAISE(ABORT,'Local review invalidations are append-only'); END;
  CREATE TRIGGER IF NOT EXISTS local_reviews_revision AFTER INSERT ON local_reviews
    BEGIN UPDATE local_review_meta SET revision=revision+1 WHERE id=1; END;
  CREATE TRIGGER IF NOT EXISTS local_review_invalidations_revision AFTER INSERT ON local_review_invalidations
    BEGIN UPDATE local_review_meta SET revision=revision+1 WHERE id=1; END;
  CREATE VIEW IF NOT EXISTS local_review_latest AS
    SELECT r.*,
      CASE WHEN o.id IS NULL OR o.resolved IS NOT NULL THEN 'CANDIDATE_ABSENT'
        WHEN i.reviewId IS NOT NULL THEN 'STALE' ELSE 'CURRENT' END AS state,
      i.snapshot AS invalidatedSnapshot, i.reason AS invalidationReason
    FROM local_reviews r
    LEFT JOIN local_review_invalidations i ON i.reviewId=r.id
    LEFT JOIN opportunities o ON o.id=r.candidateId
    WHERE r.id=(SELECT newest.id FROM local_reviews newest WHERE newest.candidateId=r.candidateId
      ORDER BY CASE WHEN json_type(newest.body,'$.archive') IS NULL THEN 0 ELSE 1 END,newest.id DESC LIMIT 1);
`;

export function initializeLocalReviewSchema(db: DatabaseSync): void {
  db.exec('DROP VIEW IF EXISTS local_review_latest;');
  db.exec(LOCAL_REVIEW_SCHEMA);
}

function boundedString(value: unknown, name: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || value.includes('\0'))
    throw new Error(`${name} must be a nonempty string of at most ${maximum} characters`);
  return value.trim();
}

function positiveInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new Error(`${name} must be a positive safe integer`);
  return value;
}

function objectBody(value: unknown): ObjectValue {
  const body: unknown = JSON.parse(String(value));
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid indexed object');
  return body as ObjectValue;
}

/**
 * Append-only, user-reported investigation notes. This store cannot approve a
 * requirement, establish behavior, resolve debt, or alter a source candidate.
 * It neither opens nor closes its DatabaseSync connection. Mutations require a
 * caller-owned transaction; reconcile must run before every scan commit.
 */
export class LocalReviewStore {
  constructor(private readonly db: DatabaseSync) {}

  revision(): number {
    return Number(this.db.prepare('SELECT revision FROM local_review_meta WHERE id=1').get()!.revision);
  }

  private snapshot(): number {
    return Number(this.db.prepare('SELECT coalesce(max(id),0) AS id FROM snapshots').get()!.id);
  }

  private requireTransaction(): void {
    if (!this.db.isTransaction) throw new Error('Local review mutations require a caller-owned transaction');
  }

  private validate(input: unknown): LocalReviewInput {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Review must be an object');
    const value = input as ObjectValue;
    const allowed = new Set(['candidateId', 'expectedSnapshot', 'disposition', 'reason', 'evidence', 'author', 'factIds']);
    if (Object.keys(value).some(key => !allowed.has(key))) throw new Error('Unknown review field');
    if (typeof value.disposition !== 'string' || !['COUNTEREVIDENCE', 'INVESTIGATE'].includes(value.disposition))
      throw new Error('Unknown review disposition');
    if (value.factIds !== undefined && (!Array.isArray(value.factIds) || value.factIds.length > 32))
      throw new Error('factIds must be an array of at most 32 source IDs');
    return {
      candidateId: boundedString(value.candidateId, 'candidateId', 200),
      expectedSnapshot: positiveInteger(value.expectedSnapshot, 'expectedSnapshot'),
      disposition: value.disposition as LocalReviewDisposition,
      reason: boundedString(value.reason, 'reason', 2000),
      evidence: boundedString(value.evidence, 'evidence', 8000),
      author: boundedString(value.author, 'author', 200),
      factIds: [...new Set((value.factIds as unknown[] | undefined ?? [])
        .map(id => boundedString(id, 'factIds entry', 200)))],
    };
  }

  /** Stable digest of all direct imports/importers, read in bounded pages. */
  private dependencies(fileId: string): { fingerprint: string; count: number } {
    const hash = createHash('sha256');
    const query = this.db.prepare(`SELECT links.direction,links.id,f.component,f.body FROM (
      SELECT 'outgoing' AS direction,target AS id FROM edges WHERE source=?
      UNION SELECT 'incoming' AS direction,source AS id FROM edges WHERE target=?
    ) links LEFT JOIN facts f ON f.id=links.id
    WHERE links.direction>? OR (links.direction=? AND links.id>?)
    ORDER BY links.direction,links.id LIMIT 200`);
    let afterDirection = '', afterId = '', count = 0;
    while (true) {
      const rows = query.all(fileId, fileId, afterDirection, afterDirection, afterId);
      for (const row of rows) {
        hash.update(canonical({ direction: row.direction, id: row.id, component: row.component,
          fact: row.body === null ? null : objectBody(row.body) }) + '\n');
        count++;
      }
      if (rows.length < 200) break;
      afterDirection = String(rows.at(-1)!.direction);
      afterId = String(rows.at(-1)!.id);
    }
    return { fingerprint: hash.digest('hex'), count };
  }

  private capture(candidateId: string, factIds: string[], dependenciesByFile = new Map<string, { fingerprint: string; count: number }>()): ReviewCapture {
    const candidateRow = this.db.prepare('SELECT component,body FROM opportunities WHERE id=? AND resolved IS NULL').get(candidateId);
    if (!candidateRow) throw new Error('Candidate is absent from the current snapshot');
    const candidate = objectBody(candidateRow.body);
    const primaryId = boundedString(candidate.subjectId, 'Candidate primary source ID', 200);
    const ids = [...new Set([primaryId, ...factIds])].sort();
    const sources: ReviewSource[] = [];
    const contexts = new Map<string, ObjectValue>();
    for (const id of ids) {
      const row = this.db.prepare('SELECT component,body FROM facts WHERE id=?').get(id);
      if (!row) throw new Error(`Cited source is absent: ${id}`);
      const fact = objectBody(row.body);
      const component = String(row.component);
      const fileId = subjectId(component, `${String(fact.path)}#file`);
      const fileRow = this.db.prepare('SELECT body FROM facts WHERE id=?').get(fileId);
      let dependencies = dependenciesByFile.get(fileId);
      if (!dependencies) {
        dependencies = this.dependencies(fileId);
        if (dependenciesByFile.size >= 1024) dependenciesByFile.delete(dependenciesByFile.keys().next().value!);
        dependenciesByFile.set(fileId, dependencies);
      }
      sources.push({ id, component, fact, ownerFile: fileRow ? objectBody(fileRow.body) : null,
        dependencyFingerprint: dependencies.fingerprint, dependencyCount: dependencies.count });
      if (!contexts.has(component)) {
        const metadataRow = this.db.prepare('SELECT body FROM components WHERE id=?').get(component);
        if (!metadataRow) throw new Error(`Cited source component is absent: ${component}`);
        const { factCount: _facts, findingCount: _findings, ...metadata } = objectBody(metadataRow.body);
        contexts.set(component, metadata);
      }
    }
    return { candidate, sources, contexts: [...contexts].sort(([a], [b]) => a.localeCompare(b))
      .map(([component, metadata]) => ({ component, metadata })) };
  }

  append(input: unknown): LocalReview {
    this.requireTransaction();
    const value = this.validate(input);
    if (value.expectedSnapshot !== this.snapshot()) throw new Error('Index snapshot changed; inspect the candidate again before reviewing');
    const capture = this.capture(value.candidateId, value.factIds ?? []);
    const created = new Date().toISOString();
    const fingerprint = sha256(canonical(capture));
    const body = { ...capture, reason: value.reason, evidence: value.evidence, author: value.author,
      authority: 'USER_REPORTED_LOCAL_ANNOTATION', freshness: 'AS_OF_SCAN' };
    const result = this.db.prepare(`INSERT INTO local_reviews(candidateId,snapshot,disposition,created,body,fingerprint)
      VALUES(?,?,?,?,?,?)`).run(value.candidateId, value.expectedSnapshot, value.disposition, created, JSON.stringify(body), fingerprint);
    return this.decode(this.db.prepare('SELECT * FROM local_reviews WHERE id=?').get(result.lastInsertRowid)!);
  }

  private decode(row: Record<string, unknown>): LocalReview {
    const body = objectBody(row.body) as unknown as ReviewCapture & Pick<LocalReview, 'reason' | 'evidence' | 'author'>;
    const candidateId = String(row.candidateId);
    const invalidated = this.db.prepare('SELECT snapshot,reason FROM local_review_invalidations WHERE reviewId=?').get(Number(row.id));
    const candidate = this.db.prepare('SELECT resolved FROM opportunities WHERE id=?').get(candidateId);
    let state: LocalReviewState = !candidate || candidate.resolved !== null ? 'CANDIDATE_ABSENT' : invalidated ? 'STALE' : 'CURRENT';
    return { ...body, id: Number(row.id), candidateId, snapshot: Number(row.snapshot),
      disposition: String(row.disposition) as LocalReviewDisposition, created: String(row.created),
      fingerprint: String(row.fingerprint), state,
      invalidation: invalidated ? { snapshot: Number(invalidated.snapshot), reason: String(invalidated.reason) } : null,
      authority: 'USER_REPORTED_LOCAL_ANNOTATION', freshness: 'AS_OF_SCAN' };
  }

  latest(candidateId: string): LocalReview | null {
    candidateId = boundedString(candidateId, 'candidateId', 200);
    const row = this.db.prepare(`SELECT * FROM local_reviews WHERE candidateId=?
      ORDER BY CASE WHEN json_type(body,'$.archive') IS NULL THEN 0 ELSE 1 END,id DESC LIMIT 1`).get(candidateId);
    return row ? this.decode(row) : null;
  }

  latestCurrent(candidateId: string): LocalReview | null {
    const review = this.latest(candidateId);
    return review?.state === 'CURRENT' ? review : null;
  }

  list(candidateId: string, count = 20, afterId?: number): { items: LocalReview[]; hasMore: boolean; next: number | null } {
    candidateId = boundedString(candidateId, 'candidateId', 200);
    if (!Number.isSafeInteger(count) || count < 1 || count > 200) throw new Error('limit must be 1..200');
    if (afterId !== undefined) positiveInteger(afterId, 'afterId');
    const rows = this.db.prepare('SELECT * FROM local_reviews WHERE candidateId=? AND id<? ORDER BY id DESC LIMIT ?')
      .all(candidateId, afterId ?? Number.MAX_SAFE_INTEGER, count + 1);
    const items = rows.slice(0, count).map(row => this.decode(row));
    return { items, hasMore: rows.length > count, next: rows.length > count ? items.at(-1)!.id : null };
  }

  private workspace(): string | null {
    const value = this.db.prepare("SELECT value FROM meta WHERE key='workspace'").get()?.value;
    return value === undefined ? null : String(value);
  }

  private archiveRecord(row: Record<string, unknown>, workspace: string | null): ReviewArchiveRecord {
    const review = this.decode(row);
    const { candidateId, snapshot, disposition, reason, evidence, author, created, fingerprint,
      invalidation, candidate, sources, contexts } = review;
    return { origin: review.archive?.origin ?? { workspace, reviewId: review.id },
      note: { candidateId, snapshot, disposition, reason, evidence, author, created, fingerprint,
        invalidation: review.archive ? review.archive.originalInvalidation : invalidation, candidate, sources, contexts } };
  }

  /** All distinct originating records, including absent candidates; caller pins a read transaction. */
  exportArchive(): string {
    this.requireTransaction();
    const workspace = this.workspace();
    const records: LocalReviewArchive['records'] = [];
    const seen = new Set<string>();
    let bytes = 0;
    // SQLite iterates all rows in the pinned snapshot; history is never a list-page prefix.
    for (const row of this.db.prepare('SELECT * FROM local_reviews ORDER BY id').iterate()) {
      const record = this.archiveRecord(row, workspace);
      const digest = archiveRecordDigest(record);
      // A local invalidation can later converge with an imported version of its
      // originating note. Preserve both audit rows while exporting that record once.
      if (seen.has(digest)) continue;
      if (records.length >= LOCAL_REVIEW_ARCHIVE_LIMITS.records)
        throw new Error(`Review archive exceeds ${LOCAL_REVIEW_ARCHIVE_LIMITS.records} records; preserve a SQLite-consistent backup`);
      seen.add(digest);
      const entry = { sequence: records.length + 1, digest, record };
      bytes += Buffer.byteLength(canonical(entry), 'utf8') + 1;
      if (bytes > LOCAL_REVIEW_ARCHIVE_LIMITS.bytes)
        throw new Error(`Review archive exceeds ${LOCAL_REVIEW_ARCHIVE_LIMITS.bytes} bytes; preserve a SQLite-consistent backup`);
      records.push(entry);
    }
    return serializeReviewArchive({ format: 'ASSURANCE_MEMORY_LOCAL_REVIEWS', version: 1,
      authority: 'USER_REPORTED_LOCAL_ANNOTATION', exportedAt: new Date().toISOString(),
      source: { workspace, snapshot: this.snapshot(), reviewRevision: this.revision() }, records });
  }

  /** Restore annotations only, preserving original captures and permanently requiring local re-review. */
  importArchive(input: string | Uint8Array): { imported: number; skipped: number; total: number; reviewRevision: number; digest: string } {
    this.requireTransaction();
    const archive = parseReviewArchive(input);
    const workspace = this.workspace(), snapshot = this.snapshot(), restoredAt = new Date().toISOString();
    const existingImport = this.db.prepare(`SELECT id FROM local_reviews
      WHERE json_type(body,'$.archive')='object' AND json_extract(body,'$.archive.recordDigest')=?`);
    const original = this.db.prepare("SELECT * FROM local_reviews WHERE id=? AND json_type(body,'$.archive') IS NULL");
    const insert = this.db.prepare(`INSERT INTO local_reviews(candidateId,snapshot,disposition,created,body,fingerprint)
      VALUES(?,?,?,?,?,?)`);
    const invalidate = this.db.prepare('INSERT INTO local_review_invalidations(reviewId,snapshot,reason) VALUES(?,?,?)');
    let imported = 0, skipped = 0;
    this.db.exec('SAVEPOINT review_archive_import');
    try {
      for (const entry of archive.records) {
        const origin = entry.record.origin;
        const local = origin.workspace === workspace ? original.get(origin.reviewId) : undefined;
        if (existingImport.get(entry.digest) || (local && archiveRecordDigest(this.archiveRecord(local, workspace)) === entry.digest)) {
          skipped++;
          continue;
        }
        const note = entry.record.note;
        const provenance: ReviewArchiveProvenance = { recordDigest: entry.digest, origin,
          originalInvalidation: note.invalidation,
          archiveDigest: archive.digest, restoredAt, targetSnapshot: snapshot };
        const body = { candidate: note.candidate, sources: note.sources, contexts: note.contexts,
          reason: note.reason, evidence: note.evidence, author: note.author,
          authority: 'USER_REPORTED_LOCAL_ANNOTATION', freshness: 'AS_OF_SCAN', archive: provenance };
        const result = insert.run(note.candidateId, note.snapshot, note.disposition, note.created, JSON.stringify(body), note.fingerprint);
        // The destination snapshot can be zero when recovering before the first source scan.
        invalidate.run(result.lastInsertRowid, snapshot, 'ARCHIVE_RESTORE_REQUIRES_REVIEW');
        imported++;
      }
      this.db.exec('RELEASE review_archive_import');
    } catch (error) {
      this.db.exec('ROLLBACK TO review_archive_import; RELEASE review_archive_import;');
      throw error;
    }
    return { imported, skipped, total: archive.records.length, reviewRevision: this.revision(), digest: archive.digest };
  }

  /** Permanently invalidates old captures within the atomic scan transaction. */
  reconcile(snapshot: number): number {
    this.requireTransaction();
    positiveInteger(snapshot, 'snapshot');
    if (snapshot !== this.snapshot()) throw new Error('Index snapshot changed during review reconciliation');
    const query = this.db.prepare(`SELECT r.* FROM local_reviews r
      WHERE r.id>? AND NOT EXISTS(SELECT 1 FROM local_review_invalidations i WHERE i.reviewId=r.id)
      ORDER BY r.id LIMIT 200`);
    const invalidate = this.db.prepare('INSERT INTO local_review_invalidations(reviewId,snapshot,reason) VALUES(?,?,?)');
    let after = 0, count = 0;
    const dependenciesByFile = new Map<string, { fingerprint: string; count: number }>();
    const fingerprints = new Map<string, string | null>();
    while (true) {
      const rows = query.all(after);
      for (const row of rows) {
        const review = this.decode(row);
        if (review.state === 'CURRENT') {
          const ids = review.sources.map(source => source.id).sort();
          const key = JSON.stringify([review.candidateId, ids]);
          if (!fingerprints.has(key)) {
            if (fingerprints.size >= 1024) fingerprints.delete(fingerprints.keys().next().value!);
            try { fingerprints.set(key, sha256(canonical(this.capture(review.candidateId, ids, dependenciesByFile)))); }
            catch { fingerprints.set(key, null); }
          }
          if (fingerprints.get(key) !== review.fingerprint) review.state = 'STALE';
        }
        if (review.state !== 'CURRENT') {
          invalidate.run(review.id, snapshot, review.state === 'CANDIDATE_ABSENT' ? 'CANDIDATE_ABSENT' : 'SOURCE_OR_CONTEXT_CHANGED');
          count++;
        }
      }
      if (rows.length < 200) break;
      after = Number(rows.at(-1)!.id);
    }
    return count;
  }
}
