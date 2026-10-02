# Get Try it running the real stack at VU

Paste this into a new Claude Code session on the **VU work laptop**, opened in the cc-control clone, after `git pull`.

---

You're helping the owner get **Try it** (`t` on a card) in **cc-control** to bring up their real local stack at Veterans United:
1. Their API on **Okteto**, against **dev** (the default) or **uat**.
2. Their **UI** dev server, with its **proxy.conf** pointed at that API.
3. Then they **open a loan** against the local UI and test.

cc-control is a local web app over Claude Code terminal sessions (the Ticket Line board). The feature already exists: a workspace **stack** (PLAN §42). It was built and tested on the owner's personal laptop against stand-in scripts only. This session is its first contact with the real Okteto, the real repos and the real proxy file. Expect to fix the owner's stack settings first, and the app's code second.

## Tokens are tight on this machine (enterprise billing)
- **Read only what this job needs**, nothing else:
  - `CLAUDE.md`
  - `docs/PLAN.md` §42 (the stack) and §51 (the editor's draft)
  - `shared/stack.ts`, plus `shared/recipes.ts` for the step syntax (`ps:`, `wait:`, `answers:`, `@repo`, `stop:`)
  - `server/stack.ts` only if a run misbehaves
- **Don't read the whole PLAN or the other handoffs**, and don't run Playwright walkthroughs here. The owner tests by pressing keys; ask them what the screen says.
- **Bigger code changes** (new step types, new UI) can be built on the owner's personal laptop instead. Write down what's needed (see the end) rather than building it here, unless it's a small fix that unblocks the run.

## Facts
- **Settings and tokens** are in `%USERPROFILE%\.cc-control\config.env`. **`pnpm run doctor`** checks the machine, and it has a section per stack: the programs the steps use, PowerShell commands through the profile, `okteto context show`, where each repo is, duplicate ports, and whether the proxy file reads. It runs none of the steps.
- **Server log:** `%USERPROFILE%\.cc-control\server.log`. The owner's server runs on :7777. **Ask before restarting it.** It needs a restart after `git pull` (server code changed).
- **Since 2026-10-02 (§82, §83): Try it is a list of services, and the stack is a form.** On an open card, `Shift+T` opens the Try it panel: the environment, each API with a tick, the UI; `t` starts every ticked service at once (each its own run on its own port), `r` starts the highlighted one (again) while the rest keep running, `q` stops one alone. `e` opens *Set up the stack*: the environments, the UI (repo, proxy file, start line), each API (name, container port, project folder, health path, route), and *How an API starts on the dev environment* as three answers (the command that makes the deployment and what it asks, what runs inside the container, a kubeconfig per environment, what to delete on stop); the step lines are written from them and can be edited by hand under *The step lines*. The JSON below is what the form saves; the old JSON tab is gone.
- **The stack is JSON underneath** (what the form writes):
  - `choose`: `{ "env": ["dev", "uat"] }`; the first value is the default, and `t` asks every time.
  - `api.steps`: how *one* API starts, run in that API's repo, with `{{env}}` (and `{{ENV}}`, upper case), `{{branch}}` (the API repo's branch, made Kubernetes-safe), `{{deployment}}` (`name-branch` cut to 50 characters, as the helper cuts it) and the API's own `values` (`{{name}}`, `{{dir}}`, `{{appPort}}` …) filled in. Add `stop:` lines for teardown.
  - **`{{port}}` is picked per run** (§54): each API gets a free local port from `CC_CONTROL_PORTS` (18000–18999 by default), and the UI gets `{{uiPort}}`, so two cards can run the same stack at once. `{{appPort}}` is the port the API listens on in its container (8080 here); an old `"port"` value is read as that.
  - `api.proxy`: proxy rules each picked API adds (`http://localhost:{{port}}`).
  - `apis`: `[{ "repo": "<folder name>", "values": { "name", "dir", "appPort", "route" } }]`.
  - `ui`: `{ "repo", "proxyFile", "steps", "url" }`. The UI starts with `{{proxy}}`, a **copy** of the proxy file with the picked APIs' rules first, so the repo's file is never changed, and with `--port {{uiPort}}`; `url` is `http://localhost:{{uiPort}}`. `"proxyMode": "edit"` changes the file in place and restores it on stop, if the dev server can't take another path.
  - Personal values (a kubeconfig per environment) go in `config.env` and reach steps as `%NAME%`: `KUBECONFIG=%KUBECONFIG_{{ENV}}%` before the command, with `KUBECONFIG_DEV=…` and `KUBECONFIG_UAT=…` in the file.
- **Step prefixes:**
  - `ps:` runs in PowerShell, with the profile loaded
  - `answers:"y,n"` answers the step's questions
  - `wait:"Now listening on"`, `wait:port:8080` or `wait:http:8080/self` says when a long-running step is ready. Use `wait:http:` for `dotnet watch run` behind `okteto up`: the app's logging can hide "Now listening on", and okteto opens the port before the app is up (§52)
  - **The `okteto up` line forwards the picked port on its own** (since 2026-10-01; it must come after the step that writes `okteto.yml`): cc-control copies the manifest to `okteto.cc-control.yml` with that forward's local side set to the picked port, lists the copy in `.git/info/exclude`, and runs `okteto up -f okteto.cc-control.yml`, also when the command sits after a `;` in a PowerShell line. The copy goes when the run stops. `forward:{{port}}:{{appPort}}` written on the line means the same; `forward:no` keeps the manifest's own forward (then `okteto up` forwards 8080 and a second card's run can't get it; the editor and `pnpm run doctor` say so).
  - `! …` is a step done by hand (shown, not run), which suits "open a loan" for now
- **The known problem the owner hit:** `t` listed **orders-api**, a repo they don't have. That came from the editor's old example, saved unchanged. Since §51:
  - the editor warns about repos the workspace doesn't have
  - saving refuses them
  - the picker says the stack is still the example
  - **Fix:** `e`, `Alt+W` to the stack tab, empty the box, save, then `e` again. The editor then offers a draft built from the workspace's own repos.

## How to go about it
1. **Find out which machine you're on**, and confirm the pull and restart happened. Then have the owner run `pnpm run doctor`, and read its Jira, workspace and stack sections.
2. **Ask the owner for these, using placeholders for anything internal:**
   - the UI and API repo folder names; whether both are in one cc-control workspace
   - how one API is started today with Okteto: the commands in order, which folder, how dev vs uat is chosen, and what tells them it's ready (a port, a log line)
   - the proxy file's path, and a sanitised before/after of the entry that changes
   - the UI's start command and port, and anything it needs first (`NODE_OPTIONS=--use-system-ca` fixed npm's certificate errors)
   - what they do afterwards: `okteto down`, or leave it up
   - how they open a loan against the local UI (for now an `!` step that says what to do)
3. **Let `t` write the stack** (§54): on a card in a workspace of several repos with no stack, `t` reads the repos and shows what it found (the API's okteto.yml, its .csproj folder, a health route, the UI's serve target, the proxy file's rule per API), with assumptions marked `?`; `Enter` keeps it as the workspace's stack. Then `e`, `Alt+W` to the stack tab, and add what only the team knows: the helper step first in `api.steps`, `KUBECONFIG=%KUBECONFIG_{{ENV}}%` where needed. Saving checks it and says what's wrong. Only if nothing was found, write the JSON with them.
4. **Have them press `t`** on a card in that workspace: pick dev, tick the API, `Enter`. The card's Try it section shows each step, its state and the last lines of output; its title says the ports picked (`loans-api :18000 · UI :18001`). Fix the stack until the API is ready and the UI serves through the proxy copy. Then check `o` opens the UI and calls reach the API. **Then a second card** on the same stack while the first is up: it should get the next ports, its own deployment (the branch differs) and its own `okteto up -f okteto.cc-control.yml`; check `okteto up -f` keeps the sync folder and that the namespace allows two deployments of one API.
5. **Fix code only where the app is wrong.** Examples: a step type that's missing, readiness that never fires, a proxy merge that's wrong for their file. Then:
   - run `pnpm typecheck` and `pnpm test`
   - add a PLAN section in the same commit
   - use a conventional commit, staging named paths (never `git add -A`)
   - push to main
6. **Write down what's left** for the personal laptop: a "Not yet" list in a new PLAN section or in `docs/prompts/continue-ticket-line.md`. Candidates: opening the loan through the scenario tool, passing a value one step prints into a later step, more APIs or projects.

## Rules
- **Never commit** tokens, VU code, VU URLs, proxy entries, ticket contents or VU-internal tool names. The real stack JSON lives in the app (and in a shared workspace file if the team wants one), never in the repo. Examples in code and docs use made-up names.
- **Ask first before:**
  - restarting the owner's server
  - anything that writes to Jira or TFS
  - changing global npm, pnpm or git config
  - running Okteto or kubectl commands yourself that create, deploy or destroy anything. The owner pressing `t` runs the stack's own steps; that's their call.
- **Keyboard first, with the keys visible:** any new UI action needs a key, a legend entry and a row in `?`. The server binds to 127.0.0.1 only. Files are CRLF. Node 24 and pnpm.
- **Report plainly** what worked against the real Okteto and what didn't.
