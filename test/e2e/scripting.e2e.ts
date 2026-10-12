import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bunnyCli, bunnyCliOk } from './helpers/bunny-cli.js';
import { register, cleanupAll } from './helpers/cleanup-registry.js';
import { extractIdNumeric } from './helpers/parse-output.js';
import { uniqueId } from './helpers/prefix.js';
import { E2E_ENABLED } from './helpers/env-guard.js';

describe.skipIf(!E2E_ENABLED)('e2e: Edge Scripting (Bug #7 regression)', () => {
  let scratch = '';
  let scriptPath = '';

  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'bt-e2e-scripting-'));
    scriptPath = join(scratch, 's.js');
    await writeFile(
      scriptPath,
      "addEventListener('fetch', e => e.respondWith(new Response('v1')))\n",
    );
  });

  afterAll(async () => {
    await rm(scratch, { recursive: true, force: true });
    await cleanupAll();
  });

  it('deploy create + list + upsert-by-name update (Bug #7) + delete', async () => {
    const name = uniqueId('script');
    const created = await bunnyCliOk(['scripting', 'deploy', name, `--file=${scriptPath}`]);
    const id = extractIdNumeric(created);
    register('scripting', id, name);

    const list = await bunnyCliOk(['scripting', 'list']);
    expect(list.stdout).toMatch(new RegExp(name));

    // Bug #7 regression: update mode used to crash because /code returns 204
    // and the client tried to read .Name from undefined. Re-deploying the
    // same name must update in place (same id, no duplicate script) and
    // surface the script's name in the result.
    await writeFile(
      scriptPath,
      "addEventListener('fetch', e => e.respondWith(new Response('v2')))\n",
    );
    const updated = await bunnyCliOk([
      'scripting',
      'deploy',
      name,
      `--file=${scriptPath}`,
      '--json',
    ]);
    const script = JSON.parse(updated.stdout) as { Id: number; Name: string };
    expect(script.Id).toBe(id);
    expect(script.Name).toBe(name);

    const listJson = await bunnyCliOk(['scripting', 'list', '--json']);
    const scripts = JSON.parse(listJson.stdout) as Array<{ Id: number; Name: string }>;
    expect(scripts.filter((s) => s.Name === name).length).toBe(1);

    await bunnyCliOk(['scripting', 'delete', String(id), '--yes']);

    const after = await bunnyCli(['scripting', 'list']);
    expect(after.stdout).not.toMatch(new RegExp(name));
  });
});
