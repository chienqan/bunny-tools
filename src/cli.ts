#!/usr/bin/env node
// Registry-driven CLI entry. Builds the Commander tree from src/manifest/registry.ts;
// no command is hand-wired here. Lazy-loads command implementations only when invoked.

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { registry } from './manifest/registry.js';
import { formatHelp } from './manifest/format-help.js';
import { renderCommandHelpJson, renderRegistryHelpJson } from './manifest/render-help.js';
import type { CommandSpec, ParsedInvocation } from './manifest/types.js';
import { logger } from './util/logger.js';
import { formatBunnyError as formatError } from './api/errors.js';

function buildProgram(): Command {
  const program = new Command(registry.binary);
  program
    .description(registry.description)
    .version(registry.version, '-v, --version', 'Show CLI version.')
    .helpOption('-h, --help', 'Show help for command.')
    .showHelpAfterError(true)
    // Wrangler-style help layout: TITLE → USAGE → COMMANDS (grouped by domain)
    // → GLOBAL FLAGS. Cascades to all subcommands so leaf and group help pages
    // share the visual language.
    .configureHelp({ formatHelp })
    // Wrangler-style global flags. Applied via env vars + chdir in preAction hook.
    .option('-c, --config <path>', 'Path to a bunny.json config (overrides walk-up search).')
    .option('--cwd <dir>', 'Run as if launched from this directory.')
    .option('-e, --env <alias>', 'One-shot .bunnyrc alias (no need for `bunny use` first).')
    .option('-p, --profile <name>', 'One-shot credential profile (overrides active). See `bunny configure list`.');

  // Bare `bunny` (no subcommand) prints help on stdout with exit 0 - matches
  // wrangler / firebase-tools / aws-cli convention so users can pipe the output
  // (`bunny | grep deploy`) and CI scripts can detect "no command" without a
  // failure. Commander's default for no-args + has-subcommands is help on
  // stderr + exit 1, which breaks both.
  // An unknown command (e.g. a 0.1.x name like `storagezone`) lands here too;
  // that must fail with exit 1 so scripts notice, not print help and succeed.
  program.action(() => {
    if (program.args.length > 0) {
      const typed = program.args.join(' ');
      const hint = renamedCommandHint(program.args);
      process.stderr.write(
        `Unknown command "${typed}".${hint ? ` ${hint}` : ''} Run \`${registry.binary} --help\` to see all commands.\n`,
      );
      process.exit(1);
    }
    program.outputHelp();
    process.exit(0);
  });

  // Apply global flags BEFORE any leaf action runs. chdir first so subsequent
  // config search uses the new cwd. Other flags become env vars consumed by
  // the loaders downstream.
  program.hook('preAction', (thisCmd) => {
    const opts = thisCmd.optsWithGlobals();
    if (typeof opts['cwd'] === 'string' && opts['cwd'].length > 0) {
      process.chdir(opts['cwd']);
    }
    if (typeof opts['config'] === 'string' && opts['config'].length > 0) {
      process.env['BUNNY_CONFIG_PATH'] = opts['config'];
    }
    if (typeof opts['env'] === 'string' && opts['env'].length > 0) {
      process.env['BUNNY_ALIAS'] = opts['env'];
    }
    if (typeof opts['profile'] === 'string' && opts['profile'].length > 0) {
      process.env['BUNNY_PROFILE'] = opts['profile'];
    }
  });

  for (const cmd of registry.commands) {
    registerCommand(program, cmd);
  }

  return program;
}

// Commands renamed in 0.2.0. Points users of old scripts at the new name.
const RENAMED_GROUPS: Record<string, string> = {
  storagezone: 'storage zone',
  'storage-zone': 'storage zone',
  pullzone: 'cdn',
  'pull-zone': 'cdn',
};

function renamedCommandHint(args: string[]): string | null {
  const [first] = args;
  if (!first || !(first in RENAMED_GROUPS)) return null;
  const rest = args.slice(1).join(' ').replace(/\bedge-?rule\b/, 'rule');
  return `It was renamed: try \`${registry.binary} ${RENAMED_GROUPS[first]}${rest ? ` ${rest}` : ''}\`.`;
}

// Group metadata (description + optional aliases) keyed by space-delimited path.
const groupMetaByPath = new Map<string, { description: string; aliases: string[] }>();
for (const g of registry.groups ?? []) {
  groupMetaByPath.set(g.name, { description: g.description, aliases: g.aliases ?? [] });
}

// Walk the space-delimited name and create intermediate group commands as needed.
// Example: "cdn rule add" → cdn (group) → rule (group) → add (leaf).
function registerCommand(root: Command, spec: CommandSpec): void {
  const parts = spec.name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return;

  let parent: Command = root;
  let groupPath = '';
  for (let i = 0; i < parts.length - 1; i++) {
    const groupName = parts[i]!;
    groupPath = groupPath ? `${groupPath} ${groupName}` : groupName;
    let group = parent.commands.find((c) => c.name() === groupName);
    if (!group) {
      const meta = groupMetaByPath.get(groupPath);
      const description = meta?.description ?? `${groupName} commands`;
      group = parent
        .command(groupName)
        .description(description)
        .helpOption('-h, --help', 'Show help for command.');
      // Group-level aliases. Each alias is a single segment (the alternative name
      // for THIS group level). Each group level has its own aliases;
      // Commander walks each segment.
      if (meta?.aliases) {
        const seen = new Set<string>([groupName]);
        for (const alias of meta.aliases) {
          if (alias.length === 0 || seen.has(alias)) continue;
          group.alias(alias);
          seen.add(alias);
        }
      }
    }
    parent = group;
  }

  const leaf = parts[parts.length - 1]!;
  const cmd = parent.command(leaf).description(spec.summary);

  // Register Commander aliases. These don't appear in `--help`; both forms route to the same action.
  if (spec.aliases && spec.aliases.length > 0) {
    for (const alias of spec.aliases) {
      cmd.alias(alias);
    }
  }

  for (const arg of spec.args ?? []) {
    const decoration = arg.variadic ? '...' : '';
    cmd.argument(arg.required ? `<${arg.name}${decoration}>` : `[${arg.name}${decoration}]`, arg.description);
  }

  for (const flag of spec.flags ?? []) {
    const long = flag.short ? `-${flag.short}, --${flag.name}` : `--${flag.name}`;
    const decl = flag.hasValue ? `${long} <${flag.valueHint ?? 'value'}>` : long;
    if (flag.defaultValue !== undefined) {
      // Commander accepts string | boolean | string[] for option defaults; cast through unknown
      // rather than `never` so future non-boolean defaults don't get silently coerced.
      cmd.option(decl, flag.description, flag.defaultValue as string | boolean | string[]);
    } else {
      cmd.option(decl, flag.description);
    }
  }

  // Reserved flag for AI agents and scripts: emits JSON-shaped help instead of text.
  // Distinct from Commander's `--help`; future per-command `--json` output flags can coexist.
  cmd.option('--help-json', 'Emit help as JSON (for AI agents and scripting).');

  cmd.action(async (...rawArgs) => {
    const cmdInstance = rawArgs[rawArgs.length - 1] as Command;
    const opts = cmdInstance.opts();
    // Commander v12 invokes the action callback with: positional args (one slot
    // per declared argument, `undefined` if missing), then the parsed options
    // object, then the command instance. Slicing by the declared arg count
    // keeps just the positionals - the prior `slice(0, -1).filter(!= undefined)`
    // dropped only the command and let the options object leak into `args`,
    // mis-assigning it to the first positional slot when an optional arg was
    // omitted (e.g. `bunny storage ls` with no target).
    const positional = rawArgs.slice(0, (spec.args ?? []).length);

    if (opts['helpJson'] === true) {
      process.stdout.write(JSON.stringify(renderCommandHelpJson(spec), null, 2) + '\n');
      return;
    }

    if (spec.status !== 'active' || !spec.load) {
      process.stderr.write(
        `\`${registry.binary} ${spec.name}\` is planned for Phase ${spec.phase}. Not yet implemented.\n`,
      );
      process.exit(2);
    }

    try {
      const mod = await spec.load();
      const invocation: ParsedInvocation = {
        args: zipArgs(spec, positional),
        flags: opts,
        raw: process.argv.slice(2),
      };
      const code = await mod.run(invocation);
      if (typeof code === 'number' && code !== 0) process.exit(code);
    } catch (err) {
      logger.error(formatError(err));
      process.exit(1);
    }
  });
}

// formatError is imported at the top of the file (formatBunnyError aliased)
// so command handlers can reuse the same enrichment.

function zipArgs(spec: CommandSpec, positional: unknown[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const args = spec.args ?? [];
  for (let i = 0; i < args.length; i++) {
    const def = args[i];
    if (!def) continue;
    // Commander hands a variadic argument over as one array in its own slot.
    out[def.name] = def.variadic ? ((positional[i] as unknown[] | undefined) ?? []) : positional[i];
  }
  return out;
}

// Expose a helper for tests / introspection that doesn't trigger argv parsing.
export function getRegistryHelpJson() {
  return renderRegistryHelpJson(registry);
}

// `import.meta.url === \`file://${process.argv[1]}\`` was the previous main-detection
// shorthand, but it fails for symlinked binaries. When users install via
// `npm install -g`, `process.argv[1]` is the symlink path (e.g.
// `/opt/homebrew/bin/bunny`) while `import.meta.url` resolves to the real file
// (e.g. `/opt/homebrew/lib/node_modules/bunny-tools/dist/cli.js`). The strings
// never matched, so the CLI exited silently with no output. Resolving both to
// real paths via realpathSync handles the symlink hop.
function isCalledAsMain(): boolean {
  const argv1 = process.argv[1];
  if (typeof argv1 !== 'string' || argv1.length === 0) return false;
  try {
    return realpathSync(argv1) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isCalledAsMain()) {
  const program = buildProgram();
  program.parseAsync(process.argv).catch((err) => {
    logger.error((err as Error).message);
    process.exit(1);
  });
}

export { buildProgram };
