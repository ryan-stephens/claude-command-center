# VU laptop: find out how the test-data tool makes scenarios

Paste this into a Claude Code session on the VU work laptop, opened in the folder where the team's test-data tool (the scenario runner that makes test loans) is installed. That session doesn't change the tool, and doesn't edit or commit cc-control. It reads the tool's source and writes a handoff in the shape of `docs/prompts/vu-handoff-template.md`, for the owner to paste into a session on the personal laptop.

---

Context: cc-control v2 (PLAN §140 to §142) drives the team's test-data tool through its local API. Today it only lists scenarios (`GET api/scenarios`), starts a run (`POST api/scenarios/{id}/versions/{n}/runs` with `{ environment }`) and reads a run (`GET api/runs/{id}`). The owner wants Claude to **make a new scenario for the ticket being worked on**, from the ticket and the code changes, filed under a folder they choose, and then run it. Nothing in cc-control has seen how the tool makes a scenario, so it refuses those requests. I need their shape.

Read the tool's source in this folder (its API controllers or endpoints, its request and response models, and its scenario and step models). Don't run anything that writes, and don't call its API with real data. Then write the handoff below.

**Never include:** real scenario names or contents, loan data, ticket keys, internal host names or URLs, tokens, connection strings, people's names, or the tool's own name. Use made-up values throughout (`Sample scenario`, `sample-folder`, `11111111-…`). Shapes and field names are what's needed, not data.

**What to find out**
1. **Making a scenario:** the endpoint (method and path, relative to the API base) and its request body, every field with its type and whether it is required. Then the response: where the new id and version come from.
2. **Versions:** whether a new scenario starts at version 1; how a version is added or edited; whether a scenario must be locked or published before it can run.
3. **Steps:** the shape of a step (type id, order, settings or parameters), with **the list of step types** and what each one's settings look like (a made-up example of each). Say whether the tool has an endpoint that lists step types or their schema, and give its path.
4. **Folders:** whether scenarios can sit in folders (or groups, categories, projects). If they can, how a folder is made and listed, and how a scenario is put in one. If they can't, whether tags are the way to group them, and how tags are set.
5. **Checking before saving:** whether the tool validates a scenario without saving it (a dry run or validate endpoint), and what its errors look like.
6. **Copying:** the copy endpoint, since starting from an existing scenario and changing a few steps may be the easiest path.
7. **Anything that guards these:** auth, an anti-forgery token, headers, or a limit on who may create.
8. **One complete made-up example:** the JSON body that would make a two-step scenario in a folder, and the response it would get.

**Write it as the handoff** (`docs/prompts/vu-handoff-template.md`): *What happened* (what you read, with file paths inside the tool's repo kept generic, e.g. "the scenarios controller"), *Cause* (n/a: this is discovery), *What to change* (sections 1 to 8 above, as found), *How to check it back here* (what the owner can try on the VU laptop once it's built), *Open items* (anything you couldn't find, or weren't sure about, one per line).
