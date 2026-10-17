import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const name = 'dsh-desktop-ui';

/**
 * Host entry. Desktop mode runs in the browser; the Host only stores the window
 * layout so it survives DSH restarts, reloads and browser changes.
 *
 * `layout` is a volatile field: the web client writes it through the shared
 * settings service (`configForms`) and it applies without reloading the plugin.
 * It holds a small JSON document — whether Desktop mode is on, the open
 * session ids, their geometry, z-order and minimized/maximized flags. It never
 * holds conversation content.
 */
export function createConfig(z) {
  return z.object({
    layout: z.string().default('').volatile()
      .description('Saved Desktop mode window layout (managed by the web client; safe to clear).'),
  });
}

function tryHarnessSchemastery(entry) {
  try {
    if (!entry) return undefined;
    const require = createRequire(realpathSync(entry));
    return pathToFileURL(require.resolve('@deepseek-ai/schemastery')).href;
  } catch {
    return undefined;
  }
}

// Build Config with the running harness's own schemastery, never a second copy.
// Outside a harness (plain `node --test`) there is no Config.
const harnessSchemastery = tryHarnessSchemastery(process.argv[1]);
export const Config = harnessSchemastery === undefined
  ? undefined
  : createConfig((await import(harnessSchemastery)).default);

export function apply() {}
