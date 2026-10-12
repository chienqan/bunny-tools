---
date: 2026-10-12T10:45:00Z
version: 0.2.0
pr: https://github.com/chienqan/bunny-tools/pull/7
status: shipped
severity: High
---

# 0.2.0 Ship: CLI Redesign Around One API Key and Guessable Commands

**Date**: 2026-10-12 17:45 (Asia/Saigon)
**Version**: 0.2.0 (breaking)
**PR**: https://github.com/chienqan/bunny-tools/pull/7 | **Issue**: https://github.com/chienqan/bunny-tools/issues/8
**Component**: CLI command tree, credential resolution, storage ops, MCP tools
**Status**: Shipped, with one open risk (see Next Steps)

## What Happened

The user ran `bunny configure` (account API key stored), then `bunny storage list`, and got `No storage zone specified`. Even with a zone supplied, the next wall was a separate storage zone password. The product pitch was "one credential"; the reality was a four-credential scavenger hunt. Users also mixed up `storage` (files) with `storagezone` (zones) and had to remember numeric ids.

We redesigned the whole command surface in one breaking release instead of patching the single error.

## The Brutal Truth

This was a design failure, not a bug. The first-run path of the most basic command was never walked end to end with only an account key. We built 55 commands and nobody typed `bunny storage ls` right after `configure`. The same account key can read every zone password through the API, so the pain was entirely self-inflicted.

Then the environment fought us for hours. The redesign itself was straightforward; getting a test runner to start was not.

## Decisions (made with the user)

- aws-s3 style addressing: `<zone>/<path>`. `bunny storage ls` with no argument lists zones.
- Old names dropped entirely, bump to 0.2.0, no hidden aliases. Rejected: deprecated aliases, because they keep two vocabularies alive forever and the user base is tiny.
- Renames: `pullzone` -> `cdn`, `edgerule` -> `cdn rule`, `containers app` -> `containers`.
- Keep `configure`. Rejected an OAuth-style `login`: Bunny has no OAuth.
- Names/domains accepted instead of ids everywhere (`src/core/resolve.ts`).
- `purge <url...>` or `--pull-zone <name|id> [--tag]`.
- MCP tools renamed to mirror the CLI: 21 tools, cap is 22.

## Technical Details

- `src/core/scoped-key-resolver.ts`: derives storage zone `Password` and Stream library `ApiKey` from the account key. A stored explicit key wins; derived keys are memoized in memory only, never persisted.
- `src/core/storage-ops.ts`: parses targets, resolves region and password once per command. This also fixed `storage sync`, which was doing one account lookup per file.
- `src/ui/output.ts`: one stdout/stderr/`--json`/`--yes` contract. stdout is result only.
- Security: `storagezone get` previously printed zone passwords. All storage zone and library outputs now strip secrets.
- Unknown commands used to print help and exit 0. They now exit 1 with a rename hint.
- Fixed a variadic argument bug in `src/cli.ts`.
- AGENTS.md generator now groups by resource and prints arg signatures.

## Challenges

macOS refused or hung when loading native `.node` modules from `node_modules` inside the agent sandbox:

- `fsevents`: `dlopen` hang.
- `rolldown` / `keytar`: `code signature not valid ... disallowed by system policy`.

That blocked vitest and tsx for a long time. A hook also blocked any command containing the strings `node_modules` or `dist`, which made diagnosing it clumsy. Resolution: the user removed `fsevents`, reinstalled `node_modules`, and ran tests in their own terminal. Hours lost to the toolchain, not the code.

## Verification

- 207/207 unit tests, typecheck, lint all green.
- Read-only smoke on the real account: `storage ls`, `storage ls <zone>`, `storage zone get`, `cdn ls`. No password in `--json` output. Zone-root `rm` is refused.
- e2e suite updated to the new names but NOT run (it creates and deletes live resources). Treat it as unverified.

## Root Cause Analysis

We designed commands around Bunny's API resource model (separate credentials per resource type) instead of around what a user types after `configure`. The API's shape leaked straight into the CLI vocabulary, including `storage` vs `storagezone`.

## Lessons Learned

- Walk the first-run path with only the advertised credential before shipping any command group.
- If the pitch is "one key", write a test that asserts no second secret is ever requested.
- Output that echoes API objects leaks secrets by default; strip at the output boundary, not per command.
- Per-item lookups inside loops (sync) hide until a large directory; resolve once per command.
- Breaking cleanly with a rename hint beats aliases when the audience is small.

## Next Steps

1. Open risk: a generic `BUNNY_STORAGE_PASSWORD` env var overrides the auto-fetched password for every zone, so a wrong value silently breaks all zones. Decide whether to scope it per zone only (`BUNNY_STORAGE_PASSWORD_<ZONE>`) or warn. Owner: maintainer, before 0.2.1.
2. Run the e2e suite against a disposable account; it has not run against the new names.
3. Repo moved from bytekcorp to chienqan; links updated in `1c5f884`. Verify npm package metadata matches on next publish.
4. Merge PR #7 and track follow-ups in issue #8.

Status: DONE_WITH_CONCERNS
Summary: Journal written for the 0.2.0 redesign; concerns are the unrun e2e suite and the generic BUNNY_STORAGE_PASSWORD override.
