export function chooseDelay(attempt: number): number {
  return Math.min(10000, 100 * 2 ** attempt);
}
