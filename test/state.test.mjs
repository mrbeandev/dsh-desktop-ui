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
