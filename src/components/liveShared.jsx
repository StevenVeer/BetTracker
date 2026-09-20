import { describeBet, MARKET_ABBR } from '../markets.js';

// Gedeeld tussen het live-overzicht (LiveScores.jsx) en de wedstrijd-
// detailpagina (MatchDetail.jsx).

// Server-kant (liveScores.js) telt HT ook als "live" - voor de badge-stijl
// in de lijst blijft HT bewust een rustige, niet-live badge (zoals voorheen).
export const IN_PLAY_STATUSES = new Set(['1H', '2H', 'ET', 'ET1', 'ET2']);

const STATUS_LABELS = {
  NS: 'Nog niet begonnen',
  '1H': '1e helft',
  HT: 'Rust',
  '2H': '2e helft',
  ET: 'Verlenging',
  FT: 'Afgelopen',
  AET: 'Afgelopen (n.v.)',
  PEN: "Penalty's",
  POST: 'Uitgesteld',
  CANC: 'Afgelast',
};

export function statusLabel(status) {
  return STATUS_LABELS[status] || status || '';
}

function pickLabel(pick, match) {
  return describeBet({ market: pick.market, selection: pick.selection, line: pick.line, match });
}

export function StarIcon({ filled }) {
  return (
    <svg viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'} strokeWidth="1.6">
      <path d="M12 2.5l2.9 6.3 6.9.7-5.2 4.7 1.6 6.8L12 17.6 5.8 21l1.6-6.8-5.2-4.7 6.9-.7z" />
    </svg>
  );
}

export function FavoriteButton({ match, onToggle }) {
  const label =
    match.favoriteSource === 'bet'
      ? 'Favoriet door een actieve bet — klik om te verwijderen'
      : match.favorite
        ? 'Favoriet verwijderen'
        : 'Markeer als favoriet';
  return (
    <button
      type="button"
      className={`star-btn${match.favorite ? ' is-fav' : ''}`}
      title={label}
      aria-label={label}
      onClick={(e) => {
        // De rij/kaart eromheen opent de detailpagina - de ster hoort daar niet
        // ook aan te trekken.
        e.stopPropagation();
        onToggle(match);
      }}
    >
      <StarIcon filled={match.favorite} />
    </button>
  );
}

export function PickLines({ picks, match }) {
  if (!picks || picks.length === 0) return null;
  return (
    <div className="pick-lines">
      {picks.map((p, i) => (
        <div className="pick-line" key={i}>
          <span className="market">{MARKET_ABBR[p.market] || p.market}</span>
          {pickLabel(p, match)}
        </div>
      ))}
    </div>
  );
}

// Klikbare rij/kaart: echte knop-semantiek (toetsenbord + schermlezer)
// zonder de bestaande div-layout om te bouwen naar <button>.
export function openProps(onOpen) {
  return {
    role: 'button',
    tabIndex: 0,
    onClick: onOpen,
    onKeyDown: (e) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onOpen();
      }
    },
  };
}
