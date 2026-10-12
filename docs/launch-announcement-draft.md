# Launch announcement drafts

Draft posts for v0.1.0 GA. Pick the venue(s) you want and tweak voice as needed. Don't post all of them at once - drip-feed.

---

## Bunny.net Discord (#general or #show-off)

Recommended first venue. Smaller audience, friendlier feedback, Bunny employees may notice.

> **bunny-tools v0.1.0** - npm CLI + MCP server for the full Bunny.net surface
>
> Hey folks, just shipped a community CLI for Bunny.net since there's no first-party one. `bunny deploy` works like `firebase deploy` - walks public dir, SHA-cached diff, parallel upload, CDN purge in one command. Plus an MCP server so Claude Code / Desktop can drive every command (deploy, DNS, hostnames, edge rules) with no extra plugin.
>
> Install: `npm install -g bunny-tools`
> Quickstart: `bunny init --ci`
>
> Covers Storage + CDN + DNS + Stream + Edge Scripting + Magic Containers (basic). 60 commands, 19 MCP tools, nightly drift detection against a real account so Bunny API changes get caught before they break my deploys.
>
> npm: https://www.npmjs.com/package/bunny-tools
> GitHub: https://github.com/chienqan/bunny-tools
>
> Would love feedback from anyone using Bunny in production - especially edge cases I haven't hit. License is MIT.

---

## Reddit r/selfhosted or r/javascript (single subreddit, not crosspost)

> **I built a CLI + MCP server for Bunny.net (~60 commands, ships v0.1.0 today)**
>
> TL;DR: `npm install -g bunny-tools` → `bunny deploy` is `firebase deploy` for Bunny.net's CDN/storage. MCP server included so AI agents (Claude Code, Claude Desktop) can drive every command.
>
> Why I built it: Bunny.net is great but ships no first-party CLI. I had a folder of curl scripts and stale dashboard tabs. Wanted one binary, `bunny.json` versioned in git, AI agents able to use the same surface.
>
> What works in v0.1.0:
> - Storage zones + file ops (upload/download/list/delete/sync)
> - Pull zones (CDN) + edge rules + custom hostnames + ForceSSL
> - DNS - 12 record types incl. PULLZONE/REDIRECT/SCRIPT
> - Stream libraries + videos
> - Magic Containers + Edge Scripting (basic CRUD)
> - High-level `bunny domain connect` for atomic hostname + cert + DNS-record
>
> Verified end-to-end:
> - 185 unit tests
> - 50/52 e2e against a real Bunny account, runs nightly
> - Real production deploy on a Framer-export site (~57 files, edge rules, custom hostname, www→apex redirect - all working)
>
> npm: https://www.npmjs.com/package/bunny-tools
> GitHub: https://github.com/chienqan/bunny-tools (MIT)
>
> Welcome feedback / bug reports / feature requests - especially from anyone running Bunny in production with constraints I haven't thought about.

---

## X / Twitter

3-tweet thread.

> **(1/3)** shipping bunny-tools v0.1.0 today. it's the bunny.net CLI bunny.net never shipped.
>
> `npm install -g bunny-tools`
> `bunny deploy`
>
> 60 commands, single binary, JSON-schema config, MIT.

> **(2/3)** but the real reason i built it: claude code can drive every command via the built-in MCP server.
>
> `bunny install mcp` and your AI agent can deploy, manage DNS, attach hostnames, purge cache. no per-agent plugin. one surface.

> **(3/3)** verified against a real bunny account with nightly drift detection - when bunny changes a field name under the API, the suite turns red within 24h and I get a github issue.
>
> https://github.com/chienqan/bunny-tools

---

## dev.to (longer-form)

Title: **Building a CLI + MCP server for Bunny.net in 3 days**

This one needs more meat. Outline:

1. The pitch (what bunny-tools is, why it exists)
2. The 3-day shipping cycle (54 RCs, dogfooding caught 7 real bugs)
3. The MCP angle - first community CLI for Bunny.net that AI agents can drive natively
4. What's in v0.1.0 (high-level features)
5. What I learned about Bunny's API (PullZoneId-vs-LinkName quirk, FLATTEN-not-actually-supported, hostname-DNS-pointing requirement)
6. v0.2 roadmap

Skip if you don't enjoy long-form writing. The Discord + Reddit posts get you 80% of the value.

---

## Things to avoid

- HackerNews. Front-page traffic on a tool with 0 prior real-user reports = bug-magnet at the worst time. Wait until v0.1.x has a few weeks of stability.
- Posting in 5 places at once. Drip-feed: Discord first → wait 24h → Reddit → wait 24h → X. If something breaks in early traffic, you fix it before the next venue's audience hits.
- Over-promising. Don't say "production-ready" - say "verified against a real account, MIT, feedback welcome."

---

## After posting

Watch:
- npm downloads (`npm view bunny-tools` shows weekly count)
- GitHub stars / issues / discussions
- Nightly e2e for any drift surfaced by genuine Bunny API changes (separate from launch-related bugs)
- Any DM/email feedback - that's often the most actionable

If a real bug surfaces, fix it as v0.1.1 within a day. Quick response time builds trust faster than feature volume.
