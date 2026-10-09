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
- **The Ticket Line is the home page** (PLAN §27–§30; since §126 cards in three bands by whose turn it is, Your move / Claude's move / Parked, with tickets to start above and Done below), each with its own Claude Code session, which the app runs (§93; before that, each ran in a terminal tab). A session opens full screen from its card (`Ctrl+Enter`); `Ctrl+K` finds any session, card or not. The old three-column Home is gone.

**Latest direction (2026-10-06, PLAN §92):** a card's session runs inside the app through the SDK; the terminal is the escape hatch (`g`), and the launcher and channel are being retired. The phased plan is `docs/prompts/continue-hub.md`; Phase A is done (§93, `walk-hub.cjs`). **Speed (§94 to §99) is done:** every number in the budget holds, and `walk-perf.cjs` keeps it so (where it stands and what is left: `docs/prompts/continue-speed.md`). The owner called it "fucking amazing". **Now (2026-10-06): the owner is testing Try it on the VU laptop** with a lane stack (a local UI against a local API they ticked): the services start, the UI reaches the API, the logs come through. The first bug from that round, Open saying *Nothing running yet* while the UI was up, is fixed in §102. Fix what that testing finds; the hub phases B, D to F stay tabled. **Since then (2026-10-06):**
- §104: Start, Stop, Restart (`Shift+R`) and Open buttons on a card's tile.
- §105 to §107, §132 to §135: the Verify panel (`v`) has a tab per internal tool (`Alt+←` `→`): *Test data* (§133, a scenario runner on the machine that creates test loans in Dev or UAT, driven through its API; §135: `Shift+S` starts it with the machine file's `launch` commands when it isn't running, `Shift+K` stops it), the *record lookup* (§132: saved field lists in `~/.cc-control/field-lists.json`, ids with spaces, filter, copy; §134: updates in Dev and UAT only, off unless the machine's file says `allowUpdate`, staged, sent after a second `Shift+U`, checked by fetching again) and the *field set* (read-only, unchanged). Their addresses and names live in a file on each machine, `~/.cc-control/verify.json`, never in the repo, which is public. Every request goes through `guard` in `server/verify.ts` (three allowlists: reads, the scenario runner's three calls, one write). `docs/prompts/continue-verify-at-vu.md` is the VU test prompt.
- §106: Ctrl+V in the message box.
- §108, §109: the SDK CLI fallback, and worktrees made by hand (another session).
- §110, §111: a card's worktree gets the main checkout's `node_modules` as a folder of hard links (`scripts/link-deps.ts`). The VU UI is a huge monolith, about 20 minutes to install, so never install per card and never junction: `git worktree remove` follows a junction and empties the main checkout's packages.
- §112: the clone's lock let two clones through when a stack's services started together, and the half-made `node_modules.cc-control-tmp` it left broke Nx's project graph. The lock is now renamed into place whole, the clone is built in the git folder, and a leftover is removed by the next Try it.
- §113: the Try it panel lists the UI first, as the service that always starts, and says why. A compiling dev server (Nx, Angular, webpack) is up only when it prints its done line, not when it first prints its address.
- §114: two cards can run the same API and UI at once. A UI dev server without `--port` gets `--port {{uiPort}}`, and the manifest copy drops okteto's fixed SSH port (`remote:`) and gives every other forward a port of its own. `PortPool.take` no longer hands one port to two takes running at once.
- §115: the card chat's header (and the full-screen session) shows the session's branch, the context used (tokens of the window and the percentage) and its cost so far.
- §116: the card chat takes pictures: `Ctrl+V`, drop, or `Shift+I` (the file picker); they go with the next message (PROTOCOL 29).
- §117: Try it writes each card's app and services' output to `runs/logs/<card key>/<service>.log`; the card's session can read that folder and its system prompt says where it is.
- §118: the card chat's message box grows with its text and can be made taller (drag its top edge, `Ctrl+Shift+↑ / ↓`), kept in the browser.
- §119: a terminal session writing no longer floods the page (the mirror sends only what follows; the session list is re-read at most every 10 s for a known session), and Ctrl+K matches a session's first prompt (Claude Code's own `ai-title` replaces its title). `walk-mirror` measures it.
- §120: the card chat fits its column (its grid track grew to its widest content: a wide table, a long line); `walk-chat-width` checks it.
- §121, §122: sign-in on a picked UI port. The team's identity provider (an OIDC app) only sends you back to registered login redirect URIs, each a port with the app's path, and the UI builds its `redirect_uri` from the page's address. So a UI on 18xxx can't sign in. Since §122 the UI keeps its own port (its project file's) while it's free, and a second card's takes one of `CC_CONTROL_UI_PORTS` (ports registered for sign-in; set in the VU laptop's `config.env`, never in the repo). None listed: the range, with a note in the run's output; all taken: Try it names the cards that hold them.

- §123: the front door. A sign-in registered as a port and a path (tried at VU: another app's registered port is refused), and no more registrations to be had, so cc-control holds the UI's own port and forwards it to one card's UI at a time; every card's UI runs on a port of its own behind it, and `o` on a card shows its UI there, signed in. Each card's API and UI keep running.

**Now (2026-10-08): the home page is Your Move** (§126): cards in three bands by whose turn it is (Your move, Claude's move, Parked), answered on the tile, unread turns kept per browser. It replaced the board's columns, after the canvas (§124, §125) felt jumbled and five layouts were compared (`docs/futures/home-layouts.html`). `walk-your-move` checks it. Since §127 it matches its mock: *Ready to try* with Looks good (`l`) / Found a problem (`p`), a parked count, cards that glow as they change band, and *Lane* is *Workspace* on screen. Then the owner's list of 2026-10-08 (`docs/prompts/continue-polish.md`): an empty band keeps one row of room (§128); the open card shows its mode in the chat's header and `Shift+Tab` switches it, past Auto on Haiku (§129); the chat stays where you read while Claude writes, keeps its place when the message box changes size, and shows a ↓ (`End`) back to the newest, in the card and the full-screen session alike (§130, `web/stick.ts`). Next: new README screenshots.

**Also open (2026-10-08):** the owner tries the front door at VU (§123, *To check at VU*): sign-in through it, switching with `o`, live reload after a switch. Never commit the identity provider's host, the app's client id, the apps' names or paths, or any VU URL.
The earlier direction, for history:

**Direction (2026-09-29):** the owner still reaches for plain Claude Code terminals over the app. They want it to *sit on top of* terminal sessions and to help people see and follow the development work, rather than replicate Claude Code features. How to get there is open; talk it through with them. `docs/PLAN.md` §26 has the reasoning. **Chosen (§27):** the *Ticket Line*, a board of tickets moving through the loop with a new-card screen for context. The spec is `docs/futures/path-line.html`; the build handoff is `docs/prompts/continue-ticket-line.md`.

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
- **Push finished work to `main`** (owner, 2026-09-30): once a change is verified and committed, push it without asking. The owner now works and tests mainly on their Veterans United laptop, from a clone they `git pull`; that is where the real Jira Cloud, TFS and Okteto are. Restarting a running server, writing to Jira or TFS, and opening real PRs still need asking.
- **MVP pace (PLAN §136, 2026-10-09):** the owner wants faster development over heavy regression and performance guarding. Before a commit: `pnpm typecheck` and `pnpm test` (452 tests, `node:test`), plus the walk for the feature you changed, in one theme. `npx tsc --noUnusedLocals` when convenient.
- **Walkthroughs** in `docs/walkthroughs/simple-new-card/`:
  - `walk-card` (66, light and dark), `walk-hub` (41, a real Haiku card, `PORT=7794`) and `walk-perf` (the speed budget): run them when a change touches the open card, sessions in the app or speed, or before a showcase; not required per commit (§136).
  - Feature walks: `walk-board-try` (19), `walk-verify` (119, light and dark: stand-in field set, record lookup with an update form, and scenario runner in `standins/verify-tools.cjs`, which logs and flags any request outside the allowlists; Start and Stop of the test-data tool with `standins/builder-start.cjs`), `walk-deps` (20, with a stack of two services on one bare worktree), `walk-try-compile` (15, light and dark: the UI row, and a compiling stand-in UI), `walk-two-cards` (26, light and dark: its own server with stand-in okteto and nx; two cards on one API and UI at once, both UIs behind the front door on 4216, `o` switching it), `walk-mirror` (8: a terminal writing into a big session; its own server; numbers only), `walk-chat-width` (6, light and dark; PORT=7811) `walk-your-move` (32, light and dark: the home page's bands and keys; its own server on 7827) and `walk-chat-scroll` (26, light and dark: the chat's scrolling while a seeded card streams; its own server on 7828).
  - **`walk-perf`'s key-to-paint numbers have been 14 to 28 ms against 16 since the afternoon of 2026-10-06, on page code that measured 9 ms that morning.** An A/B against the §104 page showed the same scatter, so it's the machine. Look into it before trusting a perf result. (Since §119 the runs have been clean more often than not; Ctrl+K's miss was a real bug, fixed there.)
- **Stopping a test server with `Stop-Process` orphans its sessions' MCP servers** (§95, §98). Check for `npx … mcp-server-*` processes whose parent is gone, and stop only those trees.
- **Every walk that makes worktrees must leave none behind:** check `%TEMP%\cc-demo` for `*-card-*` folders after a walk you stopped.

## How to work here
- Windows 11, Node 24, pnpm; files are CRLF. The Bash tool's heredocs eat backslashes (regexes, Windows paths), so use Write/Edit, or a Python script written with Write.
- **The owner's app runs on `:7777`** as a hidden `node server/index.ts`, logging to `~\.cc-control\server.log`.
  - It serves `dist/web`, so `pnpm build` changes their page on its next reload.
  - Server changes need a restart, which stops sessions running inside the app. **Ask first.** `Stop-Process` doesn't let the server stop the apps it started for Try it, so stop those first (`t` on the card). The way it's been restarted:
    ```powershell
    $p = (Get-NetTCPConnection -LocalPort 7777 -State Listen).OwningProcess; Stop-Process -Id $p -Confirm:$false
    Start-Process node -ArgumentList 'server/index.ts' -WorkingDirectory 'D:\repos\cc-control' -WindowStyle Hidden -RedirectStandardOutput "$env:USERPROFILE\.cc-control\server.log" -RedirectStandardError "$env:USERPROFILE\.cc-control\server.err.log"
    ```
- **Test on an isolated server, never theirs:**
  1. Build: `pnpm exec vite build --outDir ../dist/web-test --emptyOutDir`.
  2. Run with `CC_CONTROL_PORT=7788 CC_CONTROL_DB=$TEMP/cc-test-4.db CC_CONTROL_MODEL=claude-haiku-4-5-20251001 CC_CONTROL_WEB_DIST=D:/repos/cc-control/dist/web-test node server/index.ts`.
  3. Stop it by the PID on `:7788`, after checking its command line is `server/index.ts`. Delete `dist/web-test` afterwards.
- **A card for tests without a terminal** (§80): on a server whose `CC_CONTROL_PORT` isn't the default, the `cards.seed` message (`options: { repos, worktrees?, workspaceId?, key?, title?, state?: 'plan'|'tool'|'working'|'idle'|'done', channel?, files? }`, answered with `card.started`) writes a card that looks started, with a seeded transcript served for its made-up session id. `docs/walkthroughs/simple-new-card/walk-card.cjs` seeds one per state and screenshots each. The owner's server at :7777 refuses it.
- **Headless Playwright:** `require('C:/Users/ryans/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright')`, with `executablePath: 'C:/Users/ryans/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'`. Set `localStorage['cc-control.welcomed.v2']='1'` to skip the welcome.
  - Seed data (workspaces, sessions) from inside the page with `page.evaluate` and a WebSocket, because the server checks the Origin header.
- **Screenshots only inside a Demo workspace.** "Everything else" shows the owner's real sessions. Demo git repos are in `%TEMP%\cc-demo` (web-app, docs-site, payments-api, cdn-worker, design-tokens).
  - `web-app` already has uncommitted changes from 2026-09-28 that aren't yours; leave them alone.
  - To stand in for a terminal session, use `C:/Users/ryans/.local/bin/claude.exe -p "…" --model haiku` in a demo repo (`--resume <id>` continues it). Call the exe directly; `shell: true` splits the prompt into words.
- **Before calling something done,** run the feature's walk on an isolated server, and report plainly what passed and what didn't.
