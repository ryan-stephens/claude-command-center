# Make Try it robust: a run manifest, a stop sweep, health after up, a per-developer overlay

Paste this into a new Claude Code session opened in `D:\repos\cc-control`.

---

You're continuing work on **cc-control** ("Command Center"), a local web app for working with many Claude Code sessions at once. The owner uses it every day and is showing it to their org. This session makes **Try it**, the local spin-up of a card's app and its stack's services (local processes, Okteto dev environments, port-forwards, proxy edits), more robust. It works in phases, smallest and most valuable first.

## Where this comes from
On the work laptop the owner compared cc-control with another team's tool that spins up a hybrid local/Okteto environment. That tool does less than ours on readiness, but it handles cleanup, health and per-developer config better. The gaps below were found by reading our code, not by seeing them fail. They are design gaps, not bugs, and none has been reproduced.
- **Leaks when the server goes away.** `stopAll()` in `server/recipes.ts` (around line 690) kills the process trees and skips the `stop:` steps, as its comment says. So `okteto down`, `kubectl delete` and the like never run, and dev environments and deployments can be left running.
  - Nothing reconciles leftovers on start.
  - `restoreLeftovers` in `server/stack.ts` (around line 85, called from `server/index.ts` at start) only puts back proxy files it finds as `*.backup.json` in the runs folder.
- **No health after up.** A port-forward that dies, or a process that hangs, is only noticed if the process exits.
- **A repo added later** with `c` runs from its usual folder, and hard-linking `node_modules` into worktrees is slow (§110–§112).
- **No per-developer stack settings** (an open item in §37 and §52).

## Read first, in this order
1. **`CLAUDE.md`**, the rules:
   - local-only: the server binds to 127.0.0.1;
   - keyboard-first: every new UI action gets a key, a row in `?` and an entry in the legend;
   - pnpm and conventional commits, staging named paths only;
   - the two-laptop rule: this is the personal laptop, so build and commit here; the owner checks at work.
2. **`docs/prompts/continue.md`**: what the app is, where things are, how to test, the walkthroughs, the state.
3. **`docs/PLAN.md`**: search for the headings rather than read the whole file:
   - `## 37.` (workspace run recipes, teardown) and `## 52.` (`wait:http:`, readiness);
   - `## 82.` (Try it as services);
   - `## 110.` to `## 113.` (worktree `node_modules` as hard links, the clone lock, the UI row, compiling dev servers);
   - `## 114.` (two cards on one stack, the port pool) and `## 117.` (run logs under `runs/logs/`);
   - `## 123.` (the front door).
4. **The code:**
   - `server/recipes.ts`: the runner, `Live` runs, `stopAll`, `cleanup`, the stop path, `made` files;
   - `server/stack.ts`: the stack, proxy edits and their backups, `runsDir`, `restoreLeftovers`;
   - `server/run-logs.ts`;
   - `scripts/link-deps.ts`;
   - `server/ship.ts`: the PR title;
   - `scripts/doctor.ts`;
   - the Jira and Trello clients (search `server/` for them);
   - their `*.test.ts` files.
5. **The stand-ins** in `docs/walkthroughs/simple-new-card/standins/` (`okteto-up.cjs`, `down.cjs`, `okteto-helper.cjs`, `api.cjs`, `ui.cjs`, `nx-serve.cjs`, `ui-compile.cjs`). Also the walks that drive Try it: `walk-deps`, `walk-two-cards`, `walk-board-try`, `walk-try-compile`, `walk-stack`.

## The phases
Each phase gets its own PLAN section (the next is **§137**; run `git fetch` first) and its own commit. A PLAN section that defers something says so in its own **Not yet:** line, as earlier sections do; there is no single list. Before building each phase, check the code still looks the way described above, and say so if it doesn't.

1. **A run manifest (highest value).**
   - Per card, keep a small JSON file under the runs folder, written as each service starts and updated on every step and on failure. It holds:
     - the run keys and pids;
     - the files the run made (manifest copies, proxy copies);
     - the `stop:` steps still owed;
     - any edited proxy file with its backup.
   - On server start, read the leftovers:
     - restore proxy edits (fold `restoreLeftovers` into this);
     - kill orphan pids that still match: same pid, and a command line that still names the card's folder;
     - offer to run the owed `stop:` steps.
   - Show it in the UI as a **"Leftovers from last time"** row with a key to clean up, a `?` row and a legend entry.
   - Make `stopAll()` run the owed `stop:` steps (bounded in time), or at least leave them in the manifest.
   - Tests: simulate a crash mid-launch and assert that the reconcile cleans up.
2. **A stop sweep.**
   - After killing the process tree, find stragglers whose command lines include the card's runs or worktree folder, and kill them.
   - Test with a stand-in process.
   - Never touch a process that isn't under the card's folders: the owner's own servers (:7777, and the long-running one on :7788) must survive.
3. **Health after up.**
   - For a running service, probe its port or its `wait:` target every ~5 s, and keep a short history.
   - Show up / unhealthy / offline on the tile and in the Try it panel.
   - When a service that was up goes unhealthy, say so through the existing attention path.
   - The interval and the probe are properties of the step; the default reuses the wait target.
   - **No auto-restart.**
   - Mind the speed budget: `walk-perf` must stay clean, and a probe must never block the event loop or re-render the board when nothing changed.
4. **A per-developer stack overlay.**
   - A local overlay file, per user and outside the repo (for example in `~/.cc-control/`, as `verify.json` is), merged over the workspace stack: objects merge, arrays union, scalars replace.
   - Values that came from the overlay show as such in the stack table.
   - Unit tests for each merge rule.
5. **A shared checkout for repos outside the card.**
   - A repo added later (or one not in the card) runs from a shared, reused checkout at its default branch instead of its usual folder.
   - Re-run the install step only when the lockfile changed or the last install didn't finish.
   - Warn when a repo run from another folder is on a different branch than the card.
   - **Check this against §110–§113 before building:** the VU UI monorepo takes about 20 minutes to install, so never install per card and never use a junction (`git worktree remove` follows it and empties the main checkout).
   - If it doesn't hold up, write why in the PLAN section and skip it.
6. **Small ones.**
   - Refuse to start a service whose repo is on `main` or `master`, and ask for a branch, reusing the new-card branch flow.
   - Compare `server/ship.ts`'s PR title with this rule: the type comes from the highest-precedence conventional commit on the branch, and a `!` or a `BREAKING` footer makes it `type!`. Adopt the rule if ours differs, with tests.
   - Make Jira and Trello auth failures specific: 401 means the token expired, 403 means no access, 404 means a wrong key or site.
7. **A real integration test.** At least one test that uses real temporary git origins and real worktrees, not stand-ins, for a card's worktrees and for ship.

**Ask the owner only what changes what you build**, with `AskUserQuestion` (previews where layout is involved). Likely questions:
- where the leftovers row lives (the bar, the home page, the Try it panel);
- whether cleanup runs the owed `stop:` steps on its own at start or only on a key;
- the overlay file's name and place.

## How to work
- **Measure or reproduce before fixing:**
  - use the stand-ins to make a run leak (kill the server mid-launch) and see the leak before writing the manifest;
  - verify on an isolated test server, never the owner's at :7777.
- **Ports:**
  - :7788 is another cc-control server, running since 2026-09-30; it isn't yours, so leave it alone;
  - :7826 and up have worked;
  - walks that need a running server take `PORT=`.
- **Before each commit** (MVP pace, PLAN §136):
  - `pnpm typecheck`, `pnpm test` (452 at §135);
  - the Try it walks you touch: `walk-deps`, `walk-two-cards`, `walk-board-try`, `walk-try-compile`, in one theme;
  - a new walk for the leftovers and the health (screenshots only where the UI changes).
  - `walk-card`, `walk-hub`, `walk-perf` and `walk-your-move` only when the change reaches those areas.
  - Build `dist/web-test` first: `pnpm exec vite build --outDir ../dist/web-test --emptyOutDir`.
- **Pushing verified work to main is pre-approved.**
  - These phases are mostly server changes, and a server change reaches the owner's app only with a restart. **Ask first.**
  - Before a restart, stop the Try it apps (`t` on the card) and the running sessions' MCP servers.
- **Clean up after testing:**
  - stop a test server by its Windows PID, after checking its command line is `server/index.ts`;
  - stop only orphaned MCP trees;
  - leave no `*-card-*` worktrees in `%TEMP%\cc-demo`, nor branches your walks made;
  - delete `dist/web-test`.
- **Editing files:**
  - Windows 11, Node 24, files mostly CRLF;
  - the Bash tool's heredocs eat backslashes (regexes, `\n` in strings, Windows paths), so edit with the Edit tool or a Python script written with the Write tool, keeping each file's line endings.
- **The repo is public:** no VU code, URLs, hosts, namespaces, app names or paths, proxy entries, ticket contents, tokens, or internal tool names, and don't name the other team's tool. Okteto, kubectl and stand-in names are fine.

## How the owner checks it on the work laptop
That laptop can't push. A session there diagnoses and writes a handoff (`docs/prompts/vu-handoff-template.md`).

When a phase lands, list in its PLAN section what to check there. For phases 1 to 3:
1. `git pull`. Ask before restarting the server.
2. Press `t` on a card with two services, kill the server process mid-run, and restart it. The leftovers row appears, and cleaning up really runs `okteto down` / `kubectl delete`.
3. Press `t` again and kill one service's port-forward by hand. Its tile turns unhealthy within ~10 s.
4. Run `pnpm run doctor`.

## Open items to keep (each in the PLAN section it belongs to, under Not yet)
- Passing a printed value between steps (§37).
- Starting APIs in parallel.
- A local mock or stand-in service step type (an idea only: the other tool routes some events to local handlers and passes the rest to the real broker).
- Failure classification for the 12-line failure tail: an expired login, the wrong context or namespace, a port already forwarded, `KUBECONFIG` unset. The other tool has none, so this would be new.
- `doctor` still ignores a per-environment `KUBECONFIG` when it checks the okteto context.

## After the phases
Ask the owner what is next. Known open items:
- new README screenshots (`docs/screenshots/line*.png` still show the old board, §126);
- the owner's VU check of the front door (§123);
- the simple look's settings still say "Runs in a Windows Terminal tab" though cards run in the app (§131, hard-coded in `howFacts`).
