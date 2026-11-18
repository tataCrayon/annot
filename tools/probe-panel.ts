/**
 * Probe the live GUI for the Annot panel, using the same CDP client the render
 * check uses. This is not a test — it is a one-shot look at whether the panel
 * the plugin registers is actually reachable in the running page.
 *
 *   node tools/probe-panel.ts [url]
 *
 * The page is auth-gated by the host, so this probe is often unable to answer
 * the browser half of the question. It therefore always asks the host's own
 * selfcheck route first: that answer needs no browser, and it distinguishes
 * "never composed" from "composed but the page never ran it" — which is the
 * part a 401 can never tell you.
 */

import { openBrowser } from '../src/browser.ts';

const base = (process.argv[2] ?? process.env.DSH_WEB_URL ?? 'http://127.0.0.1:51562').replace(/\/+$/, '');

interface Selfcheck {
  package?: string;
  client?: { platform?: string; entry?: string; exists?: boolean; bytes?: number };
  composed?: { registered?: boolean; total?: number; rev?: string; url?: string };
  reports?: Array<{ event?: string; at?: string }>;
}

async function selfcheck(): Promise<Selfcheck | undefined> {
  try {
    const res = await fetch(`${base}/api/annot/selfcheck`);
    if (!res.ok) return { client: {}, reports: [] };
    return (await res.json()) as Selfcheck;
  } catch {
    return undefined;
  }
}

const state = await selfcheck();
process.stdout.write(`target: ${base}\n`);

if (state === undefined) {
  process.stdout.write('  the host is not answering; nothing else can be checked\n');
  process.exit(2);
}

const composed = state.composed;
const reports = state.reports ?? [];

if (composed === undefined) {
  // The registry service is absent, which means this profile serves no client
  // modules at all — a different failure from "we were left out of the graph".
  process.stdout.write('  client modules: no registry in this profile\n');
} else if (composed.registered !== true) {
  process.stdout.write(`  client modules: NOT composed (${composed.total ?? '?'} packages are)\n`);
  process.stdout.write('    → the package is not in the boot graph; check dsh.client / exports["./client"]\n');
} else {
  process.stdout.write(`  client modules: composed, rev ${composed.rev}\n`);
  process.stdout.write(`    bundle: ${composed.url}\n`);
}

const seen = new Map<string, number>();
for (const report of reports) {
  const event = String(report.event ?? '?');
  seen.set(event, (seen.get(event) ?? 0) + 1);
}

if (composed?.registered === true) {
  if (reports.length === 0) {
    process.stdout.write('  page reports: none — the bundle never executed in a browser\n');
  } else {
    process.stdout.write(`  page reports: ${[...seen].map(([event, count]) => `${event}×${count}`).join(', ')}\n`);
    if (!seen.has('panel-mounted')) {
      process.stdout.write('    → registered but never opened; the row exists, nobody clicked it\n');
    }
  }
}

// The browser half is best-effort: the page may demand authentication we do not
// hold, and that is an answer, not a failure of the plugin.
const browser = await openBrowser();
try {
  await browser.setViewport(1440, 900);
  await browser.navigate(base);
  const probe = await browser.evaluate<{
    hasModule: boolean;
    annotVisible: boolean;
    panelRows: number;
    bodyPreview: string;
  }>(`(() => {
    const text = (document.body && document.body.innerText) || '';
    return {
      hasModule: typeof window.__ModuleLoader__ === 'object',
      annotVisible: /Annot/.test(text),
      panelRows: document.querySelectorAll('[data-dsh-panel-entry]').length,
      bodyPreview: text.replace(/\\s+/g, ' ').slice(0, 200),
    };
  })()`);

  process.stdout.write(`  __ModuleLoader__ present: ${probe.hasModule}\n`);
  process.stdout.write(`  panel-row entries in DOM: ${probe.panelRows}\n`);
  process.stdout.write(`  "Annot" visible: ${probe.annotVisible ? 'yes' : 'no'}\n`);
  process.stdout.write(`  body: ${probe.bodyPreview}\n`);

  const problems = browser.problems();
  process.stdout.write(`  console/page problems: ${problems.length}\n`);
  for (const problem of problems.slice(0, 8)) process.stdout.write(`    - ${problem}\n`);
} finally {
  await browser.close();
}
