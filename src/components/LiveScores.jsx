import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { describeBet, MARKET_ABBR } from '../markets.js';

// Zelfde interval als de server-side poll (zie server/liveScores.js) - vaker
// pollen heeft geen zin, de data zelf ververst niet sneller.
const POLL_MS = 20000;

const IN_PLAY_STATUSES = new Set(['1H', '2H', 'ET', 'ET1', 'ET2']);

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

function statusLabel(status) {
  return STATUS_LABELS[status] || status || '';
}

function pickLabel(pick, match) {
  return describeBet({ market: pick.market, selection: pick.selection, line: pick.line, match });
}

// De server levert de wedstrijden al gefilterd op de eigen competitielijst
// en gesorteerd in dezelfde volgorde als de dropdown (top-competities
// eerst) - hier alleen nog groeperen per competitie, groepsvolgorde blijft
// zoals aangeleverd.
function groupByLeague(matches) {
  const groups = [];
  for (const match of matches) {
    const last = groups[groups.length - 1];
    if (last && last.league === match.league) {
      last.matches.push(match);
    } else {
      groups.push({ league: match.league, matches: [match] });
    }
  }
  return groups;
}

function StarIcon({ filled }) {
  return (
    <svg viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'} strokeWidth="1.6">
      <path d="M12 2.5l2.9 6.3 6.9.7-5.2 4.7 1.6 6.8L12 17.6 5.8 21l1.6-6.8-5.2-4.7 6.9-.7z" />
    </svg>
  );
}

function FavoriteButton({ match, onToggle }) {
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
      onClick={() => onToggle(match)}
    >
      <StarIcon filled={match.favorite} />
    </button>
  );
}

function PickLines({ picks, match }) {
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

function MatchRow({ match: m, onToggleFavorite }) {
  const live = IN_PLAY_STATUSES.has(m.status);
  return (
    <div className={`live-match-row${m.favorite ? ' is-fav' : ''}`}>
      <div className="live-match-teams">
        <span className="live-match-team">{m.home}</span>
        <span className="live-match-score">
          {m.homeScore ?? '–'} : {m.awayScore ?? '–'}
        </span>
        <span className="live-match-team">{m.away}</span>
      </div>
      <div className="live-match-meta">
        <span className={`live-match-status ${live ? 'is-live' : ''}`}>
          {live && <span className="live-dot" />}
          {live && m.minute ? `${m.minute}' · ` : ''}
          {statusLabel(m.status)}
        </span>
        <FavoriteButton match={m} onToggle={onToggleFavorite} />
      </div>
      <PickLines picks={m.picks} match={m} />
    </div>
  );
}

// Vervangt een favoriete wedstrijd binnen haar eigen competitiegroep - het
// volledige kaartje staat al in het Favorieten-blok bovenaan (zie
// FavoriteCard), dubbel tonen zou weer precies het gedrang-probleem
// terugbrengen dat dit blok juist oplost.
function GhostRow({ match: m }) {
  return (
    <div className="ghost-row">
      ★ {m.home} – {m.away} staat hierboven bij Favorieten
    </div>
  );
}

function FavoriteCard({ match: m, onToggleFavorite }) {
  const live = IN_PLAY_STATUSES.has(m.status);
  return (
    <div className="fav-card">
      <div className="fav-card-top">
        {live ? (
          <span className="fav-card-badge is-live">
            <span className="live-dot" />
            {m.minute ? `${m.minute}'` : statusLabel(m.status)}
          </span>
        ) : (
          <span className="fav-card-badge">{statusLabel(m.status)}</span>
        )}
        <FavoriteButton match={m} onToggle={onToggleFavorite} />
      </div>
      <div className="fav-card-table">
        <div className="fav-card-table-row">
          <span className="live-match-team">{m.home}</span>
          <span className="live-match-score">{m.homeScore ?? '–'}</span>
        </div>
        <div className="fav-card-table-row">
          <span className="live-match-team">{m.away}</span>
          <span className="live-match-score">{m.awayScore ?? '–'}</span>
        </div>
      </div>
      <PickLines picks={m.picks} match={m} />
    </div>
  );
}

export default function LiveScores() {
  const [state, setState] = useState({ matches: [], updatedAt: null, error: null });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    function load() {
      api
        .getLiveScores()
        .then((data) => {
          if (!cancelled) setState(data);
        })
        .catch((err) => {
          if (!cancelled) setState((s) => ({ ...s, error: err.message }));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }

    load();
    const interval = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  function setMatchFavorite(id, favorite, favoriteSource) {
    setState((s) => ({
      ...s,
      matches: s.matches.map((x) => (x.id === id ? { ...x, favorite, favoriteSource } : x)),
    }));
  }

  async function toggleFavorite(match) {
    const wasFavorite = match.favorite;
    setMatchFavorite(match.id, !wasFavorite, wasFavorite ? null : 'manual');
    try {
      if (wasFavorite) await api.unfavoriteMatch(match.id);
      else await api.favoriteMatch(match.id);
    } catch {
      setMatchFavorite(match.id, wasFavorite, match.favoriteSource);
    }
  }

  const favorites = state.matches.filter((m) => m.favorite);
  const groups = groupByLeague(state.matches);

  return (
    <div className="live-scores">
      <div className="card-header">
        <h3>Live wedstrijden</h3>
        {state.updatedAt && (
          <span className="muted">Bijgewerkt {new Date(state.updatedAt).toLocaleTimeString('nl-NL')}</span>
        )}
      </div>

      {state.error && <p className="error-text">Kon live scores niet ophalen: {state.error}</p>}

      {loading ? (
        <p className="hint-text">Laden…</p>
      ) : groups.length === 0 ? (
        <p className="hint-text">Nu geen wedstrijden live in je getrackte competities.</p>
      ) : (
        <>
          {favorites.length > 0 && (
            <div className="fav-section">
              <div className="fav-heading">
                <StarIcon filled />
                <span className="label">Favorieten</span>
                <span className="count">{favorites.length}</span>
              </div>
              <div className="fav-grid">
                {favorites.map((m) => (
                  <FavoriteCard key={m.id} match={m} onToggleFavorite={toggleFavorite} />
                ))}
              </div>
              <div className="fav-divider" />
            </div>
          )}

          <div className="live-league-groups">
            {groups.map((group) => (
              <div className="live-league-group" key={group.league}>
                <div className="live-league-heading">{group.league}</div>
                <div className="live-match-list">
                  {group.matches.map((m) =>
                    m.favorite ? (
                      <GhostRow key={m.id} match={m} />
                    ) : (
                      <MatchRow key={m.id} match={m} onToggleFavorite={toggleFavorite} />
                    )
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
