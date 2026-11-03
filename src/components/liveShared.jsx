import {
  bookmakerSummary,
  describeBet,
  groupSamePicks,
  isBetBuilder,
  MARKET_ABBR,
  oddsRange,
  partStatus,
  STATUS_LABELS as LEG_STATUS_LABELS,
} from '../markets.js';
import EarlyPayoutBadge from './EarlyPayoutBadge.jsx';

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
  return describeBet({ market: pick.market, selection: pick.selection, line: pick.line, parts: pick.parts, match });
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
      {groupSamePicks(picks).map(({ key, pick: p, picks: same }) => (
        <div className="pick-line" key={key}>
          <span className="market">{MARKET_ABBR[p.market] || p.market}</span>
          {same.length > 1 && <span className="pick-count">{same.length}×</span>}
          {pickLabel(p, match)}
          <EarlyPayoutBadge leg={p} />
        </div>
      ))}
    </div>
  );
}

// Onderdelen van een bet builder met per onderdeel hit/mis-knoppen; een al
// afgehandeld onderdeel toont zijn uitslag.
export function BuilderPartRows({ parts, onSettlePart }) {
  return (
    <ul className="ob-parts">
      {parts.map((part, i) => {
        const status = partStatus(part);
        return (
          <li className="ob-part" key={i}>
            <span className="ob-part-name">
              {part.pick}
              {part.market && <span className="muted">{part.market}</span>}
            </span>
            {status === 'open' ? (
              <span className="ob-actions">
                <button type="button" className="ob-btn ob-won" title="Gewonnen" aria-label="Gewonnen" onClick={() => onSettlePart(i, 'won')}>
                  ✓
                </button>
                <button type="button" className="ob-btn ob-lost" title="Verloren" aria-label="Verloren" onClick={() => onSettlePart(i, 'lost')}>
                  ✕
                </button>
              </span>
            ) : (
              <span className={`leg-status leg-status-${status}`}>{LEG_STATUS_LABELS[status]}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// Picks op de detailpagina met dezelfde hit/mis-knoppen als in de Open
// bets-popup. Net afgehandelde picks blijven met hun uitslag staan. Bij een
// bet builder gaan de knoppen per onderdeel (onSettlePart).
// Dezelfde pick uit meerdere bets staat er één keer met "3×" ervoor; de
// knoppen handelen dan alle legs tegelijk af.
export function SettlePickRows({ openPicks, settledPicks, match, onSettle, onSettlePart }) {
  const row = ({ key, pick: p, picks: same }, actions) => (
    <div className="ob-pick" key={key}>
      <span className={`ob-count${same.length > 1 ? ' is-multi' : ''}`}>{same.length}×</span>
      <div className="ob-pick-info">
        <span className="ob-pick-name">
          <span className="pick-line">
            <span className="market">{MARKET_ABBR[p.market] || p.market}</span>
            {isBetBuilder(p) ? `Bet builder · ${p.parts.length} selecties` : pickLabel(p, match)}
            <EarlyPayoutBadge leg={p} />
          </span>
        </span>
        {p.bookmaker && (
          <span className="ob-pick-meta">
            <span className="ob-bk-summary">{bookmakerSummary(same)}</span>
          </span>
        )}
        {isBetBuilder(p) && p.legId && <BuilderPartRows parts={p.parts} onSettlePart={(i, status) => onSettlePart(p, i, status)} />}
      </div>
      {oddsRange(same) ? <span className="ob-odds">@ {oddsRange(same)}</span> : null}
      {actions}
    </div>
  );
  const settle = (same, status) => same.forEach((p) => onSettle(p, status));
  // Afgehandeld per uitslag groeperen, zodat "3× gewonnen" niet een verloren leg verstopt.
  const settledRows = ['won', 'lost', 'void', 'cashed_out'].flatMap((status) =>
    groupSamePicks(settledPicks.filter((p) => p.status === status)).map((g) => ({ ...g, key: `${status}:${g.key}` }))
  );
  return (
    <div className="md-settle-picks">
      {groupSamePicks(openPicks).map((g) =>
        row(
          g,
          g.pick.legId && !isBetBuilder(g.pick) ? (
            <span className="ob-actions">
              <button type="button" className="ob-btn ob-won" title="Gewonnen" aria-label="Gewonnen" onClick={() => settle(g.picks, 'won')}>
                ✓
              </button>
              <button type="button" className="ob-btn ob-lost" title="Verloren" aria-label="Verloren" onClick={() => settle(g.picks, 'lost')}>
                ✕
              </button>
            </span>
          ) : null
        )
      )}
      {settledRows.map((g) =>
        row(g, <span className={`leg-status leg-status-${g.pick.status}`}>{LEG_STATUS_LABELS[g.pick.status]}</span>)
      )}
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
