import { useEffect, useRef, useState } from 'react';

const ICON_PATHS = {
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  alert: 'M12 8v4M12 16h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18',
  bookmark: 'M6 3h12v18l-6-4-6 4z',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  refresh: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5',
  image: 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M21 15l-5-5L5 21',
  send: 'm22 2-7 20-4-9-9-4zM22 2 11 13',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
};

export function ToolbarIcon({ name }) {
  return (
    <svg className="tool-icon" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <path d={ICON_PATHS[name]} strokeWidth={name === 'dots' ? 3 : 2} />
    </svg>
  );
}

// Icoonknop met teller (Open bets / Onafgehandeld / Gepland). De naam staat
// in title + aria-label i.p.v. zichtbare tekst - die ruimte is de winst van
// deze toolbar.
export function CountButton({ icon, label, count, onClick, warn = false }) {
  return (
    <button type="button" className="btn tool-btn" onClick={onClick} title={label} aria-label={count > 0 ? `${label} (${count})` : label}>
      <ToolbarIcon name={icon} />
      {count > 0 && <span className={`open-bets-count${warn ? ' is-warn' : ''}`}>{count}</span>}
    </button>
  );
}

// ⋯-menu voor de zeldzamere acties. items: [{ key, icon, label, meta?, onClick, disabled?, spinning? }]
export function MoreMenu({ items }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="tool-menu-anchor" ref={rootRef}>
      <button
        type="button"
        className={`btn tool-btn${open ? ' is-open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title="Meer"
        aria-label="Meer acties"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <ToolbarIcon name="dots" />
      </button>
      {open && (
        <div className="tool-menu" role="menu">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              className={`tool-menu-item${item.spinning ? ' is-spinning' : ''}`}
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
            >
              <ToolbarIcon name={item.icon} />
              <span>{item.label}</span>
              {item.meta && <span className="tool-menu-meta">{item.meta}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Statusregel onder de toolbar: laat zien dat de gratis feed zelf ververst
// (server-side elke 20s, zie server/liveScores.js) en hoe vers de data is.
// Eigen 1s-tick zodat alleen dit stukje rendert, niet heel App.
export function LiveStatus({ updatedAt, error, onRefresh }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const ageSec = updatedAt ? Math.max(0, Math.round((now - new Date(updatedAt).getTime()) / 1000)) : null;
  const stale = error || (ageSec !== null && ageSec > 120);
  let text = 'Live scores laden…';
  if (error) text = `Live feed haperde: ${error}`;
  else if (ageSec !== null) text = `Live gevolgd via gratis feed · bijgewerkt ${ageSec < 90 ? `${ageSec} s` : `${Math.round(ageSec / 60)} min`} geleden`;

  return (
    <div className="live-status">
      <span className={`live-status-dot${stale ? ' is-stale' : ''}`} />
      <span>{text}</span>
      <button type="button" className="live-status-link" onClick={onRefresh}>
        Nu verversen
      </button>
    </div>
  );
}
