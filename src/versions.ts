import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { discoverSkills, type RootSpec } from './discover.ts';

export interface SnapshotSkill {
  name: string;
  file: string;
  sha256: string;
  content: string;
}

export interface SnapshotDocument {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  label: string;
  fingerprint: string;
  skills: SnapshotSkill[];
  skipped: Array<{ root: string; reason: string }>;
}

export interface SnapshotSummary {
  id: string;
  createdAt: string;
  label: string;
  fingerprint: string;
  skills: number;
  path: string;
}

export interface SnapshotDiff {
  from: SnapshotSummary;
  to: SnapshotSummary;
  unchanged: number;
  added: string[];
  removed: string[];
  changed: string[];
}

const HASH = (value: string) => createHash('sha256').update(value).digest('hex');
const SNAPSHOT_ID = /^[0-9TZ-]+-[0-9a-f-]{8}$/;

function snapshotName(id: string): string {
  return `${id}.json`;
}

function summaryOf(document: SnapshotDocument, path: string): SnapshotSummary {
  return {
    id: document.id,
    createdAt: document.createdAt,
    label: document.label,
    fingerprint: document.fingerprint,
    skills: document.skills.length,
    path,
  };
}

export async function createSnapshot(roots: RootSpec[], directory: string, label = 'manual'): Promise<SnapshotSummary> {
  const { skills, skipped } = await discoverSkills(roots);
  const records: SnapshotSkill[] = [];
  for (const ref of skills) {
    try {
      const content = await readFile(ref.file, 'utf8');
      records.push({ name: ref.name, file: ref.file, sha256: HASH(content), content });
    } catch {
      skipped.push({ root: ref.file, reason: 'unreadable' });
    }
  }
  records.sort((a, b) => a.name.localeCompare(b.name) || a.file.localeCompare(b.file));
  const fingerprint = HASH(records.map((record) => `${record.name}:${record.sha256}`).join('\n')).slice(0, 16);
  const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '');
  const id = `${stamp}-${randomUUID().slice(0, 8)}`;
  const createdAt = new Date().toISOString();
  const document: SnapshotDocument = { schemaVersion: 1, id, createdAt, label: label.trim().slice(0, 120) || 'manual', fingerprint, skills: records, skipped };
  await mkdir(directory, { recursive: true });
  const path = join(directory, snapshotName(id));
  await writeFile(path, JSON.stringify(document, null, 2) + '\n', 'utf8');
  return summaryOf(document, path);
}
async function readSnapshot(directory: string, id: string): Promise<{ document: SnapshotDocument; summary: SnapshotSummary }> {
  if (!SNAPSHOT_ID.test(id)) throw new Error('invalid snapshot id');
  const path = join(directory, snapshotName(id));
  const document = JSON.parse(await readFile(path, 'utf8')) as SnapshotDocument;
  if (document.schemaVersion !== 1 || document.id !== id || !Array.isArray(document.skills)) throw new Error('invalid snapshot document');
  return { document, summary: summaryOf(document, path) };
}

export async function listSnapshots(directory: string): Promise<SnapshotSummary[]> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const summaries: SnapshotSummary[] = [];
  for (const name of names.filter((entry) => entry.endsWith('.json'))) {
    try {
      const document = JSON.parse(await readFile(join(directory, name), 'utf8')) as SnapshotDocument;
      if (document.schemaVersion === 1 && SNAPSHOT_ID.test(document.id)) summaries.push(summaryOf(document, join(directory, name)));
    } catch {}
  }
  return summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function diffSnapshots(directory: string, fromId: string, toId: string): Promise<SnapshotDiff> {
  const [from, to] = await Promise.all([readSnapshot(directory, fromId), readSnapshot(directory, toId)]);
  const fromMap = new Map(from.document.skills.map((skill) => [skill.name, skill]));
  const toMap = new Map(to.document.skills.map((skill) => [skill.name, skill]));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  let unchanged = 0;
  for (const [name, skill] of toMap) {
    const before = fromMap.get(name);
    if (!before) added.push(name);
    else if (before.sha256 !== skill.sha256) changed.push(name);
    else unchanged += 1;
  }
  for (const name of fromMap.keys()) if (!toMap.has(name)) removed.push(name);
  return { from: from.summary, to: to.summary, unchanged, added, removed, changed };
}