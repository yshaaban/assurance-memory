import ts from "typescript";
import { resolve, relative } from "node:path";
import type { AnalysisResult, ComponentConfig, Fact, Finding } from "./types.js";
import { TS_RULES } from "./rules.js";
import { deduplicateFindings, glob, portablePath, sha256, stronglyConnected, subjectId } from "./util.js";

const writes = new Set(["save", "saveAll", "insert", "update", "delete", "upsert", "executeUpdate", "persist"]);
const asyncCalls = new Set(["setTimeout", "setInterval", "queueMicrotask", "subscribe", "runAsync"]);
const syncCalls = new Set(["readFileSync", "writeFileSync", "execSync", "spawnSync", "pbkdf2Sync", "scryptSync"]);
const callable = (node: ts.Node): node is ts.FunctionLikeDeclaration => ts.isFunctionDeclaration(node) ||
  ts.isMethodDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node) ||
  ts.isConstructorDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node);

function exported(node: ts.Node): boolean {
  if (ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword || m.kind === ts.SyntaxKind.PublicKeyword)) return true;
  if (ts.isVariableDeclaration(node) && node.parent.parent) return exported(node.parent.parent);
  return false;
}
function nameOf(node: ts.CallExpression): string {
  return ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text
    : ts.isIdentifier(node.expression) ? node.expression.text : "<dynamic-call>";
}
function ownerOf(node: ts.Node): string {
  const names: string[] = [];
  let current: ts.Node | undefined = node;
  while (current && !ts.isSourceFile(current)) {
    if ((ts.isClassDeclaration(current) || ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current) || ts.isVariableDeclaration(current)) && current.name) {
      names.unshift(current.name.getText());
    }
    current = current.parent;
  }
  return names.join(".");
}
function callbackOrdinal(node: ts.Node): number {
  let ordinal = 0;
  node.parent.forEachChild(child => { if (child.pos < node.pos && callable(child)) ordinal++; });
  return ordinal;
}

/** Compiler-backed TS/JS facts. The Program is reusable within a scanner process, but scans are component-local. */
export class TypeScriptAnalyzer {
  private readonly programs = new Map<string, ts.Program>();
  analyze(component: string, root: string, files: string[], config: ComponentConfig = { root }): AnalysisResult {
    root = resolve(root);
    let options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext, allowJs: true, checkJs: true, noEmit: true,
      skipLibCheck: true, strict: true };
    const limitations: string[] = [];
    let configError = false;
    if (config.tsconfig) {
      const path = resolve(root, config.tsconfig);
      const read = ts.readConfigFile(path, ts.sys.readFile);
      if (read.error) { configError = true; limitations.push("tsconfig could not be read"); }
      else {
        const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, resolve(path, ".."));
        options = { ...options, ...parsed.options, noEmit: true };
        if (parsed.errors.length) { configError = true; limitations.push("tsconfig has diagnostics"); }
        if (parsed.projectReferences?.length) {
          configError = true;
          limitations.push("Solution tsconfig references are not expanded; configure a component with each concrete build-target tsconfig");
        }
      }
    }
    const key = `${component}:${root}`;
    const previous = this.programs.get(key);
    const program = ts.createProgram({ rootNames: files.map(f => resolve(f)), options,
      ...(previous ? { oldProgram: previous } : {}) });
    this.programs.set(key, program);
    const checker = program.getTypeChecker();
    const diagnostics = ts.getPreEmitDiagnostics(program);
    const typeErrors = configError || diagnostics.some(d => d.category === ts.DiagnosticCategory.Error);
    const parseErrors = program.getSyntacticDiagnostics().length > 0;
    if (typeErrors) limitations.push(`Compiler reported ${diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length} error diagnostics; type/effect coverage is incomplete`);
    const facts: Fact[] = [], findings: Finding[] = [];
    const imports = new Map<string, Set<string>>(), fileIds = new Map<string, string>();
    const duplicates = new Map<string, Fact[]>();
    let unknown = false;
    const allowed = new Set(files.map(f => resolve(f)));
    const printer = ts.createPrinter({ removeComments: true });
    for (const source of program.getSourceFiles()) {
      if (!allowed.has(resolve(source.fileName))) continue;
      const path = portablePath(root, source.fileName);
      const fileLocator = `${path}#file`, fileId = subjectId(component, fileLocator);
      fileIds.set(path, fileId); imports.set(path, new Set());
      const fileCalls = new Set<string>(), fileEffects = new Set<string>();
      const fileTags = new Set(["all", "files"]);
      if (/(?:^|\/)(?:__tests__|test|tests)(?:\/|$)|\.(?:spec|test)\.[cm]?[jt]sx?$/.test(path)) fileTags.add("tests");
      const position = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      const emit = (subject: string, ruleId: string, node: ts.Node | number, severity: Finding["severity"], message: string) => {
        findings.push({ subjectId: subject, ruleId, line: typeof node === "number" ? node : position(node), severity, message });
      };
      let fileGuards = 0, fileAssertions = 0;
      const scanImports = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
          const moduleName = node.moduleSpecifier.text;
          const target = ts.resolveModuleName(moduleName, source.fileName, options, ts.sys).resolvedModule;
          if (target && allowed.has(resolve(target.resolvedFileName))) {
            const to = portablePath(root, target.resolvedFileName); imports.get(path)!.add(to);
            fileEffects.add(`IMPORT:${to}`);
            const fromLayer = config.layers?.find(layer => glob(layer.match, path));
            const toLayer = config.layers?.find(layer => glob(layer.match, to));
            if (fromLayer && toLayer && fromLayer.name !== toLayer.name && !fromLayer.mayImport.includes(toLayer.name)) {
              emit(fileId, "TS_LAYER_VIOLATION", node, "HIGH", `Import crosses disallowed layer boundary: ${fromLayer.name} -> ${toLayer.name}`);
            }
          } else {
            fileTags.add("dependencies");
            fileEffects.add(`EXTERNAL_IMPORT:${moduleName.slice(0, 150)}`);
            if (!target) { unknown = true; fileTags.add("unknown"); }
          }
        }
        if (ts.isCallExpression(node)) fileCalls.add(nameOf(node));
        if (ts.isIfStatement(node) || ts.isConditionalExpression(node)) fileGuards++;
        if (ts.isCallExpression(node) && /^(?:expect|assert|verify)/.test(nameOf(node))) fileAssertions++;
        ts.forEachChild(node, scanImports);
      };
      scanImports(source);
      const baseLocator = (node: ts.FunctionLikeDeclaration): string => {
        const parentName = ownerOf(node);
        const name = parentName || `anonymous-${callbackOrdinal(node)}`;
        const anonymous = (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && !ts.isVariableDeclaration(node.parent);
        // #file belongs to the containing source-file fact, not a function named "file".
        return `${path}#${name === "file" ? "function:file" : name}${anonymous ? `@callback:${node.getStart(source)}` : ""}`;
      };
      // Repeated local names in separate test callbacks/block scopes are distinct declarations.
      // Keep normal named identities stable; explicitly position-bind only ambiguous names.
      const locatorCounts = new Map<string, number>();
      const countDeclarations = (node: ts.Node): void => {
        if (callable(node) && node.body) {
          const locator = baseLocator(node);
          locatorCounts.set(locator, (locatorCounts.get(locator) ?? 0) + 1);
        }
        ts.forEachChild(node, countDeclarations);
      };
      countDeclarations(source);
      const inspectFunction = (node: ts.FunctionLikeDeclaration): void => {
        const base = baseLocator(node);
        const ambiguous = (locatorCounts.get(base) ?? 0) > 1;
        const locator = ambiguous ? `${base}@declaration:${node.getStart(source)}` : base;
        const anonymous = (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && !ts.isVariableDeclaration(node.parent);
        if (ambiguous) limitations.push(`Repeated local declaration identity is location-bound in ${path}`);
        const id = subjectId(component, locator), tags = new Set(["all", "functions"]), effects = new Set<string>();
        if (anonymous) limitations.push(`Anonymous callback identity is location-bound in ${path}`);
        const boundary = exported(node) || exported(node.parent) || (ts.isMethodDeclaration(node) && !ts.getModifiers(node)?.some(m => [ts.SyntaxKind.PrivateKeyword, ts.SyntaxKind.ProtectedKeyword].includes(m.kind)));
        if (boundary) tags.add("boundaries");
        if (fileTags.has("tests")) tags.add("tests");
        const signature = checker.getSignatureFromDeclaration(node);
        const signatureText = signature ? checker.signatureToString(signature, node, ts.TypeFormatFlags.NoTruncation) : node.getText(source).split("{")[0]!;
        let anyBoundary = false;
        for (const parameter of node.parameters) {
          const type = checker.getTypeAtLocation(parameter);
          if (boundary && (type.flags & ts.TypeFlags.Any)) anyBoundary = true;
          for (const context of ["tenant", "tenantId", "signal", "deadline"]) if (parameter.name.getText(source).includes(context)) effects.add(`REQUIRES_CONTEXT:${context}`);
        }
        if (boundary && signature && (checker.getReturnTypeOfSignature(signature).flags & ts.TypeFlags.Any)) anyBoundary = true;
        if (anyBoundary) { unknown = true; tags.add("unknown"); emit(id, "TS_ANY_BOUNDARY", node, "MEDIUM", "Public boundary contains any; runtime validation and downstream effects are not established"); }
        const hasSignal = node.parameters.some(p => p.name.getText(source).includes("signal") || p.type?.getText(source).includes("AbortSignal"));
        let guards = 0, assertions = 0;
        const visit = (child: ts.Node, retryDepth: number): void => {
          if (child !== node && callable(child)) return; // Each nested function owns its own effects.
          if (ts.isIfStatement(child) || ts.isConditionalExpression(child)) guards++;
          if (ts.isCatchClause(child) && child.block.statements.length === 0) emit(id, "TS_EMPTY_CATCH", child, "HIGH", "Empty catch discards failure information; review recovery and observability contracts");
          if (ts.isCallExpression(child)) {
            const call = nameOf(child);
            if (/^(?:expect|assert|verify)/.test(call)) assertions++;
            if (writes.has(call)) { tags.add("writers"); effects.add("WRITE_DB_CANDIDATE"); }
            if (["query", "find", "findMany", "findUnique", "select"].includes(call)) { tags.add("readers"); effects.add("READ_DB_CANDIDATE"); }
            if (["publish", "send", "emit"].includes(call)) { tags.add("publishers"); effects.add("PUBLISH"); }
            if (asyncCalls.has(call)) { tags.add("async"); effects.add("SPAWN_OR_SUBSCRIBE"); }
            if (["close", "dispose", "unsubscribe", "clearInterval", "removeEventListener", "off"].includes(call)) { tags.add("resources"); effects.add("RELEASE"); }
            if (["acquire", "connect", "createReadStream"].includes(call)) { tags.add("resources"); effects.add("ACQUIRE"); }
            if (["abort", "cancel"].includes(call)) { tags.add("async"); effects.add("CANCEL_REQUEST"); }
            if (["authorize", "checkPermission", "requireRole"].includes(call)) { tags.add("security"); effects.add("AUTHORIZATION"); }
            if (syncCalls.has(call) && !tags.has("tests")) { effects.add("BLOCK"); emit(id, "TS_SYNC_IO", child, "MEDIUM", "Synchronous operation may block the event loop; establish the execution-context budget"); }
            if (call === "eval" || call === "<dynamic-call>") { unknown = true; tags.add("unknown"); effects.add("DYNAMIC_CODE"); if (call === "eval") emit(id, "TS_DYNAMIC_CODE", child, "HIGH", "Dynamic evaluation is outside the extracted call/effect graph"); }
            if (["forEach", "map"].includes(call) && child.arguments.some(argument => callable(argument) && Boolean(ts.getModifiers(argument)?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword))) && (call === "forEach" || ts.isExpressionStatement(child.parent))) {
              tags.add("async"); effects.add("DETACHED_ASYNC_ITERATION"); emit(id, "TS_DETACHED_ASYNC", child, "HIGH", "Async iteration callbacks are not joined here; forEach does not await callback promises and a discarded map result loses their ownership");
            }
            const resultType = checker.getTypeAtLocation(child);
            const promiseLike = Boolean(resultType.getProperty("then"));
            if (promiseLike && ts.isExpressionStatement(child.parent)) {
              tags.add("async"); effects.add("DETACHED_PROMISE"); emit(id, "TS_FLOATING_PROMISE", child, "HIGH", "Promise-valued work is neither awaited nor returned; verify error observation and lifecycle ownership");
            } else if (promiseLike && ts.isVoidExpression(child.parent)) {
              tags.add("async"); effects.add("EXPLICIT_DETACHED_PROMISE"); emit(id, "TS_DETACHED_ASYNC", child, "MEDIUM", "void explicitly detaches work but does not establish cancellation, joining, or cleanup");
            }
            if (call === "all" && ts.isPropertyAccessExpression(child.expression) && child.expression.expression.getText(source) === "Promise" && child.arguments.some(a => ts.isCallExpression(a) && nameOf(a) === "map")) {
              emit(id, "TS_UNBOUNDED_FANOUT", child, "HIGH", "Promise.all(map(...)) has no local admission bound; verify workload size and concurrency control"); effects.add("FANOUT"); tags.add("budgets");
            }
            if (call === "fetch" && hasSignal) {
              const options = child.arguments[1];
              const forwards = options && ts.isObjectLiteralExpression(options) && options.properties.some(p => ts.isSpreadAssignment(p) || (p.name && p.name.getText(source) === "signal"));
              if (!forwards) emit(id, "TS_ABORT_NOT_FORWARDED", child, "HIGH", "Function accepts an abort signal, but fetch does not visibly receive it; wrapper forwarding remains unresolved");
            }
            if (call === "parse" && ts.isPropertyAccessExpression(child.expression) && child.expression.expression.getText(source) === "JSON" && boundary) emit(id, "TS_UNVALIDATED_DESERIALIZATION", child, "MEDIUM", "Deserialization appears at a public boundary; establish schema validation separately");
            if (["retry", "retryWhen"].includes(call)) {
              effects.add("RETRY"); tags.add("budgets");
              if (retryDepth > 0) emit(id, "TS_NESTED_RETRY", child, "HIGH", "Nested retries can multiply attempts and consume the caller's deadline budget");
              retryDepth++;
            }
          }
          if (ts.isNewExpression(child) && ts.isIdentifier(child.expression) && child.expression.text === "Function") { unknown = true; effects.add("DYNAMIC_CODE"); tags.add("unknown"); emit(id, "TS_DYNAMIC_CODE", child, "HIGH", "Function constructor introduces behavior outside the static graph"); }
          ts.forEachChild(child, descendant => visit(descendant, retryDepth));
        };
        visit(node, 0);
        const body = node.body;
        const lines = node.getText(source).split(/\r?\n/).length;
        if (lines > 100) emit(id, "TS_LARGE_FUNCTION", node, "LOW", "Large function is a review/change-locality candidate; it is not itself a debt valuation");
        if (effects.size > 120) { unknown = true; limitations.push(`Function effect summary truncated in ${path}`); }
        const fact: Fact = { id, locator, path, language: /\.[cm]?jsx?$/.test(path) ? "JS" : "TS", kind: "FUNCTION",
          contentHash: sha256(node.getText(source)), signatureHash: sha256(signatureText), tags: [...tags].sort(),
          effects: [...effects].sort().slice(0, 120), metrics: { lines, guards, assertions }, line: position(node) };
        facts.push(fact);
        if (body && lines >= 10) {
          const hash = sha256(printer.printNode(ts.EmitHint.Unspecified, body, source));
          const group = duplicates.get(hash) ?? []; group.push(fact); duplicates.set(hash, group);
        }
      };
      const visit = (node: ts.Node): void => {
        if (callable(node) && node.body) inspectFunction(node);
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
          const receiver = node.expression.expression.getText(source);
          if (/^(?:it|test|describe)(?:\.|$)/.test(receiver)) {
            if (["skip", "todo"].includes(node.expression.name.text)) emit(fileId, "TS_TEST_DISABLED", node, "HIGH", "Disabled or placeholder test narrows the exercised requirement scenarios");
            if (node.expression.name.text === "only") emit(fileId, "TS_TEST_EXCLUSIVE", node, "HIGH", "Exclusive test selection can suppress the rest of the evidence suite");
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
      if (/@ts-(?:ignore|nocheck)/.test(source.text)) { unknown = true; fileTags.add("unknown"); emit(fileId, "TS_TYPE_SUPPRESSION", 1, "MEDIUM", "Type checking is suppressed at one or more sites; record the reason and expiry as a debt decision"); }
      if (fileCalls.has("setInterval") && !fileCalls.has("clearInterval")) emit(fileId, "TS_TIMER_CLEANUP", 1, "MEDIUM", "Interval allocation has no same-file cleanup; cross-file lifecycle ownership is unresolved");
      if ((fileCalls.has("addEventListener") || fileCalls.has("on")) && !fileCalls.has("removeEventListener") && !fileCalls.has("off")) emit(fileId, "TS_LISTENER_CLEANUP", 1, "MEDIUM", "Listener registration has no same-file removal; automatic or external ownership needs a model");
      if (fileCalls.has("subscribe") && !fileCalls.has("unsubscribe") && !fileCalls.has("takeUntil")) emit(fileId, "TS_SUBSCRIPTION_CLEANUP", 1, "MEDIUM", "Subscription cleanup is not visible in this file; establish terminal and cancellation paths");
      if (fileEffects.size > 120) { unknown = true; limitations.push(`Import/effect summary truncated in ${path}; use smaller components or dependency adapters`); }
      facts.push({ id: fileId, locator: fileLocator, path, language: /\.[cm]?jsx?$/.test(path) ? "JS" : "TS", kind: "FILE",
        contentHash: sha256(source.text), signatureHash: sha256("TS_FILE"), tags: [...fileTags].sort(),
        effects: [...fileEffects].sort().slice(0, 120), metrics: { lines: source.text.split(/\r?\n/).length, guards: fileGuards, assertions: fileAssertions }, line: 1 });
    }
    for (const cycle of stronglyConnected(imports)) {
      if (cycle.length < 2 && !imports.get(cycle[0]!)?.has(cycle[0]!)) continue;
      for (const file of cycle) {
        const id = fileIds.get(file); if (!id) continue;
        findings.push({ subjectId: id, ruleId: "TS_IMPORT_CYCLE", line: 1, severity: "MEDIUM",
          message: `Import cycle connects ${cycle.length} modules; review initialization order and layer ownership` });
      }
    }
    for (const group of duplicates.values()) if (group.length > 1) for (const fact of group) findings.push({
      subjectId: fact.id, ruleId: "TS_DUPLICATE_IMPLEMENTATION", line: fact.line, severity: "LOW",
      message: `Identical normalized body appears ${group.length} times; assess whether future changes must remain synchronized`,
    });
    const identities = new Set<string>();
    for (const fact of facts) {
      if (identities.has(fact.id)) throw new Error(`Ambiguous source identity at ${fact.path}; extraction must not overwrite a different declaration`);
      identities.add(fact.id);
    }
    limitations.push("Compiler type resolution is not an interprocedural behavioral proof; unresolved framework/lifecycle effects need contracts");
    const dependencyDigest = sha256(JSON.stringify({ compilerOptions: options, inputs: program.getSourceFiles().filter(source => !allowed.has(resolve(source.fileName)))
      .map(source => [relative(root, source.fileName).replaceAll("\\", "/"), sha256(source.text)]).sort((a, b) => a[0]!.localeCompare(b[0]!)) }));
    return { facts, dependencyDigest, findings: deduplicateFindings(findings), rulesExecuted: [...TS_RULES], analyzer: `typescript-${ts.version}/1.1.0`,
      coverage: { discovery: parseErrors ? "PARTIAL" : "COMPLETE", semantic: typeErrors || unknown ? "PARTIAL" : "RESOLVED",
        limitations: [...new Set(limitations)].slice(0, 100) } };
  }
}
