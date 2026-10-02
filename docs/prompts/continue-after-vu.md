# Keep improving the app while it is smoke-tested at VU

Paste this into a new Claude Code session opened in `D:\repos\cc-control` (the personal laptop).

---

You're continuing development of cc-control ("Command Center", GitHub `ryan-stephens/claude-command-center`): a local web app that sits on top of Claude Code terminal sessions. Its home page is the Ticket Line, a board of tickets moving through Inbox → Plan → Build → Needs you → Try it → Ship → Done, each card following a Claude Code session in a Windows Terminal tab. I use it for everyday work at Veterans United (VU) and want to roll it out to coworkers: simple enough for non-developers, fast for experienced developers, flexible about how teams work.

Where things run:
- All development happens on this laptop, `D:\repos\cc-control`. Check the hostname and repo path first. If you find you are on the VU laptop instead, don't edit or commit: diagnose, and write a handoff in the shape of `docs/prompts/vu-handoff-template.md` with no VU code, URLs, proxy entries, ticket contents, tokens or internal tool names.
- My VU work laptop pulls `main` and smoke-tests from a clone. It can't push. What I find there comes back to you as a handoff prompt or as a few lines of what I saw.
- Other sessions may be working in this repo at the same time: `git pull` before you start and before every commit; stage named paths only; if a test port is taken, use another one; don't stop servers you didn't start. My own app runs on :7777; ask before restarting it.

Read before changing anything:
- `CLAUDE.md`: the project rules.
- `docs/prompts/continue.md`: how the code is laid out, how to test on an isolated server without touching my app, the machine facts.
- `docs/prompts/continue-ticket-line.md`: what the line does and where it stands.
- `docs/PLAN.md` §54: the five milestones just built (worktrees as the way a card works, several cards up at once, a stack read from the repos, Ship per repo, context added later feeding the run). Read its **Not verified** and **To check at VU** lists: they are what my smoke test exercises, so what I report will land in them. Skim §42, §52 and §53 for the stack and worktrees, and §35 for keeping trackers, dev environments and code hosts swappable.

## Where this stands (2026-10-01, evening)
Two sessions in. The second one (commits `6816cc5` and `6217133`) built Ship after a part-way failure (`s` again ships only the repos left; `ship.left` on the card, `shipMode` in `shared/ship.ts`, PROTOCOL 20), hid the Overview's *Claude said* when the live transcript is beside it, and built the stack editor's table (`web/stack-table.ts` + `web/components/StackTable.tsx`; the editor's tabs are repo → workspace → table → JSON). Both are written into PLAN §54 (milestones 3 and 4) and §55, each with a *To check at VU* list. The owner is now smoke-testing at VU and will paste what they see; thread 1 below is the priority.

Everything in §54 is built and verified against stand-ins only: a stand-in `okteto` that starts an API on the port its `-f` manifest forwards, a stand-in `gh`, a stub TFS, stand-in repos. The real Okteto, kubectl, the team's helper, nx, `gh` and TFS are on the VU laptop. The open items, in the order the smoke test will meet them:
1. `t` on a workspace with no stack: does detection read the real `angular.json` / nx serve target, the real proxy file, and the manifest the helper generates? What came out as `?` that should have been `✓`? (`e` then shows the same as a table, a row per part with the files each was read from; `e` on a row fixes a value.)
2. The real `okteto up -f okteto.cc-control.yml`: does a sibling copy keep the sync folder and the dev name? If not, the fallback is the `${CC_PORT:-8080}:8080` edit to the team's manifest with `CC_PORT={{port}}` on the step (§54, milestone 2). **First handoff (2026-10-01, evening):** `t` stuck at *waiting for port 18000* with Okteto forwarding 8080: the owner's `okteto up` line had no `forward:` (only the editor's amber list said so), and `-f` was never added to a PowerShell line (`$Env:KUBECONFIG = "…"; okteto up`). Fixed in §54 milestone 2 (*Found at VU*): the prefix is implied whenever a port is picked, `forward:no` opts out, and the `-f` goes after a `;` or `&&` too. Not yet tried against the real `okteto up -f`. **Second handoff (same evening):** with that fix the whole stack came up. Try it then said *Running at http://localhost:4200* for an app that serves at `:4216/ap-summary/…`: the UI repo is an nx workspace of several standalone apps, and `ui.url` had been written from the example. §57: `ui.path`, the URL from the served app's own project file when `ui.url` is unset, the app named in the title. Resolved: the owner serves app-summary, which hosts the work; the UI step names it. Open: a *which app* choice in the picker, the owner's call. **Third ask (same evening):** a card whose Jira ticket is already in *Ready for PO* or *Done* should sit in the Done column: §58, the cards' tickets are fetched by key on every refresh and a finished one moves its card. **Fourth handoff:** the UI's API calls got a 504: the stack's own rules targeted `localhost:8080` as a literal; §57a makes such a rule follow the picked port. **Then the owner confirmed Try it works end to end at VU for one card** (the real `okteto up -f` with the sibling copy, the UI on 4216, the API answering). Items 1 and 2 above are done for one card; item 3 (two cards at once) and `okteto down` on stop are what's next to see there.
3. Two cards on the same stack at once: ports, deployments, the namespace's room.
4. A real multi-repo ship to TFS: two blocks, two PRs linking each other. If it stops part-way, `s` again ships the rest (built and tried against stand-ins, 2026-10-01).
5. The trust setting against the real `~/.claude.json`; `c` adding an API repo joining the stack.

## How we work
- Push verified work straight to main; no need to ask. "Verified" means `pnpm typecheck` and `pnpm test` pass, `npx tsc --noEmit --noUnusedLocals -p .` now and then, and for UI changes a scripted Playwright walkthrough on an isolated server with screenshots you actually look at. Report plainly what passed, what didn't, and what was only tried against stand-ins.
- Every change gets a PLAN section (or an update to §54's milestone) in the same commit, and a README update when it's user-facing. Keep `continue-ticket-line.md` pointing at what's next.
- Conventional commits. Node 24 and pnpm; files are CRLF.
- Ask first before: restarting a server I'm running; anything that writes to Jira or TFS; changing global npm, pnpm or git config.
- Never commit tokens, VU code, VU URLs, proxy entries, ticket contents or VU-internal tool names.
- Keyboard first, with the keys visible: every action needs a key, a legend entry and a row in the `?` overlay. Local only: the server binds to 127.0.0.1.

Lessons from earlier sessions:
- A zustand selector that returns a new array or object re-renders forever (React error #185). Select the stored value and derive outside the selector, or use a stable empty constant.
- Don't trim `git status --porcelain` output: its leading spaces are part of the format.
- The Bash tool's heredocs and `sed` mangle backslashes and regexes. Write edit scripts and tests with the Write tool, or use Edit.
- Playwright: `press('?')` doesn't open help; use Shift+Slash. Check for `[role=dialog]`, not page text. `innerText` uppercases eyebrow headings (match case-insensitively) and leaves out a textarea's value (use `inputValue()`). Flash messages are gone within seconds; check the card's state instead.
- A card started in a folder Claude Code hasn't trusted (any new worktree) stops at the trust prompt in its tab, unless the trust setting (`?` `B`) is on.
- Process kills of terminal tabs from tests are blocked. Tell me which tabs to close.
- Cards without a `sessionId` hide the Try it section; seed test cards with one.
- A stand-in program for the server's PATH must go on it in POSIX form from Git Bash (`cygpath -u`), or the `C:` colon breaks the PATH.
- A stand-in that has to run from the step's folder must `require(path.join(process.cwd(), …))`, not a relative path.

## The job
Two threads, both yours:

**1. Act on what comes back from VU.** When I paste a handoff or a few lines of what I saw: reproduce it against a stand-in first (the walkthrough seeds in §54 show how: real git repos in a temp folder, a stand-in okteto or gh on PATH, an isolated server on a free port), fix the app where the app is wrong, and say what to try next in a short "To check at VU" list. If what I saw means a design assumption in §54 was wrong (the manifest's shape, the helper's naming, the proxy file), change the design, not just the symptom, and write it into §54. Keep fixes small and commit each with its own verification.

**2. Keep improving the app between handoffs.** Pick from these, in this order, unless a handoff needs you:
- ~~The stack editor's confirmation table that §54 milestone 3 left out~~ (done 2026-10-01, written into §54 milestone 3: a row per part with the files it was read from, `e` changes a row, `Delete` drops an API, `Enter` saves, `Alt+W` to the JSON; a saved stack shows where the repos now differ).
- ~~Ship after a part-way failure~~ (done 2026-10-01, §54 milestone 4: `s` again ships only the repos left; the shipped block says *Shipped already*).
- ~~`Shift+D` changes on a worktree card across every repo, not just the home one~~ (done 2026-10-01, §56: a header per repo, the Overview's *What changed* names the other repos' files by repo).
- The trust prompt for `--add-dir` folders: check whether Claude Code asks for those too; if it does, the trust setting should cover them (it marks every worktree already, so it may already be fine).
- Anything §43's list of proposals still has that fits a calm, effective UI (`docs/prompts/continue-calm-ui.md`).

Before calling anything done, verify it for real (a scripted walkthrough on the isolated server), and say what was only tried against stand-ins. End each piece of work with what I should check at VU.

Start by reading, then tell me what you'd pick up first and why, in a few lines, and go.
