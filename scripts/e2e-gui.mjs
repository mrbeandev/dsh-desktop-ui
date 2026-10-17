#!/usr/bin/env node
// Dependency-free Chrome/CDP smoke test, following dsh-workspace-sorter and
// dsh-image-edge-cap. Use only an isolated DSH_HOME populated by
// e2e-fixtures.mjs (three offline sessions, no provider calls).
import { spawn } from 'node:child_process';
import { mkdtemp, rm, realpath, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.env.DSH_E2E_URL;
if (!url) throw new Error('Set DSH_E2E_URL to the isolated DSH URL (including token).');
const absent = process.env.DSH_E2E_ABSENT === '1';
const shots = process.env.DSH_E2E_SHOTS;
const profile = await mkdtemp(join(tmpdir(), 'desktop-ui-chrome-'));
const port = 9500 + Math.floor(Math.random() * 500);
const chrome = spawn(process.env.CHROME ?? 'google-chrome', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`); };
let ws;
try {
  let target;
  for (let i = 0; i < 80; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page'); } catch {}
    if (target) break;
    await delay(100);
  }
  if (!target) throw new Error('Chrome did not start');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let seq = 0;
  const pending = new Map(), errors = [];
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) { const resolve = pending.get(message.id); pending.delete(message.id); resolve?.(message); }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map(a => a.value ?? a.description).join(' '));
  };
  const send = (method, params = {}) => new Promise(resolve => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.error || r.result?.exceptionDetails) throw new Error(JSON.stringify(r.error ?? r.result.exceptionDetails));
    return r.result?.result?.value;
  };
  const wait = async (expression, tries = 100) => { for (let i = 0; i < tries; i++) { if (await evaluate(expression)) return true; await delay(100); } return false; };
  const center = async selector => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, left: r.x, top: r.y }; })()`);
  const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra });
  const click = async (selector, clickCount = 1) => {
    const c = await center(selector);
    if (!c) throw new Error(`Missing ${selector}`);
    for (let n = 1; n <= clickCount; n++) { await mouse('mousePressed', c.x, c.y, { clickCount: n }); await mouse('mouseReleased', c.x, c.y, { clickCount: n }); }
    await delay(250);
  };
  const drag = async (fx, fy, tx, ty) => {
    await mouse('mouseMoved', fx, fy, { buttons: 0 });
    await mouse('mousePressed', fx, fy);
    for (let i = 1; i <= 8; i++) await mouse('mouseMoved', fx + (tx - fx) * i / 8, fy + (ty - fy) * i / 8);
    await mouse('mouseReleased', tx, ty);
    await delay(250);
  };
  const shot = async name => {
    if (!shots) return;
    await mkdir(shots, { recursive: true });
    const r = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(shots, `${name}.png`), Buffer.from(r.result.data, 'base64'));
  };
  const dismissOnboarding = async () => {
    // A fresh profile shows the "Add an API key" dialog shortly after boot.
    for (let i = 0; i < 30; i++) {
      const c = await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(e => e.textContent.trim() === 'Configure later'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      if (c) { await mouse('mousePressed', c.x, c.y); await mouse('mouseReleased', c.x, c.y); await delay(400); return; }
      await delay(100);
    }
  };
  const state = () => evaluate(`JSON.parse(localStorage.getItem('dsh-desktop-ui.state.v1') || 'null')`);
  const focused = () => evaluate(`document.querySelector('.dsh-dui-win[data-focused]')?.getAttribute('data-session-id')`);
  const visibleBoxes = `[...document.querySelectorAll('.dsh-dui-win')].filter(n => !n.hidden).map(n => { const r = n.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })`;

  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url });
  check('DSH boots with native sidebar', await wait(`!!document.querySelector('[role=tree], [role=treeitem]')`));
  await dismissOnboarding();

  if (absent) {
    check('removed plugin has no toggle', !(await evaluate(`!!document.querySelector('[data-dsh-desktop-ui-toggle]')`)));
    check('removed plugin is absent from boot graph', await evaluate(`!window.__DSH_BOOT__.entries.some(e => e.id === 'dsh-desktop-ui')`));
    check('native conversation renders', await wait(`!!document.querySelector('[data-conversation-content]') || !!document.querySelector('[data-phase]')`));
  } else {
    await evaluate(`localStorage.removeItem('dsh-desktop-ui.state.v1')`);
    await send('Page.reload');
    await wait(`!!document.querySelector('[data-dsh-desktop-ui-toggle]')`);
    await dismissOnboarding();
    check('plugin registered in boot graph', await evaluate(`window.__DSH_BOOT__.entries.some(e => e.id === 'dsh-desktop-ui')`));
    check('toggle sits directly above Settings', await evaluate(`(() => { const t = document.querySelector('[data-dsh-desktop-ui-toggle]'); const s = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Settings'); if (!t || !s) return false; const a = t.getBoundingClientRect(), b = s.getBoundingClientRect(); return a.bottom <= b.top + 1 && b.top - a.bottom < 40; })()`));
    check('desktop off by default (stock conversation)', !(await evaluate(`!!document.querySelector('[data-dsh-desktop-ui]')`)));
    await click('[data-dsh-desktop-ui-toggle]');
    check('toggle switches the content area into the desktop', await wait(`!!document.querySelector('[data-dsh-desktop-ui]')`));
    check('taskbar renders', await evaluate(`!!document.querySelector('.dsh-dui-taskbar')`));
    check('toggle reports on', await evaluate(`document.querySelector('[data-dsh-desktop-ui-toggle]').getAttribute('aria-checked') === 'true'`));

    const winsBeforeNew = await evaluate(`document.querySelectorAll('.dsh-dui-win').length`);
    await click('.dsh-dui-taskbar button[aria-label="New session"]');
    check('taskbar New session opens a window, desktop stays', await wait(`document.querySelectorAll('.dsh-dui-win').length > ${winsBeforeNew} || document.querySelector('.dsh-dui-win[data-focused]') !== null`, 40) && await evaluate(`!!document.querySelector('[data-dsh-desktop-ui]')`));
    await wait(`[...document.querySelectorAll('[role=treeitem]')].filter(e => e.getAttribute('data-row-key')?.startsWith('session:')).length >= 4`, 40);
    const rows = await evaluate(`[...document.querySelectorAll('[role=treeitem]')].map(e => e.getAttribute('data-row-key')).filter(k => k?.startsWith('session:'))`);
    for (const key of rows) await click(`[data-row-key="${key}"] span[class*="_title"]`), await delay(500);
    const opened = await evaluate(`document.querySelectorAll('.dsh-dui-win').length`);
    check('sidebar clicks open every listed session as a window', opened >= rows.length && await evaluate(`!!document.querySelector('[data-dsh-desktop-ui]')`), { opened, rows: rows.length });
    check('sidebar click on an open session focuses its window', (await focused()) === rows[rows.length - 1].slice('session:'.length));
    check('one taskbar entry per window', await evaluate(`document.querySelectorAll('.dsh-dui-task').length === document.querySelectorAll('.dsh-dui-win').length`));
    check('seeded transcript renders inside a window', await wait(`[...document.querySelectorAll('.dsh-dui-win .dsh-dui-body')].some(b => /checklist|flaky|README/.test(b.innerText))`));
    check('embedded conversation renders in each window', await wait(`[...document.querySelectorAll('.dsh-dui-win')].every(w => w.querySelector('[data-conversation-content]'))`));
    check('each window has its own composer', await evaluate(`document.querySelectorAll('.dsh-dui-win [contenteditable=true]').length === document.querySelectorAll('.dsh-dui-win').length`));
    await shot('01-cascade');

    const top = await focused();
    const sel = `.dsh-dui-win[data-session-id="${top}"]`;
    const b0 = await center(sel), t0 = await center(`${sel} .dsh-dui-title-text`);
    await drag(t0.x, t0.y, t0.x + 160, t0.y + 90);
    const b1 = await center(sel);
    check('title bar drag moves window', Math.round(b1.left - b0.left) === 160 && Math.round(b1.top - b0.top) === 90, [b1.left - b0.left, b1.top - b0.top]);
    const nw = await center(`${sel} [data-edge=nw]`);
    await drag(nw.x, nw.y, nw.x - 120, nw.y - 60);
    const b2 = await center(sel);
    check('corner drag resizes window', Math.round(b2.w - b1.w) === 120 && Math.round(b2.h - b1.h) === 60, [b2.w - b1.w, b2.h - b1.h]);

    await click(`${sel} button[aria-label^="Minimize"]`);
    check('minimize hides window to taskbar', await evaluate(`document.querySelector(${JSON.stringify(sel)}).hidden === true`) && (await focused()) !== top);
    await click(`.dsh-dui-task[data-session-id="${top}"]`);
    check('taskbar click restores and focuses', await evaluate(`!document.querySelector(${JSON.stringify(sel)}).hidden`) && (await focused()) === top);
    await click(`.dsh-dui-task[data-session-id="${top}"]`);
    check('taskbar click on focused window minimizes', await evaluate(`document.querySelector(${JSON.stringify(sel)}).hidden === true`));
    await click(`.dsh-dui-task[data-session-id="${top}"]`);

    await click(`${sel} .dsh-dui-title-text`, 2);
    const canvas = await center('.dsh-dui-canvas-inner'), bm = await center(sel);
    check('double-click title maximizes', Math.abs(bm.w - canvas.w) < 2 && Math.abs(bm.h - canvas.h) < 2, [bm.w, canvas.w]);
    await click(`${sel} button[aria-label^="Restore"]`);
    const br = await center(sel);
    check('restore returns previous size', Math.round(br.w) === Math.round(b2.w), [br.w, b2.w]);

    const tl = await center(`${sel} .dsh-dui-title-text`);
    await drag(tl.x, tl.y, canvas.left + 1, tl.y);
    const sl = await center(sel);
    check('drag to left edge snaps to left half', sl.left - canvas.left < 20 && Math.abs(sl.w - canvas.w / 2) < 20, [sl.left - canvas.left, sl.w, canvas.w]);

    const noOverlap = boxes => boxes.every((a, i) => boxes.every((b, j) => j <= i || !(a[0] < b[0] + b[2] - 1 && b[0] < a[0] + a[2] - 1 && a[1] < b[1] + b[3] - 1 && b[1] < a[1] + a[3] - 1)));
    await click('button[aria-label="Tile windows"]');
    const tiled = await evaluate(visibleBoxes);
    check('Tile arranges windows without overlap', tiled.length >= 3 && noOverlap(tiled), tiled.length);
    await shot('02-tiled');
    await click('button[aria-label="Show windows side by side"]');
    const cols = await evaluate(visibleBoxes);
    check('Side by side gives equal columns', noOverlap(cols) && cols.every(b => Math.abs(b[2] - cols[0][2]) < 2 && Math.abs(b[1] - cols[0][1]) < 2), cols.map(b => b.map(Math.round)));
    await click('button[aria-label="Cascade windows"]');
    check('Cascade restores overlapping stack', !noOverlap(await evaluate(visibleBoxes)));

    await click('button[aria-label="Show desktop"]');
    check('Show desktop hides all windows', (await evaluate(visibleBoxes)).length === 0);
    await click('button[aria-label="Show desktop"]');
    check('Show desktop again restores them', (await evaluate(visibleBoxes)).length >= 3);

    const before = (await state()).windows.length;
    const last = await focused();
    await click(`.dsh-dui-win[data-session-id="${last}"] button[aria-label^="Close"]`);
    check('close removes window and taskbar entry', (await state()).windows.length === before - 1 && !(await evaluate(`!!document.querySelector('.dsh-dui-task[data-session-id="${last}"]')`)));
    check('closing a window keeps the session in the sidebar', await evaluate(`!!document.querySelector('[data-row-key="session:${last}"]')`));

    const saved = await state();
    await send('Page.reload');
    await dismissOnboarding();
    check('desktop mode survives reload', await wait(`!!document.querySelector('[data-dsh-desktop-ui]')`));
    await wait(`document.querySelectorAll('.dsh-dui-win').length === ${saved.windows.length}`, 50);
    // Every saved window whose session still exists must come back. The
    // current main session may also be reopened; nothing else may appear.
    await wait(`document.querySelectorAll('[role=treeitem][data-row-key^="session:"]').length > 0`, 50);
    await delay(800);
    const listed = await evaluate(`[...document.querySelectorAll('[role=treeitem]')].map(e => e.getAttribute('data-row-key')).filter(k => k?.startsWith('session:')).map(k => k.slice(8))`);
    const restored = await evaluate(`[...document.querySelectorAll('.dsh-dui-win')].map(n => n.getAttribute('data-session-id'))`);
    const savedIds = saved.windows.map(w => w.sessionId);
    const missing = savedIds.filter(id => listed.includes(id) && !restored.includes(id));
    const extra = restored.filter(id => !savedIds.includes(id));
    check('window set survives reload', missing.length === 0 && extra.length <= 1, { savedIds, restored, listed });

    await evaluate(`localStorage.setItem('dsh-desktop-ui.state.v1', '{"enabled":true,"windows":[{"sessionId":"<img src=x onerror=alert(1)>","x":"bad","w":99},{"sessionId":42},null]}')`);
    await send('Page.reload');
    await dismissOnboarding();
    await wait(`!!document.querySelector('[data-dsh-desktop-ui]')`);
    await delay(800);
    check('malformed stored state is sanitized safely', await evaluate(`!document.querySelector('.dsh-dui-win img') && !!document.querySelector('[data-dsh-desktop-ui]')`));
    // Unknown ids are pruned; only the current main session may reopen.
    await delay(800);
    const after = await evaluate(`[...document.querySelectorAll('.dsh-dui-win')].map(n => n.getAttribute('data-session-id'))`);
    const listedNow = await evaluate(`[...document.querySelectorAll('[role=treeitem]')].map(e => e.getAttribute('data-row-key')).filter(k => k?.startsWith('session:')).map(k => k.slice(8))`);
    check('deleted/unknown sessions are pruned', after.length <= 1 && after.every(id => listedNow.includes(id)), after);
    for (const id of after) await click(`.dsh-dui-win[data-session-id="${id}"] button[aria-label^="Close"]`);
    check('empty desktop shows guidance', await wait(`/No windows open/.test(document.querySelector('[data-dsh-desktop-ui]').innerText)`, 20));

    const firstRow = await evaluate(`[...document.querySelectorAll('[role=treeitem]')].map(e => e.getAttribute('data-row-key')).find(k => k?.startsWith('session:'))`);
    await click(`[data-row-key="${firstRow}"] span[class*="_title"]`);
    await wait(`document.querySelectorAll('.dsh-dui-win').length > 0`, 30);
    // Below 1024px DSH collapses the sidebar to a rail; 700px leaves a canvas under 720px.
    await send('Emulation.setDeviceMetricsOverride', { width: 700, height: 800, deviceScaleFactor: 1, mobile: false });
    check('narrow canvas forces windows to fill the area', await wait(`(() => { const w = document.querySelector('.dsh-dui-win[data-focused]'); const c = document.querySelector('.dsh-dui-canvas-inner'); return w && c.getBoundingClientRect().width < 720 && Math.abs(w.getBoundingClientRect().width - c.getBoundingClientRect().width) < 2; })()`, 30));
    check('narrow layout hides arrange buttons, keeps taskbar', await evaluate(`!document.querySelector('button[aria-label="Tile windows"]') && !!document.querySelector('.dsh-dui-task')`));
    await shot('03-narrow');
    await send('Emulation.clearDeviceMetricsOverride');
    await delay(600);
    await wait(`(() => { const t = document.querySelector('[data-dsh-desktop-ui-toggle]'); if (!t) return false; const r = t.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('[data-dsh-desktop-ui-toggle]') !== null; })()`, 30);

    await click('[data-dsh-desktop-ui-toggle]');
    check('toggle off returns to stock conversation', await wait(`!document.querySelector('[data-dsh-desktop-ui]') && !!document.querySelector('[data-conversation-content]')`));
    check('toggle reports off', await evaluate(`document.querySelector('[data-dsh-desktop-ui-toggle]').getAttribute('aria-checked') === 'false'`));
    await send('Page.reload');
    await dismissOnboarding();
    await delay(1000);
    check('off state persists across reload', !(await evaluate(`!!document.querySelector('[data-dsh-desktop-ui]')`)));
    await shot('04-off');
  }
  const relevant = errors.filter(e => !/favicon|ResizeObserver loop/.test(e ?? ''));
  check('no browser errors', relevant.length === 0, relevant.slice(0, 5));
} finally {
  ws?.close(); chrome.kill();
  await new Promise(resolve => chrome.exitCode !== null ? resolve() : chrome.once('exit', resolve));
  const resolved = await realpath(profile);
  if (!resolved.startsWith(`${await realpath(tmpdir())}/desktop-ui-chrome-`)) throw new Error('Unexpected browser profile path');
  await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
console.log(`${results.filter(r => r.ok).length}/${results.length} checks passed`);
process.exitCode = results.some(r => !r.ok) ? 1 : 0;
