# VU laptop: find out which APIs a session could run, for a list to pick from

Paste this into a Claude Code session on the VU work laptop, opened in the folder of the team's UI repo (the Angular app with `proxy.conf.json`). That session doesn't change the UI repo, and doesn't edit or commit cc-control. It reads files and writes a handoff in the shape of `docs/prompts/vu-handoff-template.md`, for the owner to paste into a session on the personal laptop.

---

Context: cc-control v2 (PLAN §137, §144) shows each session's stack on the Switchboard. Today:

- A workspace's stack (`~/.cc-control` store, set up from detection in `shared/stack-detect.ts`) lists the APIs it **can** run: one entry per API **repo the workspace already has**, each with values (`name`, `dir`, `appPort`, `route`) filled into a step template (`okteto up …`) and a proxy rule template.
- A session doesn't remember its own APIs. Start stack runs the stack's APIs whose repo the session has a worktree of; `Add an API` (only while running) offers the rest of the workspace's list. An API runs from the session's worktree, else the workspace's main checkout; one with no folder on disk can't run.
- The UI is pointed at the running APIs by rewriting its proxy file. Every rule for an API not running here is left alone and goes to Dev.

The owner wants:
1. **When nothing is running, the card still shows the APIs attached to the session**, and they can be changed before Start.
2. **An easy way to add more**, from **a dynamic list of the APIs the team usually stands up**, not only the workspace's repos. The UI's `proxy.conf.json` already names every API the UI talks to, so it may be the source of that list.

Nothing in cc-control has seen a real proxy file, the API repos' layout, or how they're cloned and started, so I need their shapes. Don't run anything that starts, deploys or changes a service; reading files and `git` metadata only.

**Never include:** real API, repo, route, host or namespace names, URLs, ports from internal hosts, ticket keys, tokens, people's names or internal tool names. Replace each real name with a consistent made-up one (`orders-api`, `/api/orders`, `billing-api`), keeping its **shape** (casing, separators, prefixes and suffixes, how the rule key relates to the repo name). The shapes are what's needed, not the data.

**What to find out**
1. **The proxy file:** its path and format (JSON, JSON with comments, `.js`); whether there is more than one (per environment, per app in an nx/Angular workspace) and which one `ng serve` uses. How many rules it has. A made-up copy of 3–5 rules that keeps the real structure: key pattern, `target`, `pathRewrite`, `changeOrigin`, `secure`, headers, `bypass`, anything else.
2. **Rule → API:** for each rule, can you tell which API (and which repo) it is? By the key's path segment, by the target's host, by something else? Give the mapping rule as a pattern (e.g. "key `/gateway/<team>/<route>/**`, route = repo name minus `-api`, lower case"). List the rules that **don't** map to an API repo (auth, static assets, third-party) and how to tell them apart. Do several rules point at the same API?
3. **Where the API repos are:** the folder the API repos are cloned into on this laptop (the shape of the path, not the user name), how many are cloned there, and roughly how many of the proxy file's APIs are **not** cloned. Is there a list of the team's API repos anywhere (an Azure DevOps project, a README, a script, a workspace file) that would give clone URLs, and its shape?
4. **How an API starts:** compare 2–3 cloned API repos: is the `okteto` manifest (or whatever starts them) in the same place with the same shape in each? Where do the values cc-control needs come from in each: the deployment `name`, the project `dir`, the container port (`appPort`), the route? Can they be read from the repo's files alone (okteto.yml, Dockerfile, launchSettings.json, csproj, appsettings)? Note any API that starts differently.
5. **The workspace as it is:** run `curl -s http://127.0.0.1:7878/api/state` (or open the v2 Switchboard) and say how many repos and stack APIs the workspace has, and whether its stack's `apis` come from detection or were edited by hand. Then check whether every stack API's route matches a rule in the proxy file. Don't paste the JSON; describe it with made-up names.
6. **Health:** whether the APIs share a health path (e.g. `/health`), so a picked API that cc-control has only seen in the proxy file can still be health-checked.
7. **What "usually stood up" means here:** from the evidence (the proxy file, scripts, READMEs, recent branches in the cloned repos), which APIs does the team change most? Is a static list in the stack enough, or should the list come from the proxy file each time?
8. **Your recommendation** for cc-control, with what it costs:
   - (a) The list of APIs to offer, and its source: the proxy file's rules, the cloned repos, both merged (cloned ones ready to run, the rest shown as "not cloned"), or something else.
   - (b) What a session should store as its attached APIs, and what the stopped card should show.
   - (c) What Add should do for an API that isn't cloned: clone it into the usual folder (and with which URL shape), or point the user at it, or only allow cloned ones.
   - (d) How its stack values (`name`, `dir`, `appPort`, `route`) should be filled in for an API seen for the first time.

**Write it as the handoff** (`docs/prompts/vu-handoff-template.md`): *What happened* (what you read, kept generic, e.g. "the UI's proxy file", "the third API repo's okteto manifest"), *Cause* (n/a: this is discovery), *What to change* (sections 1 to 8 above, as found), *How to check it back here* (what the owner can try on the VU laptop once it's built: e.g. a stopped session's card lists its APIs, Add offers the proxy file's APIs with the cloned ones ready to run), *Open items* (anything you couldn't find or weren't sure about, one per line).
