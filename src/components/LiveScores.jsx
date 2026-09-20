import { useEffect, useState } from 'react';
import { api } from '../api.js';
import MatchDetail from './MatchDetail.jsx';
import { FavoriteButton, IN_PLAY_STATUSES, PickLines, StarIcon, openProps, statusLabel } from './liveShared.jsx';

// Zelfde interval als de server-side poll (zie server/liveScores.js) - vaker
// pollen heeft geen zin, de data zelf ververst niet sneller.
const POLL_MS = 20000;

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

function MatchRow({ match: m, onToggleFavorite, onOpen }) {
  const live = IN_PLAY_STATUSES.has(m.status);
  return (
    <div className={`live-match-row is-clickable${m.favorite ? ' is-fav' : ''}`} {...openProps(() => onOpen(m))}>
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
function GhostRow({ match: m, onOpen }) {
  return (
    <div className="ghost-row is-clickable" {...openProps(() => onOpen(m))}>
      ★ {m.home} – {m.away} staat hierboven bij Favorieten
    </div>
  );
}

function FavoriteCard({ match: m, onToggleFavorite, onOpen }) {
  const live = IN_PLAY_STATUSES.has(m.status);
  return (
    <div className="fav-card is-clickable" {...openProps(() => onOpen(m))}>
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
  const [openId, setOpenId] = useState(null);

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

  const openMatch = openId ? state.matches.find((m) => m.id === openId) : null;
  if (openMatch) {
    return <MatchDetail listMatch={openMatch} onBack={() => setOpenId(null)} onToggleFavorite={toggleFavorite} />;
  }

  const open = (m) => setOpenId(m.id);
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
                  <FavoriteCard key={m.id} match={m} onToggleFavorite={toggleFavorite} onOpen={open} />
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
                      <GhostRow key={m.id} match={m} onOpen={open} />
                    ) : (
                      <MatchRow key={m.id} match={m} onToggleFavorite={toggleFavorite} onOpen={open} />
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
