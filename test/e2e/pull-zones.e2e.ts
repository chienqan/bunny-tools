import { afterAll, describe, expect, it } from 'vitest';
import { bunnyCli, bunnyCliOk } from './helpers/bunny-cli.js';
import { register, cleanupAll } from './helpers/cleanup-registry.js';
import { extractIdNumeric } from './helpers/parse-output.js';
import { uniqueId } from './helpers/prefix.js';
import { E2E_ENABLED } from './helpers/env-guard.js';

describe.skipIf(!E2E_ENABLED)('e2e: cdn (pull-zone) CRUD', () => {
  afterAll(async () => {
    await cleanupAll();
  });

  it('create with --origin + get + list + delete', async () => {
    const name = uniqueId('pz');
    const created = await bunnyCliOk(['cdn', 'create', name, '--origin=https://bunny.net']);
    const id = extractIdNumeric(created);
    register('cdn', id, name);

    const detail = await bunnyCliOk(['cdn', 'get', String(id)]);
    expect(detail.stdout).toMatch(/"OriginUrl":\s*"https:\/\/bunny\.net"/);
    expect(detail.stdout).toMatch(/"Hostnames"/);

    const list = await bunnyCliOk(['cdn', 'list']);
    expect(list.stdout).toMatch(new RegExp(name));

    await bunnyCliOk(['cdn', 'delete', String(id), '--yes']);

    const gone = await bunnyCli(['cdn', 'get', String(id)]);
    expect(gone.exitCode).not.toBe(0);
  });

  it('update with raw --body succeeds', async () => {
    const name = uniqueId('pz-up');
    const created = await bunnyCliOk(['cdn', 'create', name, '--origin=https://bunny.net']);
    const id = extractIdNumeric(created);
    register('cdn', id, name);

    const r = await bunnyCli([
      'cdn',
      'update',
      String(id),
      '--body={"EnableLogging":true}',
    ]);
    expect(r.exitCode).toBe(0);

    await bunnyCliOk(['cdn', 'delete', String(id), '--yes']);
  });
});
