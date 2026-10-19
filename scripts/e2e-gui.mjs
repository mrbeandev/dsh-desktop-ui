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
  const clearDialog = async () => {
    const c = await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(e => ['Configure later', 'Continue'].includes(e.textContent.trim()) && e.closest('[role=dialog], [role=presentation], [aria-modal=true]')); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    if (!c) return false;
    await mouse('mousePressed', c.x, c.y); await mouse('mouseReleased', c.x, c.y); await delay(400);
    return true;
  };
  const click = async (selector, clickCount = 1) => {
    while (await clearDialog()) { /* a first-run dialog can appear at any time in a fresh profile */ }
    const c = await center(selector);
    if (!c) throw new Error(`Missing ${selector}`);
    for (let n = 1; n <= clickCount; n++) { await mouse('mousePressed', c.x, c.y, { clickCount: n }); await mouse('mouseReleased', c.x, c.y, { clickCount: n }); }
    await delay(250);
  };
  const drag = async (fx, fy, tx, ty) => {
    while (await clearDialog()) { /* see click() */ }
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
    // A fresh profile shows "Preview Notice" (Continue) and then "Add an API key"
    // (Configure later), the second several seconds after load. Keep dismissing
    // until none has appeared for ~3.5s.
    let quiet = 0;
    for (let i = 0; i < 120 && quiet < 35; i++) {
      const c = await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(e => ['Configure later', 'Continue'].includes(e.textContent.trim()) && e.closest('[role=dialog], [role=presentation], [aria-modal=true]')); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      if (c) { await mouse('mousePressed', c.x, c.y); await mouse('mouseReleased', c.x, c.y); await delay(400); quiet = 0; continue; }
      quiet++;
      await delay(100);
    }
  };
  const closeWindow = async id => {
    const W = `.dsh-dui-win[data-session-id="${id}"]`;
    if (await evaluate(`document.querySelector(${JSON.stringify(W)})?.hidden === true`)) await click(`.dsh-dui-task[data-session-id="${id}"]`);
    if (await evaluate(`!!document.querySelector(${JSON.stringify(W + ' [data-popin]')})`)) await click(`${W} [data-popin]`);
    if (await evaluate(`!!document.querySelector(${JSON.stringify(W + ' button[aria-label^="Close"]')})`)) await click(`${W} button[aria-label^="Close"]`);
  };
  const openPluginPage = async () => {
    await click(`button[aria-label="Plugins"]`).catch(() => {});
    if (!(await evaluate(`[...document.querySelectorAll('button')].some(b => b.textContent.trim().startsWith('dsh-desktop-ui') && b.getBoundingClientRect().height > 0)`))) {
      const btn = await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(e => e.textContent.trim() === 'Plugins'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      if (btn) { await mouse('mousePressed', btn.x, btn.y); await mouse('mouseReleased', btn.x, btn.y); }
    }
    await wait(`[...document.querySelectorAll('button')].some(b => b.textContent.trim().startsWith('dsh-desktop-ui') && b.getBoundingClientRect().height > 0)`, 40);
    await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith('dsh-desktop-ui') && b.getBoundingClientRect().height > 0)?.scrollIntoView({ block: 'center' })`);
    await delay(300);
    const card = await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(e => e.textContent.trim().startsWith('dsh-desktop-ui') && e.getBoundingClientRect().height > 0); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    if (card) { await mouse('mousePressed', card.x, card.y); await mouse('mouseReleased', card.x, card.y); }
    return wait(`!!document.querySelector('[data-dsh-desktop-ui-hover-toggle]')`, 40);
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
    // Start from a clean slate: clear the browser copy and the Host copy.
    // Reset through the UI so the Host copy is reset too: close every window,
    // set the default text size, then switch Desktop mode off.
    await wait(`!!document.querySelector('[data-dsh-desktop-ui-toggle]')`, 50);
    await delay(3000);
    if (await evaluate(`!!document.querySelector('[data-dsh-desktop-ui]')`)) {
      for (let pass = 0; pass < 3; pass++) {
        const open = await evaluate(`[...document.querySelectorAll('.dsh-dui-win')].map(n => n.getAttribute('data-session-id'))`);
        if (!open.length) break;
        for (const id of open) {
          if (await evaluate(`document.querySelector('.dsh-dui-win[data-session-id="${id}"]')?.hidden === true`)) await click(`.dsh-dui-task[data-session-id="${id}"]`);
          const popin = `.dsh-dui-win[data-session-id="${id}"] [data-popin]`;
          if (await evaluate(`!!document.querySelector(${JSON.stringify(popin)})`)) await click(popin);
          if (await evaluate(`!!document.querySelector('.dsh-dui-win[data-session-id="${id}"] button[aria-label^="Close"]')`)) await click(`.dsh-dui-win[data-session-id="${id}"] button[aria-label^="Close"]`);
        }
      }
      for (let i = 0; i < 8 && (await evaluate(`document.querySelector('.dsh-dui-scale')?.textContent`)) !== '85%'; i++) await click('.dsh-dui-scale');
      await click('[data-dsh-desktop-ui-toggle]');
    }
    // Wait until the Host copy says Desktop mode is off before reloading.
    await wait(`(() => { try { return JSON.parse(localStorage.getItem('dsh-desktop-ui.state.v1') || '{}').enabled !== true; } catch { return true; } })()`, 40);
    await delay(1500);
    await send('Page.reload');
    await wait(`!!document.querySelector('[data-dsh-desktop-ui-toggle]')`);
    await dismissOnboarding();
    await delay(1500);
    if (await evaluate(`!!document.querySelector('[data-dsh-desktop-ui]')`)) { await click('[data-dsh-desktop-ui-toggle]'); await delay(1000); }
    check('plugin registered in boot graph', await evaluate(`window.__DSH_BOOT__.entries.some(e => e.id === 'dsh-desktop-ui')`));
    check('toggle sits above Settings, first among footer actions', await evaluate(`(() => { const t = document.querySelector('[data-dsh-desktop-ui-toggle]'); const s = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Settings'); if (!t || !s) return false; const a = t.getBoundingClientRect(), b = s.getBoundingClientRect(); const row = t.closest('[class*="_footerActions"]'); const first = row && [...row.querySelectorAll('button')][0] === t; return a.bottom <= b.top + 1 && b.top - a.bottom < 120 && first; })()`));
    check('footer actions stack instead of sharing one row', await evaluate(`(() => { const row = document.querySelector('[data-dsh-desktop-ui-toggle]')?.closest('[class*="_footerActions"]'); if (!row) return false; const kids = [...row.querySelectorAll(':scope > *')].filter(n => n.getBoundingClientRect().height > 0); return getComputedStyle(row).flexDirection === 'column' && kids.every(k => Math.abs(k.getBoundingClientRect().width - row.getBoundingClientRect().width) < 8); })()`));
    check('desktop off by default (stock conversation)', !(await evaluate(`!!document.querySelector('[data-dsh-desktop-ui]')`)));
    await click('[data-dsh-desktop-ui-toggle]');
    check('toggle switches the content area into the desktop', await wait(`!!document.querySelector('[data-dsh-desktop-ui]')`));
    check('taskbar renders', await evaluate(`!!document.querySelector('.dsh-dui-taskbar')`));
    check('toggle reports on', await evaluate(`document.querySelector('[data-dsh-desktop-ui-toggle]').getAttribute('aria-checked') === 'true'`));

    const winsBeforeNew = await evaluate(`document.querySelectorAll('.dsh-dui-win').length`);
    await click('.dsh-dui-taskbar button[aria-label="New session"]');
    check('taskbar New session opens a window, desktop stays', await wait(`document.querySelectorAll('.dsh-dui-win').length > ${winsBeforeNew} || document.querySelector('.dsh-dui-win[data-focused]') !== null`, 40) && await evaluate(`!!document.querySelector('[data-dsh-desktop-ui]')`));
    await wait(`[...document.querySelectorAll('[role=treeitem]')].filter(e => e.getAttribute('data-row-key')?.startsWith('session:')).length >= 4`, 40);
    // Workspace folders can start collapsed in a fresh profile; expand them.
    for (let pass = 0; pass < 3; pass++) {
      const collapsed = await evaluate(`[...document.querySelectorAll('[role=treeitem][aria-expanded=false]')].map(e => e.getAttribute('data-row-key')).filter(k => k?.startsWith('workspace:') && k !== 'workspace:')`);
      if (!collapsed.length) break;
      // Click the folder icon (workspace-sorter turns a name click into open-latest).
      for (const key of collapsed) { const sel = `[data-row-key="${key}"] [class*="_folder"]`; await click((await center(sel)) ? sel : `[data-row-key="${key}"]`); }
      await delay(500);
    }
    await wait(`[...document.querySelectorAll('[role=treeitem]')].filter(e => /^session:./.test(e.getAttribute('data-row-key') ?? '')).length >= 3`, 40);
    const rows = await evaluate(`[...document.querySelectorAll('[role=treeitem]')].map(e => e.getAttribute('data-row-key')).filter(k => k?.startsWith('session:') && k !== 'session:')`);
    for (const key of rows) await click(`[data-row-key="${key}"] span[class*="_title"]`), await delay(500);
    const opened = await evaluate(`document.querySelectorAll('.dsh-dui-win').length`);
    check('sidebar clicks open every listed session as a window', opened >= rows.length && await evaluate(`!!document.querySelector('[data-dsh-desktop-ui]')`), { opened, rows: rows.length });
    const lastRow = rows[rows.length - 1];
    await click(`[data-row-key="${lastRow}"] span[class*="_title"]`);
    await delay(500);
    check('sidebar click on an open session focuses its window', (await focused()) === lastRow.slice('session:'.length), { focused: await focused(), lastRow, rows });
    // Clicking every session again (and twice) must never create a second window.
    const rowsNow = await evaluate(`[...document.querySelectorAll('[role=treeitem]')].map(e => e.getAttribute('data-row-key')).filter(k => k?.startsWith('session:'))`);
    const winsBefore = await evaluate(`document.querySelectorAll('.dsh-dui-win').length`);
    for (const key of rowsNow) { await click(`[data-row-key="${key}"] span[class*="_title"]`); await click(`[data-row-key="${key}"] span[class*="_title"]`); }
    await delay(400);
    const ids = await evaluate(`[...document.querySelectorAll('.dsh-dui-win')].map(n => n.getAttribute('data-session-id'))`);
    check('a session never opens in more than one window', ids.length === new Set(ids).size && ids.length === winsBefore, { ids, winsBefore });
    check('window title bars read "workspace | session"', await evaluate(`[...document.querySelectorAll('.dsh-dui-win')].every(w => { const ws = w.querySelector('.dsh-dui-title-ws')?.textContent; const sep = w.querySelector('.dsh-dui-title-sep')?.textContent; const se = w.querySelector('.dsh-dui-title-session')?.textContent; return ws === 'Desktop Demo' && sep === '|' && !!se && w.querySelector('.dsh-dui-title-text').title === ws + ' | ' + se; })`), await evaluate(`[...document.querySelectorAll('.dsh-dui-title-text')].map(t => t.textContent)`));
    check('one taskbar entry per window', await evaluate(`document.querySelectorAll('.dsh-dui-task').length === document.querySelectorAll('.dsh-dui-win').length`));
    check('seeded transcript renders inside a window', await wait(`[...document.querySelectorAll('.dsh-dui-win .dsh-dui-body')].some(b => /checklist|flaky|README/.test(b.innerText))`));
    check('embedded conversation renders in each window', await wait(`[...document.querySelectorAll('.dsh-dui-win')].every(w => w.querySelector('[data-conversation-content]'))`));
    check('windows render the full stock conversation (header included)', await wait(`[...document.querySelectorAll('.dsh-dui-win')].every(w => w.querySelector('.dsh-dui-content[data-dsh-desktop-ui-full] [data-phase]'))`, 40));
    const zoomNow = await evaluate(`parseFloat(document.querySelector('.dsh-dui-scale')?.textContent) / 100`);
    check('window content uses one uniform zoom (matches the taskbar setting)', await evaluate(`[...document.querySelectorAll('.dsh-dui-content')].every(c => Math.abs(parseFloat(getComputedStyle(c).zoom) - ${zoomNow}) < 0.01)`), zoomNow);
    check('each window has its own composer', await evaluate(`document.querySelectorAll('.dsh-dui-win [contenteditable=true]').length === document.querySelectorAll('.dsh-dui-win').length`));
    await shot('01-cascade');

    // Start every geometry test from a known layout: cascade puts the focused
    // window near the top-left with room to move and to grow up and left.
    await click('button[aria-label="Cascade windows"]');
    const top = await focused();
    const sel = `.dsh-dui-win[data-session-id="${top}"]`;
    {
      const t = await center(`${sel} .dsh-dui-title-text`);
      const cv = await center('.dsh-dui-canvas-inner');
      await drag(t.x, t.y, t.x + (cv.left + 200 - (await center(sel)).left), t.y + (cv.top + 140 - (await center(sel)).top));
    }
    const b0 = await center(sel), t0 = await center(`${sel} .dsh-dui-title-text`);
    await drag(t0.x, t0.y, t0.x + 160, t0.y + 90);
    const b1 = await center(sel);
    check('title bar drag moves window', Math.round(b1.left - b0.left) === 160 && Math.round(b1.top - b0.top) === 90, [b1.left - b0.left, b1.top - b0.top]);
    check('title bar drag keeps window size', Math.round(b1.w) === Math.round(b0.w) && Math.round(b1.h) === Math.round(b0.h), [b0.w, b1.w, b0.h, b1.h]);
    const t1 = await center(`${sel} .dsh-dui-title-text`);
    await drag(t1.x, t1.y, t1.x - 120, t1.y + 30);
    const b1b = await center(sel);
    check('dragging left keeps window size', Math.round(b1b.w) === Math.round(b0.w) && Math.round(b1b.h) === Math.round(b0.h), [b0.w, b1b.w]);
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
    // Linked split: dragging the border between two side-by-side windows resizes both.
    // Use exactly two windows (half each) so neither starts near the minimum width.
    {
      const vis = await evaluate(`[...document.querySelectorAll('.dsh-dui-win')].filter(n => !n.hidden).map(n => n.getAttribute('data-session-id'))`);
      const parked = vis.slice(2);
      // Minimize from the taskbar (a focused window's taskbar button minimizes it);
      // the window's own button can be covered when four windows are 280px wide.
      for (const id of parked) {
        await click(`.dsh-dui-task[data-session-id="${id}"]`);
        if (!(await evaluate(`document.querySelector('.dsh-dui-win[data-session-id="${id}"]').hidden`))) await click(`.dsh-dui-task[data-session-id="${id}"]`);
      }
      await wait(`[...document.querySelectorAll('.dsh-dui-win')].filter(n => !n.hidden).length === 2`, 30);
      await click('button[aria-label="Show windows side by side"]');
      await wait(`[...document.querySelectorAll('.dsh-dui-win')].filter(n => !n.hidden).every(n => n.getBoundingClientRect().width > 500)`, 30);
      const ord = await evaluate(`[...document.querySelectorAll('.dsh-dui-win')].filter(n => !n.hidden).map(n => ({ id: n.getAttribute('data-session-id'), x: n.getBoundingClientRect().x })).sort((p, q) => p.x - q.x).map(o => o.id)`);
      const [left, right] = ord;
      const L = `.dsh-dui-win[data-session-id="${left}"]`, R = `.dsh-dui-win[data-session-id="${right}"]`;
      const l0 = await center(L), r0 = await center(R);
      const grip = await center(`${L} [data-edge=e]`);
      // Move the border by less than the room left above the 360px minimum.
      const step = Math.max(20, Math.min(120, Math.floor(l0.w - 370)));
      await drag(grip.x, grip.y, grip.x - step, grip.y);
      const l1 = await center(L), r1 = await center(R);
      check('dragging the border between side-by-side windows resizes both together', Math.round(l0.w - l1.w) === step && Math.round(r1.w - r0.w) === step && Math.round(r1.left - r0.left) === -step, { step, dl: l1.w - l0.w, dr: r1.w - r0.w, drx: r1.left - r0.left });
      check('the gap between linked windows stays the same', Math.round(r1.left - (l1.left + l1.w)) === Math.round(r0.left - (l0.left + l0.w)));
      // Grab the border from the right-hand window's side of the gap.
      const rg = await evaluate(`(() => { const g = document.querySelector(${JSON.stringify(R + ' [data-edge=w]')}).getBoundingClientRect(); const x = g.x + g.width - 2, y = g.y + g.height / 2; return { x, y, hit: document.elementFromPoint(x, y)?.closest('.dsh-dui-win')?.getAttribute('data-session-id') }; })()`);
      await drag(rg.x, rg.y, rg.x + 60, rg.y);
      const l2 = await center(L), r2 = await center(R);
      check('the same border can be grabbed from the other window', Math.round(l2.w - l1.w) === 60 && Math.round(r1.w - r2.w) === 60, { dl: l2.w - l1.w, dr: r1.w - r2.w, grabbed: rg.hit === right });
      const g2 = await center(`${L} [data-edge=e]`);
      await drag(g2.x, g2.y, g2.x + 4000, g2.y);
      const r3 = await center(R);
      check('linked resizing stops at the minimum window width', Math.round(r3.w) >= 359, r3.w);
      for (const id of parked) await click(`.dsh-dui-task[data-session-id="${id}"]`);
      await click('button[aria-label="Show windows side by side"]');
    }
    check('Side by side gives equal columns', noOverlap(cols) && cols.every(b => Math.abs(b[2] - cols[0][2]) < 2 && Math.abs(b[1] - cols[0][1]) < 2), cols.map(b => b.map(Math.round)));
    await click('button[aria-label="Cascade windows"]');
    check('Cascade restores overlapping stack', !noOverlap(await evaluate(visibleBoxes)));

    await click('button[aria-label="Show desktop"]');
    check('Show desktop hides all windows', (await evaluate(visibleBoxes)).length === 0);
    await click('button[aria-label="Show desktop"]');
    check('Show desktop again restores them', (await evaluate(visibleBoxes)).length >= 3);

    // ---- Sidebar hover highlight ----
    {
      const hovered = await focused();
      const wkey = await evaluate(`[...document.querySelectorAll('[role=treeitem]')].map(e => e.getAttribute('data-row-key')).find(k => /^workspace:./.test(k ?? ''))`);
      // Collapse the workspace through its own folder control so the row is hidden.
      if (await evaluate(`document.querySelector('[data-row-key="${wkey}"]')?.getAttribute('aria-expanded') === 'true'`)) await click(`[data-row-key="${wkey}"] [class*="_folder"]`);
      check('hover test starts with the workspace collapsed', await wait(`document.querySelector('[data-row-key="${wkey}"]')?.getAttribute('aria-expanded') === 'false'`, 20));
      const hw = await center(`.dsh-dui-win[data-session-id="${hovered}"] .dsh-dui-title-text`);
      await mouse('mouseMoved', hw.x, hw.y, { buttons: 0 });
      check('hovering a window expands its collapsed workspace', await wait(`document.querySelector('[data-row-key="${wkey}"]')?.getAttribute('aria-expanded') === 'true'`, 30));
      check('hovering a window highlights its session and workspace in the sidebar', await wait(`!!document.querySelector('[data-row-key="session:${hovered}"][data-dsh-desktop-ui-hover]') && !!document.querySelector('[data-row-key="${wkey}"][data-dsh-desktop-ui-hover]')`, 30));
      const tb = await center('.dsh-dui-taskbar');
      await mouse('mouseMoved', tb.x, tb.y, { buttons: 0 });
      check('moving off the windows clears the highlight and re-collapses the workspace', await wait(`!document.querySelector('[data-dsh-desktop-ui-hover]') && document.querySelector('[data-row-key="${wkey}"]')?.getAttribute('aria-expanded') === 'false'`, 30));
      // Opt out in Plugins -> dsh-desktop-ui.
      await openPluginPage();
      check('Plugins page shows the hover opt-out switch', await wait(`!!document.querySelector('[data-dsh-desktop-ui-hover-toggle]')`, 40));
      await click('[data-dsh-desktop-ui-hover-toggle]');
      check('opt-out switch turns the feature off', await wait(`document.querySelector('[data-dsh-desktop-ui-hover-toggle]')?.getAttribute('aria-checked') === 'false'`, 20));
      // Back to the desktop and hover again: nothing happens.
      await click('[data-dsh-desktop-ui-toggle]'); await delay(300);
      if (!(await evaluate(`!!document.querySelector('[data-dsh-desktop-ui]')`))) await click('[data-dsh-desktop-ui-toggle]');
      await wait(`!!document.querySelector('.dsh-dui-win[data-session-id="${hovered}"]')`, 30);
      if (await evaluate(`document.querySelector('[data-row-key="${wkey}"]')?.getAttribute('aria-expanded') === 'true'`)) await click(`[data-row-key="${wkey}"] [class*="_folder"]`);
      const hw2 = await center(`.dsh-dui-win[data-session-id="${hovered}"] .dsh-dui-title-text`);
      await mouse('mouseMoved', hw2.x, hw2.y, { buttons: 0 });
      await delay(700);
      check('with the opt-out, hovering does nothing to the sidebar', await evaluate(`!document.querySelector('[data-dsh-desktop-ui-hover]') && document.querySelector('[data-row-key="${wkey}"]')?.getAttribute('aria-expanded') === 'false'`));
      // Restore the default for later runs.
      await openPluginPage();
      await click('[data-dsh-desktop-ui-hover-toggle]');
      await click('[data-dsh-desktop-ui-toggle]'); await delay(300);
      if (!(await evaluate(`!!document.querySelector('[data-dsh-desktop-ui]')`))) await click('[data-dsh-desktop-ui-toggle]');
      await wait(`!!document.querySelector('.dsh-dui-win[data-session-id="${hovered}"]')`, 30);
      const keep = await center(`.dsh-dui-win[data-session-id="${hovered}"] .dsh-dui-title-text`);
      await mouse('mouseMoved', keep.x, keep.y, { buttons: 0 }); await delay(400);
      await mouse('mouseMoved', tb.x, tb.y, { buttons: 0 }); await delay(500);
    }

    // ---- Popout (browser only) ----
    const popId = await focused();
    const popSel = `.dsh-dui-win[data-session-id="${popId}"]`;
    check('popout button is the 4th control, left of minimize', await evaluate(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(popSel + ' .dsh-dui-ctl button')})]; return b.length === 4 && b[0].hasAttribute('data-popout') && /^Minimize/.test(b[1].getAttribute('aria-label')); })()`));
    const targetsBefore = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter(t => t.type === 'page').map(t => t.id);
    await click(`${popSel} button[data-popout]`);
    let popTarget;
    for (let i = 0; i < 50 && !popTarget; i++) { popTarget = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page' && !targetsBefore.includes(t.id)); if (!popTarget) await delay(100); }
    check('popout opens a new browser window for that session', !!popTarget && popTarget.url.endsWith(`#dsh-desktop-ui-popout=${encodeURIComponent(popId)}`) && !popTarget.url.includes('token='), popTarget?.url?.replace(/token=[^&#]+/, 'token=…'));
    check('canvas shows a popped-out placeholder with Pop back in', await wait(`!!document.querySelector(${JSON.stringify(popSel + ' [data-popin]')})`, 30));
    let pws;
    if (popTarget) {
      pws = new WebSocket(popTarget.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => { pws.onopen = resolve; pws.onerror = reject; });
      let pseq = 0; const ppending = new Map();
      pws.onmessage = ({ data }) => { const m = JSON.parse(data); if (m.id) { ppending.get(m.id)?.(m); ppending.delete(m.id); } };
      const psend = (method, params = {}) => new Promise(r => { const id = ++pseq; ppending.set(id, r); pws.send(JSON.stringify({ id, method, params })); });
      const pev = async e => (await psend('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
      let ready = false;
      for (let i = 0; i < 80 && !ready; i++) { ready = await pev(`!!document.querySelector('[data-popin]') && !!document.querySelector('[data-conversation-content]')`).catch(() => false); if (!ready) await delay(150); }
      check('popout window shows only that session, with Pop back in in its header', ready && await pev(`(() => { const sb = document.querySelector('[class*="_sidebarCol"]'); return (!sb || sb.getBoundingClientRect().width === 0) && !document.querySelector('[data-dsh-desktop-ui]') && localStorage !== undefined; })()`));
      // A fresh test profile shows first-run dialogs in the new window too.
      for (let i = 0, quiet = 0; i < 60 && quiet < 10; i++) {
        const dlg = await pev(`(() => { const b = [...document.querySelectorAll('button')].find(e => ['Configure later', 'Continue'].includes(e.textContent.trim()) && e.closest('[role=dialog], [role=presentation], [aria-modal=true]')); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
        if (dlg) { await psend('Input.dispatchMouseEvent', { type: 'mousePressed', x: dlg.x, y: dlg.y, button: 'left', buttons: 1, clickCount: 1 }); await psend('Input.dispatchMouseEvent', { type: 'mouseReleased', x: dlg.x, y: dlg.y, button: 'left', buttons: 0, clickCount: 1 }); await delay(400); quiet = 0; } else { quiet++; await delay(100); }
      }
      const c = await pev(`(() => { const b = document.querySelector('[data-popin]'); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      await psend('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', buttons: 1, clickCount: 1 });
      await psend('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', buttons: 0, clickCount: 1 });
    }
    check('Pop back in returns the session to the canvas', await wait(`!document.querySelector(${JSON.stringify(popSel + ' [data-popin]')}) && !!document.querySelector(${JSON.stringify(popSel + ' [data-dsh-desktop-ui-full], ' + popSel + ' .dsh-dui-content')})`, 60));
    let gone = false;
    for (let i = 0; i < 40 && !gone; i++) { gone = !(await (await fetch(`http://127.0.0.1:${port}/json`)).json()).some(t => t.id === popTarget?.id); if (!gone) await delay(150); }
    check('Pop back in closes the popout window', gone);
    try { pws?.close(); } catch {}

    const before = (await state()).windows.length;
    const last = await focused();
    await closeWindow(last);
    check('close removes window and taskbar entry', (await state()).windows.length === before - 1 && !(await evaluate(`!!document.querySelector('.dsh-dui-task[data-session-id="${last}"]')`)));
    check('closing a window keeps the session in the sidebar', await evaluate(`!!document.querySelector('[data-row-key="session:${last}"]')`));

    const saved = await state();
    await delay(900);
    await send('Page.reload');
    await dismissOnboarding();
    check('desktop mode survives reload', await wait(`!!document.querySelector('[data-dsh-desktop-ui]')`));
    // Text size control: one click steps up and is applied to every window.
    await wait(`!!document.querySelector('.dsh-dui-scale')`, 30);
    const z0 = await evaluate(`document.querySelector('.dsh-dui-scale')?.textContent`);
    await click('.dsh-dui-scale');
    const z1 = await evaluate(`document.querySelector('.dsh-dui-scale')?.textContent`);
    const z1n = parseFloat(z1) / 100;
    check('text size control rescales window content', z1 !== z0 && await wait(`[...document.querySelectorAll('.dsh-dui-content')].every(c => Math.abs(parseFloat(getComputedStyle(c).zoom) - ${z1n}) < 0.01)`, 20), { z0, z1 });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: (await center('.dsh-dui-scale')).x, y: (await center('.dsh-dui-scale')).y, button: 'right', buttons: 2, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: (await center('.dsh-dui-scale')).x, y: (await center('.dsh-dui-scale')).y, button: 'right', buttons: 0, clickCount: 1 });
    check('right-click steps the text size back down', await wait(`document.querySelector('.dsh-dui-scale')?.textContent === ${JSON.stringify(z0)}`, 20));
    // Host persistence: a brand-new browser profile (no localStorage) must get the same desktop.
    await delay(900);
    await evaluate(`localStorage.removeItem('dsh-desktop-ui.state.v1')`);
    await send('Page.reload');
    await dismissOnboarding();
    const restoredOk = await wait(`!!document.querySelector('[data-dsh-desktop-ui]') && document.querySelectorAll('.dsh-dui-win').length >= 1`, 60);
    const restoredIds = await evaluate(`[...document.querySelectorAll('.dsh-dui-win')].map(n => n.getAttribute('data-session-id')).sort().join()`);
    check('layout restores from the Host when the browser copy is gone', restoredOk && restoredIds === saved.windows.map(w => w.sessionId).sort().join(), { restoredIds, saved: saved.windows.map(w => w.sessionId).sort().join() });
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

    // A corrupted browser copy must never break the desktop; the Host copy wins.
    await evaluate(`localStorage.setItem('dsh-desktop-ui.state.v1', '{"enabled":true,"windows":[{"sessionId":"<img src=x onerror=alert(1)>","x":"bad","w":99},{"sessionId":42},null]}')`);
    await send('Page.reload');
    await dismissOnboarding();
    await wait(`!!document.querySelector('[data-dsh-desktop-ui]')`);
    await delay(1200);
    check('malformed browser state is ignored safely', await evaluate(`!document.querySelector('.dsh-dui-win img') && !document.querySelector('.dsh-dui-win[data-session-id^="<"]')`));
    const after = await evaluate(`[...document.querySelectorAll('.dsh-dui-win')].map(n => n.getAttribute('data-session-id'))`);
    const known = await evaluate(`(async () => { const ids = [...document.querySelectorAll('.dsh-dui-win')].map(n => n.getAttribute('data-session-id')); return ids.filter(id => !document.querySelector('.dsh-dui-win[data-session-id="' + id + '"] .dsh-dui-note')); })()`);
    check('only real sessions get windows (each one opens)', after.length > 0 && known.length === after.length && after.every(id => /^session-[\w-]+$/.test(id)), { after, known });
    // Let the restored desktop settle (boot selection), then close everything.
    await delay(3000);
    for (let pass = 0; pass < 3; pass++) {
      const open = await evaluate(`[...document.querySelectorAll('.dsh-dui-win')].map(n => n.getAttribute('data-session-id'))`);
      if (!open.length) break;
      for (const id of open) await closeWindow(id);
      await delay(500);
    }
    check('empty desktop shows guidance', await wait(`/No windows open/.test(document.querySelector('[data-dsh-desktop-ui]').innerText)`, 20), await evaluate(`[...document.querySelectorAll('.dsh-dui-win')].map(n => n.getAttribute('data-session-id'))`));
    await delay(800);

    // A closed window must stay closed after a reload (DSH reselecting the
    // last session on boot is not a user action).
    await send('Page.reload');
    await dismissOnboarding();
    await wait(`!!document.querySelector('[data-dsh-desktop-ui]')`);
    await delay(3200);
    check('closed windows stay closed after reload', await evaluate(`document.querySelectorAll('.dsh-dui-win').length === 0`), await evaluate(`[...document.querySelectorAll('.dsh-dui-win')].map(n => n.getAttribute('data-session-id'))`));
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
