# bunny-tools Architecture

**Applies to:** 0.2.0 · **Audience:** contributors and AI agents editing this repo.
Agents *using* the CLI should read [`AGENTS.md`](../AGENTS.md) first.

bunny-tools is a registry-driven CLI and MCP server over Bunny.net's REST API. One registry describes every command; the CLI, help output, `bunny manifest`, `AGENTS.md` and the JSON schema are all generated from it. CLI commands and MCP tools are thin adapters over the same `core/` functions.

## Layers

```
            user / CI                         AI agent
                │                                │
        src/cli.ts (Commander)            src/mcp/server.ts (stdio)
                │  builds tree from               │
        src/manifest/registry.ts          src/mcp/tools.ts (zod inputs)
                │  lazy load()                    │
        src/commands/<path>.ts                    │
          parse args → call core → render         │
                │   (src/ui/*: output, prompt,    │
                │    progress, table)             │
                └───────────────┬─────────────────┘
                                ▼
        src/core/*      business logic, no UI, no process.exit
        src/deploy/*    walk / diff / upload pool / state cache (used by core/deploy)
                                │
                                ▼
        src/api/*       Bunny REST clients: account, storage, stream
                        http.ts: AccessKey auth, retry 429/5xx with Retry-After, typed errors
                                │
        src/config/*    bunny.json, .bunnyrc, credential resolver
        src/util/*      logger (stderr), XDG paths, atomic JSON writes, MIME types
```

**Boundary rule (ESLint enforced):** `src/commands/**` and `src/mcp/**` must not import `src/api/*`. They call `src/core/*`. This keeps CLI and MCP behavior identical.

## Directory map

| Path | Owns |
| --- | --- |
| `src/cli.ts` | Builds the Commander tree from the registry, global flags (`-c`, `--cwd`, `-e`, `-p`) applied in a `preAction` hook, `--help-json`, error → exit code. |
| `src/manifest/registry.ts` | **Single source of truth**: command names, args, flags, examples, aliases, MCP mapping, group descriptions. |
| `src/manifest/format-help.ts`, `render-help.ts` | Wrangler-style text help and JSON help, both from the registry. |
| `src/commands/` | One file per command; the path mirrors the command (`storage zone list` → `commands/storage/zone/list.ts`). Each exports `run(inv): Promise<exitCode>`. |
| `src/mcp/` | `server.ts` (tools + resources `bunny://manifest`, `bunny://agents`, `bunny://config/current`), `tools.ts` (23 tools; list tools return compact shapes unless `full: true`). |
| `src/core/storage-ops.ts` | `<zone>/<path>` parsing, per-zone region + credential resolution, ls/upload/download/rm/sync primitives, password stripping. |
| `src/core/scoped-key-resolver.ts` | Storage zone password / Stream library key fallback via the account key. |
| `src/core/resolve.ts` | Name/domain → id for pull zones, DNS zones, storage zones, libraries, scripts, container apps. |
| `src/core/zones.ts` | Storage zone + pull zone CRUD, edge rules, hostnames, SSL provisioning. |
| `src/core/dns.ts`, `domain.ts` | DNS records (incl. PULLZONE pre-flight) and the one-step Connect Domain flow. |
| `src/core/purge.ts` | Purge request → targets → API calls. |
| `src/core/deploy.ts` + `src/deploy/` | Static-site deploy pipeline (see below). |
| `src/core/init.ts`, `configure.ts`, `auth.ts`, `aliases.ts` | Project bootstrap, credential profiles, `.bunnyrc` aliases. |
| `src/api/` | `account.ts` (api.bunny.net), `storage.ts` (regional storage endpoints), `stream.ts` (video.bunnycdn.com), `http.ts`, `errors.ts`. |
| `src/ui/output.ts` | The output contract: `printJson`, `printList`, `reportDone`, `confirmDestructive`. |
| `scripts/` | Generators: `gen:manifest` (`manifest.json`), `gen:agents` (`AGENTS.md` auto section), `gen:schema` (`schema/bunny.schema.json`). |

## Command conventions

```
bunny <resource> [<sub-resource>] <verb> [args] [flags]
```

- **Verbs:** `list` (alias `ls`), `get`, `create`, `update`, `delete` (alias `rm`). Storage file commands are `ls`, `upload`, `download`, `rm`, `sync`. Hostnames use `add`/`remove` (link/unlink).
- **References:** pull zones, storage zones, libraries, scripts and apps accept a name or id (`core/resolve.ts`); DNS zones accept a domain or id. Numeric refs skip the lookup request.
- **Storage addressing:** `<zone>/<path>`; a trailing slash means "directory" (upload keeps the local file name). `.`/`..` segments and `?`, `#`, `\` are rejected (URL parsing would retarget them at a parent directory), every segment is percent-encoded in `api/storage.ts`, and deleting a directory requires `-r`. Region codes are validated before they become a hostname label.
- **Output:** stdout is the result only. `--json` on every command that prints a result. Progress and human success lines go to stderr (`src/ui/progress.ts`).
- **Exit codes:** `0` ok · `1` error, bad input, aborted · `2` partial failure (deploy, sync, purge).
- **Destructive commands:** `confirmDestructive()`; `--yes`/`-y` required when not interactive (`BUNNY_NONINTERACTIVE=1` forces that).
- **Errors:** thrown from core as `ValidationError` / `ConfigError` / `AuthError` / `BunnyApiError`; `cli.ts` formats them and exits 1. Messages name the next command to run.

## Credentials

Four scopes, all sent as the `AccessKey` header: `account`, `storage:<zone>`, `stream:<libraryId>`, `database:<name>`.

`config/credential-resolver.ts` resolves a scope for the active profile:

```
--flag → scoped env (BUNNY_STORAGE_PASSWORD_<ZONE>) → generic env (BUNNY_STORAGE_PASSWORD)
       → OS keychain "<profile>:<scope>" → ~/.config/bunny-tools/credentials.json
```

Callers pass `{ genericEnv: false }` when they can fetch the exact per-zone key, so the generic variable (one value for every zone) is consulted only as a last resort.

`core/scoped-key-resolver.ts` wraps that for `storage` and `stream` scopes: stored key for that exact zone/library → fetched with the account key → generic env var. When nothing zone-specific is stored, it fetches the zone `Password` (`GET /storagezone`) or library `ApiKey` (`GET /videolibrary/{id}`) with the account key, memoizes it in process memory, and never writes it to disk. `core/storage-ops.ts` reuses the zone metadata it already fetched for the region, so a storage command makes one account call plus the storage calls.

Active profile: `--profile` / `-p` → `BUNNY_PROFILE` → `active` in the credentials file → `default`.

Secrets never reach output: `toPublicZone()` and `toPublicLibrary()` strip passwords/API keys from every storage zone and library result (CLI and MCP).

## Request flows

### `bunny storage ls my-zone/img`

1. `cli.ts` matches `storage ls`, lazy-loads `commands/storage/ls.ts`.
2. `parseStorageTarget('my-zone/img')` → `{ zone: 'my-zone', path: '/img', isDir: false }`.
3. `listPath()` → `openZone()`: account API lookup of the zone → region subdomain + known password.
4. Storage client lists `https://<region>.storage.bunnycdn.com/my-zone/img/` with the zone password (stored key wins if present).
5. `printList()` renders a table, or JSON with `--json`.

With no argument, `ls` calls `listZones()` (account API only).

### `bunny deploy`

`core/deploy.ts` emits typed events that `commands/deploy.ts` renders (and MCP returns as a summary):

```
resolve-region → walk (public dir, ignore rules) → remote-list → diff (SHA vs cache + remote checksum)
  → upload (parallel pool, src/deploy/upload-queue.ts) → delete orphans (--delete)
  → edge-rules-sync (from bunny.json) → purge (per pull zone: all | tag:<t> | none)
```

The SHA cache lives in `.bunny-state.json` (gitignored) so unchanged files are skipped without hashing the remote.

### MCP tool call

`server.ts` looks up the tool in `TOOLS`, which validates input with zod, calls the same core function as the CLI, and returns JSON. `bunny.run` spawns the CLI itself for anything without a dedicated tool.

## Configuration files

| File | Scope | Purpose |
| --- | --- | --- |
| `bunny.json` | project, git-tracked | `deploy.publicDir`, `storageZone`, `region`, `ignore`, `concurrency`, `pullZones[{id, purge}]`, edge rules. Schema: `schema/bunny.schema.json`. Found by walking up from cwd; `-c` overrides (`BUNNY_CONFIG_PATH`). |
| `.bunnyrc` | developer, gitignored | Named aliases overlaying `storageZone`/`pullZones`; `bunny use <alias>` or one-shot `-e` (`BUNNY_ALIAS`). |
| `~/.config/bunny-tools/credentials.json` | user | Profiles of scopes when the OS keychain is unavailable (mode 0600). `XDG_CONFIG_HOME` respected. |

## Adding a command

1. Add a `CommandSpec` to `src/manifest/registry.ts`: follow the naming rules at the top of that file, add `aliases: ['ls']`/`['rm']` for list/delete verbs, give `--json` and (if destructive) `--yes`, and at least one example for non-trivial commands. Summaries must fit in 90 characters.
2. Create `src/commands/<path>.ts` exporting `run(inv)`. Parse `inv.args`/`inv.flags`, resolve refs with `core/resolve.ts`, call core, render with `ui/output.ts`. Required args are enforced by Commander, so no manual usage checks.
3. Put API/business logic in `src/core/` (and a client method in `src/api/` if needed). Never import `src/api/*` from commands or MCP.
4. Optionally expose an MCP tool in `src/mcp/tools.ts` (keep the total ≤ 22) and set `mcp: { tool }` on the spec.
5. Tests: unit tests under `test/core/` with undici `MockAgent` (see `test/setup.ts`); the registry and examples tests catch naming/alias/example drift.
6. Run `npm run gen:all` and commit `manifest.json`, `AGENTS.md`, `schema/bunny.schema.json`. CI runs `npm run verify:drift`.

## Testing

- `npm test`: Vitest unit tests; network is blocked, HTTP is mocked per test with `MockAgent`.
- `npm run test:e2e`: live-account suite (`test/e2e/`), creates and cleans up real resources; see [`e2e-testing.md`](e2e-testing.md).
- `npm run typecheck`, `npm run lint`, `npm run verify:drift`.

## Design decisions

- **Registry over hand-wired commands:** one place to change a command; help, manifest, AGENTS.md and MCP mapping cannot drift.
- **Core is UI-free:** commands and MCP tools share it, so behavior is identical across surfaces and testable without a TTY.
- **Pagination always `page=1, perPage=1000`:** Bunny's `page=0` returns a bare array instead of the paged envelope.
- **Scoped secrets derived, not stored:** fewer prompts, no stale copies on disk, rotation picked up on the next run.
- **Lazy command loading:** `load()` imports only the invoked command, keeping startup fast.
