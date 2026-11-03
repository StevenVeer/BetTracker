import { useMemo } from 'react';
import { bookmakerSummary, describeBet, groupSamePicks, isBetBuilder, oddsRange, withPartStatus } from '../markets.js';
import { formatKickoff, legKickoff, legLabel, ScoreBadge } from './BetList.jsx';
import { BuilderPartRows } from './liveShared.jsx';
import EarlyPayoutBadge from './EarlyPayoutBadge.jsx';

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
    const t = legKickoff(g.picks[0]);
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
              // Dezelfde pick uit meerdere bets: één regel, afhandelen geldt voor alle.
              const rows = groupSamePicks(group.picks);
              return (
                <section className="ob-group" key={group.key}>
                  <header className="ob-group-head">
                    <div className="ob-group-title">
                      <strong>{legLabel(first)}</strong>
                      <span>
                        {legKickoff(first) ? `${formatKickoff(legKickoff(first))} · ` : ''}
                        {rows.length} {rows.length === 1 ? 'pick' : 'picks'}
                        {rows.length !== count && ` · ${count} bets`}
                      </span>
                    </div>
                    {!group.manual && <ScoreBadge leg={first} onLinked={onLiveLinked} />}
                  </header>
                  {rows.map(({ key, pick, picks: same }) => (
                    <div className="ob-pick" key={key}>
                      <span className={`ob-count${same.length > 1 ? ' is-multi' : ''}`}>{same.length}×</span>
                      <div className="ob-pick-info">
                        <span className="ob-pick-name">{isBetBuilder(pick) ? `Bet builder · ${pick.parts.length} selecties` : describeBet(pick)}<EarlyPayoutBadge leg={pick} /></span>
                        <span className="ob-pick-meta">
                          <span className="ob-bk-summary">{bookmakerSummary(same)}</span>
                          {group.manual && <ScoreBadge leg={pick} onLinked={onLiveLinked} />}
                        </span>
                        {isBetBuilder(pick) && (
                          <BuilderPartRows
                            parts={pick.parts}
                            onSettlePart={(i, status) => onSettle(pick.id, { partStatuses: withPartStatus(pick.parts, i, status) })}
                          />
                        )}
                      </div>
                      <span className="ob-odds">@ {oddsRange(same)}</span>
                      {!isBetBuilder(pick) && (
                      <span className="ob-actions">
                        <button
                          type="button"
                          className="ob-btn ob-won"
                          title={same.length > 1 ? `Gewonnen (alle ${same.length})` : 'Gewonnen'}
                          aria-label="Gewonnen"
                          onClick={() => same.forEach((p) => onSettle(p.id, { status: 'won' }))}
                        >
                          ✓
                        </button>
                        <button
                          type="button"
                          className="ob-btn ob-lost"
                          title={same.length > 1 ? `Verloren (alle ${same.length})` : 'Verloren'}
                          aria-label="Verloren"
                          onClick={() => same.forEach((p) => onSettle(p.id, { status: 'lost' }))}
                        >
                          ✕
                        </button>
                      </span>
                      )}
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
