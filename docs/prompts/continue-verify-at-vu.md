# Try the Verify panel against the real tools at VU

Paste this into a new Claude Code session on the **VU work laptop**, opened in the cc-control clone.

---

You're helping the owner try the **Verify panel** in **cc-control** against the team's real tools. cc-control is a local web app over Claude Code sessions (the Ticket Line board: a card per ticket, its session in the card, panels beside the chat). Verify (`v` on an open card) was built on the owner's personal laptop and tested there only against made-up stand-ins. Since §132 to §134 it has **a tab per tool** (`Alt+←` / `Alt+→`), and this session is the first contact of that version with the real hosts.

The tools, as the code and PLAN call them (their real names are in this machine's Verify file, never in the repo):
- **Test data** (§133): the owner's scenario runner, an ASP.NET API plus a web UI, both on this machine. Verify lists its scenarios (`GET api/scenarios`), starts a run (`POST api/scenarios/{id}/versions/{n}/runs` with exactly `{ "environment": "dev" | "uat" }`), and reads the run (`GET api/runs/{runId}`). Nothing else. **A run creates real test loans in Dev or UAT.**
- **The record lookup** (§105, §132, §134): one host for every environment, an MVC form. Verify posts the fetch form (Environment, the record id field, AdvancedFetch, FieldsToFetch) and reads `table#FieldResults`. With updates switched on in the file, it can also post the page's **update form** (Dev and UAT only); never the role or move forms.
- **The field set tool** (§105): a host per environment. Unchanged by this work: read only (`GET <base>/Home/SetVersion`, `GET <base>/Home/ValidateField?<idParam>=<id>`).

## This laptop doesn't edit or commit
See `CLAUDE.md`, *Two laptops*: development happens on the personal laptop only. Here you **diagnose and write a handoff** in the shape of `docs/prompts/vu-handoff-template.md`. Don't change code or commit, even for a one-line fix: describe it instead.

## Tokens are tight on this machine
- Read only: `CLAUDE.md`; `docs/PLAN.md` §132, §133, §134 (search for `## 132.`; don't read the whole file; §105 and §107 only if you need the older background); `docs/prompts/vu-handoff-template.md`.
- Open `server/verify.ts` (the guard, the lookup, the parser), `server/verify-update.ts` (the update form, sessions, the success reader) or `server/verify-builder.ts` (the scenario runner) only when something fails and you need to know why.
- Don't run Playwright walkthroughs here. The owner presses the keys; ask what the screen says.

## Facts
- **The Verify file:** `%USERPROFILE%\.cc-control\verify.json` (or the file `CC_CONTROL_VERIFY_FILE` names). It holds the real addresses, so it never goes in the repo or the handoff. Its shape now:
  `{ "set": { "name", "urls": { "dev", "uat" }, "addPage", "idParam"?, "idKey"? }, "lookup": { "name", "url", "page", "recordField", "updateUrl", "allowUpdate", "updateFields", "envValues"?, "auth"? }, "builder": { "name", "url", "ui", "start" } }`.
  - `lookup.url` is where the fetch form **posts**; `lookup.page` is the page you open in the browser (`o` in the lookup, `Shift+L` anywhere).
  - `lookup.updateUrl` is the update form's action address (same host as `url`, or it is dropped). `lookup.allowUpdate` must be the literal `true` for updates; anything else is off. `lookup.updateFields` names the update form's other plain hidden fields (the record's number and folder): an update sends no name it isn't told of, and if the form has one it doesn't know, the lookup says so and sends nothing.
  - `builder.url` is the scenario runner's API base and **must be localhost, 127.0.0.1 or [::1]**, or it is ignored. `builder.ui` is its web UI (`o` in Test data). `builder.start` is a hint shown when it isn't running; it is never run.
  - The server reads the file again within 3 s of a change: **no restart for edits to it.**
- **Saved field lists:** `%USERPROFILE%\.cc-control\field-lists.json`, written only by the lookup's *Save as list* (`Shift+S`) and *Delete list* (`Shift+F` twice).
- **The guard** (`server/verify.ts`): three allowlists. Reads (the set tool's two GETs, the lookup's fetch POST); the scenario runner's three calls on its loopback base; and one write: a POST to exactly `updateUrl`, only with `allowUpdate`, only with the update form's names. Anything else throws (*Verify refused a request*) before it leaves the machine. Redirects aren't followed.
- **An update is asynchronous.** Success means the tool said *sent* (its SuccessMessage paragraph, with the count sent), not *applied*. The page then fetches the changed rows every 10 s for 3 minutes and marks each pending, applied or differs. `w` opens the tool's progress page (Pending, Completed, Failed); the app never calls that page's API host.
- **Keys** (the legend and `?` list them): `Alt+←` `→` tabs; `e` Dev / UAT; `Shift+P` twice Prod (not in Test data). Lookup: `l` record, `i` fields, `Enter`, `a` Advanced, `f` list, `Shift+S` save list, `Shift+F` delete list, `/` filter, `Shift+M` only empty or missing, `Shift+Y` copy, `o` its page; with updates on: `↑ ↓` row, `u` edit, `z` take back, `Backspace` clear, `Shift+U` twice send, `w` progress page. Test data: `↑ ↓`, `/`, `r`, `Enter` twice, `f` fetch the loan in the lookup, `Shift+Y` copy, `o`. The handoff's `m`, `c`, `s`, `x` and `Shift+X` were already the card's (More, add context, ship, take back, worktrees), so the shifted keys and `z` / `Backspace` stand in.
- **Server log:** `%USERPROFILE%\.cc-control\server.log`. The owner's server runs on :7777. **Ask before restarting it.** A restart stops the sessions the app runs; stop any Try it apps first (`t` on their cards).

## How to check it
1. **The code and the server.** `git pull`, then `git log --oneline -4` should show the §132, §133 and §134 commits. **Ask before restarting** the server on :7777 (server code changed), and stop any Try it apps first. The way it's been restarted is in `docs/prompts/continue.md`, *How to work here*.
2. **The Verify file.** The owner adds the new keys (`lookup.page`, `builder`, `lookup.updateUrl`, `lookup.allowUpdate`, `lookup.updateFields`) and runs `pnpm run doctor`. Its *Settings* section should show the test-data tool's line, no warning about the lookup's `recordField`, and *updates: on, for Dev and UAT only*. A warning about `updateFields` means the record's number and folder field names are still missing: find them in the page source of a fetched record's update form (the `<input type="hidden" name="…">` near the record id, inside the form that holds the results table).
3. **On a card, `v`.** The tabs show the owner's names, the dots say which are set up (Test data's goes red if the tool doesn't answer), and `Alt+←` / `Alt+→` move between them.
4. **Record lookup.** `l`, a known Dev record id, `f` to pick a list (or `i`, paste the tool's default list, `Shift+S` to save it), `Enter`.
   - With the tool's default list (about 296 ids) **every row appears, including the ids with spaces**.
   - `/` filters; `Shift+M` shows only empty or missing; `Shift+Y` copies `field=value` lines.
   - `o` opens the form's own page, not the POST target.
   - With Advanced (`a`): a field with options shows its option count (the options in its tooltip); read-only and non-existent rows are marked.
5. **Test data.** The scenario list shows; `r` re-reads; choose one; `Enter` only arms (the line under the button names the environment and scenario); `Enter` again runs it. The run goes Running → Succeeded with its steps; `f` fetches that loan in the lookup (its environment, the chosen list). Stop the local tool and press `r`: the section says it isn't running (with the `start` hint). `Shift+P` in this section does nothing.
6. **Updates** (pick a Dev **test** record, and one harmless field):
   - Fetch with Advanced; `↑ ↓` to the field; `u`; type a value (or choose an option); `Enter` (it shows old → new); `Shift+U` twice.
   - Expect *Sent 1 field(s)*, then *pending*, then *applied* within about three minutes. `w` opens the progress page.
   - A read-only field: `u` says it is read-only, no edit. An empty edit with `Enter`: no change.
   - `Shift+P` twice to Prod and fetch: no edit, and `Shift+U` says no.
   - Remove `allowUpdate` from the file (no restart) and fetch again: the edit UI is gone.
7. **The server log** has no values, record ids, field names or step messages, and no lines about Verify requests.

## When something fails
- **A certificate error, a sign-in, a redirect, *No record found*:** as before: the doctor's *Certificates* line and `CC_CONTROL_CA_FILE`; `"auth": "windows"`; `lookup.url` must be the fetch form's `action`; `recordField` and `envValues`.
- **Rows missing from a long list, or an id with a space split in two:** the lookup reads ids one per line as they are (`splitFieldLines`, up to 400). Say how many rows came back and which kind of id was missing (with a made-up example of its shape).
- **Updates say *"The page had no update form at the update address"*:** `updateUrl` isn't the update form's `action` (compare paths: the app matches the form whose action has the same path).
- **Updates say *"The update form has a field Verify doesn't send: …"*:** a hidden field the app wasn't told of. If it is the record's own (number, folder), add its name to `updateFields`. If it is something else (an anti-forgery token, say), **don't add it**: describe it in the handoff (its name and kind, not its value); sending it may need a change in the app.
- **An update says *"The tool didn't confirm the update"*:** the answer had no SuccessMessage paragraph, or its count differed. Check the progress page (`w` shows nothing then; open the watcher page by hand) and describe what the tool showed, without values. This is the open item below.
- **Test data says it isn't running** while it is: compare `builder.url` with the address the tool's API listens on (scheme, port; `localhost` vs `127.0.0.1`).
- **Allowed probes:** read-only GETs in the browser, the lookup's fetch through the app, and an update only on a Dev test record the owner chose. **Never** post the role or move forms, and never update Prod.

## Rules
- **Never put in the handoff, the chat or the repo:** host names, URLs, the tools' real names, field values, record ids or loan numbers, scenario names, tokens, ticket contents. Say "the record lookup", "a known Dev test record", "a harmless text field".
- Lookup values and loan ids are loan data: don't ask the owner to paste them. "Two values showed", "the loan id appeared" is enough.
- **Ask first before:** restarting the owner's server; running a scenario (it makes loans); sending an update; anything that writes to the field set tool.
- **Report plainly** what worked against the real tools and what didn't.

## Open items to keep an eye on
- What the tool shows when an update **fails**: not seen yet. For now a missing SuccessMessage is *"didn't confirm"*, and the progress page shows Failed. Describe one if you see it.
- A *re-fetch the whole list* key after *applied* (calculated fields may change others): a candidate for later.
- A Start button for the scenario runner: not now; the `start` hint covers it.
- Prod updates stay off; a different decision needs its own handoff.
