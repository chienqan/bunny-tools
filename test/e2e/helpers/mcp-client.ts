// Spawn `bunny mcp` and connect an MCP SDK client over stdio. The whole
// e2e MCP suite shares one server instance — connecting per-test would
// triple the wall-clock cost (each spawn + handshake is ~1s) for no
// additional coverage.
//
// Tests pass `BUNNY_API_KEY` from the parent env so MCP-bound zone/dns
// ops authenticate. Storage ops need nothing extra: the server fetches each
// zone's password with the account API key on demand. An explicit
// `BUNNY_STORAGE_PASSWORD[_<ZONE>]` in `extraEnv` still wins if a test
// wants to pin it.

import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(dirname(__filename), '../../..');
const CLI_ENTRY = resolve(PROJECT_ROOT, 'src/cli.ts');

export type McpHandle = {
  client: Client;
  transport: StdioClientTransport;
  child: ChildProcessWithoutNullStreams | null;
  close: () => Promise<void>;
};

export async function spawnMcpClient(extraEnv: Record<string, string> = {}): Promise<McpHandle> {
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    ...extraEnv,
  };

  // StdioClientTransport spawns the child for us. Manual `spawn(...)` would
  // duplicate the work and complicate cleanup; the SDK pattern is the
  // canonical one and is already a hard dep.
  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', CLI_ENTRY, 'mcp'],
    env,
    cwd: PROJECT_ROOT,
  });

  const client = new Client(
    { name: 'bunny-tools-e2e-mcp', version: '0.0.0' },
    { capabilities: {} },
  );
  await client.connect(transport);

  return {
    client,
    transport,
    child: null,
    async close() {
      try {
        await client.close();
      } catch {
        // ignore close errors — the child may already have exited
      }
      try {
        await transport.close();
      } catch {
        // ignore
      }
    },
  };
}

// Helpers parse MCP `callTool` results which are wrapped in a `content[]`
// array per the protocol. Most tools return a single text/JSON content item;
// these unwrap to the raw payload tests want to assert on.
//
// rc.48: when the wrapped content is plain text (typically an error message
// surfaced via the MCP `isError` envelope), JSON.parse throws SyntaxError
// showing only the first few characters — useless for debugging. We now
// surface the full text in the thrown error so test failures point at the
// underlying API rejection, not the parse step.
export function unwrapJson<T = unknown>(result: {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}): T {
  const first = result.content?.[0];
  if (!first || first.type !== 'text' || typeof first.text !== 'string') {
    throw new Error(`unexpected MCP content shape: ${JSON.stringify(result).slice(0, 200)}`);
  }
  try {
    return JSON.parse(first.text) as T;
  } catch {
    const tag = result.isError === true ? ' (isError=true)' : '';
    throw new Error(
      `MCP tool returned non-JSON text${tag} — body: ${first.text.slice(0, 500)}`,
    );
  }
}

export function unwrapText(result: { content?: Array<{ type: string; text?: string }> }): string {
  const first = result.content?.[0];
  if (!first || first.type !== 'text' || typeof first.text !== 'string') {
    throw new Error(`unexpected MCP content shape: ${JSON.stringify(result).slice(0, 200)}`);
  }
  return first.text;
}
