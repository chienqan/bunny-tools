# Get Bunny.net-ready

You are an AI agent and the human wants something on Bunny.net: a static site deployed, files in storage, a CDN in front of an origin, a custom domain with SSL, DNS records, or video. `bunny-tools` (binary: `bunny`) does all of it from the terminal with one credential. These are your instructions. Read them once, then act on them. Do the setup; do not explain it back to the human step by step.

Everything below works the same through the MCP server (section 8) if you have no shell.

## 1. Decide which path

| The human wants | Go to |
| --- | --- |
| "Deploy this site / folder to Bunny" | 4. Deploy a static site |
| Upload, download, list or delete files | 5. Work with storage |
| A CDN in front of an origin, or their domain on a pull zone with SSL | 6. CDN and custom domains |
| DNS records on a domain hosted at Bunny | 7. DNS |
| Video (Stream), edge scripts, containers | Run `bunny <stream\|scripting\|containers> --help` |

Always do 2 and 3 first. If the goal is unclear, ask the human one question. Do not create zones, pull zones or DNS zones they did not ask for.

## 2. Install and verify

Requires Node.js 20 or newer.

```bash
npm install -g bunny-tools
bunny --version          # expect 0.2.4 or newer
```

No global install allowed? Prefix every command with `npx -y bunny-tools@latest` instead of `bunny`.

## 3. Authenticate (one key, human-approved)

```bash
bunny whoami --json
```

- If `counts` shows numbers, you are authenticated. Continue.
- If it warns `No account credential set`, stop and ask the human to run `bunny configure` themselves and paste their API key from **dash.bunny.net → Account Settings → API**. The prompt is masked. Wait until they confirm, then run `bunny whoami --json` again.
- In CI or a sandbox, the key can come from the environment instead: `BUNNY_API_KEY`.

Rules:

- **Never ask for a storage zone password or a Stream library key.** bunny-tools fetches them with the account key on demand.
- Never print, log, commit or write the API key into files. Never type it into `bunny configure` on the human's behalf.
- Several accounts? Profiles: `bunny configure --profile work`, then `-p work` on any command.

## 4. Deploy a static site

```bash
bunny storage ls          # existing storage zones
bunny cdn list            # existing pull zones (note the id of the one serving this site)
```

If the project has no `bunny.json`, create it. Interactive when the human is present:

```bash
bunny init
```

Or non-interactive (pick the zone and pull zone from the lists above; `--pull-zone` takes the numeric id):

```bash
bunny init --non-interactive --features=storage --storage-zone=<zone> --public-dir=dist --pull-zone=<id> --purge=all
```

Build the site first (`dist/`, `public/`, `build/`, ...), then:

```bash
bunny deploy --dry-run --json   # review: new / changed / unchanged / orphan counts
bunny deploy --json             # upload changed files, then purge the CDN
```

- Only add `--delete` (removes remote files that no longer exist locally) when the human asked for a clean mirror.
- Verify: fetch the site's URL and check the new content is served.
- For GitHub Actions, `bunny init --ci` writes `.github/workflows/bunny-deploy.yml`; tell the human to add a `BUNNY_API_KEY` repository secret.

## 5. Work with storage

Paths are `<zone>/<path>`, like `aws s3`.

```bash
bunny storage ls                                  # all zones
bunny storage ls my-zone/assets -r --json         # files, recursive
bunny storage upload ./logo.png my-zone/img/      # trailing slash keeps the file name
bunny storage download my-zone/img/logo.png       # saves ./logo.png
bunny storage sync ./public my-zone/              # upload a folder (no CDN purge)
bunny storage rm my-zone/old.txt --yes            # one file
bunny storage rm my-zone/tmp/ -r --yes            # a directory tree
```

Deleting a whole zone root is refused by design; use `bunny storage zone delete <zone>` only if the human explicitly asks for the zone to be removed.

## 6. CDN and custom domains

```bash
bunny cdn create my-site --origin https://origin.example.com
bunny domain connect my-site example.com --dns-zone example.com
bunny cdn hostname list my-site --json            # verify: host present, ssl true
bunny purge --pull-zone my-site                   # purge everything
bunny purge https://example.com/app.js            # purge one URL
```

`domain connect` links the hostname, provisions a free Let's Encrypt certificate (waits up to 90s) and, with `--dns-zone`, creates the apex record. It is idempotent: re-run it if it timed out. If the domain's DNS is not on Bunny, omit `--dns-zone` and tell the human which record to create at their DNS provider (a CNAME to `<pull-zone>.b-cdn.net`).

## 7. DNS

```bash
bunny dns list
bunny dns record list example.com --json
bunny dns record add example.com A www 1.2.3.4 --ttl 300
bunny dns record add example.com PULLZONE @ --pull-zone my-site
bunny dns record delete example.com <record-id> --yes
```

## 8. MCP (optional)

For agents without a shell, or when the human prefers tools over commands:

```bash
claude mcp add --scope user bunny-tools -- npx -y bunny-tools@latest mcp
```

The `--` is required. Tools mirror the commands above (`bunny.whoami`, `bunny.deploy`, `bunny.storage_ls`, `bunny.domain_connect`, ...) and `bunny.run` runs any CLI command. In a shell, prefer the CLI with `--json`: it lets you choose how much output you read.

## 9. Output, errors and safety

- stdout is the result; add `--json` to parse it. Progress and prompts go to stderr.
- Exit codes: `0` ok, `1` error or refused, `2` partial failure (some uploads or purges failed: read the JSON and retry those).
- Non-interactive shells: destructive commands need `--yes`. Only pass it when the human asked for that deletion.
- Names work everywhere ids do: `my-site`, `example.com`, `my-zone`.

| Error | Do this |
| --- | --- |
| `No credential for scope account` | Back to section 3; the human runs `bunny configure`. |
| `Bunny rejected credentials (HTTP 401)` | The key is wrong or revoked; ask the human for a new one via `bunny configure`. |
| `Storage zone "x" not found` / `Pull zone "x" not found` | Run `bunny storage ls` / `bunny cdn list`; the message lists what exists. |
| `... is a directory. Pass -r` | Confirm the human wants the whole directory gone, then add `-r`. |
| `Pass --yes to confirm in non-interactive shells` | Confirm with the human, then add `--yes`. |
| `Unknown command ... It was renamed` | You are using 0.1.x syntax; use the command it suggests. |
| Timed out waiting for SSL certificate | Re-run the same `domain connect` / `cdn hostname add`; it is idempotent. |

Never delete storage zones, pull zones, DNS zones or records you did not create in this session unless the human asks for that specific deletion.

## Read next

- Every command with arguments and examples: `bunny manifest` or `bunny <command> --help-json`
- [AGENTS.md](https://github.com/chienqan/bunny-tools/blob/main/AGENTS.md): full command tree and output contract
- [README](https://github.com/chienqan/bunny-tools#readme): human-facing reference
- [Architecture](https://github.com/chienqan/bunny-tools/blob/main/docs/system-architecture.md): for agents editing bunny-tools itself
