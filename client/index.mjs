/**
 * dsh-desktop-ui — Desktop mode for the DeepSeek Harness web GUI.
 *
 * Self-contained factory: scripts/build.mjs embeds it as a lazy module, so
 * `require('react')` resolves to the GUI's own React singleton. Everything the
 * browser bundle needs must live inside this function.
 *
 * Runtime contract (inspected against DSH 0.2.0-rc.2):
 * - `main` keyed slot, key `dsh-desktop-ui`: the desktop canvas + taskbar.
 *   It replaces the conversation area only while selected; the sidebar stays.
 * - `dsh-desktop-ui.window` (session scope): one embedded Conversation per
 *   window, rendered through the public `conversation.content` factory with
 *   `variant: 'embedded'` — the same seam ui-subagent uses for sidebar chats.
 * - `sidebar.footer.action`: the Desktop mode toggle, directly above Settings.
 * - Each window owns an independent `ctx.sessions.retain(id)` reference,
 *   released when the window closes or the desktop unmounts.
 *
 * State (open windows, geometry, on/off) is browser-local in localStorage.
 * Nothing is written to the host, and no session data is persisted here.
 */
export function createClientPlugin(require) {
  const React = require('react');
  const { createElement: h, useEffect, useRef, useState, useSyncExternalStore, useCallback } = React;

  const PANEL = 'dsh-desktop-ui';
  const WINDOW_SLOT = 'dsh-desktop-ui.window';
  const TOGGLE_ID = 'dsh-desktop-ui.toggle';
  const TOGGLE_ORDER = -100;
  const STORAGE_KEY = 'dsh-desktop-ui.state.v1';
  const STYLE_ID = 'dsh-desktop-ui.css';
  const REF_SOURCE = 'desktopWindow';
  const MAX_WINDOWS = 24;
  const MIN_W = 360;
  const MIN_H = 240;
  const NARROW = 720;
  const GAP = 8;
  const ZOOM_STEPS = [0.7, 0.75, 0.8, 0.85, 0.9, 1];
  const DEFAULT_ZOOM = 0.85;
  const inject = ['slots', 'layout', 'sessions', 'uiSession', 'uiWorkspace'];
  const CAPTURED = Symbol.for('dsh-desktop-ui.captured');

  /* ------------------------------------------------------------------ */
  /* Pure state helpers (exported for tests).                            */
  /* ------------------------------------------------------------------ */

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const frac = (n, fallback) => (typeof n === 'number' && Number.isFinite(n) ? clamp(n, 0, 1) : fallback);
  const validId = id => typeof id === 'string' && id.length > 0 && id.length <= 256;

  function emptyState() {
    return { enabled: false, windows: [], z: 0, desktopShown: false, zoom: DEFAULT_ZOOM };
  }

  /** Read untrusted persisted state into a canonical, bounded shape. */
  function sanitize(raw) {
    const state = emptyState();
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return state;
    state.enabled = raw.enabled === true;
    state.zoom = ZOOM_STEPS.includes(raw.zoom) ? raw.zoom : DEFAULT_ZOOM;
    const seen = new Set();
    const list = Array.isArray(raw.windows) ? raw.windows : [];
    for (const item of list) {
      if (state.windows.length >= MAX_WINDOWS) break;
      if (item === null || typeof item !== 'object' || !validId(item.sessionId) || seen.has(item.sessionId)) continue;
      seen.add(item.sessionId);
      const w = clamp(frac(item.w, 0.56), 0.1, 1);
      const hh = clamp(frac(item.h, 0.72), 0.1, 1);
      state.windows.push({
        sessionId: item.sessionId,
        x: clamp(frac(item.x, 0.05), 0, 1 - 0.05),
        y: clamp(frac(item.y, 0.05), 0, 1 - 0.05),
        w, h: hh,
        z: Number.isInteger(item.z) && item.z >= 0 ? item.z : 0,
        minimized: item.minimized === true,
        maximized: item.maximized === true,
      });
    }
    state.windows = uniqueWindows(state.windows);
    state.z = state.windows.reduce((m, w) => Math.max(m, w.z), 0);
    return state;
  }

  /** The focused window: highest z among non-minimized windows. */
  function focusedId(state) {
    let best;
    for (const w of state.windows) if (!w.minimized && (best === undefined || w.z > best.z)) best = w;
    return best?.sessionId;
  }

  function cascadeSlot(index) {
    const i = index % 8;
    return { x: 0.04 + i * 0.035, y: 0.04 + i * 0.045, w: 0.56, h: 0.72 };
  }

  function withWindow(state, id, patch) {
    return { ...state, windows: state.windows.map(w => (w.sessionId === id ? { ...w, ...patch } : w)) };
  }

  /** Keep exactly one window per session id (first occurrence wins). */
  function uniqueWindows(windows) {
    const seen = new Set();
    return windows.filter(w => (seen.has(w.sessionId) ? false : (seen.add(w.sessionId), true)));
  }

  /**
   * Open a session as a window. A session can only have one window: opening
   * it again restores and focuses the existing window instead.
   */
  function openWindow(state, id) {
    if (!validId(id)) return state;
    const z = state.z + 1;
    if (state.windows.some(w => w.sessionId === id)) {
      return { ...withWindow({ ...state, windows: uniqueWindows(state.windows) }, id, { minimized: false, z }), z, desktopShown: false };
    }
    let windows = state.windows;
    if (windows.length >= MAX_WINDOWS) {
      // Drop the least recently focused window to keep the bound.
      const oldest = windows.reduce((a, b) => (b.z < a.z ? b : a));
      windows = windows.filter(w => w !== oldest);
    }
    const slot = cascadeSlot(windows.length);
    return { ...state, z, desktopShown: false, windows: [...windows, { sessionId: id, ...slot, z, minimized: false, maximized: false }] };
  }

  function closeWindow(state, id) {
    return { ...state, windows: state.windows.filter(w => w.sessionId !== id) };
  }

  function focusWindow(state, id) {
    const target = state.windows.find(w => w.sessionId === id);
    if (!target) return state;
    if (!target.minimized && focusedId(state) === id) return state;
    const z = state.z + 1;
    return { ...withWindow(state, id, { minimized: false, z }), z, desktopShown: false };
  }

  function minimizeWindow(state, id) {
    return withWindow(state, id, { minimized: true });
  }

  function toggleMaximize(state, id) {
    const target = state.windows.find(w => w.sessionId === id);
    if (!target) return state;
    const z = state.z + 1;
    return { ...withWindow(state, id, { maximized: !target.maximized, minimized: false, z }), z };
  }

  function setGeometry(state, id, geom) {
    return withWindow(state, id, {
      x: clamp(frac(geom.x, 0), 0, 0.95),
      y: clamp(frac(geom.y, 0), 0, 0.95),
      w: clamp(frac(geom.w, 0.5), 0.1, 1),
      h: clamp(frac(geom.h, 0.5), 0.1, 1),
      maximized: false,
    });
  }

  /** Snap targets: left half, right half, or maximize. */
  function snapGeometry(kind, size) {
    const gx = GAP / Math.max(1, size.width);
    const gy = GAP / Math.max(1, size.height);
    if (kind === 'left') return { x: gx, y: gy, w: 0.5 - 1.5 * gx, h: 1 - 2 * gy };
    if (kind === 'right') return { x: 0.5 + 0.5 * gx, y: gy, w: 0.5 - 1.5 * gx, h: 1 - 2 * gy };
    return undefined;
  }

  function snapWindow(state, id, kind, size) {
    if (kind === 'max') {
      const z = state.z + 1;
      return { ...withWindow(state, id, { maximized: true, z }), z };
    }
    const geom = snapGeometry(kind, size);
    return geom ? setGeometry(state, id, geom) : state;
  }

  /**
   * Arrange visible windows. `kind`: cascade | grid | columns.
   * Fractions include an 8px gutter derived from the canvas size.
   */
  function arrangeGeometry(kind, count, size) {
    if (count <= 0) return [];
    const gx = GAP / Math.max(1, size.width);
    const gy = GAP / Math.max(1, size.height);
    if (kind === 'cascade') return Array.from({ length: count }, (_, i) => cascadeSlot(i));
    let cols, rows;
    if (kind === 'columns') { cols = count; rows = 1; } else { cols = Math.ceil(Math.sqrt(count)); rows = Math.ceil(count / cols); }
    const cw = (1 - gx * (cols + 1)) / cols;
    const rh = (1 - gy * (rows + 1)) / rows;
    return Array.from({ length: count }, (_, i) => {
      const r = Math.floor(i / cols), c = i % cols;
      // Stretch the last row's windows across the full width.
      const inLast = r === rows - 1 ? count - r * cols : cols;
      const w = kind === 'grid' && r === rows - 1 ? (1 - gx * (inLast + 1)) / inLast : cw;
      return { x: gx + c * (w + gx), y: gy + r * (rh + gy), w, h: rh };
    });
  }

  function arrange(state, kind, size) {
    const visible = state.windows.filter(w => !w.minimized).sort((a, b) => a.z - b.z);
    const slots = arrangeGeometry(kind, visible.length, size);
    const byId = new Map(visible.map((w, i) => [w.sessionId, slots[i]]));
    return {
      ...state,
      desktopShown: false,
      windows: state.windows.map(w => (byId.has(w.sessionId) ? { ...w, ...byId.get(w.sessionId), maximized: false } : w)),
    };
  }

  /** Windows' "show desktop": minimize everything, or restore what it hid. */
  function toggleShowDesktop(state) {
    if (state.desktopShown) {
      return { ...state, desktopShown: false, windows: state.windows.map(w => (w.hiddenByDesktop ? { ...w, minimized: false, hiddenByDesktop: false } : w)) };
    }
    return { ...state, desktopShown: true, windows: state.windows.map(w => (w.minimized ? w : { ...w, minimized: true, hiddenByDesktop: true })) };
  }

  const RESIZE_EDGES = new Set(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']);

  /**
   * Pixel rectangle after dragging by (dx, dy). `edge` is 'move' for the title
   * bar or a compass edge for resizing. Moving never changes the size.
   */
  function dragRect(start, edge, dx, dy) {
    if (edge === 'move') return { x: start.x + dx, y: Math.max(0, start.y + dy), w: start.w, h: start.h };
    if (!RESIZE_EDGES.has(edge)) return { ...start };
    let { x, y, w, h } = start;
    if (edge.includes('e')) w = Math.max(MIN_W, start.w + dx);
    if (edge.includes('s')) h = Math.max(MIN_H, start.h + dy);
    if (edge.includes('w')) { w = Math.max(MIN_W, start.w - dx); x = start.x + (start.w - w); }
    if (edge.includes('n')) { h = Math.max(MIN_H, start.h - dy); y = start.y + (start.h - h); if (y < 0) { h += y; y = 0; } }
    return { x, y, w, h };
  }

  /** Step the window content scale through ZOOM_STEPS (wraps around). */
  function cycleZoom(state, direction = 1) {
    const i = ZOOM_STEPS.indexOf(state.zoom);
    const next = ZOOM_STEPS[((i < 0 ? ZOOM_STEPS.indexOf(DEFAULT_ZOOM) : i) + direction + ZOOM_STEPS.length) % ZOOM_STEPS.length];
    return { ...state, zoom: next };
  }

  /** Remove windows whose session no longer exists in the host catalog. */
  function pruneMissing(state, knownIds) {
    const next = state.windows.filter(w => knownIds.has(w.sessionId));
    return next.length === state.windows.length ? state : { ...state, windows: next };
  }

  function serialize(state) {
    return JSON.stringify({
      enabled: state.enabled,
      zoom: state.zoom,
      windows: state.windows.map(({ sessionId, x, y, w, h, z, minimized, maximized }) => ({ sessionId, x, y, w, h, z, minimized, maximized })),
    });
  }

  /* ------------------------------------------------------------------ */
  /* Browser store.                                                      */
  /* ------------------------------------------------------------------ */

  /** This plugin's settings namespace among those the Host serves. */
  function findEntryNamespace(namespaces) {
    const ids = (Array.isArray(namespaces) ? namespaces : []).map(view => view?.ns).filter(id => typeof id === 'string');
    return ids.find(id => id === `include:${PANEL}`)
      ?? ids.find(id => id === PANEL)
      ?? ids.find(id => id.endsWith(`:${PANEL}`));
  }

  /** Parse a stored layout document; anything malformed becomes undefined. */
  function parseLayout(text) {
    if (typeof text !== 'string' || text === '' || text.length > 64 * 1024) return undefined;
    try { return sanitize(JSON.parse(text)); } catch { return undefined; }
  }

  /**
   * Browser store. localStorage gives an instant restore on reload; `onPersist`
   * mirrors every committed layout to the Host so it survives DSH restarts and
   * other browsers. `adopt` replaces the state with a Host copy without
   * echoing it back.
   */
  function createStore(storage, onPersist) {
    let state = parseLayout(storage?.getItem(STORAGE_KEY) ?? '') ?? emptyState();
    const listeners = new Set();
    const notify = () => { for (const fn of [...listeners]) fn(); };
    return {
      get: () => state,
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      set(next, persist = true) {
        if (next === state) return;
        state = next;
        if (persist) {
          const text = serialize(state);
          try { storage?.setItem(STORAGE_KEY, text); } catch { /* private mode: stay usable */ }
          onPersist?.(text);
        }
        notify();
      },
      adopt(next) {
        state = next;
        try { storage?.setItem(STORAGE_KEY, serialize(state)); } catch { /* ignore */ }
        notify();
      },
    };
  }

  /**
   * Host persistence through the shared settings service. Writes are debounced
   * (drags commit once, at pointer-up, but a burst of focus changes should not
   * produce a burst of Host writes). The first accepted Host value wins over
   * the browser copy, so a fresh browser or a cleared cache restores the same
   * desktop.
   */
  function createHostSync(forms, store, { delay = 400 } = {}) {
    let form;
    let timer;
    let pending;
    let lastWritten;
    let adopted = false;
    let unsubscribe = () => {};
    // One Host write in flight at a time. A write that lands while another is
    // in flight is queued (latest wins), so a slow round-trip can never let an
    // older layout overwrite a newer one.
    let inFlight = false;
    const write = () => {
      timer = undefined;
      if (form === undefined || pending === undefined || pending === lastWritten || inFlight) return;
      const snap = form.getSnapshot();
      if (snap.status !== 'ready' || snap.writable !== true) return;
      const text = pending;
      lastWritten = text;
      inFlight = true;
      Promise.resolve(form.set('layout', text))
        .then(ok => { if (ok === false && lastWritten === text) lastWritten = undefined; })
        .catch(() => { if (lastWritten === text) lastWritten = undefined; })
        .finally(() => { inFlight = false; if (pending !== lastWritten) write(); });
    };
    const adoptFromHost = () => {
      const snap = form?.getSnapshot();
      if (snap?.status !== 'ready') return;
      const text = typeof snap.value?.layout === 'string' ? snap.value.layout : '';
      if (!adopted) {
        adopted = true;
        const remote = parseLayout(text);
        if (pending !== undefined) {
          // The user already changed the desktop before the Host answered:
          // their change wins; write it instead of adopting a stale copy.
          write();
        } else if (remote !== undefined) {
          lastWritten = text;
          if (text !== serialize(store.get())) store.adopt(remote);
        } else if (store.get().windows.length > 0 || store.get().enabled) {
          // Host has nothing yet: seed it from this browser's copy.
          pending = serialize(store.get());
          write();
        }
      }
      if (pending !== undefined && pending !== lastWritten && timer === undefined) write();
    };
    return {
      attach(nextForm) {
        unsubscribe();
        form = nextForm;
        unsubscribe = form.subscribe(adoptFromHost);
        adoptFromHost();
      },
      persist(text) {
        pending = text;
        clearTimeout(timer);
        timer = setTimeout(write, delay);
      },
      flush() { clearTimeout(timer); write(); },
      dispose() { clearTimeout(timer); unsubscribe(); },
    };
  }

  /* ------------------------------------------------------------------ */
  /* Styles: DSH theme tokens only, so light and dark follow the GUI.    */
  /* ------------------------------------------------------------------ */

  const CSS = `
[data-dsh-desktop-ui]{position:relative;display:flex;flex-direction:column;width:100%;height:100%;min-width:0;min-height:0;background:var(--dsw-alias-bg-layer-1,#f4f4f5);color:var(--dsw-alias-label-primary);font-family:inherit;overflow:hidden}
[data-dsh-desktop-ui] *{box-sizing:border-box}
[data-dsh-desktop-ui] button{font-family:inherit;color:inherit}
.dsh-dui-canvas{position:relative;flex:1;min-height:0;overflow:hidden;padding-top:var(--dsh-frame-top-clearance,0px)}
.dsh-dui-canvas-inner{position:absolute;inset:var(--dsh-frame-top-clearance,0px) 0 0 0}
.dsh-dui-empty{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;text-align:center;padding:24px;color:var(--dsw-alias-label-secondary)}
.dsh-dui-empty svg{color:var(--dsw-alias-label-tertiary);margin-bottom:10px}
.dsh-dui-empty b{font-size:16px;font-weight:500;color:var(--dsw-alias-label-primary)}
.dsh-dui-empty span{font-size:14px;line-height:22px;max-width:360px}
.dsh-dui-btn{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;margin-top:14px;border-radius:var(--dsw-radius-md,10px);border:.5px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-base);cursor:pointer;font-size:14px}
.dsh-dui-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-dui-win{position:absolute;display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--dsw-alias-bg-base);border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,10px);box-shadow:var(--dsw-elevation-panel,0 8px 28px rgba(0,0,0,.12));overflow:hidden}
.dsh-dui-win[data-focused]{border-color:var(--dsw-alias-border-l3);box-shadow:var(--dsw-elevation-prominent,0 16px 48px rgba(0,0,0,.18))}
.dsh-dui-win[data-maximized]{border-radius:0;border-width:0;box-shadow:none}
.dsh-dui-win[hidden]{display:none}
.dsh-dui-title{flex:none;display:flex;align-items:center;height:32px;padding-left:12px;gap:8px;border-bottom:.5px solid var(--dsw-alias-border-l2);user-select:none;touch-action:none;cursor:default;background:var(--dsw-alias-bg-base)}
.dsh-dui-win:not([data-focused]) .dsh-dui-title{color:var(--dsw-alias-label-tertiary)}
.dsh-dui-title-text{flex:1;min-width:0;font-size:12px;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-dui-dot{flex:none;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-tertiary);opacity:.5}
.dsh-dui-dot[data-running]{background:var(--dsw-alias-label-primary);opacity:1;animation:dsh-dui-pulse 1.2s ease-in-out infinite}
@keyframes dsh-dui-pulse{50%{opacity:.35}}
.dsh-dui-ctl{flex:none;display:flex;height:100%}
.dsh-dui-ctl button{width:40px;height:100%;border:0;background:none;cursor:pointer;display:grid;place-items:center;color:var(--dsw-alias-label-secondary)}
.dsh-dui-ctl button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-dui-ctl button[data-close]:hover{background:var(--dsw-alias-state-error-primary,#c42b1c);color:#fff}
.dsh-dui-body{position:relative;flex:1;min-height:0;min-width:0;display:flex;overflow:hidden}
.dsh-dui-body>*{flex:1;min-width:0;min-height:0}
/* Window body: the stock conversation UI, unchanged, at a uniform scale.
   One CSS zoom shrinks everything proportionally — text, buttons, pickers and
   any element a plugin adds — so windows look exactly like the main chat,
   just smaller. Unlike transform:scale, zoom keeps layout, scrolling,
   hit-testing, popovers and text selection correct. The scale is user-set
   (taskbar), stored with the layout. */
.dsh-dui-body>[data-slot]{display:block!important;flex:1;min-width:0;min-height:0;position:relative}
.dsh-dui-content{position:absolute;inset:0;display:flex;min-width:0;min-height:0;zoom:var(--dsh-dui-zoom,.85)}
/* The stock conversation clamps its reading column to >=680px for the full
   page. A window is narrower, so let the column follow the window width. */
.dsh-dui-content [data-phase]{--dsh-chat-user-width:min(920px, calc(100% - 32px))}
.dsh-dui-content>*{flex:1;min-width:0;min-height:0}
.dsh-dui-scale{min-width:46px;font-variant-numeric:tabular-nums}
.dsh-dui-note{margin:auto;padding:20px;font-size:13px;color:var(--dsw-alias-label-tertiary);text-align:center}
.dsh-dui-edge{position:absolute;z-index:3}
.dsh-dui-edge[data-edge=n]{top:-3px;left:8px;right:8px;height:6px;cursor:ns-resize}
.dsh-dui-edge[data-edge=s]{bottom:-3px;left:8px;right:8px;height:6px;cursor:ns-resize}
.dsh-dui-edge[data-edge=e]{right:-3px;top:8px;bottom:8px;width:6px;cursor:ew-resize}
.dsh-dui-edge[data-edge=w]{left:-3px;top:8px;bottom:8px;width:6px;cursor:ew-resize}
.dsh-dui-edge[data-edge=ne]{right:-3px;top:-3px;width:12px;height:12px;cursor:nesw-resize}
.dsh-dui-edge[data-edge=nw]{left:-3px;top:-3px;width:12px;height:12px;cursor:nwse-resize}
.dsh-dui-edge[data-edge=se]{right:-3px;bottom:-3px;width:12px;height:12px;cursor:nwse-resize}
.dsh-dui-edge[data-edge=sw]{left:-3px;bottom:-3px;width:12px;height:12px;cursor:nesw-resize}
.dsh-dui-snap{position:absolute;z-index:100000;border-radius:var(--dsw-radius-md,10px);background:var(--dsw-alias-interactive-bg-hover);border:1px solid var(--dsw-alias-border-l3);pointer-events:none;transition:all .12s ease}
.dsh-dui-shield{position:fixed;inset:0;z-index:2147483646}
.dsh-dui-taskbar{flex:none;user-select:none;display:flex;align-items:center;gap:4px;height:42px;padding:0 0 0 6px;border-top:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);position:relative;z-index:2}
.dsh-dui-tasks{flex:1;min-width:0;display:flex;align-items:center;gap:4px;overflow-x:auto;scrollbar-width:none;padding:0 4px}
.dsh-dui-tasks::-webkit-scrollbar{display:none}
.dsh-dui-tb{position:relative;flex:none;display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 10px;border:0;border-radius:var(--dsw-radius-sm,8px);background:none;cursor:pointer;font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.dsh-dui-tb:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-dui-tb[data-icon]{width:34px;padding:0;justify-content:center}
.dsh-dui-task{max-width:200px;min-width:110px}
.dsh-dui-task span{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-dui-task[data-focused]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-dui-task::after{content:"";position:absolute;left:50%;bottom:3px;width:6px;height:3px;border-radius:2px;transform:translateX(-50%);background:var(--dsw-alias-label-tertiary);transition:width .15s}
.dsh-dui-task[data-focused]::after{width:16px;background:var(--dsw-alias-label-primary)}
.dsh-dui-sep{flex:none;width:1px;height:22px;background:var(--dsw-alias-border-l2);margin:0 4px}
.dsh-dui-tray{flex:none;display:flex;align-items:center;gap:2px}
.dsh-dui-clock{flex:none;padding:0 10px;font-size:11px;line-height:14px;text-align:right;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.dsh-dui-peek{flex:none;width:8px;height:100%;border:0;border-left:.5px solid var(--dsw-alias-border-l2);background:none;cursor:pointer}
.dsh-dui-peek:hover{background:var(--dsw-alias-interactive-bg-hover)}
/* The stock footer lays its action entries out in one horizontal row. Other
   plugins (for example dsh-all-usage) add full-width buttons there too, so
   when ours is present stack every entry vertically instead of letting them
   fight for one line. Ours registers with a low order, so it is the top row. */
[class*="_footerActions"]:has([data-dsh-desktop-ui-toggle]){flex-direction:column;align-items:stretch;gap:2px}
[class*="_collapsed"] [class*="_footerActions"]:has([data-dsh-desktop-ui-toggle]){align-items:center}
.dsh-dui-toggle{flex:none;display:flex;align-items:center;gap:8px;width:calc(100% + 4px);height:42px;margin:0 -2px;padding:0 10px 0 8px;border:none;border-radius:var(--dsw-radius-md,10px);background:none;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;cursor:pointer;text-align:left}
.dsh-dui-toggle:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-dui-toggle[data-rail]{width:36px;height:36px;margin:0;padding:0;justify-content:center;border-radius:50%}
.dsh-dui-toggle-label{flex:1;min-width:0;white-space:nowrap;overflow:hidden}
.dsh-dui-switch{flex:none;position:relative;width:28px;height:16px;border-radius:8px;background:var(--dsw-alias-border-l3);transition:background .15s}
.dsh-dui-switch::after{content:"";position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:var(--dsw-alias-bg-base);transition:transform .15s}
.dsh-dui-toggle[aria-checked=true] .dsh-dui-switch{background:var(--dsw-alias-label-primary)}
.dsh-dui-toggle[aria-checked=true] .dsh-dui-switch::after{transform:translateX(12px)}
@media (prefers-reduced-motion:reduce){[data-dsh-desktop-ui] *,.dsh-dui-toggle *{animation:none!important;transition:none!important}}
`;

  /* ------------------------------------------------------------------ */
  /* Icons (16px, stroke = currentColor).                                */
  /* ------------------------------------------------------------------ */

  const icon = (paths, size = 16) => h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.25, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
    ...paths.map((d, i) => h('path', { key: i, d })));
  const I = {
    desktop: s => icon(['M2.5 3.5h11v7h-11z', 'M6 13.5h4', 'M8 10.5v3', 'M2.5 5.5h11'], s),
    plus: s => icon(['M8 3.5v9', 'M3.5 8h9'], s),
    min: s => icon(['M4 8h8'], s),
    max: s => icon(['M4.5 4.5h7v7h-7z'], s),
    restore: s => icon(['M4.5 6.5h5v5h-5z', 'M6.5 6.5v-2h5v5h-2'], s),
    close: s => icon(['M4.5 4.5l7 7', 'M11.5 4.5l-7 7'], s),
    cascade: s => icon(['M2.5 2.5h7v5h-7z', 'M5 5v4.5h6.5', 'M7.5 7.5h6v6h-6z'], s),
    grid: s => icon(['M2.5 2.5h4.5v4.5h-4.5z', 'M9 2.5h4.5v4.5h-4.5z', 'M2.5 9h4.5v4.5h-4.5z', 'M9 9h4.5v4.5h-4.5z'], s),
    columns: s => icon(['M2.5 2.5h3.2v11h-3.2z', 'M6.4 2.5h3.2v11h-3.2z', 'M10.3 2.5h3.2v11h-3.2z'], s),
    chat: s => icon(['M3 3.5h10v7H6.5L3 13.5z'], s),
  };

  /* ------------------------------------------------------------------ */
  /* Plugin body.                                                        */
  /* ------------------------------------------------------------------ */

  function apply(ctx) {
    const storage = (() => { try { return window.localStorage; } catch { return undefined; } })();
    let hostSync;
    const store = createStore(storage, text => hostSync?.persist(text));
    const useDesktop = selector => useSyncExternalStore(store.subscribe, () => selector(store.get()), () => selector(store.get()));
    const update = (fn, persist = true) => store.set(fn(store.get()), persist);

    // Inject scoped CSS once; removed on dispose.
    if (!document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`)) {
      const tag = document.createElement('style');
      tag.dataset.plugin = PANEL;
      tag.dataset.pluginCss = STYLE_ID;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }
    ctx.effect(() => () => document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`)?.remove(), 'dsh-desktop-ui: styles');

    // Host-backed layout: optional. Without the settings service (or on a
    // remote, memory-mode connection) the browser copy alone still works.
    ctx.inject(['configForms'], child => {
      const forms = child.configForms;
      const describe = forms.describe();
      const sync = createHostSync(forms, store);
      hostSync = sync;
      let attachedNs;
      const tryAttach = () => {
        const namespaces = describe.getSnapshot()?.view?.namespaces ?? [];
        const ns = findEntryNamespace(namespaces);
        if (ns === undefined || ns === attachedNs) return;
        attachedNs = ns;
        sync.attach(forms.get(ns));
      };
      const off = describe.subscribe(tryAttach);
      tryAttach();
      const flush = () => sync.flush();
      window.addEventListener('pagehide', flush);
      child.effect(() => () => {
        off();
        window.removeEventListener('pagehide', flush);
        sync.flush();
        sync.dispose();
        if (hostSync === sync) hostSync = undefined;
      }, 'dsh-desktop-ui: host layout');
    });

    let stockConversation;
    const stockListeners = new Set();
    const setStockConversation = value => {
      if (stockConversation?.Component === value.Component && stockConversation?.renderSlot === value.renderSlot) return;
      stockConversation = value;
      for (const fn of [...stockListeners]) fn();
    };
    const useStockConversation = () => useSyncExternalStore(
      fn => { stockListeners.add(fn); return () => stockListeners.delete(fn); },
      () => stockConversation, () => stockConversation);


    /* ---------- navigation glue ---------- */

    const panelId = () => ctx.layout.panelInfo.getSnapshot()?.activePanelId ?? null;
    const isShowing = () => panelId() === PANEL;
    let registered = false;
    let reclaiming = false;

    /** Session the stock GUI currently treats as "main" (sidebar selection). */
    function mainSessionId() {
      try {
        const key = ctx.uiSession?.adapter?.current?.getSnapshot()?.key;
        if (validId(key)) return key;
      } catch { /* adapter shape changed; fall back to retain counts */ }
      const byId = ctx.sessions.list.getSnapshot().byId;
      for (const id of Object.keys(byId)) if ((byId[id].retainedBy?.mainView ?? 0) > 0) return id;
      return undefined;
    }

    // Windows reuse the stock conversation entry, captured when it first
    // renders. On boot (restored Desktop mode) let that first render happen
    // before switching panels, so windows get the full UI. Never wait long.
    let waitingForStock = false;
    function show() {
      if (!registered || isShowing()) return;
      if (stockConversation === undefined && !waitingForStock) {
        waitingForStock = true;
        const done = () => {
          if (!waitingForStock) return;
          waitingForStock = false;
          stockListeners.delete(done);
          clearTimeout(timer);
          if (store.get().enabled) show();
        };
        const timer = setTimeout(done, 1500);
        stockListeners.add(done);
        if (panelId() !== null) { try { ctx.layout.selectPanel(null); } catch { done(); } }
        return;
      }
      if (waitingForStock) return;
      try { ctx.layout.selectPanel(PANEL); } catch (error) { console.warn('[dsh-desktop-ui] could not show desktop:', error); }
    }

    function setEnabled(on) {
      update(s => ({ ...s, enabled: on }));
      if (on) {
        const main = mainSessionId();
        if (main !== undefined) update(s => openWindow(s, main));
        show();
      } else if (isShowing()) {
        // Leave desktop mode on the session the user was looking at.
        const focus = focusedId(store.get());
        if (focus !== undefined && focus !== mainSessionId()) {
          try { ctx.uiWorkspace.openSession(focus); return; } catch { /* fall through */ }
        }
        ctx.layout.selectPanel(null);
      }
    }

    // On boot DSH re-selects the last viewed session by itself. That is not a
    // user action, so it must not reopen a window the user closed. Follow the
    // sidebar selection only once the restored desktop has settled.
    let followSelection = false;
    const settleTimer = setTimeout(() => { followSelection = true; }, 2500);
    ctx.effect(() => () => clearTimeout(settleTimer), 'dsh-desktop-ui: boot settle');

    // Stock navigation (sidebar click, New Session, shortcuts) "reveals" the
    // conversation by selecting panel null. While desktop mode is on, keep the
    // desktop selected and open the newly selected session as a window.
    ctx.effect(() => ctx.layout.panelInfo.subscribe(() => {
      if (reclaiming || waitingForStock || !store.get().enabled || !registered || panelId() !== null) return;
      reclaiming = true;
      try {
        const main = mainSessionId();
        if (followSelection && main !== undefined) update(s => openWindow(s, main));
        ctx.layout.selectPanel(PANEL);
      } catch (error) {
        console.warn('[dsh-desktop-ui] could not keep desktop selected:', error);
      } finally {
        reclaiming = false;
      }
    }), 'dsh-desktop-ui: keep desktop selected');

    // A layout adopted from the Host (restart, new browser) can arrive after
    // the panel registered; open the desktop once it says Desktop mode is on.
    let wasEnabled = store.get().enabled;
    ctx.effect(() => store.subscribe(() => {
      const on = store.get().enabled;
      if (on && !wasEnabled) queueMicrotask(show);
      wasEnabled = on;
    }), 'dsh-desktop-ui: follow restored layout');

    let lastMain = mainSessionId();
    const onMainChange = () => {
      const main = mainSessionId();
      if (main === lastMain) return;
      lastMain = main;
      if (followSelection && store.get().enabled && main !== undefined) update(s => openWindow(s, main));
    };
    if (ctx.uiSession?.adapter?.current?.subscribe) {
      ctx.effect(() => ctx.uiSession.adapter.current.subscribe(onMainChange), 'dsh-desktop-ui: follow main selection');
    }

    // Keep the sidebar highlight on the focused window's session.
    let syncTimer;
    function syncSidebar(id) {
      clearTimeout(syncTimer);
      syncTimer = setTimeout(() => {
        if (!store.get().enabled || !isShowing() || id === mainSessionId()) return;
        try { ctx.uiWorkspace.openSession(id); } catch { /* selection only; ignore */ }
      }, 120);
    }
    ctx.effect(() => () => clearTimeout(syncTimer), 'dsh-desktop-ui: timers');

    // Close windows whose sessions were deleted or archived away from the catalog.
    ctx.effect(() => ctx.sessions.list.subscribe(() => {
      const list = ctx.sessions.list.getSnapshot();
      if (list.phase !== 'ready') return;
      update(s => pruneMissing(s, new Set(Object.keys(list.byId))));
    }), 'dsh-desktop-ui: prune closed sessions');

    const actions = {
      open: id => update(s => openWindow(s, id)),
      close: id => update(s => closeWindow(s, id)),
      focus: id => { update(s => focusWindow(s, id)); syncSidebar(id); },
      minimize: id => update(s => minimizeWindow(s, id)),
      toggleMax: id => update(s => toggleMaximize(s, id)),
      geometry: (id, g) => update(s => setGeometry(s, id, g)),
      snap: (id, kind, size) => update(s => snapWindow(s, id, kind, size)),
      arrange: (kind, size) => update(s => arrange(s, kind, size)),
      showDesktop: () => update(s => toggleShowDesktop(s)),
      zoom: direction => update(s => cycleZoom(s, direction)),
      newSession: () => { try { ctx.uiWorkspace.startSession(); } catch (error) { console.warn('[dsh-desktop-ui] new session failed:', error); } },
      taskClick: id => {
        const s = store.get();
        const w = s.windows.find(x => x.sessionId === id);
        if (!w) return;
        if (!w.minimized && focusedId(s) === id) actions.minimize(id); else actions.focus(id);
      },
    };

    /* ---------- components ---------- */

    /**
     * Window/taskbar label. Uses the durable title; untitled sessions get a
     * short id suffix so several untitled windows stay distinguishable.
     */
    function sessionTitle(summary, id) {
      const title = typeof summary?.title === 'string' ? summary.title.trim() : '';
      if (title) return title;
      if (summary?.blank === true) return 'New session';
      const short = String(id ?? summary?.id ?? '').replace(/^session-/, '').slice(0, 6);
      return short ? `Untitled · ${short}` : 'Untitled';
    }

    /**
     * Own one Session reference for a window. Restored windows can mount before
     * the Host session list arrives; until the id is in the catalog the window
     * waits (no retain, no error) and retries automatically when it appears.
     */
    function useSessionReference(sessionId) {
      const known = useSyncExternalStore(
        fn => ctx.sessions.list.subscribe(fn),
        () => ctx.sessions.list.getSnapshot().byId[sessionId] !== undefined,
        () => false);
      const [state, setState] = useState({ reference: undefined, error: undefined });
      useEffect(() => {
        if (!known) { setState({ reference: undefined, error: undefined }); return undefined; }
        let reference;
        let live = true;
        try {
          reference = ctx.sessions.retain(sessionId, { source: REF_SOURCE });
          setState({ reference, error: undefined });
          reference.ready.catch(error => { if (live) setState({ reference: undefined, error: String(error?.message ?? error) }); });
        } catch (error) {
          setState({ reference: undefined, error: String(error?.message ?? error) });
        }
        return () => { live = false; try { reference?.release(); } catch { /* already released */ } };
      }, [sessionId, known]);
      return state;
    }

    /**
     * Window body: the stock `main.conversation` entry — header, transcript,
     * composer and every plugin contribution to them (rewind buttons, header
     * actions, docks…) — rendered once per window under that window's Session.
     *
     * DSH lets only the declaring entry render a slot, so a second owner of
     * `main.conversation` is rejected. Instead the window slot declares no
     * children of its own and its occupant renders the original entry's
     * component with the original entry's authorized kit, captured below the
     * first time the stock tree renders it. If that capture is unavailable the
     * window falls back to the public `conversation.content` factory.
     */
    function FixedChatView(props) {
      return props.renderSlot('conversation.session', { view: 'chat' });
    }
    const WINDOW_VIEWS = { views: FixedChatView };
    function FallbackContent({ sessionId, useSession, useConversation, useSessions, renderFactorySlot }) {
      const session = useSession(value => value);
      const conversation = useConversation(value => value);
      const summaryBlank = useSessions(state => state.byId[sessionId]?.blank);
      const shellPhase = (conversation?.activeTargets?.size ?? 0) > 0 || (!session.blank && !session.awaitingFirstTurn) || session.running
        ? 'active' : session.promptAttempted ? 'engaging' : 'blank';
      const settling = shellPhase === 'blank' && session.openState === 'loading' && summaryBlank !== true;
      const hero = shellPhase === 'blank' && (session.openState === 'open' || summaryBlank === true);
      return renderFactorySlot('conversation.content', { variant: 'embedded', phase: settling ? 'settling' : hero ? 'hero' : 'active', hero }, { slots: WINDOW_VIEWS });
    }
    function WindowContent(props) {
      const stock = useStockConversation();
      const inner = stock !== undefined
        ? h(stock.Component, { ...props, renderSlot: stock.renderSlot, renderSlotChain: stock.renderSlotChain, renderFactorySlot: stock.renderFactorySlot ?? props.renderFactorySlot })
        : h(FallbackContent, props);
      return h('div', { className: 'dsh-dui-content', 'data-dsh-desktop-ui-session': props.sessionId, 'data-dsh-desktop-ui-full': stock !== undefined ? '' : undefined }, inner);
    }

    /** Capture the stock conversation entry's component and render authority. */
    function captureStockConversation() {
      const entry = ctx.slots.entriesOfSlot?.('main.conversation')?.[0] ?? ctx.slots.entries('main.conversation')[0];
      if (entry === undefined || entry.component?.[CAPTURED] === true) return;
      const Original = entry.component;
      function DesktopCapture(props) {
        setStockConversation({ Component: Original, renderSlot: props.renderSlot, renderSlotChain: props.renderSlotChain, renderFactorySlot: props.renderFactorySlot });
        return h(Original, props);
      }
      DesktopCapture[CAPTURED] = true;
      entry.component = DesktopCapture;
      ctx.effect(() => () => { if (entry.component === DesktopCapture) entry.component = Original; }, 'dsh-desktop-ui: restore conversation entry');
    }
    ctx.effect(() => ctx.slots.subscribe('main.conversation', captureStockConversation), 'dsh-desktop-ui: capture conversation entry');
    captureStockConversation();

    function Window({ win, focused, narrow, size, canvasRef, onSnapPreview, renderSlot, SessionProvider, useSessions, useSessionStatus }) {
      const { sessionId } = win;
      const title = useSessions(state => sessionTitle(state.byId[sessionId], sessionId));
      const statusRunning = useSessionStatus(map => map.get(sessionId)?.running);
      const summaryRunning = useSessions(state => state.byId[sessionId]?.running === true);
      const running = statusRunning ?? summaryRunning;
      const { reference, error } = useSessionReference(sessionId);
      const [live, setLive] = useState(null);
      const [dragging, setDragging] = useState(false);
      const maximized = win.maximized || narrow;

      const px = live ?? {
        x: win.x * size.width, y: win.y * size.height, w: win.w * size.width, h: win.h * size.height,
      };
      // Minimum sizes apply to user resizing only; arranged layouts may be
      // smaller. Keep at least the title bar reachable inside the canvas.
      const width = clamp(px.w, Math.min(160, size.width), size.width);
      const height = clamp(px.h, Math.min(120, size.height), size.height);
      const left = clamp(px.x, -(width - 120), Math.max(0, size.width - 120));
      const top = clamp(px.y, 0, Math.max(0, size.height - 32));
      const style = maximized
        ? { left: 0, top: 0, width: '100%', height: '100%', zIndex: win.z + 1 }
        : { left, top, width, height, zIndex: win.z + 1 };

      const begin = useCallback((event, edge) => {
        if (event.button !== 0 || narrow) return;
        if (event.target.closest?.('button')) return;
        // Keep text selection out of the title bar without blocking dblclick.
        if (edge !== 'move') event.preventDefault();
        actions.focus(sessionId);
        const canvas = canvasRef.current?.getBoundingClientRect();
        if (!canvas) return;
        const W = canvas.width, H = canvas.height;
        let start = { x: left, y: top, w: width, h: height };
        if (win.maximized && edge === 'move') {
          // Windows behaviour: un-maximize under the pointer.
          const w = Math.max(MIN_W, win.w * W);
          const ratio = (event.clientX - canvas.left) / W;
          start = { x: event.clientX - canvas.left - w * ratio, y: 0, w, h: Math.max(MIN_H, win.h * H) };
        }
        const sx = event.clientX, sy = event.clientY;
        let snap = null;
        let current = start;
        let engaged = false;
        const move = ev => {
          const dx = ev.clientX - sx, dy = ev.clientY - sy;
          // Engage only after real movement so clicks and double-clicks pass through.
          if (!engaged) {
            if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
            engaged = true;
            setDragging(true);
          }
          current = dragRect(start, edge, dx, dy);
          setLive(current);
          if (edge === 'move') {
            const pxp = ev.clientX - canvas.left, pyp = ev.clientY - canvas.top;
            snap = pyp <= 2 ? 'max' : pxp <= 4 ? 'left' : pxp >= W - 4 ? 'right' : null;
            onSnapPreview(snap);
          }
        };
        const end = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', end);
          window.removeEventListener('pointercancel', end);
          if (!engaged) return;
          setDragging(false);
          onSnapPreview(null);
          if (snap) actions.snap(sessionId, snap, { width: W, height: H });
          else if (current !== start) actions.geometry(sessionId, { x: current.x / W, y: current.y / H, w: current.w / W, h: current.h / H });
          setLive(null);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', end);
        window.addEventListener('pointercancel', end);
      }, [narrow, sessionId, left, top, width, height, win.maximized, win.w, win.h, canvasRef, onSnapPreview]);

      const titleBar = h('div', {
        className: 'dsh-dui-title',
        onPointerDown: e => begin(e, 'move'),
        onDoubleClick: e => { if (!e.target.closest('button')) actions.toggleMax(sessionId); },
      },
      h('span', { className: 'dsh-dui-dot', 'data-running': running ? '' : undefined, title: running ? 'Running' : 'Idle' }),
      h('span', { className: 'dsh-dui-title-text', title }, title),
      h('div', { className: 'dsh-dui-ctl' },
        h('button', { type: 'button', 'aria-label': `Minimize ${title}`, title: 'Minimize', onClick: () => actions.minimize(sessionId) }, I.min()),
        narrow ? null : h('button', { type: 'button', 'aria-label': `${win.maximized ? 'Restore' : 'Maximize'} ${title}`, title: win.maximized ? 'Restore' : 'Maximize', onClick: () => actions.toggleMax(sessionId) }, win.maximized ? I.restore() : I.max()),
        h('button', { type: 'button', 'data-close': '', 'aria-label': `Close ${title}`, title: 'Close', onClick: () => actions.close(sessionId) }, I.close())));

      let body;
      if (error !== undefined) body = h('div', { className: 'dsh-dui-note' }, 'This session could not be opened. ', error);
      else if (reference === undefined) body = h('div', { className: 'dsh-dui-note' }, 'Opening…');
      else body = h(SessionProvider, { session: reference }, renderSlot(WINDOW_SLOT, {}));

      return h('section', {
        className: 'dsh-dui-win',
        style,
        hidden: win.minimized || undefined,
        role: 'dialog',
        'aria-label': title,
        'data-session-id': sessionId,
        'data-focused': focused ? '' : undefined,
        'data-maximized': maximized ? '' : undefined,
        onPointerDownCapture: () => { if (!focused) actions.focus(sessionId); },
      },
      titleBar,
      h('div', { className: 'dsh-dui-body' }, body),
      dragging ? h('div', { className: 'dsh-dui-shield' }) : null,
      maximized ? null : ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map(edge => h('div', { key: edge, className: 'dsh-dui-edge', 'data-edge': edge, onPointerDown: e => begin(e, edge) })));
    }

    function Clock() {
      const [now, setNow] = useState(() => new Date());
      useEffect(() => { const t = setInterval(() => setNow(new Date()), 15000); return () => clearInterval(t); }, []);
      return h('div', { className: 'dsh-dui-clock', 'aria-label': 'Clock' },
        h('div', null, now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
        h('div', null, now.toLocaleDateString([], { day: 'numeric', month: 'short' })));
    }

    function TaskButton({ win, focused, useSessions, useSessionStatus }) {
      const title = useSessions(state => sessionTitle(state.byId[win.sessionId], win.sessionId));
      const running = useSessionStatus(map => map.get(win.sessionId)?.running) ?? false;
      return h('button', {
        type: 'button',
        className: 'dsh-dui-tb dsh-dui-task',
        'data-focused': focused ? '' : undefined,
        'aria-pressed': focused,
        'data-session-id': win.sessionId,
        title: `${title}${win.minimized ? ' (minimized)' : ''}`,
        onClick: () => actions.taskClick(win.sessionId),
      },
      h('span', { className: 'dsh-dui-dot', 'data-running': running ? '' : undefined }),
      h('span', null, title));
    }

    function Desktop({ renderSlot, SessionProvider, useSessions, useSessionStatus }) {
      // Defensive: render at most one window per session, whatever the state says.
      const allWindows = useDesktop(s => s.windows);
      const windows = React.useMemo(() => uniqueWindows(allWindows), [allWindows]);
      const focus = useDesktop(focusedId);
      const zoom = useDesktop(s => s.zoom);
      const canvasRef = useRef(null);
      const [size, setSize] = useState({ width: 1000, height: 700 });
      const [snap, setSnap] = useState(null);

      useEffect(() => {
        const node = canvasRef.current;
        if (!node) return undefined;
        const measure = () => { const r = node.getBoundingClientRect(); setSize({ width: Math.max(1, r.width), height: Math.max(1, r.height) }); };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(node);
        return () => ro.disconnect();
      }, []);

      const narrow = size.width < NARROW;
      const snapStyle = snap === null ? null
        : snap === 'max' ? { left: GAP, top: GAP, right: GAP, bottom: GAP }
          : snap === 'left' ? { left: GAP, top: GAP, width: `calc(50% - ${GAP * 1.5}px)`, bottom: GAP }
            : { right: GAP, top: GAP, width: `calc(50% - ${GAP * 1.5}px)`, bottom: GAP };
      const visible = windows.filter(w => !w.minimized).length;

      return h('div', { 'data-dsh-desktop-ui': '', 'data-narrow': narrow ? '' : undefined, style: { '--dsh-dui-zoom': String(zoom) } },
        h('div', { className: 'dsh-dui-canvas' },
          h('div', { className: 'dsh-dui-canvas-inner', ref: canvasRef },
            windows.length === 0 ? h('div', { className: 'dsh-dui-empty' },
              I.desktop(40),
              h('b', null, 'No windows open'),
              h('span', null, 'Pick a session in the sidebar to open it here, or start a new one.'),
              h('button', { type: 'button', className: 'dsh-dui-btn', onClick: actions.newSession }, I.plus(), 'New session'))
              : visible === 0 ? h('div', { className: 'dsh-dui-empty' },
                h('span', null, 'All windows are minimized. Select one in the taskbar to restore it.')) : null,
            windows.map(win => h(Window, {
              key: win.sessionId, win, focused: win.sessionId === focus, narrow: narrow && win.sessionId === focus ? true : narrow,
              size, canvasRef, onSnapPreview: setSnap, renderSlot, SessionProvider, useSessions, useSessionStatus,
            })),
            snapStyle ? h('div', { className: 'dsh-dui-snap', style: snapStyle }) : null)),
        h('nav', { className: 'dsh-dui-taskbar', 'aria-label': 'Taskbar' },
          h('button', { type: 'button', className: 'dsh-dui-tb', 'data-icon': '', title: 'New session', 'aria-label': 'New session', onClick: actions.newSession }, I.plus(18)),
          h('div', { className: 'dsh-dui-sep' }),
          h('div', { className: 'dsh-dui-tasks', role: 'toolbar', 'aria-label': 'Open windows' },
            windows.map(win => h(TaskButton, { key: win.sessionId, win, focused: win.sessionId === focus, useSessions, useSessionStatus }))),
          h('div', { className: 'dsh-dui-tray' },
            narrow ? null : [
              h('button', { key: 'c', type: 'button', className: 'dsh-dui-tb', 'data-icon': '', title: 'Cascade windows', 'aria-label': 'Cascade windows', onClick: () => actions.arrange('cascade', size) }, I.cascade()),
              h('button', { key: 'g', type: 'button', className: 'dsh-dui-tb', 'data-icon': '', title: 'Tile windows', 'aria-label': 'Tile windows', onClick: () => actions.arrange('grid', size) }, I.grid()),
              h('button', { key: 'col', type: 'button', className: 'dsh-dui-tb', 'data-icon': '', title: 'Side by side', 'aria-label': 'Show windows side by side', onClick: () => actions.arrange('columns', size) }, I.columns()),
            ],
            h('button', { type: 'button', className: 'dsh-dui-tb dsh-dui-scale', title: 'Window text size (click: larger, right-click: smaller)', 'aria-label': `Window text size ${Math.round(zoom * 100)}%`,
              onClick: () => actions.zoom(1), onContextMenu: e => { e.preventDefault(); actions.zoom(-1); } }, `${Math.round(zoom * 100)}%`),
            h(Clock),
            h('button', { type: 'button', className: 'dsh-dui-peek', title: 'Show desktop', 'aria-label': 'Show desktop', onClick: actions.showDesktop }))));
    }

    function DesktopToggle({ wide }) {
      const enabled = useDesktop(s => s.enabled);
      const showing = useSyncExternalStore(ctx.layout.panelInfo.subscribe, () => ctx.layout.panelInfo.getSnapshot()?.activePanelId === PANEL);
      const active = enabled && showing;
      const label = 'Desktop mode';
      return h('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': active,
        'aria-label': label,
        title: wide ? undefined : label,
        className: 'dsh-dui-toggle',
        'data-rail': wide ? undefined : '',
        'data-dsh-desktop-ui-toggle': '',
        onClick: () => { if (active) setEnabled(false); else setEnabled(true); },
      },
      I.desktop(wide ? 16 : 18),
      wide ? h('span', { className: 'dsh-dui-toggle-label' }, label) : null,
      wide ? h('span', { className: 'dsh-dui-switch', 'aria-hidden': 'true' }) : null);
    }

    /* ---------- registrations ---------- */

    ctx.effect(() => ctx.slots.inject('main', () => {
      const dispose = ctx.slots.register({
        name: 'main',
        key: PANEL,
        children: { [WINDOW_SLOT]: { kind: 'single', scope: 'session' } },
      }, Desktop);
      registered = true;
      // Restore desktop mode after a reload once the panel exists.
      queueMicrotask(() => { if (store.get().enabled) show(); });
      return () => { registered = false; dispose(); };
    }), 'dsh-desktop-ui: desktop panel');

    ctx.effect(() => ctx.slots.inject(WINDOW_SLOT, () => ctx.slots.register({ name: WINDOW_SLOT }, WindowContent)), 'dsh-desktop-ui: window body');

    ctx.effect(() => ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
      name: 'sidebar.footer.action',
      id: TOGGLE_ID,
      // List entries render in ascending order (stock default 0; dsh-all-usage
      // uses 10). A negative order keeps Desktop mode above every other entry.
      order: TOGGLE_ORDER,
    }, DesktopToggle)), 'dsh-desktop-ui: sidebar toggle');
  }

  return {
    inject,
    apply,
    // Pure helpers for tests.
    sanitize, serialize, parseLayout, createStore, createHostSync, findEntryNamespace, uniqueWindows, openWindow, closeWindow, focusWindow, minimizeWindow, toggleMaximize,
    setGeometry, snapWindow, snapGeometry, arrange, dragRect, arrangeGeometry, toggleShowDesktop, cycleZoom, pruneMissing, focusedId, emptyState,
    constants: { PANEL, WINDOW_SLOT, TOGGLE_ID, TOGGLE_ORDER, STORAGE_KEY, MAX_WINDOWS, ZOOM_STEPS, DEFAULT_ZOOM },
  };
}
