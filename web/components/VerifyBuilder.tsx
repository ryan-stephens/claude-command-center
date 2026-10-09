// The Verify panel's test-data section (PLAN §132, §133): the scenario runner on this machine, which
// creates test loans in Dev or UAT. Its own web UI opens with o.

import { useStore } from '../store.ts';
import { cap, openPage, toolName } from '../verify-state.ts';
import { Key } from './ui.tsx';
import { NotSetUp, Sec, small } from './verify-ui.tsx';

export function VerifyBuilder({ file }: { file?: string }) {
  const b = useStore((s) => s.verify?.config.builder);
  const name = toolName('builder');
  return (
    <Sec title={cap(name)} right={b?.ui ? <button className={small} onClick={() => openPage('builder')}>Its page<Key k="o" size="sm" /></button> : undefined}>
      {!b?.url
        ? <NotSetUp name={cap(name)} keys={'"builder": { "url": "http://localhost:…", "ui": … }'} file={file} />
        : <p className="text-[13px] text-sub">{cap(name)} runs at <span className="font-mono">{b.url}</span> on this machine.</p>}
    </Sec>
  );
}
