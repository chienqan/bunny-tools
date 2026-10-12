// Canonical command registry. ADD commands here; do NOT scatter command
// definitions across files. Generators and the CLI both read this list.
//
// Naming rules (keep new commands consistent):
//   bunny <resource> [<sub-resource>] <verb> <args>
//   verbs: list (alias ls), get, create, update, delete (alias rm); storage files use ls/rm
//   resource refs accept a name/domain or a numeric id; storage paths are <zone>/<path>
//   every command that prints a result supports --json; destructive ones need --yes when non-interactive

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CommandSpec, Registry } from './types.js';

// Single source of truth for version: package.json. Hardcoding here drifted
// (registry stuck at rc.43 across rc.44/45/46 RCs); reading at module load
// keeps `bunny --version`, `bunny manifest`, AGENTS.md, and MCP server
// initialize all in sync without per-RC bumps in two places.
//
// Using fs.readFileSync instead of `import ... with { type: 'json' }` so
// the package keeps its declared Node 20+ floor - `with` import attributes
// stabilized in Node 22.
const PKG_PATH = fileURLToPath(new URL('../../package.json', import.meta.url));
const VERSION = (JSON.parse(readFileSync(PKG_PATH, 'utf8')) as { version: string }).version;

export const registry: Registry = {
  cliName: 'bunny-tools',
  binary: 'bunny',
  version: VERSION,
  description: 'Bunny.net CLI - storage deploy, CDN purge, full resource management.',
  groups: [
    { name: 'configure', description: 'Store your Bunny API key and manage credential profiles.' },
    { name: 'storage', description: 'Files in storage zones, addressed as <zone>/<path> (ls/upload/download/rm/sync).' },
    { name: 'storage zone', description: 'Create, inspect and delete storage zones.' },
    { name: 'cdn', description: 'Pull zones (CDN): create/list/delete, edge rules, custom hostnames.' },
    { name: 'cdn rule', description: 'Edge rules on a pull zone.' },
    { name: 'cdn hostname', description: 'Custom hostnames (with free SSL) on a pull zone.' },
    { name: 'domain', description: 'Connect a domain to a pull zone in one step.' },
    { name: 'dns', description: 'DNS zones (by domain) and their records.' },
    { name: 'dns record', description: 'Records within a DNS zone.' },
    { name: 'stream', description: 'Stream video libraries and videos.' },
    { name: 'stream library', description: 'Stream video libraries.' },
    { name: 'stream video', description: 'Videos within a Stream library.' },
    { name: 'containers', description: 'Magic Containers apps.' },
    { name: 'scripting', description: 'Edge Scripting deployments.' },
    { name: 'install', description: 'One-shot bootstrap helpers (MCP config, ...).' },
  ],
  commands: [
    // Phase 1
    {
      name: 'manifest',
      summary: 'Print the bunny-tools command registry as JSON.',
      description:
        'Outputs the canonical command registry. AI agents and tooling read this to discover commands without parsing prose. Use --pretty for indented output.',
      flags: [
        {
          name: 'pretty',
          description: 'Indent the JSON output for readability.',
          hasValue: false,
          defaultValue: false,
        },
        {
          name: 'names',
          description: 'Emit one active command name per line (rc.10).',
          hasValue: false,
          defaultValue: false,
        },
      ],
      examples: [
        { command: 'bunny manifest', description: 'Compact JSON to stdout.' },
        { command: 'bunny manifest --pretty', description: 'Pretty-printed JSON.' },
        { command: 'bunny manifest --names', description: 'One command name per line.' },
      ],
      mcp: { tool: 'bunny.manifest', description: 'Returns the full bunny-tools registry as JSON.' },
      status: 'active',
      phase: 1,
      load: () => import('../commands/manifest.js'),
    },

    // Phase 2 - daily-use deploy loop
    {
      name: 'init',
      summary: 'Initialize bunny.json + creds. Auth → feature multi-select → per-feature config.',
      args: [{ name: 'dir', description: 'Optional target directory (defaults to cwd).', required: false }],
      flags: [
        { name: 'non-interactive', description: 'Skip prompts and accept all values via flags.', hasValue: false },
        { name: 'force', description: 'Overwrite existing bunny.json.', hasValue: false },
        { name: 'api-key', description: 'Bunny API key (skipped if env/keychain has one).', hasValue: true },
        { name: 'features', description: 'Comma-separated: storage,dns,stream,containers,scripting (or "all").', hasValue: true },
        { name: 'public-dir', description: 'Public directory to deploy (default: auto-detect).', hasValue: true },
        { name: 'storage-zone', description: 'Storage zone name (required for `storage` feature in non-interactive).', hasValue: true },
        { name: 'storage-password', description: 'Explicit storage zone password (optional; fetched with the API key otherwise).', hasValue: true },
        { name: 'region', description: 'Override region (ny|la|sg|syd|uk|se|br|jh).', hasValue: true },
        { name: 'pull-zone', description: 'Pull zone id for CDN purge.', hasValue: true },
        { name: 'purge', description: 'Purge strategy: all|none|tag:<name>.', hasValue: true },
        { name: 'stream-library', description: 'Stream library id (when `stream` feature selected).', hasValue: true },
        { name: 'stream-key', description: 'Stream library API key.', hasValue: true },
        { name: 'ci', description: 'Generate .github/workflows/bunny-deploy.yml after init (GitHub Actions).', hasValue: false },
      ],
      examples: [
        { command: 'bunny init', description: 'Interactive wizard with feature multi-select.' },
        {
          command: 'bunny init --non-interactive --features=storage --api-key=$KEY --storage-zone=my-app --pull-zone=12345',
          description: 'CI-friendly Storage+CDN setup.',
        },
        { command: 'bunny init --features=all --non-interactive ...', description: 'Enable every feature.' },
      ],
      mcp: { tool: 'bunny.init', description: 'Initialize a bunny.json (and creds if not set). Non-interactive shape.' },
      status: 'active',
      phase: 2,
      load: () => import('../commands/init.js'),
    },
    {
      name: 'configure',
      summary: 'Store your Bunny API key for a profile (zone passwords are then fetched automatically).',
      flags: [
        { name: 'non-interactive', description: 'Skip prompts; accept all values via flags.', hasValue: false },
        { name: 'profile', description: 'Profile name (default: active profile, or "default").', hasValue: true },
        { name: 'api-key', description: 'Bunny API key.', hasValue: true },
        { name: 'storage-zone', description: 'Pin an explicit password for this zone (with --storage-password). Rarely needed.', hasValue: true },
        { name: 'storage-password', description: 'Explicit storage zone password (optional; fetched automatically otherwise).', hasValue: true },
        { name: 'pull-zone', description: 'Default pull zone id.', hasValue: true },
        { name: 'stream-library', description: 'Stream library id.', hasValue: true },
        { name: 'stream-key', description: 'Stream library API key.', hasValue: true },
      ],
      examples: [
        { command: 'bunny configure', description: 'Walkthrough for the active profile.' },
        { command: 'bunny configure --profile=work', description: 'Set up the "work" profile.' },
        { command: 'bunny configure --non-interactive --profile=ci --api-key=$KEY', description: 'CI form.' },
      ],
      status: 'active',
      phase: 2,
      load: () => import('../commands/configure.js'),
    },
    {
      name: 'configure list',
      aliases: ['ls'],
      summary: 'List all credential profiles + stored scopes (masked). Active profile marked with *.',
      flags: [{ name: 'json', description: 'Emit JSON instead of a table.', hasValue: false }],
      status: 'active',
      phase: 2,
      load: () => import('../commands/configure/list.js'),
    },
    {
      name: 'configure switch',
      summary: 'Set the active credential profile.',
      args: [{ name: 'profile', description: 'Profile name to activate.', required: true }],
      status: 'active',
      phase: 2,
      load: () => import('../commands/configure/switch.js'),
    },
    {
      name: 'configure remove',
      summary: 'Remove a credential profile (entire) or a single scope within it.',
      flags: [
        { name: 'profile', description: 'Profile to remove (default: active).', hasValue: true },
        { name: 'scope', description: 'Remove only this scope (e.g. storage:my-app); else removes whole profile.', hasValue: true },
        { name: 'yes', description: 'Skip confirmation.', hasValue: false },
      ],
      status: 'active',
      phase: 2,
      load: () => import('../commands/configure/remove.js'),
    },
    {
      name: 'use',
      summary: 'Switch active alias from .bunnyrc; with no arg, list aliases.',
      args: [{ name: 'alias', description: 'Alias name (omit to list).', required: false }],
      flags: [
        { name: 'list', description: 'List aliases (default when no arg given).', hasValue: false },
        { name: 'json', description: 'Emit JSON instead of a table.', hasValue: false },
      ],
      status: 'active',
      phase: 2,
      load: () => import('../commands/use.js'),
    },
    {
      name: 'deploy',
      summary: 'Sync public dir to storage zone and purge CDN cache.',
      flags: [
        { name: 'dry-run', description: 'Plan and report without mutating remote.', hasValue: false },
        { name: 'delete', description: 'Delete orphan files on the remote.', hasValue: false },
        { name: 'concurrency', description: 'Parallel upload pool size.', hasValue: true, defaultValue: '8' },
        { name: 'purge', description: 'Override per-pull-zone purge: all|none|tag:<name>|paths.', hasValue: true },
        { name: 'only', description: 'Limit to a target (alias-scoped).', hasValue: true },
        { name: 'json', description: 'Emit JSON summary instead of a table.', hasValue: false },
        { name: 'verbose', description: 'Print Content-Type + size per file and full orphan list.', hasValue: false },
      ],
      examples: [
        { command: 'bunny deploy', description: 'Sync + purge per bunny.json.' },
        { command: 'bunny deploy --dry-run', description: 'Preview only.' },
        { command: 'bunny deploy --delete --concurrency=16', description: 'Aggressive sync.' },
      ],
      mcp: { tool: 'bunny.deploy' },
      status: 'active',
      phase: 2,
      load: () => import('../commands/deploy.js'),
    },
    {
      name: 'purge',
      summary: 'Purge CDN cache: URLs, a whole pull zone, or one Cache-Tag.',
      description:
        'With URLs, purges each URL. With --pull-zone, purges the whole zone (or only --tag). With no arguments, purges every pull zone listed in bunny.json.',
      args: [{ name: 'urls', description: 'Full URLs to purge.', required: false, variadic: true }],
      flags: [
        { name: 'pull-zone', description: 'Pull zone name or id to purge.', hasValue: true },
        { name: 'tag', description: 'Purge only this Cache-Tag (needs --pull-zone).', hasValue: true },
        { name: 'json', description: 'Emit JSON result.', hasValue: false },
      ],
      examples: [
        { command: 'bunny purge https://cdn.example.com/app.js', description: 'Purge one URL.' },
        { command: 'bunny purge --pull-zone my-site', description: 'Purge a whole pull zone.' },
        { command: 'bunny purge --pull-zone my-site --tag app', description: 'Purge one Cache-Tag.' },
        { command: 'bunny purge', description: 'Purge the pull zones configured in bunny.json.' },
      ],
      mcp: { tool: 'bunny.purge' },
      status: 'active',
      phase: 2,
      load: () => import('../commands/purge.js'),
    },

    // Phase 3 - storage (aws-s3 style `<zone>/<path>` addressing)
    {
      name: 'storage ls',
      summary: 'List storage zones (no argument) or files at <zone>/<path>.',
      description:
        'With no argument, lists every storage zone on the account. With `<zone>` or `<zone>/<path>`, lists that directory. Only the account API key is needed: zone passwords are fetched automatically.',
      aliases: ['list'],
      args: [{ name: 'target', description: '<zone> or <zone>/<path> (omit to list zones).', required: false }],
      flags: [
        { name: 'recursive', short: 'r', description: 'List every file below the path.', hasValue: false },
        { name: 'json', description: 'Emit JSON.', hasValue: false },
        { name: 'region', description: 'Skip region lookup (ny|la|sg|syd|uk|se|br|jh).', hasValue: true },
      ],
      examples: [
        { command: 'bunny storage ls', description: 'List all storage zones.' },
        { command: 'bunny storage ls my-zone', description: 'List the zone root.' },
        { command: 'bunny storage ls my-zone/assets -r --json', description: 'Recursive listing as JSON.' },
      ],
      mcp: { tool: 'bunny.storage_ls' },
      status: 'active',
      phase: 3,
      load: () => import('../commands/storage/ls.js'),
    },
    {
      name: 'storage upload',
      summary: 'Upload a local file to <zone>/<path>.',
      args: [
        { name: 'local', description: 'Local file path.', required: true },
        { name: 'target', description: '<zone>/<path>. A trailing slash keeps the local file name.', required: true },
      ],
      flags: [
        { name: 'json', description: 'Emit JSON result.', hasValue: false },
        { name: 'region', description: 'Skip region lookup.', hasValue: true },
      ],
      mcp: { tool: 'bunny.storage_upload' },
      examples: [
        { command: 'bunny storage upload ./logo.png my-zone/img/logo.png', description: 'Upload to an explicit path.' },
        { command: 'bunny storage upload ./logo.png my-zone/img/', description: 'Upload into a directory, keeping the name.' },
      ],
      status: 'active',
      phase: 3,
      load: () => import('../commands/storage/upload.js'),
    },
    {
      name: 'storage download',
      summary: 'Download <zone>/<path> to a local file.',
      args: [
        { name: 'target', description: '<zone>/<path> of the file.', required: true },
        { name: 'local', description: 'Local destination (default: remote file name in cwd).', required: false },
      ],
      flags: [
        { name: 'json', description: 'Emit JSON result.', hasValue: false },
        { name: 'region', description: 'Skip region lookup.', hasValue: true },
      ],
      examples: [{ command: 'bunny storage download my-zone/img/logo.png', description: 'Save as ./logo.png.' }],
      mcp: { tool: 'bunny.storage_download' },
      status: 'active',
      phase: 3,
      load: () => import('../commands/storage/download.js'),
    },
    {
      name: 'storage rm',
      summary: 'Delete a file (or a directory with -r) at <zone>/<path>.',
      aliases: ['delete'],
      args: [{ name: 'target', description: '<zone>/<path>. Zone roots are refused.', required: true }],
      flags: [
        { name: 'recursive', short: 'r', description: 'Delete every file below the path.', hasValue: false },
        { name: 'yes', short: 'y', description: 'Skip confirmation (required in non-interactive shells).', hasValue: false },
        { name: 'json', description: 'Emit JSON result.', hasValue: false },
        { name: 'region', description: 'Skip region lookup.', hasValue: true },
      ],
      examples: [
        { command: 'bunny storage rm my-zone/old.txt --yes', description: 'Delete one file.' },
        { command: 'bunny storage rm my-zone/tmp/ -r --yes', description: 'Delete a directory tree.' },
      ],
      mcp: { tool: 'bunny.storage_rm' },
      status: 'active',
      phase: 3,
      load: () => import('../commands/storage/rm.js'),
    },
    {
      name: 'storage sync',
      summary: 'Upload a local directory to <zone>[/<path>] (upload-only, no CDN purge).',
      args: [
        { name: 'local', description: 'Local directory.', required: true },
        { name: 'target', description: '<zone> or <zone>/<path>.', required: true },
      ],
      flags: [
        { name: 'concurrency', description: 'Parallel uploads.', hasValue: true, defaultValue: '8' },
        { name: 'json', description: 'Emit JSON result.', hasValue: false },
        { name: 'region', description: 'Skip region lookup.', hasValue: true },
      ],
      examples: [{ command: 'bunny storage sync ./public my-zone/', description: 'Mirror ./public into the zone root.' }],
      status: 'active',
      phase: 3,
      load: () => import('../commands/storage/sync.js'),
    },
    {
      name: 'storage zone list',
      summary: 'List storage zones with id, region, size and replication.',
      aliases: ['ls'],
      flags: [{ name: 'json', description: 'Emit JSON.', hasValue: false }],
      mcp: { tool: 'bunny.storage_zone_list' },
      status: 'active',
      phase: 3,
      load: () => import('../commands/storage/zone/list.js'),
    },
    {
      name: 'storage zone get',
      summary: 'Show one storage zone as JSON (passwords stripped).',
      args: [{ name: 'zone', description: 'Zone name or id.', required: true }],
      status: 'active',
      phase: 3,
      load: () => import('../commands/storage/zone/get.js'),
    },
    {
      name: 'storage zone create',
      summary: 'Create a storage zone.',
      args: [{ name: 'name', description: 'Zone name (lowercase letters, digits, hyphens).', required: true }],
      flags: [
        { name: 'region', description: 'Primary region (e.g. ny, la, sg).', hasValue: true },
        { name: 'replicate', description: 'Comma-separated replication regions.', hasValue: true },
        { name: 'tier', description: 'standard | edge.', hasValue: true },
        { name: 'json', description: 'Emit JSON result.', hasValue: false },
      ],
      examples: [{ command: 'bunny storage zone create my-zone --region sg', description: 'New zone in Singapore.' }],
      mcp: { tool: 'bunny.storage_zone_create' },
      status: 'active',
      phase: 3,
      load: () => import('../commands/storage/zone/create.js'),
    },
    {
      name: 'storage zone update',
      summary: 'Update a storage zone with a raw JSON body.',
      args: [{ name: 'zone', description: 'Zone name or id.', required: true }],
      flags: [
        { name: 'body', description: 'JSON body sent to Bunny.', hasValue: true },
        { name: 'json', description: 'Emit JSON result.', hasValue: false },
      ],
      status: 'active',
      phase: 3,
      load: () => import('../commands/storage/zone/update.js'),
    },
    {
      name: 'storage zone delete',
      summary: 'Delete a storage zone and all its files.',
      aliases: ['rm'],
      args: [{ name: 'zone', description: 'Zone name or id.', required: true }],
      flags: [
        { name: 'yes', short: 'y', description: 'Skip confirmation.', hasValue: false },
        { name: 'json', description: 'Emit JSON result.', hasValue: false },
      ],
      mcp: { tool: 'bunny.storage_zone_delete' },
      status: 'active',
      phase: 3,
      load: () => import('../commands/storage/zone/delete.js'),
    },

    // Phase 3 - CDN (pull zones). <pull-zone> accepts a name or numeric id.
    {
      name: 'cdn list',
      summary: 'List pull zones.',
      aliases: ['ls'],
      flags: [{ name: 'json', description: 'Emit JSON.', hasValue: false }],
      mcp: { tool: 'bunny.cdn_list' },
      status: 'active',
      phase: 3,
      load: () => import('../commands/cdn/list.js'),
    },
    {
      name: 'cdn get',
      summary: 'Show one pull zone as JSON.',
      args: [{ name: 'pullZone', description: 'Pull zone name or id.', required: true }],
      status: 'active',
      phase: 3,
      load: () => import('../commands/cdn/get.js'),
    },
    {
      name: 'cdn create',
      summary: 'Create a pull zone in front of an origin URL.',
      args: [{ name: 'name', description: 'Pull zone name.', required: true }],
      flags: [
        { name: 'origin', description: 'Origin URL (required).', hasValue: true },
        { name: 'json', description: 'Emit JSON result.', hasValue: false },
      ],
      examples: [{ command: 'bunny cdn create my-site --origin https://origin.example.com', description: 'New pull zone.' }],
      mcp: { tool: 'bunny.cdn_create' },
      status: 'active',
      phase: 3,
      load: () => import('../commands/cdn/create.js'),
    },
    {
      name: 'cdn update',
      summary: 'Update a pull zone with a raw JSON body.',
      args: [{ name: 'pullZone', description: 'Pull zone name or id.', required: true }],
      flags: [
        { name: 'body', description: 'JSON body sent to Bunny.', hasValue: true },
        { name: 'json', description: 'Emit JSON result.', hasValue: false },
      ],
      status: 'active',
      phase: 3,
      load: () => import('../commands/cdn/update.js'),
    },
    {
      name: 'cdn delete',
      summary: 'Delete a pull zone.',
      aliases: ['rm'],
      args: [{ name: 'pullZone', description: 'Pull zone name or id.', required: true }],
      flags: [
        { name: 'yes', short: 'y', description: 'Skip confirmation.', hasValue: false },
        { name: 'json', description: 'Emit JSON result.', hasValue: false },
      ],
      mcp: { tool: 'bunny.cdn_delete' },
      status: 'active',
      phase: 3,
      load: () => import('../commands/cdn/delete.js'),
    },
    {
      name: 'cdn rule list',
      summary: 'List edge rules on a pull zone.',
      aliases: ['ls'],
      args: [{ name: 'pullZone', description: 'Pull zone name or id.', required: true }],
      flags: [{ name: 'json', description: 'Emit JSON.', hasValue: false }],
      status: 'active',
      phase: 3,
      load: () => import('../commands/cdn/rule/list.js'),
    },
    {
      name: 'cdn rule add',
      summary: 'Add or update an edge rule (raw JSON rule; include Guid to update).',
      args: [{ name: 'pullZone', description: 'Pull zone name or id.', required: true }],
      flags: [
        { name: 'rule', description: 'JSON rule body.', hasValue: true },
        { name: 'json', description: 'Emit JSON result (rules after the change).', hasValue: false },
      ],
      examples: [
        {
          command: `bunny cdn rule add my-site --rule '{"ActionType":1,"Triggers":[{"Type":0,"PatternMatches":["*/old/*"]}],"ActionParameter1":"https://example.com/new"}'`,
          description: 'Redirect /old/* to a new URL.',
        },
      ],
      status: 'active',
      phase: 3,
      load: () => import('../commands/cdn/rule/add.js'),
    },
    {
      name: 'cdn rule delete',
      summary: 'Delete an edge rule by Guid.',
      aliases: ['rm'],
      args: [
        { name: 'pullZone', description: 'Pull zone name or id.', required: true },
        { name: 'guid', description: 'Edge rule Guid (see `bunny cdn rule list`).', required: true },
      ],
      flags: [
        { name: 'yes', short: 'y', description: 'Skip confirmation.', hasValue: false },
        { name: 'json', description: 'Emit JSON result.', hasValue: false },
      ],
      status: 'active',
      phase: 3,
      load: () => import('../commands/cdn/rule/delete.js'),
    },
    {
      name: 'cdn hostname list',
      summary: 'List custom hostnames linked to a pull zone.',
      aliases: ['ls'],
      args: [{ name: 'pullZone', description: 'Pull zone name or id.', required: true }],
      flags: [{ name: 'json', description: 'Emit JSON.', hasValue: false }],
      mcp: { tool: 'bunny.cdn_hostname_list' },
      status: 'active',
      phase: 3,
      load: () => import('../commands/cdn/hostname/list.js'),
    },
    {
      name: 'cdn hostname add',
      summary: 'Link a hostname, provision a Let\'s Encrypt cert and enable ForceSSL. Idempotent.',
      args: [
        { name: 'pullZone', description: 'Pull zone name or id.', required: true },
        { name: 'hostname', description: 'Custom hostname (e.g. example.com).', required: true },
      ],
      flags: [
        { name: 'no-force-ssl', description: 'Provision cert but disable HTTP→HTTPS redirect (re-run flips it off).', hasValue: false },
        { name: 'timeout', description: 'Cert wait timeout in seconds.', hasValue: true, defaultValue: '90' },
        { name: 'json', description: 'Emit JSON result.', hasValue: false },
      ],
      examples: [
        { command: 'bunny cdn hostname add my-site cdn.example.com', description: 'Link + cert + ForceSSL.' },
        { command: 'bunny cdn hostname add my-site cdn.example.com --no-force-ssl', description: 'Cert without redirect.' },
      ],
      mcp: { tool: 'bunny.cdn_hostname_add' },
      status: 'active',
      phase: 3,
      load: () => import('../commands/cdn/hostname/add.js'),
    },
    {
      name: 'cdn hostname remove',
      summary: 'Unlink a custom hostname from a pull zone.',
      aliases: ['rm'],
      args: [
        { name: 'pullZone', description: 'Pull zone name or id.', required: true },
        { name: 'hostname', description: 'Custom hostname.', required: true },
      ],
      flags: [
        { name: 'yes', short: 'y', description: 'Skip confirmation.', hasValue: false },
        { name: 'json', description: 'Emit JSON result.', hasValue: false },
      ],
      mcp: { tool: 'bunny.cdn_hostname_remove' },
      status: 'active',
      phase: 3,
      load: () => import('../commands/cdn/hostname/remove.js'),
    },
    {
      name: 'domain connect',
      summary: 'One step: link hostname + cert + optional apex PULLZONE DNS record. Idempotent.',
      args: [
        { name: 'pullZone', description: 'Pull zone name or id.', required: true },
        { name: 'hostname', description: 'FQDN to connect (e.g. example.com).', required: true },
      ],
      flags: [
        { name: 'dns-zone', description: 'Also create the PULLZONE DNS record in this DNS zone (domain or id).', hasValue: true },
        { name: 'name', description: 'DNS record name when --dns-zone is given. Empty/`@` for apex (default).', hasValue: true },
        { name: 'no-wait', description: 'Skip waiting for the cert (caller verifies separately).', hasValue: false },
        { name: 'timeout', description: 'Cert wait timeout in seconds.', hasValue: true, defaultValue: '90' },
        { name: 'no-force-ssl', description: 'Skip enabling ForceSSL (HTTP→HTTPS redirect).', hasValue: false },
        { name: 'json', description: 'Emit JSON result.', hasValue: false },
      ],
      examples: [
        { command: 'bunny domain connect my-site example.com --dns-zone example.com', description: 'Link, cert and apex DNS in one go.' },
      ],
      mcp: { tool: 'bunny.domain_connect' },
      status: 'active',
      phase: 3,
      load: () => import('../commands/domain/connect.js'),
    },

    // Phase 4 - DNS. <zone> accepts a domain or numeric id.
    {
      name: 'dns list',
      summary: 'List DNS zones.',
      aliases: ['ls'],
      flags: [{ name: 'json', description: 'Emit JSON.', hasValue: false }],
      status: 'active',
      phase: 4,
      load: () => import('../commands/dns/list.js'),
    },
    {
      name: 'dns get',
      summary: 'Show one DNS zone (with records) as JSON.',
      args: [{ name: 'zone', description: 'Domain or zone id.', required: true }],
      status: 'active',
      phase: 4,
      load: () => import('../commands/dns/get.js'),
    },
    {
      name: 'dns create',
      summary: 'Create a DNS zone for a domain.',
      args: [{ name: 'domain', description: 'Domain name.', required: true }],
      flags: [{ name: 'json', description: 'Emit JSON result.', hasValue: false }],
      status: 'active',
      phase: 4,
      load: () => import('../commands/dns/create.js'),
    },
    {
      name: 'dns delete',
      summary: 'Delete a DNS zone and all its records.',
      aliases: ['rm'],
      args: [{ name: 'zone', description: 'Domain or zone id.', required: true }],
      flags: [
        { name: 'yes', short: 'y', description: 'Skip confirmation.', hasValue: false },
        { name: 'json', description: 'Emit JSON result.', hasValue: false },
      ],
      status: 'active',
      phase: 4,
      load: () => import('../commands/dns/delete.js'),
    },
    {
      name: 'dns record list',
      summary: 'List records in a DNS zone.',
      aliases: ['ls'],
      args: [{ name: 'zone', description: 'Domain or zone id.', required: true }],
      flags: [
        { name: 'type', description: 'Filter by record type (A, CNAME, ...).', hasValue: true },
        { name: 'json', description: 'Emit JSON.', hasValue: false },
      ],
      examples: [{ command: 'bunny dns record list example.com --type A', description: 'Only A records.' }],
      mcp: { tool: 'bunny.dns_list' },
      status: 'active',
      phase: 4,
      load: () => import('../commands/dns/record/list.js'),
    },
    {
      name: 'dns record add',
      summary: 'Add a DNS record (A, AAAA, CNAME, TXT, MX, REDIRECT, PULLZONE, SRV, CAA, PTR, SCRIPT, NS).',
      args: [
        { name: 'zone', description: 'Domain or zone id.', required: true },
        { name: 'type', description: 'Record type.', required: true },
        { name: 'name', description: 'Record name (`@` or empty for apex).', required: true },
        { name: 'value', description: 'Record value (optional with --pull-zone).', required: false },
      ],
      flags: [
        { name: 'ttl', description: 'TTL in seconds.', hasValue: true },
        { name: 'priority', description: 'Priority (MX/SRV).', hasValue: true },
        { name: 'weight', description: 'Weight (SRV).', hasValue: true },
        { name: 'port', description: 'Port (SRV).', hasValue: true },
        { name: 'flags', description: 'Flags (CAA).', hasValue: true },
        { name: 'tag', description: 'Tag (CAA).', hasValue: true },
        { name: 'link-name', description: 'Linked resource id (PULLZONE/SCRIPT).', hasValue: true },
        { name: 'pull-zone', description: 'PULLZONE shortcut: pull zone name or id; fills value + link-name.', hasValue: true },
        { name: 'json', description: 'Emit JSON result.', hasValue: false },
      ],
      examples: [
        { command: 'bunny dns record add example.com A www 1.2.3.4', description: 'Standard A record.' },
        { command: 'bunny dns record add example.com REDIRECT www https://example.com', description: 'Redirect www to apex.' },
        { command: 'bunny dns record add example.com PULLZONE @ --pull-zone my-site', description: 'Point the apex at a pull zone.' },
      ],
      mcp: { tool: 'bunny.dns_record_add' },
      status: 'active',
      phase: 4,
      load: () => import('../commands/dns/record/add.js'),
    },
    {
      name: 'dns record update',
      summary: 'Update a DNS record with a raw JSON body.',
      args: [
        { name: 'zone', description: 'Domain or zone id.', required: true },
        { name: 'recordId', description: 'Record id (see `bunny dns record list`).', required: true },
      ],
      flags: [
        { name: 'body', description: 'JSON body sent to Bunny.', hasValue: true },
        { name: 'json', description: 'Emit JSON result.', hasValue: false },
      ],
      status: 'active',
      phase: 4,
      load: () => import('../commands/dns/record/update.js'),
    },
    {
      name: 'dns record delete',
      summary: 'Delete a DNS record.',
      aliases: ['rm'],
      args: [
        { name: 'zone', description: 'Domain or zone id.', required: true },
        { name: 'recordId', description: 'Record id (see `bunny dns record list`).', required: true },
      ],
      flags: [
        { name: 'yes', short: 'y', description: 'Skip confirmation.', hasValue: false },
        { name: 'json', description: 'Emit JSON result.', hasValue: false },
      ],
      mcp: { tool: 'bunny.dns_record_delete' },
      status: 'active',
      phase: 4,
      load: () => import('../commands/dns/record/delete.js'),
    },

    // Phase 5 - Stream, Magic Containers, Edge Scripting. Refs accept name or id.
    {
      name: 'stream library list',
      summary: 'List Stream video libraries.',
      aliases: ['ls'],
      flags: [{ name: 'json', description: 'Emit JSON.', hasValue: false }],
      status: 'active',
      phase: 5,
      load: () => import('../commands/stream/library/list.js'),
    },
    {
      name: 'stream library create',
      summary: 'Create a Stream video library.',
      args: [{ name: 'name', description: 'Library name.', required: true }],
      flags: [
        { name: 'replicate', description: 'Comma-separated replication regions.', hasValue: true },
        { name: 'json', description: 'Emit JSON result.', hasValue: false },
      ],
      status: 'active',
      phase: 5,
      load: () => import('../commands/stream/library/create.js'),
    },
    {
      name: 'stream library delete',
      summary: 'Delete a Stream video library.',
      aliases: ['rm'],
      args: [{ name: 'library', description: 'Library name or id.', required: true }],
      flags: [
        { name: 'yes', short: 'y', description: 'Skip confirmation.', hasValue: false },
        { name: 'json', description: 'Emit JSON result.', hasValue: false },
      ],
      status: 'active',
      phase: 5,
      load: () => import('../commands/stream/library/delete.js'),
    },
    {
      name: 'stream video list',
      summary: 'List videos in a library.',
      aliases: ['ls'],
      args: [{ name: 'library', description: 'Library name or id.', required: true }],
      flags: [
        { name: 'collection', description: 'Filter by collection id.', hasValue: true },
        { name: 'json', description: 'Emit JSON.', hasValue: false },
      ],
      status: 'active',
      phase: 5,
      load: () => import('../commands/stream/video/list.js'),
    },
    {
      name: 'stream video upload',
      summary: 'Upload a video file to a library.',
      args: [
        { name: 'library', description: 'Library name or id.', required: true },
        { name: 'file', description: 'Local video file path.', required: true },
      ],
      flags: [
        { name: 'title', description: 'Video title (default: file name).', hasValue: true },
        { name: 'collection', description: 'Collection id.', hasValue: true },
        { name: 'json', description: 'Emit JSON result.', hasValue: false },
      ],
      status: 'active',
      phase: 5,
      load: () => import('../commands/stream/video/upload.js'),
    },
    {
      name: 'stream video delete',
      summary: 'Delete a video.',
      aliases: ['rm'],
      args: [
        { name: 'library', description: 'Library name or id.', required: true },
        { name: 'video', description: 'Video guid.', required: true },
      ],
      flags: [
        { name: 'yes', short: 'y', description: 'Skip confirmation.', hasValue: false },
        { name: 'json', description: 'Emit JSON result.', hasValue: false },
      ],
      status: 'active',
      phase: 5,
      load: () => import('../commands/stream/video/delete.js'),
    },
    {
      name: 'containers list',
      summary: 'List Magic Containers apps.',
      aliases: ['ls'],
      flags: [{ name: 'json', description: 'Emit JSON.', hasValue: false }],
      status: 'active',
      phase: 5,
      load: () => import('../commands/containers/list.js'),
    },
    {
      name: 'containers create',
      summary: 'Create a Magic Containers app.',
      args: [{ name: 'name', description: 'App name.', required: true }],
      flags: [
        { name: 'image', description: 'Docker image (e.g. ghcr.io/x/y:tag).', hasValue: true },
        { name: 'region', description: 'Deploy region.', hasValue: true },
        { name: 'port', description: 'Container port.', hasValue: true },
        { name: 'json', description: 'Emit JSON result.', hasValue: false },
      ],
      status: 'planned',
      phase: 5,
      load: () => import('../commands/containers/create.js'),
    },
    {
      name: 'containers delete',
      summary: 'Delete a Magic Containers app.',
      aliases: ['rm'],
      args: [{ name: 'app', description: 'App name or id.', required: true }],
      flags: [
        { name: 'yes', short: 'y', description: 'Skip confirmation.', hasValue: false },
        { name: 'json', description: 'Emit JSON result.', hasValue: false },
      ],
      status: 'active',
      phase: 5,
      load: () => import('../commands/containers/delete.js'),
    },
    {
      name: 'scripting list',
      summary: 'List edge scripts.',
      aliases: ['ls'],
      flags: [{ name: 'json', description: 'Emit JSON.', hasValue: false }],
      status: 'active',
      phase: 5,
      load: () => import('../commands/scripting/list.js'),
    },
    {
      name: 'scripting deploy',
      summary: 'Deploy an edge script from a file (updates the script with that name, else creates it).',
      args: [{ name: 'name', description: 'Script name.', required: true }],
      flags: [
        { name: 'file', description: 'Local source file (required).', hasValue: true },
        { name: 'type', description: 'Numeric script type (new scripts only).', hasValue: true },
        { name: 'json', description: 'Emit JSON result.', hasValue: false },
      ],
      examples: [{ command: 'bunny scripting deploy my-script --file ./build/index.js', description: 'Create or update.' }],
      status: 'active',
      phase: 5,
      load: () => import('../commands/scripting/deploy.js'),
    },
    {
      name: 'scripting delete',
      summary: 'Delete an edge script.',
      aliases: ['rm'],
      args: [{ name: 'script', description: 'Script name or id.', required: true }],
      flags: [
        { name: 'yes', short: 'y', description: 'Skip confirmation.', hasValue: false },
        { name: 'json', description: 'Emit JSON result.', hasValue: false },
      ],
      status: 'active',
      phase: 5,
      load: () => import('../commands/scripting/delete.js'),
    },

    // rc.19 - DX polish (install bootstrap + self-update)
    {
      name: 'install mcp',
      summary: 'Register bunny-tools as an MCP server in Claude Code (one-shot bootstrap).',
      flags: [
        { name: 'scope', description: 'MCP scope: user | project | local (default: user).', hasValue: true },
      ],
      examples: [
        { command: 'bunny install mcp', description: 'Add bunny-tools to Claude\'s user-scope MCP config.' },
        { command: 'bunny install mcp --scope=project', description: 'Add to the current project\'s .claude config.' },
      ],
      status: 'active',
      phase: 7,
      load: () => import('../commands/install/mcp.js'),
    },
    {
      name: 'update',
      summary: 'Self-update bunny-tools to the latest version on npm.',
      flags: [
        { name: 'yes', description: 'Skip confirmation prompt.', hasValue: false },
      ],
      examples: [
        { command: 'bunny update', description: 'npm install -g bunny-tools@latest.' },
      ],
      status: 'active',
      phase: 7,
      load: () => import('../commands/update.js'),
    },

    // Phase 6 - MCP server
    {
      name: 'mcp',
      summary: 'Boot the bunny-tools MCP stdio server (for AI agents).',
      flags: [
        { name: 'http', description: 'Enable HTTP/SSE transport (deferred to v0.2).', hasValue: false },
      ],
      examples: [
        {
          command: 'claude mcp add bunny-tools -- npx -y bunny-tools mcp',
          description: 'Install for Claude Code.',
        },
      ],
      status: 'active',
      phase: 6,
      load: () => import('../commands/mcp.js'),
    },

    // rc.8 - wrangler-inspired wins.
    {
      name: 'whoami',
      summary: 'Show the current account context (stored credentials + reachable zone counts).',
      flags: [{ name: 'json', description: 'Emit JSON instead of a table.', hasValue: false }],
      examples: [
        { command: 'bunny whoami', description: 'Quick "am I authenticated and which account?" check.' },
        { command: 'bunny whoami --profile=work', description: 'Inspect a specific profile without switching.' },
      ],
      mcp: { tool: 'bunny.whoami' },
      status: 'active',
      phase: 2,
      load: () => import('../commands/whoami.js'),
    },
    {
      name: 'docs',
      summary: 'Open Bunny.net docs in the browser. Optional [topic] for direct deep links.',
      args: [{ name: 'topic', description: 'Topic shortcut (e.g. storage, cdn, dns) or path slug.', required: false }],
      examples: [
        { command: 'bunny docs', description: 'Opens docs.bunny.net root.' },
        { command: 'bunny docs storage', description: 'Storage introduction.' },
        { command: 'bunny docs cdn', description: 'CDN pull zone reference.' },
      ],
      status: 'active',
      phase: 2,
      load: () => import('../commands/docs.js'),
    },
  ],
};

export function listMcpTools(): { name: string; tool: string; description?: string }[] {
  return registry.commands
    .filter((c) => c.mcp !== undefined)
    .map((c) => ({ name: c.name, tool: c.mcp!.tool, description: c.mcp!.description ?? c.summary }));
}

export function findCommand(name: string): CommandSpec | undefined {
  return registry.commands.find((c) => c.name === name);
}
