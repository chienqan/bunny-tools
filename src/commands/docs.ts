// `bunny docs [topic]` - opens Bunny.net docs in the default browser.
// Topic table maps friendly names to known doc paths; otherwise treats topic
// as a slug appended to the docs base.

import { spawn } from 'node:child_process';
import type { ParsedInvocation } from '../manifest/types.js';
import { createProgress } from '../ui/progress.js';

const DOCS_BASE = 'https://docs.bunny.net';

const TOPIC_MAP: Record<string, string> = {
  // Common topics - friendly aliases → doc paths.
  '': '/docs',
  api: '/reference/bunnynet-api-overview',
  storage: '/docs/storage-introduction',
  pullzone: '/docs/cdn-pull-zone',
  'pull-zone': '/docs/cdn-pull-zone',
  cdn: '/docs/cdn-pull-zone',
  dns: '/docs/dns-overview',
  stream: '/docs/stream-overview',
  containers: '/docs/magic-containers',
  scripting: '/docs/edge-scripting',
  rule: '/docs/cdn-edge-rules',
  edgerule: '/docs/cdn-edge-rules',
  'edge-rule': '/docs/cdn-edge-rules',
  purge: '/reference/purgepublic_indexpost',
  deploy: '/docs/storage-introduction',
};

function resolveUrl(topic: string | undefined): string {
  const t = (topic ?? '').toLowerCase().trim();
  const path = TOPIC_MAP[t] ?? `/docs/${t}`;
  return `${DOCS_BASE}${path}`;
}

function openInBrowser(url: string): Promise<number> {
  return new Promise((resolve) => {
    const platform = process.platform;
    const cmd =
      platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';
    const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => resolve(1));
    child.on('exit', (code) => resolve(code ?? 0));
    // Allow the parent to exit even though the browser opens async.
    child.unref();
    // Best-effort: don't wait long.
    setTimeout(() => resolve(0), 500);
  });
}

export async function run(inv: ParsedInvocation): Promise<number> {
  const progress = createProgress();
  const args = inv.args as { topic?: string };
  const url = resolveUrl(args.topic);
  progress.info(`Opening ${url}`);
  await openInBrowser(url);
  return 0;
}

// Exported for tests.
export const _internal = { resolveUrl, TOPIC_MAP };
