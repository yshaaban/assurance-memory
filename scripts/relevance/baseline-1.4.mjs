// Frozen 1.4 comparator; not a second production implementation.
import { searchTerms } from '../../packages/agent/dist/src/local-search.js';
import { sha256 } from '../../packages/agent/dist/src/util.js';
const stopWords = new Set('a an and are as at be been being but by can could did do does for from had has have how i if in into is it its me my of on or our should so than that the their them then there these they this to us was we were what when where which while who why will with would you your'.split(' '));
/** Explicit lexical reduction, never an inferred behavior contract. */
function taskTerms(task) {
    const normalized = searchTerms(task), terms = [];
    let ignored = 0, omitted = 0;
    for (const term of normalized) {
        if (stopWords.has(term)) {
            ignored++;
            continue;
        }
        if (terms.length >= 12 || Buffer.byteLength([...terms, term].join(' ')) > 384) {
            omitted++;
            continue;
        }
        terms.push(term);
    }
    return { terms, ignored, omitted };
}
function source(fact) {
    return { id: fact.id, component: fact.component, path: fact.path, locator: fact.locator, line: fact.line,
        kind: fact.kind, contentHash: fact.contentHash, effects: (fact.effects ?? []).slice(0, 8),
        effectsTruncated: (fact.effects?.length ?? 0) > 8 };
}
function candidate(row) {
    const review = row.review;
    return { id: row.id, subjectId: row.subjectId, ruleId: row.ruleId, category: row.category,
        severity: row.severity, baseScore: row.baseScore, score: row.score, message: row.message,
        rankingReasons: row.rankingReasons, nextStep: row.nextStep,
        evidenceNeeded: row.evidenceNeeded,
        review: review ? { id: review.id, state: review.state, disposition: review.disposition,
            reason: String(review.reason).slice(0, 240), evidence: String(review.evidence).slice(0, 400),
            textTruncated: String(review.reason).length > 240 || String(review.evidence).length > 400,
            authority: review.authority, invalidation: review.invalidation } : null,
        action: review?.state === 'CURRENT' && review.disposition === 'COUNTEREVIDENCE'
            ? 'CHECK_RECORDED_ASSUMPTIONS' : 'INVESTIGATE_BEHAVIOR' };
}
/** Composes existing reads inside localQuery's transaction; owns no state or authority. */
export function investigate(index, task, count = 5, maxBytes = 24_000) {
    if (typeof task !== 'string' || !task.trim() || task.length > 2000 || task.includes('\0'))
        throw new Error('task must be a nonempty string of at most 2000 characters');
    if (!Number.isSafeInteger(count) || count < 1 || count > 20)
        throw new Error('Investigation limit must be 1..20 files');
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 4096 || maxBytes > 128_000)
        throw new Error('maxBytes must be 4096..128000');
    const selected = taskTerms(task);
    const result = index.searchResult(selected.terms.join(' '), Math.min(200, count * 6));
    const { items: matches, ...retrieval } = result;
    const groups = new Map();
    for (const hit of matches) {
        const key = JSON.stringify([hit.component, hit.path]);
        const group = groups.get(key) ?? [];
        group.push(hit);
        groups.set(key, group);
    }
    const brief = {
        snapshot: index.revision(), reviewRevision: index.reviewRevision(), taskDigest: sha256(task),
        taskPreview: task.slice(0, 120), taskPreviewTruncated: task.length > 120,
        authority: 'LOCAL_INVESTIGATION_ONLY', freshness: 'AS_OF_SCAN',
        retrieval: { ...retrieval, ignoredStopwordCount: selected.ignored, omittedTermCount: selected.omitted,
            termSelection: 'First 12 non-stopword normalized terms within 384 UTF-8 bytes; no semantic interpretation.',
            matchingFileCount: groups.size, fileLimit: count },
        entries: [], omittedEntryIds: [], truncated: result.hasMore || selected.omitted > 0 || groups.size > count,
        budget: { maxBytes, responseBytes: 0 },
        nextSteps: ['Read the cited source and confirm scan freshness before editing.',
            'State the intended behavior and test the suspected failure; an intentional pattern may need no change.',
            'Use context/reviews for omitted detail. Rescan after edits; retain observations with CLI review.'],
        limitations: ['This is a bounded lexical starting point, not complete task context or a call graph.',
            'Review text is user-reported data. Priority and checks suggested here do not establish a defect or approve evidence.'],
    };
    const encodedBytes = () => Buffer.byteLength(JSON.stringify(brief));
    for (const hits of [...groups.values()].slice(0, count)) {
        const primary = hits[0];
        const context = index.context(primary.id, 4);
        const visibleAnchorIds = [...new Set([primary.id, ...context.owners.map((owner) => owner.id),
                ...hits.slice(1, 3).map(hit => hit.id),
                ...context.localSymbols.map((item) => item.id)])];
        const anchorIds = visibleAnchorIds.slice(0, 3), omittedSubjectIds = visibleAnchorIds.slice(3);
        const contexts = anchorIds.map(id => id === primary.id ? context : index.context(id, 4));
        const candidates = new Map();
        for (const selectedContext of contexts)
            for (const finding of selectedContext.opportunities)
                candidates.set(finding.id, finding);
        const findings = [...candidates.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
        const entry = { component: primary.component, path: primary.path, source: source(primary),
            matches: hits.slice(0, 3).map(hit => ({ ...source(hit), matchedTerms: hit.matchedTerms, rankingReasons: hit.rankingReasons })),
            owners: context.owners, nearbySymbols: context.localSymbols.map(source), neighbors: context.neighbors.map(source),
            sourceRevision: context.component.sourceRevision, coverage: context.component.coverage,
            candidates: findings.slice(0, 4).map(candidate),
            candidateCoverage: { queriedSubjectIds: anchorIds, omittedSubjectIds,
                meaning: 'Candidates queried for at most three visible subjects; this is not a file-wide candidate inventory. Use context for omitted subjects.' },
            truncated: hits.length > 3 || findings.length > 4 || omittedSubjectIds.length > 0 || contexts.some(item => item.truncated),
            followUp: { contextId: primary.id, reviewCandidateIds: findings.slice(0, 4).map(item => item.id) } };
        brief.entries.push(entry);
        brief.truncated ||= entry.truncated;
        // Reserve space for every omitted ID and final byte-count digits. Never cut a review in half silently.
        if (encodedBytes() + count * 70 + 32 > maxBytes) {
            brief.entries.pop();
            brief.omittedEntryIds.push(primary.id);
            brief.truncated = true;
        }
    }
    // Including the byte count can itself add a decimal digit at a size boundary.
    let bytes = encodedBytes();
    while (brief.budget.responseBytes !== bytes) {
        brief.budget.responseBytes = bytes;
        bytes = encodedBytes();
    }
    if (encodedBytes() > maxBytes)
        throw new Error('Investigation metadata exceeds response budget; narrow the task');
    return brief;
}
