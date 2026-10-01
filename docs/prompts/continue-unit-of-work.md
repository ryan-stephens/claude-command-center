# A card is a unit of work: worktrees for everything, a stack that needs no fiddling, several cards up at once

Paste this into a new Claude Code session opened in `D:\repos\cc-control`.

---

You're continuing development of cc-control ("Command Center", GitHub `ryan-stephens/claude-command-center`): a local web app that sits on top of Claude Code terminal sessions. Its home page is the Ticket Line, a board of tickets moving through Inbox → Plan → Build → Needs you → Try it → Ship → Done, each card following a Claude Code session in a Windows Terminal tab. I use it for everyday work at Veterans United (VU) and want to roll it out to coworkers, so keep it simple enough for non-developers, fast for experienced developers, and flexible about how different teams work.

Where things run:
- All development happens on this laptop: my personal laptop, `D:\repos\cc-control`. Check the hostname and repo path to confirm.
- My VU work laptop can't push to GitHub. It only tries things and sends me handoff prompts (`docs/prompts/vu-handoff-template.md`).
- Other sessions may be working in this repo at the same time: `git pull` before you start and before every commit; stage named paths only; if a test port (:7788) is taken, use another one, and don't stop servers you didn't start. My own app runs on :7777; ask before restarting it.

Read before changing anything:
- `CLAUDE.md`: the project rules.
- `docs/prompts/continue.md`: how the code is laid out, how to test on an isolated server without touching my app, and the machine facts.
- `docs/prompts/continue-ticket-line.md`: what the line does and where it stands.
- `docs/PLAN.md`: a numbered section per change. Don't read it all. Read §42 (the stack), §51 (the stack editor's draft), §52 (`wait:http:`) and §53 (worktrees of every repo), and skim §35 (keep trackers, dev environments and code hosts swappable).

How we work:
- Push verified work straight to main; no need to ask. "Verified" means `pnpm typecheck` and `pnpm test` pass, `npx tsc --noEmit --noUnusedLocals -p .` now and then, and for UI changes a scripted Playwright walkthrough on an isolated server with screenshots you actually look at. Report plainly what passed, what didn't, and what was only tried against stand-ins.
- Every change gets a PLAN section in the same commit, and a README update when it's user-facing. Keep `continue-ticket-line.md` pointing at what's next.
- Conventional commits. Node 24 and pnpm; files are CRLF.
- Ask first before: restarting a server I'm running; anything that writes to Jira or TFS; changing global npm, pnpm or git config.
- Never commit tokens, VU code, VU URLs, proxy entries, ticket contents or VU-internal tool names.
- Keyboard first, with the keys visible: every action needs a key, a legend entry and a row in the `?` overlay. Local only: the server binds to 127.0.0.1.

Lessons from earlier sessions:
- A zustand selector that returns a new array or object re-renders forever (React error #185). Select the stored value and derive outside the selector, or use a stable empty constant.
- Don't trim `git status --porcelain` output: its leading spaces are part of the format.
- The Bash tool's heredocs and `sed` mangle backslashes and regexes. Write edit scripts and tests with the Write tool, or use Edit.
- Playwright: `press('?')` doesn't open help; use Shift+Slash. Check for `[role=dialog]`, not page text.
- A card started in a folder Claude Code hasn't trusted (any new worktree) stops at the trust prompt in its tab, unless the *Trust a card's new worktrees* setting (`?` `B`) is on.
- Process kills of terminal tabs from tests are blocked. Tell me which tabs to close.
- Cards without a `sessionId` hide the Try it section; seed test cards with one.

## Where this stands (2026-10-01)
- §42: a workspace **stack** says how one API starts on Okteto and how the UI starts on a proxy copy; `t` picks the env and the APIs (changed ones ticked).
- §52: `wait:http:<port>/<path>` marks a step ready when its address answers below 500 (Kestrel's "Now listening on" can be hidden by the app's logging, and `okteto up` opens the port early).
- §53: a *New worktree* card gets a worktree of **every** repo in its context on the card's branch (`loans-api` → `loans-api-card-4`), Claude gets them with `--add-dir`, and Try it, the picker and `{{branch}}` use them. Ship is still one repo (the home repo's worktree).
- §54 milestone 1 (done 2026-10-01): worktrees are the Develop default; `c` with a repo makes a worktree on the card's branch; `Shift+X` (and `w` in the Delete dialog) removes a card's worktrees and branch, never silently; a setting marks new worktrees trusted in `~/.claude.json`.
- §54 milestone 2 (done 2026-10-01): ports are picked per run from `CC_CONTROL_PORTS` (`{{port}}` per API, `{{uiPort}}`), `{{appPort}}` is the container port, `{{deployment}}` the cut name, `{{ENV}}` upper case; `forward:{{port}}:{{appPort}}` on the `okteto up` line runs it with a copy of the manifest; the editor and the doctor warn about a stack that can't run twice. **Milestone 3 is next:** a stack that needs no fiddling (detect from `okteto.yml`, `angular.json` / `project.json` / `package.json` and the proxy file; the editor as a confirmation; personal values in `config.env`).

## The goal
Make a **card a unit of work**: one ticket (usually Jira, not always) that may touch the UI, one or more APIs and anything else, all worked on in that card's own worktrees so several cards can be in flight without getting in each other's way, and all spun up locally from those worktrees so **several cards can be tried at once** even when they share the same UI and APIs. And make spinning up a local environment need as little setup as possible: nobody should be editing stack settings often.

My words: "when a card is created, it gets set up with the relevant context and repos that we know of at that time. We should be able to add context later and still have that be included in the available options to spin up in the stack… we should be working extremely hard to reduce the complexity necessary for anyone to spin up a local dev environment, they shouldn't need to be changing any stack settings/configs frequently… all changes should be appropriately changed in worktrees so that we can work on them independently… we should be able to run multiple versions of the UI/APIs so that we can have multiple cards being tested at once which rely on the same ui/api but a different worktree… keeping our user experience extremely high and complexity as low as possible for end users."

## How to go about it
First, lay the plan out as a PLAN section (§54) with milestones, and talk it through with me before building: what each milestone changes for a user, what it costs (disk, install time, ports), and what it depends on at VU. Then build milestone by milestone, each its own commit with its own verification. My suggested order:

1. **Worktrees are the way a card works, not an option.** Make *New worktree of each repo* the default for Develop cards (keep *Current branch* for QA/review and for a quick look). A repo added later with `c` gets a worktree on the card's branch too, and it shows up in the `t` picker. When a card is removed or reaches Done, offer to remove its worktrees and branches (a key, a legend entry, a `?` row; never silent). Say the costs in the UI once, plainly: first `npm install`, the trust prompt.
2. **Several cards up at once.** Ports are assigned per run, not written in the stack: each API's `{{port}}` and the UI's port come from a free range cc-control picks, the proxy copy points at the picked ports, `okteto up` is told the local port (check how: a flag, or a per-card okteto manifest copy), and the card's Try it shows its own URL. Two cards running the same API get two forwards. Watch for the Okteto deployment name too: it comes from `{{branch}}`, so different cards already differ. Test with two seeded cards on the same stack running at once.
3. **A stack that needs no fiddling.** Detect what can be detected instead of asking for it: each API repo's `okteto.yml` (its name, forwarded port, the command), the UI's `proxy.conf.json` and its dev-server command from `package.json` or `angular.json` / `project.json`, the health path from the API's routes if obvious. The stack editor becomes a confirmation of what was found, with the few things that can't be detected (the env list, the proxy route per API) asked once per workspace. A per-developer file (`CLAUDE.local.md`-style, ignored by git, e.g. `~/.cc-control/config.env`) holds anything personal, such as the kubeconfig path, so the shared stack has nothing machine-specific in it.
4. **Ship per repo.** A card that changed several repos ships each: one commit, push and PR per repo from its worktree, the sheet showing them together, the PRs linked on the card. Keep GitHub on `gh` and Azure DevOps on its REST API as today (§36).
5. **Context added later feeds the run.** Anything added with `c` (a repo, a note naming an API) updates what `t` suggests, and the packet text says what is runnable now.

Keep each piece swappable (§35): Okteto is one way to run an API; a plain `dotnet run` or `docker compose` recipe must still work.

Before calling something done, verify it for real (a scripted walkthrough on the isolated server), and say what was only tried against stand-ins. The real Okteto, kubectl and the team's tooling are on the VU laptop; write what I should check there in a short "To check at VU" list at the end of each PLAN section.

Start by reading. §54 is written and agreed, and milestones 1 and 2 are built: carry on with milestone 3 as §54 lays it out (ask the owner for sanitised copies of an `okteto.yml`, the UI's serve target and the proxy file if none are in the repo yet; stand-ins otherwise).
