# A calm, effective UI: simpler on screen, keycaps optional, and a developer experience to match

Paste this into a new Claude Code session opened in the cc-control repo (on either laptop), followed by whatever you want to start with.

**Where this stands (2026-09-30, end of the day):**
- **Done, on main:** §45 the key-hints setting (`H` in `?`, first row of `B`: always / on hover / off) and the audit that nothing dangles with hints off; §46 `g` brings the card's terminal tab forward; §47 `Shift+D` shows the card's changes with diffs; §48 a half-built card is kept and `c` picks it up; §49 `j` / `m` on the report sheet post to Jira and move the ticket (asked first; demo tickets take both; **not yet tried against a real Jira**, the VU laptop's is the test).
- **Waiting on the owner's OK (§2 below):** the trims. The proposal (button bar on the open card; panel 3 of the new card folded to Kind + Branch; token counts and the three explanatory paragraphs; column subtitles and the repo bar following the hints setting; the "terminal" pill) was put to them with screenshots; build it only once they say yes.
- **Next in §3's list:** PR comments and checks inline on the Ship card, and posting review findings to the PR (`gh pr view --json comments,reviews`, ADO threads); Trello comments and list moves with the same shape as §49; orphaned Try it processes and leftover worktrees; TFS builds.

---

You're continuing development of **cc-control** ("Command Center", GitHub `ryan-stephens/claude-command-center`): a local web app that sits on top of Claude Code terminal sessions. Its home is the **Ticket Line**, a board of cards moving through the loop (Inbox → Plan → Build → Needs you → Try it → Ship → Done); each card follows a Claude Code session in a Windows Terminal tab. The owner uses it daily at Veterans United (VU) and is rolling it out to coworkers, developers and non-developers alike. The product aim: **a one-stop shop for the daily development loop**, so people leave the app as rarely as possible (for Claude Code, Jira, GitHub, TFS), stay effective, and don't feel overwhelmed.

## Read before changing anything
- `CLAUDE.md`: the rules. Local-only (127.0.0.1), keyboard-first with every action keyed and listed in `?` and the legend, pnpm, conventional commits, named paths only.
- `docs/prompts/continue.md`: the code layout, the machine facts, and **how to test on an isolated server without touching the owner's running app**.
- `docs/prompts/continue-ticket-line.md`: where the line stands, milestone by milestone.
- `docs/PLAN.md`, especially:
  - **§43**: the review before rollout. What was fixed (tokens, the dev-origin hole, loop frictions, screen trims) and **ten proposals left open**, ranked.
  - **§44**: typing to a card's terminal from the page, `y` / `n` answering its prompts (Claude Code channels, with a launcher that presses through the development-channels confirmation). Proven live. Ends with the "leave the app less" list: Jira comments and transitions from the card, PR comments inline, TFS builds.
  - §27 and `docs/futures/path-line.html`: the chosen direction and the original mock; §41: the full-screen card; `docs/UX-AUDIT.md` and `docs/design-cockpit.html`: the design background.
- Memory from the owner: the **cockpit** style (keycaps drawn on everything, a legend of the keys that work now) was chosen deliberately over a hide-the-keys look. **That is now softening**: the owner finds the page busy and wants the keycaps to be switchable off.

## The job: effective and simple, for users and for developers
The owner's words: "making sure the UI is as effective as possible while staying as simple as possible… something people want to work in all day and not feel overwhelmed, but still allowing them to be as effective/efficient as possible in terms of what is offered to them." Both the **user experience** and the **development experience** should be strong.

### 1. Keycaps you can switch off
A setting, in the settings/bindings dialog (`B`) and probably on the `?` overlay: **Show key hints: always / on hover and in `?` / never**. With them off, every `<Key>` drawn on buttons, chips, section headers and empty states disappears, the legend bar collapses to the few keys that matter right now (or goes entirely, with `?` the one way to see keys), and the layout doesn't jump. Keep the keys themselves working whatever the setting. Persist it on the server like the other settings so it follows the person across browsers. The `Key` component (`web/components/ui.tsx`) and `legend.ts` are the seams; look at how many places render keycaps before deciding whether a context value or a CSS class does it.

### 2. Less on screen, by default
Screens to look at with fresh eyes, with screenshots from the isolated server (the Playwright pattern in `continue.md`): the board, an open card, the new-card screen, the Ship sheet, the run-recipe editor, the Try it picker. §43 already removed the board's third bar, the memory meter, "In the app (later)" and the hook paragraphs. Still open, in rough order of value:
- **An open card shows every action twice** (the button bar above the legend). Decide which goes; if the legend's items become clickable, the button bar can.
- **The new-card screen** has three dense panels plus a header row of pills. Which of panel 3's rows (kind, workspace, starts in, branch, mode, model, message) could fold behind a sensible default for the common case (`n` on a ticket, `Ctrl+Enter`)? The per-row token counts are rarely acted on.
- **Column subtitles** on the board: useful on day one, noise on day thirty. Candidates for the same "hints" setting.
- **Explanatory sentences** in empty states and under boxes: keep the ones that name the next key, cut the ones that describe how the app works.
- The **Welcome** tour and the `?` overlay are the right homes for anything removed from the screens.
Measure before and after: count the interactive elements and keycaps visible on each screen at 1440×950; aim to halve them on the board and the open card without losing a key.

### 3. The loop, where it still leaks out of the app
From §43's proposals and §44's list, the ones that most reduce leaving the app:
- **Needs you still means alt-tabbing** when the channel can't help (the trust-the-folder prompt, sessions started outside cc-control): a key that brings the card's Windows Terminal tab forward.
- **Esc Esc or `Alt+L` throws away a half-built card**: keep the draft, offer to resume.
- **Jira from the card**: post the QA report / review findings as a comment and move the ticket's status (writes: asked first each time). **PRs inline**: comments and checks on the Ship card. **TFS builds** on the card (§35).
- **Orphaned Try it processes** after a `Stop-Process` restart; **deleted cards' worktrees and branches** left behind.

### 4. Development experience
So the next features come fast and safely (§43's code-health list):
- Split `web/components/Dialogs.tsx` (1000+ lines), `TicketLine.tsx` (the card view and Try it into their own files) and `server/index.ts`'s 300-line message switch.
- `web/line-keys.ts` has no tests: pull the decisions (`decideTry`, `decideShip`) into `line-model.ts` and test those.
- Rename `line.drawer` → `line.open` and fix the stale "drawer" comments.
- The stack tests bind fixed ports; CI has no `windows-latest` leg though the product is Windows-only where it matters.
- A short "how to add a key / a dialog / a message type" section in `continue.md` would save every future session ten minutes.

## How we work
- **Build and verify on an isolated server** (port 7788, its own DB, `dist/web-test`), never the owner's `:7777`. Scripted Playwright walkthroughs with screenshots you actually look at. For UI work, take **before and after** screenshots of each screen and compare.
- **Push verified work straight to main.** Verified means `pnpm typecheck` (strict on unused), `pnpm test` (233 at hand-off) and the Vite build pass, plus the walkthrough for UI changes.
- **Every change gets a PLAN section** in the same commit, and a README update when user-facing. Keep `continue-ticket-line.md` pointing at what's next.
- **Still ask first before:** restarting a server the owner is running; anything that writes to Jira or TFS (a real PR counts); changing global npm, pnpm or git config; real `okteto` commands in a shared namespace; removing a whole feature (trim, don't delete, unless the owner says).
- **Keep VU-internal names out of code and examples** (say "the scenario tool"); never commit tokens, VU code or ticket text.
- Conventional commits, named paths only (never `git add -A`). Files are CRLF. Node 24, pnpm.

## Lessons that cost time before
- **The Bash tool's heredocs mangle backslashes and sometimes quotes.** Write edit scripts and test files with the Write tool, then run them. Python edit scripts should read with `newline=''`, work on LF, and write back with the file's own line ending.
- **Zustand selectors** that return a new array or object re-render forever; keep stable constants, filter outside the selector.
- **PowerShell 5.1**: `ConvertFrom-Json` returns a top-level array as one nested object; `Out-File` writes UTF-16; `.NET Process.Start` needs a full path. The launcher (`hooks/cc-control-launch.ps1`) has the working patterns.
- **Windows Terminal re-quotes the command line** it is given; anything with quotes or braces must be a file path or base64 (that is why the launcher takes one base64 argument).
- **Claude Code**: `--channels server:x` loads a channel but drops its messages; only the dev flag delivers, and it prompts every launch. A `-p` run declines tools instead of relaying permissions, so the channel's permission path can only be proven interactively. Hook events (`PreToolUse`, `PermissionRequest`) arrive seconds apart and out of order with channel messages.
- **Reading a terminal tab's text** without a screenshot: UI Automation on the `CASCADIA_HOSTING_WINDOW_CLASS` window's `TermControl` (`TextPattern`); the PowerShell snippet is in the §44 session's history, worth saving to `continue.md` if used again.
- **Playwright**: `page.keyboard.press('?')` doesn't open help, use `Shift+Slash`; clicking a card title can open it full screen and swallow the next click; prefer the keys. Check `[role=dialog]`, not page text.
- **Real terminal tabs you start while testing can't be stopped from here**; kill the `claude.exe` whose command line names `claude-channel.json`, and put the demo repo's branch back (`git switch -`, delete the `card-N-…` branch).

## Before you start
Say in a few lines what you understand the state to be and which machine you're on (the owner's personal laptop has `D:\repos`, demo repos in `%TEMP%\cc-demo`, the owner's server on `:7777`; the VU laptop is a clone they `git pull`, with the real Jira, TFS and Okteto). Then propose, with screenshots of the current screens, what you'd cut, what you'd fold behind the hints setting, and what you'd keep, **before** changing the look. Build the setting first (it's the owner's clearest ask), then the trims, then the loop items, each as its own commit with a PLAN section.
