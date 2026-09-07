/** Population-aware NFR evaluation. Percentiles use nearest-rank order statistics; no component-percentile summation. */
export interface LatencyEnvelope {
  profileDigest: string;
  minimumAttempts: number;
  percentile: number;
  latencyBudgetMs: number;
  maximumRejectionRatio: number;
  maximumErrorRatio: number;
  concurrency: [number, number];
  payloadBytes: [number, number];
}
export interface RequestObservation {
  id: string;
  outcome: "SUCCESS" | "ERROR" | "REJECTED";
  durationMs: number;
  concurrency: number;
  payloadBytes: number;
}
export interface ObservationBatch {
  profileDigest: string;
  declaredAttempts: number;
  completePopulation: boolean;
  observations: RequestObservation[];
}
export interface BudgetResult {
  result: "PASS" | "FAIL" | "UNKNOWN";
  measurements: Record<string, number | null>;
  violations: string[];
  limitations: string[];
}
export function percentile(values: number[], p: number): number {
  if (values.length === 0 || !Number.isFinite(p) || p <= 0 || p > 1 || values.some(v => !Number.isFinite(v))) throw new Error("Invalid percentile input");
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(p * sorted.length) - 1]!;
}
export function evaluateLatency(envelope: LatencyEnvelope, batch: ObservationBatch): BudgetResult {
  if (!/^[a-f0-9]{64}$/.test(envelope.profileDigest) || !Number.isSafeInteger(envelope.minimumAttempts) || envelope.minimumAttempts < 1 ||
      !Number.isFinite(envelope.percentile) ||
      envelope.percentile <= 0 || envelope.percentile > 1 || !Number.isFinite(envelope.latencyBudgetMs) || envelope.latencyBudgetMs <= 0 ||
      [envelope.maximumErrorRatio, envelope.maximumRejectionRatio].some(v => !Number.isFinite(v) || v < 0 || v > 1) ||
      [envelope.concurrency, envelope.payloadBytes].some(([lo, hi]) => !Number.isFinite(lo) || !Number.isFinite(hi) || lo < 0 || hi < lo)) throw new Error("Invalid workload envelope");
  const limitations: string[] = [], violations: string[] = [];
  if (batch.profileDigest !== envelope.profileDigest) limitations.push("Workload profile differs from the approved profile");
  if (!batch.completePopulation || batch.declaredAttempts !== batch.observations.length) limitations.push("Population is incomplete; missing or sampled observations may hide tail latency");
  if (batch.observations.length < envelope.minimumAttempts) limitations.push("Insufficient attempts for the declared evidence policy");
  const ids = new Set<string>();
  for (const o of batch.observations) {
    if (ids.has(o.id)) throw new Error("Duplicate observation identity"); ids.add(o.id);
    if (!Number.isFinite(o.durationMs) || o.durationMs < 0 || !Number.isFinite(o.concurrency) || !Number.isFinite(o.payloadBytes)) throw new Error("Invalid observation");
    if (!["SUCCESS", "ERROR", "REJECTED"].includes(o.outcome)) throw new Error("Unknown observation outcome");
    if (o.concurrency < envelope.concurrency[0] || o.concurrency > envelope.concurrency[1] || o.payloadBytes < envelope.payloadBytes[0] || o.payloadBytes > envelope.payloadBytes[1]) limitations.push("Observed workload lies outside the approved envelope");
  }
  const total = batch.observations.length;
  const admitted = batch.observations.filter(o => o.outcome !== "REJECTED");
  const rejectionRatio = total ? batch.observations.filter(o => o.outcome === "REJECTED").length / total : null;
  const errorRatio = total ? batch.observations.filter(o => o.outcome === "ERROR").length / total : null;
  const latency = admitted.length ? percentile(admitted.map(o => o.durationMs), envelope.percentile) : null;
  if (latency === null) limitations.push("No admitted operations were observed");
  if (latency !== null && latency > envelope.latencyBudgetMs) violations.push("ADMITTED_LATENCY_BUDGET");
  if (rejectionRatio !== null && rejectionRatio > envelope.maximumRejectionRatio) violations.push("REJECTION_BUDGET");
  if (errorRatio !== null && errorRatio > envelope.maximumErrorRatio) violations.push("ERROR_BUDGET");
  return { result: limitations.length ? "UNKNOWN" : violations.length ? "FAIL" : "PASS",
    measurements: { attempts: total, admitted: admitted.length, latencyMs: latency, latencyMarginMs: latency === null ? null : envelope.latencyBudgetMs - latency,
      rejectionRatio, errorRatio }, violations, limitations: [...new Set(limitations)] };
}
/** Resources/budgets compose by their own algebra. Retry amplification is not additive. */
export function retryAmplification(attemptLimits: number[]): number {
  if (attemptLimits.some(n => !Number.isSafeInteger(n) || n < 1)) throw new Error("Attempt limits must be positive integers");
  const product = attemptLimits.reduce((a, b) => a * b, 1);
  if (!Number.isSafeInteger(product)) throw new Error("Retry bound exceeds safe integer range");
  return product;
}
