/** Deliberately unsafe input used to demonstrate candidate diagnostics, not application code. */
interface Repository { save(value: unknown): Promise<void> }
declare const repository: Repository;
export async function processJobs(jobs: unknown[], signal: AbortSignal): Promise<void> {
  jobs.forEach(async job => { await repository.save(job); });
  repository.save({ detached: true });
  setInterval(() => console.log("retained timer"), 1000);
  try { await Promise.all(jobs.map(job => repository.save(job))); } catch { }
  await fetch("https://example.invalid/work");
}
export function deserialize(payload: any): unknown { return JSON.parse(payload); }
