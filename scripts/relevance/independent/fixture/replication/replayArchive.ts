export function replayHistoricalFrame(recordedEpoch: number, events: string[]): string[] {
  // Historical replay accepts recorded epochs deliberately; this is not live replication.
  return recordedEpoch >= 0 ? events.slice() : [];
}
