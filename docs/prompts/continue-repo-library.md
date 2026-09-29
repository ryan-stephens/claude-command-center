# Continue: repo library folder picker

Paste this into a new Claude Code session opened in `D:\repos\cc-control`.

---

You're picking up **cc-control** ("Command Center", GitHub `ryan-stephens/claude-command-center`): a local web app for driving Claude Code sessions. It just went through a UX redesign into a keyboard-driven "cockpit" with workspaces and a repo library. That work is committed and described in `docs/PLAN.md` §17.

## Read first
- `CLAUDE.md` (project rules).
- `docs/PLAN.md` §17: the cockpit, workspaces, repo library, and the review fixes.
- The code for this task:
  - `server/repo-library.ts`: scanning source folders, and `cleanSources`.
  - `server/index.ts`: the `library.setSources` and `library.scan` handlers, and the `library()` cache.
  - `web/components/Dialogs.tsx`: `SourcesDialog` and `SourcePrompt`, which is also embedded in `WorkspaceDialog`.
  - `web/components/Home.tsx`: `RepoLibrary`.
  - `web/keys.ts`: `libraryKeys`, where `F` opens the folders dialog.

## The problem
The owner opened the folders dialog, typed a path and pressed Enter, and the folder didn't persist.

**Likely cause, confirm it first:** the owner's app on `:7777` was still running the *pre-redesign server* while serving the *new* web build. The new UI sends `library.setSources`, and the old server has no handler for it, so it drops it silently. A connection check showed `:7777` sending only `sessions`, `settings` and `session.activity`, with no `workspaces` or `library`.

The fix there is a restart (`pnpm start`). But make it impossible to miss:
- The client should notice when the server never sends `workspaces` or `library`, and show "The server is out of date. Restart it with `pnpm start`."
- Or add a protocol version to the first message and compare it on connect.

Then check the real input problems, fixing any that bite:
- **Quoted paths:** Windows "Copy as path" wraps the path in `"…"`, and `isAbsolute` fails on the quotes.
- **Drive roots:** `D:\` becomes `D:` after the trailing-slash strip, and `D:` means "the current directory on D", not the root.
- **Forward slashes and `~`.**
- **Silent errors:** any error text must show *inside the dialog*, not only in the header.

## What to build
A proper **folder picker** in the folders dialog, so nobody has to type a path.

- **The server has to supply the folders.** Browsers can't give a web page absolute paths (`webkitdirectory` only gives relative names), so the server lists them.
  - Add a message such as `fs.list { reqId, path? }` that returns the subfolders of `path`.
  - With no `path`, return the starting points: drive letters on Windows, the home folder, and the suggested sources.
  - Mark which folders are git repos, and which hold git repos directly inside (good candidates for a source).
- **Keep it read-only and safe.** List folder names only, never file contents. Validate and normalise the path, cap the number of entries, and skip hidden and system folders. The server binds to loopback only; keep it that way.
- **UI:**
  - A breadcrumb (`D:` › `repos`) and a list of folders you walk with the keys: `↑ ↓` to choose, `→`/`Enter` to open a folder, `←`/`Backspace` to go up, and a "Use this folder" button on `Space` or `Ctrl+Enter`.
  - Show "12 repos inside" next to candidate folders.
  - Keep the text box for pasting a path; typing a path should jump the picker there.
  - Every action needs a key, a legend or dialog hint, and a row in the `?` overlay (see `keymap()` in `web/keys.ts`).
- **After a source is added,** the library row should update right away, with the new repos shown. It should also be easy to remove a source (`Delete` on a focused source).
- **Use the same picker in all three places** the path is asked for: the folders dialog, the embedded prompt in the workspace editor, and "Another folder…" in the new-session and repo pickers.

## How to work
- **Never disturb the owner's running app on `:7777`, or their browser.**
  - Test on an isolated server: `CC_CONTROL_PORT=7788 CC_CONTROL_DB="$TEMP/cc-test-3.db" CC_CONTROL_MODEL=claude-haiku-4-5-20251001 node server/index.ts`.
  - **`pnpm build` rewrites `dist/`, which the owner's running server serves live.** Tell the owner to restart `:7777` once you're done, or build to a separate folder while testing.
- **Headless Playwright** is at `C:/Users/ryans/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright`. Launch it with `executablePath: 'C:/Users/ryans/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe'`.
- **Demo repos (git) live in `%TEMP%\cc-demo`.** Screenshots must stay inside demo workspaces. "Everything else" shows the owner's real sessions, so never open or send to those.
- **Pure logic gets `node:test` tests.** That covers path normalisation (quotes, drive roots, slashes) and the listing filter.
- **Checks:** `pnpm typecheck`, `pnpm test` (64 tests today) and `pnpm build` must stay green.
- **Commits:** conventional commits, staging named paths only, never `git add -A`. Update `docs/PLAN.md` with a new section in the same commit. Ask before pushing.
- **Don't touch `D:\repos\rc-hub`.**

## Done when
The owner can press `F` on home (or open Folders), walk to `D:\repos` with the arrow keys, press `Space`, and see every repo in it in the library. The choice survives a restart, and a scripted walkthrough with screenshots confirms it.
