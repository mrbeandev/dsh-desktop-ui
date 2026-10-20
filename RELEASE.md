# Release checklist

## Current candidate: 0.1.8 (not yet published)

Tested 2026-10-20 on DSH 0.2.0-rc.2 in a disposable `DSH_HOME` with
`dsh-all-usage@1.2.0` and `dsh-rewind-plugin@0.15.0-beta.1`, real headless Chrome
over CDP, no model calls.

| Check | Result |
|---|---|
| Unit tests (`npm test`) | 43/43 |
| Packed tarball, GUI test | 81/81, five runs in a row |

### Changes in 0.1.8

- **Taskbar tooltips** show `workspace | session` (plus minimized / popped out).
  One shared tooltip is drawn above the taskbar, so the scrolling task strip
  cannot clip it, and it is kept on screen at the edges.
- **Desktop background editor** on the plugin page, with a live preview:
  canvas opacity (0–100%), taskbar opacity (frosted glass below 100%), and a
  wallpaper image with Fill / Fit / Center / Tile and a strength slider. Images
  with transparent areas are supported. Reset appearance restores the defaults.
- The wallpaper image is stored in the browser's IndexedDB, not the profile
  config; its settings are saved with the layout and restored after a restart.
- Verified in the GUI with a real PNG whose right half is fully transparent.

## Previous release: 0.1.7 (published)

Tested 2026-10-19 on DSH 0.2.0-rc.2 in a disposable `DSH_HOME` with
`dsh-all-usage@1.2.0` and `dsh-rewind-plugin@0.15.0-beta.1`, real headless Chrome
over CDP, no model calls.

| Check | Result |
|---|---|
| Unit tests (`npm test`) | 39/39 |
| Packed tarball, GUI test | 69/69, three runs in a row |

### Changes in 0.1.7

- **Fixed: closing a window could reopen it as a floating window.** Pressing
  Close on a window that wasn't focused (common after Tile / Side by side) first
  focused it, which scheduled a sidebar selection; that fired after the close and
  the desktop reopened the session. Window control buttons no longer focus the
  window, a pending selection is cancelled on close, and a stale selection can no
  longer reopen a closed window. Reproduced on 0.1.6 and verified fixed by a new
  GUI check.
- **Fixed: sidebar hover could stop working after closing a window under the
  pointer** (no pointer-leave fires for a removed element). Closing, minimizing,
  popping out or removing a window now ends its hover.
- Hover expansion is more robust: it clicks the workspace row's own toggle, waits
  for the rows to render, and ignores rows still animating out of a collapsed
  workspace.

## Previous candidate: 0.1.6

Tested 2026-10-19 on DSH 0.2.0-rc.2 in a disposable `DSH_HOME` with
`dsh-all-usage@1.2.0` and `dsh-rewind-plugin@0.15.0-beta.1`, real headless Chrome
over CDP, no model calls.

| Check | Result |
|---|---|
| Unit tests (`npm test`) | 39/39 |
| Packed tarball, GUI test | 68/68, twice in a row |

### Changes in 0.1.6

- **Sidebar hover highlight.** Hovering a window highlights its session and
  workspace rows in the sidebar; a collapsed workspace opens while hovering and
  closes again afterwards (a sidebar click keeps it open).
- **Settings page.** Plugins → dsh-desktop-ui shows "Highlight the sidebar on
  hover" (on by default). The choice is saved with the layout.
- Includes 0.1.4 (linked borders) and 0.1.5 (workspace | session titles).

## Previous candidate: 0.1.5

Tested 2026-10-19 on DSH 0.2.0-rc.2 in a fresh disposable `DSH_HOME` with
`dsh-all-usage@1.2.0` and `dsh-rewind-plugin@0.15.0-beta.1`, real headless Chrome
over CDP, no model calls.

| Check | Result |
|---|---|
| Unit tests (`npm test`) | 38/38 |
| Packed tarball, GUI test | 61/61, twice in a row |

### Changes in 0.1.5

- Window title bars show `workspace | session`; ungrouped sessions show only the
  session title. The default workspace is labelled "Default workspace", and an
  untitled workspace falls back to its folder name.
- Includes 0.1.4's linked borders (0.1.4 was not published separately).

## Previous candidate: 0.1.4

Tested 2026-10-19 on DSH 0.2.0-rc.2 in a fresh disposable `DSH_HOME` under `/tmp`
with `dsh-all-usage@1.2.0` and `dsh-rewind-plugin@0.15.0-beta.1`, real headless
Chrome over CDP, no model calls.

| Check | Result |
|---|---|
| Unit tests (`npm test`) | 37/37 |
| Packed tarball, GUI test | 60/60, twice in a row |

### Changes in 0.1.4

- **Linked borders.** Dragging the border between windows that touch (side by
  side or stacked) resizes them together, like a splitter: one grows as the
  other shrinks, the gap is kept, and in a grid the whole straight split moves.
  Clamped at the minimum window size. Corner grips and non-touching windows are
  unchanged.
- Edge grips now reach 5px outside each window, so the 8px gap between tiled
  windows is always grabbable.
- A drag now also applies the final pointer position on release, so fast drags
  don't stop short.

## Previous candidate: 0.1.3

Tested 2026-10-18 on DSH 0.2.0-rc.2 in a fresh disposable `DSH_HOME` under `/tmp`
with `dsh-all-usage@1.2.0` and `dsh-rewind-plugin@0.15.0-beta.1` installed alongside,
real headless Chrome over CDP, no model calls.

| Check | Result |
|---|---|
| Unit tests (`npm test`) | 31/31 |
| Packed tarball, GUI test | 56/56, twice in a row |

### Changes in 0.1.3

- **Pop out / Pop back in (browser only).** A 4th title-bar button opens the
  session in its own browser window (conversation only, no sidebar); a placeholder
  with **Pop back in** stays on the canvas and the popout has its own **Pop back
  in** in the header. Hidden inside the DeepSeek desktop app.
- **Empty states restyled** to DSH sizes: icon tile, 15px title, 13px hint, and a
  properly aligned **New session** button (the icon no longer floats above the
  text). The all-minimized state uses the same style.
- Fixed in testing: the popout's hidden sidebar made the right-bar column overlay
  the header; columns are now pinned to their own grid tracks.

## Previous candidate: 0.1.2

Local tests on 2026-10-17 used DSH 0.2.0-rc.2, Node 24 and real headless Google
Chrome over CDP in a disposable `DSH_HOME` under `/tmp`, with `dsh-all-usage@1.2.0`
and `dsh-rewind-plugin@0.15.0-beta.1` installed alongside. The primary profile was
not modified. No model calls or real credentials were used.

| Check | Result |
|---|---|
| Unit tests (`npm test`) | 27/27 |
| Packed tarball installed in isolated DSH, GUI test | 50/50, twice in a row |
| Removed + restarted, GUI test (`DSH_E2E_ABSENT=1`) | 5/5 |
| DSH restarted, brand-new browser profile | same windows, positions, minimized state and text size restored from the Host config |

### Changes in 0.1.2

- **Full stock UI in windows.** Windows render the stock conversation entry with
  its own render rights, so header, tabs and every plugin contribution appear,
  e.g. `dsh-rewind-plugin`'s rewind button, which was missing before.
- **Uniform scaling instead of per-element CSS.** One CSS `zoom` on the window
  body (default 85%, 70–100% from the taskbar) replaces the old list of
  compact-size overrides, so future plugin UI scales automatically.
- **Restart-proof layout.** The layout is saved to a volatile `layout` field in
  this plugin's config through DSH's settings service; the Host copy wins on
  load, local edits made before it answers win over a late Host copy, writes are
  debounced and serialized, and pending writes flush on page hide.
- **Footer coexistence.** The Desktop mode switch sorts first (order −100) and
  the footer action row stacks vertically, so `dsh-all-usage`'s button no longer
  gets pushed sideways.
- Fixed: restored windows mounting before the session list loaded showed
  "unknown session"; DSH's boot-time reselection reopened a window the user had
  closed; the reading column kept a 680px minimum inside narrow windows.

## Previous release: 0.1.0 (published to npm 2026-10-17)

**Status: experimental.** Releases are npm-only and published manually by the
owner. There are no GitHub releases, tags or CI workflows.

Local tests on 2026-10-17 used DSH 0.2.0-rc.2, Node 24 and real headless Google
Chrome over CDP in a disposable `DSH_HOME` under `/tmp`. The primary profile was
not modified. No model calls or real credentials were used.

| Check | Result |
|---|---|
| Unit tests (`npm test`) | 17/17 |
| Packed tarball installed in isolated DSH, GUI test | 43/43 |
| Removed + restarted, GUI test (`DSH_E2E_ABSENT=1`) | 5/5 |
| Reinstalled from tarball, GUI test | 43/43 |
| Light and dark theme | Checked visually |
| Packed file list | 6 files: `index.mjs`, `lib/client.js`, `cordis.patch.yml`, `README.md`, `LICENSE`, `package.json` |
| Secrets / machine paths in Git history | None found |

### Findings fixed before release

- **Moving a window also resized it.** The move action was named `move`, and
  resize edges were chosen with `edge.includes('e')`. Moving now goes through a
  pure `dragRect` function that never changes size; unit and browser tests
  confirm the size stays the same when dragging left or right.
- **A session could open in several windows.** Opening is now idempotent, stored
  duplicates collapse on load, and rendering de-duplicates defensively.
- **Text, buttons and pickers were too large inside windows.** Compact sizes are
  scoped to windows only, including pickers that hard-coded 16px.
- **Double-click maximize was swallowed** by the drag overlay. Dragging now starts
  only after the pointer moves 4px.

### Not yet covered

- Live model turn streaming inside a window (needs a provider).
- Two tabs at once; coexistence with other sidebar plugins.
- Installation from the npm registry into a fresh profile (pending).

## Publishing (owner only)

1. `git status` is clean and `main` is pushed.
2. `npm run check`, then `npm publish --dry-run --json` — inspect the file list,
   size, shasum and integrity.
3. `npm login` (if `npm whoami` fails), then `npm publish`. `publishConfig.access`
   is already `public`.
4. Install from the registry into a fresh disposable profile
   (`dsh plugin --profile web add dsh-desktop-ui@<version>`), restart, and rerun
   the browser test. Record the result here.

`prepack` rebuilds and tests; `prepublishOnly` runs `npm run check`. These are a
package gate, not a complete runtime release gate.

## Before each later release

1. Run the isolated matrix in [LOCAL-SETUP.md](./LOCAL-SETUP.md) against the
   exact packed artifact.
2. Check that source, generated bundle, runtime IDs, storage key, bundle patch,
   README and advertised behaviour agree.
3. Bump the version for any package change; published versions are immutable.
4. Check Git for credentials, logs, session data, tarballs and machine paths.
