import type { LocalIndex } from './local-index.js';
import { searchTerms, searchText } from './local-search.js';
import { sha256 } from './util.js';

type Row = Record<string, any>;
const stopWords = new Set('a an and are as at be been being but by can could did do does for from had has have how i if in into is it its me my of on or our should so than that the their them then there these they this to us was we were what when where which while who why will with would you your'.split(' '));

/** Task-only probes preserve ordinary search semantics and use its existing bounded FTS pool. */
function taskMatches(index: LocalIndex, task: string, count: number): Row {
  const normalized = searchTerms(task), content = normalized.filter(term => !stopWords.has(term));
  const raw = (task.match(/[\p{L}\p{N}_./\\-]+/gu) ?? []).map(token => token.replace(/^[./\\-]+|[./\\-]+$/g, ''));
  const anchors = [...new Set(raw.filter(token => /[a-z][A-Z]|[_.\/\\]/.test(token)
    && token.length <= 200 && searchTerms(token).length > 0 && searchTerms(token).length <= 20))].slice(0, 6);
  const prioritized = [...new Set([...anchors.flatMap(searchTerms), ...content])].filter(term => !stopWords.has(term));
  // Preserve explicit identifiers first; then sample both ends instead of always dropping a task's final requirement.
  const ordered = [...new Set([...anchors.flatMap(searchTerms), ...Array.from({ length: prioritized.length }, (_, i) =>
    prioritized[i % 2 === 0 ? Math.floor(i / 2) : prioritized.length - 1 - Math.floor(i / 2)]!)])]
    .filter(term => !stopWords.has(term));
  const terms: string[] = [];
  for (const term of ordered) if (terms.length < 20 && Buffer.byteLength([...terms, term].join(' ')) <= 384) terms.push(term);
  const probeLimit = Math.min(80, Math.max(20, count * 8));
  const queries = [...new Set([...anchors, ...terms])];
  const pool = new Map<string, Row>(), frequencies = new Map<string, number>();
  let exhausted = false;
  for (const query of queries) {
    const result = index.searchResult(query, probeLimit);
    exhausted ||= result.hasMore;
    if (terms.includes(query)) frequencies.set(query, new Set(result.items.map((hit: Row) => JSON.stringify([hit.component, hit.path]))).size);
    for (const hit of result.items) pool.set(hit.id, hit);
  }
  const compact = (text: string) => text.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
  const anchorKeys = anchors.map(compact);
  const weighted = (term: string) => 1 + 1 / Math.max(1, frequencies.get(term) ?? 1);
  const matches = [...pool.values()].map((hit): Row => {
    const symbol = hit.locator.slice(hit.locator.indexOf('#') + 1);
    const symbolTerms = searchTerms(symbol), pathTerms = searchTerms(hit.path), allTerms = searchTerms(searchText(hit as any));
    const matchedTerms = terms.filter(term => allTerms.includes(term));
    const exactSymbol = anchorKeys.includes(compact(symbol));
    const exactFile = anchorKeys.includes(compact(hit.path)) || anchorKeys.includes(compact(hit.path.split('/').at(-1).replace(/\.[^.]+$/, '')));
    const named = ['FUNCTION', 'METHOD', 'CLASS'].includes(hit.kind) && !symbol.includes('@');
    const score = (exactSymbol ? 10000 : exactFile ? 2000 : 0) + matchedTerms.reduce((total, term) => total + weighted(term)
      * (symbolTerms.includes(term) ? 8 : pathTerms.includes(term) ? 4 : 1), 0) + (named ? 4 : 0);
    return { ...hit, matchedTerms, taskScore: score, rankingReasons: [exactSymbol ? 'TASK_EXACT_SYMBOL' : exactFile ? 'TASK_EXACT_FILE' : 'TASK_LEXICAL_MATCH',
      ...(named ? ['NAMED_OWNER'] : []), 'FILE_DIVERSE_SELECTION'] };
  }).sort((a, b) => b.taskScore - a.taskScore || a.rank - b.rank || a.id.localeCompare(b.id));
  const anchoredFiles = new Set(matches.filter(hit => ['TASK_EXACT_SYMBOL', 'TASK_EXACT_FILE'].includes(hit.rankingReasons[0]))
    .map(hit => JSON.stringify([hit.component, hit.path])));
  const selected = anchoredFiles.size ? matches.filter(hit => anchoredFiles.has(JSON.stringify([hit.component, hit.path]))) : matches;
  const omittedLowerConfidenceFileCount = new Set(matches.map(hit => JSON.stringify([hit.component, hit.path]))).size
    - new Set(selected.map(hit => JSON.stringify([hit.component, hit.path]))).size;
  return { items: selected, terms, matchMode: terms.length ? 'BOUNDED_TASK_PROBES' : 'EMPTY', hasMore: exhausted || omittedLowerConfidenceFileCount > 0,
    ignoredStopwordCount: normalized.length - content.length, omittedTermCount: content.filter(term => !terms.includes(term)).length,
    termSelection: 'Up to six explicit identifier/path probes, then 20 non-stopword terms within 384 UTF-8 bytes, alternating task ends; lexical evidence only.',
    probeCount: queries.length, probeLimit, candidatePoolTruncated: exhausted, omittedLowerConfidenceFileCount,
    fileSelection: anchoredFiles.size ? 'EXPLICIT_ANCHOR_FILES; lower-confidence lexical files omitted. Use search/context to investigate additional consumers.' : 'LEXICAL_FILES',
    meaning: 'Bounded per-term FTS results reranked by identifier/path matches and probe file frequency; files compete by their best match. Not semantic relevance or a call graph.' };
}

function source(fact: Row): Row {
  return { id: fact.id, component: fact.component, path: fact.path, locator: fact.locator, line: fact.line,
    kind: fact.kind, contentHash: fact.contentHash, effects: (fact.effects ?? []).slice(0, 8),
    effectsTruncated: (fact.effects?.length ?? 0) > 8 };
}
function provenance(fact: Row): Row {
  return { id: fact.id, component: fact.component, path: fact.path, locator: fact.locator, line: fact.line,
    kind: fact.kind, contentHash: fact.contentHash };
}
function reviewSummary(review: Row): Row {
  return { id: review.id, state: review.state, disposition: review.disposition,
    reason: String(review.reason).slice(0, 240), evidence: String(review.evidence).slice(0, 400),
    textTruncated: String(review.reason).length > 240 || String(review.evidence).length > 400,
    authority: review.authority, invalidation: review.invalidation };
}
function candidate(row: Row): Row {
  const review = row.review;
  return { id: row.id, subjectId: row.subjectId, ruleId: row.ruleId, category: row.category,
    severity: row.severity, baseScore: row.baseScore, score: row.score, message: row.message,
    rankingReasons: row.rankingReasons, nextStep: row.nextStep,
    evidenceNeeded: row.evidenceNeeded,
    review: review ? reviewSummary(review) : null,
    action: review?.state === 'CURRENT' && review.disposition === 'COUNTEREVIDENCE'
      ? 'CHECK_RECORDED_ASSUMPTIONS' : 'INVESTIGATE_BEHAVIOR' };
}

/** Composes existing reads inside localQuery's transaction; owns no state or authority. */
export function investigate(index: LocalIndex, task: string, count = 5, maxBytes = 24_000): Row {
  if (typeof task !== 'string' || !task.trim() || task.length > 2000 || task.includes('\0'))
    throw new Error('task must be a nonempty string of at most 2000 characters');
  if (!Number.isSafeInteger(count) || count < 1 || count > 20) throw new Error('Investigation limit must be 1..20 files');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 4096 || maxBytes > 128_000) throw new Error('maxBytes must be 4096..128000');
  const result = taskMatches(index, task, count);
  const { items: matches, ...retrieval } = result;
  const groups = new Map<string, Row[]>();
  for (const hit of matches as Row[]) {
    const key = JSON.stringify([hit.component, hit.path]);
    const group = groups.get(key) ?? [];
    group.push(hit); groups.set(key, group);
  }
  const brief: Row = {
    snapshot: index.revision(), reviewRevision: index.reviewRevision(), taskDigest: sha256(task),
    taskPreview: task.slice(0, 120), taskPreviewTruncated: task.length > 120,
    authority: 'LOCAL_INVESTIGATION_ONLY', freshness: 'AS_OF_SCAN',
    retrieval: { ...retrieval,
      matchingFileCount: groups.size, fileLimit: count },
    entries: [], omittedEntryIds: [], truncated: result.hasMore || result.omittedTermCount > 0 || groups.size > count,
    budget: { maxBytes, responseBytes: 0 },
    nextSteps: ['Read the cited source and confirm scan freshness before editing.',
      'State the intended behavior and test the suspected failure; an intentional pattern may need no change.',
      'Use context/reviews for omitted detail. Rescan after edits; retain observations with CLI review.'],
    limitations: ['This is a bounded lexical starting point, not complete task context or a call graph.',
      'Review text is user-reported data. Priority and checks suggested here do not establish a defect or approve evidence.'],
  };
  const encodedBytes = () => Buffer.byteLength(JSON.stringify(brief));
  const detailed: Row[] = [];
  for (const hits of [...groups.values()].slice(0, count)) {
    const primary = hits[0]!;
    const context = index.context(primary.id, 4);
    const visibleAnchorIds = [...new Set([primary.id, ...context.owners.map((owner: Row) => owner.id),
      ...hits.slice(1, 3).map(hit => hit.id),
      ...context.localSymbols.map((item: Row) => item.id)])];
    const anchorIds = visibleAnchorIds.slice(0, 3), omittedSubjectIds = visibleAnchorIds.slice(3);
    const contexts = anchorIds.map(id => id === primary.id ? context : index.context(id, 4));
    const candidates = new Map<string, Row>();
    for (const selectedContext of contexts) for (const finding of selectedContext.opportunities) candidates.set(finding.id, finding);
    const findings = [...candidates.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    const entry = { component: primary.component, path: primary.path, source: source(primary),
      matches: hits.slice(0, 3).map(hit => ({ ...source(hit), matchedTerms: hit.matchedTerms, rankingReasons: hit.rankingReasons })),
      owners: context.owners, nearbySymbols: context.localSymbols.map(source), neighbors: context.neighbors.map(source),
      sourceRevision: context.component.sourceRevision, coverage: context.component.coverage,
      candidates: findings.slice(0, 4).map(candidate),
      sourceReviews: contexts.filter(item => item.sourceReview).map(item => ({ ...reviewSummary(item.sourceReview),
        sourceId: item.sourceReview.sourceId, history: { command: 'reviews', kind: 'SOURCE', id: item.sourceReview.sourceId } })),
      candidateCoverage: { queriedSubjectIds: anchorIds, omittedSubjectIds,
        meaning: 'Candidates and source reviews queried for at most three visible subjects; neither is a file-wide inventory. Use context/reviews for omitted subjects.' },
      truncated: hits.length > 3 || findings.length > 4 || omittedSubjectIds.length > 0 || contexts.some(item => item.truncated),
      followUp: { contextId: primary.id, reviewCandidateIds: findings.slice(0, 4).map(item => item.id) } };
    detailed.push(entry);
  }
  // Reserve useful provenance for several files before expanding any one file's effects, symbols and findings.
  for (const entry of detailed) {
    const compactEntry = { ...entry, source: provenance(entry.source), matches: entry.matches.map((hit: Row) => ({ ...provenance(hit),
      matchedTerms: hit.matchedTerms, rankingReasons: hit.rankingReasons })), owners: entry.owners.map(provenance),
      nearbySymbols: [], neighbors: [], coverage: { discovery: entry.coverage.discovery, semantic: entry.coverage.semantic,
        limitationCount: entry.coverage.limitationCount, limitationsOmitted: true },
      candidates: entry.candidates.map((item: Row) => ({ id: item.id, subjectId: item.subjectId, ruleId: item.ruleId,
        action: item.action, review: item.review })), detail: 'COMPACT',
      omittedDetail: 'Effects, nearby symbols, import neighbors, coverage limitations and candidate explanations require context; review summaries are retained.',
      truncated: true };
    brief.entries.push(compactEntry);
    if (encodedBytes() + count * 70 + 32 > maxBytes) {
      brief.entries.pop(); brief.omittedEntryIds.push(entry.source.id); brief.truncated = true;
    }
  }
  for (let i = 0; i < brief.entries.length; i++) {
    const compactEntry = brief.entries[i];
    const full = detailed.find(entry => entry.source.id === compactEntry.source.id)!;
    brief.entries[i] = { ...full, detail: 'EXPANDED' };
    if (encodedBytes() + 32 > maxBytes) brief.entries[i] = compactEntry;
  }
  brief.truncated ||= brief.entries.some((entry: Row) => entry.truncated);
  // Including the byte count can itself add a decimal digit at a size boundary.
  let bytes = encodedBytes();
  while (brief.budget.responseBytes !== bytes) {
    brief.budget.responseBytes = bytes;
    bytes = encodedBytes();
  }
  if (encodedBytes() > maxBytes) throw new Error('Investigation metadata exceeds response budget; narrow the task');
  return brief;
}
