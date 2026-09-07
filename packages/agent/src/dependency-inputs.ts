import { createReadStream } from 'node:fs';
import { lstat, readdir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative, resolve } from 'node:path';
import { sha256 } from './util.js';

/** Hash explicit compiler classpaths by contents; a stable jar/directory name is not a version. */
export async function dependencyInputs(paths: string[]): Promise<string> {
  const entries: Array<[number, string, string]> = [];
  let files = 0, bytes = 0;
  for (const [position, input] of paths.entries()) {
    const root = await realpath(resolve(input));
    const pending = [root];
    while (pending.length) {
      const path = pending.pop()!;
      const info = await lstat(path);
      if (info.isSymbolicLink()) throw new Error('Classpath contains a symlink; supply explicit resolved compiler inputs');
      const name = relative(root, path).replaceAll('\\', '/') || '.';
      if (info.isDirectory()) {
        entries.push([position, name, 'DIRECTORY']);
        for (const child of (await readdir(path)).sort().reverse()) pending.push(join(path, child));
      } else if (info.isFile()) {
        if (++files > 100000 || (bytes += info.size) > 512_000_000) throw new Error('Classpath fingerprint budget exceeded; split the build target');
        const digest = createHash('sha256');
        for await (const chunk of createReadStream(path)) digest.update(chunk);
        entries.push([position, name, digest.digest('hex')]);
      } else throw new Error('Classpath contains an unsupported filesystem entry');
    }
  }
  return sha256(JSON.stringify(entries));
}
