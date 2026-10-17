// Test-only host plugin. Never pack or install in a primary DSH profile.
// Creates synthetic offline sessions so desktop windows have real content.
// Copy it outside this package before use: DSH rejects one package served from
// two Loader sources.
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
export const inject = ['workspaceRegistry', 'sessions'];
export async function apply(ctx) {
  const home = process.env.DSH_HOME;
  if (!home || !resolve(home).startsWith('/tmp/dsh-desktop-ui-e2e.')) throw new Error('Fixtures require a dedicated /tmp/dsh-desktop-ui-e2e.* home');
  const path = join(home, 'demo');
  await mkdir(path, { recursive: true });
  const workspace = await ctx.workspaceRegistry.create(path, 'Desktop Demo');
  // Seeded sessions live in memory only (they are not published through the
  // agent lifecycle), so recreate them on every start of the test server.
  const convo = [
    ['Plan the release', 'Plan the 0.2 release checklist', 'Here is a short checklist: freeze features, run the full test matrix, write release notes, tag, and publish.'],
    ['Fix flaky test', 'Why is the upload test flaky?', 'It races the progress event. Await the final progress callback before asserting the byte count.'],
    ['Write README', 'Draft a README intro for the desktop plugin', 'Desktop mode turns the conversation area into a canvas where each session is a window, with a taskbar at the bottom.'],
  ];
  let t = Date.now() - 3600000;
  for (const [title, prompt, answer] of convo) {
    t += 60000;
    const session = ctx.sessions.create(undefined, {
      meta: { cwd: workspace.path, createdAt: t, title },
      seed: [
        { type: 'user/message', seq: 0, time: t, surfaceOp: 'append', data: { id: `fx-u-${t}`, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: prompt }] } },
        { type: 'turn/start', seq: 1, time: t, data: { turn: 1 } },
        { type: 'assistant/message', seq: 2, time: t + 1000, surfaceOp: 'append', data: { turn: 1, step: 0, stream: [], message: { id: `fx-a-${t}`, role: 'assistant', source: { kind: 'model', provider: 'fixture', model: 'offline' }, content: [{ type: 'text', text: answer }] } } },
        { type: 'turn/end', seq: 3, time: t + 1000, data: { turn: 1, reason: { kind: 'completed' } } },
      ],
    });
    await workspace.attachSession(session.id);
  }
}
