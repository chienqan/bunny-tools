// Wrangler-style help renderer. Replaces Commander's default help layout:
//
//   Default: USAGE → DESCRIPTION → OPTIONS → COMMANDS
//   Custom:  TITLE → DESCRIPTION → [USAGE on leaves] → COMMANDS/FLAGS → GLOBAL FLAGS
//
// rc.44: title and description on separate lines (was em-dash one-liner),
// matching wrangler's visual hierarchy. USAGE block dropped on groups/root
// because `<subcommand> [args] [flags]` is pure boilerplate when the
// COMMANDS section already lists every runnable command. USAGE retained on
// leaves where it carries the positional-arg signature.
//
// Commander invokes `formatHelp(cmd, helper)` for every help invocation - // root, group, and leaf. We dispatch on the command's structure: commands
// with subcommands render the COMMANDS block; leaves render USAGE + FLAGS.
//
// No emoji. Wrangler uses them; bunny-tools is text-only for accessibility
// and grep-friendliness.
//
// The help block emitted here always lands on stdout when called via
// `program.outputHelp()` and respects `NO_COLOR` (Commander's default).

import type { Command, Help } from 'commander';
import pc from 'picocolors';
import { registry } from './registry.js';
import type { CommandSpec } from './types.js';

// Bold section labels (USAGE / COMMANDS / FLAGS / EXAMPLES / GLOBAL FLAGS and
// the root sections). picocolors auto-disables for NO_COLOR + non-TTY, so this
// is grep-safe in pipes and scripts. wrangler/gh/aws all bold their labels - // it creates the visual zoning that lets the eye skip to the right block.
const label = (s: string): string => pc.bold(s);

// Root help is sectioned wrangler/gh/aws-style: GETTING STARTED for the daily
// workflow commands, SERVICES collapsing each top-level group to a single
// `bunny <group> <subcmd>` pointer (count appended), UTILITIES for the
// discovery + maintenance commands. Sub-groups (e.g. `pullzone hostname`)
// are folded INTO their parent service's count, not split into their own
// pointer rows - that pattern was fragmenting root help in rc.20–37.
//
// Sub-group help (e.g. `bunny cdn --help`) still expands every leaf
// - see renderGroupChildren.
const SECTIONS: Array<{ label: string; prefixes: string[] }> = [
  {
    label: 'GETTING STARTED',
    prefixes: ['init', 'deploy', 'configure'],
  },
  {
    label: 'SERVICES',
    prefixes: ['pullzone', 'domain', 'dns', 'stream', 'storage', 'storagezone', 'containers', 'scripting'],
  },
  {
    label: 'UTILITIES',
    prefixes: ['purge', 'use', 'whoami', 'docs', 'manifest', 'mcp', 'install', 'update'],
  },
];

// Gap between the command-name column and the description column. Each
// section auto-widens to its longest left + this gap; no minimum floor.
//
// rc.49: dropped the previous 40-char floor (NAME_COL_MIN). Was originally
// added so short rows aligned with long-arg rows in mixed sections, but
// per-section auto-width already handles that - the floor only ever
// padded sections where every row was short (e.g. root help where every
// entry collapses to `<subcmd>`), creating ~14 chars of dead whitespace.
// Matches wrangler/gh/aws conventions.
const NAME_COL_GAP = 2;

export function formatHelp(cmd: Command, _helper: Help): string {
  const isRoot = cmd.parent === null;
  const isGroup = cmd.commands.length > 0;
  if (isRoot || isGroup) return formatGroupOrRoot(cmd, isRoot);
  return formatLeaf(cmd);
}

function formatGroupOrRoot(cmd: Command, isRoot: boolean): string {
  const lines: string[] = [];
  // Title line - just the full command name. Description follows on its own
  // line below (wrangler-style two-line header). USAGE is omitted at this
  // level since `<subcommand> [args] [flags]` is boilerplate; the COMMANDS
  // block already enumerates runnable commands.
  const fullName = isRoot ? registry.binary : commandFullName(cmd);
  const desc = (cmd.description() || '').trim();
  lines.push(fullName);
  if (desc) {
    lines.push('');
    lines.push(desc);
  }
  lines.push('');

  // COMMANDS block. Root renders sectioned (GETTING STARTED / SERVICES /
  // UTILITIES) with each top-level group collapsed to a single
  // `bunny <group> <subcmd>` pointer + command count. Sub-group help still
  // expands every leaf so users can see all runnable commands one drill-down
  // from the root.
  if (isRoot) {
    const rendered = renderRootCommands();
    lines.push(...rendered);
  } else {
    lines.push(label('COMMANDS'));
    const groupPath = commandGroupPath(cmd);
    const rendered = renderGroupChildren(groupPath);
    lines.push(...rendered);
  }
  lines.push('');

  // GLOBAL FLAGS - same block on every help invocation; pulled from root.
  lines.push(label('GLOBAL FLAGS'));
  lines.push(...renderGlobalFlags());
  lines.push('');

  if (isRoot) {
    lines.push(`Run \`${registry.binary} <command> --help\` for more details on a command.`);
  } else {
    lines.push(`Run \`${fullName} <subcommand> --help\` for more details.`);
  }
  return lines.join('\n') + '\n';
}

function formatLeaf(cmd: Command): string {
  const lines: string[] = [];
  const fullName = commandFullName(cmd);
  const desc = (cmd.description() || '').trim();
  // Two-line header (wrangler-style): title on its own line, then a blank
  // line, then the description paragraph. USAGE retained on leaves because
  // the positional-arg signature is real signal for new users.
  lines.push(fullName);
  if (desc) {
    lines.push('');
    lines.push(desc);
  }
  lines.push('');

  // USAGE - show declared positional args inline.
  const argSig = cmd
    .registeredArguments
    .map((a) => (a.required ? `<${a.name()}>` : `[${a.name()}]`))
    .join(' ');
  lines.push(label('USAGE'));
  lines.push(`  ${fullName}${argSig ? ' ' + argSig : ''} [flags]`);
  lines.push('');

  // FLAGS - command-local options (not the inherited globals). Auto-width
  // (no NAME_COL_MIN floor): the longest flag + gap defines the column.
  // Floor was meant for COMMANDS rows where short-arg leaves should align
  // with long-arg ones; FLAGS doesn't have that asymmetry.
  const local = cmd.options.filter((o) => !o.hidden);
  if (local.length > 0) {
    lines.push(label('FLAGS'));
    const flagCol = local.reduce((m, o) => Math.max(m, o.flags.length), 0) + NAME_COL_GAP;
    for (const opt of local) {
      const left = opt.flags;
      const right = opt.description || '';
      lines.push('  ' + formatRow(left, right, flagCol));
    }
    lines.push('');
  }

  // EXAMPLES - only renders when the registry has examples for this leaf.
  // Format: `  $ <command>` then a wrapped, indented description below if
  // present. Mirrors `gh` / `aws` / `npm` example styling.
  const spec = findSpecByCommand(cmd);
  if (spec?.examples && spec.examples.length > 0) {
    lines.push(label('EXAMPLES'));
    for (const ex of spec.examples) {
      lines.push(`  ${pc.dim('$')} ${ex.command}`);
      if (ex.description) lines.push(`      ${pc.dim(ex.description)}`);
    }
    lines.push('');
  }

  // GLOBAL FLAGS - same as on root help.
  lines.push(label('GLOBAL FLAGS'));
  lines.push(...renderGlobalFlags());
  lines.push('');
  return lines.join('\n') + '\n';
}

// Resolve a Commander leaf back to its CommandSpec via space-joined name.
function findSpecByCommand(cmd: Command): CommandSpec | undefined {
  const path = commandGroupPath(cmd);
  return registry.commands.find((c) => c.name === path);
}

// Walk up the parent chain to assemble the canonical full name (e.g.
// `bunny cdn rule add`). Used in the title + USAGE lines.
function commandFullName(cmd: Command): string {
  const parts: string[] = [];
  let c: Command | null = cmd;
  while (c) {
    parts.unshift(c.name());
    c = c.parent;
  }
  return parts.join(' ');
}

// Same as commandFullName but without the binary prefix - for matching against
// registry command names.
function commandGroupPath(cmd: Command): string {
  const parts: string[] = [];
  let c: Command | null = cmd;
  while (c && c.parent) {
    parts.unshift(c.name());
    c = c.parent;
  }
  return parts.join(' ');
}

// Sectioned root help: GETTING STARTED / SERVICES / UTILITIES. Each top-level
// group (pullzone, dns, stream, etc.) collapses to ONE pointer row at root
// - `bunny <group> <subcmd>     <description> (N cmds)`. Sub-groups
// (pullzone hostname, dns record, etc.) fold INTO the parent count rather
// than getting their own pointer line.
//
// Section labels are emitted at column 0 (no indent); command rows are
// indented 2 spaces to keep the section header visually distinct.
function renderRootCommands(): string[] {
  const active = registry.commands.filter((c) => c.status === 'active');
  const groupMeta = new Map((registry.groups ?? []).map((g) => [g.name, g]));
  const out: string[] = [];

  // Two-pass: bucket every section first, gather ALL command lefts across
  // the whole COMMANDS block, compute ONE column width. Reads as a single
  // visual block - descriptions land at the same column whether the row
  // is in GETTING STARTED, SERVICES, or UTILITIES.
  //
  // rc.50: was per-section in rc.49. Three sections produced a staircase
  // (col 28 / 30 / 26) that's hard to scan. GLOBAL FLAGS still has its
  // own width - that's a different block (flags vs commands).
  type SectionBucket = {
    section: (typeof SECTIONS)[number];
    byTop: Map<string, CommandSpec[]>;
  };
  const buckets: SectionBucket[] = [];
  const allLefts: string[] = [];

  for (const section of SECTIONS) {
    const byTop = new Map<string, CommandSpec[]>();
    for (const cmd of active) {
      if (!belongsToGroup(cmd.name, section.prefixes)) continue;
      const top = cmd.name.split(/\s+/)[0]!;
      if (!byTop.has(top)) byTop.set(top, []);
      byTop.get(top)!.push(cmd);
    }
    if (byTop.size === 0) continue;
    buckets.push({ section, byTop });

    for (const top of section.prefixes) {
      const cmds = byTop.get(top);
      if (!cmds || cmds.length === 0) continue;
      const bareCmd = cmds.find((c) => c.name === top);
      if (cmds.length === 1 && bareCmd) {
        allLefts.push(commandRowLeft(bareCmd));
      } else {
        allLefts.push(`${registry.binary} ${top} <subcmd>`);
      }
    }
  }
  const colWidth = groupColWidth(allLefts);

  for (let i = 0; i < buckets.length; i++) {
    if (i > 0) out.push('');
    const { section, byTop } = buckets[i]!;
    out.push(label(section.label));
    for (const top of section.prefixes) {
      const cmds = byTop.get(top);
      if (!cmds || cmds.length === 0) continue;
      const bareCmd = cmds.find((c) => c.name === top);
      if (cmds.length === 1 && bareCmd) {
        out.push('  ' + formatCommandRow(bareCmd, colWidth));
        continue;
      }
      const meta = groupMeta.get(top);
      const desc = meta?.description ?? bareCmd?.summary ?? `${top} commands`;
      const tag = ` (${cmds.length} ${cmds.length === 1 ? 'cmd' : 'cmds'})`;
      out.push(
        '  ' + formatRow(`${registry.binary} ${top} <subcmd>`, desc + tag, colWidth),
      );
    }
  }
  return out;
}

function belongsToGroup(commandName: string, prefixes: string[]): boolean {
  return prefixes.some((p) => commandName === p || commandName.startsWith(p + ' '));
}

// Group help (e.g. `bunny stream --help`, `bunny cdn --help`): list
// ALL leaf descendants of this group regardless of depth. Earlier behaviour
// stopped at immediate leaves + sub-group pointers, but that left groups
// like `stream` (no direct leaves, only `library` / `video` subgroups)
// showing nothing actionable - users had to drill twice to find a runnable
// command. Showing every descendant collapses that into one help page.
//
// Long arg signatures (e.g. `bunny cdn rule delete <pullZone>
// <ruleGuid>`) may overflow the alignment column at this level; that's
// acceptable here - root help is where alignment matters most, and root
// already collapses 3+ segment commands to subgroup pointers.
function renderGroupChildren(groupPath: string): string[] {
  const active = registry.commands.filter((c) => c.status === 'active');
  const matches = active.filter((c) => c.name.startsWith(groupPath + ' '));
  // Pick the column width that fits the longest left in the group so every
  // description aligns within the section.
  const colWidth = groupColWidth(matches.map((c) => commandRowLeft(c)));
  return matches.map((c) => '  ' + formatCommandRow(c, colWidth));
}

// Format a single command row with a left "name + args" column and a right
// "description" column, padded for column alignment. Callers always pass
// `colWidth` from a section-level groupColWidth() - the default is just a
// safety floor for any orphan caller.
function formatCommandRow(spec: CommandSpec, colWidth: number = 0): string {
  const argSig = (spec.args ?? [])
    .map((a) => (a.required ? `<${a.name}>` : `[${a.name}]`))
    .join(' ');
  const left = `${registry.binary} ${spec.name}${argSig ? ' ' + argSig : ''}`;
  return formatRow(left, spec.summary, colWidth);
}

function formatRow(left: string, right: string, colWidth: number = 0): string {
  if (right.length === 0) return left;
  const pad = Math.max(colWidth - left.length, 1);
  return `${left}${' '.repeat(pad)}${right}`;
}

// Section column width: longest left + gap. No floor - short-row sections
// (e.g. root help where every entry is `bunny <group> <subcmd>`) get a
// tight column instead of being padded to a global minimum.
function groupColWidth(lefts: string[]): number {
  const longest = lefts.reduce((m, l) => Math.max(m, l.length), 0);
  return longest + NAME_COL_GAP;
}

// Build the left-column string for a CommandSpec - same shape as
// formatCommandRow uses, exposed so callers can compute group col width
// before rendering.
function commandRowLeft(spec: CommandSpec): string {
  const argSig = (spec.args ?? [])
    .map((a) => (a.required ? `<${a.name}>` : `[${a.name}]`))
    .join(' ');
  return `${registry.binary} ${spec.name}${argSig ? ' ' + argSig : ''}`;
}

// Global flags are declared once on the root program; we mirror them here so
// every help invocation shows the same block. Source order matches the cli.ts
// definitions to keep the help and the actual flag wiring in sync.
function renderGlobalFlags(): string[] {
  const flags: Array<[string, string]> = [
    ['-c, --config <path>', 'Path to a bunny.json config (overrides walk-up search).'],
    ['    --cwd <dir>', 'Run as if launched from this directory.'],
    ['-e, --env <alias>', 'One-shot .bunnyrc alias (no need for `bunny use` first).'],
    ['-p, --profile <name>', 'One-shot credential profile (overrides active).'],
    ['-h, --help', 'Show help for command.'],
    ['-v, --version', 'Show CLI version.'],
  ];
  // Auto-width: longest flag + gap, no NAME_COL_MIN floor. The global-flags
  // block is short and uniform, so extra padding here just creates whitespace.
  const colWidth = flags.reduce((m, [l]) => Math.max(m, l.length), 0) + NAME_COL_GAP;
  return flags.map(([left, right]) => '  ' + formatRow(left, right, colWidth));
}
