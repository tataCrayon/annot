/**
 * Filesystem conventions. A skill is a directory holding SKILL.md; the same
 * file may be reachable from several roots, so discovery is explicit about
 * rank instead of merging silently — the highest-ranked root wins, exactly
 * like the hosts do it.
 *
 * The caller chooses the roots. `defaultRoots` is an explicit, bounded list of
 * common agent configuration directories; discovery never walks the rest of a
 * disk or guesses from arbitrary filenames.
 */

import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

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

const MAX_SKILL_SEARCH_DEPTH = 5;

/**
 * Lower rank wins. Project Skills outrank user Skills, and the shared Agents
 * directory outranks host-specific mirrors of the same library.
 */
export const DEFAULT_RANKS = {
  projectAgents: 100,
  projectClaude: 110,
  projectCodex: 120,
  projectCursor: 130,
  projectCopilot: 140,
  projectGemini: 150,
  projectOpenCode: 160,
  projectDsh: 170,
  projectZcode: 180,
  custom: 300,
  userAgents: 400,
  userClaude: 410,
  userCodex: 420,
  userCursor: 430,
  userCopilot: 440,
  userGemini: 450,
  userOpenCode: 460,
  userDsh: 470,
  userZcode: 480,
  bundled: 600,
} as const;

/**
 * Common Skill directories used by agent hosts. This is deliberately a closed
 * list: it covers the standard shared Agents location plus the documented
 * project and user roots for Claude Code, Codex, Cursor, GitHub Copilot,
 * Gemini CLI, OpenCode, DSH and ZCode. Explicit roots still win when a caller supplies
 * them.
 *
 * Codex now reads `.agents/skills`; `.codex/skills` stays as a compatibility
 * root for older layouts. Gemini CLI is likewise kept as a legacy entry after
 * its replacement by Antigravity CLI. Missing directories stay in the result
 * so status can explain them.
 */
export function defaultRoots(options: {
  home?: string;
  cwd?: string;
  codexHome?: string;
  claudeHome?: string;
} = {}): RootSpec[] {
  const home = options.home ?? '';
  const cwd = options.cwd ?? '';
  const roots: RootSpec[] = [];
  const seen = new Set<string>();
  const add = (path: string, rank: number, label: string) => {
    const absolute = resolve(path);
    const key = process.platform === 'win32' ? absolute.toLowerCase() : absolute;
    if (seen.has(key)) return;
    seen.add(key);
    roots.push({ path, rank, label });
  };

  if (cwd) {
    add(join(cwd, '.agents', 'skills'), DEFAULT_RANKS.projectAgents, 'project · shared Agents (Codex official)');
    add(join(cwd, '.claude', 'skills'), DEFAULT_RANKS.projectClaude, 'project · Claude Code');
    add(join(cwd, '.codex', 'skills'), DEFAULT_RANKS.projectCodex, 'project · Codex compatibility');
    add(join(cwd, '.cursor', 'skills'), DEFAULT_RANKS.projectCursor, 'project · Cursor');
    add(join(cwd, '.github', 'skills'), DEFAULT_RANKS.projectCopilot, 'project · GitHub Copilot');
    add(join(cwd, '.gemini', 'skills'), DEFAULT_RANKS.projectGemini, 'project · Gemini CLI legacy');
    add(join(cwd, '.opencode', 'skills'), DEFAULT_RANKS.projectOpenCode, 'project · OpenCode');
    add(join(cwd, '.dsh', 'skills'), DEFAULT_RANKS.projectDsh, 'project · DSH');
    add(join(cwd, '.zcode', 'skills'), DEFAULT_RANKS.projectZcode, 'project · ZCode');
  }
  if (home) {
    add(join(home, '.agents', 'skills'), DEFAULT_RANKS.userAgents, 'user · shared Agents (Codex official)');
    add(join(options.claudeHome ?? join(home, '.claude'), 'skills'), DEFAULT_RANKS.userClaude, 'user · Claude Code');
    add(join(options.codexHome ?? join(home, '.codex'), 'skills'), DEFAULT_RANKS.userCodex, 'user · Codex compatibility');
    add(join(home, '.cursor', 'skills'), DEFAULT_RANKS.userCursor, 'user · Cursor');
    add(join(home, '.copilot', 'skills'), DEFAULT_RANKS.userCopilot, 'user · GitHub Copilot');
    add(join(home, '.gemini', 'skills'), DEFAULT_RANKS.userGemini, 'user · Gemini CLI legacy');
    add(join(home, '.config', 'opencode', 'skills'), DEFAULT_RANKS.userOpenCode, 'user · OpenCode');
    add(join(home, '.dsh', 'skills'), DEFAULT_RANKS.userDsh, 'user · DSH');
    add(join(home, '.zcode', 'skills'), DEFAULT_RANKS.userZcode, 'user · ZCode');
  }
  return roots;
}
export async function discoverSkills(roots: RootSpec[]): Promise<{ skills: SkillRef[]; skipped: Array<{ root: string; reason: string }> }> {
  const skipped: Array<{ root: string; reason: string }> = [];
  const byName = new Map<string, SkillRef>();

  for (const root of roots) {
    const abs = resolve(root.path);
    let skillsInRoot: Array<{ dir: string; file: string }>;
    try {
      if (!(await stat(abs)).isDirectory()) {
        skipped.push({ root: abs, reason: 'not a directory' });
        continue;
      }
      skillsInRoot = await findSkillsInRoot(abs);
    } catch {
      skipped.push({ root: abs, reason: 'unreadable' });
      continue;
    }

    for (const candidate of skillsInRoot) {
      let text: string;
      try {
        text = await readFile(candidate.file, 'utf8');
      } catch {
        continue;
      }
      const name = frontmatterName(text) ?? basename(candidate.dir);
      const ref: SkillRef = { name, dir: candidate.dir, file: candidate.file, root: abs, rank: root.rank };
      const existing = byName.get(name);
      if (!existing || ref.rank < existing.rank || (ref.rank === existing.rank && ref.file.localeCompare(existing.file) < 0)) {
        byName.set(name, ref);
      }
    }
  }

  return {
    skills: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
    skipped,
  };
}

async function findSkillsInRoot(root: string): Promise<Array<{ dir: string; file: string }>> {
  const found: Array<{ dir: string; file: string }> = [];
  const visited = new Set<string>();

  const visit = async (dir: string, depth: number): Promise<void> => {
    const realDir = await realpath(dir);
    const key = process.platform === 'win32' ? realDir.toLowerCase() : realDir;
    if (visited.has(key)) return;
    visited.add(key);

    const entries = await readdir(dir, { withFileTypes: true });
    const skillEntry = entries.find((entry) => entry.name === 'SKILL.md');
    if (skillEntry && (skillEntry.isFile() || skillEntry.isSymbolicLink())) {
      found.push({ dir, file: join(dir, 'SKILL.md') });
      return;
    }
    if (depth >= MAX_SKILL_SEARCH_DEPTH) return;

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const child = join(dir, entry.name);
      try {
        if (!(await stat(child)).isDirectory()) continue;
        await visit(child, depth + 1);
      } catch {
        // One inaccessible or dangling child must not hide readable siblings.
      }
    }
  };

  await visit(root, 0);
  return found;
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
