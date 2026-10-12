// Help smoke test — pure regression catch for the formatter. Builds the
// Commander tree in-process and asserts every command's `helpInformation()`
// is non-empty and contains the expected section labels for its level
// (root / group / leaf). Catches:
//   - formatHelp throwing on a specific command shape
//   - missing description on a registry entry
//   - section labels accidentally renamed (e.g. USAGE → SYNOPSIS)
// In-process avoids the 30-60s cost of spawning `bunny X --help` per
// command. The downside is we don't exercise Commander's `--help` parsing
// path itself; that's covered by manual smoke + the e2e suite.

import { describe, expect, it } from 'vitest';
import type { Command } from 'commander';
import { buildProgram } from '../../src/cli.js';

function walk(cmd: Command, fn: (c: Command) => void): void {
  fn(cmd);
  for (const sub of cmd.commands) walk(sub, fn);
}

// Strip ANSI bold sequences picocolors emits when stdout is detected as a
// TTY. Tests don't run in a TTY but FORCE_COLOR may be set in the env.
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1B\[[0-9;]*m/g, '');
}

describe('help smoke', () => {
  const program = buildProgram();

  it('every command renders non-empty help', () => {
    const failures: string[] = [];
    walk(program, (cmd) => {
      try {
        const help = stripAnsi(cmd.helpInformation());
        if (help.trim().length === 0) {
          failures.push(`${cmd.name()}: empty help`);
        }
      } catch (err) {
        failures.push(`${cmd.name()}: threw ${(err as Error).message}`);
      }
    });
    expect(failures).toEqual([]);
  });

  it('root help has GETTING STARTED + SERVICES + UTILITIES sections', () => {
    const help = stripAnsi(program.helpInformation());
    expect(help).toContain('GETTING STARTED');
    expect(help).toContain('SERVICES');
    expect(help).toContain('UTILITIES');
    expect(help).toContain('GLOBAL FLAGS');
  });

  it('group help has COMMANDS + GLOBAL FLAGS', () => {
    const dns = program.commands.find((c) => c.name() === 'dns');
    expect(dns).toBeDefined();
    const help = stripAnsi(dns!.helpInformation());
    expect(help).toContain('COMMANDS');
    expect(help).toContain('GLOBAL FLAGS');
    // Two-line wrangler-style header — title alone, blank, description.
    const lines = help.split('\n');
    expect(lines[0]).toBe('bunny dns');
    expect(lines[1]).toBe('');
  });

  it('leaf help has USAGE + GLOBAL FLAGS', () => {
    const dns = program.commands.find((c) => c.name() === 'dns');
    const recordGroup = dns?.commands.find((c) => c.name() === 'record');
    const addLeaf = recordGroup?.commands.find((c) => c.name() === 'add');
    expect(addLeaf).toBeDefined();
    const help = stripAnsi(addLeaf!.helpInformation());
    expect(help).toContain('USAGE');
    expect(help).toContain('FLAGS');
    expect(help).toContain('GLOBAL FLAGS');
  });

  it('leaves with examples render an EXAMPLES block', () => {
    const deploy = program.commands.find((c) => c.name() === 'deploy');
    expect(deploy).toBeDefined();
    const help = stripAnsi(deploy!.helpInformation());
    expect(help).toContain('EXAMPLES');
    expect(help).toContain('$ bunny deploy');
  });

  it('leaves without examples skip the EXAMPLES block', () => {
    // `cdn get` has no examples in the registry — confirms the block
    // is conditional, not always-on with empty rows.
    const cdn = program.commands.find((c) => c.name() === 'cdn');
    const get = cdn?.commands.find((c) => c.name() === 'get');
    expect(get).toBeDefined();
    const help = stripAnsi(get!.helpInformation());
    expect(help).not.toContain('EXAMPLES');
  });
});
