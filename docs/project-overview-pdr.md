# bunny-tools: Product Overview & Development Requirements

**Status:** v0.1.0-rc.24 (Live on npm; latest & alpha channels. 12 RCs shipped post-rc.13.)  
**Version:** 0.1.0-rc.24  
**Created:** 2026-05-02  
**Current Release:** 2026-05-03 (rc.24 final: DNS routing types extended, MCP e2e harness live, help renderer polished)  
**Release Cadence:** 11 RCs shipped (rc.14 through rc.24 post-rc.13)  
**Package:** `bunny-tools` (npm)  
**Binary:** `bunny`  
**License:** MIT  
**Repository:** `chienqan/bunny-tools`

---

## Problem Statement

Deploying static assets to Bunny.net requires repeating a manual workflow per project:
1. Research Bunny REST API surface
2. Obtain/manage multiple credential types (Account, Storage Zone, Stream, Database)
3. Construct regional endpoint URLs
4. Handle rate-limiting (429) and transient failures (5xx)
5. Orchestrate storage uploads + CDN cache purge as separate commands

No official Bunny CLI exists. Community alternatives (4 total) handle storage-only, lack purge orchestration, and have no GitHub Actions story. Result: friction in daily deploy loops and no parity between local dev and CI/CD.

---

## Goals

**v0.1 Primary**
- Frictionless daily deploy loop: `bunny deploy` syncs storage zone + purges pull zone (one command, idempotent, warm-run <3s)
- Manual + CI parity: same command, same credentials model in terminal and GitHub Actions
- Full Bunny.net resource surface (v0.1): CRUD for storage zones, pull zones, DNS, Stream, Magic Containers, edge scripting (phased alpha releases)
- Honest 4-key auth model: explicit credential scope handling (Account / Storage Zone / Stream / Database) without false unification
- Frictionless ergonomics: single binary, JSON config (`bunny.json`), interactive setup (`bunny init`), no poetry/containers/complex setup

**Acceptance Criteria**
- `npm install -g bunny-tools` → `bunny deploy` works on fresh machine in <5 min (with credentials)
- `bunny deploy --dry-run` + `bunny deploy` idempotent on warm runs (<3s)
- `npm test` ≥80% coverage on http + config + manifest layers
- Cold-start `bunny --help` <50ms
- CI drift-check: `manifest.json`, `AGENTS.md`, `schema/bunny.schema.json` generated from registry; CI verifies no manual edits
- All 51 v0.1 commands discoverable via `bunny manifest` JSON
- No real network calls in test suite (Nock-enforced)

---

## Non-Goals (v0.1 / Explicitly Deferred)

- **Live emulator** - Mock with Nock in tests; no local Bunny simulation
- **Plugin system** - Defer until 100+ commands or external request
- **Telemetry** - No phone-home or tracking
- **`headers`/`rewrites`/`redirects` sugar** - Deferred to v0.2 (requires edge-rule sync); raw CRUD lands v0.1
- **Multipart upload** - Bunny undocumented; single PUT + retry covers <100MB cleanly

---

## Target Personas

| Persona | Use Case | Success Metric |
|---------|----------|-----------------|
| **Web Dev** | Deploy static site weekly via laptop + GitHub Actions | Credential flow <2 min; warm deploy <3s |
| **DevOps Engineer** | Multi-env deployment (prod/staging/preview branches) | `bunnyrc` alias switching; CI secret management |
| **AI Agent** | Discover + execute commands programmatically | `bunny manifest` JSON; MCP stdio server (P6) |
| **Platform Builder** | Expose Bunny resource CRUD in internal tooling | REST parity; typed command args/flags via registry |

---

## Key Architectural Decisions

| # | Decision | Why |
|---|----------|-----|
| D1 | Node 20+, TypeScript, Commander.js | Speed (~22ms baseline), zero deps, ubiquity in target audience |
| D2 | `src/core/*` business-logic layer (no UI, no `console.log`, no `process.exit`) | Shared by CLI + MCP (P6); single source of truth; testable in isolation |
| D3 | Registry-driven CLI: `src/manifest/registry.ts` is canonical command source | All surfaces (help, JSON, AGENTS.md, schema, MCP defs) generated from one registry; no hand-wiring; easy to add commands |
| D4 | Auth: explicit 4-key model (`account` / `storage:<zone>` / `stream:<lib>` / `database:<name>`) | Honest to Bunny's architecture; per-call-site credential resolution; prevents fake unification |
| D5 | Credential resolver chain: flag → scoped env → generic env → keychain → file → prompt | Flexible per deployment context; CI-friendly (env vars); local-friendly (keychain); interactive fallback |
| D6 | `bunny.json` (git-tracked, project) + `.bunnyrc` (gitignored, aliases) | Per-project config + per-developer aliases; zod-validated; JSON Schema published for editor support |
| D7 | HTTP client: undici + 429/5xx exponential backoff + jitter + Retry-After honor | Connection reuse for small PUTs; rate-limit resilience; configurable timeout |
| D8 | Pagination: always `page=1, perPage=1000` | Avoids Bunny's `page=0` array footgun on large accounts |
| D9 | Test stack: Vitest + Nock | Isolated HTTP mocking; no live e2e; fast feedback; Node ecosystem standard |
| D10 | Phased delivery (alpha releases within v0.1) | Deploy loop dogfoodable week 1; full surface by week 5; user feedback before GA |

---

## Technical Constraints

| Constraint | Rationale |
|-----------|-----------|
| **Node 20+** | Target audience (web devs) universally available; GitHub Actions CI ready |
| **MIT License** | Community-friendly; compatible with web dev ecosystem |
| **Zero runtime deps** (besides commander, undici, zod, @napi-rs/keyring, picocolors, ora) | Minimal supply chain risk; lean installation |
| **CommonJS + ESM hybrid ready** | npm v20 support; future TypeScript best-practice alignment |
| **CLI first, library second** | Primary UX is `bunny` binary; programmatic access via core layer + MCP (P6) |
| **No breaking changes in 0.1.x** | GA release should be stable; pre-GA alphas free to iterate |

---

## Success Metrics (All Phases Complete)

| Phase | Release | Metric | Status |
|-------|---------|--------|--------|
| 1 | (internal) | Cold-start `bunny --help` | ✅ ~22ms |
| 1 | (internal) | Test coverage (all layers) | ✅ ≥80% |
| 1 | (internal) | CI drift-check | ✅ artifact sync passing |
| 2 | alpha.1 | `bunny deploy` E2E (dry-run + real) | ✅ Nock-mocked, working |
| 3 | alpha.2 | Storage + zone CRUD functional | ✅ All 18 commands active |
| 4 | alpha.3 | DNS CRUD functional | ✅ All 8 commands active |
| 5 | shipped rc.10 | Stream/Containers/Scripting | ✅ All 11 commands active |
| 6 | rc.1 | MCP server + docs | ✅ 15 tools, 3 resources |
| 7 | rc.10 | GH Action + npm publish (OIDC) | ✅ Tagged v0.1.0-rc.10 |
| **Live now** | npm/latest+alpha | 51 commands + 129 unit + 44 e2e tests | ✅ rc.14–rc.24 shipped |
| **GA gate** | e2e-nightly | Live drift-detection harness + DNS REDIRECT e2e | ✅ Harness active |

---

## Release Cadence (rc.14 through rc.24)

All releases published to npm under `latest` and `alpha` dist-tags (via OIDC trusted publishing; no NPM_TOKEN).

- **v0.1.0-rc.14** (2026-05-03): Bunny CLI and MCP Server README rewrite; MCP install front-and-center; new title emphasis.
- **v0.1.0-rc.15** (2026-05-03): **CRITICAL:** bare `bunny` silently exiting on globally-installed binary (npm install -g). Fixed via realpathSync symlink + fileURLToPath for ESM main detection. Adds `test/cli-main-detection.test.ts` regression test.
- **v0.1.0-rc.16** (2026-05-03): Bare `bunny` now prints help on STDOUT with exit 0 (wrangler convention). New default action calling `program.outputHelp()`.
- **v0.1.0-rc.17** (2026-05-03): `cdn` added as CLI alias for `pullzone` group. Dashboard sidebar terminology; canonical stays `pullzone` aligned with API.
- **v0.1.0-rc.18** (2026-05-03): **BREAKING (pre-GA):** dropped `pull-zone`, `storage-zone`, `edge-rule` hyphen aliases. Flat canonicals only; `cdn` retained as single group alias.
- **v0.1.0-rc.19** (2026-05-03): **DX polish (4 wins for GA):** `bunny init` writes AGENTS.md `## Deploy` hint; `bunny install mcp` self-bootstraps Claude config; `bunny update` self-updates via npm with npx-mode detection + EACCES retry hints; wrangler-style help layout (TITLE → USAGE → COMMANDS grouped → FLAGS, no emoji). New `src/manifest/format-help.ts`.
- **v0.1.0-rc.20** (2026-05-03): Root help collapses 3+ segment commands to 2-segment subgroup pointers (e.g., `bunny pullzone edgerule ...`) for clean alignment. Long arg signatures no longer break columns.
- **v0.1.0-rc.21** (2026-05-03): Subgroup help (e.g., `bunny stream --help`) now expands ALL leaf descendants regardless of depth. Previously showed only sub-pointers, leaving stream-level commands hidden.
- **v0.1.0-rc.22** (2026-05-03): Fix: `bunny install mcp` was passing `-y` to claude itself instead of npx. Inserted `--` separator: `claude mcp add bunny-tools -- npx -y bunny-tools mcp`.
- **v0.1.0-rc.23** (2026-05-03): **MCP e2e harness shipped:** `test/e2e/mcp.e2e.ts` (13 active + 2 skipped) + `helpers/mcp-client.ts`. Spawns `bunny mcp`, connects MCP SDK Client over stdio, exercises every active tool. Also fixed `bunny.run` in tsx (dev) mode: spawn now forwards `process.execArgv`.
- **v0.1.0-rc.24** (2026-05-03): **DNS routing types extended:** REDIRECT (5), FLATTEN (6), PULLZONE (7), PTR (10), SCRIPT (11). `dns record add` gets `--link-name` (raw) and `--pull-zone=<id>` (auto-resolves pz name + linkName). `bunny.dns_record_set` MCP enum extended to all 13 types. 7 new unit tests + REDIRECT e2e round-trip.

All shipped same project (no split); 129 unit tests + 44 e2e tests passing; 51 active commands. Repository PUBLIC.

---

## Command Taxonomy (v0.1.0-rc.24 - 51 Active Commands)

**Setup & Daily:**
- `bunny init [dir]` - auth + feature multi-select + per-feature config
- `bunny configure` - profile-aware credential walkthrough (rc.9+)
- `bunny configure list|switch|remove` - multi-account management (rc.9+)
- `bunny deploy [--dry-run]` - storage sync + CDN purge (the main command)
- `bunny purge <target>` - standalone cache purge by URL/tag/zone
- `bunny whoami` - show active credentials (rc.8+)
- `bunny docs [topic]` - quick help (rc.8+)
- `bunny install mcp` - self-bootstrap Claude config (rc.19+)
- `bunny update` - self-update via npm (rc.19+)

**Storage (with auto-default zone rc.10+):**
- `bunny storage upload|download|list|delete|sync`

**Zones (space-delimited syntax rc.7+; hyphen aliases rc.18 DROPPED):**
- `bunny storagezone list|get|create|update|delete` (canonical only)
- `bunny pullzone list|get|create|update|delete` (canonical only; `cdn` alias for group, rc.17)
- `bunny pullzone edgerule list|add|delete` (canonical only)

**DNS (13 record types as of rc.24, up from 8 in rc.23):**
- `bunny dns list|get|create|delete`
- `bunny dns record list|add|update|delete` (A, AAAA, ALIAS, CNAME, TXT, NS, MX, SRV, CAA, REDIRECT, FLATTEN, PULLZONE, PTR, SCRIPT - rc.24 extended)

**Stream (Phase 5, shipped rc.10):**
- `bunny stream library list|create|get|delete` (get/delete rc.10+)
- `bunny stream video list|upload|delete`

**Magic Containers (Phase 5, shipped rc.10):**
- `bunny containers app list|create|delete` (create → planned in rc.12, v0.2)

**Edge Scripting (Phase 5, shipped rc.10):**
- `bunny scripting list|deploy|delete`

**Discovery & Config:**
- `bunny manifest [--pretty --names]` (--names rc.10+)
- `bunny mcp` - MCP stdio server (rc.23: e2e harness live)
- `bunny use <alias>` - alias switching


---

## Dependencies & Infrastructure

**Runtime**
- `commander` - CLI framework
- `undici` - HTTP client
- `zod` - validation
- `@napi-rs/keyring` - OS keychain (prebuilt native, no install scripts; graceful fallback to file)
- `picocolors` - terminal colors
- `ora` - progress spinner
- `ignore` - gitignore parser
- `fast-glob` - file traversal
- `prompts` - interactive input

**Dev**
- `typescript` - strict mode, ES2022 target
- `vitest` + `nock` - unit tests + HTTP mocking
- `esbuild` - build
- `eslint` + `prettier` - lint + format

**CI/CD**
- GitHub Actions (Node 20 + 22, ubuntu-latest + macos-latest)
- Drift check: registry → manifest.json/AGENTS.md/schema auto-generated

---

## Ownership

**Project Lead:** chien  
**Initial Commit:** 2026-05-02  
**Repo:** https://github.com/chienqan/bunny-tools
