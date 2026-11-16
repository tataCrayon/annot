/**
 * A flow.json on its own cannot say where it came from. `check` used to guess
 * `../SKILL.md`, which is only right for the default output directory and
 * silently wrong for `--out`. So every annotation also writes a small manifest
 * beside the artifacts: it records the source path *relative to the artifact
 * directory*, the source hash at generation time, and the hash of each artifact.
 *
 * That makes two questions answerable without touching the skill:
 *   - which file is this graph about?
 *   - did someone hand-edit the html after we wrote it?
 */

import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import type { Artifact } from './fsx.ts';

export const MANIFEST_NAME = 'annotation.json';

export interface Manifest {
  schema_version: 1;
  skill: string;
  /** Source file path relative to this manifest, so the pair can move together. */
  source: { file: string; sha: string; lines: number };
  artifacts: Array<{ file: string; bytes: number; sha256: string }>;
  generated_at: string;
}

export function buildManifest(input: {
  skill: string;
  sourceFile: string;
  sourceSha: string;
  sourceLines: number;
  outDir: string;
  artifacts: Artifact[];
  now?: () => string;
}): Manifest {
  const rel = portable(relative(input.outDir, resolve(input.sourceFile)));
  return {
    schema_version: 1,
    skill: input.skill,
    // `relative` yields '' when both paths are the same file, which would be a
    // manifest pointing at nothing; keep the absolute path in that case.
    source: {
      file: rel === '' ? portable(resolve(input.sourceFile)) : rel,
      sha: input.sourceSha,
      lines: input.sourceLines,
    },
    artifacts: input.artifacts.map((a) => ({
      file: portable(relative(input.outDir, a.path)) || portable(a.path),
      bytes: a.bytes,
      sha256: a.sha256,
    })),
    generated_at: (input.now ?? (() => new Date().toISOString()))(),
  };
}

/**
 * The manifest is a committed artifact, so its paths must not depend on which
 * OS wrote it: a Windows-authored `..\..\SKILL.md` would fail to resolve after
 * a checkout on Linux, which is exactly when nobody is looking.
 */
function portable(path: string): string {
  return path.replace(/\\/g, '/');
}

export function manifestContent(manifest: Manifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export async function readManifest(outDir: string): Promise<Manifest | undefined> {
  try {
    const raw = JSON.parse(await readFile(join(outDir, MANIFEST_NAME), 'utf8')) as Manifest;
    return raw?.schema_version === 1 ? raw : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve the skill source for a flow file, most-specific rule first:
 * manifest → same directory → walk up a few levels → the old `..` guess.
 * The walk is bounded: guessing further than a handful of levels turns a
 * missing file into a search across the user's home directory.
 */
export async function resolveSkillPath(flowPath: string, declaredName: string): Promise<string> {
  const outDir = dirname(resolve(flowPath));

  const manifest = await readManifest(outDir);
  if (manifest) {
    const candidate = isAbsolute(manifest.source.file) ? manifest.source.file : resolve(outDir, manifest.source.file);
    if (await exists(candidate)) return candidate;
  }

  let dir = outDir;
  for (let depth = 0; depth < 4; depth++) {
    const candidate = join(dir, declaredName);
    if (await exists(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return resolve(outDir, '..', declaredName);
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path, 'utf8');
    return true;
  } catch {
    return false;
  }
}
