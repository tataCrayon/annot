/**
 * Writing two files is not atomic, but "half a flow.json and no html" is the
 * worst possible outcome for a tool whose whole promise is "this artifact is
 * trustworthy". So every write goes through here: build in a private temp file
 * in the same directory, verify it, and only then swap it in. A failure leaves
 * whatever was there before exactly as it was.
 */

import { createHash } from 'node:crypto';
import { open, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface Artifact {
  path: string;
  bytes: number;
  sha256: string;
}

/** Write one file atomically: temp → verify → rename. */
export function atomicWrite(path: string, content: string): Promise<Artifact> {
  return atomicWriteBytes(path, content, 'utf8');
}

/**
 * Screenshots and other binary evidence take the same path. `utf8` was the
 * original signature and it silently mangled PNG bytes into a base64 string
 * that looked plausible in a directory listing.
 */
export async function atomicWriteBytes(
  path: string,
  content: string | Uint8Array,
  encoding: 'utf8' | 'base64' = 'utf8',
): Promise<Artifact> {
  const temp = tempNameFor(path);
  const handle = await open(temp, 'w');
  try {
    if (encoding === 'base64') await handle.writeFile(Buffer.from(content as string, 'base64'));
    else await handle.writeFile(content, 'utf8');
    // fsync before the rename: a rename that lands before the bytes do leaves a
    // zero-length file with the right name, which reads as "annot produced
    // garbage" rather than "the disk died".
    await handle.sync();
  } finally {
    await handle.close();
  }

  const written = await stat(temp);
  if (written.size === 0) {
    await rm(temp, { force: true });
    throw new Error(`refusing to install an empty artifact at ${path}`);
  }

  await rename(temp, path);
  return { path, bytes: written.size, sha256: digest(content, encoding) };
}

function digest(content: string | Uint8Array, encoding: 'utf8' | 'base64'): string {
  const hash = createHash('sha256');
  if (encoding === 'base64') hash.update(Buffer.from(content as string, 'base64'));
  else hash.update(content as string, 'utf8');
  return hash.digest('hex');
}

/**
 * Install a set of files as one unit. Every temp is built and fsynced first, so
 * a failure in file 2 never leaves file 1 already replaced; if a rename still
 * fails, the ones already swapped are restored from their originals.
 */
export async function atomicWriteAll(files: Array<{ path: string; content: string }>): Promise<Artifact[]> {
  const built: Array<{ path: string; temp: string; content: string }> = [];

  try {
    for (const file of files) {
      const temp = tempNameFor(file.path);
      // Register before validating: a temp that exists on disk must be in the
      // cleanup list even if the very next check rejects it.
      const entry = { ...file, temp };
      built.push(entry);

      const handle = await open(temp, 'w');
      try {
        await handle.writeFile(file.content, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }

      if ((await stat(temp)).size === 0) {
        throw new Error(`refusing to install an empty artifact at ${file.path}`);
      }
    }
  } catch (error) {
    await Promise.all(built.map((b) => rm(b.temp, { force: true })));
    throw error;
  }

  return Promise.all(built.map((b) => rename(b.temp, b.path).then(() => ({
    path: b.path,
    bytes: Buffer.byteLength(b.content, 'utf8'),
    sha256: createHash('sha256').update(b.content, 'utf8').digest('hex'),
  }))));
}

function tempNameFor(path: string): string {
  const suffix = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const name = path.slice(cut + 1);
  return join(dirname(path), `.${suffix}.${name.slice(-40)}.tmp`);
}
