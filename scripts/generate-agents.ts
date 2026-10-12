// Generate AGENTS.md from the registry. AI agents read this to learn the CLI
// without parsing prose. Hand-curated sections (between the markers below)
// are preserved on regeneration; automated sections are overwritten.

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { registry } from '../src/manifest/registry.js';
import { summarizeRegistry } from '../src/manifest/render-help.js';

const OUT = resolve(process.cwd(), 'AGENTS.md');
const HC_START = '<!-- HANDCURATED:START -->';
const HC_END = '<!-- HANDCURATED:END -->';

async function existingHandcurated(): Promise<string> {
  try {
    const raw = await readFile(OUT, 'utf8');
    const start = raw.indexOf(HC_START);
    const end = raw.indexOf(HC_END);
    if (start === -1 || end === -1 || end < start) return defaultHandcurated();
    return raw.slice(start + HC_START.length, end).trim();
  } catch {
    return defaultHandcurated();
  }
}

// Used only when AGENTS.md has no hand-curated markers yet.
function defaultHandcurated(): string {
  return [
    '## Quickstart for AI agents',
    '',
    '1. Check credentials: `bunny whoami --json`. If no account key is stored, ask the user to run `bunny configure` (paste the API key from dash.bunny.net → Account → API) or set `BUNNY_API_KEY`. That one key is all bunny-tools needs.',
    '2. Explore: `bunny storage ls` (storage zones), `bunny cdn list` (pull zones), `bunny dns list` (DNS zones). Add `--json` when you need to parse output.',
    '3. Deploy a static site: if there is no `bunny.json`, run `bunny init`. Then `bunny deploy --dry-run --json`, review, and `bunny deploy --json`.',
    '',
    '## Mental model',
    '',
    '- **One credential.** The account API key reads every storage zone password and Stream library key, so bunny-tools fetches those on demand. Never ask the user for a zone password. Explicit keys (`BUNNY_STORAGE_PASSWORD_<ZONE>`, `BUNNY_STREAM_KEY_<ID>`, keychain) still win when present, which is how CI without an account key works.',
    '- **Grammar.** `bunny <resource> [<sub-resource>] <verb> [args] [flags]`. Verbs are `list` (alias `ls`), `get`, `create`, `update`, `delete` (alias `rm`). Storage file commands use `ls`/`rm` like a shell.',
    '- **Addressing.** Storage paths are `<zone>/<path>` (aws-s3 style). Pull zones, storage zones, Stream libraries, scripts and container apps accept a **name or numeric id**. DNS zones accept the **domain or id**.',
    '- **Project config.** `bunny.json` (git-tracked) drives `deploy` and bare `purge`. `.bunnyrc` holds per-developer aliases (`bunny use <alias>`, or one-shot `-e <alias>`). Profiles (`bunny configure --profile`, `-p <name>`) hold credentials for multiple accounts.',
    '',
    '## Output and exit-code contract',
    '',
    '- stdout carries only the result. Every command that prints a result accepts `--json`; mutations print the resulting object with `--json`.',
    '- stderr carries progress, prompts and human success lines. Safe to ignore when parsing.',
    '- Exit codes: `0` success, `1` error / bad input / aborted confirmation, `2` partial failure (some uploads or purges failed).',
    '- Destructive commands (`delete`, `rm`) need `--yes` (`-y`) in non-interactive shells. `BUNNY_NONINTERACTIVE=1` forces non-interactive mode.',
    '- Machine-readable help: `bunny manifest` (whole registry) or `bunny <command> --help-json`.',
    '',
    '## Common tasks',
    '',
    '| Goal | Command |',
    '| --- | --- |',
    '| List storage zones | `bunny storage ls` |',
    '| List files in a zone | `bunny storage ls my-zone/assets -r --json` |',
    '| Upload / download a file | `bunny storage upload ./a.png my-zone/img/` · `bunny storage download my-zone/img/a.png` |',
    '| Delete files | `bunny storage rm my-zone/old/ -r --yes` |',
    '| Mirror a folder (no purge) | `bunny storage sync ./public my-zone/` |',
    '| Deploy site + purge CDN | `bunny deploy` |',
    '| Purge CDN | `bunny purge https://cdn.example.com/app.js` · `bunny purge --pull-zone my-site [--tag app]` |',
    '| Custom domain with SSL | `bunny domain connect my-site example.com --dns-zone example.com` |',
    '| DNS record | `bunny dns record add example.com A www 1.2.3.4` |',
    '| Edge rule | `bunny cdn rule add my-site --rule \'<json>\'` |',
    '| Edge script | `bunny scripting deploy my-script --file ./build/index.js` |',
    '',
    '## Gotchas',
    '',
    '- Bunny has 4 credential types (account, storage zone, stream library, database), all sent as the `AccessKey` header. bunny-tools picks the right one per call.',
    '- Storage uses 8 regional endpoints; the region is resolved per zone automatically (`--region` skips the lookup).',
    '- Keep fewer than 10,000 files per storage directory.',
    '- Tag purge needs the origin to send a `Cache-Tag` header. Without it, purge the whole zone.',
    '- `PULLZONE` DNS records fail unless the hostname is linked to the pull zone with a certificate. `bunny domain connect` does all of it in one idempotent call.',
    '- Storage zone and Stream library outputs never include passwords or API keys.',
    '',
    '## Architecture map (for agents editing this repo)',
    '',
    '```',
    'src/cli.ts            Commander tree built from the registry (no hand-wired commands)',
    'src/manifest/         registry.ts = single source of truth for every command, flag, example',
    'src/commands/<path>   one file per command, mirrors the command path (storage/zone/list.ts)',
    'src/mcp/tools.ts      MCP tools, call core directly',
    'src/core/             business logic, UI-free (storage-ops, zones, dns, purge, resolve, ...)',
    'src/api/              thin Bunny REST clients + HTTP retry + typed errors',
    'src/config/           bunny.json, .bunnyrc, credential resolver (flag → env → keychain → file)',
    'src/ui/               progress (stderr), prompts, tables, shared output contract (ui/output.ts)',
    '```',
    '',
    'Rule: `commands/` and `mcp/` call `core/`, never `api/` (ESLint enforced). Full walkthrough with request flows and "how to add a command": [`docs/system-architecture.md`](docs/system-architecture.md).',
    '',
    '## MCP usage',
    '',
    '`bunny mcp` boots an MCP stdio server whose tools mirror the CLI (`bunny.storage_ls`, `bunny.cdn_hostname_add`, `bunny.dns_record_add`, ...) plus `bunny.run` as an escape hatch for any CLI invocation. Install for Claude Code with:',
    '',
    '```bash',
    'claude mcp add bunny-tools npx -y bunny-tools mcp',
    '```',
  ].join('\n');
}

// `bunny storage ls [target]` style signature from the spec's args.
function signature(c: (typeof registry.commands)[number]): string {
  const args = (c.args ?? []).map((a) => {
    const name = `${a.name}${a.variadic ? '...' : ''}`;
    return a.required ? `<${name}>` : `[${name}]`;
  });
  return [registry.binary, c.name, ...args].join(' ');
}

// Group by top-level resource so agents can scan one domain at a time.
// Single commands without a group (init, deploy, purge, ...) go under "Core".
function autoCommandTree(): string {
  const lines: string[] = ['## Command tree (auto-generated)', ''];
  const groupDesc = new Map((registry.groups ?? []).map((g) => [g.name, g.description]));
  const sections = new Map<string, typeof registry.commands>();
  for (const c of registry.commands) {
    const top = c.name.split(' ')[0]!;
    const key = c.name.includes(' ') || groupDesc.has(top) ? top : 'Core';
    if (!sections.has(key)) sections.set(key, []);
    sections.get(key)!.push(c);
  }
  const order = ['Core', ...[...sections.keys()].filter((k) => k !== 'Core')];
  for (const key of order) {
    const cmds = sections.get(key);
    if (!cmds) continue;
    const desc = key === 'Core' ? 'Setup, deploy, purge and discovery.' : (groupDesc.get(key) ?? '');
    lines.push(`### ${key === 'Core' ? 'Core' : `\`${registry.binary} ${key}\``}`, '', desc, '');
    for (const c of cmds) {
      const status = c.status === 'active' ? '' : c.status === 'deprecated' ? ' [deprecated]' : ' [planned]';
      const aliases = c.aliases?.length ? ` (alias: ${c.aliases.join(', ')})` : '';
      const mcp = c.mcp ? ` _mcp: \`${c.mcp.tool}\`_` : '';
      lines.push(`- \`${signature(c)}\`${status}${aliases} — ${c.summary}${mcp}`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

const stats = summarizeRegistry(registry);
const handcurated = await existingHandcurated();
const out = [
  `# AGENTS.md — bunny-tools`,
  '',
  `${registry.description}`,
  '',
  `**Binary:** \`${registry.binary}\`  |  **Version:** ${registry.version}  |  **Active commands:** ${stats.active}/${registry.commands.length}`,
  '',
  HC_START,
  '',
  handcurated,
  '',
  HC_END,
  '',
  autoCommandTree(),
  '',
  '---',
  '',
  '_Generated from `src/manifest/registry.ts` by `npm run gen:agents`. Do not edit auto sections by hand._',
  '',
].join('\n');

await writeFile(OUT, out, 'utf8');
process.stdout.write(`generated ${OUT}\n`);
