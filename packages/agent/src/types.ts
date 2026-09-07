export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };
export type Coverage = {
  discovery: "COMPLETE" | "PARTIAL";
  semantic: "RESOLVED" | "PARTIAL";
  limitations: string[];
};
export interface Fact {
  id: string;
  locator: string;
  path: string;
  language: "TS" | "JS" | "JAVA" | "CONFIG";
  kind: string;
  contentHash: string;
  signatureHash: string;
  tags: string[];
  effects: string[];
  metrics: Record<string, number>;
  line: number;
}
export interface Finding {
  subjectId: string;
  ruleId: string;
  line: number;
  severity: "HIGH" | "MEDIUM" | "LOW";
  message: string;
}
export interface AnalysisResult {
  facts: Fact[];
  findings: Finding[];
  coverage: Coverage;
  rulesExecuted: string[];
  analyzer: string;
  dependencyDigest?: string;
}
export interface LayerRule {
  name: string;
  match: string;
  mayImport: string[];
}
export interface ComponentConfig {
  root: string;
  tsconfig?: string;
  exclude?: string[];
  layers?: LayerRule[];
  maxFiles?: number;
  maxFileBytes?: number;
  environment?: Record<string, string>;
  /** Local JDK adapter classpath. Never sent to a remote service. */
  javaClasspath?: string[];
  javaCoreClassPath?: string;
}
export interface WorkspaceConfig {
  workspace: string;
  components: Record<string, ComponentConfig>;
}
export interface ClaimCheck {
  id: string;
  kind: "STATIC" | "TEST" | "MODEL" | "BENCHMARK" | "TRACE" | "REVIEW";
  checker: string;
  version: string;
  maxAgeSeconds?: number;
}
export interface ClaimInput {
  id: string;
  expectedRevision: number;
  statement: string;
  owner: string;
  components: string[];
  watch: string[];
  quantification: "ALL_MATCHING" | "EXACT_SUBJECTS";
  checks: ClaimCheck[];
  mode: "DIRECT" | "DECOMPOSED" | "BOTH";
  critical?: boolean;
  allowPartialAnalysis?: boolean;
  definitions?: JsonObject;
  sources?: Json[];
}
export interface Page<T> {
  items: T[];
  hasMore: boolean;
  next: string;
}
export interface Row<T> { id: string; version: number; value: T }
export interface Head {
  component: string;
  head: string;
  sourceRevision: string;
  coverage: Coverage;
  contextDigest: string;
  configurationDigest: string;
  environment: Record<string, string>;
}
export interface PreparedPlan {
  id: string;
  actor: string;
  heads: Record<string, string>;
  claimPins: Record<string, { revision: number; generation: number }>;
  policyEpoch: number;
  leaseKeys: string[];
  leases: Array<{ key: string; fence: number }>;
  status: string;
}
export interface ContextPack {
  plan: PreparedPlan;
  mandatoryClaimPins: PreparedPlan["claimPins"];
  claimDetails: JsonObject[];
  claimDetailsTruncated: boolean;
  remainingClaimIds: string[];
  findingIds: string[];
  debtIds: string[];
}
export interface Job {
  id: string;
  claimId: string;
  revision: number;
  generation: number;
  check: Required<ClaimCheck>;
  dependencies: Record<string, string>;
  contexts: Record<string, Head>;
  state: "QUEUED" | "RUNNING" | "COMPLETE" | "SUPERSEDED";
  fence: number;
  leaseUntil: number;
}
