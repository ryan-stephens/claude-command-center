# Handoff from the VU laptop

The VU work laptop can't push to GitHub, so a session there doesn't edit or commit. It finds out what happened and writes a prompt in this shape. The owner pastes it into a session on the personal laptop, where all development happens.

**Never include:** VU code, URLs or host names, proxy entries, ticket keys or contents, tokens, or the names of VU-internal tools. Say what they are instead: "the team's PowerShell command that makes a dev environment", "the API's health address", "a ticket in Ready for QA".

---

Context: cc-control's <feature, with its PLAN section> is being tried on my VU work laptop, which can't push to GitHub. All development happens on the personal laptop. The VU laptop only tries things and sends prompts like this one.

**What happened**
What I did, step by step, and what I saw: the key pressed, the state the card or step showed, the message, the relevant lines of `~/.cc-control/server.log` (with anything internal replaced by a placeholder).

**Cause**
What the session there found, and how sure it is: checked (and how), or a guess.

**What to change**
The fix asked for, as specifically as possible: the file or module if known, the behaviour wanted, what it must not break. Any workaround in use until it ships.

**How to check it back here**
What to run on the VU laptop after `git pull` (and a restart of the server on :7777, when server code changed) to confirm the fix, and what a good result looks like.

**Open items**
What is still unknown or left for later, one per line.
