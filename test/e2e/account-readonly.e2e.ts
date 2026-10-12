import { describe, expect, it } from 'vitest';
import { bunnyCli, bunnyCliOk } from './helpers/bunny-cli.js';
import { E2E_ENABLED } from './helpers/env-guard.js';

describe.skipIf(!E2E_ENABLED)('e2e: account read-only smoke', () => {
  it('bunny whoami exits 0 in either env-only or stored-creds mode', async () => {
    const r = await bunnyCliOk(['whoami']);
    // whoami enumerates *stored* credentials (keychain + credentials.json).
    // CI runs with credentials in env vars only — so the expected output
    // there is "No credentials stored." Local dev typically has stored
    // creds and gets the table render. Both branches must be tolerated.
    const out = r.stdout + r.stderr;
    const isStoredMode = /\bscope\b/i.test(out) && /\baccount\b/i.test(out);
    const isEnvOnlyMode = /No credentials stored/i.test(out);
    expect(isStoredMode || isEnvOnlyMode).toBe(true);
  });

  it('bunny manifest --names emits at least 40 active commands', async () => {
    const r = await bunnyCliOk(['manifest', '--names']);
    const names = r.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
    expect(names.length).toBeGreaterThanOrEqual(40);
    // Sanity: a few core commands must appear so a rendering regression
    // (e.g. names mode dropping output) gets caught.
    expect(names).toContain('deploy');
    expect(names).toContain('storage zone list');
    expect(names).toContain('cdn list');
    expect(names).toContain('manifest');
  });

  it('bunny storage zone list exits 0 and renders the expected columns', async () => {
    const r = await bunnyCli(['storage', 'zone', 'list']);
    expect(r.exitCode).toBe(0);
    // Drift smoke: the table renderer derives column names from the API
    // response shape. If Bunny renames a field, the header row changes.
    // Asserting on header text catches that without coupling to specific
    // user data.
    expect(r.stdout).toMatch(/\bid\b/);
    expect(r.stdout).toMatch(/\bname\b/);
    expect(r.stdout).toMatch(/\bregion\b/);
  });
});
