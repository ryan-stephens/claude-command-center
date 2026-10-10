# Continue developing Command Center v2

Paste this into a new Claude Code session opened in `D:\repos\cc-control`, then send the issue to work on.

---

You're picking up **Command Center v2**: the second draft of cc-control (GitHub `ryan-stephens/claude-command-center`). It lives in `v2/`, beside the untouched v1. The owner uses it to speed up their own dev work. Speed of development matters more than heavy regression guarding (PLAN §136).

**Right now the owner is testing v2 on the VU work laptop** and will send issues as they find them, one or a few at a time. Each message is the task: fix it, verify it, push it, say how to check it back at VU. See *Working from VU reports* below.

## The idea (PLAN §137)
- **A session is the unit of work.** Claude Code runs where the user already works: a terminal tab, VS Code or Claude Desktop. v2 never hosts a chat.
- **What the app does:**
  - launches work properly: a ticket picked from Jira, worktrees in every repo the work touches with `node_modules` hard-linked, a context pack, the stack;
  - shows every session's stack on a **Switchboard**: one UI, many APIs;
  - gives Claude the team's tools over an MCP **toolbelt**, and shows what Claude does with the data tools on each session's **Data panel**;
  - ships PRs with evidence, then posts the review request to Slack.
- **Rejected by the owner** (don't bring them back): keyboard-first, "Try it two ways", A/B comparison, and §139's fill-in / then-check *data check* (replaced by §140's separate tools).

## Get familiar first, then stand by
1. Read `CLAUDE.md`. The v2 rules: no keyboard-first rule, and reuse v1's server modules instead of copying them. The repo-wide rules:
   - local-only on 127.0.0.1;
   - pnpm on Node 24;
   - conventional commits; stage named paths, never `git add -A`;
   - the two-laptops rule;
   - MVP pace.
2. Read `v2/README.md`, then PLAN §137 to §143 (search `docs/PLAN.md` for `## 137.` and read to the end). Don't read the rest of the PLAN.
3. Skim the code:
   - **Server** (`v2/server/`):
     - `main.ts`: routes, the snapshot over SSE, hooks, the toolbelt's `/tool/*` (the `TOOLS` table);
     - `stacks.ts`: one UI and many APIs on v1's `RunService`, the proxy rebuilt on add or remove, health probes, leftovers;
     - `launch.ts`: worktrees and the session's three local files;
     - `my-tickets.ts`: the Launchpad's ticket picker (your open Jira tickets, a search);
     - `data.ts` (`DataDesk`): the data tools as DataEvents on the session: test-data tool start/stop, loans, lookups, changes, new scenarios;
     - `tools.ts`: the pure-ish parts: `makeLoan`, `lookupFields`, `updateFields` (send, then read until it shows);
     - `tool-setup.ts`: finding the test-data tool's install and working out how to start it;
     - `field-picks.ts`: the fields to check (Claude's and yours, the ticket's, the ones in the changes);
     - `scenarios.ts`: the create operation from the tool's own OpenAPI description, the session's context for a new scenario;
     - `ship.ts`, `sessions.ts`, `hook-state.ts`, `health.ts`.
   - **v1 modules v2 leans on:** `server/verify.ts` (the guard: every request to the tools goes through it), `server/verify-builder.ts` (the test-data tool's client), `server/verify-launch.ts` (`BuilderLauncher`), `server/tickets.ts`.
   - **Shared:** `v2/shared/types.ts`, `context.ts` (preflight and context pack), `data-tools.ts`, `tickets.ts`, `ship-text.ts`.
   - **MCP:** `v2/mcp/protocol.ts` (the tool definitions, no dependency) and `toolbelt.ts` (stdio).
   - **Hooks:** `v2/hooks/hook.mjs`.
   - **Web** (`v2/web/`, React, plain CSS in `styles.css`): `Launchpad.tsx` + `TicketPicker.tsx`, `Switchboard.tsx`, `DataPanel.tsx`, `Hud.tsx`, `ShipDock.tsx`, `api.ts`.
4. Run `git fetch`, `git status`, `pnpm typecheck`, `pnpm test` (497 at §143).
5. Tell me in a few lines where v2 stands and what's open, then wait for the first issue.

## Working from VU reports
- **The VU laptop can't push.** The owner pulls there after each fix, restarts v2 (`pnpm v2`), and tries again. Every fix ends with a short *To check at VU*: what to pull and restart, what to do, what a good result looks like.
- **What a report looks like:** a description, a screenshot, a log excerpt from `~\.cc-control\v2-server.log`, or a handoff in the shape of `docs/prompts/vu-handoff-template.md`. Treat everything in it as a description of VU's tools; **never copy VU names, URLs, hosts, tickets, field values or tokens into the repo.**
- **Reproduce before fixing** when you can: the walk's stand-ins (`docs/walkthroughs/simple-new-card/standins/verify-tools.cjs`: the test-data tool, the record lookup, the set tool; `docs/walkthroughs/v2/flaky-api.cjs`; a made-up repo and stack) can usually be made to behave the way VU's tools did. Add a walk check for the bug, fix it, see it pass.
- **When the fix depends on something only VU can see** (an API shape, a page's markup, a status name, how a tool really starts), don't guess a write path. Say what's needed and give the owner a short prompt for a session on the VU laptop that reads it and reports back with made-up values (like `docs/prompts/vu-scenario-api.md`). Read-only guesses that degrade gracefully are fine; say they are guesses.
- **Machine-specific answers** go in `~/.cc-control/verify.json` or `config.env` on that machine, never the repo: tell the owner the key and the value shape.
- Several small issues can share a commit and a PLAN section; a bigger one gets its own.

## Design source
The owner reviewed and approved the canvas *Command Center v2: the fresh take* (a private claude.ai artifact; ask for the link if you need it). Its surfaces are Launchpad, Switchboard, HUD, Toolbelt and Ship dock; the Data panel (§140) came later. The Switchboard must handle many APIs per session behind one UI. The UI reaches the APIs through its `proxy.conf.json`, which is rebuilt, and the UI restarted, whenever an API is added or removed. APIs not running locally go to Dev through the file's own rules.

## How it fits together
- **Where v2 keeps its data:**
  - It reads v1's DB (`~/.cc-control/cc-control.db`) for workspaces and stacks. A stack is written in v1 (`e`, then Alt+W); v2 has no stack editor yet.
  - Its own sessions live in `~/.cc-control/v2/sessions.json` (`CCV2_DIR`), each with a token, its DataEvents (`data`), field picks (`fieldPicks`) and scenario folder (`scenarioFolder`).
- **Launch writes three files into the home worktree,** kept out of git through `.git/info/exclude`:
  - `CLAUDE.local.md`: the context pack (it names only the tools this machine has);
  - `.mcp.json`: the toolbelt, with the session's id and token;
  - `.claude/settings.local.json`: the hooks and `enabledMcpjsonServers`.

  Any Claude client opened on the folder gets them. A repo with its own `.mcp.json` keeps it; the terminal then passes ours with `--mcp-config`. **A change to the context pack reaches only sessions launched after it.**
- **Claude's state** comes only from hooks (`applyHook`): needs-you, working, done, ended. A terminal tab is titled with the session key. The HUD's Answer focuses it with v1's `focusTab`, or opens a new tab with `claude --resume <id>`.
- **Toolbelt:** `session_info`, `stack_status`, `stack_up`, `stack_add_api`, `stack_restart`, `stack_logs`; the data tools `test_data_tool`, `list_loan_scenarios`, `make_test_loan`, `scenario_guide`, `make_scenario`, `lookup_fields`, `update_fields`, `fields_to_check`, `set_fields_to_check`, `data_status`; `add_evidence`, `ship`.
  - Every data tool use is a **DataEvent** on the session, shown live on its Data panel; a failed one is a tool error for Claude.
  - A tool call answers within **270 s**: Node's fetch in the toolbelt gives up waiting for headers at 300 s. Long work (a loan, a scenario's run) carries on in the server; `data_status` waits for it.
  - Test loans and field values go to Claude on purpose (a deliberate change from v1). Never Prod.
  - `update_fields` (and the panel's edit in place) use the lookup's update form only when the machine's verify.json allows updates; editable fields and their options only.
  - New scenarios (§143): Claude reads the tool's shape at run time (`scenario_guide`: its OpenAPI create operation, a template scenario, its installed source) and `make_scenario` posts it, marked `kind: 'create'`, to exactly the create address (`builder.createPath`, default `api/scenarios`). Nothing else on the tool is written.
- **The Data panel** (per session): the test-data tool (**Set up** from its install folder, **Start it** / **Stop it**); **Look up fields** (fills itself with the newest loan and the fields to check; edit in place); **New loan** (*New scenario for this session*: folder, template, notes, *Ask Claude to make it* copies the ask and brings the terminal forward; or *Run a saved scenario*); every event, newest first.
- **Machine settings, never in the repo:**
  - `~/.cc-control/config.env`: Jira (`CC_CONTROL_JIRA_*`); `CCV2_JIRA_SKIP` (statuses left out of *your tickets*; default Ready for PO, Ready for Prod); `CC_CONTROL_SLACK_WEBHOOK`, `CC_CONTROL_SLACK_CHANNEL`, `CC_CONTROL_SLACK_MENTION`;
  - `~/.cc-control/verify.json`: the record lookup (`url`, `recordField`, `updateUrl`, `allowUpdate`, `updateFields`) and the test-data tool (`name`, `url`, `launch`, `cwd`, `createPath`; Set up writes the start ones);
  - `~/.cc-control/field-lists.json`: saved field lists.

## Running and testing
- **The owner's servers:**
  - v2 runs at `http://127.0.0.1:7878` (`pnpm v2`, or hidden: `node v2/server/main.ts`, logging to `~\.cc-control\v2-server.log`). A server change needs a restart; ask first if it has sessions with running stacks.
  - v1 runs on **:7777**. Never touch it without asking.
  - **:7788** is someone else's server; leave it alone.
- **Before a commit:**
  - `pnpm typecheck`, `pnpm test`;
  - the walk, on an isolated server (:7841), with stand-ins for the repos, the stack, the tools and Slack:
    ```
    pnpm exec vite build --config v2/vite.config.ts --outDir ../../dist/v2-test --emptyOutDir
    node docs/walkthroughs/v2/walk-v2.cjs
    ```
    It passed 90/90 at §143. Extend it for what you change. Look at the screenshots in `docs/walkthroughs/v2/shots-v2/` when the UI visibly changed. Delete `dist/v2-test` afterwards.
  - A change to v1's guard or its tool clients: their unit tests (`server/verify*.test.ts`); `walk-verify` only when v1's own panel is affected.
- **Commits:** one conventional commit per phase, with a PLAN section in the same commit (next free number: **144**; `git fetch` first). Then push to main; that's pre-approved.
- **The repo is public:** no internal hosts, names, URLs, ids or tokens, and none of the team's tool names (call them "the test-data tool", "the record lookup", "loan setup"). Use example.invalid and made-up data.
- **On Windows:**
  - the Bash tool's heredocs (and Python strings inside them) eat backslashes and break regexes and apostrophes in TS strings; use Write/Edit for code;
  - through Node's `shell: true`, cmd runs a script only as `.\name.cmd` (not quoted, not bare);
  - normalise paths before comparing (`C:/x` and `C:\x`).
- At the end, say plainly what was verified and what wasn't.

## Open items (PLAN §137 to §143)
- **The owner is checking at VU:**
  - a real terminal launch (`/mcp` lists *command-center*, and the Switchboard follows Claude);
  - the ticket picker against real Jira (§138);
  - the real stack, adding an API;
  - the data tools against the real ones (§140 to §143): Set up finding the install and the right start commands; loans; lookups with details; changes applying; the fields to check; a new scenario made by Claude, filed under a folder, and run (does the tool serve an OpenAPI description outside Development? is `api/scenarios` its create address? must a new scenario be locked before it runs?);
  - Slack and a real PR.
- **Release lane:** connecting Dev and UAT to the real pipelines (needs to know what they run on).
- **Claude Desktop:** no way to launch it on a folder yet.
- **Loan setup:** the tool, later.
- **Screenshots as evidence.**
- **A stack editor in v2,** so v1 isn't needed for setup.
- **From the robustness plan** (`docs/prompts/continue-try-it-robustness.md`), applied to v2's stacks: a stop sweep for stray processes, a per-developer stack overlay, killing orphan pids in leftovers.
- `docs/prompts/continue-try-it-stack.md` still names the test-data tool by its real name in three places: scrub it when convenient.
