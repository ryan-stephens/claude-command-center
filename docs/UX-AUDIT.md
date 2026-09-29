# UX audit: cc-control as a first-time, non-technical user

2026-09-28. Walked the app on an isolated test server (`:7788`, separate DB, Haiku) against the throwaway `cc-demo/web-app` repo, as someone who has never used Claude Code: open the app, start work in a project, ask for a change, approve something, stop it, find old work. Desktop 1440×900 and phone 390×844. Screenshots in `docs/ux-audit/` (demo data only).

The task given was: *"Add a small footer to index.html that says 'Made with care'. Then check that app.js has no syntax errors."* Claude read the folder, edited `index.html` (auto-allowed by the owner's global settings, so no card appeared), then asked to run `node --check app.js`.

Findings are ranked by how much they confuse or block that user. **Blocker** = they can't continue without help. **Major** = they continue, but unsure or wrong. **Minor** = friction or polish.

## Blockers

1. **There is no visible way to start.** The home screen has no "New" button. The only paths are the `N` key (named in the hint bar and the empty state: *"Press N to start one"*) and the `Ctrl+K` palette. A mouse or touch user who ignores key hints has nothing to click. (`home-empty.png`)
2. **Picking a project means reading raw folder paths.** The New-session dialog lists `D:\repos\cc-control`, `C:\Users\ryans\AppData\Local\Temp\cc-e2e-b`, `C:\Users\ryans`, … in monospace, including temp folders and the home directory, with no names, icons or "last used". Anything not listed must be typed or pasted as a full path. The placeholder says "Repo", which is jargon.
3. **Answering an approval needed a hidden step.** With the cursor in the message box (where it always is), pressing `Y` types a "y". The card says *"You're in the composer: Tab to answer · Esc stops the turn"*: three pieces of jargon in one line. The buttons do work with a mouse, but the keyboard path is unlearnable without that line. (`approval.png`)
4. **Opens on History, not on "what's going on".** First launch shows the History tab: every Claude Code session ever run on the machine (54 here, capped at 300), most started from terminals, in one dense table. A new user's first screen is a wall of unfamiliar rows. The Inbox/Live/History tabs are three concepts to learn before anything makes sense.

## Major

5. **Approvals don't explain themselves.** "Allow Bash?" then `node --check app.js`. Nothing says what that does in plain words ("check app.js for mistakes; doesn't change anything"), whether it's safe, or what **Always** means (always for this exact command? for all commands? for how long? in this project only?). A careful user will say No to everything; a trusting one will say Always to everything.
6. **Changes happen silently.** The file edit was allowed by settings, so no card appeared. The transcript shows `▸ Edit C:\Users\…\index.html ✓` in grey monospace. There's no "Changed 1 file" summary and no way to see what changed, so the user can't tell what Claude actually did to their project.
7. **The transcript is a developer log.** Tool rows read `Bash ls -la`, `Read C:\Users\ryans\AppData\Local\Temp\cc-demo\web-app\index.html`, with ✓/…/✗ glyphs, interleaved with chat. Full Windows paths wrap or truncate. The turn footer `— done in 13.4s · $0.0365` shows an API cost that means nothing on a subscription. (`done.png`)
8. **Status words are engineering states.** `idle` (means "finished, your turn"), `running`, `needs you`, `background`, `◐ elsewhere`, and `·` for history rows. The same row mixes status, title, `cc-demo/web-app · main`, a context bar (`16%`, unexplained), and age (`2s`) at similar weight. What needs attention doesn't stand out beyond a faint amber tint. (`home.png`)
9. **Three different "stop"s.** In a session: **■ Stop** (the turn), **End session** (header), and **X stop** in the list hint bar, plus **Background** and per-task **✕**. The difference between stopping a turn and ending a session isn't stated anywhere a user would look.
10. **The command board is permanent and numbers-first.** A quarter of the session screen, always visible, shows a 3×3 numpad grid with `7 8 9` at the top, mostly empty dashed slots, `REPO` / `MINE` / `SLASH` tags, `1/5`, `−` / `+`, and group tabs `Web app · Everyday · Skills · Skills 2 · Built-in`. The mode icons (`↵`, `{ }`) are unlabeled. Clicking in the transcript moves keyboard focus into the board, which then highlights an empty tile reading "E to add". (`done.png`)
11. **Continuing old work isn't an obvious action.** Opening a History row shows its transcript with a normal message box; typing continues it (a "resume", or a "fork" if a terminal touched it recently). There's no "Continue this" affordance and no explanation of what forking means when the orange banner *"Active in another window: sending will fork a new session"* appears.
12. **Opening a row needs a double-click** with a mouse; a single click only selects. Nothing hints at this.

## Minor

13. **Key hints are everywhere.** The bottom hint bar (8–9 chips), `Alt+N` and `M` in the header, `Tab` next to the tabs, `( / )` in the filter, `Ctrl+B` / `Esc` on buttons, and three rows of shortcuts under the board. Great for the owner; visual noise that says "this isn't for you" to everyone else.
14. **Contrast and size.** Dark only. 14px body, 11–12px metadata. Much secondary text is `zinc-500`/`zinc-600` on `#0c0e11`: about 4.1:1 and 2.5:1, so the dimmest text fails WCAG AA. Inputs use `outline-none` and rely on a border colour change for focus.
15. **The welcome card teaches keys, not tasks.** Its five tips are `↑ ↓ Enter`, `N`, `Numpad 1–9`, `Hold \``, `Alt+N`. It never says "pick a project, tell Claude what you want, approve what it asks".
16. **Header chrome.** `♪ sound M` and `● connected` sit in the header permanently; errors appear as small red text in the same bar and are easy to miss.
17. **Composer wording.** "Message · Enter to send" is fine; "Running… queue the next message" isn't. The 🎙 and ➤ buttons are small and have only `title` tooltips, no accessible names.
18. **Phone.** The title truncates hard (`Index footer and app…`), **End session** is a small grey link next to it, and the board toggle `⌗` is unrecognisable. The layout itself works: no horizontal scroll. (`phone.png`)
19. **Finding old work.** History is one flat list by recency; titles are auto-generated summaries; ages show as `3d`. There's no grouping by project and no search beyond the substring filter behind `/`.
20. **Name.** "cc-control" is a code name; the page title and header could say what it is.

## What already works (keep it)

- The live activity line (*"Running Bash… 0s · turn 2s"*, with Stop) is the right idea; it just needs plain words.
- The approval card is prominent, and approvals are never auto-allowed by the app itself.
- Streaming markdown replies read well; the final summaries Claude writes are the best "what happened" content on screen.
- The phone layout has no horizontal scroll, and the composer's touch buttons exist.
- `Ctrl+K` lists everything in readable language ("Jump to the next session that needs you"). It is the friendliest part of the UI today, but hidden.

## Implications for the redesign

- **Home answers "what needs me, what's working, what's done"** in that order, with a big obvious **New task** button. History becomes "Earlier", grouped by project, below the fold.
- **Projects are things**, not paths: a name (folder name), a colour/initial, recent activity. The path is secondary text.
- **Plain language everywhere**, with a single mapping layer (status → words, tool → verb phrase, command → explanation, risk) that is pure and tested.
- **Approvals: what, where, how risky, and three clear buttons** ("Allow", "Always allow <scope>", "Don't allow"), answerable by click, and by `Y`/`A`/`N` without a Tab dance.
- **Transcript = conversation first**, with Claude's actions collapsed into a readable "steps" summary (*"Read 1 file · Changed index.html · Ran a check"*); raw details behind a click.
- **Commands become "Shortcuts"**: a named, tappable strip or sheet, shown on demand; numbers stay as accelerators.
- **Keyboard hints move to hover/focus, `?`, and an optional "Show shortcuts" toggle.** Every key keeps working.
- **Light theme (following the OS), larger type, AA contrast, visible focus rings, labelled buttons.**
