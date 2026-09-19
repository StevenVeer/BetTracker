import { useMemo } from 'react';
import { describeBet } from '../markets.js';
import { formatKickoff, legLabel, ScoreBadge } from './BetList.jsx';

// Picks van dezelfde wedstrijd onder één kop, op aftrap gesorteerd. De
// live-koppelstatus hangt aan de match (één keer in de kop); handmatig
// ingevoerde selecties hebben geen match-rij en worden per leg gekoppeld,
// dus daar blijft de ScoreBadge op de pick zelf staan.
function groupPicks(picks) {
  const groups = new Map();
  for (const pick of picks) {
    const key = pick.match ? `m:${pick.match.id}` : `l:${pick.manualLabel || pick.id}`;
    if (!groups.has(key)) groups.set(key, { key, manual: !pick.match, picks: [] });
    groups.get(key).picks.push(pick);
  }
  const time = (g) => {
    const t = g.picks[0].match?.commenceTime;
    return t ? new Date(t).getTime() : Infinity;
  };
  return [...groups.values()].sort((a, b) => time(a) - time(b));
}

export default function OpenBetsModal({
  picks,
  onClose,
  onLiveLinked,
  onSettle,
  title = 'Open bets',
  emptyText = 'Geen open picks.',
}) {
  const groups = useMemo(() => groupPicks(picks), [picks]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal open-bets-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>
            {title} ({picks.length})
            {groups.length !== picks.length && <span className="open-bets-sub"> · {groups.length} wedstrijden</span>}
          </h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Sluiten" title="Sluiten">
            ×
          </button>
        </div>

        {picks.length === 0 ? (
          <p className="hint-text">{emptyText}</p>
        ) : (
          <div className="ob-groups">
            {groups.map((group) => {
              const first = group.picks[0];
              const count = group.picks.length;
              return (
                <section className="ob-group" key={group.key}>
                  <header className="ob-group-head">
                    <div className="ob-group-title">
                      <strong>{legLabel(first)}</strong>
                      <span>
                        {first.match ? `${formatKickoff(first.match.commenceTime)} · ` : ''}
                        {count} {count === 1 ? 'pick' : 'picks'}
                      </span>
                    </div>
                    {!group.manual && <ScoreBadge leg={first} onLinked={onLiveLinked} />}
                  </header>
                  {group.picks.map((pick) => (
                    <div className="ob-pick" key={pick.id}>
                      <div className="ob-pick-info">
                        <span className="ob-pick-name">{describeBet(pick)}</span>
                        <span className="ob-pick-meta">
                          <span className="ob-bk">{pick.bookmaker}</span>
                          {pick.isCombi && <span className="ob-combi">combi</span>}
                          {group.manual && <ScoreBadge leg={pick} onLinked={onLiveLinked} />}
                        </span>
                      </div>
                      <span className="ob-odds">@ {Number(pick.odds).toFixed(2)}</span>
                      <span className="ob-actions">
                        <button
                          type="button"
                          className="ob-btn ob-won"
                          title="Gewonnen"
                          aria-label="Gewonnen"
                          onClick={() => onSettle(pick.id, { status: 'won' })}
                        >
                          ✓
                        </button>
                        <button
                          type="button"
                          className="ob-btn ob-lost"
                          title="Verloren"
                          aria-label="Verloren"
                          onClick={() => onSettle(pick.id, { status: 'lost' })}
                        >
                          ✕
                        </button>
                      </span>
                    </div>
                  ))}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
