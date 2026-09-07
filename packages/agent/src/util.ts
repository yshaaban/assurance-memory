import { createHash } from "node:crypto";
import { relative, resolve, sep } from "node:path";
export const sha256 = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");
export const subjectId = (component: string, locator: string): string => sha256(`${component}:${locator}`);
export function portablePath(root: string, path: string): string {
  const rel = relative(root, path).split(sep).join("/");
  if (rel === ".." || rel.startsWith("../") || resolve(root, rel) !== resolve(path)) throw new Error("Path escapes component root");
  return rel;
}
export function glob(pattern: string, value: string): boolean {
  let expression = "^";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "*" && pattern[i + 1] === "*") {
      i++;
      if (pattern[i + 1] === "/") { i++; expression += "(?:.*/)?"; } else expression += ".*";
    } else if (c === "*") expression += "[^/]*";
    else if (c === "?") expression += "[^/]";
    else expression += c.replace(/[\\^$+?.()|{}\[\]]/g, "\\$&");
  }
  return new RegExp(`${expression}$`).test(value);
}
export function deduplicateFindings<T extends { ruleId: string; subjectId: string }>(items: T[]): T[] {
  const seen = new Map<string, T>();
  for (const item of items) if (!seen.has(`${item.ruleId}:${item.subjectId}`)) seen.set(`${item.ruleId}:${item.subjectId}`, item);
  return [...seen.values()];
}
/** Iterative Kosaraju traversal avoids JS recursion limits in large import graphs. */
export function stronglyConnected(graph: Map<string, Set<string>>): string[][] {
  const nodes = new Set<string>(graph.keys());
  for (const targets of graph.values()) for (const target of targets) nodes.add(target);
  const seen = new Set<string>(), order: string[] = [];
  for (const root of nodes) {
    if (seen.has(root)) continue;
    const stack: Array<[string, boolean]> = [[root, false]];
    while (stack.length) {
      const [node, expanded] = stack.pop()!;
      if (expanded) { order.push(node); continue; }
      if (seen.has(node)) continue;
      seen.add(node); stack.push([node, true]);
      for (const child of graph.get(node) ?? []) if (!seen.has(child)) stack.push([child, false]);
    }
  }
  const reverse = new Map<string, Set<string>>();
  for (const node of nodes) reverse.set(node, new Set());
  for (const [from, targets] of graph) for (const to of targets) reverse.get(to)!.add(from);
  seen.clear(); const components: string[][] = [];
  for (const root of order.reverse()) {
    if (seen.has(root)) continue;
    const component: string[] = [], stack = [root]; seen.add(root);
    while (stack.length) {
      const node = stack.pop()!; component.push(node);
      for (const child of reverse.get(node) ?? []) if (!seen.has(child)) { seen.add(child); stack.push(child); }
    }
    components.push(component.sort());
  }
  return components;
}
