# AGENTS.md — bunny-tools

Bunny.net CLI - storage deploy, CDN purge, full resource management.

**Binary:** `bunny`  |  **Version:** 0.2.0  |  **Active commands:** 55/56

<!-- HANDCURATED:START -->

## Quickstart for AI agents

1. Check credentials: `bunny whoami --json`. If no account key is stored, ask the user to run `bunny configure` (paste the API key from dash.bunny.net → Account → API) or set `BUNNY_API_KEY`. That one key is all bunny-tools needs.
2. Explore: `bunny storage ls` (storage zones), `bunny cdn list` (pull zones), `bunny dns list` (DNS zones). Add `--json` when you need to parse output.
3. Deploy a static site: if there is no `bunny.json`, run `bunny init`. Then `bunny deploy --dry-run --json`, review, and `bunny deploy --json`.

## Mental model

- **One credential.** The account API key reads every storage zone password and Stream library key, so bunny-tools fetches those on demand. Never ask the user for a zone password. Explicit keys (`BUNNY_STORAGE_PASSWORD_<ZONE>`, `BUNNY_STREAM_KEY_<ID>`, keychain) still win when present, which is how CI without an account key works.
- **Grammar.** `bunny <resource> [<sub-resource>] <verb> [args] [flags]`. Verbs are `list` (alias `ls`), `get`, `create`, `update`, `delete` (alias `rm`). Storage file commands use `ls`/`rm` like a shell.
- **Addressing.** Storage paths are `<zone>/<path>` (aws-s3 style). Pull zones, storage zones, Stream libraries, scripts and container apps accept a **name or numeric id**. DNS zones accept the **domain or id**.
- **Project config.** `bunny.json` (git-tracked) drives `deploy` and bare `purge`. `.bunnyrc` holds per-developer aliases (`bunny use <alias>`, or one-shot `-e <alias>`). Profiles (`bunny configure --profile`, `-p <name>`) hold credentials for multiple accounts.

## Output and exit-code contract

- stdout carries only the result. Every command that prints a result accepts `--json`; mutations print the resulting object with `--json`.
- stderr carries progress, prompts and human success lines. Safe to ignore when parsing.
- Exit codes: `0` success, `1` error / bad input / aborted confirmation, `2` partial failure (some uploads or purges failed).
- Destructive commands (`delete`, `rm`) need `--yes` (`-y`) in non-interactive shells. `BUNNY_NONINTERACTIVE=1` forces non-interactive mode.
- Machine-readable help: `bunny manifest` (whole registry) or `bunny <command> --help-json`.

## Common tasks

| Goal | Command |
| --- | --- |
| List storage zones | `bunny storage ls` |
| List files in a zone | `bunny storage ls my-zone/assets -r --json` |
| Upload / download a file | `bunny storage upload ./a.png my-zone/img/` · `bunny storage download my-zone/img/a.png` |
| Delete files | `bunny storage rm my-zone/old/ -r --yes` |
| Mirror a folder (no purge) | `bunny storage sync ./public my-zone/` |
| Deploy site + purge CDN | `bunny deploy` |
| Purge CDN | `bunny purge https://cdn.example.com/app.js` · `bunny purge --pull-zone my-site [--tag app]` |
| Custom domain with SSL | `bunny domain connect my-site example.com --dns-zone example.com` |
| DNS record | `bunny dns record add example.com A www 1.2.3.4` |
| Edge rule | `bunny cdn rule add my-site --rule '<json>'` |
| Edge script | `bunny scripting deploy my-script --file ./build/index.js` |

## Gotchas

- Bunny has 4 credential types (account, storage zone, stream library, database), all sent as the `AccessKey` header. bunny-tools picks the right one per call.
- Storage uses 8 regional endpoints; the region is resolved per zone automatically (`--region` skips the lookup).
- Keep fewer than 10,000 files per storage directory.
- Tag purge needs the origin to send a `Cache-Tag` header. Without it, purge the whole zone.
- `PULLZONE` DNS records fail unless the hostname is linked to the pull zone with a certificate. `bunny domain connect` does all of it in one idempotent call.
- Storage zone and Stream library outputs never include passwords or API keys.

## Architecture map (for agents editing this repo)

```
src/cli.ts            Commander tree built from the registry (no hand-wired commands)
src/manifest/         registry.ts = single source of truth for every command, flag, example
src/commands/<path>   one file per command, mirrors the command path (storage/zone/list.ts)
src/mcp/tools.ts      MCP tools, call core directly
src/core/             business logic, UI-free (storage-ops, zones, dns, purge, resolve, ...)
src/api/              thin Bunny REST clients + HTTP retry + typed errors
src/config/           bunny.json, .bunnyrc, credential resolver (flag → env → keychain → file)
src/ui/               progress (stderr), prompts, tables, shared output contract (ui/output.ts)
```

Rule: `commands/` and `mcp/` call `core/`, never `api/` (ESLint enforced). Full walkthrough with request flows and "how to add a command": [`docs/system-architecture.md`](docs/system-architecture.md).

## MCP usage

`bunny mcp` boots an MCP stdio server whose tools mirror the CLI (`bunny.storage_ls`, `bunny.cdn_hostname_add`, `bunny.dns_record_add`, ...) plus `bunny.run` as an escape hatch for any CLI invocation. Install for Claude Code with:

```bash
claude mcp add bunny-tools -- npx -y bunny-tools mcp
```

<!-- HANDCURATED:END -->

## Command tree (auto-generated)

### Core

Setup, deploy, purge and discovery.

- `bunny manifest` — Print the bunny-tools command registry as JSON. _mcp: `bunny.manifest`_
- `bunny init [dir]` — Initialize bunny.json + creds. Auth → feature multi-select → per-feature config. _mcp: `bunny.init`_
- `bunny use [alias]` — Switch active alias from .bunnyrc; with no arg, list aliases.
- `bunny deploy` — Sync public dir to storage zone and purge CDN cache. _mcp: `bunny.deploy`_
- `bunny purge [urls...]` — Purge CDN cache: URLs, a whole pull zone, or one Cache-Tag. _mcp: `bunny.purge`_
- `bunny update` — Self-update bunny-tools to the latest version on npm.
- `bunny mcp` — Boot the bunny-tools MCP stdio server (for AI agents).
- `bunny whoami` — Show the current account context (stored credentials + reachable zone counts). _mcp: `bunny.whoami`_
- `bunny docs [topic]` — Open Bunny.net docs in the browser. Optional [topic] for direct deep links.

### `bunny configure`

Store your Bunny API key and manage credential profiles.

- `bunny configure` — Store your Bunny API key for a profile (zone passwords are then fetched automatically).
- `bunny configure list` (alias: ls) — List all credential profiles + stored scopes (masked). Active profile marked with *.
- `bunny configure switch <profile>` — Set the active credential profile.
- `bunny configure remove` — Remove a credential profile (entire) or a single scope within it.

### `bunny storage`

Files in storage zones, addressed as <zone>/<path> (ls/upload/download/rm/sync).

- `bunny storage ls [target]` (alias: list) — List storage zones (no argument) or files at <zone>/<path>. _mcp: `bunny.storage_ls`_
- `bunny storage upload <local> <target>` — Upload a local file to <zone>/<path>. _mcp: `bunny.storage_upload`_
- `bunny storage download <target> [local]` — Download <zone>/<path> to a local file. _mcp: `bunny.storage_download`_
- `bunny storage rm <target>` (alias: delete) — Delete a file (or a directory with -r) at <zone>/<path>. _mcp: `bunny.storage_rm`_
- `bunny storage sync <local> <target>` — Upload a local directory to <zone>[/<path>] (upload-only, no CDN purge).
- `bunny storage zone list` (alias: ls) — List storage zones with id, region, size and replication. _mcp: `bunny.storage_zone_list`_
- `bunny storage zone get <zone>` — Show one storage zone as JSON (passwords stripped).
- `bunny storage zone create <name>` — Create a storage zone. _mcp: `bunny.storage_zone_create`_
- `bunny storage zone update <zone>` — Update a storage zone with a raw JSON body.
- `bunny storage zone delete <zone>` (alias: rm) — Delete a storage zone and all its files. _mcp: `bunny.storage_zone_delete`_

### `bunny cdn`

Pull zones (CDN): create/list/delete, edge rules, custom hostnames.

- `bunny cdn list` (alias: ls) — List pull zones. _mcp: `bunny.cdn_list`_
- `bunny cdn get <pullZone>` — Show one pull zone as JSON.
- `bunny cdn create <name>` — Create a pull zone in front of an origin URL. _mcp: `bunny.cdn_create`_
- `bunny cdn update <pullZone>` — Update a pull zone with a raw JSON body.
- `bunny cdn delete <pullZone>` (alias: rm) — Delete a pull zone. _mcp: `bunny.cdn_delete`_
- `bunny cdn rule list <pullZone>` (alias: ls) — List edge rules on a pull zone.
- `bunny cdn rule add <pullZone>` — Add or update an edge rule (raw JSON rule; include Guid to update).
- `bunny cdn rule delete <pullZone> <guid>` (alias: rm) — Delete an edge rule by Guid.
- `bunny cdn hostname list <pullZone>` (alias: ls) — List custom hostnames linked to a pull zone. _mcp: `bunny.cdn_hostname_list`_
- `bunny cdn hostname add <pullZone> <hostname>` — Link a hostname, provision a Let's Encrypt cert and enable ForceSSL. Idempotent. _mcp: `bunny.cdn_hostname_add`_
- `bunny cdn hostname remove <pullZone> <hostname>` (alias: rm) — Unlink a custom hostname from a pull zone. _mcp: `bunny.cdn_hostname_remove`_

### `bunny domain`

Connect a domain to a pull zone in one step.

- `bunny domain connect <pullZone> <hostname>` — One step: link hostname + cert + optional apex PULLZONE DNS record. Idempotent. _mcp: `bunny.domain_connect`_

### `bunny dns`

DNS zones (by domain) and their records.

- `bunny dns list` (alias: ls) — List DNS zones.
- `bunny dns get <zone>` — Show one DNS zone (with records) as JSON.
- `bunny dns create <domain>` — Create a DNS zone for a domain.
- `bunny dns delete <zone>` (alias: rm) — Delete a DNS zone and all its records.
- `bunny dns record list <zone>` (alias: ls) — List records in a DNS zone. _mcp: `bunny.dns_list`_
- `bunny dns record add <zone> <type> <name> [value]` — Add a DNS record (A, AAAA, CNAME, TXT, MX, REDIRECT, PULLZONE, SRV, CAA, PTR, SCRIPT, NS). _mcp: `bunny.dns_record_add`_
- `bunny dns record update <zone> <recordId>` — Update a DNS record with a raw JSON body.
- `bunny dns record delete <zone> <recordId>` (alias: rm) — Delete a DNS record. _mcp: `bunny.dns_record_delete`_

### `bunny stream`

Stream video libraries and videos.

- `bunny stream library list` (alias: ls) — List Stream video libraries.
- `bunny stream library create <name>` — Create a Stream video library.
- `bunny stream library delete <library>` (alias: rm) — Delete a Stream video library.
- `bunny stream video list <library>` (alias: ls) — List videos in a library.
- `bunny stream video upload <library> <file>` — Upload a video file to a library.
- `bunny stream video delete <library> <video>` (alias: rm) — Delete a video.

### `bunny containers`

Magic Containers apps.

- `bunny containers list` (alias: ls) — List Magic Containers apps.
- `bunny containers create <name>` [planned] — Create a Magic Containers app.
- `bunny containers delete <app>` (alias: rm) — Delete a Magic Containers app.

### `bunny scripting`

Edge Scripting deployments.

- `bunny scripting list` (alias: ls) — List edge scripts.
- `bunny scripting deploy <name>` — Deploy an edge script from a file (updates the script with that name, else creates it).
- `bunny scripting delete <script>` (alias: rm) — Delete an edge script.

### `bunny install`

One-shot bootstrap helpers (MCP config, ...).

- `bunny install mcp` — Register bunny-tools as an MCP server in Claude Code (one-shot bootstrap).

---

_Generated from `src/manifest/registry.ts` by `npm run gen:agents`. Do not edit auto sections by hand._
