# Continue improving cc-control: the Add context popup takes extra source folders for one card

Paste this into a new Claude Code session opened in `D:\repos\cc-control` (the personal laptop; check the hostname and `git pull` first).

---

You're continuing the redesign of **cc-control** ("Command Center"), a local web app that sits on top of Claude Code terminal sessions: a board of cards (the "Sessions" page) where each card follows a Claude Code session in a Windows Terminal tab. The owner is stripping the UI back to essentials one screen at a time and uses the app daily (and tests it at work from a clone on another laptop). Read `CLAUDE.md`, `docs/prompts/continue.md` (code layout, how to test on an isolated server without touching the owner's app on :7777) and skim `docs/prompts/continue-after-vu.md` (lessons, how we work). Then PLAN §59 to §64, the sections for the screens you'll touch:

- §59 the simple one-column new-card screen (a popup over the board; `web/components/NewCardSimple.tsx`, `web/simple-model.ts`, `web/simple-keys.ts`) and its **Add context popup** (`Picker` in `NewCardSimple.tsx`; Repos / Folders / Tickets tabs; `pickerList`, `pickAt`, `openPicker` in `simple-keys.ts`), plus the Windows folder picker (`server/pick-folder.ts`, `pickFolderOnDisk` in `web/ws.ts`).
- §62 the opening message from saved prompts, `w` has Claude write it (`shared/prompts.ts`, `server/write-prompt.ts`, `web/components/PromptsDialog.tsx`); the popup is two columns at a wide window.
- §63 the way back out of a card (breadcrumb, top-left button, browser history in `web/history.ts`).
- §64 the lane dialog picks repos the + Context way (`WorkspaceDialog` in `web/components/Dialogs.tsx`: chips and a `+ Repo` popup with Repos and Library folders tabs).

## Where things stand (2026-10-01, late evening)
Everything above is committed and pushed to `main` (last commit `b371e5f`), and the owner's server on :7777 runs it. `pnpm typecheck`, `npx tsc --noEmit --noUnusedLocals -p .` and `pnpm test` (300) pass. Eight scripted Playwright walkthroughs live in `docs/walkthroughs/simple-new-card/` (screenshots go to `shots-*/`, gitignored). They expect an isolated server on :7802 seeded the way `walk-simple.cjs` seeds it (run it first: a Demo lane of `%TEMP%\cc-demo\web-app` and `payments-api`, the library pointed at `%TEMP%\cc-demo`, demo tickets on, `SHOP` mapped to the lane). `walk-write.cjs` spends a model turn and `walk-back.cjs` needs a seeded card (see §63 for how), so run those by hand; the rest are the regression net after any change to these screens. The working tree has one line-endings-only change in `web/commands.ts`; leave it.

## The job: more sources to pick repos from, for this card only
The owner: update the Add context popup so it "supports the ability to add more sources to pick repos from (not adding them directly to the lane though, would just be for this card/session)".

Today the Repos tab lists the **repo library**: every git repo inside the folders chosen with `F` (`library.setSources`, saved on the server, shared by every lane and card). Adding a folder there is a global act. What's wanted: from the popup, point at another folder (one you keep repos in for a side project, a client's tree, a colleague's checkout) and pick repos from it **for this card alone**, without that folder joining the library or the lane.

What to build:
- **A source for this card.** On the Repos tab, a way to add a source folder: a row at the end of the list (*+ Another folder of repos…*) and a key (`b` browses in the Windows picker, like the Folders tab; a typed or pasted path works too, the same box). The folder is scanned for git repos **without saving it anywhere**: a new request `library.peek { reqId, path }` → `library.peeked { reqId, source, repos: RepoInfo[] }` (server: `scanSources([path])` in `server/repo-library.ts` with `cleanSources`' checks for a real, absolute folder; nothing written). A folder with no git repos in it says so (and offers the Folders tab: that is for a folder Claude should read, not a place to find repos).
- **The composer keeps it.** `Composer.sources?: { path: string; repos: RepoInfo[] }[]` (`web/line-model.ts`), kept with the draft (`c` picks it up), dropped when the card starts (the picked repos are already in `packet.card` as repo items; nothing else needs to persist). `sources()` in `line-model.ts` (what the Repos tab lists) returns the library's repos then each extra source's, each extra group under a small heading with the folder's path and an `×` (`x` on the heading row takes the source and its unpicked repos off; picked ones stay on the card). `pickerList` / `pickAt` in `simple-keys.ts` follow. A repo picked from an extra source is a card repo like any other (`toggleSource`); its chip's sub says the source folder's name rather than nothing, so it's clear where it came from.
- **The lane dialog's popup (§64) does not get this**: a lane's repos are the library's by design; say so in a line if it comes up.
- **Keys**: every new action needs a key, a legend entry (`simpleLegend` in `web/legend.ts`; the legend is hidden by `web/slim.ts` but computed and tested) and a row in `LINE_SECTIONS` (`web/line-keys.ts`). Keep the popup's keycaps few.
- **Tests**: a unit test for the pure parts (the list with extra sources, taking a source off, what stays on the card); the server's peek against a temp folder with a git repo and one without; a Playwright walkthrough on the isolated server (seed a second folder of repos under `%TEMP%` by `git init`ing one or two there, add it from the popup by typing the path, pick a repo, see its chip, take the source off, see the chip stay, start nothing); screenshots you look at. Then a PLAN section (§65) and a README line.

Design notes, so you don't relitigate them:
- "Add context" is the standard: Repos / Folders / Tickets tabs, a search box, ticked rows, `Enter` keeps the list open, `Esc` or *Done* closes. Extra sources live inside the Repos tab; don't add a fourth tab.
- Keep the library global and the lane's repos the library's; the card is the only place an extra source lives.
- The handoff that built §59 noted: anything inside `role="dialog"` swallows keys, so popups the app's keys drive are `role="group"`; the legend keys its React nodes by label (two items with one label leave a stale keycap); Playwright's `?` is `Shift+Slash` and `press('Space')` for space; a walkthrough pressing `Ctrl+Enter` inside the full look's folder dialog once started a real card, so tests add folders by typing a path.

## After that, if there is time, in this order
1. **A shared popup component.** §64's lane popup is its own markup; the new-card one is bound to the composer. With extra sources the Repos tab grows; one `ContextPopup` component (tabs, search, rows, footer) used by both would keep them the same by construction.
2. **The owner's redesign walk continues**: the open card and the board are the next screens to strip back (§59's *Next*). Talk it through with the owner before building; the simple look's shape (what a person needs to read top to bottom, keys visible, few keycaps) is the model.
3. **The `?` overlay's rows for the simple look** have grown long; a pass for brevity, without losing a key.
4. Open items from earlier work, only when the owner raises them: §57's *which app* choice for an nx workspace of several apps; §61's hook text still saying *Workspace notes*; prompt versioning (§62 keeps `updatedAt` only).

## How we work
- Push verified work straight to main; no need to ask. "Verified" means `pnpm typecheck` and `pnpm test` pass, `npx tsc --noEmit --noUnusedLocals -p .`, and for UI changes a scripted Playwright walkthrough on an isolated server with screenshots you actually look at. Report plainly what passed, what didn't, and what was only tried against stand-ins.
- Every change gets a PLAN section in the same commit, and a README update when it's user-facing. Conventional commits; stage named paths, never `git add -A`.
- Test on an isolated server: `CC_CONTROL_PORT=7802 CC_CONTROL_DB=$TEMP/cc-test-x.db CC_CONTROL_MODEL=claude-haiku-4-5-20251001 CC_CONTROL_WEB_DIST=D:/repos/cc-control/dist/web-test node server/index.ts`, with `pnpm exec vite build --outDir ../dist/web-test --emptyOutDir` first. Stop it by the PID on :7802 after checking its command line is `server/index.ts`; delete `dist/web-test` and the test db when done.
- **The owner's app runs on :7777** as a hidden `node server/index.ts` serving `dist/web`. Ask before restarting it; when they say yes, `pnpm build` then the restart lines in `docs/prompts/continue.md` (a restart stops any Try it apps).
- Keyboard first with the keys visible in `?`; local only; never commit VU code, URLs, proxy entries, ticket contents, tokens or internal tool names.
- Windows 11, Node 24, pnpm; files are CRLF; the Bash tool's heredocs eat backslashes, so write scripts with the Write tool and fix regexes with Edit.

Start by reading, then say in a few lines what you understand the state to be and how you'd build the extra sources (the message shape, where the state lives, the keys), and wait for the owner's go.
