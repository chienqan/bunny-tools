import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bunnyCliOk } from './helpers/bunny-cli.js';
import { register, cleanupAll } from './helpers/cleanup-registry.js';
import { extractIdNumeric } from './helpers/parse-output.js';
import { uniqueId } from './helpers/prefix.js';
import { E2E_ENABLED } from './helpers/env-guard.js';

describe.skipIf(!E2E_ENABLED)('e2e: full deploy pipeline', () => {
  let zoneId = 0;
  let zoneName = '';
  let publicDir = '';

  // No storage password is injected: deploy fetches the zone password with
  // the account API key, which this suite exercises end to end.

  beforeAll(async () => {
    zoneName = uniqueId('deploy');
    const created = await bunnyCliOk(['storage', 'zone', 'create', zoneName]);
    zoneId = extractIdNumeric(created);
    register('storage-zone', zoneId, zoneName);

    // Storage password takes ~5s to propagate after zone creation; first
    // upload otherwise returns 401.
    await new Promise((r) => setTimeout(r, 6000));

    publicDir = await mkdtemp(join(tmpdir(), 'bt-e2e-deploy-'));
    await mkdir(join(publicDir, 'sub'), { recursive: true });
    await writeFile(join(publicDir, 'index.html'), '<html>v1</html>');
    await writeFile(join(publicDir, 'style.css'), 'body{color:red}');
    await writeFile(join(publicDir, 'sub/app.js'), 'console.log(1)');
    await writeFile(
      join(publicDir, 'bunny.json'),
      JSON.stringify({
        deploy: {
          publicDir: '.',
          ignore: ['bunny.json', '.bunny-state.json'],
          storageZone: zoneName,
          concurrency: 4,
        },
      }),
    );
  }, 60000);

  afterAll(async () => {
    await rm(publicDir, { recursive: true, force: true });
    await cleanupAll();
  });

  it('--dry-run reports 3 new files without uploading', async () => {
    const r = await bunnyCliOk(['deploy', '--dry-run'], { cwd: publicDir });
    expect(r.stderr + r.stdout).toMatch(/3 new/);
  });

  it('full deploy uploads all files (uses listRecursive — Bug #1 regression)', async () => {
    const r = await bunnyCliOk(['deploy'], { cwd: publicDir });
    const merged = r.stderr + r.stdout;
    expect(merged).toMatch(/uploaded 3 files/);
    expect(merged).toMatch(/Deploy complete/);

    // Verify via recursive list — confirms listRecursive walks subdirs.
    const list = await bunnyCliOk(['storage', 'ls', zoneName, '--recursive']);
    expect(list.stdout).toMatch(/index\.html/);
    expect(list.stdout).toMatch(/sub\/app\.js/);
  });

  it('re-deploy without changes hits state cache (3 unchanged)', async () => {
    const r = await bunnyCliOk(['deploy'], { cwd: publicDir });
    expect(r.stderr + r.stdout).toMatch(/unchanged/);
  });

  it('modify a file then re-deploy detects exactly 1 change', async () => {
    await writeFile(join(publicDir, 'style.css'), 'body{color:GREEN}');
    const r = await bunnyCliOk(['deploy'], { cwd: publicDir });
    const merged = r.stderr + r.stdout;
    expect(merged).toMatch(/1 changed/);
  });

  // rc.45: `bunny init --non-interactive --ci` end-to-end. Reuses the
  // already-provisioned storage zone; runs init in a fresh tmpdir, then
  // asserts both bunny.json and the GH Actions workflow were written.
  // Bug #10 (rc.10) was that --ci wrote a workflow referencing flag names
  // that never existed; this guards against re-introducing similar
  // copy-paste rot.
  it('init --non-interactive --ci writes bunny.json + .github/workflows/bunny-deploy.yml', async () => {
    const initDir = await mkdtemp(join(tmpdir(), 'bt-e2e-init-'));
    try {
      const r = await bunnyCliOk(
        [
          'init',
          '--non-interactive',
          '--features=storage',
          `--storage-zone=${zoneName}`,
          '--pull-zone=99999',
          '--public-dir=public',
          '--ci',
          '--force',
        ],
        { cwd: initDir },
      );
      expect(r.exitCode).toBe(0);

      const cfgRaw = await readFile(join(initDir, 'bunny.json'), 'utf8');
      const cfg = JSON.parse(cfgRaw) as { deploy?: { storageZone?: string } };
      expect(cfg.deploy?.storageZone).toBe(zoneName);

      // GH Actions workflow — current generator emits an npm-install +
      // `bunny deploy` flow (not a composite action — that path was
      // considered but the npm route ships first). Assert the load-bearing
      // tokens that would silently rot if the generator template changed.
      const workflow = await readFile(
        join(initDir, '.github/workflows/bunny-deploy.yml'),
        'utf8',
      );
      expect(workflow).toMatch(/npm install -g bunny-tools/);
      expect(workflow).toMatch(/run:\s*bunny deploy/);
      expect(workflow).toMatch(/BUNNY_API_KEY/);
      // Only the account key: the zone password is fetched with it at deploy time.
      expect(workflow).not.toMatch(/BUNNY_STORAGE_PASSWORD_/);
    } finally {
      await rm(initDir, { recursive: true, force: true });
    }
  });
});
