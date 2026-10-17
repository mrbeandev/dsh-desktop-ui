import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createClientPlugin } from '../client/index.mjs';

const P = createClientPlugin(() => ({}));
const size = { width: 1000, height: 800 };

test('sanitize rejects malformed and adversarial persisted state', () => {
  assert.deepEqual(P.sanitize(null).windows, []);
  assert.deepEqual(P.sanitize('x').windows, []);
  assert.deepEqual(P.sanitize([]).windows, []);
  const s = P.sanitize({ enabled: 'yes', windows: [
    { sessionId: 'a', x: 99, y: -4, w: NaN, h: 'big', z: -1 },
    { sessionId: 'a' },
    { sessionId: '' },
    { sessionId: 7 },
    null,
    { sessionId: 'b', minimized: true, maximized: 1 },
  ] });
  assert.equal(s.enabled, false);
  assert.deepEqual(s.windows.map(w => w.sessionId), ['a', 'b']);
  const a = s.windows[0];
  assert.ok(a.x <= 0.95 && a.y >= 0 && a.w > 0 && a.h > 0 && a.z === 0);
  assert.equal(s.windows[1].minimized, true);
  assert.equal(s.windows[1].maximized, false);
});

test('sanitize bounds the number of windows', () => {
  const windows = Array.from({ length: 100 }, (_, i) => ({ sessionId: `s${i}` }));
  assert.equal(P.sanitize({ windows }).windows.length, P.constants.MAX_WINDOWS);
});

test('open raises an existing window instead of duplicating it', () => {
  let s = P.emptyState();
  s = P.openWindow(s, 'a');
  s = P.openWindow(s, 'b');
  assert.equal(P.focusedId(s), 'b');
  s = P.minimizeWindow(s, 'a');
  s = P.openWindow(s, 'a');
  assert.equal(s.windows.length, 2);
  assert.equal(P.focusedId(s), 'a');
  assert.equal(s.windows.find(w => w.sessionId === 'a').minimized, false);
});

test('open evicts the least recently focused window at the bound', () => {
  let s = P.emptyState();
  for (let i = 0; i < P.constants.MAX_WINDOWS; i++) s = P.openWindow(s, `s${i}`);
  s = P.focusWindow(s, 's0');
  s = P.openWindow(s, 'new');
  assert.equal(s.windows.length, P.constants.MAX_WINDOWS);
  assert.ok(s.windows.some(w => w.sessionId === 's0'));
  assert.ok(!s.windows.some(w => w.sessionId === 's1'));
});

test('focus, minimize, maximize and close', () => {
  let s = P.openWindow(P.openWindow(P.emptyState(), 'a'), 'b');
  s = P.focusWindow(s, 'a');
  assert.equal(P.focusedId(s), 'a');
  s = P.minimizeWindow(s, 'a');
  assert.equal(P.focusedId(s), 'b');
  s = P.toggleMaximize(s, 'b');
  assert.equal(s.windows.find(w => w.sessionId === 'b').maximized, true);
  s = P.toggleMaximize(s, 'b');
  assert.equal(s.windows.find(w => w.sessionId === 'b').maximized, false);
  s = P.closeWindow(s, 'b');
  assert.deepEqual(s.windows.map(w => w.sessionId), ['a']);
  assert.equal(P.focusedId(s), undefined);
  assert.equal(P.focusWindow(s, 'missing'), s);
});

test('snap left/right fill halves with gutters; snap max maximizes', () => {
  let s = P.openWindow(P.emptyState(), 'a');
  s = P.snapWindow(s, 'a', 'left', size);
  const a = s.windows[0];
  assert.ok(a.x > 0 && a.x < 0.02 && a.w < 0.5 && a.w > 0.48 && a.h > 0.97);
  s = P.snapWindow(s, 'a', 'right', size);
  assert.ok(s.windows[0].x > 0.5);
  s = P.snapWindow(s, 'a', 'max', size);
  assert.equal(s.windows[0].maximized, true);
});

test('arrangements cover the canvas without overlap', () => {
  for (const kind of ['grid', 'columns']) {
    for (const n of [1, 2, 3, 4, 5, 7]) {
      const g = P.arrangeGeometry(kind, n, size);
      assert.equal(g.length, n);
      for (const r of g) assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= 1.0001 && r.y + r.h <= 1.0001, `${kind} ${n} in bounds`);
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const A = g[i], B = g[j];
        const overlap = A.x < B.x + B.w - 1e-6 && B.x < A.x + A.w - 1e-6 && A.y < B.y + B.h - 1e-6 && B.y < A.y + A.h - 1e-6;
        assert.ok(!overlap, `${kind} ${n}: ${i} overlaps ${j}`);
      }
    }
  }
  assert.equal(P.arrangeGeometry('grid', 0, size).length, 0);
});

test('arrange skips minimized windows and clears maximize', () => {
  let s = P.emptyState();
  for (const id of ['a', 'b', 'c']) s = P.openWindow(s, id);
  s = P.toggleMaximize(s, 'a');
  s = P.minimizeWindow(s, 'c');
  const c = s.windows.find(w => w.sessionId === 'c');
  s = P.arrange(s, 'columns', size);
  assert.equal(s.windows.find(w => w.sessionId === 'a').maximized, false);
  assert.deepEqual(s.windows.find(w => w.sessionId === 'c'), c);
  const [a, b] = ['a', 'b'].map(id => s.windows.find(w => w.sessionId === id));
  assert.ok(Math.abs(a.w - b.w) < 1e-9 && a.w < 0.5);
});

test('show desktop minimizes visible windows and restores only those', () => {
  let s = P.emptyState();
  for (const id of ['a', 'b', 'c']) s = P.openWindow(s, id);
  s = P.minimizeWindow(s, 'c');
  s = P.toggleShowDesktop(s);
  assert.ok(s.windows.every(w => w.minimized));
  s = P.toggleShowDesktop(s);
  assert.deepEqual(s.windows.map(w => w.minimized), [false, false, true]);
});

test('prune removes windows for deleted sessions only', () => {
  let s = P.openWindow(P.openWindow(P.emptyState(), 'a'), 'b');
  assert.equal(P.pruneMissing(s, new Set(['a', 'b'])), s);
  s = P.pruneMissing(s, new Set(['b']));
  assert.deepEqual(s.windows.map(w => w.sessionId), ['b']);
});

test('serialize round-trips through sanitize without transient fields', () => {
  let s = P.openWindow(P.openWindow(P.emptyState(), 'a'), 'b');
  s = { ...P.toggleShowDesktop(s), enabled: true };
  const text = P.serialize(s);
  assert.ok(!text.includes('hiddenByDesktop') && !text.includes('desktopShown'));
  const back = P.sanitize(JSON.parse(text));
  assert.equal(back.enabled, true);
  assert.deepEqual(back.windows.map(w => w.sessionId), ['a', 'b']);
});

test('runtime identities are unique and consistent', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8');
  assert.equal(pkg.name, 'dsh-desktop-ui');
  assert.equal(P.constants.PANEL, pkg.name);
  assert.match(patch, /id: dsh-desktop-ui/);
  assert.ok(P.constants.STORAGE_KEY.startsWith('dsh-desktop-ui.'));
  assert.ok(P.constants.WINDOW_SLOT.startsWith('dsh-desktop-ui.'));
  assert.deepEqual(P.inject, ['slots', 'layout', 'sessions', 'uiSession', 'uiWorkspace']);
});

test('generated bundle matches source and registers the expected id', async () => {
  const bundle = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  assert.ok(bundle.includes("id: 'dsh-desktop-ui'"));
  assert.ok(bundle.includes(createClientPlugin.toString()), 'lib/client.js is stale; run npm run build');
  assert.ok(!/innerHTML|dangerouslySetInnerHTML|eval\(|new Function/.test(createClientPlugin.toString()));
});

test('moving by the title bar never changes the window size (regression)', () => {
  const start = { x: 100, y: 80, w: 600, h: 400 };
  for (const [dx, dy] of [[150, 0], [-90, 40], [0, -500], [300, 300]]) {
    const r = P.dragRect(start, 'move', dx, dy);
    assert.equal(r.w, 600);
    assert.equal(r.h, 400);
    assert.equal(r.x, 100 + dx);
    assert.equal(r.y, Math.max(0, 80 + dy));
  }
});

test('resizing from each edge only changes the dragged sides', () => {
  const s = { x: 100, y: 100, w: 600, h: 400 };
  assert.deepEqual(P.dragRect(s, 'e', 50, 30), { x: 100, y: 100, w: 650, h: 400 });
  assert.deepEqual(P.dragRect(s, 's', 50, 30), { x: 100, y: 100, w: 600, h: 430 });
  assert.deepEqual(P.dragRect(s, 'w', 50, 30), { x: 150, y: 100, w: 550, h: 400 });
  assert.deepEqual(P.dragRect(s, 'n', 50, 30), { x: 100, y: 130, w: 600, h: 370 });
  assert.deepEqual(P.dragRect(s, 'se', 20, 10), { x: 100, y: 100, w: 620, h: 410 });
  assert.deepEqual(P.dragRect(s, 'nw', -20, -10), { x: 80, y: 90, w: 620, h: 410 });
  // Minimum size holds, and the anchored opposite edge stays put.
  const tiny = P.dragRect(s, 'w', 1000, 0);
  assert.equal(tiny.x + tiny.w, 700);
  assert.ok(tiny.w >= 360);
  // Top edge cannot go above the canvas.
  const up = P.dragRect(s, 'n', 0, -500);
  assert.equal(up.y, 0);
  assert.equal(up.y + up.h, 500);
  // Unknown edges are ignored.
  assert.deepEqual(P.dragRect(s, 'bogus', 50, 50), s);
});

test('a session can only ever have one window', () => {
  let s = P.emptyState();
  s = P.openWindow(s, 'a');
  s = P.openWindow(s, 'b');
  for (let i = 0; i < 5; i++) s = P.openWindow(s, 'a');
  assert.deepEqual(s.windows.map(w => w.sessionId).sort(), ['a', 'b']);
  assert.equal(P.focusedId(s), 'a');
  // Reopening restores a minimized window rather than duplicating it.
  s = P.minimizeWindow(s, 'b');
  s = P.openWindow(s, 'b');
  assert.equal(s.windows.filter(w => w.sessionId === 'b').length, 1);
  assert.equal(s.windows.find(w => w.sessionId === 'b').minimized, false);
});

test('duplicate windows in stored or corrupted state collapse to one', () => {
  const s = P.sanitize({ windows: [{ sessionId: 'a', x: 0.1 }, { sessionId: 'b' }, { sessionId: 'a', x: 0.9 }] });
  assert.deepEqual(s.windows.map(w => w.sessionId), ['a', 'b']);
  assert.equal(s.windows[0].x, 0.1);
  const dup = { ...P.emptyState(), windows: [{ sessionId: 'a', z: 1 }, { sessionId: 'a', z: 2 }] };
  assert.deepEqual(P.uniqueWindows(dup.windows).map(w => w.sessionId), ['a']);
  assert.equal(P.openWindow(dup, 'a').windows.length, 1);
});

test('Desktop mode toggle sorts above other sidebar footer actions', async () => {
  // dsh-all-usage registers order 10; stock entries default to 0.
  assert.ok(P.constants.TOGGLE_ORDER < 0);
  const src = createClientPlugin.toString();
  assert.match(src, /order: TOGGLE_ORDER/);
  assert.match(src, /_footerActions"\]:has\(\[data-dsh-desktop-ui-toggle\]\)\{flex-direction:column/);
});

test('zoom is persisted, validated and cycles through fixed steps', () => {
  const { ZOOM_STEPS, DEFAULT_ZOOM } = P.constants;
  assert.equal(P.emptyState().zoom, DEFAULT_ZOOM);
  assert.equal(P.sanitize({ zoom: 0.8 }).zoom, 0.8);
  assert.equal(P.sanitize({ zoom: 7 }).zoom, DEFAULT_ZOOM);
  assert.equal(P.sanitize({ zoom: '0.8' }).zoom, DEFAULT_ZOOM);
  let s = P.emptyState();
  const seen = new Set();
  for (let i = 0; i < ZOOM_STEPS.length; i++) { seen.add(s.zoom); s = P.cycleZoom(s, 1); }
  assert.equal(seen.size, ZOOM_STEPS.length);
  assert.equal(s.zoom, DEFAULT_ZOOM);
  assert.equal(P.cycleZoom(P.cycleZoom(s, 1), -1).zoom, DEFAULT_ZOOM);
  assert.equal(P.sanitize(JSON.parse(P.serialize({ ...s, zoom: 0.7 }))).zoom, 0.7);
});

test('parseLayout rejects malformed, oversized and empty documents', () => {
  assert.equal(P.parseLayout(''), undefined);
  assert.equal(P.parseLayout('{nope'), undefined);
  assert.equal(P.parseLayout(42), undefined);
  assert.equal(P.parseLayout('x'.repeat(70 * 1024)), undefined);
  assert.deepEqual(P.parseLayout('{"enabled":true,"windows":[{"sessionId":"a"}]}').windows.map(w => w.sessionId), ['a']);
});

test('findEntryNamespace locates this plugin only', () => {
  const ns = names => names.map(n => ({ ns: n }));
  assert.equal(P.findEntryNamespace(ns(['ui-conversation', 'include:dsh-desktop-ui'])), 'include:dsh-desktop-ui');
  assert.equal(P.findEntryNamespace(ns(['dsh-desktop-ui'])), 'dsh-desktop-ui');
  assert.equal(P.findEntryNamespace(ns(['web:dsh-desktop-ui'])), 'web:dsh-desktop-ui');
  assert.equal(P.findEntryNamespace(ns(['dsh-desktop-ui-other', 'other'])), undefined);
  assert.equal(P.findEntryNamespace(null), undefined);
});

function fakeForm(initial) {
  let snap = { status: 'ready', writable: true, mode: 'host', revision: 1, value: { layout: initial } };
  const listeners = new Set();
  const writes = [];
  return {
    writes,
    getSnapshot: () => snap,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async set(field, value) { writes.push([field, value]); snap = { ...snap, revision: snap.revision + 1, value: { ...snap.value, [field]: value } }; for (const fn of listeners) fn(); return true; },
  };
}
const memoryStorage = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };

test('host layout wins over the browser copy after a restart', () => {
  const browser = memoryStorage();
  browser.setItem(P.constants.STORAGE_KEY, JSON.stringify({ enabled: false, windows: [{ sessionId: 'stale' }] }));
  const store = P.createStore(browser);
  const host = JSON.stringify({ enabled: true, zoom: 0.8, windows: [{ sessionId: 'a', x: 0.1, y: 0.2, w: 0.5, h: 0.6, z: 3 }, { sessionId: 'b', minimized: true }] });
  const sync = P.createHostSync(null, store);
  const form = fakeForm(host);
  sync.attach(form);
  const s = store.get();
  assert.equal(s.enabled, true);
  assert.equal(s.zoom, 0.8);
  assert.deepEqual(s.windows.map(w => [w.sessionId, w.minimized]), [['a', false], ['b', true]]);
  assert.equal(s.windows[0].x, 0.1);
  assert.equal(form.writes.length, 0, 'adopting the Host copy must not echo a write');
  assert.equal(JSON.parse(browser.getItem(P.constants.STORAGE_KEY)).windows[0].sessionId, 'a');
  sync.dispose();
});

test('an empty Host is seeded from the browser, then later changes are written (debounced)', async () => {
  const browser = memoryStorage();
  browser.setItem(P.constants.STORAGE_KEY, JSON.stringify({ enabled: true, windows: [{ sessionId: 'a' }] }));
  let sync;
  const store = P.createStore(browser, text => sync?.persist(text));
  sync = P.createHostSync(null, store, { delay: 10 });
  const form = fakeForm('');
  sync.attach(form);
  assert.equal(form.writes.length, 1);
  assert.equal(JSON.parse(form.writes[0][1]).windows[0].sessionId, 'a');
  await new Promise(r => setTimeout(r, 0));
  store.set(P.openWindow(store.get(), 'b'));
  store.set(P.openWindow(store.get(), 'c'));
  assert.equal(form.writes.length, 1, 'debounced');
  await new Promise(r => setTimeout(r, 30));
  assert.equal(form.writes.length, 2);
  assert.deepEqual(JSON.parse(form.writes[1][1]).windows.map(w => w.sessionId), ['a', 'b', 'c']);
  await new Promise(r => setTimeout(r, 0));
  store.set(P.minimizeWindow(store.get(), 'a'));
  sync.flush();
  assert.equal(form.writes.length, 3, 'flush writes immediately (page hide)');
  sync.dispose();
});

test('a malformed Host value is ignored and the browser copy is kept', () => {
  const browser = memoryStorage();
  browser.setItem(P.constants.STORAGE_KEY, JSON.stringify({ enabled: true, windows: [{ sessionId: 'keep' }] }));
  const store = P.createStore(browser);
  const sync = P.createHostSync(null, store);
  sync.attach(fakeForm('{"windows": not json'));
  assert.deepEqual(store.get().windows.map(w => w.sessionId), ['keep']);
  sync.dispose();
});

test('host entry declares a volatile layout field', async () => {
  const { createConfig } = await import('../index.mjs');
  const calls = [];
  const chain = new Proxy(function () {}, { get: (_t, k) => (...a) => { calls.push([k, ...a]); return chain; }, apply: () => chain });
  createConfig({ object: fields => { calls.push(['object', Object.keys(fields)]); return chain; }, string: () => chain });
  assert.deepEqual(calls[calls.length - 1], ['object', ['layout']]);
  assert.ok(calls.some(c => c[0] === 'volatile'));
});

test('a change made before the Host answers is not overwritten by a late Host copy', () => {
  const browser = memoryStorage();
  let sync;
  const store = P.createStore(browser, text => sync?.persist(text));
  sync = P.createHostSync(null, store, { delay: 10_000 });
  store.set(P.openWindow(store.get(), 'mine'));
  const form = fakeForm(JSON.stringify({ enabled: true, windows: [{ sessionId: 'old-a' }, { sessionId: 'old-b' }] }));
  sync.attach(form);
  assert.deepEqual(store.get().windows.map(w => w.sessionId), ['mine']);
  assert.equal(form.writes.length, 1);
  assert.deepEqual(JSON.parse(form.writes[0][1]).windows.map(w => w.sessionId), ['mine']);
  sync.dispose();
});

test('host writes are serialized so an older layout can never land last', async () => {
  let resolveFirst;
  const writes = [];
  const form = {
    getSnapshot: () => ({ status: 'ready', writable: true, mode: 'host', revision: 1, value: { layout: '' } }),
    subscribe: () => () => {},
    set(field, value) { writes.push(value); return writes.length === 1 ? new Promise(r => { resolveFirst = () => r(true); }) : Promise.resolve(true); },
  };
  let sync;
  const store = P.createStore(memoryStorage(), text => sync?.persist(text));
  sync = P.createHostSync(null, store, { delay: 0 });
  sync.attach(form);
  store.set(P.openWindow(store.get(), 'a')); sync.flush();
  store.set(P.openWindow(store.get(), 'b')); sync.flush();
  store.set(P.openWindow(store.get(), 'c')); sync.flush();
  assert.equal(writes.length, 1, 'second write waits for the first');
  resolveFirst();
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));
  assert.equal(writes.length, 2, 'only the latest queued layout is written next');
  assert.deepEqual(JSON.parse(writes[1]).windows.map(w => w.sessionId), ['a', 'b', 'c']);
  sync.dispose();
});
