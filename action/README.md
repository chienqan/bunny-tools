# bunny-tools/deploy-action

Composite GitHub Action that wraps [`bunny-tools`](https://github.com/chienqan/bunny-tools) — Bunny.net deploy CLI.

## Usage

```yaml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm
      - run: npm ci && npm run build
      - uses: bytekcorp/bunny-tools-deploy-action@v1
        with:
          account-key: ${{ secrets.BUNNY_ACCOUNT_KEY }}
          storage-password: ${{ secrets.BUNNY_STORAGE_PASSWORD }}
```

The action expects a `bunny.json` in `working-directory` (default `.`). Run `bunny init` once locally to generate one.

## Inputs

| Input | Description | Default |
|---|---|---|
| `version` | bunny-tools npm version (`latest`, `alpha`, or `0.1.0`). | `latest` |
| `only` | Limit deploy to a target alias. | — |
| `working-directory` | Run from this subdirectory. | `.` |
| `account-key` | Bunny account API key. **Use secrets.** | — |
| `storage-password` | Storage zone password. **Use secrets.** | — |
| `stream-key` | Stream library key (optional). | — |
| `purge` | Override purge: `all`, `none`, `tag:<name>`, `paths`. | from bunny.json |
| `delete-orphans` | Delete remote files no longer present locally. | `false` |
| `concurrency` | Parallel upload pool size. | `8` |

## Outputs

| Output | Description |
|---|---|
| `result` | JSON summary `{ uploaded, deleted, unchanged, purged, failed, durationMs }`. |

## Pinning

Pin to `@v1` (auto-updates within 0.1.x) or to an exact tag like `@v0.1.0` for reproducible builds.

## Caching tip

Wrap with `actions/setup-node@v4 ... cache: npm` to keep the `npx` cold-install fast.
