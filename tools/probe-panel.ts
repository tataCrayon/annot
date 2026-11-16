/**
 * Probe the live GUI for the Annot panel, using the same CDP client the render
 * check uses. This is not a test — it is a one-shot look at whether the panel
 * the plugin registers is actually reachable in the running page.
 *
 *   node tools/probe-panel.ts [url]
 *
 * It reports what it can see and never claims more: if the page needs auth, that
 * is the answer, not a pass.
 */

import { openBrowser } from '../src/browser.ts';

const url = process.argv[2] ?? 'http://127.0.0.1:54341';

const browser = await openBrowser();
try {
  await browser.setViewport(1440, 900);
  await browser.navigate(url);
  process.stdout.write(`navigated: ${url}\n`);

  // The panel registers into `sidebar.panellist`; its label comes from the
  // module, so the visible text is the cheapest proof it mounted.
  const probe = await browser.evaluate<{
    hasModule: boolean;
    moduleIds: string[];
    annotText: string | null;
    bodyPreview: string;
    needsAuth: boolean;
  }>(`(() => {
    const ids = [];
    try {
      const loader = window.__ModuleLoader__;
      if (loader && typeof loader.ids === 'function') for (const id of loader.ids()) ids.push(String(id));
    } catch {}
    const text = (document.body && document.body.innerText) || '';
    const annot = /Annot/.test(text) ? 'Annot' : null;
    return {
      hasModule: typeof window.__ModuleLoader__ === 'object',
      moduleIds: ids,
      annotText: annot,
      bodyPreview: text.replace(/\\s+/g, ' ').slice(0, 240),
      needsAuth: /sign in|log in|登录|unauthor|401/i.test(text),
    };
  })()`);

  process.stdout.write(`  __ModuleLoader__ present: ${probe.hasModule}\n`);
  process.stdout.write(`  registered module ids: ${probe.moduleIds.length ? probe.moduleIds.join(', ') : '(none exposed)'}\n`);
  process.stdout.write(`  "Annot" visible: ${probe.annotText ?? 'no'}\n`);
  if (probe.needsAuth) process.stdout.write('  the page is asking for authentication\n');
  process.stdout.write(`  body: ${probe.bodyPreview}\n`);

  const problems = browser.problems();
  process.stdout.write(`  console/page problems: ${problems.length}\n`);
  for (const problem of problems.slice(0, 8)) process.stdout.write(`    - ${problem}\n`);
} finally {
  await browser.close();
}
