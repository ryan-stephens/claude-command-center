# Continue: the session opens in place of the preview

Paste this into a new Claude Code session opened in `D:\repos\cc-control`.

---

You're picking up **cc-control** ("Command Center", GitHub `ryan-stephens/claude-command-center`): a local, keyboard-first web app for driving Claude Code sessions, built on `@anthropic-ai/claude-agent-sdk`. The owner uses it daily and is showcasing it to their org. Its pitch is everything Claude Code does natively, plus better flow: workspaces of repos, a visual repo library, and keys you can see.

## Read first
- `CLAUDE.md`: project rules. It's local-only (loopback), keyboard-first (every action needs a key, a legend or hint, and a row in `?`), uses pnpm, conventional commits, and named paths when staging.
- `docs/PLAN.md` §17–§23: the cockpit, workspaces, repo library, folder picker, collapsible sections, slash and `@` suggestions, Claude Code parity, and arrow-key menus. Read §20 closely: it built the current preview.
- The code for this task:
  - `web/components/Home.tsx`: `Home`, `Column`, `WorkspaceColumn`, `SessionColumn`, `PreviewColumn` (uses `recentExchanges`), `RepoLibrary`, `ContextChips`.
  - `web/components/SessionView.tsx`: the full session. It holds `SessionHeader`, the transcript, `TodoPanel`, `ActivityBar`, `Composer` (slash, `@`, argument choices, history, images), `ModeLine`, and `NumPad`/`PadRail`.
  - `web/keys.ts`: `homeKeys` (columns `workspaces → sessions → preview`, `shownCols()`), `sessionKeys`, `cardKeys`, `openSession`, `backToList`, and `keymap()` for `?`.
  - `web/store.ts`: `screen: 'list' | 'session'`, `homeCol`, `HOME_COLS`, `selectedId`, `openId`, `zone`, `folds`. `web/folds.ts` is where collapsibles are remembered.
  - `web/legend.ts`: the bottom key bar, tested in `legend.test.ts`.

## The task
The owner doesn't get much value from the **preview column**. It shows a summary of the last three exchanges plus Open, Rename and End. What they want:

- **Selecting a session on home shows the actual session**: its live transcript, activity line, approval, question and plan cards, to-do list, and message box, in the space the preview uses today. It should be usable right there (type, answer, run workflows) without leaving home.
- **A clear way to expand it to full screen**, which is what double-click, `Enter` and "Open" do today. Collapsing back should be just as easy.

Design points to settle; propose, then build:
- **Reuse, not a copy.** Render the real session pieces in the pane, with a `compact` or `docked` variant of `SessionView`, rather than a second, weaker preview. `Composer`, `cardKeys` and `sessionKeys` assume `screen === 'session'` and `openId`, so work out how the docked session gets focus and keys: a third home column that owns a `zone`, or `openId` set while `screen` stays `'list'`.
- **Keys.** Today `→` walks into the preview column, `Enter` opens full screen, and `Esc` and `Numpad 0` / `Alt+0` go home. Suggestion:
  - `→` or `Enter` from the sessions list puts you into the docked session (message box).
  - A dedicated key (say `F` or `Ctrl+Enter`, checked against `bindings.ts` reserved keys) expands it to full screen and collapses it back.
  - `Esc` steps back out to the list.
  - Every change needs `?`, legend and README updates.
- **What goes where.** At 1024 px and up the pane has room. Below that the preview is hidden today (`shownCols`); decide what selecting does on narrow screens and on phones (probably the same as today: open full screen). The number pad probably stays full-screen-only, or folded into a rail in the docked view.
- **Home preview features to keep:** answering an approval from home without opening (Y/A/N in the preview column), and the "Claude can use" chips. Keep the live-transcript cost in mind. The preview loads a transcript after 200 ms on selection (`session.open`), and very long histories are slow to read (PLAN §17 known gap). Keep a delay, and don't load on every arrow press.
- **Collapsible:** the docked pane should fold like the other sections (PLAN §20; `C` folds what you're in), so the list can take the width.

## State when this was written (2026-09-29)
- On `main`. **Three commits are not pushed yet** (`6c7d589`, `3ce2115`, `6294977`); ask the owner before pushing.
- The owner's app runs on `:7777` as a hidden `node server/index.ts` (restarted by me; logs in `~\.cc-control\server.log`). It serves `dist/web` live, so `pnpm build` changes what their page loads on its next reload. Server-side changes need a restart. **Ask first**, because a restart stops sessions running in the app. The way it's been restarted:
  ```powershell
  $p = (Get-NetTCPConnection -LocalPort 7777 -State Listen).OwningProcess; Stop-Process -Id $p -Confirm:$false
  Start-Process node -ArgumentList 'server/index.ts' -WorkingDirectory 'D:\repos\cc-control' -WindowStyle Hidden -RedirectStandardOutput "$env:USERPROFILE\.cc-control\server.log" -RedirectStandardError "$env:USERPROFILE\.cc-control\server.err.log"
  ```
- `PROTOCOL` in `shared/protocol.ts` is 3. Bump it whenever the page starts relying on a message an older server would drop. The page then shows an "out of date" banner instead of failing silently.
- Checks: `pnpm typecheck`, `pnpm test` (104 tests) and `pnpm build` all pass.

## How to work (lessons from the last sessions)
- **Never disturb the owner's `:7777` app or their browser.** Test on an isolated server with its own database and build:
  - `pnpm exec vite build --outDir ../dist/web-test --emptyOutDir`
  - then run with `CC_CONTROL_PORT=7788 CC_CONTROL_DB="$TEMP/cc-test-3.db" CC_CONTROL_MODEL=claude-haiku-4-5-20251001 CC_CONTROL_WEB_DIST="D:/repos/cc-control/dist/web-test" node server/index.ts`, or start it detached from PowerShell with the same env.
  - Stop it by the PID that owns `:7788`, checking that the command line is `server/index.ts`, never `:7777`. Delete `dist/web-test` when you're done.
- **Headless Playwright:** `require('C:/Users/ryans/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright')`, launched with `executablePath: 'C:/Users/ryans/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'`. Set `localStorage['cc-control.welcomed.v2'] = '1'` in an init script to skip the welcome.
- **Screenshots stay inside a demo workspace.** "Everything else" and "All sessions" show the owner's real sessions, including this conversation.
  - Wait for the Demo workspace (`getByRole('option', { name: /Demo/ })`) **before** pressing `1`.
  - Never screenshot on a failure path.
  - Demo repos (git) are in `%TEMP%\cc-demo` (web-app, docs-site, payments-api, cdn-worker, design-tokens). A test run needs a Demo workspace in the fresh DB: create it through the UI, or reuse the walkthrough approach in PLAN §18.
  - Revert any change Claude makes to a demo repo (`git -C … checkout -- <file>`).
- **The owner's global `~/.claude/settings.json` allows Edit, Write, Read, WebFetch and WebSearch**, so edits don't raise approval cards. Use a non-read-only Bash command (for example `node -e "console.log(40+2)"`) to get a card; `echo` is auto-allowed.
- **Editing files:** the Bash tool's heredocs have repeatedly eaten backslashes in regexes and Windows paths. Use the Write and Edit tools for code, or a Python script written with Write, not inline heredocs, when the text has `\`.
- **Pure logic gets `node:test` tests** next to it: layout and focus rules, key routing tables, and legend content.
- **Commits:** conventional, named paths only, and a new `docs/PLAN.md` section in the same commit. Ask before pushing. Don't touch `D:\repos\rc-hub`.

## Done when
On home at 1440×900:
- Selecting a session with `↑ ↓` shows the real session beside the list after a short delay.
- `→` or `Enter` puts you in its message box, where you can send, answer a card with `Tab` then the arrows, and use `/` and `@`.
- One key expands it to full screen and the same key brings it back.
- `Esc` returns to the list, and the pane folds with `C`.
- Narrow screens and phones still work.
- `?`, the legend and the README describe it.
- A scripted walkthrough with screenshots confirms all of this in a demo workspace, and typecheck, tests and build are green.
