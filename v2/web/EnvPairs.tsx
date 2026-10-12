// The stack's per-env find/replace pairs, edited in v2 (§146): ui.proxyEnv moves the proxy file's
// own targets to another env, ui.configEnv the UI app's runtime config (sign-in, flags keys). Set
// once per workspace; the values come from the server when this opens and go back to the local
// stack store on Save, never into the snapshot, logs or Claude's tools.
import { useEffect, useState } from 'react';
import { get, post } from './api.ts';

interface Pair { from: string; to: string }
interface Loaded { envs: string[]; proxyFile: string | null; configFile: string | null; proxyEnv: Record<string, Pair[]>; configEnv: Record<string, Pair[]> }

const toLines = (pairs: Pair[] | undefined) => (pairs ?? []).map((p) => `${p.from} => ${p.to}`).join('\n');

/** One pair per line, "from => to"; blank lines skipped. Throws the first line that isn't one. */
export function parsePairs(text: string, what: string): Pair[] {
  return text.split(/\r?\n/).map((l, i) => [l, i] as const).filter(([l]) => l.trim()).map(([l, i]) => {
    const at = l.indexOf('=>');
    const from = at < 0 ? '' : l.slice(0, at).trim();
    if (!from) throw new Error(`${what}, line ${i + 1}: write it as  from => to`);
    return { from, to: l.slice(at + 2).trim() };
  });
}

export function EnvPairs({ workspaceId, close }: { workspaceId: string; close: () => void }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [text, setText] = useState<Record<string, string>>({});
  const [same, setSame] = useState<Record<string, boolean>>({});
  const [file, setFile] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    get<Loaded>(`/api/workspaces/${workspaceId}/stack-env`).then((d) => {
      setData(d);
      setFile(d.configFile ?? '');
      setText(Object.fromEntries(d.envs.flatMap((e) => [[`proxy:${e}`, toLines(d.proxyEnv[e])], [`config:${e}`, toLines(d.configEnv[e])]])));
      // An empty config list on purpose: that env's runtime config is the same as the default's.
      setSame(Object.fromEntries(d.envs.map((e) => [e, Array.isArray(d.configEnv[e]) && !d.configEnv[e].length])));
    }).catch((e: Error) => setError(e.message));
  }, [workspaceId]);

  const save = () => {
    if (!data) return;
    setError('');
    setSaved(false);
    try {
      const proxyEnv: Record<string, Pair[]> = {};
      const configEnv: Record<string, Pair[]> = {};
      for (const e of data.envs) {
        const p = parsePairs(text[`proxy:${e}`] ?? '', `${e.toUpperCase()} proxy`);
        const c = parsePairs(text[`config:${e}`] ?? '', `${e.toUpperCase()} config`);
        if (p.length) proxyEnv[e] = p;
        if (c.length) configEnv[e] = c;
        else if (same[e]) configEnv[e] = [];
      }
      post(`/api/workspaces/${workspaceId}/stack-env`, { proxyEnv, configEnv, configFile: file.trim() })
        .then(() => setSaved(true)).catch((err: Error) => setError(err.message));
    } catch (err) { setError((err as Error).message); }
  };

  if (!data) return <div className="fcard" aria-label="Env pairs">{error ? <div className="err" role="alert">{error}</div> : <span className="mu">Reading the stack…</span>}</div>;
  return (
    <div className="fcard" aria-label="Env pairs">
      <div className="fcard-top">
        <b>Env pairs</b>
        <span className="mu" style={{ fontSize: 14 }}>One per line, <span className="mono">from =&gt; to</span>, applied in order: put a specific pair before a broader one. They stay in this machine’s stack store; set them once.</span>
      </div>
      {!data.envs.length && <span className="mu">The stack’s “choose” has one value per question: nothing to move.</span>}
      <div className="fgrid">
        {data.envs.map((e) => (
          <EnvRows key={e} env={e} proxyFile={data.proxyFile} text={text} setText={setText} same={Boolean(same[e])} setSame={(v) => setSame((x) => ({ ...x, [e]: v }))} />
        ))}
        <span className="cap">Config file</span>
        <input type="text" aria-label="UI config file" value={file} placeholder="the served app’s assets/environmentConfig.js" onChange={(ev) => setFile(ev.target.value)} />
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn dark" onClick={save}>Save pairs</button>
        <button type="button" className="btn" onClick={close}>Close</button>
        {saved && <span className="ok" role="status">Saved: used from the next start.</span>}
      </div>
      {error && <div className="err" role="alert">{error}</div>}
    </div>
  );
}

function EnvRows({ env, proxyFile, text, setText, same, setSame }: { env: string; proxyFile: string | null; text: Record<string, string>; setText: (f: (x: Record<string, string>) => Record<string, string>) => void; same: boolean; setSame: (v: boolean) => void }) {
  const E = env.toUpperCase();
  const area = (key: string, label: string, hint: string) => (
    <textarea rows={3} aria-label={label} placeholder={hint} spellCheck={false} className="mono" value={text[key] ?? ''} onChange={(ev) => { const v = ev.target.value; setText((x) => ({ ...x, [key]: v })); }} />
  );
  return (
    <>
      <span className="cap">{E} proxy</span>
      {area(`proxy:${env}`, `${E} proxy pairs`, `Moves ${proxyFile ?? 'the proxy file'}’s own targets and headers: .dev.example.test => .uat.example.test`)}
      <span className="cap">{E} UI config</span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {area(`config:${env}`, `${E} config pairs`, 'Moves the UI app’s runtime config (sign-in issuer, client ids, hosts): id-dev => id-uat')}
        <label className="mu" style={{ fontSize: 13 }}><input type="checkbox" checked={same} onChange={(ev) => setSame(ev.target.checked)} /> {E}’s UI config is the same as the default’s (no pairs needed)</label>
      </span>
    </>
  );
}
