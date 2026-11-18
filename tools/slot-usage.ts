/**
 * Which `dsh` slots does each installed client bundle touch?
 *
 * The shell's sidebar can be replaced by another bundle (`dsh-better-sidebar`
 * does exactly that), and a replacement is free to drop a seat it does not know
 * about. When a new row does not appear even though registration succeeded, this
 * is the question to ask: is the seat the row went into still the one being
 * drawn?
 *
 *   node tools/slot-usage.ts [profileDir]
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const profile = resolve(process.argv[2] ?? process.env.DSH_PROFILE_DIR ?? 'D:/Users/zigang.wang/.dsh/profiles/desktop');
const modules = join(profile, 'node_modules');

const INTERESTING = /^(?:sidebar|main|settings)\b/;

function isDir(path: string): boolean {
  // A link-installed bundle (this repo's own plugin) is a junction on Windows.
  // `Dirent.isDirectory()` is false for a junction, so following it explicitly
  // is the difference between seeing a package and silently skipping it.
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function walk(dir: string, out: string[], depth: number): void {
  if (depth > 4) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (isDir(path)) walk(path, out, depth + 1);
    else if (/\.(?:js|mjs|cjs)$/.test(entry.name)) out.push(path);
  }
}

const files: string[] = [];
walk(modules, files, 0);

/** slot name → packages that register into or inject it */
const usage = new Map<string, Set<string>>();

/**
 * Two shapes, and missing the first one is how this tool would report "nobody
 * draws a sidebar" for a profile full of sidebars:
 *
 *   slots.inject('sidebar.panellist', …)              ← slot as a string
 *   slots.register({ name: 'sidebar.panellist', … })  ← slot inside an object
 */
const INJECT_STRING = /slots\.inject\(\s*['"]([a-z][a-z0-9.]*)['"]/g;
const REGISTER_OBJECT = /slots\.register\(\s*\{/g;
const NAME_FIELD = /\bname:\s*['"]([a-z][a-z0-9.]*)['"]/;

for (const file of files) {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const owner = file.slice(modules.length + 1).split(/[\\/]/)[0].replace(/^@/, '');
  const record = (slot: string): void => {
    if (!INTERESTING.test(slot)) return;
    if (!usage.has(slot)) usage.set(slot, new Set());
    usage.get(slot)?.add(owner);
  };

  INJECT_STRING.lastIndex = 0;
  let match;
  while ((match = INJECT_STRING.exec(text)) !== null) record(match[1]);

  REGISTER_OBJECT.lastIndex = 0;
  while ((match = REGISTER_OBJECT.exec(text)) !== null) {
    // The slot name is a field of the options object, which is short; a window
    // this size cannot reach the next registration.
    const name = NAME_FIELD.exec(text.slice(match.index, match.index + 320));
    if (name !== null) record(name[1]);
  }
}

const rows = [...usage].sort(([a], [b]) => a.localeCompare(b));
process.stdout.write(`slots used under ${profile}:\n`);
for (const [slot, owners] of rows) {
  process.stdout.write(`  ${slot.padEnd(34)} ${[...owners].sort().join(', ')}\n`);
}

const panellist = usage.get('sidebar.panellist');
if (panellist === undefined) {
  process.stdout.write('\nnothing registers into `sidebar.panellist`; a row cannot appear\n');
} else if (panellist.size > 1) {
  process.stdout.write(`\n${panellist.size} packages share \`sidebar.panellist\`; check that the one drawing the sidebar keeps it\n`);
}
