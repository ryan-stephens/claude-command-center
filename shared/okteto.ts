// Okteto manifests: `okteto up` forwards local ports to the dev container as the manifest's
// `forward:` list says (`- 8080:8080`, local first). It has no flag for a forward, so to run the
// same API from two cards at once cc-control writes a copy of the manifest with the local side of a
// forward changed to the port picked for that run, and runs `okteto up -f <copy>` (the forward:
// step prefix, shared/recipes.ts). Pure text work on the YAML, so the rest of the file (sync,
// command, the dev name the team's helper generated) is kept exactly.

/** The copy's name, beside the manifest in the API's folder; never committed (it goes in .git/info/exclude). */
export const FORWARD_MANIFEST = 'okteto.cc-control.yml';

/** A forward line read from the manifest: where it is and what it says. */
interface Found {
  /** The line index of the item (string form), or of its localPort line (object form). */
  at: number;
  local: number;
  remote?: number;
  /** Replace the local port on that line. */
  rewrite: (line: string, local: number) => string;
}

const STRING_ITEM = /^(\s*-\s*["']?)(\d{2,5})(:.*)$/;
const LOCAL_KEY = /^(\s*(?:-\s*)?localPort:\s*)(\d{2,5})(\s*(?:#.*)?)$/;
const REMOTE_KEY = /^\s*(?:-\s*)?remotePort:\s*(\d{2,5})/;

/** Every forward in the manifest's `forward:` lists (top level or under a dev entry). */
export function findForwards(text: string): { local: number; remote?: number }[] {
  return forwards(text.split(/\r?\n/)).map(({ local, remote }) => ({ local, ...(remote !== undefined ? { remote } : {}) }));
}

function forwards(lines: string[]): Found[] {
  const out: Found[] = [];
  for (let i = 0; i < lines.length; i++) {
    const head = /^(\s*)forward:\s*(#.*)?$/.exec(lines[i]);
    if (!head) continue;
    const indent = head[1].length;
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      if (!line.trim() || /^\s*#/.test(line)) continue;
      const lead = /^\s*/.exec(line)![0].length;
      if (lead <= indent) break;
      let m: RegExpExecArray | null;
      if ((m = STRING_ITEM.exec(line))) {
        // "8080:8080" or "8080:service:80": the remote port is the last number.
        const remote = /:(\d{2,5})\s*["']?\s*(?:#.*)?$/.exec(m[3])?.[1];
        out.push({ at: j, local: Number(m[2]), ...(remote ? { remote: Number(remote) } : {}), rewrite: (l, p) => l.replace(STRING_ITEM, `$1${p}$3`) });
      } else if ((m = LOCAL_KEY.exec(line))) {
        let remote: number | undefined;
        for (let k = j + 1; k < lines.length && (/^\s*$/.test(lines[k]) || /^\s*/.exec(lines[k])![0].length > indent) && !/^\s*-\s/.test(lines[k]); k++) {
          const r = REMOTE_KEY.exec(lines[k]);
          if (r) { remote = Number(r[1]); break; }
        }
        out.push({ at: j, local: Number(m[2]), ...(remote !== undefined ? { remote } : {}), rewrite: (l, p) => l.replace(LOCAL_KEY, `$1${p}$3`) });
      }
    }
  }
  return out;
}

/**
 * The manifest with one forward's local side set to `local`: the forward whose remote side is
 * `remote`, else the first one. Throws when the manifest has no forward (nothing to point at).
 */
export function rewriteForward(text: string, local: number, remote?: number): string {
  const lines = text.split(/\r?\n/);
  const all = forwards(lines);
  if (!all.length) throw new Error('the manifest has no forward: line to change');
  const pick = (remote !== undefined ? all.find((f) => f.remote === remote) : undefined) ?? all[0];
  lines[pick.at] = pick.rewrite(lines[pick.at], local);
  return lines.join(text.includes('\r\n') ? '\r\n' : '\n');
}
