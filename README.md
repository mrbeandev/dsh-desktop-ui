# dsh-desktop-ui

**Desktop mode** for the DeepSeek Harness web GUI. Keep the sidebar exactly as it
is, and turn the conversation area into a desktop where every session is a
movable, resizable window — with a taskbar along the bottom.

[![npm version](https://img.shields.io/npm/v/dsh-desktop-ui.svg)](https://www.npmjs.com/package/dsh-desktop-ui)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

- **Source code:** [github.com/mrbeandev/dsh-desktop-ui](https://github.com/mrbeandev/dsh-desktop-ui)
- **npm package:** [npmjs.com/package/dsh-desktop-ui](https://www.npmjs.com/package/dsh-desktop-ui)

**Contents:** [Why](#why-this-plugin-exists) · [Install](#install-from-npm) ·
[Features](#features) · [Compatibility](#compatibility-and-limitations) ·
[Development](#build-and-test) · [Local setup](./LOCAL-SETUP.md) · [Release checklist](./RELEASE.md)

![Desktop mode with four sessions tiled, light theme](https://raw.githubusercontent.com/mrbeandev/dsh-desktop-ui/main/assets/desktop-mode-light.png)

## Why this plugin exists

DSH shows one conversation at a time. When you juggle several sessions — a long
agent run, a quick question, a code review — you keep clicking back and forth in
the sidebar. Desktop mode lets you keep them all on screen at once, arrange them
side by side, and park the rest in a taskbar.

## Install from npm

```bash
dsh plugin --profile web add dsh-desktop-ui
```

Restart `dsh web` when asked, then refresh the DSH page. A **Desktop mode** switch
appears in the sidebar, directly above **Settings**.

To remove:

```bash
dsh plugin --profile web remove dsh-desktop-ui
```

Restart and refresh. The normal conversation view comes back unchanged; only the
browser-local window layout remains in `localStorage`.

## Features

| Feature | What it does |
|---|---|
| **Desktop mode switch** | Sits directly above Settings. Off by default; the choice persists in this browser. Turning it off returns to the normal conversation on the focused window's session. |
| **Sessions as windows** | Clicking a session in the sidebar opens it as a window. A session can only have one window — clicking it again restores and focuses the existing one. Every window is a full, live conversation with its own composer. |
| **Window controls** | Drag the title bar to move; drag any edge or corner to resize; double-click the title to maximize/restore; minimize, maximize and close buttons. |
| **Snapping** | Drag a window to the left or right edge to fill that half, or to the top to maximize. |
| **Taskbar** | New session button, one button per window (click to focus, click the focused one to minimize, a dot shows running sessions), Cascade / Tile / Side-by-side layouts, a clock, and a Show desktop strip at the far right. |
| **Compact chat** | Inside windows the chat uses smaller text, buttons and pickers, and tighter spacing. The normal full-width conversation is untouched. |
| **Light and dark** | Uses DSH's own theme tokens only, so it follows the GUI theme automatically. |
| **Narrow screens** | Below 720px the focused window fills the canvas and you switch through the taskbar. |

Closing a window never deletes or archives a session. Nothing is written to the
Host: the window layout lives in browser `localStorage` under
`dsh-desktop-ui.state.v1`. The plugin makes no network requests and stores no
credentials or session contents.

![Desktop mode in the dark theme](https://raw.githubusercontent.com/mrbeandev/dsh-desktop-ui/main/assets/desktop-mode-dark.png)

## Compatibility and limitations

**Requires DSH `>=0.2.0-rc.2 <0.3.0`.** Tested on DSH 0.2.0-rc.2 with Node 24.

This is an **internal integration**, not a stable public DSH API. It plugs into:

| Seam | Use |
|---|---|
| `main` keyed slot, key `dsh-desktop-ui` | the desktop canvas and taskbar, selected with `ctx.layout.selectPanel` |
| `dsh-desktop-ui.window` (session-scoped child slot) | one window body per session, rendering the `conversation.content` factory with `variant: 'embedded'` — the same seam `ui-subagent` uses for sidebar chats |
| `sidebar.footer.action` | the Desktop mode switch |
| `ctx.sessions.retain(id, { source: 'desktopWindow' })` | each window owns an independent session reference, released on close |
| `ctx.uiWorkspace.openSession` / `startSession` | keeps the sidebar selection in sync and creates new sessions |

While Desktop mode is on, navigation that would normally reveal the conversation
(sidebar clicks, New Session, shortcuts) is captured: the session opens as a
window and the desktop stays visible.

Known limitations:

- Later DSH versions may change these internal seams; the plugin may need an update.
- The right sidebar (files, terminal, browser) still belongs to the main session, not to individual windows.
- Window positions are stored per browser, not per account or device.
- Compact styling targets DSH 0.2.0-rc.2 class names; a future DSH restyle can make some of it fall back to stock sizes (harmless, just less compact).
- The UI strings are English only.
- Not yet tested: two tabs at once, a live model turn streaming inside a window, and coexistence with other sidebar plugins.

## Build and test

```sh
npm run check     # build lib/client.js, run unit tests, npm pack --dry-run
npm pack
```

- Editable client source is `client/index.mjs`. `scripts/build.mjs` writes `lib/client.js`, a lazy module that uses the GUI's own React (React is not bundled). Run `npm run build` and commit `lib/client.js` after editing the source; a unit test fails if it is stale.
- `index.mjs` is an intentional no-op host entry; `cordis.patch.yml` registers the package.
- Client inject list: `dsh-api-session-controller`, `dsh-client-ui-layout`, `dsh-client-ui-session`, `dsh-client-ui-sidebar`, `dsh-client-ui-conversation`, `dsh-client-ui-chat`, `dsh-client-ui-workspace`.
- `test/state.test.mjs` covers the window manager (open/focus/minimize/maximize/close, one window per session, move never resizes, snapping, layouts, show desktop, pruning, state sanitising), runtime identities, and bundle freshness.
- `scripts/e2e-gui.mjs` is a dependency-free headless Chrome/CDP test against a real, isolated DSH instance. See [LOCAL-SETUP.md](./LOCAL-SETUP.md).

## Design concepts

The early, standalone "Harness OS" design explorations that led to this plugin
are kept in [`designs/`](./designs/README.md). They are static HTML demos and are
not part of the npm package.

## License

[MIT](./LICENSE)
