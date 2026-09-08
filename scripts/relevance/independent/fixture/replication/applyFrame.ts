import { isCurrentEpoch } from './epochFence';
export function applyFrame(frameEpoch: number, liveEpoch: number, events: string[]): string[] {
  if (!isCurrentEpoch(frameEpoch, liveEpoch)) return [];
  return events.slice();
}
