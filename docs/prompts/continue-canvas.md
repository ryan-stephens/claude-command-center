# The cards canvas: replace the board with one grid of cards and a quick view under each

Paste this into a new Claude Code session opened in `D:\repos\cc-control`.

---

You're continuing work on **cc-control** ("Command Center"), a local web app for working with many Claude Code sessions at once. The owner uses it every day and is showing it to their org. This session redesigns its **home page**. Get oriented first, then agree the design with the owner before you build.

## Read first, in this order
1. `CLAUDE.md`, the rules:
   - local-only, so the server binds to 127.0.0.1;
   - keyboard-first: every action gets a key, a row in `?` and an entry in the legend;
   - pnpm and conventional commits, staging named paths only;
   - the two-laptop rule.
2. `docs/prompts/continue.md`: what the app is, where things are, how to test, the walkthroughs, the state as of §123.
3. `docs/PLAN.md` §124 (search for `## 124.`; don't read the whole file). It records this change of direction. For the board's history, §27 to §30 say why it was chosen, and §104 covers Try it on the board's tiles.
4. The code of today's home page:
   - `web/components/TicketLine.tsx`: `TicketLine`, `LineBar`, `WorkspaceBar`, `Board`, `CardTile`, `TryButtons`, `RunLine`, `ActLine`.
   - `web/line-keys.ts`: `boardOf`, `boardKeys`, `moveFocus`, `openCard`, `openApp`, `tryIt`.
   - `web/line-model.ts`: `cardActivity`, `needsYou`, `booting`, `progress`.
   - `web/legend.ts`.
   - `web/components/CardView.tsx`: the open card. It holds the chat (`Chat`, `Say`), the dock's panels (Try it, Verify, Changes, Context, Ship), and the question and approval forms.

## What the owner said (2026-10-08)
> The main page reads like a kanban board, which I thought would be nice for business folk, but in reality it doesn't accomplish what I wanted. The goal is to be able to context switch between sessions easily, so seeing what's available and where each one is at felt important, hence the kanban styling. But now I think the better way is to show all of the cards we create on one big blank canvas grid. The user can either click into the card to work more deeply, or perform all of the same actions from an expandable popout drawer that attaches to the card and opens below it. So we're still on the main screen, only doing a quick view of the card. This helps us manage cards and sessions more easily than trying to understand why they're in the lane they're in. It should feel very intuitive.

In short:
- **The job of the home page** is switching between sessions: what is there, what each one is doing, which need me, and getting into one quickly.
- **The columns get in the way.** A card's place depends on a stage the app works out (Inbox → Plan → Build → Needs you → Try it → Ship → Done). People spend effort on *why is it in that column* rather than on the work.
- **The app's aims still hold:**
  - non-developers can "be dangerous": get real work done and follow what happened;
  - experienced developers are fast;
  - nobody drowns in options;
  - keyboard-first with the keys **visible** (keycaps on everything, the legend bar, `?`), the "cockpit" the owner chose over a hide-the-keys look.
- **Speed comes first** (since 2026-10-06, PLAN §94): `walk-perf.cjs`'s budget must still hold. A key press paints in 16 ms or less, and so on.

## The proposed design (agree it with the owner before building)
This is a starting point from the previous session. Present it, with mockups, and settle the open decisions below with the owner. Use AskUserQuestion with `preview` mockups for the layout choices.

### 1. The canvas
- **One grid of card tiles across the whole page**, with no columns. It is responsive: tiles about 300 px wide, as many per row as fit, all the same height so the grid reads as a grid.
- **The bar above stays, slimmed:**
  - the workspace chips as filters (`0`–`9`; their names stay as they are);
  - the filter `/`;
  - the counts (*N need you*, *N working*);
  - *New card* `c`, and *Tickets* `⇧T`.

  The workspace's repo row (`WorkspaceBar`) can fold into the chip's menu or the edit dialog. Ask.
- **Each tile says, at a glance:**
  - the key and title;
  - **one status line** in plain words with a colour: *Needs you: approve a command* (amber), *Working: editing files* (busy), *Finished its turn* (ok), *Failed* (red);
  - the app's line (*App on localhost:4216*, from §123), when it runs;
  - the PR line, when there is one;
  - the repos, and how long it has been going.
- **The stage becomes a small marker on the tile, not a place on the page:** a four-step strip, Plan · Build · Try · Ship, with the current step lit. The data (`card.stage`) stays; only the layout goes.
- Drop what is noise on every tile, such as the *terminal* pill on each card.
- **Tickets waiting to start** (today's Inbox column) are not cards. Show them as a thin, collapsible strip above the grid, *N tickets to start* with `v` for mine / Ready for QA, or behind `⇧T`. Ask which.
- **Done cards** go into a collapsed *Done (N)* group at the end, so the canvas holds the live work.

### 2. The order of the cards: decide with the owner
Context switching works best when a card stays where you last saw it (spatial memory). Attention-first sorting moves cards under your eyes. The recommendation:
- **Stable positions:** newest first, or an order the owner sets by dragging or by `Alt+arrows`.
- **Attention shown, not sorted:** an amber tile, and the count in the bar.
- **A key that jumps to the next card that needs you.** Pick an unbound key; check `boardKeys` and `?`.

The other option is grouping by status (*Needs you* / *Working* / *Ready* / *Shipping* as section headers in the one grid), which brings back a little of the board's sorting. Show both as mockups.

### 3. The quick view: a drawer that opens under the card
- **`Space` (or a click on the tile's chevron) opens a panel attached under the tile**, spanning the grid's full width and pushing the rows below down, like an image grid's expanded preview. `Space` or `Esc` closes it, and one is open at a time.
- **`Enter` (or a click on the tile) still opens the card fully**: today's `CardView`, the deep view.
- **What the quick view holds:** what's needed to act without leaving the canvas, built from `CardView`'s own pieces rather than copies of them.
  - **Now:** the status line, and the last few chat items (Claude's last message and the tools it ran).
  - **Waiting on you:** a pending approval (`y` / `n`) or a question (`1`–`9`), answerable right there.
  - **A message box:** `Enter` sends, pictures are welcome (§116), and the session's meter shows (§115).
  - **Try it:** the services and their state, plus `t`, `⇧R` and `o` (the front door, §123).
  - **Changes:** files changed with a link to `⇧D`, and Ship's state (`s`).
  - **Ways in:** open fully (`Enter`) or in a terminal (`g`).
- **Arrow keys move between tiles while it is open.** Does the drawer follow the focused card, or stay? Decide with the owner; following it makes `↓ ↓ ↓` a fast way to look through every session.
- **Every action in it is the same function the board and the open card already call** (`line-keys.ts`), so the keys mean the same everywhere.

### 4. Keys
- **Keep every board key with the same meaning:** arrows (now a 2D grid), `Enter`, `t`, `⇧R`, `o`, `g`, `⇧D`, `s`, `d`, `e`, `c`, `/`, `0`–`9`, `Delete`, `⇧X`.
- **New keys:** `Space` for the quick view, the next-needs-you key, and the reorder keys if they are chosen.
- Update `?` (the *Ticket Line* section in `line-keys.ts`'s keymap; rename it) and the legend (`legend.ts`) for the canvas and for the open quick view.

## How to go about it
1. **Orient, then talk it through with the owner.** Ask them about:
   - stable order or grouped by status (§2);
   - where tickets waiting to start live;
   - whether the quick view follows focus;
   - what the workspace repo row becomes;
   - whether *Lane* is still the word.

   Show mockups in AskUserQuestion's previews (ASCII, a few per question). Don't build before they've chosen.
2. **Optionally, a static mockup page** in `docs/futures/` (as `path-line.html` was for the board), when the owner wants to see it before code. Ask.
3. **Build in steps, each its own PLAN section and commit, each verified:**
   1. **The canvas replaces the board:** grid, tiles, order, keys, `?`, legend, Done and tickets as agreed. The board's columns go away; keep `card.stage` and `boardOf`'s filtering, re-shaped.
   2. **The quick view.**
   3. **Polish:** empty states (a first-time user with no cards), narrow windows (1024 px), light and dark, README's description of the home page, `docs/UX-AUDIT.md` if it describes the board.
4. **Update the walks the board is in.** `walk-card.cjs`, `walk-board-try.cjs`, `walk-hub.cjs`, `walk-perf.cjs` and `walk-two-cards.cjs` find tiles, columns and keys on the board. Keep their checks' intent, retarget their selectors, and add a new `walk-canvas.cjs` for the grid, the order, the quick view's actions and its keys, light and dark, with screenshots you look at.

## How to work
- **Measure or reproduce before fixing.** Verify for real on an isolated test server, never on the owner's server at :7777.
- **Before each commit:**
  - `pnpm typecheck`, `npx tsc --noUnusedLocals -p .` and `pnpm test` (407 at §123);
  - `walk-card` (66, light and dark), `walk-hub` (37, a real Haiku card, `PORT=7794`), `walk-perf` (the speed budget);
  - the feature walks for anything you touch.

  How each walk is run (some start their own server, some need one) is in `continue.md`, *Walkthroughs* and *Test on an isolated server*.
- **Each change gets a PLAN section in the same commit.** The next after §124 is §125. Run `git fetch` first. Pushing verified work to main is pre-approved.
- **A page-only change reaches the owner's app with `pnpm build` and a reload.** A server change needs a restart: ask first, and stop Try it apps and the running sessions' MCP servers first.
- **Clean up after testing.** After stopping test servers, stop only orphaned MCP trees. Leave no demo worktrees in `%TEMP%\cc-demo`, and delete `dist/web-test`. Stop a test server by its Windows PID, after checking its command line is `server/index.ts` (in Git Bash, `$!` isn't the Windows PID).
- **Line endings:** Windows 11, Node 24, files mostly CRLF. The Bash tool's heredocs eat backslashes, so edit with the Edit tool or a Python script written with the Write tool.
- **The repo is public:** no VU code, URLs, hosts, app names or paths, proxy entries, ticket contents, tokens, or internal tool names.
- **Screenshots only inside a Demo workspace.** *Everything else* shows the owner's real sessions.
