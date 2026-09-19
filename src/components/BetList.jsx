import { useEffect, useRef, useState } from 'react';
import { describeBet, STATUS_LABELS } from '../markets.js';
import { api } from '../api.js';
import { Amount } from './AmountsToggle.jsx';

export function formatKickoff(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('nl-NL', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function legLabel(leg) {
  return leg.match ? `${leg.match.home} – ${leg.match.away}` : leg.manualLabel || 'Handmatige selectie';
}

// Voor <input type="datetime-local">, dat een waarde zonder tijdzone
// verwacht (YYYY-MM-DDTHH:mm) in de lokale tijd van de browser.
function toDatetimeLocalValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Doorgestreepte oude odds + nieuwe alleen tonen als de opgeslagen odds echt
// hoger liggen dan het pure product van de legs — en niet als dat verschil
// eigenlijk komt van een void-leg die de odds al heeft bijgesteld bij
// settlement.
function isBoostedBet(bet) {
  const rawOdds = bet.legs.reduce((acc, leg) => acc * Number(leg.odds), 1);
  return !bet.legs.some((leg) => leg.status === 'void') && bet.odds - rawOdds > 0.005;
}

// Modal met de huidige live wedstrijden (uit de getrackte competities) om
// een pick handmatig aan te koppelen - voor als de automatische fuzzy-match
// op team-/competitienaam een keer misgrijpt, of om een volledig handmatig
// ingevoerde selectie (geen match_id, dus nooit automatisch gecheckt) voor
// het eerst aan een live wedstrijd te hangen. Verandert nooit bet_legs.status
// of een payout, alleen welke live-score er op de pick wordt getoond.
// Precies één van matchId/legId is gezet: matchId voor een bestaande Odds
// API-wedstrijd (api.linkLiveMatch), legId voor een handmatige selectie
// zonder matches-rij (api.linkLegToLiveMatch, die er alsnog één aanmaakt).
function LiveLinkModal({ matchLabel, matchId, legId, onLinked, onClose }) {
  const [liveMatches, setLiveMatches] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .getLiveScores()
      .then((data) => setLiveMatches(data.matches || []))
      .catch(() => setLiveMatches([]));
  }, []);

  async function pick(liveMatch) {
    setSaving(true);
    try {
      if (matchId) {
        await api.linkLiveMatch(matchId, liveMatch.id);
      } else {
        await api.linkLegToLiveMatch(legId, liveMatch);
      }
      await onLinked();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Koppel live wedstrijd</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Sluiten" title="Sluiten">
            ×
          </button>
        </div>
        <p className="hint-text live-link-modal-subtitle">{matchLabel}</p>
        {liveMatches === null ? (
          <p className="hint-text">Laden…</p>
        ) : liveMatches.length === 0 ? (
          <p className="hint-text">Nu geen live wedstrijden in je getrackte competities.</p>
        ) : (
          <div className="live-link-modal-list">
            {liveMatches.map((m) => (
              <button key={m.id} type="button" className="menu-row" disabled={saving} onClick={() => pick(m)}>
                <span>
                  {m.home} – {m.away}
                </span>
                <span className="badge">{m.league}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ScoreBadge({ leg, onLinked }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const match = leg?.match;

  if (match && match.homeScore !== null && match.homeScore !== undefined) {
    const isLive = match.status === 'live';
    return (
      <span className={`score-badge ${isLive ? 'is-live' : ''}`}>
        {isLive && <span className="live-dot" />}
        {match.homeScore} - {match.awayScore}
      </span>
    );
  }
  // Wél gecheckt tegen de live-feed, maar geen match gevonden (bv. een
  // afwijkende teamnaam) - dan moet je 'm zelf via de knop bijhouden, tenzij
  // je 'm hier handmatig aan een live wedstrijd koppelt.
  if (match && match.liveTracked === false) {
    return (
      <span className="untracked-wrap">
        {onLinked && (
          <>
            <button
              type="button"
              className="live-link-btn"
              title="Geen live match gevonden - koppel 'm aan een live wedstrijd"
              onClick={() => setPickerOpen(true)}
            >
              koppel
            </button>
            {pickerOpen && (
              <LiveLinkModal
                matchId={match.id}
                matchLabel={`${match.home} – ${match.away}`}
                onLinked={onLinked}
                onClose={() => setPickerOpen(false)}
              />
            )}
          </>
        )}
      </span>
    );
  }
  // Volledig handmatig ingevoerde selectie (geen match_id, dus nooit
  // gecheckt tegen de live-feed) - hier alleen aanbieden zolang de pick nog
  // open is, net als de koppelknop hierboven.
  if (!match && leg?.status === 'open' && leg?.manualLabel && onLinked) {
    return (
      <span className="untracked-wrap">
        <span className="score-badge score-badge-untracked" title="Handmatig ingevoerde wedstrijd - koppel 'm aan een live wedstrijd om de score te volgen">
          handmatig
        </span>
        <button type="button" className="live-link-btn" onClick={() => setPickerOpen(true)}>
          koppel
        </button>
        {pickerOpen && (
          <LiveLinkModal
            legId={leg.id}
            matchLabel={leg.manualLabel}
            onLinked={onLinked}
            onClose={() => setPickerOpen(false)}
          />
        )}
      </span>
    );
  }
  return null;
}

function LegRow({ leg, onLiveLinked }) {
  return (
    <div className="leg-row">
      <div className="leg-info">
        <span className="leg-match">{legLabel(leg)}</span>
        <span className="muted">
          {describeBet(leg)}
          {leg.match ? ` · ${formatKickoff(leg.match.commenceTime)}` : ''}
        </span>
      </div>
      <ScoreBadge leg={leg} onLinked={onLiveLinked} />
      <span className="leg-odds">@ {Number(leg.odds).toFixed(2)}</span>
      <span className={`leg-status leg-status-${leg.status}`}>{STATUS_LABELS[leg.status]}</span>
    </div>
  );
}

const MANUAL_STATUSES = ['won', 'lost', 'void', 'cashed_out'];
const LEG_STATUS_OPTIONS = [
  { key: 'open', icon: '○', title: 'Open' },
  { key: 'won', icon: '✓', title: 'Gewonnen' },
  { key: 'lost', icon: '✕', title: 'Verloren' },
  { key: 'void', icon: '⌀', title: 'Void' },
];

// Picks van dezelfde wedstrijd onder één kop (net als in OpenBetsModal);
// handmatige selecties hebben geen match-rij en blijven per leg staan.
function groupLegs(legs) {
  const groups = new Map();
  for (const leg of legs) {
    const key = leg.match ? `m:${leg.match.id}` : `l:${leg.id}`;
    if (!groups.has(key)) groups.set(key, { key, manual: !leg.match, legs: [] });
    groups.get(key).legs.push(leg);
  }
  return [...groups.values()];
}

const FILL_THRESHOLD = 1.015; // 1.00 en 1.01 tellen als "odds onbekend"
const numChanged = (draft, original) => Math.abs(Number(draft) - Number(original)) > 0.0001;

// Bewerken van een bet (combi of single) gebeurt volledig op een concept:
// niets gaat naar de server voordat je op Opslaan drukt. Een leg op "verloren"
// zetten maakt de bet dus pas verloren bij opslaan - de server beoordeelt de
// hele bet namelijk direct na elke leg-wijziging (zie reevaluateBet).
// Opslaan-volgorde is bewust: leg-odds -> leg-uitslagen -> bet-velden. De
// server herberekent de bet-odds/-payout na een leg-wijziging, dus wat je
// handmatig op bet-niveau hebt ingevuld moet als laatste worden weggeschreven.
function EditBetModal({ bet, onUpdate, onUpdateLeg, onLiveLinked, onClose }) {
  const isCombi = bet.legs.length > 1;
  const [legDraft, setLegDraft] = useState(() =>
    Object.fromEntries(bet.legs.map((l) => [l.id, { status: l.status, odds: Number(l.odds).toFixed(2) }]))
  );
  const initialFields = {
    odds: Number(bet.odds).toFixed(2),
    stake: Number(bet.stake).toFixed(2),
    payout: Number(bet.potentialPayout).toFixed(2),
    placedAt: toDatetimeLocalValue(bet.placedAt),
    settledAt: toDatetimeLocalValue(bet.settledAt),
  };
  const [fields, setFields] = useState(initialFields);
  const [payoutTouched, setPayoutTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fillUsed, setFillUsed] = useState(false);
  const [fillMsg, setFillMsg] = useState('');
  const totalRef = useRef(null);

  function setLeg(id, patch) {
    setLegDraft((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }
  function setField(name, value) {
    setFields((prev) => {
      const next = { ...prev, [name]: value };
      // Zolang je de uitbetaling niet zelf hebt overschreven, loopt hij mee
      // met odds × inzet (zoals de server het ook afleidt).
      if ((name === 'odds' || name === 'stake') && !payoutTouched) {
        const payout = Number(next.odds) * Number(next.stake);
        if (Number.isFinite(payout)) next.payout = payout.toFixed(2);
      }
      return next;
    });
  }

  const legChanges = bet.legs.map((leg) => {
    const d = legDraft[leg.id];
    return {
      leg,
      oddsChanged: !isCombi ? false : numChanged(d.odds, leg.odds),
      statusChanged: d.status !== leg.status,
      // Bestaande leg-odds onder 1.01 (bv. 1.00 bij een import zonder odds)
      // mogen blijven staan; alleen een nieuw ingevoerde waarde wordt gecheckt.
      oddsInvalid: isCombi && numChanged(d.odds, leg.odds) && !(Number(d.odds) >= 1.01),
    };
  });

  // Picks zonder echte odds (1.00/1.01, bv. een import zonder odds): verdeel
  // wat er van de totale odds overblijft na de bekende picks gelijk over
  // de lege picks. Void-picks tellen mee met hun eigen odds (server-conventie).
  const missingLegs = isCombi ? bet.legs.filter((l) => l.status !== 'void' && !(Number(legDraft[l.id].odds) >= FILL_THRESHOLD)) : [];

  // Andersom: alle picks hebben odds maar het totaal staat nog op 1.00/1.01.
  const totalMissing = isCombi && !(Number(fields.odds) >= FILL_THRESHOLD);

  function computeTotal() {
    const product = bet.legs.reduce((acc, l) => acc * (l.status === 'void' ? 1 : Number(legDraft[l.id].odds)), 1);
    setField('odds', product.toFixed(2));
    setFillMsg('');
  }

  function fillMissingOdds() {
    const total = Number(fields.odds);
    const known = bet.legs
      .filter((l) => !missingLegs.includes(l))
      .reduce((acc, l) => acc * Math.max(1, Number(legDraft[l.id].odds) || 1), 1);
    const rest = total / known;
    const share = Math.pow(rest, 1 / missingLegs.length);
    if (!(total >= FILL_THRESHOLD)) {
      setFillMsg('vul eerst de totale odds in (het veld "Totaal @"), dan verdeel ik die over de picks');
      totalRef.current?.focus();
      totalRef.current?.select();
      return;
    }
    if (!(share >= 1.01)) {
      setFillMsg('het totaal is te laag om over deze picks te verdelen; pas het totaal of de andere odds aan');
      totalRef.current?.focus();
      return;
    }
    const rounded = Number(share.toFixed(2));
    let left = rest;
    const next = {};
    missingLegs.forEach((l, i) => {
      const value = i < missingLegs.length - 1 ? rounded : Math.max(1.01, Number(left.toFixed(2)));
      next[l.id] = value.toFixed(2);
      left /= value;
    });
    setLegDraft((prev) => {
      const out = { ...prev };
      for (const [id, odds] of Object.entries(next)) out[id] = { ...out[id], odds };
      return out;
    });
    setFillUsed(true);
    setFillMsg('');
  }

  const betPatch = {};
  if (numChanged(fields.odds, bet.odds)) betPatch.odds = Number(fields.odds);
  if (numChanged(fields.stake, bet.stake)) betPatch.stake = Number(fields.stake);
  if (payoutTouched && numChanged(fields.payout, bet.potentialPayout)) betPatch.potentialPayout = Number(fields.payout);
  // De server rekent het totaal opnieuw uit na elke leg-odds wijziging; na
  // aanvullen moet het totaal (boost, afronding) juist blijven zoals het staat.
  if (fillUsed) {
    betPatch.odds = Number(fields.odds);
    betPatch.potentialPayout = Number(fields.payout);
  }
  if (fields.placedAt && fields.placedAt !== initialFields.placedAt) betPatch.placedAt = new Date(fields.placedAt).toISOString();
  if (fields.settledAt && fields.settledAt !== initialFields.settledAt) betPatch.settledAt = new Date(fields.settledAt).toISOString();

  const legChangeCount = legChanges.filter((c) => c.oddsChanged || c.statusChanged).length;
  const changeCount = legChangeCount + Object.keys(betPatch).length;
  const invalid =
    legChanges.some((c) => c.oddsInvalid) || !(Number(fields.odds) >= 1.01) || !(Number(fields.stake) > 0);

  const hasLostDraft = legChanges.some((c) => c.statusChanged && legDraft[c.leg.id].status === 'lost');

  async function save() {
    setSaving(true);
    try {
      for (const c of legChanges) if (c.oddsChanged) await onUpdateLeg(c.leg.id, { odds: Number(legDraft[c.leg.id].odds) });
      for (const c of legChanges) if (c.statusChanged) await onUpdateLeg(c.leg.id, { status: legDraft[c.leg.id].status });
      if (Object.keys(betPatch).length > 0) await onUpdate(bet.id, betPatch);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  function requestClose() {
    if (changeCount > 0 && !window.confirm('Je hebt niet-opgeslagen wijzigingen. Toch sluiten?')) return;
    onClose();
  }

  const groups = groupLegs(bet.legs);

  return (
    <div className="modal-backdrop" onClick={changeCount === 0 ? onClose : undefined}>
      <div className="modal edit-bet-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header eb-head">
          <h3>
            {isCombi ? 'Combi bewerken' : 'Bet bewerken'}
            <span className="open-bets-sub">
              {' '}
              · {bet.bookmaker}
              {isCombi ? ` · ${bet.legs.length} selecties` : ''}
            </span>
          </h3>
          <button type="button" className="modal-close" onClick={requestClose} aria-label="Sluiten" title="Sluiten">
            ×
          </button>
        </div>

        <div className="eb-body">
          {groups.map((group) => {
            const first = group.legs[0];
            return (
              <section className="ob-group" key={group.key}>
                <header className="ob-group-head">
                  <div className="ob-group-title">
                    <strong>{legLabel(first)}</strong>
                    <span>
                      {first.match ? `${formatKickoff(first.match.commenceTime)} · ` : ''}
                      {group.legs.length} {group.legs.length === 1 ? 'pick' : 'picks'}
                    </span>
                  </div>
                  {!group.manual && <ScoreBadge leg={first} onLinked={onLiveLinked} />}
                </header>
                {group.legs.map((leg) => {
                  const d = legDraft[leg.id];
                  const changed = d.status !== leg.status || (isCombi && numChanged(d.odds, leg.odds));
                  return (
                    <div className={`eb-pick${changed ? ' is-changed' : ''}`} key={leg.id}>
                      <div className="ob-pick-info">
                        <span className="ob-pick-name">{describeBet(leg)}</span>
                        {group.manual && <ScoreBadge leg={leg} onLinked={onLiveLinked} />}
                      </div>
                      {isCombi && (
                        <input
                          type="number"
                          step="0.01"
                          min="1.01"
                          className={`odds-edit-input${legChanges.find((c) => c.leg.id === leg.id)?.oddsInvalid ? ' is-invalid' : ''}`}
                          value={d.odds}
                          onChange={(e) => setLeg(leg.id, { odds: e.target.value })}
                          aria-label="Odds van deze selectie"
                        />
                      )}
                      <span className="eb-seg" role="group" aria-label="Uitslag van deze selectie">
                        {LEG_STATUS_OPTIONS.map((o) => (
                          <button
                            key={o.key}
                            type="button"
                            className={`eb-seg-btn eb-${o.key}${d.status === o.key ? ' on' : ''}`}
                            title={o.title}
                            aria-label={o.title}
                            aria-pressed={d.status === o.key}
                            onClick={() => setLeg(leg.id, { status: o.key })}
                          >
                            {o.icon}
                          </button>
                        ))}
                      </span>
                      <span className={`eb-dot${changed ? ' on' : ''}`} title="Niet opgeslagen" />
                    </div>
                  );
                })}
              </section>
            );
          })}

          {(missingLegs.length > 0 || totalMissing) && (
            <div className="eb-note eb-fill">
              <span>
                {missingLegs.length > 0
                  ? `${missingLegs.length} ${missingLegs.length === 1 ? 'pick staat' : 'picks staan'} op 1.00 of 1.01`
                  : 'De totale odds staan op 1.00 of 1.01'}
                {fillMsg && <span className="eb-fill-msg"> — {fillMsg}</span>}
              </span>
              <button type="button" className="btn btn-ghost" onClick={missingLegs.length > 0 ? fillMissingOdds : computeTotal}>
                {missingLegs.length > 0 ? 'Odds aanvullen' : 'Totaal berekenen'}
              </button>
            </div>
          )}

          <div className="eb-totals">
            <label>
              Totaal @
              <input
                ref={totalRef}
                type="number"
                step="0.01"
                min="1.01"
                className="odds-edit-input"
                value={fields.odds}
                onChange={(e) => setField('odds', e.target.value)}
              />
            </label>
            <label>
              Inzet €
              <input
                type="number"
                step="0.01"
                min="0.01"
                className="odds-edit-input stake-edit-input"
                value={fields.stake}
                onChange={(e) => setField('stake', e.target.value)}
              />
            </label>
            <label>
              → €
              <input
                type="number"
                step="0.01"
                className="odds-edit-input payout-edit-input"
                value={fields.payout}
                onChange={(e) => {
                  setPayoutTouched(true);
                  setFields((prev) => ({ ...prev, payout: e.target.value }));
                }}
              />
            </label>
            <label className="eb-dates">
              <span className="muted">geplaatst</span>
              <input
                type="datetime-local"
                className="placed-at-edit-input"
                value={fields.placedAt}
                onChange={(e) => setField('placedAt', e.target.value)}
              />
            </label>
            {bet.settledAt && (
              <label className="eb-dates">
                <span className="muted">afgerond</span>
                <input
                  type="datetime-local"
                  className="placed-at-edit-input"
                  value={fields.settledAt}
                  onChange={(e) => setField('settledAt', e.target.value)}
                />
              </label>
            )}
          </div>

          {hasLostDraft && bet.status === 'open' && (
            <div className="eb-note eb-note-warn">
              Een selectie staat op <b>Verloren</b> — {isCombi ? 'de hele combi' : 'de bet'} wordt verloren zodra je opslaat.
            </div>
          )}
          {legChanges.some((c) => c.statusChanged) && bet.status !== 'open' && (
            <div className="eb-note">
              Deze bet is al afgerond: de uitslag van een selectie wijzigen past de status van de bet zelf niet automatisch aan.
            </div>
          )}
        </div>

        <div className="eb-foot">
          <span className="eb-foot-status">
            {changeCount > 0 ? (
              <>
                <i className="eb-dot on" />
                {changeCount} niet-opgeslagen {changeCount === 1 ? 'wijziging' : 'wijzigingen'}
              </>
            ) : (
              <span className="muted">Geen wijzigingen</span>
            )}
          </span>
          <span className="eb-foot-btns">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
              Annuleren
            </button>
            <button type="button" className="btn btn-primary" onClick={save} disabled={saving || changeCount === 0 || invalid}>
              {saving ? 'Opslaan…' : 'Opslaan'}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

export default function BetList({ bets, onUpdate, onUpdateLeg, onDelete, onLiveLinked }) {
  const [editingId, setEditingId] = useState(null);
  const editingBet = editingId ? bets.find((b) => b.id === editingId) : null;

  if (bets.length === 0) {
    return <p className="hint-text">Nog geen bets in dit filter.</p>;
  }

  return (
    <>
      <ul className="bet-list">
        {bets.map((bet) => {
          const isCombi = bet.legs.length > 1;
          const boosted = isBoostedBet(bet);
          const rawOdds = bet.legs.reduce((acc, leg) => acc * Number(leg.odds), 1);
          const oddsCell = (
            <>
              {boosted && <s className="odds-was">{rawOdds.toFixed(2)}</s>} {Number(bet.odds).toFixed(2)}
            </>
          );

          return (
            <li key={bet.id} className={`bet-row status-${bet.status}`}>
              <div className="bet-row-controls">
                <button type="button" className="bet-edit" onClick={() => setEditingId(bet.id)} aria-label="Bet bewerken" title="Bet bewerken">
                  ✎
                </button>
                <button type="button" className="bet-close" onClick={() => onDelete(bet.id)} aria-label="Bet verwijderen" title="Bet verwijderen">
                  ×
                </button>
              </div>

              {isCombi ? (
                <>
                  <div className="bet-combi-heading">
                    <span className="muted">Combi · {bet.legs.length} selecties · {bet.bookmaker}</span>
                  </div>
                  <div className="leg-list">
                    {bet.legs.map((leg) => (
                      <LegRow key={leg.id} leg={leg} onLiveLinked={onLiveLinked} />
                    ))}
                  </div>
                  <div className="bet-main bet-main-combi">
                    <span className="bet-numbers">
                      <span>Totaal @ {oddsCell}</span>
                      <span>
                        EUR <Amount>{Number(bet.stake).toFixed(2)}</Amount>
                      </span>
                      <span className="payout">
                        → <Amount>{`EUR ${Number(bet.potentialPayout).toFixed(2)}`}</Amount>
                      </span>
                    </span>
                    <span className={`status-badge status-${bet.status}`}>{STATUS_LABELS[bet.status]}</span>
                  </div>
                </>
              ) : (
                <div className="bet-main">
                  <div className="bet-match">
                    <strong>{legLabel(bet.legs[0])}</strong>
                    <span className="muted">
                      {bet.legs[0].match ? `${bet.legs[0].match.competition} · ${formatKickoff(bet.legs[0].match.commenceTime)}` : 'Handmatig'}
                    </span>
                  </div>
                  <div className="bet-selection">
                    <span>{describeBet(bet.legs[0])}</span>
                    <span className="muted">{bet.bookmaker}</span>
                  </div>
                  <div className="bet-numbers">
                    <span>@ {oddsCell}</span>
                    <span>
                      EUR <Amount>{Number(bet.stake).toFixed(2)}</Amount>
                    </span>
                    <span className="payout">
                      → <Amount>{`EUR ${Number(bet.potentialPayout).toFixed(2)}`}</Amount>
                    </span>
                  </div>
                  <ScoreBadge leg={bet.legs[0]} onLinked={onLiveLinked} />
                  <span className={`status-badge status-${bet.status}`}>{STATUS_LABELS[bet.status]}</span>
                </div>
              )}

              {bet.status === 'open' && (
                <div className="bet-actions">
                  {MANUAL_STATUSES.map((status) => (
                    <button key={status} className="btn btn-ghost btn-small" onClick={() => onUpdate(bet.id, { status })}>
                      {STATUS_LABELS[status]}
                    </button>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {editingBet && (
        <EditBetModal
          key={editingBet.id}
          bet={editingBet}
          onUpdate={onUpdate}
          onUpdateLeg={onUpdateLeg}
          onLiveLinked={onLiveLinked}
          onClose={() => setEditingId(null)}
        />
      )}
    </>
  );
}
