# Pre-landing review: feat/cli-redesign-0.2.0 (PR #7)

Scope: `git diff origin/main...HEAD` (118 files, +3264/-3367). I looked hardest at storage-ops, scoped-key-resolver, resolve, purge, scripting, zones, stream, cli.ts, output/json-flag, mcp/tools, and the registry.
Checks: `npm run typecheck` clean. `npm run lint` clean. I did not run vitest in the sandbox (the caller reports 207/207).
I did not flag the renames themselves, since they are deliberate.

## Pass 1: CRITICAL (blocking)

### C1. `storage rm` zone-root guard can be bypassed, and `-r` can delete every file in the zone
- Where: `src/core/storage-ops.ts:29-39` (parseStorageTarget), `:144` (guard), `:152-153` (recursive loop), `src/commands/storage/rm.ts:13`. Root cause is in `src/api/storage.ts:28-31,74-76` and `src/api/http.ts:53`. URLs are built with `new URL(path, base)`, and path segments are never encoded.
- Verified with node: `new URL()` resolves dot segments and treats `#` and `?` as delimiters.
  - `/z/a/..`, `/z/.`, and `/z/a/%2e%2e/` all become `/z/`.
  - `/z/img/#x` becomes path `/z/img/` with hash `#x`.
  - `/z/img/a?.png` becomes path `/z/img/a` with query `?.png`.
- Failure scenarios:
  - `bunny storage rm my-zone/. -r --yes`, `my-zone/a/.. -r`, `my-zone/# -r` and `my-zone/? -r` all pass the `path === '/'` guard. `listRecursive` then lists the zone root and deletes every file one at a time. Bunny's server-side `allowRootDelete` check does not help, because each DELETE targets a single file.
  - `bunny storage rm 'my-zone/img/#draft.png' --yes` (no `-r`) sends DELETE `/my-zone/img/`. Bunny deletes directories recursively (per the docs), so the whole `img/` tree goes.
  - The MCP `bunny.storage_rm` tool has the same behavior and asks for no confirmation.
  - The same root cause affects `deploy --delete-orphans`. This part is pre-existing: if a remote orphan's name contains `#` or `?`, the DELETE hits its parent path.
- Fix:
  1. In `parseStorageTarget`, reject any `.` or `..` segment, and reject `?` and `#` (or encode them).
  2. In `joinPath`/`listDir`, percent-encode each segment with `encodeURIComponent`, keeping the `/` separators.
  3. Run the root guard on the normalized path.
  4. Add tests for `.`, `..`, `%2e%2e`, `#` and `?`.

### C2. `storage zone update` always exits 1, even after the update succeeds (regression)
- Where: `src/core/zones.ts:45-47` wraps `client().updateStorageZone()` (`src/api/account.ts:81-82`) in `toPublicZone`.
- Bunny's docs say `POST /storagezone/{id}` returns **204 No Content**. `callBunny` returns `undefined` for a 204 (`src/api/http.ts:111-114`). `toPublicZone(undefined)` then throws a TypeError while destructuring.
- Effect: the update goes through, but the CLI prints an error and exits 1. Agents and scripts will retry or report failure. On main this returned `undefined` without crashing.
- Fix: in `updateStorageZone`, re-fetch with `getStorageZone(id)` after the POST, the same way `deployScript` does for its 204 endpoint. Add a 204 mock test.

## Pass 1: HIGH

### H1. `storage rm` without `-r` still deletes whole directories
- Where: `src/core/storage-ops.ts:148-150`, prompt text at `src/commands/storage/rm.ts:17`.
- Bunny's DELETE is recursive for directories. `bunny storage rm my-zone/assets --yes` (or `my-zone/tmp/`) wipes the whole tree, while the prompt says "Delete file my-zone/assets?". The `-r` flag and the registry summary ("a file, or a directory with -r") suggest a safety boundary that does not exist.
- Fix: when `!recursive`, refuse if `target.isDir`, and also list the parent directory to confirm the target is not a directory. Alternatively, make the prompt say plainly that directories are deleted recursively. With `-r`, consider a single DELETE on `path/` instead of N sequential file deletes (the current loop also leaves empty directories behind).

### H2. Unvalidated `--region` / `.bunnyrc` region can redirect requests to another host, and auto-derived zone passwords make this worse
- Where: `src/api/account.ts:332-334` (`https://${region}.storage.bunnycdn.com`), `src/core/storage-ops.ts:78` (the `--region` flag is used raw), `src/config/bunnyrc.ts:9` (`region: z.string()`), `src/core/deploy.ts:103` (the alias region wins).
- Verified: with region `attacker.example/`, the base URL becomes `https://attacker.example/my-zone/`, and the storage password is sent in the `AccessKey` header.
- `bunny.json` is safe because it uses an enum. A committed `.bunnyrc`, or `bunny.run` called with `--region` (for example through prompt injection), is not.
- Before this PR, only a storage password the user had explicitly stored could leak this way. Now the password for any named zone is fetched automatically with the account key.
- Also, `--region de` produces `de.storage.bunnycdn.com`, which is not a valid host.
- Fix: validate the region against `STORAGE_REGIONS` (plus `de` mapped to `''`) inside `storageBaseUrl`/`regionCodeToSubdomain`, and in the `.bunnyrc` schema.

### H3. A generic `BUNNY_STORAGE_PASSWORD` / `BUNNY_STREAM_KEY` overrides the correct per-zone credential for every zone
- Where: `src/config/credential-resolver.ts` (`scopeToEnvVars`), `src/core/storage-ops.ts:69-73`, `src/core/scoped-key-resolver.ts:66-70`.
- Commands can now address any zone, but a CI environment holding `BUNNY_API_KEY` plus a generic `BUNNY_STORAGE_PASSWORD` meant for zone A will send zone A's password when you run `bunny storage ls zone-b`. The result is a 401, even though `openZone` already has the correct `knownPassword`.
- Likewise, a stale scoped key in the keychain or file store blocks the fallback. That contradicts the "rotated password is picked up" comment.
- Fix: in `openZone`, prefer `knownPassword` over the generic (unsuffixed) env vars, or retry once with the derived key on a storage `AuthError`. Document the precedence.

## Pass 2: INFORMATIONAL

1. **Purge exit code does not follow the contract.** `src/commands/purge.ts:39,42` returns 0 when some targets fail, and 2 only when all fail. AGENTS.md says 2 means partial failure. This was already the case on main.
2. **Pull zone secrets are not stripped.** `src/core/zones.ts:55-61`: `cdn get`, `cdn list --json`, and MCP `bunny.cdn_list` return the raw PullZone, which includes `ZoneSecurityKey` and the AWS signing key/secret fields, straight into LLM context. This is pre-existing, but it is inconsistent with the new storage and stream stripping. Suggest a `toPublicPullZone`.
3. **All-digit names are treated as ids.** In `src/core/resolve.ts:10,37-71`, a zone or pull zone named `2024` is read as id 2024. On delete paths this could act on the wrong resource. The prompt shows the id, but not the resolved name. Suggest trying a name match first, or showing the resolved name in the confirmation.
4. **Some destructive commands skip confirmation.** `cdn rule delete` (alias rm) and `cdn hostname remove` (alias rm) have no `--yes` / `confirmDestructive`, which contradicts the AGENTS.md rule that destructive commands need `--yes`.
5. **Registry is missing MCP metadata for some tools.** `bunny.cdn_list`, `bunny.cdn_create`, `bunny.cdn_delete`, `bunny.cdn_hostname_remove` and `bunny.storage_upload` exist in `src/mcp/tools.ts` but have no `mcp:` link in `src/manifest/registry.ts`, so AGENTS.md and `bunny manifest` under-report them.
6. **Stale docs** still describe the 0.1.x command names and aliases:
   - `docs/code-standards.md:27-28,97,139,152-160`
   - `docs/project-overview-pdr.md:154-156`
   - `docs/codebase-summary.md:66`
   - `docs/e2e-testing.md:28`
7. **Test gaps:**
   - No unit tests for `scoped-key-resolver`: stored key beats derived, a failed memo entry gets retried, stream derivation, error remapping.
   - No `parseStorageTarget` tests for dot segments or special characters.
   - No test that `updateStorageZone` handles a 204.
8. **Dead code and edge cases:**
   - `deployScript({ id })` is never passed an id by the CLI or MCP.
   - The case-insensitive upsert in `src/core/scripting.ts:33` can overwrite a script whose name differs only in case.
   - `--type abc` becomes NaN.
9. **`parseJsonFlag` accepts non-objects** (`src/util/json-flag.ts:8`): `null`, arrays and strings all pass, and are POSTed as `--body` / `--rule`. Validate that the value is a plain object.
10. **`storage sync --json` prints nothing on stdout when some uploads fail** (exit 2). `deploy` prints the result object in the same situation.
11. **The CI workflow template still wires a `BUNNY_STORAGE_PASSWORD_<ZONE>` secret** (`src/core/ci-workflow.ts:40-48,76`). It is harmless (empty env values are skipped) but contradicts the one-key message.
12. **Misleading auth error.** In `scoped-key-resolver.ts:76-80`, a 401 from a revoked account key is turned into "No credential ... run `bunny configure`".
13. **Memoized secrets live for the whole process** and are keyed by zone, not by profile. In the long-lived MCP server, a rotated password or a profile switch is not picked up until restart. This is low impact, because `openZone` re-fetches each call.

## Edge cases from scouting
- Old 0.1.x invocations like `storage delete <path> --zone X` now fail on the unknown `--zone` option, which is safe. `storage delete static/js -r` from an old script would now be read as zone `static` if such a zone exists. That is low probability.
- Concurrent deploy uploads share one memoized derivation promise, so there is no thundering herd.

## Plan follow-ups
- No plan file was provided. Fix C1 and C2 before merging. H1-H3 should land in this PR or be tracked explicitly as known issues for 0.2.1.

## Unresolved questions
- What does Bunny's DELETE do on a directory path without a trailing slash? I assumed it deletes recursively, per the docs' directory statement. Confirm with a live e2e test.
- Should `.bunnyrc` be treated as trusted (it is per-developer, but is it ever committed)?
