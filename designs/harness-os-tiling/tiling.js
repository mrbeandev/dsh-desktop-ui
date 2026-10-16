'use strict';
/* Harness OS · Tiling (Option B). All state is local and simulated. User text is rendered with textContent only. */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

const MAX_TILES = 4;
let uid = 0, sessionNo = 2;
const state = {
  ws: 0,
  ctx: 52,
  busy: 0,
  workspaces: [
    { name: 'ideas', tiles: [], focus: 0, full: false, split: 1.4 },
    { name: 'code', tiles: [], focus: 0, full: false, split: 1.3 },
    { name: 'tools', tiles: [], focus: 0, full: false, split: 1.2 },
    { name: 'scratch', tiles: [], focus: 0, full: false, split: 1.4 }
  ],
  agents: [
    { id: 'orchestrator', role: 'lead', state: 'ready', task: 'listening on workspace 1', progress: 0 },
    { id: 'builder', role: 'sub', state: 'idle', task: 'waiting for a job', progress: 0 },
    { id: 'reviewer', role: 'sub', state: 'idle', task: 'waiting for a job', progress: 0 }
  ],
  spark: Array.from({ length: 32 }, () => 4 + Math.random() * 14)
};
const tileNodes = new Map();
const stage = $('#stage');

/* ---------- notifications ---------- */
function note(text, kind = '', from = 'harness') {
  const n = el('div', 'note ' + kind);
  n.append(el('small', '', from), document.createTextNode(text));
  $('#notes').append(n);
  setTimeout(() => { n.classList.add('out'); setTimeout(() => n.remove(), 300); }, 3600);
}
function ticker(text) { $('#ticker-text').textContent = text; }
function setBusy(delta, text) {
  state.busy = Math.max(0, state.busy + delta);
  document.body.classList.toggle('busy', state.busy > 0);
  ticker(state.busy ? text : 'idle · press / for the launcher');
  renderBar();
}

/* ---------- tile factories ---------- */
const KINDS = {
  chat: { label: 'session', make: makeChat },
  procs: { label: 'agents', make: makeProcs, title: 'processes' },
  context: { label: 'context', make: makeContext, title: 'reactor' },
  terminal: { label: 'term', make: makeTerminal, title: 'zsh — sandbox' },
  files: { label: 'files', make: makeFiles, title: '~/dsh-desktop-ui' },
  tools: { label: 'tools', make: makeTools, title: '12 registered' }
};

function createTile(kind, title) {
  const id = 't' + (++uid);
  const spec = KINDS[kind];
  const tile = el('section', 'tile');
  tile.dataset.id = id;
  tile.setAttribute('aria-label', spec.label + ' tile');
  const head = el('header', 'tile-head');
  const t = title || spec.title || spec.label;
  head.append(el('span', 'tile-kind', spec.label), el('span', 'tile-title', t), el('span', 'sp'));
  const fullBtn = el('button', 'tile-act', '⤢'); fullBtn.title = 'Fullscreen (f)'; fullBtn.setAttribute('aria-label', 'Toggle fullscreen');
  const closeBtn = el('button', 'tile-act', '✕'); closeBtn.title = 'Close (q)'; closeBtn.setAttribute('aria-label', 'Close tile');
  fullBtn.addEventListener('click', e => { e.stopPropagation(); focusTileById(id); toggleFull(); });
  closeBtn.addEventListener('click', e => { e.stopPropagation(); closeTileById(id); });
  head.append(fullBtn, closeBtn);
  const body = el('div', 'tile-body');
  tile.append(head, body);
  spec.make(body, id);
  tile.addEventListener('mousedown', () => focusTileById(id));
  tileNodes.set(id, tile);
  return { id, kind, title: t };
}

function addTile(kind, title, wsIndex = state.ws) {
  let w = state.workspaces[wsIndex];
  if (w.tiles.length >= MAX_TILES) {
    const free = state.workspaces.findIndex(x => x.tiles.length < MAX_TILES);
    if (free < 0) { note('Every workspace is full. Close a tile with q.', 'warn'); return null; }
    note('Workspace ' + (wsIndex + 1) + ' is full — opened on ' + (free + 1) + '.', 'warn');
    wsIndex = free; w = state.workspaces[free];
  }
  const t = createTile(kind, title);
  w.tiles.push(t);
  w.focus = w.tiles.length - 1;
  if (wsIndex !== state.ws) switchWs(wsIndex); else render();
  return t;
}

/* ---------- chat ---------- */
const chats = new Map();
function makeChat(body, id) {
  const wrap = el('div', 'chat');
  const log = el('div', 'chat-log');
  const compose = el('div', 'compose');
  const form = el('form');
  const ta = el('textarea'); ta.rows = 1; ta.placeholder = 'ask, plan, or delegate…'; ta.setAttribute('aria-label', 'Message');
  const send = el('button', 'send', 'send ↵'); send.type = 'submit';
  form.append(el('span', 'compose-prompt', '❯'), ta, send);
  const meta = el('div', 'compose-meta');
  meta.append(el('span', '', 'deepseek-v3.2 · think: auto'), el('span', '', 'esc → normal mode'));
  compose.append(form, meta);
  wrap.append(log, compose);
  body.append(wrap);
  body.style.overflow = 'hidden';
  const c = { log, ta, send, streaming: false };
  chats.set(id, c);
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 130) + 'px'; });
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });
  form.addEventListener('submit', e => { e.preventDefault(); const text = ta.value.trim(); if (!text || c.streaming) return; ta.value = ''; ta.style.height = 'auto'; ask(c, text); });
}
function addMsg(c, who, text, cls) {
  const m = el('div', 'msg ' + cls);
  const head = el('div', 'msg-who');
  head.append(el('b', '', who), el('span', '', new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })));
  const body = el('div', 'msg-text', text);
  m.append(head, body);
  c.log.append(m);
  c.log.scrollTop = c.log.scrollHeight;
  return body;
}
function addOps(c, ops) {
  const box = el('div', 'op');
  c.log.append(box);
  return ops.map(([name, arg]) => {
    const row = el('div');
    const s = el('span', 'run', '◌');
    const t = el('span', 't', '…');
    row.append(s, el('span', '', name + ' ' + arg), t);
    box.append(row);
    return { s, t };
  });
}
const REPLIES = [
  [/agent|team|delegate|builder|review/i, [['spawn_agent', 'builder'], ['plan', '3 steps']], 'Dispatched builder to a background process. Watch the agents tile — it gets its own progress bar, and the top bar turns amber while anything runs.\n\nIn this OS, agents are processes: you can see them, focus them, and kill them.'],
  [/file|code|diff|edit/i, [['read_file', 'src/compositor.ts'], ['apply_patch', '+12 −3']], 'Patched src/compositor.ts. Open workspace 2 (press 2 in normal mode) to see the diff side by side with a terminal.'],
  [/context|token|memory|compact/i, [['measure_context', 'session'], ['plan', 'compaction']], 'Context is the one resource every session shares, so it gets a reactor gauge. Past ~80% it glows amber and offers to compact. Press c to open it.'],
  [/hi|hello|hey/i, [['whoami', '']], 'Hey. You are in workspace 1, focused on a session tile. Press esc for normal mode, then try j and k to move focus, or / for the launcher.']
];
function ask(c, text) {
  addMsg(c, 'you', text, 'user');
  const hit = REPLIES.find(([re]) => re.test(text));
  const ops = hit ? hit[1] : [['search_workspace', '"' + text.slice(0, 24) + (text.length > 24 ? '…"' : '"')], ['think', '']];
  const reply = hit ? hit[2] : 'Noted. In a connected build this would stream from the model, call tools in the strip above, and land as a diff or an artifact tile.\n\nThis preview is simulated — no model, no tools, no network.';
  c.streaming = true; c.send.disabled = true;
  setBusy(1, 'session · ' + ops[0][0] + ' ' + ops[0][1]);
  const rows = addOps(c, ops);
  let i = 0;
  const step = () => {
    if (i < rows.length) {
      const r = rows[i]; const ms = 300 + Math.random() * 500;
      ticker('session · ' + ops[i][0] + ' ' + ops[i][1]);
      setTimeout(() => { r.s.textContent = '✓'; r.s.className = 'ok'; r.t.textContent = (ms / 1000).toFixed(1) + 's'; i++; step(); }, ms);
      return;
    }
    ticker('session · streaming reply');
    const body = addMsg(c, 'harness', '', 'ai');
    const caret = el('span', 'caret');
    let n = 0;
    const iv = setInterval(() => {
      n = Math.min(reply.length, n + 3);
      body.textContent = reply.slice(0, n); body.append(caret);
      c.log.scrollTop = c.log.scrollHeight;
      if (n >= reply.length) {
        clearInterval(iv); caret.remove(); c.streaming = false; c.send.disabled = false;
        setBusy(-1);
        bumpCtx(4 + Math.round(Math.random() * 4));
        if (/agent|team|delegate|builder/i.test(text)) dispatch('builder');
      }
    }, 16);
  };
  step();
}

/* ---------- processes ---------- */
function makeProcs(body) {
  const host = el('div', 'procs-host');
  body.append(host);
  drawProcs(host);
}
function drawProcs(host) {
  host.replaceChildren();
  const list = el('div', 'procs');
  state.agents.forEach(a => {
    const row = el('div', 'proc ' + a.state);
    const name = el('div', 'proc-name', a.id); name.append(el('small', '', a.role));
    const bar = el('div', 'proc-bar'); const b = el('b'); b.style.width = a.progress + '%'; bar.append(b);
    row.append(el('span', 'proc-dot'), name, el('span', 'proc-state', a.state), el('div', 'proc-task', a.task), bar);
    list.append(row);
  });
  const spark = el('div', 'spark'); spark.setAttribute('aria-hidden', 'true');
  state.spark.forEach(v => { const i = el('i'); i.style.height = v + 'px'; spark.append(i); });
  const lab = el('div', 'spark-label'); lab.append(el('span', '', 'tokens / s'), el('span', '', state.busy ? 'active' : 'quiet'));
  const actions = el('div', 'proc-actions');
  const idle = state.agents.find(a => a.state !== 'running' && a.role === 'sub');
  const btn = el('button', 'btn'); btn.append(el('span', '', idle ? 'dispatch ' + idle.id : 'all agents busy'), el('span', '', '↵'));
  btn.disabled = !idle;
  btn.addEventListener('click', () => idle && dispatch(idle.id));
  actions.append(btn);
  host.append(list, spark, lab, actions);
}
function refreshProcs() { $$('.procs-host').forEach(drawProcs); renderBar(); }
const JOBS = {
  builder: ['reading src/compositor.ts', 'drafting tile layout engine', 'writing src/workspace.ts', 'running tests · 14 passed'],
  reviewer: ['loading diff +12 −3', 'checking focus order', 'checking contrast ratios', 'writing review notes']
};
function dispatch(id) {
  const a = state.agents.find(x => x.id === id);
  if (!a || a.state === 'running') return;
  a.state = 'running'; a.progress = 0; a.task = JOBS[id][0];
  setBusy(1, id + ' · ' + a.task);
  note(id + ' started a background job.', '', 'agents');
  refreshProcs();
  const iv = setInterval(() => {
    a.progress = Math.min(100, a.progress + 6 + Math.random() * 8);
    a.task = JOBS[id][Math.min(3, Math.floor(a.progress / 25))];
    ticker(id + ' · ' + a.task);
    if (a.progress >= 100) {
      clearInterval(iv);
      a.state = 'ready'; a.task = 'done · ' + (id === 'builder' ? '2 files changed' : '3 suggestions');
      setBusy(-1); bumpCtx(5);
      note(id + ' finished: ' + a.task, '', 'agents');
      const f = $('.tree [data-file="src/compositor.ts"] .badge'); if (f) f.textContent = 'M';
    }
    refreshProcs();
  }, 520);
}

/* ---------- context reactor ---------- */
const RING_C = 2 * Math.PI * 52;
function makeContext(body) {
  const host = el('div', 'ctx-host');
  host.innerHTML = '<div class="reactor"><div class="ring"><svg viewBox="0 0 120 120" aria-hidden="true"><circle class="track" cx="60" cy="60" r="52"/><circle class="ticks" cx="60" cy="60" r="43"/><circle class="fill" cx="60" cy="60" r="52"/></svg><div class="ring-c"><b class="r-pct"></b><span class="r-tok"></span></div></div><div class="reactor-rows"><div><span>system + tools</span><b>11.2k</b></div><div><span>conversation</span><b class="r-conv"></b></div><div><span>headroom</span><b class="r-free"></b></div></div><button class="btn r-btn"><span>compact session</span><span>↵</span></button></div>';
  $('.r-btn', host).addEventListener('click', compact);
  body.append(host);
  drawCtx(host);
}
function drawCtx(host) {
  const p = state.ctx, used = Math.round(128 * p / 100);
  $('.reactor', host).classList.toggle('hot', p >= 80);
  const fill = $('.fill', host);
  fill.style.strokeDasharray = RING_C;
  fill.style.strokeDashoffset = RING_C * (1 - p / 100);
  $('.r-pct', host).textContent = p + '%';
  $('.r-tok', host).textContent = used + 'k / 128k';
  $('.r-conv', host).textContent = Math.max(0, used - 11) + 'k';
  $('.r-free', host).textContent = (128 - used) + 'k';
}
function bumpCtx(n) {
  const before = state.ctx;
  state.ctx = Math.min(97, state.ctx + n);
  if (before < 80 && state.ctx >= 80) note('Context at ' + state.ctx + '%. Press c, then compact.', 'warn', 'reactor');
  refreshCtx();
}
function compact() {
  if (state.ctx < 30) { note('Plenty of headroom already.', '', 'reactor'); return; }
  setBusy(1, 'reactor · compacting session');
  const from = state.ctx; let t = 0;
  const iv = setInterval(() => {
    t += 0.08; state.ctx = Math.round(from - (from - 18) * Math.min(1, t)); refreshCtx();
    if (t >= 1) { clearInterval(iv); setBusy(-1); note('Compacted ' + from + '% → 18%. Summary kept, details archived.', '', 'reactor'); }
  }, 60);
}
function refreshCtx() {
  $$('.ctx-host').forEach(drawCtx);
  $('#ctx-pct').textContent = state.ctx + '%';
  const f = $('#ctx-fill'); f.style.width = state.ctx + '%'; f.style.background = state.ctx >= 80 ? 'var(--amber)' : '';
}

/* ---------- terminal ---------- */
const started = Date.now();
function makeTerminal(body) {
  const term = el('div', 'term');
  const out = el('div');
  const form = el('form');
  const input = el('input'); input.setAttribute('aria-label', 'Terminal command'); input.autocomplete = 'off'; input.spellcheck = false;
  form.append(el('span', 'pr', '❯'), input);
  term.append(out, form);
  body.append(term);
  term.addEventListener('click', () => input.focus());
  const line = (t, cls = '') => { out.append(el('p', cls, t)); body.scrollTop = body.scrollHeight; };
  line('harness-tile 0.2 · sandboxed shell — nothing runs on your machine', 'mut');
  line('type help, or try neofetch', 'mut');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const cmd = input.value.trim(); input.value = '';
    if (!cmd) return;
    line('❯ ' + cmd, 'pr');
    const [head, ...rest] = cmd.split(/\s+/); const arg = rest.join(' ');
    const up = Math.max(1, Math.round((Date.now() - started) / 60000));
    const cmds = {
      help: () => line('help · neofetch · ps · ctx · ls · ws <1-4> · open <session|term|files|agents|context|tools>\ndispatch <builder|reviewer> · compact · clear'),
      neofetch: () => line('     ◆        harness@os\n    ◆ ◆       ──────────\n   ◆   ◆      os      Harness OS (tiling preview)\n  ◆  ◆  ◆     wm      harness-tile 0.2\n   ◆   ◆      model   deepseek-v3.2\n    ◆ ◆       agents  ' + state.agents.length + ' (' + state.agents.filter(a => a.state === 'running').length + ' running)\n     ◆        ctx     ' + state.ctx + '% of 128k\n              uptime  ' + up + ' min'),
      ps: () => line('PID   AGENT          STATE     TASK\n' + state.agents.map((a, i) => String(100 + i).padEnd(6) + a.id.padEnd(15) + a.state.padEnd(10) + a.task).join('\n')),
      ctx: () => line('context ' + state.ctx + '% · ' + Math.round(128 * state.ctx / 100) + 'k / 128k tokens'),
      ls: () => line('README.md  package.json  src/  designs/'),
      clear: () => out.replaceChildren(),
      compact: () => compact(),
      ws: () => { const n = parseInt(arg, 10); if (n >= 1 && n <= 4) switchWs(n - 1); else line('usage: ws <1-4>', 'warn'); },
      open: () => { const map = { session: 'chat', term: 'terminal', terminal: 'terminal', files: 'files', agents: 'procs', context: 'context', tools: 'tools' }; if (map[arg]) openKind(map[arg]); else line('usage: open <session|term|files|agents|context|tools>', 'warn'); },
      dispatch: () => { if (JOBS[arg]) dispatch(arg); else line('usage: dispatch <builder|reviewer>', 'warn'); },
      sudo: () => line('nice try. this shell has no root, no disk, and no network.', 'warn'),
      exit: () => closeTileById(body.parentElement.dataset.id)
    };
    (cmds[head] || (() => line(head + ': not a demo command — try help', 'warn')))();
  });
}

/* ---------- files ---------- */
const FILES = {
  'README.md': [['c', '# dsh-desktop-ui'], ['', ''], ['', 'Harness, reimagined as a tiling desktop.'], ['', 'Sessions are workspaces. Tools are tiles.'], ['', 'Agents are processes you can watch.']],
  'package.json': [['', '{'], ['', '  "name": "dsh-desktop-ui",'], ['', '  "private": true,'], ['', '  "version": "0.2.0"'], ['', '}']],
  'src/compositor.ts': [['c', '// tiles a workspace: master + stack'], ['', 'export function layout(ws: Workspace) {'], ['del', '  return ws.tiles.map(t => full(t));'], ['add', '  const [master, ...stack] = ws.tiles;'], ['add', '  if (!stack.length) return [full(master)];'], ['add', '  return [left(master, ws.split),'], ['add', '          ...column(stack)];'], ['', '}']],
  'src/workspace.ts': [['', 'export interface Workspace {'], ['', '  name: string;'], ['', '  tiles: Tile[];'], ['', '  focus: number;'], ['', '  split: number; // master width ratio'], ['', '}']]
};
function makeFiles(body) {
  const wrap = el('div', 'files');
  const tree = el('div', 'tree'); tree.setAttribute('role', 'tree');
  const code = el('div', 'code');
  const show = name => {
    $$('button', tree).forEach(b => b.classList.toggle('on', b.dataset.file === name));
    code.replaceChildren(...FILES[name].map(([cls, t]) => el('div', cls, t || ' ')));
  };
  const item = (name, label, indent) => {
    const b = el('button', indent ? 'in' : ''); b.dataset.file = name;
    b.append(el('span', '', label), el('span', 'badge', name === 'src/compositor.ts' ? 'M' : ''));
    b.addEventListener('click', () => show(name));
    tree.append(b);
  };
  item('README.md', 'README.md'); item('package.json', 'package.json');
  tree.append(el('div', 'dir', '▾ src/'));
  item('src/compositor.ts', 'compositor.ts', true); item('src/workspace.ts', 'workspace.ts', true);
  wrap.append(tree, code); body.append(wrap); body.style.overflow = 'hidden';
  show('src/compositor.ts');
}

/* ---------- tools ---------- */
const TOOLS = [['read_file', 'Read workspace files'], ['apply_patch', 'Edit with diffs'], ['shell', 'Sandboxed commands'], ['web_search', 'Look things up'], ['spawn_agent', 'Start a subagent'], ['image_gen', 'Generate images'], ['browser', 'Drive a page'], ['memory', 'Long-term notes'], ['schedule', 'Reminders & cron'], ['mcp', 'External servers'], ['git', 'Commit & branch'], ['notify', 'Ping you elsewhere']];
const toolOn = new Set(TOOLS.slice(0, 10).map(t => t[0]));
function makeTools(body) {
  const grid = el('div', 'tools');
  const draw = () => {
    grid.replaceChildren(...TOOLS.map(([n, d]) => {
      const b = el('button', 'tool' + (toolOn.has(n) ? '' : ' off'));
      b.append(el('b', '', n), el('span', '', d), el('em', '', toolOn.has(n) ? '● enabled' : '○ disabled'));
      b.setAttribute('aria-pressed', String(toolOn.has(n)));
      b.addEventListener('click', () => { toolOn.has(n) ? toolOn.delete(n) : toolOn.add(n); draw(); note(n + (toolOn.has(n) ? ' enabled' : ' disabled') + ' for this workspace.', '', 'tools'); });
      return b;
    }));
  };
  draw(); body.append(grid);
}

/* ---------- workspace + layout ---------- */
const cur = () => state.workspaces[state.ws];
function render() {
  const w = cur();
  $$('.tile', stage).forEach(t => t.remove());
  stage.className = w.tiles.length ? 'l' + w.tiles.length : '';
  stage.classList.toggle('full', w.full && w.tiles.length > 1);
  stage.style.setProperty('--split', w.split + 'fr');
  w.focus = Math.max(0, Math.min(w.focus, w.tiles.length - 1));
  w.tiles.forEach((t, i) => { const n = tileNodes.get(t.id); n.classList.toggle('focus', i === w.focus); n.classList.toggle('master', i === 0); stage.append(n); });
  $('#empty').hidden = w.tiles.length > 0;
  $('#empty-no').textContent = state.ws + 1;
  $('#wall-no').textContent = String(state.ws + 1).padStart(2, '0');
  $('#wall-name').textContent = w.name;
  const tabs = $('#tabs'); tabs.replaceChildren();
  w.tiles.forEach((t, i) => {
    const b = el('button', i === w.focus ? 'on' : ''); b.append(el('i'), document.createTextNode(KINDS[t.kind].label + ' · ' + t.title));
    b.addEventListener('click', () => { w.focus = i; render(); });
    tabs.append(b);
  });
  tabs.hidden = w.tiles.length === 0;
  renderBar();
}
function renderBar() {
  const nav = $('#ws'); nav.replaceChildren();
  state.workspaces.forEach((w, i) => {
    const b = el('button', (i === state.ws ? 'on ' : '') + (w.tiles.length ? 'has' : ''));
    b.append(el('span', '', String(i + 1)), el('span', 'ws-name', w.name));
    if (i === 0 && state.agents.some(a => a.state === 'running')) b.append(el('span', 'ws-busy'));
    b.setAttribute('aria-label', 'Workspace ' + (i + 1) + ' ' + w.name);
    b.addEventListener('click', () => switchWs(i));
    nav.append(b);
  });
  const run = state.agents.filter(a => a.state === 'running').length;
  $('#agent-count').textContent = run ? '◉ ' + run + ' running' : '◉ ' + state.agents.length + ' agents idle';
}
function switchWs(i) { if (i < 0 || i > 3) return; state.ws = i; render(); }
function focusTileById(id) { const w = cur(); const i = w.tiles.findIndex(t => t.id === id); if (i >= 0 && i !== w.focus) { w.focus = i; render(); } }
function moveFocus(d) { const w = cur(); if (!w.tiles.length) return; w.focus = (w.focus + d + w.tiles.length) % w.tiles.length; render(); }
function toggleFull() { const w = cur(); if (w.tiles.length < 2) { note('Only one tile here — it is already full.', '', 'wm'); return; } w.full = !w.full; render(); }
function resize(d) { const w = cur(); w.split = Math.round(Math.max(0.6, Math.min(3, w.split + d)) * 10) / 10; render(); }
function closeTileById(id) {
  const w = cur(); const i = w.tiles.findIndex(t => t.id === id); if (i < 0) return;
  w.tiles.splice(i, 1); tileNodes.get(id)?.remove(); tileNodes.delete(id); chats.delete(id);
  if (w.tiles.length < 2) w.full = false;
  if (w.focus >= i) w.focus = Math.max(0, w.focus - 1);
  render();
}
function closeFocused() { const w = cur(); if (w.tiles[w.focus]) closeTileById(w.tiles[w.focus].id); }
function openKind(kind) {
  if (kind === 'chat') { const t = addTile('chat', String(sessionNo++).padStart(3, '0') + ' · untitled'); if (t) setTimeout(() => chats.get(t.id)?.ta.focus(), 30); return; }
  for (let i = 0; i < 4; i++) { const k = state.workspaces[i].tiles.findIndex(t => t.kind === kind); if (k >= 0) { state.workspaces[i].focus = k; switchWs(i); if (kind === 'terminal') setTimeout(() => $('input', tileNodes.get(state.workspaces[i].tiles[k].id))?.focus(), 30); return; } }
  const t = addTile(kind);
  if (t && kind === 'terminal') setTimeout(() => $('input', tileNodes.get(t.id))?.focus(), 30);
}
function insertMode() {
  const w = cur(); const t = w.tiles[w.focus]; if (!t) return;
  const target = $('textarea, input', tileNodes.get(t.id)); if (target) target.focus(); else note('Nothing to type into here.', '', 'wm');
}

/* ---------- launcher ---------- */
const ACTIONS = [
  ['n', 'new session', 'open a chat tile', () => openKind('chat')],
  ['t', 'terminal', 'sandboxed shell', () => openKind('terminal')],
  ['', 'files', 'browse + diff', () => openKind('files')],
  ['', 'agents', 'live processes', () => openKind('procs')],
  ['c', 'context reactor', 'token gauge', () => openKind('context')],
  ['', 'tools', 'enable / disable', () => openKind('tools')],
  ['', 'dispatch builder', 'background job', () => dispatch('builder')],
  ['', 'dispatch reviewer', 'background job', () => dispatch('reviewer')],
  ['', 'compact context', 'free headroom', compact],
  ['f', 'toggle fullscreen', 'focused tile', toggleFull],
  ['q', 'close tile', 'focused tile', closeFocused],
  ...state.workspaces.map((w, i) => [String(i + 1), 'workspace ' + (i + 1) + ' · ' + w.name, w.tiles.length + ' tiles', () => switchWs(i)])
];
let rofiSel = 0, rofiItems = [];
function openRofi() { $('#rofi').hidden = false; $('#rofi-q').value = ''; drawRofi(); $('#rofi-q').focus(); }
function closeRofi() { $('#rofi').hidden = true; }
function drawRofi() {
  const q = $('#rofi-q').value.toLowerCase().trim();
  rofiItems = ACTIONS.filter(a => (a[1] + ' ' + a[2]).toLowerCase().includes(q));
  rofiSel = Math.min(rofiSel, Math.max(0, rofiItems.length - 1));
  const list = $('#rofi-list'); list.replaceChildren();
  if (!rofiItems.length) { list.append(el('div', 'rofi-empty', 'Nothing matches. Try “term”, “agent”, or “3”.')); return; }
  rofiItems.forEach((a, i) => {
    const b = el('button', 'rofi-item' + (i === rofiSel ? ' sel' : '')); b.setAttribute('role', 'option'); b.setAttribute('aria-selected', String(i === rofiSel));
    b.append(el('span', 'ri-k', a[0] ? 'key ' + a[0] : ''), el('span', 'ri-n', a[1]), el('span', 'ri-d', a[2]));
    b.addEventListener('mousemove', () => { if (rofiSel !== i) { rofiSel = i; drawRofi(); } });
    b.addEventListener('click', () => { closeRofi(); a[3](); });
    list.append(b);
  });
  list.children[rofiSel]?.scrollIntoView({ block: 'nearest' });
}
$('#rofi-q').addEventListener('input', () => { rofiSel = 0; drawRofi(); });
$('#rofi-q').addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (rofiItems.length) { rofiSel = (rofiSel + (e.key === 'ArrowDown' ? 1 : -1) + rofiItems.length) % rofiItems.length; drawRofi(); } }
  else if (e.key === 'Enter') { e.preventDefault(); const a = rofiItems[rofiSel]; if (a) { closeRofi(); a[3](); } }
  else if (e.key === 'Escape') { e.preventDefault(); closeRofi(); }
});
$('#rofi').addEventListener('mousedown', e => { if (e.target.id === 'rofi') closeRofi(); });

/* ---------- global keys + mode ---------- */
const typing = t => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
function setMode() { const ins = typing(document.activeElement) && document.activeElement.id !== 'rofi-q'; $('#mode').textContent = ins ? '-- INSERT --' : 'NORMAL'; $('#mode').classList.toggle('ins', ins); }
document.addEventListener('focusin', setMode); document.addEventListener('focusout', () => setTimeout(setMode, 0));
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#rofi').hidden ? openRofi() : closeRofi(); return; }
  if (!$('#rofi').hidden) return;
  if (typing(e.target)) { if (e.key === 'Escape') e.target.blur(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key;
  const map = { '/': openRofi, j: () => moveFocus(1), k: () => moveFocus(-1), f: toggleFull, n: () => openKind('chat'), t: () => openKind('terminal'), c: () => openKind('context'), q: closeFocused, i: insertMode, '[': () => resize(-0.2), ']': () => resize(0.2) };
  if (/^[1-4]$/.test(k)) { e.preventDefault(); switchWs(+k - 1); return; }
  if (map[k]) { e.preventDefault(); map[k](); }
});
document.addEventListener('click', e => { const b = e.target.closest('[data-cmd]'); if (!b) return; ({ rofi: openRofi, chat: () => openKind('chat'), terminal: () => openKind('terminal'), context: () => openKind('context') })[b.dataset.cmd]?.(); });

/* ---------- ambient ---------- */
setInterval(() => {
  state.spark.shift(); state.spark.push(state.busy ? 14 + Math.random() * 28 : 3 + Math.random() * 10);
  $$('.spark').forEach(s => [...s.children].forEach((b, i) => { b.style.height = state.spark[i] + 'px'; }));
}, 700);
function tick() { $('#clock').textContent = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); }
tick(); setInterval(tick, 15000);

/* ---------- boot ---------- */
(function boot() {
  const main = createTile('chat', '001 · harness as an os');
  const c = chats.get(main.id);
  addMsg(c, 'you', 'what if the harness was an operating system?', 'user');
  const ops = addOps(c, [['read_file', 'README.md'], ['list_dir', 'designs/']]);
  ops.forEach((o, i) => { o.s.textContent = '✓'; o.s.className = 'ok'; o.t.textContent = ['0.2s', '0.1s'][i]; });
  addMsg(c, 'harness', 'Then sessions are workspaces, tools are tiles, and agents are processes you can actually watch.\n\nYou are in NORMAL mode. Press 1–4 to hop workspaces, j / k to move focus, f for fullscreen, / for the launcher, and i to start typing here.\n\nTry asking me to “delegate to the builder”.', 'ai');
  state.workspaces[0].tiles.push(main, createTile('procs'), createTile('context'));
  state.workspaces[1].tiles.push(createTile('files'), createTile('terminal'));
  state.workspaces[2].tiles.push(createTile('tools'));
  render(); refreshCtx(); setMode(); ticker('idle · press / for the launcher');
  setTimeout(() => note('Welcome to workspace 1. Press / anytime.', '', 'harness-tile'), 700);
})();
