# bunny-tools Code Standards & Engineering Rules

**Version:** v0.1.0-rc.24  
**Last Updated:** 2026-05-03
**Status:** 51 active commands, space-delimited naming (rc.7+), canonical flat forms only (rc.18+), multi-account profiles, zone auto-defaults, vitest 4.x, e2e harness + MCP harness live

---

## Principles

**YAGNI** (You Aren't Gonna Need It) - don't build for v0.2 in v0.1  
**KISS** (Keep It Simple, Stupid) - favor clarity over cleverness  
**DRY** (Don't Repeat Yourself) - extract to `src/core/*` when used 2+ places

---

## File Organization

### Naming Conventions

| Type | Convention | Example |
|------|-----------|---------|
| TypeScript source | kebab-case | `credential-resolver.ts`, `render-help.ts` |
| Test files | `{source}.test.ts` | `http.test.ts` |
| Build scripts | kebab-case .ts | `post-build.ts`, `generate-manifest.ts` (tsx runner) |
| Directories | kebab-case | `src/api/`, `src/manifest/`, `src/commands/pull-zone/` |
| Command names (registry) | space-delimited | `pullzone edgerule add` (directory: `src/commands/pull-zone/edge-rule/`) |
| Command names (CLI output) | flattened or hyphenated | `bunny pullzone edgerule add` or `bunny pull-zone edge-rule add` (aliases, rc.10+) |

**Rationale:** 
- Source files: kebab-case for filesystem readability
- Command names: space-delimited in registry (canonical, rc.7+); directories use kebab-case; **canonical flat form only at CLI (rc.18+)**; hyphen aliases dropped pre-GA except `cdn` (alias for `pullzone` group)
- Self-documenting names help LLM tools understand purpose without reading content

### File Size

**Target:** ≤200 lines per file (strict for `src/`, lenient for tests)

When a file approaches 200 LOC:
1. Identify logical boundaries (functions, classes, concerns)
2. Extract cohesive units to sibling modules
3. Prefer composition (shared functions) over inheritance

**Rationale:** Smaller files → easier to understand, test, review; fits in single LLM context window.

### Directory Structure

```
src/
├── cli.ts                     # Commander entry, registry reader, lazy loader
├── commands/
│   └── manifest.ts            # One file per active command
├── core/
│   ├── README.md              # Invariant doc: no UI, no network direct calls
│   └── (populated P2+)         # deploy.ts, zones.ts, etc.
├── api/
│   ├── http.ts                # undici client, retry, auth injection
│   └── errors.ts              # BunnyApiError, AuthError, etc.
├── config/
│   ├── bunny-json.ts          # zod schema + loader
│   ├── bunnyrc.ts             # alias resolver
│   └── credential-resolver.ts # 4-step chain + keychain wrapper
├── manifest/
│   ├── registry.ts            # ★ Single source of truth
│   ├── types.ts               # CommandSpec, ArgSpec, FlagSpec
│   └── render-help.ts         # text help, JSON help from registry
└── util/
    ├── logger.ts              # stderr only, LOG_LEVEL env
    ├── paths.ts               # XDG-compliant config dir
    └── fs.ts                  # atomic writes, JSON helpers

test/
├── setup.ts                   # Vitest config, Nock disable
├── api/http.test.ts
├── config/bunny-json.test.ts
├── config/credentials.test.ts
├── manifest/registry.test.ts
└── manifest/render-help.test.ts

scripts/
├── post-build.ts              # called after tsc; runs generators
├── generate-manifest.mjs      # registry → manifest.json
├── generate-agents.mjs        # registry → AGENTS.md
└── generate-schema.mjs        # zod schemas → bunny.schema.json
```

---

## Command Registration (rc.7+ Space-Delimited)

### Registry Entry

Commands declared in `src/manifest/registry.ts` with space-delimited names:

```ts
{
  name: 'pullzone edgerule add',              // Space-delimited canonical
  summary: 'Add edge rule to a pull zone',
  description: '...',
  args: [
    { name: 'pullZoneId', ... },
    { name: 'ruleJson', ... }
  ],
  flags: [ ... ],
  examples: [ ... ],
  load: () => import('../commands/pull-zone/edge-rule/add.js'),
}
```

### File Organization

Directory structure mirrors CLI tree but uses kebab-case:

```
src/commands/
├── manifest.ts
├── init.ts
├── deploy.ts
├── storage/
│   ├── upload.ts
│   └── ...
├── pull-zone/              # Directory: kebab-case
│   ├── list.ts
│   ├── create.ts
│   └── edge-rule/          # Nested subdir for 3-level commands
│       ├── list.ts
│       ├── add.ts
│       └── delete.ts
```

### Group Descriptions (rc.10+)

Registry groups declare metadata used by CLI:

```ts
{
  groups: [
    { name: 'pullzone', description: 'Manage pull zones (CDN).', aliases: ['pull-zone'] },
    { name: 'pullzone edgerule', description: 'Manage edge rules.', aliases: ['edge-rule'] },
  ],
}
```

CLI walker creates intermediate group commands with these descriptions; `bunny --help` shows real prose, not stubs.

### Aliases (rc.17+; Hyphen Aliases Dropped rc.18)

**rc.10–rc.17:** Any group could declare aliases in `.aliases[]` (hyphen forms like `pull-zone`, `storage-zone`, `edge-rule`).

**rc.18 (BREAKING):** Hyphen aliases dropped pre-GA. Only canonical flat forms work:
```bash
bunny pullzone list           # canonical (works)
bunny pull-zone list          # hyphen alias (dropped rc.18 - DOES NOT WORK)
bunny storagezone create ...  # canonical (works)
bunny storage-zone create ... # hyphen alias (dropped rc.18 - DOES NOT WORK)
```

**Exception:** `cdn` alias retained for `pullzone` group (dashboard parity):
```bash
bunny cdn list               # alias for `bunny pullzone list`
```

**Rationale:** Simpler CLI surface for GA. No duplication in help trees. Users adjust muscle memory to canonical form once.

---

## Language & Syntax

### TypeScript

**Config:** `tsconfig.json` with strict mode enabled

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "NodeNext",
    "declaration": false,
    "outDir": "dist",
    "sourceMap": false,
    "skipLibCheck": true
  }
}
```

**Key rules:**
- Strict mode: no `any` without justification comment
- ESM only: `import`/`export`, no CommonJS `require`
- `.js` extension in imports (bundler/Node requirement)
- No `declare` statements in source files

### Naming

| Entity | Convention |
|--------|-----------|
| Files | kebab-case (`credential-resolver.ts`) |
| Types | PascalCase (`CommandSpec`, `BunnyApiError`) |
| Functions/vars | camelCase (`resolveCredential()`, `configDir`) |
| Constants | UPPER_SNAKE (`DEFAULT_RETRY`, `KEYCHAIN_SERVICE`) |

### Imports

Prefer: builtins → npm packages → relative imports. Always use `.js` extension (bundler). No `..` >2 levels.

---

## Logging & Output

### Rule: Stderr Only

**All logging → stderr.** stdout is reserved:
- `bunny manifest` → JSON to stdout
- MCP server → JSON-RPC messages to stdout
- Everything else: debug, info, warn, error → stderr

**Enforced via ESLint:** No `console.log` anywhere in codebase.

```ts
import { logger } from '../util/logger.js';

logger.debug('Processing file: %s', path);
logger.info('Deployed 42 files in 2.3s');
logger.warn('Rate limit approaching (600/1000 requests)');
logger.error('Failed to resolve credential for account scope');
```

### Log Levels

Controlled via `LOG_LEVEL` environment variable:

| Level | Output | Use Case |
|-------|--------|----------|
| `error` (default) | Errors only | Production |
| `warn` | Errors + warnings | Debugging rate limits, auth issues |
| `info` | Errors + info | Normal user operation (not used in P1) |
| `debug` | All | Development, troubleshooting OS keychain fallback |

### Credential Handling

Never log credentials. Test via spy assertion (credentials.test.ts).

---

## Architectural Boundaries

### Core Invariant: Commands/MCP → Core → API

**Enforced via ESLint rule (`no-restricted-imports`):**

| Source | MAY import | MUST NOT import |
|--------|-----------|-----------------|
| `src/commands/**` | core, manifest, util, config | api |
| `src/mcp/**` | core, manifest, util, config | api |
| `src/core/**` | api, util, config | commands, mcp, manifest |
| `src/api/**` | util | commands, mcp, core, manifest |

**Why:** Commands and MCP tools are UI wrappers. Core is the substance. Both reuse core; neither imports api directly. This prevents coupling between plumbing layers.

**Verification:** CI runs eslint before tests.

### No Side Effects in Core

`src/core/*` functions: pure (same input → same output), typed, validated, stateless, transparent. Never UI/exit/console.log. Commands wrap core + handle UI.

---

## HTTP & Network

### Single HTTP Client

All HTTP via `src/api/http.ts` (callBunny function). No direct fetch/undici elsewhere.

### Zone Defaults (rc.10+)

Storage commands (`upload`, `download`, `list`, `delete`, `sync`) auto-default `--zone` in precedence order:

```ts
// src/core/storage-ops.ts helper (rc.10+)
export function resolveActiveZone(
  override?: string,              // --zone flag
  bunnyJson?: BunnyJson,         // loaded config
  activeAlias?: string           // from BUNNY_ALIAS env or cli.ts flag
): string {
  if (override) return override;
  if (activeAlias?.storageZone) return activeAlias.storageZone;
  if (bunnyJson?.deploy?.storageZone) return bunnyJson.deploy.storageZone;
  throw new ConfigError('Storage zone required; provide --zone, set bunny.json, or use an alias');
}
```

**Usage in commands:**
```ts
export async function run({ flags, raw }: ParsedInvocation): Promise<number> {
  const zone = resolveActiveZone(
    flags.zone,
    loadBunnyJson(),
    resolveBunnyrc()?.aliases?.[BUNNY_ALIAS]
  );
  logger.info(`Uploading to zone: ${zone}`);  // Confirm resolved zone to user
  // ... proceed
}
```

**Consequence:** `bunny storage upload x.txt /x` works if bunny.json or active alias has `storageZone` defined.

### Pagination Contract

**Always:** `page=1, perPage=1000`  
**Never:** `page=0`

Bunny's footgun: `page=0` returns objects instead of arrays on empty. Always start at page 1.

```ts
let allResults = [];
let page = 1;
while (true) {
  const batch = await callBunny({
    query: { page, perPage: 1000 },
  });
  if (!batch.length) break;
  allResults.push(...batch);
  page++;
}
```

### List Commands

**Pattern:** All `*:list` commands support `--json` flag.

```ts
// src/commands/storage/list.ts
export async function run({ flags }: ParsedInvocation): Promise<number> {
  const items = await core.listStorageItems(...);
  if (flags.json) {
    console.log(JSON.stringify(items));
  } else {
    renderTable(items);
  }
  return 0;
}
```

### Destructive Operations

**Always require `--yes` flag in non-interactive shells.**

```ts
// src/commands/storage/delete.ts
export async function run({ flags }: ParsedInvocation): Promise<number> {
  if (!flags.yes && !process.stdin.isTTY) {
    throw new Error('Destructive op requires --yes or interactive terminal');
  }
  if (!flags.yes) {
    const confirmed = await promptConfirm('Really delete?');
    if (!confirmed) return 1;
  }
  await core.deleteFile(...);
  return 0;
}
```

### Retry & Backoff

**Retryable (429, 502, 503, 504):**
- Exponential backoff: `min(baseMs * 2^attempt, 30s) ± 25% jitter`
- Honor `Retry-After` header if present
- Max 5 attempts (default)

**Non-retryable (other 4xx, 3xx):**
- Throw immediately

**Example:**
```ts
const opts: CallOptions = {
  base: 'https://api.bunny.net',
  path: '/pullzone/12345',
  method: 'DELETE',
  scope: { kind: 'account' },
  retry: { max: 5, baseMs: 500 },  // default; override if needed
};
```

---

## Error Handling

### Error Types

```ts
// API error (from Bunny response)
class BunnyApiError extends Error {
  statusCode: number;
  errorKey?: string;
  field?: string;
}

// Auth failed (credential missing/invalid)
class AuthError extends Error {}

// Config missing/invalid (bunny.json, .bunnyrc)
class ConfigError extends Error {}

// Validation failed (zod schema)
class ValidationError extends Error {}
```

### Parsing Bunny Errors

All HTTP errors parsed through `parseBunnyErrorBody()`:

```ts
// Bunny returns: { ErrorKey: "...", Field?: "...", Message?: "..." }
// We parse and throw typed BunnyApiError

function parseBunnyErrorBody(status: number, body: unknown): Error {
  if (typeof body === 'object' && body !== null) {
    const { ErrorKey, Field, Message } = body as Record<string, unknown>;
    const err = new BunnyApiError(Message || ErrorKey || 'Unknown error');
    err.statusCode = status;
    err.errorKey = ErrorKey;
    err.field = Field;
    return err;
  }
  return new BunnyApiError(`HTTP ${status}: ${JSON.stringify(body)}`);
}
```

### Throwing vs Returning

**In core:** throw errors, return results
**In commands:** catch, render, exit

```ts
// Core
export async function deploy(config: Config): Promise<DeployResult> {
  if (!config.publicDir) throw new ConfigError('publicDir required');
  // ...
}

// Command
try {
  const result = await core.deploy(config);
  logger.info(`Deployed ${result.count} files`);
  return 0;
} catch (err) {
  if (err instanceof ConfigError) {
    logger.error(`Config error: ${err.message}`);
  } else {
    logger.error(`Unexpected error: ${err.message}`);
  }
  return 1;
}
```

---

## Validation with Zod

**Use zod for:**
- User inputs (`bunny.json`, `.bunnyrc`, CLI args/flags, env vars)
- API responses (when shape is known)

**Don't use zod for:**
- Internal function contracts (explicit TS types sufficient)
- Things that never change (hardcoded constants)

### Example: bunny.json Validation

```ts
import { z } from 'zod';

const BunnyJsonSchema = z.object({
  deploy: z.object({
    publicDir: z.string().min(1),
    ignore: z.array(z.string()).optional(),
    storageZone: z.string().min(1),
    region: z.string().optional(),
    concurrency: z.number().int().min(1).max(16).optional(),
    pullZones: z.array(z.object({
      id: z.number().int().min(1),
      purge: z.enum(['tag:', 'all', 'none']).optional(),
      tag: z.string().optional(),
    })).optional(),
  }),
});

export async function loadBunnyJson(cwd: string): Promise<BunnyJson> {
  const raw = JSON.parse(await fs.readFile('bunny.json', 'utf8'));
  try {
    return BunnyJsonSchema.parse(raw);
  } catch (err) {
    throw new ConfigError(`Invalid bunny.json: ${err.message}`);
  }
}
```

---

## Testing

### Stack

- **Runner:** Vitest
- **Mocking:** Nock (HTTP mocking)
- **Coverage:** @vitest/coverage-v8

### Setup: `test/setup.ts`

Disables all real HTTP:

```ts
import nock from 'nock';

// Disable real network
nock.disableNetConnect();

// After each test, cleanup
afterEach(() => {
  nock.cleanAll();
});
```

### Coverage Gate

**Target: ≥80% on:**
- `src/api/*`
- `src/config/*`
- `src/manifest/*`

Checked in CI: `npm run test:coverage` fails if below 80%.

### Test Naming

```ts
// ✓ Clear, describes behavior
describe('resolveCredential', () => {
  it('returns flag value if provided', async () => { ... });
  it('falls back to BUNNY_ACCOUNT_KEY env if flag missing', async () => { ... });
  it('throws AuthError if no credential found', async () => { ... });
});

// ✗ Vague
describe('credential-resolver', () => {
  it('works', async () => { ... });
  it('test 2', async () => { ... });
});
```

### HTTP Mocking

Use Nock to mock API responses. No real network calls. Vitest enforces via Nock failover on unmocked requests.

---

## Build & Distribution

### Build & Generators

Generators read `src/manifest/registry.ts` and produce: `manifest.json`, `AGENTS.md`, `schema/bunny.schema.json`. CI drift-check verifies checked-in artifacts match. Never hand-edit generated files.

### Performance

Cold-start (`bunny --help`): <50ms. Lazy loading + single registry parse achieve this.

---

## MCP Rules (Phase 6+)

MCP tools wrap `src/core/*`. Critical: stdout is JSON-RPC transport. Use stderr/logger only, never stdout.
