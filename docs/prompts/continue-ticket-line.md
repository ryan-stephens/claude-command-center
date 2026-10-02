# Build the Ticket Line

Paste this into a new Claude Code session opened in `D:\repos\cc-control`.

---

Read `docs/prompts/continue.md` first. It explains what cc-control is, where things are, and how to test without touching the owner's running app. Then read `docs/PLAN.md` §26 to §31.

## The job
The owner chose a direction: the **Ticket Line** (PLAN §27). The spec is the clickable mock at `docs/futures/path-line.html`. Open it in a browser and drive it with the keys before designing anything. Work becomes cards on a board: Inbox → Plan → Build → Needs you → Try it → Ship → Done. Each card is a ticket (Jira or Trello) or a card with no ticket. A new-card screen builds the card's context, and the card follows a Claude Code session running in a terminal tab.

The owner likes the mock a lot. Keep its look, its words and its keys, including the legend bar and the `?` overlay, unless something can't be built as drawn. If so, say why.

## Where it stands: milestones 1 to 7 are done (PLAN §28–§34): the mock's loop is built
- **1 (§28):** a card saves its context, makes its branch and starts `claude` in a Windows Terminal tab. The hook, loaded with `claude --settings`, fetches the packet and links the session. Read §28 for the Claude Code facts it established: the `--add-dir` / `--` gotcha, trust prompts and inherited session markers will bite again.
- **2 (§29):** cards follow their session through async hooks (Plan ready, Needs you, Try it, steps, files changed).
- **3 (§30):** the line is the home page; Home is gone. Workspace keys (`W` `E` `+` `−` `F` `Shift+E` `Shift+I` `Shift+Delete`) work on the line and ask which workspace when All is showing. (An Unticketed row of sessions without a card was built, then removed at the owner's request: not every session belongs on the line; `Ctrl+K` finds them.) `Ctrl+Enter` opens a card's session full screen. The new-card screen chooses the model (`m`) and can keep a card's repo for the workspace (`w`).

- **4 (§31):** tickets from Jira and Trello (read-only, env-var tokens on the server) and a demo set in the real shape. The Inbox, `n` on a ticket, Tickets / Repos in panel 1, related tickets, the ticket layer, and `Shift+T` for sources and the project → workspace mapping. The Jira and Trello clients are tested against the APIs' JSON but **not yet against a live site**: when the owner sends the site URL, email and API token, try it and adjust `fromJira` / `splitAcceptance` as needed.

- **5 (§32):** adding context later. `c` in a card's drawer opens the new-card screen's add form (repos, related tickets, a note; Deliver "with your next message"); it waits on the card, the now-synchronous UserPromptSubmit hook hands it to Claude with the next message typed in the tab, and the Context tab's "Added since it started" shows waiting / delivered. `x` takes back the last waiting item. Delivery was proved with the real hook (a `claude -p --resume` with the card's variables and `--settings`), not by typing in a tab.

- **6 (§33):** run recipes. `t` on a card runs its home repo's recipe (detected from `package.json` / `compose.yaml` / a node server, or written with `e`) in the card's folder; a step that keeps running and serves is the app; `o` opens it, `t` again stops it. The recipe is in the workspace layer and under "Running the app" in the packet.

- **7 (§34):** Ship. `s` opens the sheet (commit, branch, the files with the card's own ticked, the PR written from the ticket); `Enter` makes a branch when on the default one, stages the ticked files by name, commits, pushes and runs `gh pr create`; the card goes to Ship and follows the PR through `gh pr view`; `s` again squash-merges it and the card goes to Done. Tested against a local bare origin and a stand-in `gh` (`CC_CONTROL_GH`); **a real `gh pr create` has not been run**, because it publishes: ask the owner which repo to try it on.

**Before adding any tracker, environment tool or code host, read PLAN §35:** teams differ (GitHub and Azure DevOps / TFS, Okteto backends with a UI proxy change, multi-repo workspaces), so each step stays one swappable module with workspace-level configuration.

- **VU readiness (§36):** `~/.cc-control/config.env` for settings and tokens, Windows' certificates trusted, `pnpm run doctor`; Jira Data Center (PAT, wiki markup, a criteria field); Ship to Azure DevOps Server / TFS through its REST API (the version probed), with GitHub kept on `gh` and other hosts pushed-only. Tested against a stand-in VU (`fake-vu.mjs` in the session scratchpad; the walkthrough is described in §36), not the real servers.

- **Workspace run recipes (§37):** a workspace can have its own recipe across its repos: `@repo` per step, `NAME=value` per step, `! by hand`, `stop:` teardown; `Alt+W` in the recipe editor; shared in the workspace file (imports marked to check first).

- **QA and code review cards (§40):**
  - A card has a kind: Develop, QA or Code review (`k`).
  - A QA card writes a test plan, sets up data from the workspace's *How this team tests* notes, walks the user through each check, and ends with a report.
  - A review card finds the ticket's PR (GitHub or Azure DevOps, read-only), starts on its branch in a detached worktree, and ends with findings.
  - Reports go on the card (`s` copies, `d` moves it to Done). Nothing is posted.
  - The Inbox has *Mine* and *Ready for QA* (`v`), `/` on the new-card screen searches Jira for anyone's ticket, and the *Folders* tab adds any folder.
  - **First things to try at VU:** does the Ready for QA view fill, does search find a teammate's ticket, and does a review find its TFS PR?

**Done (§42): Try it starts the whole stack**, built from the owner's answers to `docs/prompts/continue-try-it-stack.md`. **Next for it (2026-10-01): get the real stack running at VU** with `docs/prompts/continue-try-it-at-vu.md`, written to be lean on tokens there. §51 fixed the editor's made-up example (`orders-api`), which the owner's first try had saved. §52 added `wait:http:<port>/<path>` because the .NET API's logging hides Kestrel's "Now listening on" and `okteto up` opens the port early; check it at VU, then §52's *Not yet* list is what's next for the stack. §53: a *New worktree* card now gets a worktree of every repo on its branch, and Try it runs each API and the UI from them; its *Not yet* (Ship per repo, worktrees as the default, cleaning them up) is the natural follow-on. **Next, chosen by the owner (2026-10-01): a card as a unit of work** (§54), with worktrees the default, several cards runnable at once and a stack that needs no fiddling: `docs/prompts/continue-unit-of-work.md`. Milestone 1 (worktrees the way a card works: the default, `c` makes one, `Shift+X` removes them, the trust setting) milestone 2 (several cards up at once: ports picked per run, `forward:` on `okteto up`, `{{deployment}}`) milestone 3 (a stack read from the repos: `t` shows what was found, `Enter` keeps it) milestone 4 (Ship per repo: a block per changed repo, a PR each, merged together) and milestone 5 (a repo added with `c` joins the stack; notes feed the picker) are done. **Next: the *To check at VU* lists in §54**, and whatever the VU laptop hands back. Handoffs from the VU laptop follow `docs/prompts/vu-handoff-template.md`. Between handoffs, the list in `docs/prompts/continue-after-vu.md` (Ship after a part-way failure, the stack editor's table and `Shift+D` across every repo of a card (§56) are done; the `--add-dir` trust check is next).
- A workspace stack says how an API starts on Okteto, and `t` picks dev or uat and which APIs to run (the ones changed on the branch are ticked).
- The UI starts on a proxy copy pointed at the picked APIs, and stop tears them down.
- Tested against stand-ins only.

**Done (§62, 2026-10-01): the simple look's popup uses the page (two columns at a wide window), and the opening message comes from saved prompts** (`Space` on the block; `{{placeholders}}` filled from the card and following it; `s` saves a message as a prompt, `Shift+E` edits them; `shared/prompts.ts`, SQLite `prompts`, `web/components/PromptsDialog.tsx`). `w` has Claude write the message from rough words (`server/write-prompt.ts`, one Haiku turn, no tools, no settings loaded). Not built: versioning (after the MVP; `updatedAt` is kept).

**Done (§59, 2026-10-01): the simple look of the new-card screen**, direction A of the owner's redesign walk-through (one column: ticket, what Claude can see as chips, your note, one line on how it starts with the options behind it, Start). Built beside the full screen, not in its place: `Settings.newCardLook` (`?` `B`, `Shift+L` on the screen) picks; `web/components/NewCardSimple.tsx`, `web/simple-model.ts`, `web/simple-keys.ts`. **Next:** the owner's redesign continues from this screen (QA review and PR / code review flows are the other two workflows); the open card and the board are the next screens to strip back.

**Done (§43): a review before rollout** fixed the token leak into tabs and steps, the dev-origin hole, a dozen loop frictions (`d` done by hand, `o` opens the PR, `e` on the board, Esc fixes, column hints) and trimmed the busiest screens. §43 ends with ten proposals, the first (bring the card’s terminal tab forward from Needs you) the most valuable.

**Done (§44): type to the card's terminal from the page, and answer its prompts.** Claude Code's channels, with a launcher that presses through the development-channels confirmation. Proven live on this laptop. What's next for "leave the app less" is at the end of §44 (Jira comments and transitions, PR comments inline, builds from TFS).

**Next, chosen by the owner (2026-09-30): a calm, effective UI.** The handoff is `docs/prompts/continue-calm-ui.md`: key hints switchable off in settings, fewer things on screen, then the loop items that still leak out of the app, and the developer-experience list.

**Also: prove it at VU.** The owner pastes their stack in (`e`, `Alt+W` to the stack tab), runs `pnpm run doctor`, and tries `t`. The open points are in §42's *Not verified*:
- does `okteto up` run without a terminal;
- the real deployment name;
- does nx take `--proxyConfig`;
- the API ports.

Then comes opening a loan through the scenario tool (named in the workspace’s testing notes), in place of the `!` step.

**After that, ask the owner.** Everything planned for VU is built and tested against stand-ins; what's left needs the real VU servers (Jira Data Center, TFS, Okteto) or the owner's say. Candidates, none started: bringing VU's test tools into QA cards (the scenario generator as a recipe step or MCP tool, the hosted field tools as links or MCP servers per workspace, §40); posting review findings to the PR (asked first each time); builds and pipelines from TFS (§35); a real PR on a repo they choose; connecting their Jira (credentials pending); Slack posts from Ship; `f` feedback through the channel (a preview flag); the open questions below; polish from using it.

**Open questions for the owner** (asked at the end of milestones 3 and 5, not yet answered; they do not block run recipes or Ship): whether the drag-and-drop repo library strip should come back on the line, and whether the in-app new-session dialog (`Alt+Shift+N`) is still wanted. Jira credentials (site URL, email, API token) will come from the owner; when they do, try the live site and adjust `fromJira` / `splitAcceptance`.

## What milestone 1 was: a card that starts a terminal session with its context
This first milestone proves the mechanism end to end. Leave the board polish, Jira/Trello, run recipes and Ship for later.

1. **Check the Claude Code facts first.** Use the `claude-code-guide` agent or the docs:
   - that SessionStart and UserPromptSubmit hooks can return `additionalContext`, and in what shape
   - that hook processes inherit the `claude` process's environment (for `CC_CONTROL_CARD`)
   - what the hook's stdin gives you (`session_id`, `cwd`, `transcript_path`)
   - how hooks behave on Windows
   - that `--add-dir` and `--permission-mode` work alongside a prompt argument

   If any of this is wrong, stop and tell the owner before building around it.
2. **Server:**
   - Store cards and their context packets in `store.ts`, in SQLite. A packet has three layers: workspace (repos, notes, run recipe), ticket, and this card (extras plus your own note).
   - A packet-to-text function should produce what the mock's `p` preview shows.
   - Add loopback-only routes the hooks call: fetch a card's packet, and report "session X started for card Y".
3. **A hooks bridge:** a small Node script, `cc-control-hook`, for SessionStart. It reads stdin and `CC_CONTROL_CARD`, fetches the packet from `127.0.0.1:7777`, and prints the hook output.
   - It must be fast and safe everywhere. When `CC_CONTROL_CARD` is unset or the server is down, it exits at once with no output. Once installed in user settings, it runs for **every** Claude Code session on the machine.
   - **Ask the owner before changing `~/.claude/settings.json`.** Offer a one-key install and uninstall in the app, and show exactly what gets added.
4. **Start work:**
   - Create the branch or worktree.
   - Launch Windows Terminal: `wt -w 0 nt --title <KEY> -d <home repo> claude --permission-mode plan --add-dir … "<opening message>"`, with `CC_CONTROL_CARD` in the environment.
   - Link the card to the session id the hook reports. From then on, `mirror.ts` and the history index can follow the session.
5. **The UI for this milestone:** a first version of the new-card screen and the card's Context tab, matching the mock.
   - The new-card screen doesn't need Jira yet: title, workspace, repo library, your note, launch options, and the `p` preview.
   - The Context tab shows the start-up log and what Claude was given.
   - Add a key and a `?` row for every action.

**Then, in order:** ~~the board and drawer over the existing session list~~ (done, §29–§30) → ~~Jira/Trello import~~ (done against demo tickets, §31) (read-only, tokens kept on the server) with a ticket-to-workspace mapping → ~~adding context later~~ (done, §32) → ~~run recipes (Try it)~~ (done, §33) → ~~Ship~~ (done, §34; Slack later) (commit, `gh pr create`, Slack post). Add a PLAN section for each piece, in the same commit. **Since then (2026-09-30):** §43–§49 (review before rollout, the channel, key hints, g to the tab, Shift+D changes, the kept draft, Jira writes from the report sheet); what is next is at the top of `docs/prompts/continue-calm-ui.md`.

## The owner's answers (2026-09-29)
- **Hooks:** per launch with `claude --settings`. Nothing goes into `~/.claude/settings.json`. The UserPromptSubmit hook for adding context later goes in the same file (`writeHookSettings` in `server/cards.ts`).
- **In-app sessions:** terminal only at first. "In the app" is shown as later on the new-card screen.
- **Jira:** email plus API token. The owner doesn't have the site URL, token or project-to-workspace mapping to hand, so **build the import against mock tickets** with the real shape (key, title, description, acceptance criteria, comments, attachments, links) and ask for the credentials when it's time to connect a real site. Trello comes through the same import.
- **Slack:** later. Ship does commit, push and `gh pr create` first.

## Rules that matter here
- Local only (127.0.0.1). The hook routes are part of that too.
- Keyboard first with the keys visible: every action needs a key, a row in the legend and a row in `?`.
- Bump `PROTOCOL` in `shared/protocol.ts` when the page starts relying on new messages.
- Test on the isolated server (`:7788`) with Demo data. Launching a real terminal session counts as testing, so use a demo repo in `%TEMP%\cc-demo` and Haiku.
- Push verified work to `main` (the owner tests from a clone on the VU laptop). Don't restart a running server of theirs without asking.
- Commit in small conventional commits, staging named paths.
