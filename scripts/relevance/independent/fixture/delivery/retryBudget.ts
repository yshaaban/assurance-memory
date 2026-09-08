export function canRetry(attempt: number, maximum: number): boolean {
  // Exhaustion is a count policy, independent of the delay cap.
  return attempt < maximum;
}
