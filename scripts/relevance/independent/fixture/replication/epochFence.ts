export function isCurrentEpoch(frameEpoch: number, liveEpoch: number): boolean {
  return frameEpoch === liveEpoch;
}
