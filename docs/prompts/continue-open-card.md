# Continue improving cc-control: strip the open card back, the way the new-session popup was

Paste this into a new Claude Code session opened in `D:\repos\cc-control` (the personal laptop; check the hostname and `git pull` first).

---

You're continuing the redesign of **cc-control** ("Command Center"), a local web app that sits on top of Claude Code terminal sessions: a board of cards (the "Sessions" page) where each card follows a Claude Code session in a Windows Terminal tab. The owner is stripping the UI back to essentials one screen at a time, uses the app daily, and tests it at work from a clone on another laptop. Read `CLAUDE.md`, `docs/prompts/continue.md` (code layout, how to test on an isolated server without touching the owner's app on :7777) and skim `docs/prompts/continue-after-vu.md` (lessons, how we work). Then PLAN §59 to §77: the new-session popup's redesign, piece by piece. That screen is **done** and the owner is happy with it; it is the model for what comes next.

## What the finished new-session popup established (keep to it)
- **Read top to bottom.** Eyebrow headings (`.eyebrow`), one idea per block, the primary action last. Two columns at a wide window, one under about 1100px, `↑ ↓` in reading order.
- **Few keycaps on screen** (`Esc`, `Ctrl Enter`, `?`); every other key is in the legend (`web/legend.ts`, hidden by `web/slim.ts` but computed and tested) and the `?` overlay (`LINE_SECTIONS` in `web/line-keys.ts`). **No plain-text key hints** anywhere in prose (§76); keys live in `<Key>` keycaps and tooltips only.
- **Every window closes with an × in the top-right corner** with the `Esc` keycap beside it (`CornerClose` in `web/components/Overlay.tsx`, §77). Not "Cancel".
- **Dropdowns look like dropdowns** (§71): a bordered select-style button with a chevron, a lifted list panel with its own eyebrow heading over a veiled background, the keys' row marked softly, the one in use by a tick and the accent colour, a click outside closes.
- **Messages appear next to the action** (§68), not in the header flash: a status line under the control that was used.
- **Everything clickable shows the hand** (§75). **Links read as links** (accent, underlined: *(change)* in §67).
- **The hover row and the chosen row never look alike** (§73).
- Drawers for detail (§70: the ticket's criteria and comments under its counts, the counts giving way to a *Details* label while open).

## The job: the open card
The view that opens when you click a created card on the board (`CardView` and what it draws, in `web/components/TicketLine.tsx`, lines ~329 to the end: `Overview`, `LiveNow`, `TryIt`, `Shipped`, `ContextTab`, `AddedSince`, `TranscriptTab`, `Say`, `DrawerActions`). Today it is a full-screen section: a header (back button, badges, title, prev/next), a left pane with **Overview / Context** tabs (and a Transcript tab on a narrow window), a right pane with the live transcript and the message box, and a footer row of every action. The Overview stacks everything: the ask or live state, Steps, What changed, the report, the PR, Claude said, Ship, Try it, Where it runs, a Context summary. The owner: "I'm ready to move on to simplifying the next area of the app which is the view that opens when you open a created card - our goals are the same as the last one (new session popup)." And: "keep the app feeling as consistent as possible, but not everything has to follow the same conventions if there are reasons not to."

### The directions
A Design canvas with three directions and a comparison board: **https://claude.ai/artifact/U3vcZqgX5v6yegUAoLyeDb** (the same artboards are in `docs/futures/open-card/project/*.dc.html`; they open as plain HTML too).
- **A · The status page.** One column, read top to bottom like the popup: what needs you first (the ask, with `y` / `n` / `g` in it), then Steps, What changed, then the quiet facts folded behind *(details)*; the transcript beside it with the message box; a footer with only the stage's actions. Tabs gone. Smallest change: reorder and cut inside `TicketLine.tsx`.
- **B · Transcript first.** The conversation is the page, full width, the message box pinned under it; everything the board knew sits in a quiet 360px rail (now, steps, changed, context chips, actions). Medium: a rail component, the transcript made the page.
- **C · The journal.** One stream in time order merging how it started, context added, Claude's messages, asks, what ran, what shipped; a sticky "now" strip with the one thing to do; counts in a rail. Large: a feed model merging five sources, with tests.
- **The comparison board** says what they share, where each is weak, the narrow-window shape, the keys, the build size, and recommends **starting with A** (B's rail and C's sticky "now" strip can be added to A later without undoing it). It also names the one place the conventions may bend: the open card is a place people return to while something runs, so a live, pinned "now" is allowed to stay in view while the rest scrolls, and the transcript keeps its own scroll pinned to the newest line.

**Talk the directions through with the owner before building.** Then build in pieces, one commit each with a PLAN section, as §59–§64 did.

### The first thing to build, whichever direction: a way to seed a card for tests
`walk-back.cjs` (§63) needs a started card and there is no way to make one on the isolated server without `card.start`, which opens a real Windows Terminal tab and a real Claude session. Add a test seam before touching the view: e.g. a `cards.seed` message (or a `CC_CONTROL_SEED_CARD` env) that the server accepts only when `CC_CONTROL_PORT` is not the default, writing a card with a fake session id, boot steps, todos, files, a live ask (plan ready), a transcript of a few items and a `later` item, so every state the view draws can be walked through and screenshotted. Document it in `docs/prompts/continue.md`. Nothing in it may run in the owner's server.

### Keys
Today: `Enter` opens a card; `Esc` back; `← →` neighbours; `Tab` cycles Overview / Context (/ Transcript); `c` add context; `t` / `o` try it / open the app; `s` ship, QA report, findings; `g` its tab; `y` / `n` answer an ask; `⇧D` changes; `⇧X` worktrees; `e` edit the recipe; `x` take back context; `Delete` remove; the `expand` binding opens its session; `Alt+↑ ↓` walk the cards' sessions. Keep every action reachable by a key; drop `Tab` if the tabs go; keep the rows in `?` and the legend (`lineLegendFor`'s `drawer` view) true to what is on screen, and keep keycaps on screen few.

## Where things stand (2026-10-02)
Everything through §77 is committed and pushed to `main` (last commit on the new-session work: `5837758`; the directions and this prompt came after). The owner's server on :7777 runs the current build. `pnpm typecheck`, `npx tsc --noEmit --noUnusedLocals -p .` and `pnpm test` (303) pass. Nine scripted Playwright walkthroughs live in `docs/walkthroughs/simple-new-card/` (screenshots to `shots-*/`, gitignored); they expect an isolated server on :7802 seeded the way `walk-simple.cjs` seeds it (run it first). `walk-write.cjs` spends a model turn and `walk-back.cjs` needs a seeded card (see above), so run those by hand; the rest are the regression net. The working tree has one line-endings-only change in `web/commands.ts`; leave it.

## After the open card, if there is time
1. **The board itself** (the next screen in the owner's walk): the tiles, the columns, the Inbox.
2. **A shared popup component** for the Add context popup and the lane dialog's `+ Repo` popup (§64 noted it; the two are kept the same by hand).
3. **The `?` overlay's rows for the simple look** have grown long; a pass for brevity without losing a key.
4. Open items only when the owner raises them: §57's *which app* for an nx workspace of several apps; §61's hook text still saying *Workspace notes*; prompt versioning (§62 keeps `updatedAt` only); the key as a link and `o` opening Jira on a real ticket (§70, untested: demo tickets have no url); a real card started with a multi-line opening message through the launcher (§69, untested live).

## How we work
- Push verified work straight to main; no need to ask. "Verified" means `pnpm typecheck` and `pnpm test` pass, `npx tsc --noEmit --noUnusedLocals -p .`, and for UI changes a scripted Playwright walkthrough on an isolated server with screenshots you actually look at (dark mode too when the change is visual: `colorScheme: 'dark'` plus `localStorage['cc-control.theme']='dark'`). Report plainly what passed, what didn't, and what was only tried against stand-ins.
- Every change gets a PLAN section in the same commit, and a README update when it's user-facing. Conventional commits; stage named paths, never `git add -A`.
- Test on an isolated server: `CC_CONTROL_PORT=7802 CC_CONTROL_DB=$TEMP/cc-test-x.db CC_CONTROL_MODEL=claude-haiku-4-5-20251001 CC_CONTROL_WEB_DIST=D:/repos/cc-control/dist/web-test node server/index.ts`, with `pnpm exec vite build --outDir ../dist/web-test --emptyOutDir` first. Stop it by the PID on :7802 after checking its command line is `server/index.ts`; delete `dist/web-test` and the test db when done.
- **The owner's app runs on :7777** as a hidden `node server/index.ts` serving `dist/web`. A page-only change needs just `pnpm build` (they reload). A server change needs a restart: **ask first**; when they say yes, `pnpm build` then the restart lines in `docs/prompts/continue.md` (a restart stops any Try it apps).
- Keyboard first with the keys visible in `?`; local only; never commit VU code, URLs, proxy entries, ticket contents, tokens or internal tool names.
- Windows 11, Node 24, pnpm; files are CRLF; the Bash tool's heredocs eat backslashes, so write scripts with the Write tool and fix regexes with Edit.

Start by reading, then open the directions with the owner: say in a few lines which you'd start with and why, what the first commit would be (the seed seam), and wait for their go.
