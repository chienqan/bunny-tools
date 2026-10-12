import { afterAll, describe, expect, it } from 'vitest';
import { bunnyCli, bunnyCliOk } from './helpers/bunny-cli.js';
import { register, cleanupAll } from './helpers/cleanup-registry.js';
import { extractIdNumeric as extractId } from './helpers/parse-output.js';
import { uniqueId } from './helpers/prefix.js';
import { E2E_ENABLED } from './helpers/env-guard.js';

describe.skipIf(!E2E_ENABLED)('e2e: storage-zone CRUD', () => {
  afterAll(async () => {
    await cleanupAll();
  });

  it('create + get-by-id + get-by-name + delete', async () => {
    const name = uniqueId('zone');
    const created = await bunnyCliOk(['storage', 'zone', 'create', name]);
    const id = extractId(created);
    register('storage-zone', id, name);

    // Get by id. Zone passwords are stripped from output — storage commands
    // fetch them with the account API key instead — so neither the
    // read-write nor the read-only password may leak to stdout.
    const byId = await bunnyCliOk(['storage', 'zone', 'get', String(id)]);
    expect(byId.stdout).toMatch(new RegExp(`"Name":\\s*"${name}"`));
    expect(byId.stdout).not.toMatch(/"Password"/);
    expect(byId.stdout).not.toMatch(/"ReadOnlyPassword"/);

    // Get by name — same shape.
    const byName = await bunnyCliOk(['storage', 'zone', 'get', name]);
    expect(byName.stdout).toMatch(new RegExp(`"Id":\\s*${id}`));
    expect(byName.stdout).not.toMatch(/"Password"/);

    await bunnyCliOk(['storage', 'zone', 'delete', String(id), '--yes']);

    // After delete, get-by-id should fail (404).
    const gone = await bunnyCli(['storage', 'zone', 'get', String(id)]);
    expect(gone.exitCode).not.toBe(0);
  });

  it('uppercases lowercase --region (Bug #9 regression)', async () => {
    const name = uniqueId('zone-ny');
    const created = await bunnyCliOk(['storage', 'zone', 'create', name, '--region=ny']);
    const id = extractId(created);
    register('storage-zone', id, name);
    expect(`${created.stdout}${created.stderr}`).toMatch(/region=NY/);

    const detail = await bunnyCliOk(['storage', 'zone', 'get', String(id)]);
    expect(detail.stdout).toMatch(/"Region":\s*"NY"/);

    await bunnyCliOk(['storage', 'zone', 'delete', String(id), '--yes']);
  });

  it('update with raw --body succeeds', async () => {
    const name = uniqueId('zone-up');
    const created = await bunnyCliOk(['storage', 'zone', 'create', name]);
    const id = extractId(created);
    register('storage-zone', id, name);

    const r = await bunnyCli([
      'storage',
      'zone',
      'update',
      String(id),
      '--body={"ReplicationRegions":[]}',
    ]);
    expect(r.exitCode).toBe(0);

    await bunnyCliOk(['storage', 'zone', 'delete', String(id), '--yes']);
  });

  it('list returns the zone we created', async () => {
    const name = uniqueId('zone-list');
    const created = await bunnyCliOk(['storage', 'zone', 'create', name]);
    const id = extractId(created);
    register('storage-zone', id, name);

    const list = await bunnyCliOk(['storage', 'zone', 'list']);
    expect(list.stdout).toMatch(new RegExp(name));

    // JSON listing carries the zone but never its passwords.
    const json = await bunnyCliOk(['storage', 'zone', 'list', '--json']);
    const zones = JSON.parse(json.stdout) as Array<Record<string, unknown>>;
    const mine = zones.find((z) => z['Id'] === id);
    expect(mine).toBeDefined();
    expect(mine).not.toHaveProperty('Password');
    expect(mine).not.toHaveProperty('ReadOnlyPassword');

    await bunnyCliOk(['storage', 'zone', 'delete', String(id), '--yes']);
  });
});
