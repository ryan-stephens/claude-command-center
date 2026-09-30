# Continue developing cc-control

Paste this into a new Claude Code session opened in `D:\repos\cc-control`, followed by whatever you want to work on.

---

You're working on **cc-control** ("Command Center", GitHub `ryan-stephens/claude-command-center`): a local web app for working with many Claude Code sessions at once. The owner uses it daily and is showcasing it to their org. Here is what you need to know about it.

## What it's for
It's meant to make working with Claude Code faster and easier to understand than juggling terminals. The aims:
- **Non-developers can "be dangerous"** (get real work done and follow what happened).
- **Experienced developers can be fast.**
- **Nobody drowns in options.**

It is **keyboard-first with the keys visible**: keycaps drawn on everything, a legend bar of the keys that work right now, and `?` for all of them. The owner chose that "cockpit" style deliberately over a minimal hide-the-keys look.

The main concepts:
- **Workspaces:** named groups of repos. Every session in a workspace can use all of its repos.
- **A repo library** scanned from source folders; `+` on the line adds a repo from it to a workspace.
- **The Ticket Line is the home page** (PLAN §27–§30): cards on a board (Inbox → Plan → Build → Needs you → Try it → Ship → Done), each following a Claude Code session in a terminal tab. A session opens full screen from its card (`Ctrl+Enter`); `Ctrl+K` finds any session, card or not. The old three-column Home is gone.

**Latest direction (2026-09-29):** the owner still reaches for plain Claude Code terminals over the app. They want it to *sit on top of* terminal sessions and to help people see and follow the development work, rather than replicate Claude Code features. How to get there is open; talk it through with them. `docs/PLAN.md` §26 has the reasoning. **Chosen (§27):** the *Ticket Line*, a board of tickets moving through the loop with a new-card screen for context. The spec is `docs/futures/path-line.html`; the build handoff is `docs/prompts/continue-ticket-line.md`.

## Where things are
- **Rules:** `CLAUDE.md`.
  - Local-only: loopback, never deployed publicly.
  - Keyboard-first: every action needs a key and a row in `?` and the legend.
  - pnpm; check `sdk.d.ts` before assuming an SDK API; conventional commits, staging named paths only.
- **History and decisions:** `docs/PLAN.md`, a numbered section per piece of work. Add one in the same commit as the change. Also `README.md`, plus `docs/UX-AUDIT.md` and `docs/design-cockpit.html` for the design background.
- **Server** (`server/`, Node 24 running TypeScript directly, Hono + ws, `node:sqlite`):
  - `index.ts`: HTTP/WebSocket and message handling.
  - `session-manager.ts`: live SDK `query()` sessions, resume/fork, modes.
  - `history-index.ts`: every session on the machine, watched under `~/.claude/projects`.
  - `mirror.ts`: live updates for sessions running in a terminal.
  - `permission-broker.ts`, `activity.ts`, `todos.ts`, `transcript.ts` (SDK messages → UI items).
  - `store.ts` (SQLite: commands, workspaces, settings), `repo-library.ts`, `fs-browse.ts`, `file-search.ts`, `packs.ts` / `commands.ts` (workflows).
- **Shared:** `shared/protocol.ts` holds the WebSocket message types and `PROTOCOL`. Bump `PROTOCOL` when the page starts relying on a message an older server would drop.
- **Web** (`web/`, React 19 + Zustand + Tailwind, Vite):
  - `store.ts` (state), `ws.ts` (messages), `keys.ts` (key routing and the `?` keymap), `line-keys.ts` / `line-model.ts` (the line's keys and pure logic), `legend.ts` (the bottom key bar), `bindings.ts` (rebindable shortcuts).
  - Components: `TicketLine.tsx` (the board and the drawer), `NewCard.tsx`, `SessionView.tsx` (a session full screen), `Approval.tsx`, `Transcript.tsx`, `Dialogs.tsx`, `FolderPicker.tsx`, `NumPad.tsx`, `Palette.tsx`.
  - Pure logic lives in small modules with `*.test.ts` next to them.
- **Spikes:** `spike/`, including `channel.mjs`, a tested Claude Code channel server.

## Useful facts about Claude Code (CLI 2.1.285)
- **No supported way for another program to join a running terminal session.**
  - `claude --bg` / `attach` are terminal-only, and Remote Control only connects claude.ai and the apps.
  - The transcript JSONL format is internal, so read it through the SDK (`getSessionMessages`).
- **Channels (research preview) can push messages into a terminal session and relay its approvals.**
  - Tested live; see `spike/channel.mjs` and PLAN §26.
  - The server learns its session from `CLAUDE_CODE_SESSION_ID`.
  - The terminal needs `--dangerously-load-development-channels`.
- **Hooks** are the documented, flag-free way for sessions to report events. Ticket Line cards use a SessionStart hook loaded with `claude --settings` (PLAN §28), never the user's own settings.
- **`--add-dir` takes every argument after it:** put `--` before a prompt that follows it.
- **A server started from inside a Claude Code session** hands that session's `CLAUDE_CODE_*` markers to anything it spawns; a `claude` that inherits them runs as its child and writes no transcript of its own. `tabEnv` in `server/cards.ts` strips them.
- **Auto mode** isn't available for every model (Haiku refuses it).
- The `claude-code-guide` agent can look things up in the official docs.

## State
- `main` may have commits that are not pushed yet (`git log origin/main..HEAD`). Ask the owner before pushing.
- Checks: `pnpm typecheck`, `pnpm test` (162 tests, `node:test`) and the Vite build all pass. `tsc` has no unused-locals check, so also run `npx tsc --noUnusedLocals` now and then: it caught a shadowed name in §30.

## How to work here
- Windows 11, Node 24, pnpm; files are CRLF. The Bash tool's heredocs eat backslashes (regexes, Windows paths), so use Write/Edit, or a Python script written with Write.
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
  - Seed data (workspaces, sessions) from inside the page with `page.evaluate` and a WebSocket, because the server checks the Origin header.
- **Screenshots only inside a Demo workspace.** "Everything else" shows the owner's real sessions. Demo git repos are in `%TEMP%\cc-demo` (web-app, docs-site, payments-api, cdn-worker, design-tokens).
  - `web-app` already has uncommitted changes from 2026-09-28 that aren't yours; leave them alone.
  - To stand in for a terminal session, use `C:/Users/ryans/.local/bin/claude.exe -p "…" --model haiku` in a demo repo (`--resume <id>` continues it). Call the exe directly; `shell: true` splits the prompt into words.
- **Before calling something done,** verify it for real (a scripted walkthrough on the isolated server), and report plainly what passed and what didn't.
