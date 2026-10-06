# Continue cc-control: make it fast (the speed push)

Paste this into a new Claude Code session opened in `D:\repos\cc-control` (the personal laptop) after `git pull`. On the VU work laptop: read, measure, diagnose and write a handoff (`docs/prompts/vu-handoff-template.md`); never edit or commit there.

---

You're continuing **cc-control** ("Command Center", GitHub `ryan-stephens/claude-command-center`): a local, keyboard-first web app where each card on the Ticket Line is one unit of work (a Jira or TFS ticket, its repos and worktrees, and a Claude Code session) that moves Plan → Build → Needs you → Try it → Ship. Since PLAN §93 a card's session **runs inside the server** through the Agent SDK (`server/session-manager.ts`): the open card streams the reply, `Enter` sends, `y` / `n` and the question form answer through the permission broker, `Esc` stops a turn, a restart resumes on the next message. `g` hands a session to a Windows Terminal tab.

## The one goal of this push (owner, 2026-10-06)

> The app has to be fast as fuck and never leave the user wanting to switch back to a Claude Code terminal. Switching between Claude Code sessions should be effortless: implementation, smoke testing, QA, code review, shipping, and starting a session with its context loaded.

**The other hub phases (B, D, E, F in `docs/prompts/continue-hub.md`) are tabled.** Don't start them. Speed and smoothness only: anything that makes an interaction feel slower than a terminal is in scope; new features are not, unless one exists only to make a hop faster (and then it needs a key, a `?` row and a legend entry, as always).

## What "smooth" means here: the budget

Measure all of it first, then make each number true, and keep it true with a walkthrough that fails above budget. Haiku on the isolated server; a "warm" card is one whose transcript the page has seen this session.

| Interaction | Budget |
|---|---|
| A key in the message box → painted | < 16 ms (no dropped frames while another card streams) |
| `←` / `→` to the next card, or `Enter` on a card → its chat on screen | < 100 ms warm, < 300 ms cold, for a 300-item transcript |
| `Ctrl+K` → a session picked → on screen | < 150 ms warm |
| `Enter` (send) → your message in the chat | < 50 ms (optimistic) |
| Send → first streamed text | API-bound: our own overhead < 100 ms on top of the model's time to first token |
| `y` → the tool runs | < 100 ms of ours (today 15 ms for a plan) |
| `Ctrl+Enter` on the new-card screen → the card open with its chat | < 300 ms (git worktrees aside, and say what they cost) |
| New card → first streamed text | as close to a warm session as possible (today 5.3 s on Haiku; the CLI start is about 1 s of it) |
| Board with 20 cards and 3 sessions streaming | 60 fps scrolling and moving; no long tasks over 50 ms |
| Server restart → the next message's first text | < 2.5 s (today 1.6 s) |

Report each as measured before and after, in the PLAN section. Numbers you can't reach: say why (the API, git, Windows) rather than paper over them.

## Where the time probably goes (check each; these are leads, not facts)

**Server → page traffic**
- `SessionManager.handle` emits `session.partial` with the **whole accumulated text on every `text_delta`**, and `index.ts` broadcasts it to **every** client: O(n²) bytes per reply and a React update per token. Send deltas (or throttle to a frame, ~30 to 50 ms), and only to clients looking at that session.
- `session.items`, `session.activity`, `session.todos`, `permission.*` and `session.upsert` go to every client whatever it shows.
- **Every card change broadcasts every card** (`CardService.save` → `changed` → `cardsMsg()` with all cards, their packets, boot lines, `later`, todos and files). Each hook event during a turn (PreToolUse, PostToolUse…) saves a card, so a busy turn sends the whole board many times a second. Send the one card that changed (a `card.upsert`, with `PROTOCOL` bumped), and slim what the board needs from what the open card needs.
- `session.open` sends the whole transcript; `Mirror` re-reads the whole file for a terminal session on each change.

**Server work per event**
- `CardService.get` / `list` call `store.loadCards()`, which reads and JSON-parses **every** card from SQLite, and `applyHook`, `appEvent`, `bySession` and `answered` call them several times per hook event. Keep cards in memory, write through.
- `manager.transcript()` for a session not live goes through `getSessionMessages` (reads and parses the JSONL) on every open: cache by file mtime.
- `HistoryIndex.refresh` (`listSessions`, up to 300) runs on file changes and session retirement; check it isn't on a hot path while a session streams (its own writes trigger the watcher).

**The page**
- `Chat` in `web/components/CardView.tsx` renders the whole `Transcript` (react-markdown for every message) and re-renders it for each partial; the partial itself is re-parsed as markdown per token. Render the tail and fold older items (`web/folds.ts` exists), memoise items by `uuid`, and debounce the streaming markdown to a frame.
- Zustand selectors that return new arrays or objects re-render on every store change (`useStore((s) => s.cards)` in `CardView` re-renders the open card on any card's change; a `cards` message replaces the array). Audit every `useStore` in `CardView`, `TicketLine`, `App`, `SessionView`: narrow selectors, `useShallow`, per-id maps.
- `App.tsx` computes the legend from several selectors on every change.
- Switching cards: `Chat` sends `session.open` on mount and waits; show what the store already has at once, then reconcile.

**Starting a session**
- The SDK (0.3.283) has an **alpha** `prewarm()` / `claim(ClaimOptions)` (see `sdk.d.ts` around `ClaimOptions` and `prewarm`): a spare CLI process started ahead, claimed with `cwd`, `additionalDirectories`, `model`, `permissionMode`, `appendSystemPrompt`. Host-level options (hooks, `canUseTool`, env, settings sources) are fixed at prewarm, so the card's in-process hooks would have to dispatch by session id rather than close over a card. Spike it before building on it; if it works, keep one spare ready (and another once one is claimed) so a new card, a QA or review card, or a cold resume starts warm.
- The new-card screen: worktree creation is sequential `git worktree add` per repo; run them in parallel and show the card (with its boot lines) before they finish if that's safe.
- Resume of a card whose session isn't live: today the first `Enter` pays the resume. Consider resuming in the background when a card is opened, or when its tile is focused for a moment, so the message goes straight in.

**Things that feel slow without being slow**
- Optimistic UI: the box empties and the message shows at once (already true for card sends; check `SessionView` too); `y` should clear the ask instantly; a card should open showing the last-known chat before the server answers.
- No spinners for things under 150 ms; no layout shift as the chat loads (keep the scroll pinned to the bottom without a jump).

## How to work

1. **Read first:** `CLAUDE.md`; `docs/prompts/continue.md` (layout, the owner's server on :7777, the isolated test server, machine facts); `docs/PLAN.md` §92 and §93 (how card sessions run now); `docs/prompts/continue-hub.md` Phase C (the first sketch of this budget).
2. **Measure before changing anything.** Build `docs/walkthroughs/simple-new-card/walk-perf.cjs` on the pattern of `walk-hub.cjs` (it starts and restarts its own isolated server; use a port other than 7788, where a stale test server from 9/30 may still listen; check its command line before stopping anything). Seed cards with large transcripts through `cards.seed` (extend `seedTranscript` with a size option) and drive one real Haiku card. Measure in the page (`performance.now()` around key → paint with `requestAnimationFrame`, a `PerformanceObserver` for `longtask`, bytes received over the WebSocket per second while streaming) and in the server log (the `send KEY:` timing lines from §93; add lines where you need them). Write the before numbers into the PLAN section first.
3. **Fix the biggest first**, one change at a time, re-measure after each. Keep `walk-hub.cjs` (29 checks) and `walk-card.cjs` (59, light and dark) passing: a faster app that drops a behaviour isn't faster.
4. **Make the budget enforce itself:** `walk-perf.cjs` fails above budget, and prints the numbers. Unit-test the pure parts (a delta protocol, a throttle, a card cache's write-through).
5. Each change gets a PLAN section (next is §95) in the same commit; push verified work straight to `main` (pre-approved). A protocol change bumps `PROTOCOL` in `shared/protocol.ts`.
6. **The owner's app on :7777:** a page-only change reaches it with `pnpm build` (they reload). A server change needs a restart: ask first, and say it stops the sessions the app is running; check no Try it apps are running under it (the lines are in `continue.md`).

## Don't
- Don't start the tabled phases, or retire the launcher and channel (Phase B waits for a test round at VU).
- Don't inject keystrokes into any console.
- Don't trade correctness for speed: no dropped messages, no stale asks that `y` can't answer, never two writers on one transcript.
- Don't commit tokens, VU code, URLs, proxy entries, ticket contents or internal tool names.
- Windows 11, Node 24, pnpm, CRLF files. The Bash tool's heredocs eat backslashes: write scripts with the Write tool, and edit CRLF files with the Edit tool or a Python script that keeps the line endings.

Start by reading, then say in a few lines what you'll measure and how, build the measuring walkthrough, and report the before numbers before the first fix.
