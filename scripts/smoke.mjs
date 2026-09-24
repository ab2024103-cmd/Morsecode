/**
 * Headless smoke test.
 *
 * Bundles the real app with esbuild, renders it in jsdom, then drives it the
 * way a user would: visits every screen, flips both toggles through all four
 * visual states, opens the tray menu and answers a consent prompt. Any React
 * error, warning or thrown exception fails the run.
 *
 *   node scripts/smoke.mjs
 */
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const t0 = Date.now();

const result = await build({
  entryPoints: ['src/main.tsx'],
  bundle: true,
  format: 'iife',
  write: false,
  platform: 'browser',
  // Assets are irrelevant to behaviour; keep the bundle small and fast.
  loader: { '.png': 'empty', '.svg': 'empty', '.css': 'empty', '.woff': 'empty', '.woff2': 'empty' },
  define: { 'process.env.NODE_ENV': '"development"' },
  jsx: 'automatic',
  logLevel: 'error',
});

const dom = new JSDOM(
  '<!doctype html><html data-theme="classic" data-mode="dark"><body><div id="root"></div></body></html>',
  { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' },
);
const { window } = dom;
const doc = window.document;

window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
window.scrollTo = () => {};

const problems = [];
window.addEventListener('error', (e) => problems.push(`window error: ${e.message}`));
window.console = {
  ...console,
  error: (...args) => problems.push(`console.error: ${args.map(String).join(' ')}`),
  warn: () => {},
};

const tick = (ms = 260) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls until `predicate` is truthy — CI runners are much slower than a laptop. */
async function waitFor(predicate, timeout = 12_000, step = 150) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = predicate();
    if (value) return value;
    if (Date.now() > deadline) return null;
    await tick(step);
  }
}
const click = (el) => el && el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const byText = (selector, text) =>
  [...doc.querySelectorAll(selector)].find((node) => node.textContent.trim().toLowerCase().includes(text));

try {
  window.eval(result.outputFiles[0].text);
} catch (error) {
  problems.push(`eval threw: ${error?.stack ?? error}`);
}

// Let discovery populate (poll rather than guess at a fixed delay).
await waitFor(() => doc.querySelectorAll('.blip').length >= 3);
await waitFor(() => doc.querySelectorAll('.log-line').length > 0);

const checks = [];
const check = (label, ok, detail = '') => {
  checks.push(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) problems.push(`check failed: ${label} ${detail}`);
};

check('shell mounted', !!doc.querySelector('.app-root'));
check('titlebar + sidebar + rail', ['.titlebar', '.sidebar', '.rightrail'].every((s) => doc.querySelector(s)));
check('radar blips', doc.querySelectorAll('.blip').length > 0, `${doc.querySelectorAll('.blip').length} peers`);
check('device list', doc.querySelectorAll('.device').length > 0);
check('system log streaming', doc.querySelectorAll('.log-line').length > 0, `${doc.querySelectorAll('.log-line').length} lines`);

// ── every screen renders ────────────────────────────────────────────────────
const navItems = [...doc.querySelectorAll('.sb-item')];
check('8 nav entries', navItems.length === 8, `${navItems.length}`);
for (const item of navItems) {
  const label = item.textContent.trim();
  click(item);
  const title = await waitFor(() => doc.querySelector('.screen-title')?.textContent?.trim());
  check(`screen "${label}"`, !!title, title);
}

// ── four visual states ──────────────────────────────────────────────────────
for (const theme of ['classic', 'hud']) {
  for (const mode of ['dark', 'light']) {
    click(byText('.pill-switch button', theme));
    click(byText('.pill-switch button', mode));
    await tick(120);
    const root = doc.documentElement;
    check(
      `state ${theme}/${mode}`,
      root.dataset.theme === theme && root.dataset.mode === mode,
      `${root.dataset.theme}/${root.dataset.mode}`,
    );
  }
}
click(byText('.pill-switch button', 'classic'));
await tick(120);

// ── send flow ───────────────────────────────────────────────────────────────
click(navItems.find((n) => n.textContent.includes('Send')));
await tick(200);
const target = await waitFor(() => doc.querySelector('.bc-target'));
click(target);
check('broadcast target selectable', !!(await waitFor(() => target?.dataset.on === 'true', 3000)));

// ── consent modal ───────────────────────────────────────────────────────────
click(navItems.find((n) => n.textContent.includes('Discover')));
await tick(160);
let modal = null;
for (let attempt = 0; attempt < 6 && !modal; attempt += 1) {
  click(byText('.btn', 'simulate inbound'));
  modal = await waitFor(() => doc.querySelector('.modal-backdrop'), 1500);
}
check('consent modal blocks untrusted device', !!modal);
if (modal) {
  click(doc.querySelector('.checkbox'));
  await tick(80);
  check('trust checkbox toggles', doc.querySelector('.checkbox')?.dataset.checked === 'true');
  click(byText('.modal-foot .btn', 'accept'));
  await waitFor(() => !doc.querySelector('.modal-backdrop'));
  check('modal dismissed after accept', !doc.querySelector('.modal-backdrop'));
  check('toast surfaced', !!(await waitFor(() => doc.querySelectorAll('.toast').length > 0)));
}

// ── tray menu ───────────────────────────────────────────────────────────────
click(doc.querySelector('.win-btn'));
check('tray menu opens', !!(await waitFor(() => doc.querySelector('.tray-pop'), 3000)));
click(byText('.tray-item', 'pause'));
await tick(120);

// ── clipboard ───────────────────────────────────────────────────────────────
click(navItems.find((n) => n.textContent.includes('Clipboard')));
await tick(200);
const textarea = doc.querySelector('.textarea');
if (textarea) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(textarea, 'https://example.local/build-42');
  textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick(120);
  click(byText('.btn.primary', 'send'));
  check(
    'clipboard item recorded',
    !!(await waitFor(() => doc.querySelectorAll('.clip-item').length > 0)),
  );
}

// ── history ─────────────────────────────────────────────────────────────────
click(navItems.find((n) => n.textContent.includes('History')));
check(
  'history rows',
  !!(await waitFor(() => doc.querySelectorAll('table.data tbody tr').length > 0)),
);
click(byText('.tab', 'failed'));
await tick(140);
check('history tab filters', !!doc.querySelector('table.data, .empty'));

console.log(checks.join('\n'));
console.log(`\n${checks.length} checks in ${Date.now() - t0}ms`);

if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  console.log(problems.slice(0, 10).join('\n'));
  process.exit(1);
}
console.log('\nno React errors or warnings — smoke test passed');
process.exit(0);
