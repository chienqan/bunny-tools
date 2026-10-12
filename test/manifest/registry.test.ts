import { describe, expect, it } from 'vitest';
import { findCommand, listMcpTools, registry } from '../../src/manifest/registry.js';

describe('registry', () => {
  it('has the right binary + cli name', () => {
    expect(registry.cliName).toBe('bunny-tools');
    expect(registry.binary).toBe('bunny');
    expect(registry.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('command names are unique', () => {
    const seen = new Set<string>();
    for (const c of registry.commands) {
      expect(seen.has(c.name), `duplicate command: ${c.name}`).toBe(false);
      seen.add(c.name);
    }
  });

  it('every command has a non-empty summary', () => {
    for (const c of registry.commands) {
      expect(c.summary, `${c.name} missing summary`).toBeTruthy();
    }
  });

  it('every active command declares a load() function', () => {
    for (const c of registry.commands) {
      if (c.status === 'active') {
        expect(c.load, `${c.name} active but no load()`).toBeDefined();
      }
    }
  });

  it('phase 1 + 2 active commands present (space-delimited; rc.9 multi-account profiles)', () => {
    const active = registry.commands.filter((c) => c.status === 'active').map((c) => c.name);
    expect(active).toContain('manifest');
    expect(active).toContain('init');
    expect(active).toContain('configure');
    expect(active).toContain('configure list');
    expect(active).toContain('configure switch');
    expect(active).toContain('configure remove');
    expect(active).toContain('use');
    expect(active).toContain('deploy');
    expect(active).toContain('purge');
    // rc.9: `auth set/list/clear` removed; replaced by `configure` namespace.
    expect(active).not.toContain('auth set');
    expect(active).not.toContain('auth list');
    expect(active).not.toContain('auth clear');
    // rc.7: no command name should contain a colon.
    for (const name of active) {
      expect(name, `${name} still has colon`).not.toMatch(/:/);
    }
  });

  it('listMcpTools returns commands that declare mcp', () => {
    const tools = listMcpTools();
    expect(tools.length).toBeGreaterThan(0);
    for (const t of tools) {
      expect(t.tool).toMatch(/^bunny\./);
      expect(t.name).toBeTruthy();
    }
  });

  it('findCommand looks up by name', () => {
    expect(findCommand('manifest')?.name).toBe('manifest');
    expect(findCommand('does-not-exist')).toBeUndefined();
  });

  it('mcp annotations stay within the MCP tool cap', () => {
    expect(listMcpTools().length).toBeLessThanOrEqual(22);
  });

  it('old 0.1.x command names are gone', () => {
    const names = registry.commands.map((c) => c.name);
    for (const old of ['storage list', 'storage delete', 'storagezone list', 'pullzone list', 'pullzone edgerule list', 'containers app list']) {
      expect(names).not.toContain(old);
    }
  });

  it('list/delete verbs carry ls/rm aliases', () => {
    for (const c of registry.commands) {
      const verb = c.name.split(' ').pop();
      if (verb === 'list') expect(c.aliases, c.name).toContain('ls');
      if (verb === 'delete' && c.name !== 'storage rm') expect(c.aliases, c.name).toContain('rm');
    }
  });
});
