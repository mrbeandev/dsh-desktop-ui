# Design concepts (Harness OS A and B)

A minimal, Linux-inspired desktop concept for DeepSeek Harness. Graphite windows, mineral wallpaper, mint status lights, and readable type. A standalone HTML/CSS/JavaScript prototype—not a Harness plugin or replacement runtime.

## Preview

Requires Python 3 (no frontend build or npm install):

```sh
python3 -m http.server 4311 --bind 127.0.0.1 --directory designs
```

Open http://127.0.0.1:4311/harness-os/.

## Try it

- Drag window title bars; double-click to maximize. The three window controls close, minimize, and maximize.
- Launch Sessions, Agent activity, Files, Terminal, and Settings from the dock.
- Press Ctrl/Cmd+K for searchable apps; use arrow keys and Enter.
- Create local sessions and send messages for simulated replies.
- Start a simulated Builder task in Agent activity.
- Try `help`, `ls`, `pwd`, `status`, `whoami`, `clear`, or `open files` in Terminal.
- Select Grove, Dusk, or Clay in Settings. Theme and quiet-mode preferences persist in this browser.

## Source

- `harness-os/index.html`: semantic desktop markup and inline SVG landscape/icons.
- `harness-os/desktop.css`: initial visual scaffolding and layout.
- `harness-os/linux.css`: active Linux workstation theme and readable typography.
- `harness-os/desktop.js`: local interaction state and simulated applications.
- `harness-os/_d_meta.json`: design review metadata.

Edit source directly and refresh the preview. No generated bundles. Google Fonts is optional; system sans-serif fallback works offline. The desktop artwork is local inline SVG, so there are no image-provider requests or embedded API keys.

## Boundaries

All conversations, agents, files, tools, and terminal output are mock data. The terminal does not execute commands. There is no provider connection, no authentication, no real filesystem access, and no modification to the existing Harness GUI. Session content is held in memory and resets on refresh. Theme settings use namespaced localStorage keys.

## Verification

JavaScript syntax checked with `node --check`. Browser checks cover app opening/closing, file previews, theme switching, mock messages, safe text rendering, terminal help, and launcher search. Desktop and narrow-screen layout checked using browser viewport probes. This is a design prototype, not production integration.

## Option B — Tiling (`harness-os-tiling/`)

Harness reimagined as an i3/Hyprland-style tiling compositor. Open http://127.0.0.1:4311/harness-os-tiling/.

- **Sessions are workspaces, tools are tiles, agents are processes.** Four workspaces (ideas, code, tools, scratch) use an auto master/stack layout.
- **Vim-style modal keys.** NORMAL mode: `/` launcher, `1–4` workspace, `j`/`k` focus, `f` fullscreen, `[`/`]` resize, `n` session, `t` terminal, `c` context, `q` close, `i` type. `Esc` returns to NORMAL. `Ctrl/Cmd+K` also opens the launcher.
- **Context reactor:** a live token gauge that glows amber past 80% and animates compaction.
- **Agent processes:** dispatch builder or reviewer and watch progress bars, the amber top-bar ticker, and the token sparkline.
- **Streamed replies with tool-call strips**, a file tree with an inline diff, toggleable tools, and a sandboxed shell (`help`, `neofetch`, `ps`, `ctx`, `dispatch builder`, `open files`…).

Same boundaries as Option A: all data is simulated, user text is rendered as plain text, and nothing executes or calls the network.
