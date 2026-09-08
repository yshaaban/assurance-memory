export function decodeFrame(bytes: Uint8Array): string {
  if (bytes.length < 2) throw new Error('short frame');
  return new TextDecoder().decode(bytes.slice(2));
}
