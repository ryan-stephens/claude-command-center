# Build the Ticket Line

Paste this into a new Claude Code session opened in `D:\repos\cc-control`.

---

Read `docs/prompts/continue.md` first. It explains what cc-control is, where things are, and how to test without touching the owner's running app. Then read `docs/PLAN.md` §26, §27 and §28.

## The job
The owner chose a direction: the **Ticket Line** (PLAN §27). The spec is the clickable mock at `docs/futures/path-line.html`. Open it in a browser and drive it with the keys before designing anything. Work becomes cards on a board: Inbox → Plan → Build → Needs you → Try it → Ship → Done. Each card is a ticket (Jira or Trello) or a card with no ticket. A new-card screen builds the card's context, and the card follows a Claude Code session running in a terminal tab.

The owner likes the mock a lot. Keep its look, its words and its keys, including the legend bar and the `?` overlay, unless something can't be built as drawn. If so, say why.

## Milestone 1 is done (PLAN §28)
A card saves its context, makes its branch and starts `claude` in a Windows Terminal tab. The hook, loaded with `claude --settings`, fetches the packet and links the session. The board, drawer and new-card screen have a first version. Read §28 for the Claude Code facts it established. The `--add-dir` / `--` gotcha, trust prompts and inherited session markers will bite again. Carry on from **Then, in order** below, starting with the board.

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

**Then, in order:** the board and drawer over the existing session list → Jira/Trello import (read-only, tokens kept on the server) with a ticket-to-workspace mapping → adding context later (a UserPromptSubmit hook sends queued extras with the next message) → run recipes (Try it) → Ship (commit, `gh pr create`, Slack post). Add a PLAN section for each piece, in the same commit.

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
- Don't restart the owner's server on `:7777` or push to `origin` without asking.
- Commit in small conventional commits, staging named paths.
