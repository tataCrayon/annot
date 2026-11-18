/**
 * Which sidebar rows does this profile actually have, and in what order?
 *
 * `sidebar.panellist` sorts by `order` and hides rows the user unpinned. When a
 * new row does not appear, the useful question is not "did my registration
 * throw" (the page already reports that) but "is my row behind a More menu, or
 * tied with another bundle at the same order".
 *
 *   node tools/panel-orders.ts [profileDir]
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const profile = resolve(process.argv[2] ?? process.env.DSH_PROFILE_DIR ?? 'D:/Users/zigang.wang/.dsh/profiles/desktop');
const modules = join(profile, 'node_modules');

interface Hit {
  file: string;
  id?: string;
  order?: number;
  label?: string;
}

const hits: Hit[] = [];

function isDir(path: string): boolean {
  // A link-installed bundle is a junction on Windows, and `Dirent.isDirectory()`
  // is false for one — which silently skipped this repo's own plugin.
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function walk(dir: string, depth: number): void {
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
    if (isDir(path)) {
      walk(path, depth + 1);
      continue;
    }
    if (!/\.(?:js|mjs|cjs|ts)$/.test(entry.name)) continue;
    let text: string;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    if (!text.includes('sidebar.panellist')) continue;

    // The registration call, not the slot name in a comment: look for the id
    // and order that sit inside one object literal after the slot name.
    const parts = text.split('sidebar.panellist');
    for (let i = 0; i < parts.length - 1; i += 1) {
      const window = parts[i + 1].slice(0, 400);
      // The id may be a literal or a constant (`id: PANEL_ID`); both are answers.
      const id = /\bid:\s*(?:['"]([A-Za-z0-9_-]+)['"]|([A-Z][A-Z0-9_]+))/.exec(window);
      const order = /\border:\s*(\d+)/.exec(window)?.[1];
      const label = /\blabel:\s*(?:\(\s*\)\s*=>\s*)?['"]([^'"]+)['"]/.exec(window)?.[1];
      if (id !== null || order !== undefined) {
        hits.push({
          file: path.slice(modules.length + 1),
          id: id === null ? undefined : id[1] ?? `{${id[2]}}`,
          order: order === undefined ? undefined : Number(order),
          label,
        });
      }
    }
  }
}

if (!statSync(modules, { throwIfNoEntry: false })) {
  process.stdout.write(`no node_modules under ${profile}\n`);
  process.exit(2);
}

walk(modules, 0);

hits.sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || String(a.id).localeCompare(String(b.id)));

const seen = new Set<string>();
const rows: string[] = [];
for (const hit of hits) {
  const key = `${hit.id ?? '?'}@${hit.order ?? '?'}`;
  if (seen.has(key)) continue;
  seen.add(key);
  rows.push(`  order ${String(hit.order ?? '?').padStart(4)}  ${(hit.id ?? '?').padEnd(24)} ${hit.label ?? ''}  (${hit.file})`);
}

process.stdout.write(`sidebar.panellist rows declared in ${profile}:\n`);
process.stdout.write(rows.length ? `${rows.join('\n')}\n` : '  (none found)\n');

const orders = [...seen].map((key) => Number(key.split('@')[1])).filter((n) => Number.isFinite(n));
const duplicates = orders.filter((order, index) => orders.indexOf(order) !== index);
if (duplicates.length > 0) {
  process.stdout.write(`\nwarning: order values declared more than once: ${[...new Set(duplicates)].join(', ')}\n`);
  process.stdout.write('two rows with the same order sort unpredictably; give the new row its own number\n');
}
