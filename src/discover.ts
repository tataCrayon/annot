/**
 * Filesystem conventions. A skill is a directory holding SKILL.md; the same
 * file may be reachable from several roots, so discovery is explicit about
 * rank instead of merging silently — the highest-ranked root wins, exactly
 * like the hosts do it.
 *
 * Nothing here reads outside the roots it is given: no home-directory
 * guessing, no recursive walk of a whole disk.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export interface SkillRef {
  name: string;
  dir: string;
  file: string;
  root: string;
  rank: number;
}

export interface RootSpec {
  path: string;
  rank: number;
  label: string;
}

/** Lower rank wins. Mirrors the order the agent hosts resolve duplicates. */
export const DEFAULT_RANKS = {
  projectDsh: 100,
  projectAgents: 200,
  custom: 300,
  userDsh: 400,
  userAgents: 500,
  bundled: 600,
} as const;

/**
 * The roots a host actually reads, derived from a home directory and a working
 * directory instead of hard-coded absolute paths. Used by the DSH shell, where
 * "which skill did the user mean" and "which skill did DSH load" must be the
 * same answer.
 *
 * Deliberately no `runtime` entry (rank 250 in the host's numbering): runtime
 * registered skills have no directory to scan, so listing them would only make
 * annot disagree with the host about what exists.
 */
export function defaultRoots(options: { home?: string; cwd?: string } = {}): RootSpec[] {
  const home = options.home ?? '';
  const cwd = options.cwd ?? '';
  const roots: RootSpec[] = [];
  if (cwd) {
    roots.push({ path: join(cwd, '.dsh', 'skills'), rank: DEFAULT_RANKS.projectDsh, label: 'project · .dsh/skills' });
    roots.push({ path: join(cwd, '.agents', 'skills'), rank: DEFAULT_RANKS.projectAgents, label: 'project · .agents/skills' });
  }
  if (home) {
    roots.push({ path: join(home, '.dsh', 'skills'), rank: DEFAULT_RANKS.userDsh, label: 'user · ~/.dsh/skills' });
    roots.push({ path: join(home, '.agents', 'skills'), rank: DEFAULT_RANKS.userAgents, label: 'user · ~/.agents/skills' });
  }
  return roots;
}

export async function discoverSkills(roots: RootSpec[]): Promise<{ skills: SkillRef[]; skipped: Array<{ root: string; reason: string }> }> {
  const skipped: Array<{ root: string; reason: string }> = [];
  const byName = new Map<string, SkillRef>();

  for (const root of roots) {
    const abs = resolve(root.path);
    let entries: Awaited<ReturnType<typeof readdir>>;
    try {
      if (!(await stat(abs)).isDirectory()) {
        skipped.push({ root: abs, reason: 'not a directory' });
        continue;
      }
      entries = await readdir(abs, { withFileTypes: true });
    } catch {
      skipped.push({ root: abs, reason: 'unreadable' });
      continue;
    }

    for (const entry of entries) {
      const isDir = entry.isDirectory() || entry.isSymbolicLink();
      const dir = join(abs, entry.name);
      if (!isDir) continue;
      const file = join(dir, 'SKILL.md');
      let text: string;
      try {
        text = await readFile(file, 'utf8');
      } catch {
        continue;
      }
      const name = frontmatterName(text) ?? entry.name;
      const ref: SkillRef = { name, dir, file, root: abs, rank: root.rank };
      const existing = byName.get(name);
      if (!existing || ref.rank < existing.rank) byName.set(name, ref);
    }
  }

  return {
    skills: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
    skipped,
  };
}

function frontmatterName(text: string): string | undefined {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return undefined;
  const name = /^name\s*:\s*(.+)$/m.exec(m[1]);
  return name ? name[1].trim().replace(/^["']|["']$/g, '') : undefined;
}

export async function readText(path: string): Promise<string> {
  return readFile(path, 'utf8');
}
