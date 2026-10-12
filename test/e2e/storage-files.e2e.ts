import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bunnyCli, bunnyCliOk } from './helpers/bunny-cli.js';
import { register, cleanupAll } from './helpers/cleanup-registry.js';
import { extractIdNumeric } from './helpers/parse-output.js';
import { uniqueId } from './helpers/prefix.js';
import { E2E_ENABLED } from './helpers/env-guard.js';

// Storage commands address files as `<zone>/<path>` and need only the
// account API key: the zone password is fetched automatically, so no
// BUNNY_STORAGE_PASSWORD is injected here — that fallback is under test too.

describe.skipIf(!E2E_ENABLED)('e2e: storage files (Bug #1 + #2 regression)', () => {
  let zoneId = 0;
  let zoneName = '';
  let scratch = '';

  beforeAll(async () => {
    zoneName = uniqueId('files');
    const created = await bunnyCliOk(['storage', 'zone', 'create', zoneName]);
    zoneId = extractIdNumeric(created);
    register('storage-zone', zoneId, zoneName);

    // Bunny needs a few seconds to propagate the new zone's password into
    // the storage data plane (`storage.bunnycdn.com`). Without this the
    // first upload comes back 401. Empirically ~5s suffices.
    await new Promise((r) => setTimeout(r, 6000));

    scratch = await mkdtemp(join(tmpdir(), 'bt-e2e-files-'));
    await mkdir(join(scratch, 'sub'), { recursive: true });
    await writeFile(join(scratch, 'index.html'), '<html>hi</html>');
    await writeFile(join(scratch, 'style.css'), 'body{color:red}');
    await writeFile(join(scratch, 'sub/app.js'), 'console.log(1)');
  }, 60000);

  afterAll(async () => {
    await rm(scratch, { recursive: true, force: true });
    await cleanupAll();
  });

  it('upload + ls <zone> + download (byte-identical) + rm', async () => {
    await bunnyCliOk(['storage', 'upload', join(scratch, 'index.html'), `${zoneName}/index.html`]);

    const list = await bunnyCliOk(['storage', 'ls', zoneName]);
    expect(list.stdout).toMatch(/index\.html/);

    const downloadPath = join(scratch, 'index.dl.html');
    await bunnyCliOk(['storage', 'download', `${zoneName}/index.html`, downloadPath]);
    const original = await readFile(join(scratch, 'index.html'));
    const downloaded = await readFile(downloadPath);
    expect(downloaded.equals(original)).toBe(true);

    await bunnyCliOk(['storage', 'rm', `${zoneName}/index.html`, '--yes']);
  });

  it('upload to a trailing-slash target keeps the local file name', async () => {
    const r = await bunnyCliOk(['storage', 'upload', join(scratch, 'style.css'), `${zoneName}/`, '--json']);
    const res = JSON.parse(r.stdout) as { zone: string; path: string };
    expect(res.zone).toBe(zoneName);
    expect(res.path).toBe('/style.css');
  });

  it('bare `storage ls <zone>` (no path) lists the zone root (Bug #2 regression)', async () => {
    const r = await bunnyCli(['storage', 'ls', zoneName]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/style\.css/);
  });

  it('`storage ls` with no argument lists storage zones', async () => {
    const r = await bunnyCliOk(['storage', 'ls', '--json']);
    const zones = JSON.parse(r.stdout) as Array<Record<string, unknown>>;
    expect(zones.some((z) => z['Name'] === zoneName)).toBe(true);
    // Zone passwords never reach stdout.
    expect(r.stdout).not.toMatch(/"Password"/);
    expect(r.stdout).not.toMatch(/"ReadOnlyPassword"/);
  });

  it('subdir listing returns entries (Bug #1 regression)', async () => {
    await bunnyCliOk(['storage', 'upload', join(scratch, 'sub/app.js'), `${zoneName}/sub/app.js`]);

    const noSlash = await bunnyCliOk(['storage', 'ls', `${zoneName}/sub`]);
    expect(noSlash.stdout).toMatch(/app\.js/);

    const trailing = await bunnyCliOk(['storage', 'ls', `${zoneName}/sub/`]);
    expect(trailing.stdout).toMatch(/app\.js/);
  });

  it('ls <zone> -r walks subdirs (Bug #1 regression)', async () => {
    const r = await bunnyCliOk(['storage', 'ls', zoneName, '-r']);
    expect(r.stdout).toMatch(/style\.css/);
    expect(r.stdout).toMatch(/sub\/app\.js/);
  });

  it('storage sync uploads a directory tree', async () => {
    // Drop a fresh dir that doesn't overlap prior uploads.
    const syncDir = join(scratch, 'sync');
    await mkdir(syncDir, { recursive: true });
    await writeFile(join(syncDir, 'a.txt'), 'a');
    await writeFile(join(syncDir, 'b.txt'), 'b');

    const r = await bunnyCliOk(['storage', 'sync', syncDir, `${zoneName}/synced`]);
    expect(r.stderr + r.stdout).toMatch(/Synced/);

    const list = await bunnyCliOk(['storage', 'ls', `${zoneName}/synced`]);
    expect(list.stdout).toMatch(/a\.txt/);
    expect(list.stdout).toMatch(/b\.txt/);
  });

  it('rm <zone>/<subdir> -r cleans subtree', async () => {
    const r = await bunnyCli(['storage', 'rm', `${zoneName}/sub`, '-r', '--yes']);
    expect(r.exitCode).toBe(0);
    const after = await bunnyCliOk(['storage', 'ls', zoneName, '--recursive']);
    expect(after.stdout).not.toMatch(/sub\/app\.js/);
  });

  it('refuses to delete the zone root', async () => {
    for (const target of [zoneName, `${zoneName}/`]) {
      const r = await bunnyCli(['storage', 'rm', target, '-r', '--yes']);
      expect(r.exitCode).toBe(1);
      expect(r.stderr + r.stdout).toMatch(/root|storage zone delete/i);
    }
  });
});
