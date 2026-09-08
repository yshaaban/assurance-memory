import type { DatabaseSync } from 'node:sqlite';
import type { Fact } from './types.js';
import { classifySourceRole } from './investigation.js';

type Row = Record<string, any>;
// Small, explicit morphology aliases. These improve lexical recall, not semantic understanding.
const aliases: Record<string, string> = {
  cancellation: 'cancel', cancelled: 'cancel', canceled: 'cancel', cancelling: 'cancel', canceling: 'cancel',
  disposal: 'dispose', disposed: 'dispose', disposing: 'dispose',
  hydration: 'hydrate', hydrated: 'hydrate', hydrating: 'hydrate',
  subscription: 'subscribe', subscriptions: 'subscribe', subscriber: 'subscribe', subscribers: 'subscribe', subscribed: 'subscribe',
  requests: 'request', caching: 'cache', cached: 'cache', retries: 'retry', retrying: 'retry',
};
export function searchTerms(text: string): string[] {
  const words = text.replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
    .replace(/(\p{Ll}|\p{N})(\p{Lu})/gu, '$1 $2').match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...new Set(words.map(word => word.toLowerCase()).map(word => Object.hasOwn(aliases, word) ? aliases[word]! : word))];
}
export function searchText(fact: Fact): string {
  const original = [fact.locator, ...fact.tags, ...fact.effects].join(' ');
  return `${original} ${searchTerms(original).join(' ')}`;
}
const compact = (text: string) => text.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();

/** All matches are bounded metadata retrieval; no repository source is executed or read here. */
export function searchFacts(db: DatabaseSync, query: string, count: number): Row {
  if (query.length > 500) throw new Error('Query exceeds 500 characters');
  const terms = searchTerms(query);
  if (terms.length > 20) throw new Error('Query exceeds 20 normalized terms; narrow the query');
  if (!terms.length) return { items: [], matchMode: 'EMPTY', terms, hasMore: false };
  const quoted = terms.map(term => `"${term}"`);
  const expression = quoted.join(' AND ');
  const poolLimit = Math.max(200, count * 5);
  const get = (match: string) => db.prepare(`SELECT f.*, search.rank AS lexicalRank FROM search JOIN facts f ON f.id=search.id
    WHERE search MATCH ? ORDER BY search.rank LIMIT ?`).all(match, poolLimit + 1) as Row[];
  let lexical = get(expression), matchMode = 'ALL_TERMS';
  if (!lexical.length && terms.length > 1) { lexical = get(quoted.join(' OR ')); matchMode = 'ANY_TERM'; }
  const keys = [...new Set([query.toLowerCase(), compact(query)])];
  const exact = db.prepare(`SELECT * FROM facts WHERE lower(substr(json_extract(body,'$.locator'),instr(json_extract(body,'$.locator'),'#')+1)) IN (?,?)
    ORDER BY id LIMIT ?`).all(keys[0]!, keys[1] ?? keys[0]!, count + 1) as Row[];
  const target = compact(query);
  // File matches seed a bounded named-owner expansion using the existing component/path index.
  const files = new Map<string, Row>();
  for (const row of lexical.slice(0, poolLimit)) {
    const path = String(row.path);
    if (compact(path.split('/').at(-1)!.replace(/\.[^.]+$/, '')) === target || compact(path) === target)
      files.set(`${row.component}:${path}`, row);
  }
  const named: Row[] = [];
  for (const row of [...files.values()].slice(0, 5)) {
    named.push(...db.prepare(`SELECT * FROM facts WHERE component=? AND path=? AND
      (json_extract(body,'$.kind')='FILE' OR (json_extract(body,'$.kind') IN ('FUNCTION','METHOD') AND instr(json_extract(body,'$.locator'),'@')=0))
      ORDER BY CASE WHEN json_extract(body,'$.kind')='FILE' THEN 0 ELSE 1 END,
      coalesce(json_extract(body,'$.metrics.guards'),0) DESC, coalesce(json_extract(body,'$.metrics.lines'),0) DESC, id LIMIT ?`)
      .all(row.component, row.path, count + 1) as Row[]);
  }
  const candidatePoolTruncated = lexical.length > poolLimit || exact.length > count || files.size > 5;
  const unique = new Map<string, Row>();
  for (const row of [...lexical.slice(0, poolLimit), ...named, ...exact]) unique.set(String(row.id), row);
  const rows = [...unique.values()];
  const items = rows.map(({ body, ...row }) => {
    const fact = JSON.parse(String(body)) as Fact;
    const symbol = fact.locator.slice(fact.locator.indexOf('#') + 1);
    const file = fact.path.split('/').at(-1)!.replace(/\.[^.]+$/, '');
    const exactSymbol = keys.includes(symbol.toLowerCase());
    const exactFile = compact(file) === target || compact(fact.path) === target;
    const topLevel = ['FUNCTION', 'METHOD'].includes(fact.kind) && !symbol.includes('@') && !symbol.includes('.');
    const matchedTerms = terms.filter(term => searchTerms(searchText(fact)).includes(term));
    const reasons = [exactSymbol ? 'EXACT_SYMBOL' : exactFile ? 'EXACT_FILE' : 'LEXICAL_MATCH'];
    let priority = exactSymbol ? 10000 : exactFile ? 1000 : 0;
    priority += matchedTerms.length * 100;
    if (exactFile) {
      if (fact.kind === 'FILE') { priority += 80; reasons.push('FILE_OVERVIEW'); }
      else if (topLevel) {
        priority += 40 + Math.min(20, fact.metrics.guards ?? 0) + Math.min(15, Math.floor((fact.metrics.lines ?? 0) / 20));
        reasons.push('NAMED_FUNCTION_IN_FILE');
      }
    }
    if (classifySourceRole(fact).role === 'TEST') {
      priority -= 10; reasons.push('TEST_SOURCE');
    }
    return { ...row, ...fact, lexicalRank: Number(row.lexicalRank ?? 0), rank: -priority, matchedTerms, rankingReasons: reasons };
  }).sort((a, b) => a.rank - b.rank || Number(a.lexicalRank) - Number(b.lexicalRank) || a.id.localeCompare(b.id));
  return { items: items.slice(0, count), matchMode, terms, hasMore: items.length > count || candidatePoolTruncated,
    candidatePoolTruncated, candidatePoolLimit: poolLimit, ownerExpansionFileLimit: 5,
    ownerExpansionPerFileLimit: count + 1,
    meaning: matchMode === 'ANY_TERM' ? 'No all-term matches; showing a broader lexical match. Read the source before relying on relevance.'
      : 'Normalized locator/tag/effect matches with bounded reranking; not full-text source search or semantic proof.' };
}

/** Lexical containment and nearby named units; never presented as call edges. */
export function relatedSymbols(db: DatabaseSync, component: string, fact: Fact, count: number): Row {
  const rows = db.prepare(`SELECT body FROM facts WHERE component=? AND path=? AND id<>?
    AND json_extract(body,'$.kind') IN ('FUNCTION','METHOD','CLASS','FILE') ORDER BY
      CASE WHEN instr(json_extract(body,'$.locator'),'@')=0 THEN 0 ELSE 1 END,
      abs(cast(json_extract(body,'$.line') AS integer)-?), id LIMIT ?`).all(component, fact.path, fact.id, fact.line, count + 1);
  const symbols = rows.map(row => JSON.parse(String(row.body)) as Fact);
  // Exact locator prefixes avoid guessing containment from line distance.
  const locator = fact.locator;
  const prefixes: string[] = [];
  for (let i = locator.indexOf('#') + 1; i < locator.length; i++) if (locator[i] === '.' || locator[i] === '@') prefixes.push(locator.slice(0, i));
  const owners = prefixes.reverse().slice(0, count + 1).flatMap(prefix => {
    const row = db.prepare('SELECT body FROM facts WHERE id<>? AND component=? AND path=? AND json_extract(body,\'$.locator\')=? LIMIT 1')
      .get(fact.id, component, fact.path, prefix);
    return row ? [JSON.parse(String(row.body)) as Fact] : [];
  });
  const brief = (f: Fact) => ({ id: f.id, locator: f.locator, path: f.path, line: f.line, kind: f.kind, effects: f.effects, metrics: f.metrics });
  return { owners: owners.slice(0, count).map(brief), localSymbols: symbols.slice(0, count).map(brief),
    symbolsTruncated: rows.length > count || owners.length > count || prefixes.length > count,
    symbolMeaning: 'Owners use locator prefixes; localSymbols are nearby named units in this file, not callers or behavioral dependencies.' };
}
