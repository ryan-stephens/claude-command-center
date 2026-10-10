# Continue developing Command Center v2

Paste this into a new Claude Code session opened in `D:\repos\cc-control`, then say what to work on.

---

You're picking up **Command Center v2**: the second draft of cc-control (GitHub `ryan-stephens/claude-command-center`). It lives in `v2/`, beside the untouched v1. The owner uses it to speed up their own dev work. Speed of development matters more than heavy regression guarding (PLAN §136).

## The idea (PLAN §137)
- **A session is the unit of work.** Claude Code runs where the user already works: a terminal tab, VS Code or Claude Desktop. v2 never hosts a chat.
- **What the app does:**
  - launches work properly: worktrees in every repo the work touches, with `node_modules` hard-linked; a context pack; the stack;
  - shows every session's stack on a **Switchboard**: one UI, many APIs;
  - gives Claude the team's tools over an MCP **toolbelt**;
  - ships PRs with evidence, then posts the review request to Slack.
- **Rejected by the owner** (don't bring them back): keyboard-first, "Try it two ways", A/B comparison.

## Get familiar first, then stand by
1. Read `CLAUDE.md`. The v2 rules: no keyboard-first rule, and reuse v1's server modules instead of copying them. The repo-wide rules:
   - local-only on 127.0.0.1;
   - pnpm on Node 24;
   - conventional commits; stage named paths, never `git add -A`;
   - the two-laptops rule;
   - MVP pace.
2. Read `v2/README.md` and PLAN §137 (search `docs/PLAN.md` for `## 137.`). Don't read the whole PLAN.
3. Skim the code:
   - **Server:**
     - `v2/server/main.ts`: routes, the snapshot over SSE, hooks, the toolbelt's `/tool/*`;
     - `stacks.ts`: one UI and many APIs on v1's `RunService`, the proxy rebuilt on add or remove, health probes, leftovers;
     - `launch.ts`: worktrees and the session's three local files;
     - `tools.ts`: test loans and field checks through v1's guard;
     - `ship.ts`: push, PRs and Slack;
     - `sessions.ts`, `hook-state.ts`, `health.ts`.
   - **Shared:** `v2/shared/types.ts`, `context.ts` (preflight and context pack), `ship-text.ts`.
   - **MCP:** `v2/mcp/protocol.ts` (the tools, no dependency) and `toolbelt.ts` (stdio).
   - **Hooks:** `v2/hooks/hook.mjs`.
   - **Web:** `v2/web/` (React, plain CSS in `styles.css`): `Launchpad.tsx`, `Switchboard.tsx`, `Hud.tsx`, `ShipDock.tsx`, `api.ts`.
4. Run `git fetch`, `git status`, `pnpm typecheck`, `pnpm test` (471 at §137).
5. Then tell me briefly what v2 does, what's newest, and what's open, and wait for a task.

## Design source
The owner reviewed and approved the canvas *Command Center v2: the fresh take* (a private claude.ai artifact; ask for the link if you need it). Its surfaces are Launchpad, Switchboard, HUD, Toolbelt and Ship dock. The Switchboard must handle many APIs per session behind one UI. The UI reaches the APIs through its `proxy.conf.json`, which is rebuilt, and the UI restarted, whenever an API is added or removed. APIs not running locally go to Dev through the file's own rules.

## How it fits together
- **Where v2 keeps its data:**
  - It reads v1's DB (`~/.cc-control/cc-control.db`) for workspaces and stacks. A stack is written in v1 (`e`, then Alt+W); v2 has no stack editor yet.
  - Its own sessions live in `~/.cc-control/v2/sessions.json` (`CCV2_DIR`), each with a token.
- **Launch writes three files into the home worktree,** kept out of git through `.git/info/exclude`:
  - `CLAUDE.local.md`: the context pack;
  - `.mcp.json`: the toolbelt, with the session's id and token;
  - `.claude/settings.local.json`: the hooks and `enabledMcpjsonServers`.

  Any Claude client opened on the folder gets them. A repo with its own `.mcp.json` keeps it; the terminal then passes ours with `--mcp-config`.
- **Claude's state** comes only from hooks (`applyHook`): needs-you, working, done, ended. A terminal tab is titled with the session key. The HUD's Answer focuses it with v1's `focusTab`, or opens a new tab with `claude --resume <id>`.
- **Toolbelt:** `session_info`, `stack_status`, `stack_up`, `stack_add_api`, `stack_restart`, `stack_logs`, `list_loan_scenarios`, `make_test_loan`, `check_fields`, `add_evidence`, `ship`.
  - Test loans and field values go to Claude on purpose. This is a deliberate change from v1.
  - Never Prod.
  - The lookup's update form is not exposed.
- **Machine settings, never in the repo:**
  - `~/.cc-control/config.env`: Jira; `CC_CONTROL_SLACK_WEBHOOK`, `CC_CONTROL_SLACK_CHANNEL`, `CC_CONTROL_SLACK_MENTION`;
  - `~/.cc-control/verify.json`: the test-data tool and the record lookup.

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
    It passed 47/47 at §137. Extend it for what you change. Look at the screenshots in `docs/walkthroughs/v2/shots-v2/` only when the UI visibly changed. Delete `dist/v2-test` afterwards.
- **Commits:** one conventional commit per phase, with a PLAN section in the same commit (next free number; `git fetch` first). Then push to main; that's pre-approved.
- **The repo is public:** no internal hosts, names, URLs, ids or tokens, and none of the team's tool names (call them "the test-data tool", "the record lookup", "loan setup"). Use example.invalid and made-up data.
- **On Windows,** the Bash tool's heredocs eat backslashes and break regexes; use Write/Edit for code.
- At the end, say plainly what was verified and what wasn't.

## Open items (PLAN §137, *Not yet* and *To check at VU*)
- **The owner checks at VU:**
  - a real terminal launch (`/mcp` lists *command-center*, and the Switchboard follows Claude);
  - the real stack, adding an API;
  - a real test loan and field check;
  - Slack and a real PR.

  Fix what that finds; handoffs from the work laptop follow `docs/prompts/vu-handoff-template.md`.
- **Release lane:** connecting Dev and UAT to the real pipelines (needs to know what they run on).
- **Claude Desktop:** no way to launch it on a folder yet.
- **Loan setup:** the tool, later.
- **Screenshots as evidence.**
- **A stack editor in v2,** so v1 isn't needed for setup.
- **From the robustness plan** (`docs/prompts/continue-try-it-robustness.md`), applied to v2's stacks: a stop sweep for stray processes, a per-developer stack overlay, killing orphan pids in leftovers.
