# Bunny CLI and MCP Server

[![npm](https://img.shields.io/npm/v/bunny-tools.svg)](https://www.npmjs.com/package/bunny-tools)
[![npm downloads](https://img.shields.io/npm/dm/bunny-tools.svg)](https://www.npmjs.com/package/bunny-tools)
[![CI](https://github.com/chienqan/bunny-tools/actions/workflows/ci.yml/badge.svg)](https://github.com/chienqan/bunny-tools/actions/workflows/ci.yml)
[![e2e nightly](https://github.com/chienqan/bunny-tools/actions/workflows/e2e-nightly.yml/badge.svg)](https://github.com/chienqan/bunny-tools/actions/workflows/e2e-nightly.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Package:** `bunny-tools` &middot; **Binary:** `bunny` &middot; **Node:** ≥20

## Why bunny-tools

Bunny.net is a great CDN/storage/DNS/streaming platform but managing it from the terminal was DIY territory. bunny-tools fixes that with one binary covering Storage, CDN, DNS, Stream, and Edge Scripting - and a built-in MCP server so AI agents can drive every command:

- **One API key, nothing else.** Paste your account API key once. Storage zone passwords and Stream library keys are fetched with it automatically.
- **Commands you can guess.** `bunny storage ls`, `bunny cdn list`, `bunny dns record add example.com ...`. Use names and domains, not numeric ids.
- **`bunny deploy` for static sites.** Familiar if you've used `firebase deploy`: walk public dir → SHA-cached diff → parallel upload → CDN purge, in one command.
- **AI-native via MCP.** Agents get the same surface you do. Every command speaks `--json`. `bunny install mcp` registers it with Claude Code in one shot.

## Install

### As a CLI

```bash
npm install -g bunny-tools
```

### As an MCP server (recommended for AI workflows)

For Claude Code (the `--` keeps `claude` from reading `-y` as its own option):

```bash
claude mcp add bunny-tools -- npx -y bunny-tools mcp
```

Or let the CLI do it: `bunny install mcp` (add `--scope project` for the current project only).

For Claude Desktop, add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "bunny-tools": {
      "command": "npx",
      "args": ["-y", "bunny-tools", "mcp"]
    }
  }
}
```

See [MCP server](#mcp-server-ai-integration) for the tool list.

## Quickstart

```bash
bunny configure              # paste your API key (dash.bunny.net → Account → API)
bunny storage ls             # every storage zone on the account
bunny storage ls my-zone     # files in a zone - no zone password needed
```

Deploying a static site:

```bash
bunny init                   # interactive: feature picker + bunny.json
bunny deploy --dry-run       # preview
bunny deploy                 # storage sync + CDN purge
```

Non-interactive form for CI:

```bash
bunny init --non-interactive --features=storage \
  --api-key=$BUNNY_API_KEY \
  --storage-zone=my-app \
  --pull-zone=12345
```

Add `--ci` to also generate `.github/workflows/bunny-deploy.yml` for GitHub Actions.

## How the commands are shaped

Learn these three rules and you can guess almost any command:

1. **Grammar:** `bunny <resource> [<sub-resource>] <verb> [args]`. Verbs are `list`, `get`, `create`, `update`, `delete`. `ls` and `rm` work as aliases everywhere.
2. **Storage paths are `<zone>/<path>`**, like `aws s3`: `bunny storage ls my-zone/assets`.
3. **Use names, not ids.** Pull zones, storage zones, libraries and scripts accept a name or an id. DNS zones accept the domain.

Every command that prints something accepts `--json`. Destructive commands ask for confirmation, or take `--yes` in scripts.

## Command reference

### Setup and account

| Command | What it does |
| --- | --- |
| `bunny configure` | Store your API key (named profiles with `--profile`) |
| `bunny configure list` | List profiles and stored credentials (masked) |
| `bunny configure switch <profile>` | Set the active profile |
| `bunny configure remove` | Remove a profile, or one scope with `--scope` |
| `bunny whoami` | Show the active account and zone counts |
| `bunny init [dir]` | Create `bunny.json` for a project (feature picker) |
| `bunny use [alias]` | Switch `.bunnyrc` alias, or list aliases |
| `bunny docs [topic]` | Open Bunny.net docs (`storage`, `cdn`, `dns`, ...) |

### Deploy and purge

| Command | What it does |
| --- | --- |
| `bunny deploy` | Sync the public dir to storage and purge the CDN, per `bunny.json` |
| `bunny purge <url...>` | Purge specific URLs |
| `bunny purge --pull-zone <name>` | Purge a whole pull zone (add `--tag <tag>` for one Cache-Tag) |
| `bunny purge` | Purge the pull zones listed in `bunny.json` |

### Storage

| Command | What it does |
| --- | --- |
| `bunny storage ls` | List storage zones |
| `bunny storage ls <zone>[/<path>]` | List files (`-r` for recursive) |
| `bunny storage upload <file> <zone>/<path>` | Upload a file (end the target with `/` to keep the file name) |
| `bunny storage download <zone>/<path> [file]` | Download a file |
| `bunny storage rm <zone>/<path>` | Delete a file (`-r` for a directory) |
| `bunny storage sync <dir> <zone>[/<path>]` | Upload a whole directory (no CDN purge) |
| `bunny storage zone list` | Storage zones with id, region, size, replication |
| `bunny storage zone get <zone>` | One zone as JSON |
| `bunny storage zone create <name> --region sg` | Create a zone |
| `bunny storage zone update <zone> --body '<json>'` | Update a zone (raw JSON) |
| `bunny storage zone delete <zone>` | Delete a zone and its files |

```bash
bunny storage upload ./logo.png my-zone/img/
bunny storage ls my-zone/img --json
bunny storage rm my-zone/tmp/ -r --yes
bunny storage sync ./public my-zone/
```

### CDN (pull zones)

| Command | What it does |
| --- | --- |
| `bunny cdn list` | List pull zones |
| `bunny cdn get <pull-zone>` | One pull zone as JSON |
| `bunny cdn create <name> --origin <url>` | Create a pull zone |
| `bunny cdn update <pull-zone> --body '<json>'` | Update a pull zone (raw JSON) |
| `bunny cdn delete <pull-zone>` | Delete a pull zone |
| `bunny cdn hostname list <pull-zone>` | Custom hostnames on a pull zone |
| `bunny cdn hostname add <pull-zone> <host>` | Link a hostname + free SSL + HTTPS redirect. Idempotent |
| `bunny cdn hostname remove <pull-zone> <host>` | Unlink a hostname |
| `bunny cdn rule list <pull-zone>` | Edge rules |
| `bunny cdn rule add <pull-zone> --rule '<json>'` | Add or update an edge rule |
| `bunny cdn rule delete <pull-zone> <guid>` | Delete an edge rule |
| `bunny domain connect <pull-zone> <host> [--dns-zone <domain>]` | Hostname + SSL + apex DNS record in one step |

```bash
# Put example.com on a pull zone, with SSL and the DNS record, in one command
bunny domain connect my-site example.com --dns-zone example.com
```

### DNS

| Command | What it does |
| --- | --- |
| `bunny dns list` | List DNS zones |
| `bunny dns get <domain>` | One zone with its records, as JSON |
| `bunny dns create <domain>` | Create a DNS zone |
| `bunny dns delete <domain>` | Delete a DNS zone |
| `bunny dns record list <domain>` | List records (`--type A` to filter) |
| `bunny dns record add <domain> <type> <name> [value]` | Add a record |
| `bunny dns record update <domain> <record-id> --body '<json>'` | Update a record |
| `bunny dns record delete <domain> <record-id>` | Delete a record |

Supported record types: `A`, `AAAA`, `CNAME`, `TXT`, `MX`, `SRV`, `CAA`, `NS`, plus Bunny routing types `REDIRECT`, `PULLZONE`, `PTR`, `SCRIPT`.

```bash
bunny dns record add example.com A www 1.2.3.4 --ttl 300
bunny dns record add example.com REDIRECT www https://example.com
bunny dns record add example.com PULLZONE @ --pull-zone my-site   # value + link filled in
```

### Stream, Magic Containers, Edge Scripting

| Command | What it does |
| --- | --- |
| `bunny stream library list` | List video libraries |
| `bunny stream library create <name>` | Create a library |
| `bunny stream library delete <library>` | Delete a library |
| `bunny stream video list <library>` | List videos |
| `bunny stream video upload <library> <file>` | Upload a video (`--title`) |
| `bunny stream video delete <library> <guid>` | Delete a video |
| `bunny containers list` | List Magic Containers apps |
| `bunny containers delete <app>` | Delete an app |
| `bunny scripting list` | List edge scripts |
| `bunny scripting deploy <name> --file <path>` | Create the script, or update it if the name exists |
| `bunny scripting delete <script>` | Delete a script |

> `containers create` is not available yet: Bunny's v3 schema needs `runtimeType`, `containerTemplates[]` and `autoScaling`, which the CLI does not model. Create apps in the dashboard for now.

### Discovery

| Command | What it does |
| --- | --- |
| `bunny --help`, `bunny <group> --help` | Grouped help with examples |
| `bunny <command> --help-json` | Help for one command as JSON |
| `bunny manifest --pretty` | The whole command registry as JSON |
| `bunny manifest --names` | One command name per line |
| `bunny mcp` | Start the MCP stdio server |
| `bunny install mcp` | Register the MCP server with Claude Code |
| `bunny update` | Self-update from npm |

## Global flags

| Flag | Effect |
| --- | --- |
| `-c, --config <path>` | Use this `bunny.json` |
| `--cwd <dir>` | Run as if launched from this directory |
| `-e, --env <alias>` | One-shot `.bunnyrc` alias |
| `-p, --profile <name>` | One-shot credential profile |

```bash
bunny --profile=staging deploy
```

## Configuration

**`bunny.json`** (per project, git-tracked):

```jsonc
{
  "$schema": "https://unpkg.com/bunny-tools/schema/bunny.schema.json",
  "deploy": {
    "publicDir": "dist",
    "ignore": ["bunny.json", ".bunnyrc", "**/.*", "**/node_modules/**"],
    "storageZone": "my-app",
    "region": "ny",
    "concurrency": 8,
    "pullZones": [{ "id": 12345, "purge": "all" }]
  }
}
```

**`.bunnyrc`** (per-developer aliases, gitignored):

```json
{
  "default": "prod",
  "aliases": {
    "prod":    { "storageZone": "my-app",     "pullZones": [12345] },
    "staging": { "storageZone": "my-app-stg", "pullZones": [12346] }
  }
}
```

**Credential profiles** live in the OS keychain, or in `~/.config/bunny-tools/credentials.json` when no keychain is available. Switch with `bunny configure switch <name>`, or one-shot with `bunny --profile=<name> <cmd>` / `BUNNY_PROFILE=<name>`.

## Auth model

You only need the **account API key**. Bunny uses four credential types, and bunny-tools picks the right one per call:

| Scope | Where it comes from |
| --- | --- |
| `account` | Your API key (`bunny configure` or `BUNNY_API_KEY`) |
| `storage:<zone>` | Fetched with the account key; override with `BUNNY_STORAGE_PASSWORD_<ZONE>` |
| `stream:<library>` | Fetched with the account key; override with `BUNNY_STREAM_KEY_<ID>` |
| `database:<name>` | `BUNNY_DATABASE_KEY_<NAME>` |

Lookup order for each scope: `--flag` → scoped env var (`..._<ZONE>`) → OS keychain → credentials file → (storage/stream only) fetched with the account key → generic env var (`BUNNY_STORAGE_PASSWORD` / `BUNNY_STREAM_KEY`). The generic variable comes last because it applies to every zone, so it never overrides the right password for another zone. Fetched secrets stay in memory and are never written to disk. Zone passwords and library keys are also stripped from every command's output.

## GitHub Actions

`bunny init --ci` generates a workflow like this:

```yaml
- name: Install bunny-tools
  run: npm install -g bunny-tools
- name: Deploy
  env:
    BUNNY_API_KEY: ${{ secrets.BUNNY_API_KEY }}
  run: bunny deploy
```

If you'd rather not give CI the account key, set `BUNNY_STORAGE_PASSWORD_<ZONE>` and `deploy.region` in `bunny.json` instead. Purging the CDN still needs the account key.

## MCP server (AI integration)

The server exposes 21 tools that mirror the CLI and accept names instead of ids:

- **Deploy and purge:** `bunny.deploy`, `bunny.purge`
- **Storage:** `bunny.storage_ls`, `bunny.storage_upload`, `bunny.storage_rm`, `bunny.storage_zone_list`, `bunny.storage_zone_create`, `bunny.storage_zone_delete`
- **CDN:** `bunny.cdn_list`, `bunny.cdn_create`, `bunny.cdn_delete`, `bunny.cdn_hostname_list`, `bunny.cdn_hostname_add`, `bunny.cdn_hostname_remove`, `bunny.domain_connect`
- **DNS:** `bunny.dns_list`, `bunny.dns_record_add`, `bunny.dns_record_delete`
- **Meta:** `bunny.init`, `bunny.manifest`, and `bunny.run` (run any CLI command)

**Resources:** `bunny://manifest` (command registry), `bunny://agents` ([`AGENTS.md`](./AGENTS.md)), `bunny://config/current` (masked credentials view).

To anchor Claude to bunny-tools in a project, add this to the project's `CLAUDE.md`:

```markdown
## Deploy
This project uses bunny-tools. Run `bunny init` for first-time setup, then `bunny deploy`.
```

AI agents should start with [`AGENTS.md`](./AGENTS.md): workflows, output contract, and an architecture map.

## Upgrading from 0.1.x

0.2.0 renames commands to the shape above, and the old names are gone. See the [migration table in the changelog](docs/project-changelog.md#020---2026-10-12). The short version: `storagezone` → `storage zone`, `pullzone` → `cdn`, `edgerule` → `rule`, `containers app` → `containers`, `--zone=X <path>` → `X/<path>`, `purge pullzone:<id>` → `purge --pull-zone <name>`.

## Development

```bash
git clone https://github.com/chienqan/bunny-tools
cd bunny-tools
npm ci
npm run build
npm test
npm run dev -- manifest --pretty
```

Architecture and "how to add a command": [`docs/system-architecture.md`](docs/system-architecture.md). End-to-end tests against a real Bunny account: [`docs/e2e-testing.md`](docs/e2e-testing.md). Releasing: [`docs/deployment-guide.md`](docs/deployment-guide.md).

## FAQ

**Is this the official Bunny.net CLI?**
No. bunny-tools is a community CLI. Bunny.net publishes [`@bunny.net/cli`](https://www.npmjs.com/package/@bunny.net/cli), which focuses on Databases, Magic Containers, and Edge Scripts. bunny-tools covers a different surface (Storage, CDN, DNS, Stream, Edge Scripting) and ships an MCP server for AI agents.

**Why the binary name `bunny`?**
Short and matches the brand. Note that `@bunny.net/cli` also installs a `bunny` binary, so installing both globally will collide - pick one or use `npx` for the other.

**Can I use this in CI?**
Yes. `bunny init --ci` generates a `.github/workflows/bunny-deploy.yml`. All commands honor `BUNNY_API_KEY`, scoped env vars, `--json`, and `--yes`.

**Does it work without Node.js?**
Currently npm-only (Node 20+). A standalone binary is on the roadmap.

## License

MIT - see [LICENSE](./LICENSE).
