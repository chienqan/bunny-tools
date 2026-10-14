# bunny-tools Project Roadmap

> **Historical record (0.1.x release candidates).** Command names in the rc entries below predate the 0.2.0 redesign (`storagezone` → `storage zone`, `pullzone` → `cdn`, ...). Current commands: [`../AGENTS.md`](../AGENTS.md); release history since 0.2.0: [`project-changelog.md`](project-changelog.md).

**Status:** Phases 1–7 Complete ✓ | v0.1.0-rc.26 Live | MCP E2E Harness + DNS REDIRECT E2E + PZ Hostname Management + SSL Provisioning Live ✓
**Current Version:** v0.1.0-rc.43 (shipped 2026-05-03)  
**Install:** `npm i -g bunny-tools`
**Release Cadence:** 13 RCs shipped (rc.14–rc.26) after rc.13
**Last Updated:** 2026-05-03

---

## Executive Summary

bunny-tools v0.1.0-rc.26 ships all **55 commands** live on npm (latest & alpha dist-tags). Phases 1–7 complete. **14 RCs shipped post-rc.13** (rc.14–rc.26).

**Key milestones (rc.14–rc.26):**
- **rc.14:** README rewrite; MCP front-and-center
- **rc.15:** CRITICAL: ESM main detection fix (bare `bunny` on -g installs)
- **rc.16:** `bunny --help` prints to stdout (wrangler convention)
- **rc.17:** `cdn` alias added for `pullzone` group (dashboard parity)
- **rc.18:** BREAKING: hyphen aliases (`pull-zone`, `storage-zone`, `edge-rule`) dropped; canonical flat form only + `cdn` retained
- **rc.19:** DX polish (4 wins): `init` writes AGENTS.md hint, `install mcp` self-bootstraps, `update` self-updates, wrangler-style help (no emoji)
- **rc.20:** Root help collapses 3+ segment commands for cleaner alignment
- **rc.21:** Subgroup help expands ALL leaf descendants
- **rc.22:** `install mcp` fix: correct npx invocation via `--` separator
- **rc.23:** **MCP e2e harness shipped** (13 active tools + 2 skipped); stdio recv fix
- **rc.24:** **DNS routing types extended** (REDIRECT, FLATTEN, PULLZONE, PTR, SCRIPT = 13 types total); rc.24 brings 129 unit + 44 e2e tests live
- **rc.25:** **Pull zone hostname management** - `pullzone hostname {list,add,remove}` wraps `addHostname`/`removeHostname` subresource (silent-drop fix); `dns record add --pull-zone` pre-flight check fails fast with copy-pasteable next command when hostname unlinked; 3 new MCP tools; 139 unit tests
- **rc.26:** **Pull zone SSL provisioning** - `pullzone hostname enable-ssl` wraps `loadFreeCertificate` and polls cert status (90s timeout); `dns record add --pull-zone` cert pre-flight surfaces missing cert with actionable next command; 1 new MCP tool; 143 unit tests
- **rc.27:** **Fix `loadFreeCertificate` HTTP shape** - endpoint is GET not POST (Bunny was returning 400 "The request is invalid"); add `useOnlyHttp01=false` so DNS-01 is preferred for Bunny-DNS-managed zones (works without pre-existing A records)
- **rc.28:** **Centralize PULLZONE pre-flight in core** - MCP `dns_record_set` and CLI `dns record add` without `--pull-zone` now also surface the helpful "hostname not linked / no SSL cert" error instead of Bunny's misleading "The pull zone ID is not valid"; test setup recreates MockAgent per-test (stops intercept leaks); 146 unit tests
- **rc.29:** **PULLZONE conflict detection** - pre-flight scans existing zone records for A/AAAA/CNAME/REDIRECT/FLATTEN/PULLZONE at the same Name and surfaces a copy-pasteable delete hint instead of letting Bunny return its opaque rejection; 149 unit tests
- **rc.30:** **PULLZONE field name fix + reverts rc.29** - Type-7 records now POST `PullZoneId` (numeric) instead of `LinkName` (string); was the actual root cause of "The pull zone ID is not valid" on bytek.org (verified live). rc.29's conflict-detection reverted (Bunny accepts PULLZONE+A coexistence). Plus: `pullzone hostname remove` corrected POST→DELETE, and `formatBunnyError` extracted to shared util so command handlers preserve `ErrorKey`/`Field` tags; 146 unit tests
- **rc.31:** **Drop init-time AGENTS.md write** - `bunny init` no longer touches the user's `AGENTS.md` (no major CLI modifies AI-context files on init). `--no-agents-md` flag removed. Discovery still covered by `bunny --help`, `bunny manifest`, and the AGENTS.md inside the npm tarball (MCP resource); 146 unit tests
- **rc.32:** **MCP e2e coverage for hostname tools** - `pullzone_hostname_{list,add,remove}` round-trip e2e on throwaway PZ; `enable_ssl` e2e gated on `BUNNY_E2E_CERT_DOMAIN` env var (real-domain DNS-01 challenge, ~30-90s); listTools count assertion bumped to ≥17; 146 unit + 45 e2e tests
- **rc.33:** **MIME complete + DX polish bundle** - `mime-types` package replaces manual table (covers `.webmanifest`, `.wasm`, `.opus`, etc.); `bunny.json deploy.mimeTypes` overrides; `bunny deploy --verbose` prints MIME per file; auto-migrate `deploy.ignore` to 15-entry rc.33+ baseline; MCP `dns_record_set` PULLZONE convenience via `pullZoneId`; auto-spawned PZ detection; >5MB warning; masked account-key on auth-skip; 157 unit tests
- **rc.34:** **Connect-Domain + CI generator + declarative edge rules** - atomic `bunny domain connect <pzId> <fqdn>` (addHostname → enable-ssl → optional Type-7 record); `bunny init --ci` generates `.github/workflows/bunny-deploy.yml` with secrets checklist; declarative `bunny.json deploy.headers` (Cloudflare/Netlify-style, smart Cache-Control compilation to OverrideCacheTime + OverrideBrowserCacheTime) + `deploy.edgeRules` (raw); auto-sync on deploy with `managed-by-bunny-tools:` marker; 173 unit tests; 56 commands, 19 MCP tools
- **rc.35:** **rc.34 live-test fixes + e2e** - SetResponseHeader compile fix (P1=name, P2=value; was combined string); idempotent sync no longer reports false `updated` count (trust description hash for identity); MCP `domain_connect` e2e gated on `BUNNY_E2E_CERT_DOMAIN`+`BUNNY_E2E_DNS_ZONE_ID`; live-verified on bytek.org (domain connect end-to-end in 2.5s; sync 4-stage round-trip clean); 173 unit + 46 e2e tests
- **rc.36:** **Auto-ForceSSL + orphan rule cleanup** - `enable-ssl` and `domain connect` auto-flip `ForceSSL=true` after cert lands (HTTP→HTTPS redirect, 2026 default), `--no-force-ssl` opt-out; new `pullzone hostname force-ssl` command + MCP tool; edge-rule sync now runs unconditionally with non-empty pullZones (was skipped when both arrays empty → orphaned managed rules on un-configure); 174 unit tests; 57 commands, 20 MCP tools
- **rc.37:** **Idempotent hostname `add` collapses 3 subcommands; `--no-X` flag bug fix** - BREAKING: removed `pullzone hostname enable-ssl` and `pullzone hostname force-ssl`; both rolled into idempotent `pullzone hostname add` (default: link + cert + ForceSSL on; `--no-force-ssl` flips OFF); fixed latent rc.30+ bug where Commander's `--no-X` negation was read incorrectly (silently always undefined); 55 commands, 18 MCP tools
- **rc.38:** **Sectioned root help; one line per service** - `bunny --help` now buckets commands into `GETTING STARTED` / `SERVICES` / `UTILITIES`; each top-level group (pullzone, dns, stream, etc.) collapses to a single `bunny <group> <subcmd>     <description> (N cmds)` row instead of fragmenting into multiple sub-group pointer rows; sub-group help unchanged (still expands all leaves); matches wrangler/gh/aws pattern; 174 unit tests

**Status:** GA-ready. All phases + MCP harness + DNS REDIRECT e2e live. Current backlog for v0.2: containers app create (Bunny v3 schema fix pending), headers/rewrites sugar, live emulator.

---

## Phase Breakdown

### Phase 1: Bootstrap & Foundations ✅ COMPLETE

**Duration:** 2–3 days (completed 2026-05-02)  
**Ships as:** (internal - no public release)  
**Status:** ✅ Complete

**Deliverables:**
- Registry-driven CLI architecture (`src/manifest/registry.ts`)
- HTTP client with 429/5xx retry + exponential backoff + Retry-After honor (`src/api/http.ts`)
- Config loaders: `bunny.json` + `.bunnyrc` (zod-validated)
- Credential resolver chain (flag → env → keychain → file → prompt)
- `bunny manifest` command (registry as JSON)
- Test suite: http, config, manifest layers (≥80% coverage)
- CI/CD: GitHub Actions (Node 20+22, ubuntu+macos)
- Generated artifacts: `manifest.json`, `AGENTS.md` skeleton, `schema/bunny.schema.json`

**Success Criteria Met:**
- ✅ `npm run build` → `dist/cli.js` executable
- ✅ `npm test` ≥80% coverage on api/config/manifest
- ✅ Cold-start <50ms (`bunny --help` ~22ms)
- ✅ `bunny manifest` outputs valid JSON
- ✅ Manifest.json/AGENTS.md/schema auto-generated; CI drift-check passes
- ✅ CI green on Node 20 + 22, ubuntu + macos
- ✅ No real network calls in tests (Nock enforced)
- ✅ Credentials never logged

**Tech Stack Locked:**
- Node 20+, TypeScript, Commander.js
- undici (HTTP), zod (validation), @napi-rs/keyring (keychain)
- Vitest + Nock (testing)
- esbuild (bundling)

---

### Phase 2: Alpha 1 - Deploy Loop

**Duration:** 1 week (week 2)  
**Ships as:** v0.1.0-alpha.1  
**Priority:** P0 (highest)  
**Status:** ✅ Complete (2026-05-02)

**Scope:**
- `bunny init` - unified interactive bootstrap (auth + feature multi-select + project config)
- `bunny auth set/list/clear` - low-level credential management
- `bunny use <alias>` - alias switching
- `bunny deploy` - storage sync + CDN purge (the money command)
- `bunny purge` - standalone cache purge by URL/tag/zone

**Core Components:**
- `src/core/deploy.ts` - business logic (walk, diff, upload pool, purge)
- `src/core/state.ts` - `.bunny-state.json` cache (optional warm-run optimization)
- Command implementations (6 commands, all active)
- Expanded tests for deploy loop (Nock-mocked)

**Validation:**
- User can `bunny init && bunny deploy` on fresh machine in <5 min
- Warm deploy <3s (after first run)
- Dry-run matches actual upload
- 429 backoff + retry tested
- Tag-based purge, full purge, per-URL purge all work

**Success Criteria:**
- ✅ `bunny deploy --dry-run` shows plan without side effects
- ✅ `bunny deploy` idempotent on unchanged files
- ✅ Warm run <3s (measured locally)
- ✅ Credentials from configure used by deploy
- ✅ 429 retried with backoff, succeeds
- ✅ Tests cover all paths (80%+ coverage extended)

**Risk:** Scope creep (init wizard complexity). Mitigation: hardcode sensible defaults; keep prompts to min.

---

### Phase 3: Alpha 2 - Storage & Zones

**Duration:** 1 week (week 3)  
**Ships as:** v0.1.0-alpha.2  
**Priority:** P1  
**Status:** ✅ Complete (2026-05-02)

**Scope:**
- `bunny storage:upload/download/list/delete/sync` (5 commands)
- `bunny storage-zone:list/get/create/update/delete` (5 commands)
- `bunny pull-zone:list/get/create/update/delete` (5 commands)
- `bunny pull-zone:edge-rule:list/add/delete` (3 commands)

**Core Components:**
- `src/core/storage.ts` - zone-aware uploads/downloads + regional endpoint selection
- `src/core/zones.ts` - storage-zone + pull-zone CRUD, ETag caching
- Command implementations (18 commands, all active)
- Comprehensive CRUD tests

**Validation:**
- All 18 commands callable; `--help --json` valid for each
- Storage upload to multiple zones works
- Pull zone creation + edge rule CRUD functional
- Zone metadata cached to warm future calls

**Success Criteria:**
- ✅ All 18 commands implemented + tested (≥80% coverage)
- ✅ No manual edge cases ignored (error handling comprehensive)
- ✅ `bunny storage-zone:list` paginated correctly (page=1, perPage=1000)

---

### Phase 4: Alpha 3 - DNS

**Duration:** 1 week (week 4, slip gate trigger)  
**Ships as:** v0.1.0-alpha.3  
**Priority:** P1  
**Status:** ✅ Complete (2026-05-02)  
**Slip Gate Decision:** On time! Phase 5 proceeds to v0.2 (no delay).

**Scope:**
- `bunny dns:list/get/create/delete` (4 commands)
- `bunny dns:record:list/add/update/delete` (4 commands)

**Core Components:**
- `src/core/dns.ts` - DNS zone + record CRUD
- Command implementations (8 commands, all active)
- Tests for DNS operations

**Validation:**
- All 8 commands callable
- Record create/update/delete idempotent
- TTL handling correct

**Slip Gate Decision:**
- **On time or early:** Proceed to Phase 5 as planned
- **>2 weeks elapsed:** Demote Phase 5 (Stream/Containers/Scripting) to v0.2; promote Phase 6 (MCP + docs) + Phase 7 (GA) to ship v0.1.0 after Phase 4 complete

**Rationale:** Deploy loop + storage + DNS cover 80% of user workflows. Stream/containers are nice-to-have; don't let them block GA.

---

### Phase 5: Alpha 4 - Stream / Containers / Scripting

**Duration:** 1 week (week 5)  
**Ships as:** v0.1.0-rc.10 (un-deferred)  
**Priority:** P2 (was demotable, now shipped)  
**Status:** ✅ COMPLETE (shipped rc.10; rc.12 fix: containers app create demoted to `planned`)

**Scope (shipped rc.10):**
- `bunny stream library list|create|get|delete` (4 commands - get/delete added rc.10)
- `bunny stream video list|upload|delete` (3 commands)
- `bunny scripting list|deploy|delete` (3 commands)
- `bunny containers app list|create|delete` (3 commands; `create` demoted rc.12 → v0.2 due to Bunny v3 schema mismatch)

**Changes in rc.12:**
- Containers app create moved to `planned` (Bunny v3 API schema incompatibility; defer to v0.2)
- Stream library delete command added (was missing in rc.10)
- All other Phase 5 commands remain active and functional

**Rationale:** Deploy loop (P2) + storage (P3) + DNS (P4) cover 80% of user workflows; adding Stream + Scripting (P5) covers remaining use cases without blocking GA. Containers create deferred due to Bunny v3 compatibility issue detected in rc.12.

**v0.2 Roadmap (Tentative):**
- Containers app create (schema fix pending Bunny v3 update)
- Headers/rewrites/redirects sugar in bunny.json
- Live e2e emulator (optional, for development)
- Possible HTTP MCP transport (for CLI integration via web)

---

### Phase 6: MCP Server & AI-Discovery Polish

**Duration:** 1 week (week 6)  
**Ships as:** v0.1.0-rc.1  
**Priority:** P1  
**Status:** ✅ Complete (2026-05-02)

**Scope:**
- `bunny mcp` - stdio server (MCP protocol)
- MCP tools mapping (all active commands → tools)
- MCP resources: `manifest`, `agents`, `config/current`
- AGENTS.md handcurated polish (quickstart, workflows, gotchas, MCP setup)
- Docs: system-architecture, code-standards, codebase-summary

**Core Components:**
- `src/mcp/server.ts` - stdio transport, JSON-RPC 2.0
- `src/mcp/tools/` - tool implementations (wrap core functions)
- `src/mcp/resources/` - read-only resources
- Final AGENTS.md + docs polish

**Validation:**
- `bunny mcp` boots, responds to tool calls
- `bunny manifest` JSON matches MCP tool list
- All tools accessible via Claude Code with `claude mcp add`
- AGENTS.md human-curated sections (quickstart, workflows) present + helpful

**Success Criteria:**
- ✅ MCP server registered in Claude Code
- ✅ Docs complete + accurate
- ✅ RC1 ready for beta testing

---

### Phase 7: GitHub Action & v0.1.0 GA Release

**Duration:** 1 week (week 7)  
**Ships as:** v0.1.0 (stable)  
**Priority:** P0  
**Status:** ✅ Complete (2026-05-02)

**Scope:**
- Composite GitHub Action (`bytekcorp/bunny-tools-deploy-action@v1`)
- npm publish: `bunny-tools@0.1.0`
- Floating tag: `v1` points to `v0.1.0`
- Public documentation (README polish)

**Action Deliverable:**
```yaml
- uses: bytekcorp/bunny-tools-deploy-action@v1
  with:
    version: 0.1.0
    account-key: ${{ secrets.BUNNY_ACCOUNT_KEY }}
    storage-password: ${{ secrets.BUNNY_STORAGE_PASSWORD }}
```

**Release Artifacts:**
- npm package: `bunny-tools@0.1.0`
- GH Releases page: tarball, CHANGELOG
- Action: `v1` tag (floating, updates minor/patch)

**Validation:**
- Action runs in CI; deploys successfully
- npm install globally works
- README examples work
- No security issues in dependencies

**Success Criteria:**
- ✅ npm package public + installable
- ✅ Action published + discoverable in GitHub Marketplace
- ✅ CI/CD complete + green
- ✅ Changelog complete + links work
- ✅ Docs links all valid

---

## RC Progression (rc.14 through rc.24)

Post-rc.13, 11 more release candidates shipped to npm (latest & alpha dist-tags) via OIDC trusted publishing. All RCs from rc.2–rc.24 shipped same project.

| RC | Date | Key Changes | Breaking? |
|----|----|---|---|
| rc.14 | 2026-05-03 | Bunny CLI + MCP Server README rewrite. MCP install front-and-center. New title. | - |
| rc.15 | 2026-05-03 | **CRITICAL:** Bare `bunny` silently exiting on -g installs (ESM symlink detection bug). Fixed via realpathSync + fileURLToPath. Adds regression test. | - |
| rc.16 | 2026-05-03 | Bare `bunny` prints help to stdout with exit 0 (wrangler convention). | - |
| rc.17 | 2026-05-03 | `cdn` alias for `pullzone` group (dashboard parity). Canonical stays `pullzone`. | - |
| rc.18 | 2026-05-03 | **BREAKING:** Dropped `pull-zone`, `storage-zone`, `edge-rule` hyphen aliases. Flat canonicals only; `cdn` retained. | **Yes** (hyphen aliases gone) |
| rc.19 | 2026-05-03 | **DX polish (4 GA wins):** `init` writes AGENTS.md `## Deploy` hint. `install mcp` self-bootstraps Claude config. `update` self-updates via npm (npx-mode + EACCES retry). Wrangler-style help (TITLE → USAGE → COMMANDS → FLAGS, no emoji). New `format-help.ts`. | - |
| rc.20 | 2026-05-03 | Root help collapses 3+ segment commands to 2-segment pointers (e.g., `bunny pullzone edgerule`). Cleans alignment. | - |
| rc.21 | 2026-05-03 | Subgroup help (e.g., `bunny stream --help`) expands ALL leaf descendants. | - |
| rc.22 | 2026-05-03 | Fix: `install mcp` passed `-y` to claude instead of npx. Inserted `--` separator. | - |
| rc.23 | 2026-05-03 | **MCP e2e harness shipped:** `test/e2e/mcp.e2e.ts` (13 active + 2 skipped) + `mcp-client.ts` helper. Also fixed spawn to forward process.execArgv for tsx dev mode. | - |
| rc.24 | 2026-05-03 | **DNS routing types extended:** REDIRECT, FLATTEN, PULLZONE, PTR, SCRIPT (13 types total). `dns record add` gets `--link-name` + `--pull-zone=<id>`. MCP enum extended. 7 new unit tests + REDIRECT e2e. | - |

**Install:** `npm i -g bunny-tools`  
**Test count:** 129 unit + 44 e2e (173 total)  
**Active commands:** 51

---

## Timeline (Phases Completed 2026-05-02; RCs through 2026-05-03)

```
Week 1 (May 2–8)      Phase 1: Bootstrap & Foundations       ✅ COMPLETE
                      → v0.1.0-alpha.0 internal

Week 2 (May 9–15)     Phase 2: Deploy Loop                   ✅ COMPLETE
                      → v0.1.0-alpha.1 release (SHIPPED)

Week 3 (May 16–22)    Phase 3: Storage & Zones               ✅ COMPLETE
                      → v0.1.0-alpha.2 release (SHIPPED)

Week 4 (May 23–29)    Phase 4: DNS (SLIP GATE)               ✅ COMPLETE
                      → v0.1.0-alpha.3 release (SHIPPED)
                      
                      DECISION: Phase 4 on time!
                      Phase 5 defers to v0.2 (preemptive scope cut)

Week 5 (May 30–Jun 5) Phase 5: Stream/Containers (deferred)  📦 → v0.2
                      (no v0.1.0-alpha.4 release)

Week 6 (Jun 6–12)     Phase 6: MCP + Docs Polish             ✅ COMPLETE
                      → v0.1.0-rc.1 release (SHIPPED)

Week 7 (Jun 13–19)    Phase 7: Action + GA                   ✅ COMPLETE
                      → v0.1.0 STABLE release (SHIPPED 2026-05-02)

---

**ACCELERATED TIMELINE:** All 7 phases shipped in 1 week (2026-05-02).
Phases 2–4, 6–7 completed. Phase 5 deferred to v0.2.
```

---

## Metrics & Success

### Per-Phase Success Criteria

| Phase | Deliverable | Metric |
|-------|-------------|--------|
| 1 ✅ | Foundations | Cold-start <50ms, ≥80% coverage, CI green |
| 2 ✅ | Deploy loop | `bunny deploy` <5 min setup, warm run <3s |
| 3 ✅ | Storage CRUD | All 18 commands callable, paginated correctly |
| 4 ✅ | DNS CRUD | All 8 commands callable, idempotent |
| 5 ✅ | Stream/Scripting | All 10 active commands callable (containers create → v0.2) |
| 6 ✅ | MCP + Docs | MCP server boots, docs complete |
| 7 ✅ | GA Release | npm installable, action published, green CI |

### Release Criteria

**Per alpha:**
- ✅ All commands for phase callable
- ✅ All tests passing (80%+ coverage)
- ✅ CI green (Node 20+22)
- ✅ No unresolved TODOs in code
- ✅ Version bumped

**v0.1.0 GA (ready for release; all gates passed rc.24):**
- ✅ All phases 1–7 complete
- ✅ E2E drift-detection harness live (30+ real-API tests, 8 services)
- ✅ MCP e2e harness live (13 active tools, 2 skipped)
- ✅ No regressions detected in 173 tests (129 unit + 44 e2e)
- ✅ npm @latest points to rc.24 (rc.38 drops the @alpha tag)
- ✅ GH Action v1 published
- ✅ Docs complete (README, architecture, code standards, codebase summary)
- ✅ Security audit passed (no secrets in repo, keychain optional)
- ✅ Performance targets met (cold-start ~22ms, warm deploy <3s)
- ✅ Breaking changes locked in (rc.18: hyphen aliases dropped)

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Bunny API changes mid-phase | Low | Medium | Weekly API check; vendor API responses in tests |
| Rate limit (429) tuning | Medium | Low | Default concurrency 8; document tuning; configurable |
| Keychain native module unavailable | Low | Low | Prebuilt @napi-rs/keyring binaries; graceful fallback to file |
| npm name `bunny-tools` taken | Medium | High | Verify before phase 2 publish; fallback `@bytekcorp/bunny-tools` |
| Slip gate triggers; scope grows | High | High | **Strict phase gating:** no phase starts until prior ships. Phase 5 explicitly demotable. |
| GH Action marketplace approval | Low | Low | Composite action (no build pipeline); pre-approve with GH Team |

---

## v0.2 Roadmap (Post-GA)

**Priority features deferred from v0.1:**
- **Stream library + video CRUD** (13 commands)
- **Magic Containers CRUD** (4 commands)
- **Edge scripting CRUD** (3 commands)
- **Headers/rewrites/redirects sugar** (`headers`, `rewrites`, `redirects` in bunny.json)
- **HTTP/SSE MCP transport** (CLI integration via web; stdio sufficient for v0.1)
- **Live e2e harness** (Nock coverage sufficient for v0.1)
- **Warm-run state caching** (`.bunny-state.json` hash-based optimization)

**Out of scope (maybe never):**
- Plugin system (revisit at 100+ commands)
- Telemetry (no plans)
- Multipart upload (single PUT covers <100MB cleanly)

---

## Ownership

| Phase | Lead | Status |
|-------|------|--------|
| 1 | chien | ✅ Complete |
| 2 | chien | ✅ Complete |
| 3 | chien | ✅ Complete |
| 4 | chien | ✅ Complete (SLIP GATE: on time!) |
| 5 | - | 📦 Deferred to v0.2 |
| 6 | chien | ✅ Complete |
| 7 | chien | ✅ Complete (GA shipped) |

---

## Key Decisions Locked In

✅ **Architecture:** Registry-driven CLI + core + api layers  
✅ **Tech Stack:** Node 20+, TS, Commander, undici, zod, @napi-rs/keyring  
✅ **Auth Model:** Honest 4-key; explicit credential scope per call  
✅ **Pagination:** Always page=1, perPage=1000 (avoid Bunny footgun)  
✅ **Retry:** 429/5xx exponential backoff + Retry-After honor, max 5 attempts  
✅ **Release cadence:** Internal alphas weekly; GA in week 7  
✅ **v0.1 Scope:** Full REST surface (phases 1–4 required; 5 demotable)  
✅ **CI:** GitHub Actions matrix (Node 20+22, ubuntu+macos)  
✅ **Testing:** Vitest + Nock; no live e2e  

---

## References

- **PDR:** `docs/project-overview-pdr.md`
- **Architecture:** `docs/system-architecture.md`
- **Code Standards:** `docs/code-standards.md`
- **Codebase Summary:** `docs/codebase-summary.md`
- **Phase 1 Plan:** `plans/260502-1748-bunny-tools-cli/phase-01-bootstrap-foundations.md`
- **Design Brainstorm:** `plans/reports/brainstorm-summary-260502-1748-bunny-tools-cli-design.md`
