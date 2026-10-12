// core/scripting - Edge Scripting (Bunny Compute) CRUD. UI-free.

import { readFile } from 'node:fs/promises';
import { createAccountClient } from '../api/account.js';
import type { EdgeScript } from '../api/account.js';
import { resolveCredential } from '../config/credential-resolver.js';

function client() {
  return createAccountClient({ resolveCredential: (s) => resolveCredential(s) });
}

export async function listScripts(): Promise<EdgeScript[]> {
  return client().listEdgeScripts();
}

export async function getScript(id: number): Promise<EdgeScript> {
  return client().getEdgeScript(id);
}

// Deploy reads a local source file and upserts the script: an explicit `id`
// or an existing script with the same name (case-insensitive) is updated;
// otherwise a new script is created.
export async function deployScript(opts: {
  name: string;
  filePath: string;
  scriptType?: number;
  id?: number;
}): Promise<EdgeScript> {
  const code = await readFile(opts.filePath, 'utf8');
  const c = client();
  const id =
    opts.id ??
    (await c.listEdgeScripts()).find((s) => s.Name.toLowerCase() === opts.name.toLowerCase())?.Id;
  if (id !== undefined) {
    // Bunny's `POST /compute/script/{id}/code` returns 204 No Content, so we
    // re-fetch the script to give callers the up-to-date metadata they expect.
    await c.updateEdgeScriptCode(id, { Code: code });
    return c.getEdgeScript(id);
  }
  return c.createEdgeScript({
    Name: opts.name,
    Code: code,
    ...(opts.scriptType !== undefined ? { ScriptType: opts.scriptType } : {}),
  });
}

export async function deleteScript(id: number): Promise<void> {
  await client().deleteEdgeScript(id);
}
