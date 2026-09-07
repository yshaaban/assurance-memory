import type { LocalIndex } from './local-index.js';

/** All returned rows and cursor pins come from the same SQLite read snapshot. */
export function localQuery(index: LocalIndex, command: string, args: Record<string, unknown>): Record<string, unknown> {
  const count = args.limit === undefined ? 20 : args.limit;
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 1 || count > 200) throw new Error('limit must be 1..200');
  const string = (key: string, fallback = ''): string => {
    const value = args[key] ?? fallback;
    if (typeof value !== 'string' || value.length > 2000) throw new Error(`${key} must be a bounded string`);
    return value;
  };
  return index.read(() => {
    const snapshot = index.revision();
    switch (command) {
      case 'status': return index.summary();
      case 'search': return { snapshot, items: index.search(string('query'), count), limited: true };
      case 'impact': return { snapshot, ...index.impact(string('id'), count) };
      case 'context': return { snapshot, ...index.context(string('id'), count) };
      case 'backlog': {
        const encoded = string('after');
        const category = string('category');
        const cursor = encoded ? JSON.parse(Buffer.from(encoded, 'base64url').toString()) : undefined;
        if (cursor && (cursor.snapshot !== snapshot || cursor.category !== category)) throw new Error('Index changed; restart backlog pagination');
        const result = index.backlog(count, cursor?.after, category);
        return { snapshot, ...result, next: result.next
          ? Buffer.from(JSON.stringify({ snapshot, category, after: result.next })).toString('base64url') : null };
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
