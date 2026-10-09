import { go, openHud, useRoute, useSnapshot } from './api.ts';
import { Hud } from './Hud.tsx';
import { Launchpad } from './Launchpad.tsx';
import { ShipDock } from './ShipDock.tsx';
import { Switchboard } from './Switchboard.tsx';

export function App() {
  const route = useRoute();
  const { snap, connected } = useSnapshot();
  if (route === '/hud') return <Hud snap={snap} />;
  const ship = /^\/ship\/([\w-]+)$/.exec(route);
  return (
    <div className="page">
      <header className="top">
        <a className="brand" href="/" onClick={(e) => { e.preventDefault(); go('/'); }}>Command Center</a>
        <h1>{route === '/new' ? 'New work' : ship ? 'Ship' : 'Switchboard'}</h1>
        <nav className="nav" aria-label="Pages">
          {!connected && snap && <span className="need" style={{ fontSize: 14 }}>reconnecting…</span>}
          <button type="button" className={`btn${route === '/' ? ' dark' : ''}`} onClick={() => go('/')}>Switchboard</button>
          <button type="button" className={`btn${route === '/new' ? ' dark' : ''}`} onClick={() => go('/new')}>New work</button>
          <button type="button" className="btn" onClick={openHud}>Open the HUD</button>
        </nav>
      </header>
      {!snap ? <p className="mu">Connecting to the v2 server…</p>
        : route === '/new' ? <Launchpad snap={snap} />
        : ship ? <ShipDock snap={snap} id={ship[1]} />
        : <Switchboard snap={snap} />}
    </div>
  );
}
