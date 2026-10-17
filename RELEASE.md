# Release checklist

## Current candidate: 0.1.0 (first release, not yet published)

**Status: experimental.** Publication is manual; no automatic npm publishing
workflow is configured.

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
- Installation from the npm registry (do this right after publishing).

## Publishing (owner only)

1. `git status` is clean and `main` is pushed; CI is green.
2. `npm run check`, then `npm publish --dry-run --json` — inspect the file list,
   size, shasum and integrity.
3. `npm login` (if `npm whoami` fails), then `npm publish`. `publishConfig.access`
   is already `public`.
4. Tag and push: `git tag v0.1.0 && git push origin v0.1.0`, and create a GitHub
   release from the tag.
5. Install from the registry into a fresh disposable profile
   (`dsh plugin --profile web add dsh-desktop-ui@0.1.0`), restart, and rerun the
   browser test. Record the result here.

`prepack` rebuilds and tests; `prepublishOnly` runs `npm run check`. These are a
package gate, not a complete runtime release gate.

## Before each later release

1. Run the isolated matrix in [LOCAL-SETUP.md](./LOCAL-SETUP.md) against the
   exact packed artifact.
2. Check that source, generated bundle, runtime IDs, storage key, bundle patch,
   README and advertised behaviour agree.
3. Bump the version for any package change; published versions are immutable.
4. Check Git for credentials, logs, session data, tarballs and machine paths.
