# Keep improving cc-control: the home page's spacing, modes, and a chat that behaves while it streams

Paste this into a new Claude Code session opened in `D:\repos\cc-control`.

---

You're continuing work on **cc-control** ("Command Center"), a local web app for working with many Claude Code sessions at once. The owner uses it every day and is showing it to their org. This session works through the owner's list below, one item at a time, and then keeps improving the app with them.

## Read first, in this order
1. **`CLAUDE.md`**, the rules:
   - local-only: the server binds to 127.0.0.1;
   - keyboard-first: every action gets a key, a row in `?` and an entry in the legend;
   - pnpm and conventional commits, staging named paths only;
   - the two-laptop rule.
2. **`docs/prompts/continue.md`**: what the app is, where things are, how to test, the walkthroughs, the state.
3. **`docs/PLAN.md` §126 and §127** (search for `## 126.`; don't read the whole file). These cover the home page as it is now, **Your Move**:
   - every card in three bands by whose turn it is: Your move, Claude's move, Parked;
   - tickets to start in a strip above, Done folded below;
   - the answers on the tile (`y` `n`, digits, `l` looks good, `p` found a problem);
   - unread turns and tries kept per browser.

   The code is in `web/your-move.ts` (the pure model, tested), `web/components/YourMove.tsx` (the page) and `web/line-keys.ts` (`boardKeys`, `homeNow`, `homeIds`).
4. **The open card's chat:** `web/components/CardView.tsx`, starting at `function Chat` (around line 227: `pinned`, the `onScroll` and the effect that scrolls to the bottom). Then `Say`, the message box, and `web/say-size.ts` for its height (§118: it grows with its text, drags taller, `Ctrl+Shift+↑ / ↓`). The full-screen session has its own copy of the stick-to-bottom logic in `web/components/SessionView.tsx` (`stick`, around line 58).

## The owner's list (2026-10-08), in their words, with where to look
1. **The home page's empty sections.** *"Let's make each section have a fixed minimum height below it so even when they are empty there is enough space there between the empty content area and the next section. That space should be equal to what it would look like if a card was in that section."*
   - Each band in `YourMove.tsx` (Your move, Claude's move, Parked) shows a one-line note when empty.
   - Give each band a minimum height equal to one row of its own tiles: a Your move tile, a Claude's move tile, a parked chip.
   - Then a band doesn't collapse when it empties and the page doesn't jump.
   - Measure the real tile heights; don't guess. Check light and dark, and 1024 px.
2. **Switching modes.** *"Need to be able to switch between plan/auto/ask modes easily."*
   - Find out what exists before designing:
     - `Shift+Tab` cycles a session's permission mode in the full-screen session (`cycleMode` in `web/keys.ts`, `session.mode` on the server, `nextMode` / `MODE_LABEL`);
     - the new-card screen picks a launch mode (`LAUNCH_MODES` in `shared/cards.ts`);
     - the open card shows `card.live.mode` somewhere.
   - Most likely missing: a switch on the open card (and maybe the tile) that shows the current mode and changes it with one key.
   - Ask the owner:
     - which modes they want in the cycle: plan, ask (`default`), auto; and accept edits?
     - whether the key is `Shift+Tab` on the open card, as in Claude Code.
   - Haiku refuses auto mode: say so rather than failing silently.
   - The switch needs its key, a row in `?` and a legend entry.
3. **The message box growing pushes the chat up.** *"As the user increases/decreases the chat input height, the chat should grow above that top border so the user doesn't have to scroll through chat after changing the input size."*
   - When the box gets taller (dragging, `Ctrl+Shift+↑`, or typing more lines), the chat's visible bottom should stay where it was relative to the box. Keep the scroll distance from the bottom the same, so the newest message stays in view.
   - Likewise when the box shrinks.
4. **Reading while it streams.** *"As the chat is being written to, the user should be able to scroll and maintain their scroll position without being constantly brought to the bottom of the chat while the chat is being written still."*
   - There is already a `pinned` flag (unpinned when more than 80 px from the bottom), so **reproduce first** and find why it still yanks: a seeded card streaming (`perf.stream` in `walk-perf.cjs` shows how).
   - Likely causes:
     - an effect that scrolls without checking `pinned`;
     - the programmatic scroll firing `onScroll` and re-pinning;
     - layout shifts as partials grow (the threshold may be too small for a burst);
     - a re-mount.
   - Fix it in the card chat and in `SessionView`, ideally as one shared hook.
5. **A jump-to-bottom button.** *"If the user scrolls up in the chat, we should give them a down arrow to go to the bottom of the chat so they can see the most recent messages."*
   - A floating ↓ above the message box while unpinned, ideally saying how many new messages arrived.
   - A click or a key (pick an unbound one, add it to `?` and the legend; `End` is a candidate where the box isn't focused) scrolls to the bottom and pins again.
   - The same in the full-screen session.

Items 3–5 are one piece of work: the chat's scroll behaviour. Do them together, with one walk that checks all three. Items 1 and 2 are separate.

## How to go about it
- **One item (or the 3–5 group) at a time**, each with its own PLAN section and commit. The next section is **§128**; run `git fetch` first.
- **Ask the owner only what changes what you build** (item 2's mode list and key). Use `AskUserQuestion`, with previews where layout is involved.
- **After the list**, ask the owner what is next. Known open items:
  - new README screenshots (`docs/screenshots/line*.png` still show the old board, §126);
  - the owner's VU testing of the front door (§123, *To check at VU*).

## How to work
- **Measure or reproduce before fixing.** Verify for real on an isolated test server, never on the owner's server at :7777.
  - **:7788 is taken** by another cc-control server that has been running since 2026-09-30. It isn't yours, so leave it alone and use another port (:7826 worked).
  - Walks that need a running server take `PORT=`. `walk-lane` also needs the repo library seeded (`library.setSources` with `%TEMP%\cc-demo`, then `library.scan`).
- **Before each commit:**
  - `pnpm typecheck`, `npx tsc --noUnusedLocals -p .`, `pnpm test` (413 at §127);
  - `walk-card` (66, light and dark; needs a server, `PORT=`);
  - `walk-hub` (37, a real Haiku card, `PORT=7794`, starts its own server);
  - `walk-perf` (the speed budget, starts its own): a key paints in 16 ms or less, and the chat changes are exactly what it measures;
  - `walk-your-move` (30, light and dark, starts its own);
  - the feature walks for anything you touch, plus a new walk for the chat's scrolling (light and dark, screenshots you look at).
  - Build `dist/web-test` first: `pnpm exec vite build --outDir ../dist/web-test --emptyOutDir`.
- **Pushing verified work to main is pre-approved.** A page-only change reaches the owner's app with `pnpm build` and a reload. A server change needs a restart: ask first, and stop Try it apps and the running sessions' MCP servers first.
- **Clean up after testing:**
  - stop a test server by its Windows PID, after checking its command line is `server/index.ts`;
  - stop only orphaned MCP trees;
  - leave no `*-card-*` worktrees in `%TEMP%\cc-demo`;
  - delete `dist/web-test`.
- **Editing files:** Windows 11, Node 24, files mostly CRLF. The Bash tool's heredocs eat backslashes and choke on some quoting, so edit with the Edit tool or a Python script written with the Write tool, keeping each file's line endings.
- **The repo is public:** no VU code, URLs, hosts, app names or paths, proxy entries, ticket contents, tokens, or internal tool names.
- **Screenshots only inside a Demo workspace.** "Everything else" shows the owner's real sessions.
- **The owner likes mocks to compare before a big change:** side by side, in the app's own colours, with a simulator where behaviour matters (§126 chose Your Move that way: `docs/futures/home-layouts.html`). Offer one when a choice is visual.
