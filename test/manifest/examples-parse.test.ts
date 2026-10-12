// Examples-validity check. The registry now ships `examples` strings as
// user-facing teaching content (rendered via the EXAMPLES block in --help
// and surfaced through `bunny manifest` JSON for AI agents). A typo in an
// example ships as "advice that crashes" — worse than no example.
//
// This test scans every registered example, extracts every `--<flag>` token,
// and asserts each one is either a known global flag OR a flag declared on
// the spec. Catches typos, dropped flags, and renamed flags. Doesn't catch
// argument *value* errors (e.g. zone id "abc" instead of "12345") — those
// surface only at runtime against the real API.

import { describe, expect, it } from 'vitest';
import { registry } from '../../src/manifest/registry.js';

// Global flags wired in src/cli.ts directly (not in spec.flags). Plus the
// `--help-json` flag that cli.ts adds to every leaf for AI agents.
const GLOBAL_FLAGS = new Set([
  'config',
  'cwd',
  'env',
  'profile',
  'help',
  'version',
  'help-json',
]);

// Strip the `no-` prefix Commander uses for boolean negation. A spec flag
// named `force-ssl` is referenced as `--no-force-ssl` in examples to set
// it false — both forms must resolve to the same spec entry.
function normalizeFlag(name: string): string {
  return name.startsWith('no-') ? name.slice(3) : name;
}

describe('examples parse', () => {
  it('every example flag exists on its command spec or is global', () => {
    const failures: string[] = [];

    for (const cmd of registry.commands) {
      if (!cmd.examples || cmd.examples.length === 0) continue;
      const knownFlags = new Set(
        (cmd.flags ?? []).map((f) => f.name),
      );
      // Also add the negation form for every flag — examples may use either.
      for (const f of cmd.flags ?? []) {
        knownFlags.add(`no-${f.name}`);
      }

      for (const ex of cmd.examples) {
        // Match `--<flag>` and `--<flag>=<value>` and `--<flag> <value>`.
        const matches = [...ex.command.matchAll(/--([a-z][a-z0-9-]*)/g)];
        for (const m of matches) {
          const raw = m[1] ?? '';
          if (raw.length === 0) continue;
          if (GLOBAL_FLAGS.has(raw)) continue;
          if (knownFlags.has(raw)) continue;
          // Allow `--no-<flag>` even if spec has plain `<flag>`.
          if (knownFlags.has(normalizeFlag(raw))) continue;
          failures.push(
            `[${cmd.name}] example "${ex.command}" references unknown flag --${raw}`,
          );
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it('every example starts with the binary name', () => {
    const failures: string[] = [];
    for (const cmd of registry.commands) {
      for (const ex of cmd.examples ?? []) {
        if (!ex.command.startsWith(`${registry.binary} `) && ex.command !== registry.binary) {
          // Allow bootstrap snippets like `claude mcp add bunny-tools -- npx -y bunny-tools mcp`.
          if (!ex.command.includes(`${registry.binary}`)) {
            failures.push(`[${cmd.name}] example does not reference binary: "${ex.command}"`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('every `bunny ...` example invokes the command it documents', () => {
    const failures: string[] = [];
    for (const cmd of registry.commands) {
      for (const ex of cmd.examples ?? []) {
        if (!ex.command.startsWith(`${registry.binary} `) && ex.command !== registry.binary) continue;
        const invoked = ex.command.slice(registry.binary.length).trim();
        if (invoked !== cmd.name && !invoked.startsWith(`${cmd.name} `)) {
          failures.push(`[${cmd.name}] example runs a different command: "${ex.command}"`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('every example has a non-empty description', () => {
    const failures: string[] = [];
    for (const cmd of registry.commands) {
      for (const ex of cmd.examples ?? []) {
        if (!ex.description || ex.description.trim().length === 0) {
          failures.push(`[${cmd.name}] example "${ex.command}" has no description`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  // rc.51: bound summary length so the COMMANDS row in --help doesn't wrap
  // mid-description on standard terminals. Combined with the longest plausible
  // left column (`bunny cdn hostname add <pullZone> <hostname>` = 44)
  // plus 2-char indent + 2-char gap, a 90-char summary keeps every row under
  // 144 chars — fits comfortably in 100-col terminals (the modern floor) with
  // headroom for column shifts.
  //
  // Original offender: the hostname-add command shipped a 164-char summary
  // that explained the --no-force-ssl negation inline. Detail moved into
  // the leaf's flag descriptions (already documented there).
  const SUMMARY_MAX = 90;
  it(`every command summary fits in ${SUMMARY_MAX} chars`, () => {
    const failures: string[] = [];
    for (const cmd of registry.commands) {
      if (cmd.summary.length > SUMMARY_MAX) {
        failures.push(`[${cmd.name}] summary is ${cmd.summary.length} chars (max ${SUMMARY_MAX}): "${cmd.summary.slice(0, 80)}..."`);
      }
    }
    expect(failures).toEqual([]);
  });
});
