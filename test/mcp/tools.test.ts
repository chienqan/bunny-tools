import { describe, expect, it } from 'vitest';
import { registry } from '../../src/manifest/registry.js';
import { TOOLS } from '../../src/mcp/tools.js';

describe('MCP tools', () => {
  it('exposes ~12 high-level tools + run escape hatch', () => {
    const names = TOOLS.map((t) => t.name);
    expect(names).toContain('bunny.deploy');
    expect(names).toContain('bunny.purge');
    expect(names).toContain('bunny.storage_ls');
    expect(names).toContain('bunny.storage_upload');
    expect(names).toContain('bunny.storage_rm');
    expect(names).toContain('bunny.storage_zone_list');
    expect(names).toContain('bunny.storage_zone_create');
    expect(names).toContain('bunny.storage_zone_delete');
    expect(names).toContain('bunny.cdn_list');
    expect(names).toContain('bunny.cdn_hostname_add');
    expect(names).toContain('bunny.dns_list');
    expect(names).toContain('bunny.dns_record_add');
    expect(names).toContain('bunny.storage_download');
    expect(names).toContain('bunny.whoami');
    expect(names).toContain('bunny.dns_record_delete');
    expect(names).toContain('bunny.manifest');
    expect(names).toContain('bunny.init');
    expect(names).toContain('bunny.run');
  });

  it('all tool names are unique', () => {
    const seen = new Set<string>();
    for (const t of TOOLS) {
      expect(seen.has(t.name), `duplicate: ${t.name}`).toBe(false);
      seen.add(t.name);
    }
  });

  it('hard-cap: ≤ 24 tools (keep the MCP surface small; bunny.run covers the long tail)', () => {
    expect(TOOLS.length).toBeLessThanOrEqual(24);
  });

  it('every tool has a non-empty description', () => {
    for (const t of TOOLS) {
      expect(t.description, `${t.name} missing description`).toBeTruthy();
      expect(t.description.length).toBeGreaterThan(20);
    }
  });

  it('manifest tool runs and returns a registry shape', async () => {
    const tool = TOOLS.find((t) => t.name === 'bunny.manifest')!;
    const result = (await tool.run({})) as { binary: string; commands: unknown[] };
    expect(result.binary).toBe('bunny');
    expect(Array.isArray(result.commands)).toBe(true);
  });

  it('input validation rejects malformed args (storage_upload requires target)', async () => {
    const tool = TOOLS.find((t) => t.name === 'bunny.storage_upload')!;
    await expect(tool.run({ local: 'a', remote: 'b' })).rejects.toThrow();
  });

  it('every registry mcp annotation points at a real tool', () => {
    const names = new Set(TOOLS.map((t) => t.name));
    for (const c of registry.commands) {
      if (c.mcp) expect(names.has(c.mcp.tool), `${c.name} → ${c.mcp.tool}`).toBe(true);
    }
  });

  it('bunny.run refuses to spawn `mcp` (avoid recursion)', async () => {
    const tool = TOOLS.find((t) => t.name === 'bunny.run')!;
    await expect(tool.run({ args: ['mcp'] })).rejects.toThrowError(/Refusing/);
  });
});
