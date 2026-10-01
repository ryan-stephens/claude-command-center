# Command Center for Claude Code

**A keyboard-driven cockpit for your Claude Code sessions.** Your work is a board of cards, the **Ticket Line**: each card gathers its context, starts Claude Code in a terminal tab, and moves by itself from Plan to Build to Try it as the session works. Group your repos into workspaces, see at a glance what needs you, and drive every session with the arrow keys, the number pad or your voice. Everything also works with a mouse.

![The Ticket Line: workspace chips and the workspace's repos along the top, the columns Inbox to Done with a card that needs you, and the keys that work right now along the bottom](docs/screenshots/line.png)

## Why

Running several Claude Code sessions across several repos means a lot of terminal-tab hunting: which one finished, which one is waiting on a permission prompt, which repo it was in, and typing the same "run the tests and summarise failures" prompt for the tenth time. Command Center puts all of it on one screen and makes the common moves single keystrokes.

- **Tickets in the Inbox.** Jira and Trello tickets (read-only; tokens stay on the server) land in the Inbox, each project mapped to a workspace. `n` on one opens the new-card screen with its description and acceptance criteria as the card's context, and the card is named after the ticket. Demo tickets let you try it before connecting a site.
- **The Ticket Line.** `c` makes a card: pick repos from your library, write a note, choose the model (`m`) and how it starts, and `p` previews exactly what Claude will be told. `Ctrl+Enter` makes the branch and opens `claude` in a Windows Terminal tab with that context. From then on the card follows its session: *Plan*, *Build*, amber in *Needs you* when it asks something, *Try it* when its turn ends with changes. `Ctrl+Enter` on a card opens its session full screen.
- **QA and code review, not only development.** `k` on the new-card screen makes a card *Develop*, *QA* or *Code review*. A QA card has Claude write a test plan from the ticket, set up the test data the way your workspace's testing notes say, walk you through each check and finish with a pass/fail report. A review card finds the ticket's pull request (GitHub or Azure DevOps, read-only), opens a copy of the repo on its branch, and reviews it against the ticket. Reports and findings stay on the card for you to copy (`s`); nothing is posted. `v` switches the Inbox to every ticket *Ready for QA* in your projects, and `/` on the new-card screen searches Jira for anyone's ticket.
- **Any folder as context.** Besides tickets and library repos, the new-card screen's *Folders* tab adds any folder on disk (specs, docs, a tool's install), given to Claude with `--add-dir`.
- **Try it.** `t` on a card runs its repo's recipe in the card's folder, detected from `package.json` or `compose.yaml` or written by you (`e`), and shows each step and where the app is; `o` opens it, `t` again stops it. A workspace can have its own recipe across its repos (`Alt+W` in the editor): `@api okteto deploy --wait`, `@web API_URL=https://… npm run dev`, `! something to do by hand`, `stop: @api okteto destroy`. Steps can also run in PowerShell (`ps:`), answer the questions they ask (`answers:"y,n"`), and say when they're ready (`wait:"Now listening on"`, `wait:port:8080`).
- **A stack of APIs and the UI.** When which APIs you need changes from card to card, give the workspace a stack (`e`, then `Alt+W` to the third tab). It holds how one API starts on your dev environment (`{{env}}`, `{{branch}}` and each API's values filled in), the APIs, the proxy rules each adds, and how the UI starts. `t` then asks dev or uat and which APIs to run. APIs changed on the card's branch are ticked for you. The picked APIs start, then the UI, with a copy of its proxy file pointed at them. The repo's file isn't touched. `t` again stops everything and runs the teardown steps. PLAN §42 has the format.
- **Ship.** `s` commits the files the card's session wrote (you tick any others, by name), pushes, and opens a PR written from the ticket, with its acceptance criteria as a checklist. The card follows the PR's reviews and checks, and `s` again squash-merges it.
- **Add context later.** `c` in a card's drawer adds a repo, a related ticket or a note to work already under way. It waits on the card and goes in with the next message you type in its terminal tab, and the card's Context tab shows what went in when.
- **Workspaces.** Group the repos you work on together ("Storefront", "Payments") and pick them with `1`–`9`. **Every card and session in a workspace can use all of its repos**, so Claude can change the API and the web app in one go. `+` adds a repo from your **repo library** (the git repos under folders you pick with `F`), `−` removes one.
- **Know who needs you.** Cards that need you turn amber, with a chime. `Ctrl+K` finds any session, with a card or without. `Alt+N` jumps to the next one that needs you from anywhere; `Y` / `A` / `N` answers.
- **Approvals you can judge.** "Claude wants to check app.js for syntax errors", rated *safe*, *makes changes* or *careful* (deletes files, pushes, installs…), with what it touches. The raw command sits behind `D`.
- **Follow along in plain words.** Claude's actions fold into readable steps ("Read index.html", "Changed src/app.js +3") with a real diff behind "See change", and a live line says what it's doing right now. `Esc` stops it, just like in the terminal.
- **Workflows on the number pad.** The pad on screen is drawn like the one under your hand; each key is a saved instruction such as "Run the tests" or "Commit my work". Workspaces come with starter workflows, and share them as a file.
- **Everything Claude Code does, at your fingertips.** Type `/` for commands and skills (`/cl` → `/clear`) and `@` for files in the repos Claude can use. `Shift+Tab` switches between *asks first*, *accepts edits*, *plan first* and *auto*, and a plan arrives as a card to approve. Commands with choices list them (`/model`, `/effort`, on/off), and Claude's questions and approvals are picked with the arrow keys and `Enter`, like Claude Code (or `1`–`4`, `Y`/`A`/`N`); and its to-do list ticks along above the message box. `↑` recalls earlier messages, and you can paste or drop images.
- **Keys you can see.** Every button shows its key, and a bar along the bottom lists the ones that work right now. `?` lists them all (and lets you rebind them); `Ctrl+K` searches everything.

| A session waiting for your OK | Dark theme | On a phone |
|---|---|---|
| ![A plain-language approval card with Y, A and N keys, beside the on-screen number pad](docs/screenshots/approval.png) | ![The Ticket Line in the dark theme](docs/screenshots/line-dark.png) | ![Phone layout of the Ticket Line](docs/screenshots/phone.png) |

## Quick start

You need **Node 24+**, **pnpm**, **git**, **Windows Terminal** and the **Claude Code CLI, signed in** (`gh` too, for repos on GitHub). Command Center runs on your existing Claude login; no API key needed. On a fresh Windows machine:

```powershell
winget install OpenJS.NodeJS.LTS Microsoft.WindowsTerminal Git.Git GitHub.cli
npm i -g pnpm @anthropic-ai/claude-code
claude              # sign in once, then exit
```

Then:

```sh
git clone https://github.com/ryan-stephens/claude-command-center.git
cd claude-command-center
pnpm install
pnpm run doctor     # checks this machine (plain `pnpm doctor` is pnpm's own check): Claude Code, Windows Terminal, git, settings, Jira, PR hosts, each workspace's recipe and stack
pnpm start          # builds the app and serves http://localhost:7777
```

**Behind a company proxy or an internal certificate authority**, `pnpm install` may fail with "fetch failed" or a certificate error before anything else can help. Run it as `$env:NODE_OPTIONS='--use-system-ca'; pnpm install` (the repo's `.npmrc` already stops pnpm fetching its own pinned version). The server itself trusts the certificates Windows trusts, so this is only for the install.

**The first card in a folder** stops in its terminal tab at Claude Code's "trust this folder?" question: answer it there, and the card carries on.

**Settings and tokens** go in `%USERPROFILE%\.cc-control\config.env`, one `NAME=value` per line; [`docs/config.env.example`](docs/config.env.example) lists them all. The certificates Windows trusts are trusted too, so company servers with an internal certificate authority (an on-prem Jira or TFS) work without extra setup. Run `pnpm run doctor` after changing settings: it signs in to Jira and reaches each workspace repo's PR host for real, and says what to fix.

Open **http://localhost:7777** in Chrome or Edge. A short tour shows the four groups of keys, then helps you pick your repo folder and make your first workspace. It follows your Windows light or dark setting (`Alt+T` switches).

## Setting up at a company

In order, once per machine. `pnpm run doctor` checks each step and says what to fix.

1. **Settings file:** `copy docs\config.env.example "%USERPROFILE%\.cc-control\config.env"`, then fill in the lines you need. Save it as UTF-8 (PowerShell 5's `Out-File` writes UTF-16, which doesn't read); put quotes round a value with `#` in it. The server reads it at start, so restart after changes. The tokens stay on the server: they never reach the page, a terminal tab, a Try it step or Claude.
2. **Jira:** Cloud needs `CC_CONTROL_JIRA_SITE`, `CC_CONTROL_JIRA_EMAIL` and an API token in `CC_CONTROL_JIRA_TOKEN`; Data Center needs the site (with its context path, `https://jira.company.local/jira`) and a personal access token. See [Connecting Jira…](#connecting-jira-trello-and-pull-request-hosts).
3. **Pull requests:** `CC_CONTROL_ADO_TOKEN` (a PAT with *Code: read & write*) for Azure DevOps / TFS; `gh auth login` for GitHub.
4. **Certificates:** nothing, usually. If doctor says "unable to get local issuer certificate", export the company root CA as PEM and set `CC_CONTROL_CA_FILE`.
5. **`pnpm run doctor`**, then `pnpm start`.
6. **A workspace** (`W`): the repos one piece of work spans. Then `Shift+T` to map each Jira project to it, so `n` on a ticket starts in the right repos. If a teammate already has one, import their workspace file with `Shift+I`: it brings the repos (matched by folder name), the notes for Claude, how the team tests, the run recipe and the stack.
7. **How the app runs for Try it:** `e` on a card. For one repo, the detected recipe is usually right. For a backend on a dev environment plus a UI pointed at it, `Alt+W` to *The workspace's stack*: the editor opens on a worked example, with one sentence per key under the box. Replace the example's team command with yours (the first step), fill in each API's name, folder, port and route, and the UI's proxy file. `pnpm run doctor` then checks every program the stack names.

If you don't write code: ask a developer to do steps 1 to 6 once on your machine (a QA card still needs the repo cloned and Claude Code signed in). You then press `n` on a ticket, `k` until it says QA, `Ctrl+Enter`, and answer Claude's questions with `Y` / `N` in its tab.

## Keys you'll use

| Where | Key | Does |
|---|---|---|
| Anywhere | `Alt+N` | Jump to the next session that needs you |
| | `Ctrl+K` | Search actions, workflows, workspaces and sessions |
| | `?` | Every key (`B` there to rebind) |
| | `Alt+↑` / `Alt+↓` | Previous / next session |
| | `Alt+L` (or click the logo) | Home: the Ticket Line board, from anywhere (a session, a card, the new-card screen, a dialog) |
| Ticket Line | `n` / `Enter` (a ticket in the Inbox) | Start work on it: the new-card screen with the ticket as context |
| | `v` | Inbox: your tickets, or every ticket *Ready for QA* in your projects |
| | `Shift+T` | Tickets: Jira and Trello status, demo tickets, which workspace each project goes to, and tickets you hid |
| | `Delete` (a ticket in the Inbox) | Hide it from the Inbox (nothing changes in Jira or Trello) |
| | `c` | New card: pick tickets (`/` searches Jira for anyone's), repos or any folder, write a note, `k` the kind (Develop, QA, Code review), `m` the model, `p` previews what Claude gets, `Ctrl+Enter` starts it in a terminal tab |
| | `← → ↑ ↓` / `Enter` | Move between cards / open one full screen: Overview or Context (`Tab`; how it started, what Claude was given) beside its live transcript; `←` / `→` the previous / next card; `Esc` back to the board |
| | `t` / `o` (a card) | Try it: run its repo's recipe in the card's folder / open the app (`t` again stops it). With a workspace stack, `t` first asks the environment (`←` `→`) and which APIs to run (`↑` `↓` `Space`, `Enter` starts) |
| | `e` (a card) | Write or edit the run recipe: for the card's repo, the whole workspace, or the workspace's stack (`Alt+W`) |
| | `s` (a card) | Ship: commit the ticked files, push, open a PR from the ticket (`gh`); on a card in Ship, merge it. On a QA or review card: its report, `Enter` copies it, `o` opens the PR, `d` moves the card to Done |
| | `d` (a card in Ship) | Done by hand: the PR was merged or closed elsewhere, or the host isn't one Ship can follow |
| | `o` (a card) | The app its run is serving; with nothing running, its pull request |
| | `Delete` | Take the card off the line (its terminal session keeps running); on a ticket in the Inbox, hide it |
| | `c` (card open) | Add context to it: it waits on the card and goes in with your next message in its tab (`x` takes back the last one still waiting) |
| | `Ctrl+Enter` | The card's session in the app, to read along (`Esc`: back to the line). Answer Claude in its terminal tab; sending from the app forks the session |
| | `1`–`9` / `0` | One workspace / all of them |
| | `/` | Filter the cards by words |
| | `W` / `E` / `Shift+Delete` | New workspace / edit / delete the one shown (with *All* showing, it asks which). `e` with no card focused also edits |
| | `+` / `−` | Add a repo from the library to the workspace / remove one |
| | `F` | Pick the folders the repo library lists: walk the disk with `↑ ↓ → ←`, `Space` uses the folder you're in |
| | `Alt+Shift+N` | New session in the app, without a card |
| Pickers | `Ctrl+O` | Browse to any folder (new session, add a repo) |
| Session | `Numpad 1–9` / `Alt+1–9` | Run a workflow |
| | `Y` / `A` / `N` | Allow once / always / don't allow (`Tab` first if you're in the message box) |
| | Hold `` ` `` | Push-to-talk |
| | `Esc` (while working) | Stop Claude |
| | `+` / `−` | Give this session another repo / take one back out |
| | `Ctrl+B` | Send the running step to the background |
| | `C` (number pad) | Fold the number pad away; `Tab` still opens it |
| | `/` (start of a message) | Suggests commands and skills as you type, like Claude Code (`/cl` → `/clear`): `↑ ↓` `Tab` `Enter` `Esc` |

## Connecting Jira, Trello and pull-request hosts

Put these in `config.env` (or set them where you start the server), then restart it. The tokens never leave the server, and nothing is written back to the trackers.

| Source | Variables |
|---|---|
| Jira Data Center / Server | `CC_CONTROL_JIRA_SITE` (`https://jira.company.local`, with any context path), `CC_CONTROL_JIRA_TOKEN` (a personal access token) |
| Jira Cloud | `CC_CONTROL_JIRA_SITE` (`https://you.atlassian.net`), `CC_CONTROL_JIRA_EMAIL`, `CC_CONTROL_JIRA_TOKEN` (an [API token](https://id.atlassian.com/manage-profile/security/api-tokens)) |
| Jira, both | optional `CC_CONTROL_JIRA_JQL` (the Inbox's *Mine*; default: assigned to you, not done), `CC_CONTROL_JIRA_QA_JQL` (its *Ready for QA*; default: that status in the projects your tickets are in; `off` for none), `CC_CONTROL_JIRA_AC_FIELD` (a custom field holding the acceptance criteria) |
| Trello | `CC_CONTROL_TRELLO_KEY`, `CC_CONTROL_TRELLO_TOKEN`, `CC_CONTROL_TRELLO_BOARDS` (board ids, comma-separated) |

Then `Shift+T` on the line shows whether each is connected, and maps each project or board to a workspace. Acceptance criteria come from an "Acceptance criteria" (or "Done when") section in a Jira description (rich text on Cloud, wiki markup such as `h3. Acceptance Criteria` and `# item` on Data Center), the field `CC_CONTROL_JIRA_AC_FIELD` names, or a checklist of that name on a Trello card.

**Where Ship opens pull requests** is read from each repo's `origin`: GitHub remotes use the `gh` CLI (run `gh auth login` once); Azure DevOps remotes (dev.azure.com, `*.visualstudio.com`, or an on-prem server such as `https://tfs.company.local/tfs/DefaultCollection/Project/_git/Repo`) use the REST API with `CC_CONTROL_ADO_TOKEN`, a personal access token with *Code: read & write*. The API version an on-prem server speaks is found on the first request. Other hosts get as far as the push, and the sheet says so.

## Sharing with your team

**A whole workspace:** on the Ticket Line, show it (`1`–`9`) and press `Shift+E` (or *Export* in its editor). The file lists its repos by folder name and carries its workflows, its run recipe, its stack and its notes (*Notes for Claude*, which every card starts with, and *How this team tests*, which QA cards start with: where test data comes from and how to set it up); a teammate imports it with `Shift+I`, and it matches the names against their own repo library.

**Per-repo workflows:** put a pack at `.cc-control/commands.json` in any repo, and everyone who opens a session there gets the same keys:

```json
{
  "version": 1,
  "groups": [
    {
      "name": "Web app",
      "commands": [
        { "slot": 1, "label": "Dev server", "body": "Start the dev server and tell me the URL.", "mode": "send" },
        { "slot": 3, "label": "Add a test for…", "body": "Add a unit test covering {{behaviour}}.", "mode": "template" }
      ]
    }
  ]
}
```

Your own workflows live in a local SQLite file and export or import as the same JSON (`Shift+E` / `Shift+I` on the number pad). To make or change a key, focus it and press `E`.

## How it works

```
Browser (React + Vite)  ⇄  WebSocket  ⇄  Node server on 127.0.0.1:7777
                                           ├─ one Claude Agent SDK session per live conversation
                                           ├─ approvals held until you answer Y / A / N
                                           ├─ history from ~/.claude/projects (resume or fork any session)
                                           ├─ repo library: git repos under the folders you pick
                                           ├─ node:sqlite for workspaces, workflows, settings and cards
                                           └─ /hooks/SessionStart: where a card's terminal session fetches its context
```

- Built on [`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk). Sessions are real Claude Code sessions stored alongside your terminal ones: every terminal session is listed here and can be continued, and anything started here can be continued in a terminal with `claude --resume <id>`.
- Extra repos use the SDK's `additionalDirectories`. Adding one to a running session restarts it in place, keeping the conversation.
- If a session looks open in a terminal, sending to it **forks** a copy instead of writing into the same transcript.
- **Ticket Line cards** start `claude` in a Windows Terminal tab (`wt`) with `--settings` pointing at cc-control's own hook file, so nothing is added to your Claude Code settings and other sessions never run it. The tab's SessionStart hook (`hooks/cc-control-hook.mjs`) fetches the card's context from `127.0.0.1` with a per-card token, returns it as `additionalContext`, and links the session to the card. Without the card's variables, or with the server down, the hook exits silently. Its other hooks run async and move the card as the session works: Plan ready, Needs you, Try it, with its steps and the files it changed.
- Voice uses the browser's Web Speech API (Chrome and Edge send the audio to Google's speech service).
- **Where state lives:** `%USERPROFILE%\.cc-control\` holds `config.env` (settings and tokens), `cc-control.db` (workspaces, cards, recipes, stacks: delete it to start over), `claude-hooks.json` (the hook file cards start with) and `runs\` (proxy files Try it writes, and backups of ones it changed in place).

**Security:** the server only listens on `127.0.0.1` and only accepts pages it served itself (Host and Origin checks). It can run tools on your machine, so treat it like a terminal and don't expose it to a network.

## Development

```sh
pnpm dev        # server with --watch + Vite on http://localhost:5173
pnpm test       # unit tests (node:test)
pnpm typecheck
```

| Path | What |
|---|---|
| `server/` | Node server, run as TypeScript directly (Node 24 type stripping, no build step) |
| `web/` | React SPA; `web/keys.ts` is the single keyboard router, `web/plain.ts` all the plain-language wording |
| `shared/` | WebSocket message types and the workspace logic both sides use |
| `docs/PLAN.md` | Design, decisions and per-phase notes; `docs/UX-AUDIT.md` and `docs/design-*.html` for the redesign |

<details>
<summary>Advanced: using it from your phone over Tailscale</summary>

Optional and off by default. With [Tailscale](https://tailscale.com) on this machine and your phone:

```sh
pnpm start -- --remote                  # also listens on this machine's Tailscale IP only
pnpm start -- --remote --rotate-token   # revoke the previous sign-in link
```

It prints a one-time sign-in link containing a secret token; open it on your phone and treat it like a password. See `docs/PLAN.md` §14 for the details.
</details>
