# Continue cc-control: the open card's message box, Send / Resume and send, and + Context

Paste this into a new Claude Code session opened in `D:\repos\cc-control` (the personal laptop) after `git pull`. On the VU work laptop: read, diagnose, write a handoff (`docs/prompts/vu-handoff-template.md`), never edit or commit there.

---

You're continuing **cc-control** ("Command Center"), a local web app that sits on top of Claude Code terminal sessions so one person can run many at once: a board of cards (the Ticket Line), each card following a Claude Code session in a Windows Terminal tab, each in its own worktrees, each tried on its own ports. The owner uses it daily, tests it from a clone on their work laptop (VU), and is showing it to their org. **The aims for end users:** non-developers can get real work done and follow what happened; developers are faster than in bare terminals; nobody drowns in options. The owner's words on what the open card is for: "see what they need to make a quick judgment call, do the one thing the card needs (answer, approve, type to the terminal), and move on to the next card."

## Read first, in this order
1. `CLAUDE.md` (rules: local only, keyboard first with keys in `?` and the legend, a PLAN section per commit, conventional commits, named paths only).
2. `docs/prompts/continue.md`: code layout, how to test on an isolated server, machine facts, the owner's server on :7777.
3. `docs/PLAN.md` **§81 to §88**: the open card (direction F: the chat is the page, a dock on the left), Try it as services with their output, every card typed to (§85), the launcher typing into the tab when channels aren't allowed (§87), + Context as a popup (§88). Skim §59 and §77 for the conventions the new-session popup set: read top to bottom, few keycaps on screen, every window closes with an × and `Esc`, messages next to the action, the hand on everything clickable.
4. `web/components/CardView.tsx`: `CardView`, `Dock`, `Chat`, and **`Say`** (the message box under the chat, with the ask above it: Approve / Not yet or Allow / Deny on `y` / `n`). `web/line-keys.ts`: `drawerKeys` (the open card's keys), `focusSay`, `saySubmit`, `sayKeys` (keys inside the box), `openAddComposer` (+ Context). `shared/cards.ts`: `reachable(card)` and `askOf(card)`.

## The job
The owner (2026-10-02): "we need to find a better way to display the + Context and Resume and send button; it's a weird layout and isn't intuitive. We should also make sure pressing Enter when you're in the text box entering text goes to Resume and send, or Send if the session is running. Context may need to find a new place that isn't so real-estate heavy as well."

What is there today (`Say` in `CardView.tsx`):
- A two-row textarea (`#card-say`) with, to its right, a **+ Context** button (`c`) and the primary button, which reads **Send** (`Enter`) when the card is reachable (its channel is up, or its tab's launcher is polling, §87) and **Resume and send** when it isn't (the tab is gone, or the session ended: sending then opens a new tab on the session with `claude --resume` and the message goes in once it connects, §85).
- Under the box, a one-line note when the card isn't reachable (why, and what sending does) or when the launcher is the way in ("Typed into its tab…").
- Above the box, the ask when Claude is asking something: Approve / Not yet, Allow / Deny, or "Answer in its tab" with `g`.
- `Enter` on the open card puts the cursor in the box (`focusSay`); inside the box `Enter` is meant to send (`sayKeys`: `Enter` sends, `Shift+Enter` is a new line, `Esc` leaves the box). **Check this first on a card that isn't reachable:** the owner's report suggests `Enter` in the box didn't send (or didn't resume and send); find out whether the key reaches `saySubmit` in both states and fix whatever stops it. The flash and the request are in `saySubmit` (`web/line-keys.ts`); the server side is `card.send` in `server/index.ts` (channel, else launcher, else reopen the tab and wait).

What to change:
1. **One clear primary action, where the eye expects it.** The box and its send button should read as one control: the button's label says what `Enter` will do (*Send*, or *Resume and send* when the tab is gone), and the note that explains the state should sit with it, not float under the row. Consider the state as a small line above the box or inside its border (e.g. "Its tab is gone · Enter resumes it and sends") rather than a paragraph below. Keep it to one line; the owner dislikes real estate spent on explanations.
2. **+ Context moves somewhere lighter.** It is on the card already as the Context panel's `+ Context` (`Shift+C` opens the panel; the button is at the top of *Added since*) and as `c` anywhere on the open card. Options to weigh: a small icon button (a plus, or a paperclip) inside the box's left or right edge with a tooltip and the `c` keycap, the way chat apps attach; or drop it from the row entirely and rely on `c` plus the dock's Context panel (the `?` row and legend already say `c`). Don't leave it as a wide labelled button beside the textarea.
3. **The ask stays above the box** (that is the one thing the card needs), but check it reads well against the new row.
4. Keep every action reachable by key: `Enter` sends, `c` adds context, `y` / `n` answer, `Esc` leaves the box; the legend (`lineLegendFor`'s drawer view in `web/legend.ts`) and the `?` rows (`LINE_SECTIONS` in `web/line-keys.ts`) must match what is on screen. Few keycaps on screen: the hints setting hides them.
5. Design first, briefly: before building, say in a few lines what the row will look like (or draw it on the Design canvas, https://claude.ai/artifact/U3vcZqgX5v6yegUAoLyeDb, where the open card's boards live) and get the owner's yes if the reading of their ask could go two ways. They prefer end-to-end autonomous execution otherwise.

## How to verify
- `pnpm typecheck`, `npx tsc --noEmit --noUnusedLocals -p .`, `pnpm test` (321 now).
- A Playwright walkthrough on the isolated server: `docs/walkthroughs/simple-new-card/walk-card.cjs` is the open card's net (43 checks; `DARK=1` for dark mode) and seeds cards in each state through `cards.seed` (§80), including an idle card with `channel: false` (so it shows *Resume and send*) and a done card (session ended). Extend it: the box's state in each case, `Enter` in the box sending (on a seeded card the send is refused by the server since there is no real session; check the request went out and the message the page shows), the new place of + Context, and screenshots you look at in light and dark. `walk-type.cjs` drives the real launcher in a real tab (it opens a terminal tab on screen for a minute) and proves typing lands; run it after any change to `Say` or `saySubmit`.
- Report plainly what passed, what didn't, and what was only tried against stand-ins.

## How we work
- Push verified work straight to main; no need to ask. Every change gets a PLAN section (next is §89) in the same commit, and a README row (the `Enter (card open)` and `c (card open)` rows in the keys table) when user-facing.
- **The owner's app runs on :7777** as a hidden `node server/index.ts` serving `dist/web`: a page-only change reaches it with `pnpm build` (they reload). A server change needs a restart: **ask first**, then the lines in `docs/prompts/continue.md`.
- Keyboard first; local only; never commit tokens, VU code, URLs, proxy entries, ticket contents or internal tool names (say "the team's apps").
- Windows 11, Node 24, pnpm, CRLF files. The Bash tool's heredocs eat backslashes: write scripts with the Write tool and fix regexes with Edit. Playwright: `page.keyboard.press('?')` doesn't open help, use `Shift+Slash`; check for `[role=dialog]`, not page text. Zustand selectors must not return new arrays. PowerShell rewrites of files mangle curly apostrophes: edit with the Edit tool.

Start by reading, then say in a few lines what you understand the state to be and what you'd change on the row, and go.
