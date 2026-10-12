import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deleteScript, deployScript, listScripts } from '../../src/core/scripting.js';
import { getMockAgent } from '../setup.js';

describe('core/scripting', () => {
  let scratch: string;
  let envBackup: Record<string, string | undefined> = {};

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'scripting-'));
    envBackup['XDG_CONFIG_HOME'] = process.env['XDG_CONFIG_HOME'];
    envBackup['BUNNY_API_KEY'] = process.env['BUNNY_API_KEY'];
    process.env['XDG_CONFIG_HOME'] = scratch;
    process.env['BUNNY_API_KEY'] = 'acct';
  });

  afterEach(async () => {
    for (const [k, v] of Object.entries(envBackup)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    envBackup = {};
    await rm(scratch, { recursive: true, force: true });
  });

  it('listScripts paginates /compute/script', async () => {
    getMockAgent()
      .get('https://api.bunny.net')
      .intercept({ path: /\/compute\/script.*/, method: 'GET' })
      .reply(200, {
        Items: [{ Id: 1, Name: 'edge', ScriptType: 0, Deployed: true }],
        HasMoreItems: false,
      });
    const scripts = await listScripts();
    expect(scripts).toHaveLength(1);
  });

  it('deployScript creates a new script when no script has that name', async () => {
    const file = join(scratch, 's.js');
    await writeFile(file, 'export default function () {}');
    const pool = getMockAgent().get('https://api.bunny.net');
    pool
      .intercept({ path: /\/compute\/script\?.*/, method: 'GET' })
      .reply(200, { Items: [{ Id: 3, Name: 'other' }], HasMoreItems: false });
    pool
      .intercept({ path: '/compute/script', method: 'POST' })
      .reply(201, { Id: 7, Name: 'edge', Code: 'export default function () {}' });
    const r = await deployScript({ name: 'edge', filePath: file });
    expect(r.Id).toBe(7);
  });

  it('deployScript updates the existing script with the same name (case-insensitive)', async () => {
    const file = join(scratch, 's.js');
    await writeFile(file, 'v2');
    const pool = getMockAgent().get('https://api.bunny.net');
    pool
      .intercept({ path: /\/compute\/script\?.*/, method: 'GET' })
      .reply(200, { Items: [{ Id: 9, Name: 'Edge' }], HasMoreItems: false });
    pool.intercept({ path: '/compute/script/9/code', method: 'POST' }).reply(204, '');
    pool.intercept({ path: '/compute/script/9', method: 'GET' }).reply(200, { Id: 9, Name: 'Edge', Code: 'v2' });
    const r = await deployScript({ name: 'edge', filePath: file });
    expect(r.Id).toBe(9);
    expect(r.Code).toBe('v2');
  });

  it('deployScript updates code when id given (re-fetches after 204)', async () => {
    const file = join(scratch, 's.js');
    await writeFile(file, 'updated source');
    const pool = getMockAgent().get('https://api.bunny.net');
    pool
      .intercept({ path: '/compute/script/7/code', method: 'POST' })
      .reply(204, '');
    pool
      .intercept({ path: '/compute/script/7', method: 'GET' })
      .reply(200, { Id: 7, Name: 'edge', Code: 'updated source' });
    const r = await deployScript({ name: 'edge', filePath: file, id: 7 });
    expect(r.Code).toBe('updated source');
  });

  it('deleteScript DELETEs by id', async () => {
    getMockAgent()
      .get('https://api.bunny.net')
      .intercept({ path: '/compute/script/7', method: 'DELETE' })
      .reply(204, '');
    await expect(deleteScript(7)).resolves.toBeUndefined();
  });
});
