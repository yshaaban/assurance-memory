import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { AnalysisResult, Fact } from './types.js';
import { driftFields, opportunities } from './investigation.js';
import { searchFacts, searchText, relatedSymbols } from './local-search.js';
import { LocalReviewStore, initializeLocalReviewSchema } from './local-review.js';
import { sha256, subjectId } from './util.js';

type Scan = AnalysisResult & { sourceRevision: string; configurationDigest: string; environment: Record<string, string> };
type Row = Record<string, any>;
// Selection and presentation share this effective priority in both context and backlog.
const rankedCandidates = `SELECT o.*, CASE WHEN r.state='CURRENT' AND r.disposition='COUNTEREVIDENCE' THEN o.score-20 ELSE o.score END AS effectiveScore
  FROM opportunities o LEFT JOIN local_review_latest r ON r.candidateId=o.id`;
const decode = (rows: Row[]): Row[] => rows.map(({ body, ...row }) => ({ ...row, ...(body ? JSON.parse(String(body)) : {}) }));
const candidatePolicyDigest = sha256(readFileSync(new URL('./investigation.js', import.meta.url)));
const searchPolicyDigest = sha256(readFileSync(new URL('./local-search.js', import.meta.url)));
function limit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 200) throw new Error('limit must be 1..200');
  return value;
}

/** One local source projection and retained annotation store per workspace. The remote kernel remains the authority. */
export class LocalIndex {
  private readonly db: DatabaseSync;
  private active: number | undefined;
  private migrationPending = false;
  private readonly reviews: LocalReviewStore;
  constructor(path: string, readOnly = false, migrateWithScan = false) {
    if (path !== ':memory:' && !readOnly) mkdirSync(dirname(resolve(path)), { recursive: true });
    this.db = new DatabaseSync(path, { readOnly });
    if (!this.db.prepare("SELECT sqlite_compileoption_used('ENABLE_FTS5') AS enabled").get()!.enabled) {
      this.db.close();
      throw new Error('Local investigation requires SQLite FTS5; use the official Node 24.16+ build');
    }
    this.db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
    const version = Number(this.db.prepare('PRAGMA user_version').get()!.user_version);
    if (version > 4) { this.db.close(); throw new Error('Index schema is newer than this tool; use a compatible version'); }
    if (version < 4 && readOnly) { this.db.close(); throw new Error('Index needs initialization or schema migration; run scan with this tool first'); }
    if (version === 0) this.db.exec(`
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS snapshots(id INTEGER PRIMARY KEY, created TEXT NOT NULL, config TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS components(id TEXT PRIMARY KEY, snapshot INTEGER NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS facts(id TEXT PRIMARY KEY, component TEXT NOT NULL, path TEXT NOT NULL, body TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS facts_component ON facts(component, id);
      CREATE INDEX IF NOT EXISTS facts_path ON facts(component, path);
      CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(id UNINDEXED, text, tokenize='unicode61');
      CREATE TABLE IF NOT EXISTS edges(source TEXT NOT NULL, target TEXT NOT NULL, PRIMARY KEY(source,target));
      CREATE INDEX IF NOT EXISTS edges_target ON edges(target,source);
      CREATE TABLE IF NOT EXISTS opportunities(id TEXT PRIMARY KEY, component TEXT NOT NULL, score INTEGER NOT NULL,
        firstSeen INTEGER NOT NULL, lastSeen INTEGER NOT NULL, resolved INTEGER, body TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS opportunities_priority ON opportunities(resolved,score DESC,id);
      CREATE INDEX IF NOT EXISTS opportunities_component ON opportunities(component);
      CREATE TABLE IF NOT EXISTS drift(id INTEGER PRIMARY KEY, snapshot INTEGER NOT NULL, component TEXT NOT NULL,
        subject TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS drift_snapshot ON drift(snapshot,id);
      PRAGMA user_version=1;
    `);
    if (version < 4) {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        initializeLocalReviewSchema(this.db);
        this.db.exec(`CREATE INDEX IF NOT EXISTS facts_symbol_lookup ON facts(lower(substr(json_extract(body,'$.locator'),instr(json_extract(body,'$.locator'),'#')+1)));
          CREATE INDEX IF NOT EXISTS opportunities_subject ON opportunities(component,json_extract(body,'$.subjectId'),resolved,score DESC,id);`);
        this.rebuildSearch();
        this.db.exec('PRAGMA user_version=4');
        if (migrateWithScan) this.migrationPending = true; else this.db.exec('COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); this.db.close(); throw error; }
    }
    if (!readOnly) this.db.exec(`CREATE INDEX IF NOT EXISTS facts_symbol_lookup ON facts(lower(substr(json_extract(body,'$.locator'),instr(json_extract(body,'$.locator'),'#')+1)));
      CREATE INDEX IF NOT EXISTS opportunities_subject ON opportunities(component,json_extract(body,'$.subjectId'),resolved,score DESC,id);`);
    const storedPolicy = this.db.prepare("SELECT value FROM meta WHERE key='searchPolicyDigest'").get()?.value;
    if (storedPolicy !== searchPolicyDigest) {
      if (readOnly) { this.db.close(); throw new Error('Search policy changed; run scan with this tool before querying'); }
      if (!this.migrationPending) this.db.exec('BEGIN IMMEDIATE');
      try {
        this.rebuildSearch();
        if (migrateWithScan) this.migrationPending = true; else this.db.exec('COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); this.migrationPending = false; this.db.close(); throw error; }
    }
    this.reviews = new LocalReviewStore(this.db);
  }
  private rebuildSearch(): void {
    this.db.exec('DELETE FROM search');
    const insert = this.db.prepare('INSERT INTO search(rowid,id,text) VALUES(?,?,?)');
    for (const row of this.db.prepare('SELECT rowid,id,body FROM facts').iterate())
      insert.run(Number(row.rowid), String(row.id), searchText(JSON.parse(String(row.body)) as Fact));
    this.db.prepare("INSERT INTO meta(key,value) VALUES('searchPolicyDigest',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(searchPolicyDigest);
  }
  close(): void { if (this.active !== undefined || this.migrationPending) this.rollback(); this.db.close(); }
  begin(workspace: string, config: unknown): number {
    if (this.active !== undefined) throw new Error('An index scan is already active');
    if (!this.migrationPending) this.db.exec('BEGIN IMMEDIATE');
    try {
      const previous = this.db.prepare("SELECT value FROM meta WHERE key='workspace'").get();
      if (previous && previous.value !== workspace) throw new Error('Database belongs to a different workspace');
      this.db.prepare("INSERT OR IGNORE INTO meta VALUES('workspace',?)").run(workspace);
      const r = this.db.prepare('INSERT INTO snapshots(created,config) VALUES(?,?)').run(new Date().toISOString(), JSON.stringify(config));
      this.active = Number(r.lastInsertRowid);
      return this.active;
    } catch (error) { this.db.exec('ROLLBACK'); this.migrationPending = false; throw error; }
  }
  rollback(): void { this.db.exec('ROLLBACK'); this.active = undefined; this.migrationPending = false; }
  private record(component: string, subject: string, kind: string, body: unknown): void {
    this.db.prepare('INSERT INTO drift(snapshot,component,subject,kind,body) VALUES(?,?,?,?,?)')
      .run(this.active!, component, subject, kind, JSON.stringify(body));
  }
  ingest(component: string, root: string, scan: Scan): { added: number; changed: number; removed: number; unchanged: number } {
    if (this.active === undefined) throw new Error('Begin a scan before ingestion');
    if (scan.coverage.discovery !== 'COMPLETE') throw new Error(`Incomplete discovery for ${component}; previous snapshot retained`);
    const incoming = new Map(scan.facts.map(f => [f.id, f]));
    if (incoming.size !== scan.facts.length) throw new Error('Duplicate subject identity');
    const candidates = opportunities(scan); // Validate before mutation.
    const existingComponent = this.db.prepare('SELECT body FROM components WHERE id=?').get(component);
    const beforeComponent = existingComponent ? JSON.parse(String(existingComponent.body)) : undefined;
    if (beforeComponent && beforeComponent.root !== root) throw new Error(`Component root changed for ${component}; use a new component ID or index`);
    const { facts: _facts, findings: _findings, ...metadata } = scan;
    const body = { ...metadata, root, candidatePolicyDigest, factCount: scan.facts.length, findingCount: candidates.length };
    if (beforeComponent && (beforeComponent.candidatePolicyDigest !== candidatePolicyDigest || beforeComponent.configurationDigest !== scan.configurationDigest ||
      JSON.stringify(beforeComponent.environment) !== JSON.stringify(scan.environment) || beforeComponent.analyzer !== scan.analyzer ||
      JSON.stringify(beforeComponent.coverage) !== JSON.stringify(scan.coverage)))
      this.record(component, component, 'CONTEXT_CHANGED', { before: beforeComponent, after: body });
    const old = new Map(this.db.prepare('SELECT id,body FROM facts WHERE component=?').all(component)
      .map(row => [String(row.id), JSON.parse(String(row.body)) as Fact]));
    const counts = { added: 0, changed: 0, removed: 0, unchanged: 0 };
    const upsert = this.db.prepare(`INSERT INTO facts VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET path=excluded.path,body=excluded.body`);
    const deleteSearch = this.db.prepare('DELETE FROM search WHERE rowid=(SELECT rowid FROM facts WHERE id=?)');
    const addSearch = this.db.prepare('INSERT INTO search(rowid,id,text) VALUES((SELECT rowid FROM facts WHERE id=?),?,?)');
    const deleteEdges = this.db.prepare('DELETE FROM edges WHERE source=?');
    const addEdge = this.db.prepare('INSERT OR IGNORE INTO edges VALUES(?,?)');
    for (const fact of scan.facts) {
      if (fact.id !== subjectId(component, fact.locator)) throw new Error('Subject identity does not match component and locator');
      const previous = old.get(fact.id);
      const fields = previous ? driftFields(previous, fact) : [];
      if (!previous || fields.length) {
        counts[previous ? 'changed' : 'added']++;
        this.record(component, fact.id, previous ? 'CHANGED' : 'ADDED', { path: fact.path, line: fact.line, fields,
          before: previous ?? null, after: fact });
      } else counts.unchanged++;
      if (!previous || JSON.stringify(previous) !== JSON.stringify(fact)) {
        upsert.run(fact.id, component, fact.path, JSON.stringify(fact));
        deleteSearch.run(fact.id);
        addSearch.run(fact.id, fact.id, searchText(fact));
        deleteEdges.run(fact.id);
        for (const effect of fact.effects) if (effect.startsWith('IMPORT:'))
          addEdge.run(fact.id, subjectId(component, `${effect.slice(7)}#file`));
      }
      old.delete(fact.id);
    }
    for (const fact of old.values()) {
      counts.removed++;
      this.record(component, fact.id, 'REMOVED', { path: fact.path, line: fact.line, before: fact, after: null });
      deleteSearch.run(fact.id); deleteEdges.run(fact.id);
      this.db.prepare('DELETE FROM facts WHERE id=?').run(fact.id);
    }
    this.db.prepare('UPDATE opportunities SET resolved=? WHERE component=? AND resolved IS NULL').run(this.active, component);
    const saveOpportunity = this.db.prepare(`INSERT INTO opportunities VALUES(?,?,?,?,?,NULL,?) ON CONFLICT(id)
      DO UPDATE SET score=excluded.score,lastSeen=excluded.lastSeen,resolved=NULL,body=excluded.body`);
    for (const candidate of candidates) saveOpportunity.run(candidate.id, component, candidate.score, this.active, this.active, JSON.stringify(candidate));
    this.db.prepare('INSERT INTO components VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET snapshot=excluded.snapshot,body=excluded.body')
      .run(component, this.active, JSON.stringify(body));
    return counts;
  }
  commit(components: string[]): number {
    if (this.active === undefined) throw new Error('No active scan');
    for (const row of this.db.prepare('SELECT id,snapshot FROM components').all()) {
      if (!components.includes(String(row.id)) || row.snapshot !== this.active)
        throw new Error('Every indexed component must be scanned; use a new index for a different workspace inventory');
    }
    const snapshot = this.active;
    this.reviews.reconcile(snapshot);
    this.db.exec('COMMIT'); this.active = undefined; this.migrationPending = false;
    return snapshot;
  }
  summary(): Row {
    const components = decode(this.db.prepare('SELECT * FROM components ORDER BY id LIMIT 201').all());
    return { workspace: this.db.prepare("SELECT value FROM meta WHERE key='workspace'").get()?.value ?? null,
      snapshot: this.db.prepare('SELECT max(id) AS id FROM snapshots').get()!.id,
      facts: this.db.prepare('SELECT count(*) AS n FROM facts').get()!.n,
      opportunities: this.db.prepare('SELECT count(*) AS n FROM opportunities WHERE resolved IS NULL').get()!.n,
      components: components.slice(0, 200), componentsTruncated: components.length > 200,
      reviewRevision: this.reviews.revision(), schemaVersion: 4, searchPolicyDigest,
      authority: 'LOCAL_INVESTIGATION_ONLY', freshness: 'AS_OF_SCAN; rescan before editing or relying on absence',
      history: 'This database retains user review records as well as rebuildable source facts. Preserve a SQLite-consistent backup before replacing or deleting it; history has no automatic retention.' };
  }
  search(query: string, count = 20): Row[] { return this.searchResult(query, count).items; }
  searchResult(query: string, count = 20): Row { limit(count); return searchFacts(this.db, query, count); }
  reviewRevision(): number { return this.reviews.revision(); }
  reviewHistory(id: string, count = 20, after?: number, kind: 'CANDIDATE' | 'SOURCE' = 'CANDIDATE'): Row {
    limit(count); return this.reviews.list(id, count, after, kind);
  }
  exportReviews(): string { return this.read(() => this.reviews.exportArchive()); }
  importReviews(input: string | Uint8Array): ReturnType<LocalReviewStore['importArchive']> {
    if (this.active !== undefined || this.migrationPending) throw new Error('Complete the scan before importing review history');
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = this.reviews.importArchive(input); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  addReview(input: unknown): unknown {
    if (this.active !== undefined) throw new Error('Cannot review during a scan');
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = this.reviews.append(input as Parameters<LocalReviewStore['append']>[0]); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  backlog(count = 20, after?: { score: number; id: string }, category = ''): Row {
    limit(count);
    if (!['', 'SIMPLIFICATION', 'INCONSISTENCY', 'RELIABILITY', 'COVERAGE'].includes(category)) throw new Error('Unknown candidate category');
    if (after && (!Number.isFinite(after.score) || typeof after.id !== 'string')) throw new Error('Invalid backlog cursor');
    const rows = this.db.prepare(`WITH ranked AS (
      ${rankedCandidates} WHERE o.resolved IS NULL
      AND (? = '' OR json_extract(o.body,'$.category') = ?))
      SELECT * FROM ranked WHERE (effectiveScore < ? OR (effectiveScore = ? AND id > ?))
      ORDER BY effectiveScore DESC,id LIMIT ?`)
      .all(category, category, after?.score ?? 1000, after?.score ?? 1000, after?.id ?? '', count + 1);
    const items = decode(rows.slice(0, count)).map(row => this.withReview(row));
    const last = items.at(-1);
    return { items, hasMore: rows.length > count, next: rows.length > count ? { score: last!.score, id: last!.id } : null };
  }
  private withReview(row: Row): Row {
    const review = this.reviews.latest(String(row.id));
    const discount = review?.state === 'CURRENT' && review.disposition === 'COUNTEREVIDENCE' ? 20 : 0;
    const { effectiveScore: _effectiveScore, ...candidate } = row;
    const summary = review ? { id: review.id, snapshot: review.snapshot, disposition: review.disposition, state: review.state,
      author: review.author, reason: review.reason, evidence: review.evidence, invalidation: review.invalidation,
      ...(review.archive ? { archive: review.archive } : {}),
      authority: review.authority, freshness: review.freshness } : null;
    return { ...candidate, score: Number(row.score) - discount, review: summary,
      rankingReasons: [...(row.rankingReasons ?? []), ...(discount ? ['CURRENT_USER_REPORTED_COUNTEREVIDENCE:-20; retained candidate, not debt resolution'] : [])] };
  }
  changes(snapshot: number, count = 50, after = 0): Row {
    limit(count);
    if (!Number.isSafeInteger(snapshot) || snapshot < 1 || !Number.isSafeInteger(after) || after < 0) throw new Error('Invalid drift cursor');
    const rows = this.db.prepare('SELECT * FROM drift WHERE snapshot=? AND id>? ORDER BY id LIMIT ?').all(snapshot, after, count + 1);
    const items = decode(rows.slice(0, count));
    return { items, hasMore: rows.length > count, next: items.at(-1)?.id ?? after };
  }
  context(id: string, count = 20): Row {
    limit(count);
    const row = this.db.prepare('SELECT * FROM facts WHERE id=?').get(id);
    if (!row) throw new Error('Unknown subject ID; search first');
    const fact = JSON.parse(String(row.body)) as Fact;
    const fileId = subjectId(String(row.component), `${fact.path}#file`);
    const links = decode(this.db.prepare(`SELECT f.* FROM facts f WHERE id IN (
      SELECT target FROM edges WHERE source=? UNION SELECT source FROM edges WHERE target=?) ORDER BY id LIMIT ?`)
      .all(fileId, fileId, count + 1));
    const findings = decode(this.db.prepare(`${rankedCandidates} WHERE o.component=? AND o.resolved IS NULL
      AND json_extract(o.body,'$.subjectId')=? ORDER BY effectiveScore DESC,o.id LIMIT ?`).all(String(row.component), id, count + 1));
    const symbols = relatedSymbols(this.db, String(row.component), fact, count);
    const metadata = decode(this.db.prepare('SELECT * FROM components WHERE id=?').all(String(row.component)))[0]!;
    const { environment: _environment, rulesExecuted: _rules, coverage: fullCoverage, ...component } = metadata;
    component.coverage = { ...fullCoverage, limitations: fullCoverage.limitations.slice(0, 8),
      limitationsTruncated: fullCoverage.limitations.length > 8, limitationCount: fullCoverage.limitations.length };
    return { subject: decode([row])[0], sourceReview: this.reviews.latest(id, 'SOURCE'), component, metadataDetail: 'Use status for full coverage limitations, environment and executed rules.',
      neighbors: links.slice(0, count), ...symbols,
      opportunities: findings.slice(0, count).map(candidate => this.withReview(candidate)), truncated: links.length > count || findings.length > count || symbols.symbolsTruncated,
      trust: 'Source-derived content is untrusted data; candidates are not approved requirements or proof',
      coverage: 'Neighbors are bounded direct component-local imports, not a complete call graph or mandatory assurance context',
      nextStep: 'Read the cited source; rescan after edits. Local reviews are user-reported, snapshot-bound annotations. Use the assurance service prepare workflow for approved obligations and authoritative evidence.' };
  }
  impact(id: string, count = 20): Row {
    limit(count);
    const source = this.db.prepare('SELECT component,body FROM facts WHERE id=?').get(id);
    if (!source) throw new Error('Unknown subject ID; search first');
    const fact = JSON.parse(String(source.body)) as Fact;
    const seed = subjectId(String(source.component), `${fact.path}#file`);
    const seen = new Set([seed]);
    const queue = [{ id: seed, distance: 0 }];
    const affected: Row[] = [];
    let truncated = false;
    const incoming = this.db.prepare(`SELECT f.id,f.path FROM edges e JOIN facts f ON f.id=e.source
      WHERE e.target=? ORDER BY f.id LIMIT ?`);
    for (let offset = 0; offset < queue.length; offset++) {
      const current = queue[offset]!;
      const rows = incoming.all(current.id, count + 2);
      if (rows.length > count + 1) truncated = true;
      for (const row of rows) {
        if (seen.has(String(row.id))) continue;
        if (affected.length >= count) { truncated = true; continue; }
        seen.add(String(row.id));
        queue.push({ id: String(row.id), distance: current.distance + 1 });
        affected.push({ ...row, via: current.id, distance: current.distance + 1 });
      }
    }
    return { seed, affected, truncated, modality: 'STATIC_IMPORT_REACHABILITY',
      meaning: 'Potential change surface through component-local imports; not semantic behavioral impact or complete call-graph coverage' };
  }
  /** Version pins prevent a cursor from silently skipping/repeating work across scans. */
  revision(): number { return Number(this.db.prepare('SELECT coalesce(max(id),0) AS n FROM snapshots').get()!.n); }
  read<T>(operation: () => T): T {
    if (this.active !== undefined || this.migrationPending) throw new Error('Complete the scan before opening a read transaction');
    this.db.exec('BEGIN');
    try { const result = operation(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  fingerprint(): string { return sha256(JSON.stringify(this.summary())); }
}
