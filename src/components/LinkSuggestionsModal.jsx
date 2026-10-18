import { useState } from 'react';
import { api } from '../api.js';
import { describeBet } from '../markets.js';
import { formatKickoff } from './BetList.jsx';

const LIVE_STATUSES = new Set(['1H', '2H', 'HT', 'ET', 'PEN']);

function candidateState(c) {
  if (c.status === 'NS') return formatKickoff(c.kickoff);
  if (LIVE_STATUSES.has(c.status)) return `live ${c.homeScore ?? 0}-${c.awayScore ?? 0}`;
  return `${c.status} ${c.homeScore ?? ''}-${c.awayScore ?? ''}`;
}

// Lijst van open picks die nog niet aan een ESPN-wedstrijd hangen, met de
// best lijkende wedstrijden uit de feed (op teamnaam, zie
// GET /api/live-link-suggestions) - één klik op "Koppel" bevestigt. Een
// item kan meerdere legs bevatten (meerdere picks op hetzelfde duel); een
// handmatige selectie wordt per leg gekoppeld, een Odds API-wedstrijd in
// één keer via de matches-rij.
export default function LinkSuggestionsModal({ items, onLinked, onClose }) {
  const [busyKey, setBusyKey] = useState(null);
  const [error, setError] = useState('');
  const withCandidates = items.filter((item) => item.candidates.length > 0);
  const without = items.filter((item) => item.candidates.length === 0);

  async function link(item, candidate) {
    setBusyKey(item.key);
    setError('');
    try {
      if (item.matchId) {
        await api.linkLiveMatch(item.matchId, candidate.id);
      } else {
        for (const legId of item.legIds) await api.linkLegToLiveMatch(legId, candidate);
      }
      await onLinked();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal open-bets-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Koppelsuggesties ({withCandidates.length})</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Sluiten" title="Sluiten">
            ×
          </button>
        </div>
        <p className="hint-text live-link-modal-subtitle">
          Open picks zonder live wedstrijd, met de wedstrijden uit de feed (gisteren t/m morgen) waarvan de teamnamen het meest lijken.
        </p>
        {error && <p className="error-text">{error}</p>}

        {items.length === 0 ? (
          <p className="hint-text">Alle open picks zijn al gekoppeld.</p>
        ) : (
          <div className="ob-groups">
            {withCandidates.map((item) => (
              <section className="ob-group" key={item.key}>
                <header className="ob-group-head">
                  <div className="ob-group-title">
                    <strong>{item.label}</strong>
                    <span>
                      {item.kickoff ? `${formatKickoff(item.kickoff)} · ` : 'geen starttijd · '}
                      {item.picks.map((p) => describeBet(p)).join(' · ')}
                    </span>
                  </div>
                </header>
                {item.candidates.map((c) => (
                  <div className="ob-pick" key={c.id}>
                    <div className="ob-pick-info">
                      <span className="ob-pick-name">
                        {c.home} – {c.away}
                      </span>
                      <span className="ob-pick-meta">
                        <span className="ob-bk">{c.league}</span>
                        <span>{candidateState(c)}</span>
                      </span>
                    </div>
                    <span className={`suggest-score${c.score >= 0.9 ? ' is-strong' : ''}`}>{Math.round(c.score * 100)}%</span>
                    <button
                      type="button"
                      className="btn btn-primary btn-small"
                      disabled={busyKey !== null}
                      onClick={() => link(item, c)}
                    >
                      {busyKey === item.key ? 'Koppelen…' : 'Koppel'}
                    </button>
                  </div>
                ))}
              </section>
            ))}
            {without.length > 0 && (
              <details className="suggest-none">
                <summary>Geen suggestie gevonden ({without.length})</summary>
                <ul>
                  {without.map((item) => (
                    <li key={item.key}>
                      {item.label}
                      <span className="muted"> · {item.kickoff ? formatKickoff(item.kickoff) : 'geen starttijd'}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
