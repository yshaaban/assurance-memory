import type { LocalIndex } from './local-index.js';
import { investigate } from './local-investigate.js';

/** All returned rows and cursor pins come from the same SQLite read snapshot. */
export function localQuery(index: LocalIndex, command: string, args: Record<string, unknown>): Record<string, unknown> {
  const count = args.limit === undefined ? command === 'investigate' ? 5 : 20 : args.limit;
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 1 || count > 200) throw new Error('limit must be 1..200');
  const string = (key: string, fallback = ''): string => {
    const value = args[key] ?? fallback;
    if (typeof value !== 'string' || value.length > 2000) throw new Error(`${key} must be a bounded string`);
    return value;
  };
  const decodeCursor = (encoded: string): Record<string, any> | undefined => {
    if (!encoded) return undefined;
    let value: unknown;
    try { value = JSON.parse(Buffer.from(encoded, 'base64url').toString()); } catch { throw new Error('Invalid cursor'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid cursor');
    return value as Record<string, any>;
  };
  return index.read(() => {
    const snapshot = index.revision();
    const reviewRevision = index.reviewRevision();
    switch (command) {
      case 'status': return index.summary();
      case 'search': return { snapshot, ...index.searchResult(string('query'), count), limited: true };
      case 'investigate': return investigate(index, string('task'), count, args.maxBytes === undefined ? 24_000 : args.maxBytes as number);
      case 'impact': return { snapshot, ...index.impact(string('id'), count) };
      case 'context': return { snapshot, reviewRevision, ...index.context(string('id'), count) };
      case 'backlog': {
        const encoded = string('after');
        const category = string('category');
        const cursor = decodeCursor(encoded);
        if (cursor && (cursor.snapshot !== snapshot || cursor.reviewRevision !== reviewRevision || cursor.category !== category)) throw new Error('Index changed; restart backlog pagination');
        if (cursor && (!cursor.after || typeof cursor.after !== 'object' || Array.isArray(cursor.after))) throw new Error('Invalid cursor');
        const result = index.backlog(count, cursor?.after, category);
        return { snapshot, reviewRevision, ...result, next: result.next
          ? Buffer.from(JSON.stringify({ snapshot, reviewRevision, category, after: result.next })).toString('base64url') : null };
      }
      case 'reviews': {
        const kind = args.kind ?? 'CANDIDATE';
        if (kind !== 'CANDIDATE' && kind !== 'SOURCE') throw new Error('Review kind must be CANDIDATE or SOURCE');
        const id = string('id');
        const encoded = string('after');
        const cursor = decodeCursor(encoded);
        if (cursor && (cursor.snapshot !== snapshot || cursor.reviewRevision !== reviewRevision || cursor.id !== id || (cursor.kind ?? 'CANDIDATE') !== kind))
          throw new Error('Index changed; restart review pagination');
        if (cursor && (!Number.isSafeInteger(cursor.after) || cursor.after < 1)) throw new Error('Invalid cursor');
        const result = index.reviewHistory(id, count, cursor?.after, kind);
        return { snapshot, reviewRevision, ...result, next: result.next
          ? Buffer.from(JSON.stringify({ snapshot, reviewRevision, id, kind, after: result.next })).toString('base64url') : null };
      }
      case 'drift': {
        if (typeof args.snapshot !== 'number') throw new Error('snapshot must be a number');
        const after = args.after ?? 0;
        if (typeof after !== 'number') throw new Error('after must be a row number');
        return index.changes(args.snapshot, count, after);
      }
      default: throw new Error('Unknown local query');
    }
  });
}
