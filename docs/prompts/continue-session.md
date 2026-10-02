# Continue cc-control: read in, then stand by

Paste this into a new Claude Code session opened in `D:\repos\cc-control` (the personal laptop) after `git pull`. On the VU work laptop: read, diagnose, write a handoff (`docs/prompts/vu-handoff-template.md`), never edit or commit there.

---

You're continuing **cc-control** ("Command Center"), a local web app that sits on top of Claude Code terminal sessions so one person can run many at once: a board of cards (the Ticket Line), each card following a Claude Code session in a Windows Terminal tab, each in its own worktrees, each tried on its own ports. The owner uses it daily, tests it from a clone on their work laptop, and is showing it to their org. The aims: non-developers can get real work done and follow what happened; developers are faster than in bare terminals; nobody drowns in options.

## Read first, in this order
1. `CLAUDE.md` (rules: local only, keyboard first with keys in `?` and the legend, PLAN section per commit, conventional commits, named paths only).
2. `docs/prompts/continue.md`: code layout, how to test on an isolated server, machine facts, the owner's server on :7777.
3. `docs/PLAN.md` **§78 to §83** (the latest work) and skim §54 and §59 for how the card and the new-session popup were shaped. The PLAN is the history; every section says what was built, what was verified and what was not tried.
4. `docs/prompts/continue-open-card.md`: the open card's design (direction F) and what to watch in smoke testing.

## Where things stand (2026-10-02, all pushed to `main`)
- **The new-session popup** (§59 to §77) is done and the owner is happy with it. It is the model for everything after: read top to bottom, eyebrow headings, few keycaps on screen, every window closes with an × and Esc, messages next to the action, the hand on everything clickable.
- **The open card** (§81) is direction F: the chat is the page (live from the terminal tab, the ask with `y` / `n` and the message box under it), with a dock on the left (back, Changes, Try it, Verify, Context, Ship, More) whose panel opens beside the chat, stays open from card to card, drags to resize (`[` `]` too) and pops the open diff out (`f`) onto the full-width Changes sheet on the same file. `web/components/CardView.tsx`; keys in `drawerKeys` (`web/line-keys.ts`).
- **Try it is a list of services** (§82): one session per card holds the ports and the proxy copy; each API and the UI is its own run. `t` starts all ticked or stops all, `r` one service (again), `q` one alone. `server/stack.ts` (`prepareStackSession`, `serviceRecipe`), `server/recipes.ts` (runs keyed by `runKey(card, service)`), `StackTry` in `CardView.tsx`.
- **The stack is set up as a form** (§83): `e` on a card in a multi-repo lane opens `web/components/StackSetup.tsx`; `shared/stack-setup.ts` writes the step lines from three answers and reads them back; hand-edited lines are kept and marked.
- **A card for tests** (§80): `cards.seed` on a non-default port writes a started-looking card in one of five states; `walk-card.cjs`, `walk-stack.cjs` and `walk-back.cjs` use it.
- Checks: `pnpm typecheck`, `npx tsc --noEmit --noUnusedLocals -p .`, `pnpm test` (314) pass. Walkthroughs in `docs/walkthroughs/simple-new-card/` run against an isolated server on :7802 (`walk-simple.cjs` seeds the Demo lane first; `walk-stack.cjs` makes and removes its own lane; `walk-prompts.cjs` fails one check on the committed page too, a known state issue; `walk-write.cjs` spends a model turn, run it by hand).
- The owner's server on :7777 was restarted on 2026-10-02 with this code and serves the current `pnpm build`.

## What is open (don't start these on your own; they are the likely next asks)
- **Smoke-test feedback on the open card and Try it**: the owner is testing at VU. Expect "a good chunk of changes". Each PLAN section from §81 on ends with *To check at VU* or *Not tried*; the VU laptop's findings decide what's next.
- **Verify** is a placeholder panel: hooks into the team's internal apps (look up a record, add fields, create test data from the card) come later; keep internal tool names out of the repo (say "the team's apps").
- **Test steps for Try it** (board G on the design canvas, https://claude.ai/artifact/U3vcZqgX5v6yegUAoLyeDb): numbered steps from the plan and the ticket, pass / fail per step that writes to the chat. Not built.
- **The board itself** (tiles, columns, Inbox) is the next screen in the owner's simplification walk after the open card.
- Smaller: a shared popup component for the Add context and lane `+ Repo` popups; the `?` overlay's rows for brevity; which drawer opens by default on the open card (none today).

## How we work
- **Push verified work straight to main**, no need to ask. Verified means the three checks pass and, for UI changes, a scripted Playwright walkthrough on the isolated server with screenshots you actually looked at (dark mode too when the change is visual). Report plainly what passed, what didn't, what was only tried against stand-ins.
- **Every change gets a PLAN section** in the same commit, and a README row when it's user-facing. Keep the handoff docs pointing at what's next.
- **Page-only changes** reach the owner's app with `pnpm build` (they reload). **Server changes need a restart: ask first**, then the lines in `docs/prompts/continue.md`.
- **Keyboard first**: every new action needs a key, a legend entry and a `?` row; few keycaps on screen (the hints setting hides them). Local only. Never commit tokens, VU code, URLs, proxy entries, ticket contents or internal tool names.
- Windows 11, Node 24, pnpm, CRLF files. The Bash tool's heredocs eat backslashes: write scripts with the Write tool and fix regexes with Edit. Playwright: `page.keyboard.press('?')` doesn't open help, use `Shift+Slash`; check for `[role=dialog]`, not page text. Zustand selectors must not return new arrays.
- The owner prefers end-to-end autonomous execution: decide, build, verify, report. Check in only when readings would lead to materially different work.

## Now
Read the files above, then say in a few lines what you understand the state to be and which machine you're on, and **stand by for the owner's next ask**. Build nothing until they say what's next.
