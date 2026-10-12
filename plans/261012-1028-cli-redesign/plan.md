# CLI redesign 0.2.0 — easy to remember, agent-friendly

Status: implemented 2026-10-12 (unit tests + live read-only smoke pass; e2e not run)

## Outcome
- A human can list/upload/delete storage without knowing zone passwords or the `storage` vs `storagezone` split.
- No command requires remembering a numeric id when a name/domain exists.
- Every command is scriptable by an agent: `--json` output, `--yes` for destructive ops, errors that name the next command.
- README + AGENTS.md + docs/system-architecture.md describe the new tree; an agent can learn the whole CLI from AGENTS.md alone.

## Decisions (user)
- Storage: aws-s3 style, zone in path (`my-zone/path`). `bunny storage ls` with no arg lists zones.
- Old names removed (no hidden aliases). Bump to 0.2.0, changelog carries a migration table.
- Pull zones / DNS zones accept name/domain or id.
- Purge: `bunny purge <url...>` / `--pull-zone <name|id>`.
- `pullzone` → `cdn`, `edgerule` → `rule`; `containers app *` → `containers *`; MCP tool names mirror new tree.
- `configure` kept (Bunny has no OAuth login).

## Constraints / non-goals
- Core + API layer boundaries unchanged (commands → core → api).
- No new Bunny features; behavior changes only where listed.
- `deploy`, `init`, `use`, `bunny.json`, `.bunnyrc` formats unchanged.

## Proposed command tree

| New | Replaces |
|---|---|
| `configure`, `configure list\|switch\|remove` | unchanged (Bunny has no login flow; API key paste) |
| `whoami`, `init`, `use`, `deploy` | unchanged |
| `purge <url...>` · `purge --pull-zone <name\|id> [--tag <t>]` | `purge <url>\|pullzone:<id>` |
| `storage ls [zone[/path]] [-r]` | `storage list --zone` + `storagezone list` |
| `storage upload <local> <zone/path>` | `storage upload --zone` |
| `storage download <zone/path> [local]` | `storage download --zone` |
| `storage rm <zone/path> [-r]` | `storage delete --zone` |
| `storage sync <dir> <zone[/path]>` | `storage sync --zone` |
| `storage zone list\|get\|create\|update\|delete` | `storagezone *` |
| `cdn list\|get\|create\|update\|delete` | `pullzone *` |
| `cdn hostname list\|add\|rm <pz> …` | `pullzone hostname *` |
| `cdn rule list\|add\|rm <pz> …` | `pullzone edgerule *` |
| `domain connect <pz> <host> [--dns-zone <domain\|id>]` | same, names accepted |
| `dns list\|get\|create\|delete [<domain\|id>]` | `dns *` (id only) |
| `dns record list\|add\|update\|delete <domain\|id> …` | `dns record *` (id only) |
| `stream library list\|create\|delete`, `stream video list\|upload\|delete <lib>` | same, library name accepted |
| `containers list\|create\|delete` | `containers app *` |
| `scripting list\|deploy\|delete` | same, script name accepted |
| `manifest`, `mcp`, `install mcp`, `update`, `docs` | unchanged |

Verb aliases (not legacy): every `list` also answers to `ls`, every `delete` to `rm`.

## Behavior fixes
1. Storage password auto-derived: missing `storage:<zone>` credential + account key → fetch zone `Password` via `GET /storagezone`, cache in active profile. Explicit password still wins.
2. `--json` on every command that prints a result (get/create/delete/upload/…).
3. Resolver helpers in core: `resolvePullZoneId(nameOrId)`, `resolveDnsZoneId(domainOrId)`, `resolveLibraryId`, `resolveScriptId`, `resolveAppId` — numeric passes through, else lookup by name, clear error listing near matches.
4. Stale usage strings (`storage-zone:get`, `pull-zone:delete`) replaced by registry-derived usage.
5. MCP tool names mirror the tree (`bunny.storage_ls`, `bunny.storage_zone_list`, `bunny.cdn_hostname_add`, …) and accept names.

## Docs
- README: rewritten command reference around the new tree + "concepts" box (account key vs zone password is automatic).
- AGENTS.md hand-curated section: quickstart, common workflows, addressing rules (`zone/path`, name-or-id), output/exit-code contract, short architecture map.
- docs/system-architecture.md: compact current architecture (layers, request flow, credential resolution, how to add a command). Drop stale rc.* status sections.
- docs/project-changelog.md: 0.2.0 entry + migration table.

## Acceptance
- `npm run typecheck && npm run lint && npm test` green; `npm run verify:drift` clean after regen.
- New unit tests: storage path parsing, password auto-derivation, name→id resolvers, purge arg parsing.
- `bunny storage ls` works with only an account key stored.

## Risks
- Breaking change for 0.1.x scripts → mitigated by 0.2.0 bump + migration table.
- e2e suite (live Bunny account) references old names → update; run only if creds available.
