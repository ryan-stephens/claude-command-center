# Try the Verify panel against the real tools at VU

Paste this into a new Claude Code session on the **VU work laptop**, opened in the cc-control clone.

---

You're helping the owner try the **Verify panel** in **cc-control** for the first time against the team's two real tools. cc-control is a local web app over Claude Code sessions (the Ticket Line board: a card per ticket, its session in the card, panels beside the chat). Verify (`v` on an open card) was built on the owner's personal laptop and tested there only against made-up stand-ins. This session is its first contact with the real hosts.

The two tools, as the code and PLAN call them (their real names are in this machine's Verify file, never in the repo):
- **The field set tool**: a host per environment (dev, uat). Fields have to be in its set for the sync to work. Verify reads it (`GET <base>/Home/SetVersion`, the whole set, cached ten minutes; `GET <base>/Home/ValidateField?<idParam>=<id>`) and opens its add-to-set page for you to add a field there.
- **The record lookup**: one host for every environment, an MVC form. Verify posts the form once (Environment, the record id field, AdvancedFetch, FieldsToFetch) and reads `table#FieldResults` out of the page it answers with.

## This laptop doesn't edit or commit
See `CLAUDE.md`, *Two laptops*: development happens on the personal laptop only. Here you **diagnose and write a handoff** in the shape of `docs/prompts/vu-handoff-template.md`. Don't change code or commit, even for a one-line fix: describe it instead.

## Tokens are tight on this machine
- Read only: `CLAUDE.md`; `docs/PLAN.md` §105, §106, §107 (search for `## 105.`; don't read the whole file); `docs/prompts/vu-handoff-template.md`.
- Open `server/verify.ts` (the clients, the guard, the parser) or `shared/verify.ts` (types, `idsInText`, `cleanVerify`) only when something fails and you need to know why.
- Don't run Playwright walkthroughs here. The owner presses the keys; ask what the screen says.

## Facts
- **The Verify file:** `%USERPROFILE%\.cc-control\verify.json` (or the file `CC_CONTROL_VERIFY_FILE` names). It says where the two tools are and what they're called. The owner has a PowerShell line that writes it; it holds the real addresses, so it never goes in the repo or the handoff. Its shape: `{ "set": { "name", "urls": { "dev", "uat" }, "addPage", "idParam"?, "idKey"? }, "lookup": { "name", "url", "recordField", "envValues"?, "auth"? } }`. `lookup.url` is the address the form **posts to**. The server reads the file again within 3 s of a change: **no restart for edits to it.**
- **`recordField`** is the form's own name for the record id box (its `<input name="…">`, next to Environment and FieldsToFetch). The owner fills it in. To find it: open the lookup's page in the browser, then View source, or DevTools on that box.
- **Certificates:** the server already trusts the certificates Windows trusts (`server/config.ts`, the *Certificates* line in `pnpm run doctor`), so the internal CA should be fine for it. A plain `node` script doesn't do that, which is why an earlier probe failed with `SELF_SIGNED_CERT_IN_CHAIN`. Fallback: `CC_CONTROL_CA_FILE` = the company root as PEM, in `config.env`, then a restart.
- **Windows sign-in:** Node's fetch can't sign in as you. With `"auth": "auto"` (the default), a 401 asking for Negotiate or NTLM is retried through PowerShell's `Invoke-WebRequest -UseDefaultCredentials`; `"windows"` always goes that way; `"none"` never does. Not tried for real yet.
- **The guard:** the server only ever sends those two GETs and the one lookup POST. Anything else throws (*Verify refused a request*) before it leaves the machine. Redirects aren't followed.
- **Server log:** `%USERPROFILE%\.cc-control\server.log`. The owner's server runs on :7777. **Ask before restarting it.** A restart stops the sessions the app runs; stop any Try it apps first (`t` on their cards).

## How to go about it
1. **Check the machine and the code.** `git log --oneline -3` should show the §107 commit (*tools by name from a machine file*). If not, have the owner `git pull`.
2. **Restart the server**, after asking (§105 and §107 changed server code). The way it's been restarted is in `docs/prompts/continue.md`, *How to work here*.
3. **The Verify file.** Have the owner run their PowerShell line, then put the real `recordField` in it. Then `pnpm run doctor`. Its *Settings* section should say *Verify file: … the two names (dev, uat), …*, with no warning about `recordField`.
4. **On a card, `v`.** Then go through these, asking the owner what the screen shows each time:
   1. The panel's sections name the two tools (*Is it in ‹name›?*, *Look up in ‹name› · Dev*), and there is no note about where the file goes.
   2. **The field check.** Put one field id the owner knows is in the set and one made-up id in the box (`i`, type, `Esc`), then `Enter`:
      - the known id shows *in set* (or *not in set*) with its format, in a Dev column and a UAT column;
      - the made-up id shows *unknown* in both;
      - under the table, each environment's set shows as *set v… (…), N fields, read just now*.
   3. **Drift.** A field that's in Dev's set but not UAT's (the owner may know one) should be marked *differs: in the set in one only*, with **Add in UAT ↗** under the UAT cell. Click it: the add-to-set page for UAT opens, and the id is on the clipboard. **Don't submit that page** unless the owner means to add the field for real.
   4. `r` reads both sets again. The flash should say *Read the set again: Dev v… (N fields), UAT v…*.
   5. `o`, `Shift+O` and `Shift+L` open the set tool for the chosen environment, its add-to-set page, and the lookup's page. `e` switches Dev ↔ UAT for these.
   6. **The lookup.** `l`, then a dev record id the owner knows, with two real field ids and one made-up in *Fields to read*, then `Enter`. Expect two values and one *does not exist* row. A wrong record id should give *No record found*. `a` turns Advanced on (slower).
   7. **Prod** (only if the owner wants to): `Shift+P` once only asks, and twice chooses Prod for the lookup.
   8. **Paste (§106):** `Ctrl+V` into the card's message box and into the ids box both paste.
   9. **The server log** has no lookup values and no lines about Verify requests at all.
5. **When something fails**, find out why, in this order:
   - **A certificate error** (*its certificate isn't trusted here (CODE)*): check the doctor's *Certificates* line, then the `CC_CONTROL_CA_FILE` fallback above.
   - **The set tool answers 404, or *didn't answer with JSON*:** the base address is likely wrong. The file's guess is the tool's own page address (the one you'd open in the browser), with `/Home/SetVersion` and `/Home/ValidateField` under it. Have the owner open `<base>/Home/ValidateField?<idParam>=<a known id>` in the browser (a read-only GET) to find the base that answers `{ "Successful": true, … }`, and fix the file. No restart needed.
   - ***in set* never shows, though the tool says it is:** the payload's flag isn't a key starting `ExistsIn`, or the id parameter isn't `encompassId` (`set.idParam` in the file). Ask the owner to describe the JSON keys, not the values.
   - **The lookup wants a sign-in, or PowerShell fails:** try `"auth": "windows"`. Then capture the error message.
   - **The lookup *answered with a redirect*:** `lookup.url` isn't where the form posts. Look at the form's `action` in the page's source.
   - ***No record found* for a real record:** `recordField` is wrong, or the dropdown's values aren't *Dev / Uat / Prod* (`lookup.envValues` in the file).
   - **Values in the wrong columns, or missing:** the page's table differs from what `parseLookup` expects. Describe its shape (columns, hidden inputs, how a missing field is marked) with made-up values.
   - **Allowed probes:** only the read-only GETs above, in the browser or with `Invoke-WebRequest -UseDefaultCredentials`, and the lookup through the app. **Never** POST to the add-to-set page, a Save, or the lookup's update boxes.
6. **Write the handoff** in the template's shape: what worked, what failed (with the messages), the cause and how sure, what to change, how to check it back here, and the open items. Settings fixed in the Verify file go under *What happened* as "fixed in the machine's file: the base address had to be …" (in words, not the address).

## Rules
- **Never put in the handoff, the chat or the repo:** host names, URLs, the tools' real names, field values, record ids or loan numbers, tokens, ticket contents. Say "the field set tool's dev host", "a known dev record", "a field id in the set".
- Lookup values are loan data: don't ask the owner to paste them. "Two values showed" is enough.
- **Ask first before:** restarting the owner's server; anything that writes to either tool (the add-to-set page's Save, the lookup's update boxes); changing global npm, pnpm or git config.
- **Report plainly** what worked against the real tools and what didn't.
