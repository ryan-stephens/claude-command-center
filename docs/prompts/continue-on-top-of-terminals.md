# Continue: an app that sits on top of Claude Code terminals

Paste this into a new Claude Code session opened in `D:\repos\cc-control`.

---

You're picking up **cc-control** ("Command Center", GitHub `ryan-stephens/claude-command-center`). It's a local web app (Node server + React SPA on `127.0.0.1:7777`) for working with many Claude Code sessions at once, built on `@anthropic-ai/claude-agent-sdk`. The owner uses it daily and is showcasing it to their org.

## What we're building, and why the direction just changed

Until now the app tried to be a better place to *drive* Claude: its own message box, slash and `@` suggestions, modes, approvals, a number pad of workflows, workspaces of repos and a repo library. It looks good, but the owner still reaches for plain Claude Code terminals. A wrapper that replicates Claude Code never beats Claude Code.

**The owner's direction now (2026-09-29), in their words:** "sit on top of terminal sessions, not having to replicate any Claude Code functionality — we just need a web app that supports streamlining and easing understandability of the development experience and workflow." The goals:
- **Non-developers can "be dangerous"** (get real work done and understand it).
- **Experienced developers can be "deadly fast".**
- **Nobody is overloaded with options.**

They want every step of the development experience visualised.

Ideas the owner liked in discussion (a starting point, not a spec; use your judgement):
- Live status of every terminal session, across workspaces of repos.
- Plain-language timelines of what a session did.
- A card when a session finishes: what changed, the diff, and next steps.
- A Changes view with undo.
- Context help: handing off to a fresh session when memory fills, notes a whole workspace's sessions start with, and pulling one session's findings into another.
- A short, gentle first run.

**Open question to settle with the owner:** the app can still run its own sessions, with its own message box and everything that goes with it. They haven't decided whether to freeze that code (keep it, add nothing) or remove it.

## Where things stand
- Read `CLAUDE.md` (project rules), `README.md`, and `docs/PLAN.md`: §1–§23 are history, and §24–§26 are the most recent.
  - **§26** records the new direction and what Claude Code does and doesn't allow.
  - **§24** is the session docked beside the list on home.
- **Already works:** a terminal session's conversation updates live in the app. `server/mirror.ts` re-reads a session this app doesn't run through the SDK whenever its transcript file changes, and pushes it to the pages looking at it. Status for terminal sessions is still only guessed from file times ("active elsewhere").
- **Uncommitted:** `spike/channel.mjs`, a throwaway channel server. See "Findings" below.
- **Eight commits on `main` are not pushed.** Ask before pushing.

## Findings about Claude Code (CLI 2.1.285) worth knowing
- **No supported way for another program to join a running terminal session.**
  - `claude --bg` / `claude attach` are terminal-only.
  - Remote Control only connects claude.ai and the apps.
  - The cross-session messaging socket is internal.
  - The transcript JSONL format is internal, so read it through the SDK (`getSessionMessages`), not by parsing it.
- **Channels (research preview) work, tested with a live terminal and `spike/channel.mjs`:**
  - An MCP server with `claude/channel` pushed a message into a running terminal session, and Claude replied.
  - With `claude/channel/permission`, the terminal's approval prompt (tool, description, exact command) reached the server, and an `allow` sent back ran the command. Only allow/deny; no "always".
  - The server gets `CLAUDE_CODE_SESSION_ID` in its environment, which matches the session's transcript file.
  - The catch: the terminal must start with `--dangerously-load-development-channels server:<name>` (plus `--mcp-config`), and Claude Code shows a warning. Team/Enterprise orgs need `channelsEnabled`.
- **Hooks** are the documented, flag-free way for every terminal session to report events (prompt submitted, tool use, needs permission, stopped, session start). They can also add context when a session starts. Not yet tried here.
- **Auto mode** isn't offered for every model (Haiku refuses it).
- Channels, hooks, Remote Control and background sessions all have pages on code.claude.com. The `claude-code-guide` agent can look them up.

## How to work (lessons from earlier sessions)
- Windows 11, Node 24, pnpm. Before a commit: `pnpm typecheck`, `pnpm test` (113 tests, `node:test`), `pnpm build`. Pure logic gets a test file next to it.
- Conventional commits, staging named paths only; add a `docs/PLAN.md` section in the same commit. Keyboard-first stays: every action needs a key, and a row in `?` and the legend (`web/legend.ts`, `web/keys.ts`).
- **The owner's app runs on `:7777`** as a hidden `node server/index.ts`, logging to `~\.cc-control\server.log`.
  - It serves `dist/web`, so `pnpm build` changes their page on its next reload.
  - Server changes need a restart, which stops sessions running inside the app. **Ask first.** The way it's been restarted:
    ```powershell
    $p = (Get-NetTCPConnection -LocalPort 7777 -State Listen).OwningProcess; Stop-Process -Id $p -Confirm:$false
    Start-Process node -ArgumentList 'server/index.ts' -WorkingDirectory 'D:\repos\cc-control' -WindowStyle Hidden -RedirectStandardOutput "$env:USERPROFILE\.cc-control\server.log" -RedirectStandardError "$env:USERPROFILE\.cc-control\server.err.log"
    ```
- **Test on an isolated server, never theirs:**
  1. Build: `pnpm exec vite build --outDir ../dist/web-test --emptyOutDir`.
  2. Run with `CC_CONTROL_PORT=7788 CC_CONTROL_DB=$TEMP/cc-test-4.db CC_CONTROL_MODEL=claude-haiku-4-5-20251001 CC_CONTROL_WEB_DIST=D:/repos/cc-control/dist/web-test node server/index.ts`.
  3. Stop it by the PID on `:7788`, after checking its command line is `server/index.ts`. Delete `dist/web-test` afterwards.
- **Headless Playwright:** `require('C:/Users/ryans/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright')`, with `executablePath: 'C:/Users/ryans/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'`. Set `localStorage['cc-control.welcomed.v2']='1'` to skip the welcome.
  - Seeding (a workspace, sessions) has to happen from inside the page (`page.evaluate` with a WebSocket), because the server checks the Origin header.
- **Screenshots only inside a Demo workspace.** "Everything else" shows the owner's real sessions. Demo git repos are in `%TEMP%\cc-demo` (web-app, docs-site, payments-api, cdn-worker, design-tokens).
  - `web-app` already has uncommitted changes from 2026-09-28 that aren't yours; leave them alone.
  - To stand in for a terminal session, use the plain CLI: `C:/Users/ryans/.local/bin/claude.exe -p "…" --model haiku` in a demo repo, with `--resume <id>` to continue it. Call the exe directly; `shell: true` splits the prompt into words.
- **Editing:** the Bash tool's heredocs eat backslashes (regexes, Windows paths). Use Write/Edit, or a Python script written with Write. Files here are CRLF.
