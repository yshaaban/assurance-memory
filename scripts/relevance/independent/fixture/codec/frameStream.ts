import { decodeFrame } from './frameCodec';
export function readFrames(frames: Uint8Array[]): string[] {
  return frames.map(decodeFrame);
}
