import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { describeBet } from '../markets.js';
import { formatKickoff, legLabel } from './BetList.jsx';
import PlannedBetForm from './PlannedBetForm.jsx';

const WEEKDAY_DATE_FORMAT = new Intl.DateTimeFormat('nl-NL', { weekday: 'long', day: 'numeric', month: 'short' });
const CHIP_DATE_FORMAT = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short' });

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// "Vandaag"/"Morgen" voor de eerstkomende dagen (net als de rest van de app),
// daarna gewoon de volledige weekdag + datum (bv. "Zaterdag 20 sep").
function dayHeading(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${dateStr}T00:00:00`);
  const diffDays = Math.round((target - today) / 86400000);
  if (diffDays === 0) return 'Vandaag';
  if (diffDays === 1) return 'Morgen';
  return capitalize(WEEKDAY_DATE_FORMAT.format(target));
}

function groupByForDate(plannedBets) {
  const sorted = [...plannedBets].sort((a, b) => a.forDate.localeCompare(b.forDate));
  const map = new Map();
  for (const planned of sorted) {
    const list = map.get(planned.forDate) || [];
    list.push(planned);
    map.set(planned.forDate, list);
  }
  return [...map.entries()].map(([date, items]) => ({ date, items }));
}

// Odds van het opzetje zelf (handmatige override) wint, anders het product van
// de legs zodra die allemaal een odds hebben - net als de "totale odds" in
// BetForm, maar hier mag het gewoon (nog) onbekend blijven.
function displayOdds(planned) {
  if (planned.odds != null) return planned.odds;
  if (planned.legs.some((leg) => leg.odds == null)) return null;
  return planned.legs.reduce((acc, leg) => acc * Number(leg.odds), 1);
}

function PlannedBetRow({ planned, bookmakers, onPlaced, onRemoved, onError }) {
  const [placing, setPlacing] = useState(false);
  const [bookmaker, setBookmaker] = useState(planned.bookmaker || '');
  const [stake, setStake] = useState('');
  const [legOdds, setLegOdds] = useState(() => planned.legs.map((leg) => (leg.odds != null ? String(leg.odds) : '')));
  const [submitting, setSubmitting] = useState(false);
  const [rowError, setRowError] = useState(null);

  const isCombi = planned.legs.length > 1;
  const odds = displayOdds(planned);
  const allOddsFilled = legOdds.every((value) => value !== '' && Number(value) >= 1.01);
  const finalOdds = allOddsFilled ? legOdds.reduce((acc, value) => acc * Number(value), 1) : null;

  function updateLegOdds(index, value) {
    setLegOdds((prev) => prev.map((v, i) => (i === index ? value : v)));
  }

  async function handleDelete() {
    try {
      await api.deletePlannedBet(planned.id);
      onRemoved(planned.id);
    } catch (err) {
      onError(err.message);
    }
  }

  async function confirmPlace() {
    setRowError(null);
    if (!bookmaker) {
      setRowError('Kies een bookmaker.');
      return;
    }
    if (!stake || Number(stake) <= 0) {
      setRowError('Vul een inzet in.');
      return;
    }
    if (!allOddsFilled) {
      setRowError('Vul odds in voor elke selectie.');
      return;
    }
    setSubmitting(true);
    try {
      const created = await api.createBet({
        bookmaker,
        stake: Number(stake),
        odds: finalOdds,
        legs: planned.legs.map((leg, index) => ({
          match: leg.match,
          manualLabel: leg.match ? null : leg.manualLabel,
          market: leg.market,
          selection: leg.selection,
          line: leg.line,
          odds: Number(legOdds[index]),
        })),
      });
      await api.deletePlannedBet(planned.id);
      onPlaced(created);
      onRemoved(planned.id);
    } catch (err) {
      setRowError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={`planned-row${isCombi ? ' is-combi' : ''}`}>
      <div className="planned-row-main">
        <div className="leg-info">
          <span className="leg-match">{isCombi ? `Combi (${planned.legs.length} selecties)` : legLabel(planned.legs[0])}</span>
          <span className="muted">
            {!isCombi && `${describeBet(planned.legs[0])}`}
            {!isCombi && planned.legs[0].match ? ` · ${formatKickoff(planned.legs[0].match.commenceTime)}` : ''}
            {isCombi && !planned.bookmaker ? 'Nog geen bookmaker gekozen' : ''}
            {planned.bookmaker && <span className="bet-tag">{planned.bookmaker}</span>}
          </span>
          {planned.notes && <span className="planned-notes">{planned.notes}</span>}
        </div>

        <span className={`planned-odds${odds ? '' : ' is-unknown'}`}>
          {odds ? `@ ${Number(odds).toFixed(2)}` : isCombi ? 'nog niet compleet' : 'nog onbekend'}
        </span>

        {!placing ? (
          <div className="planned-row-actions">
            <button type="button" className="btn btn-primary btn-small" onClick={() => setPlacing(true)}>
              Plaatsen
            </button>
            <button type="button" className="planned-del" title="Opzetje verwijderen" onClick={handleDelete}>
              ×
            </button>
          </div>
        ) : (
          <div className="planned-row-actions placing-form">
            {planned.legs.map((leg, index) => (
              <input
                key={leg.id}
                type="number"
                step="0.01"
                min="1.01"
                placeholder={isCombi ? `Odds ${index + 1}` : 'Odds'}
                value={legOdds[index]}
                onChange={(e) => updateLegOdds(index, e.target.value)}
              />
            ))}
            <select value={bookmaker} onChange={(e) => setBookmaker(e.target.value)}>
              <option value="">Bookmaker</option>
              {bookmakers.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
            <input type="number" step="0.01" min="0" placeholder="Inzet" value={stake} onChange={(e) => setStake(e.target.value)} />
            {isCombi && <span className="placing-stake-label">Totaal {finalOdds ? finalOdds.toFixed(2) : '—'}</span>}
            <button type="button" className="btn btn-primary btn-small" onClick={confirmPlace} disabled={submitting}>
              {submitting ? '…' : 'Bevestigen'}
            </button>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setPlacing(false)}>
              Annuleren
            </button>
          </div>
        )}
      </div>

      {isCombi && (
        <div className="leg-list planned-combi-legs">
          {planned.legs.map((leg) => (
            <div className="leg-row" key={leg.id}>
              <div className="leg-info">
                <span className="leg-match">{legLabel(leg)}</span>
                <span className="muted">
                  {describeBet(leg)}
                  {leg.match ? ` · ${formatKickoff(leg.match.commenceTime)}` : ''}
                </span>
              </div>
              <span className="leg-odds" style={leg.odds ? undefined : { opacity: 0.35, fontStyle: 'italic' }}>
                {leg.odds ? `@ ${Number(leg.odds).toFixed(2)}` : '?'}
              </span>
            </div>
          ))}
        </div>
      )}

      {rowError && <p className="error-text">{rowError}</p>}
    </div>
  );
}

export default function PlannedBetsModal({ plannedBets, onClose, onCreated, onRemoved, onPlaced }) {
  const [error, setError] = useState(null);
  const [bookmakers, setBookmakers] = useState([]);

  useEffect(() => {
    api.getBookmakers().then(setBookmakers).catch(() => {});
  }, []);

  const groups = useMemo(() => groupByForDate(plannedBets), [plannedBets]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal planned-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Geplande bets ({plannedBets.length})</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Sluiten" title="Sluiten">
            ×
          </button>
        </div>
        <p className="hint-text planned-intro">
          Opzetjes voor komende wedstrijden — wedstrijd, markt en selectie liggen al vast, odds/bookmaker/inzet vul je pas
          aan als je 'm ook echt plaatst.
        </p>

        <PlannedBetForm onCreated={onCreated} />

        {error && <p className="error-text">{error}</p>}

        {groups.length === 0 ? (
          <p className="planned-empty">Geen opzetjes meer — tijd om nieuwe te bedenken.</p>
        ) : (
          <div className="planned-groups">
            {groups.map((group) => (
              <div className="planned-day-group" key={group.date}>
                <div className="planned-day-heading">
                  <strong>
                    {dayHeading(group.date)} <span className="today-chip">{CHIP_DATE_FORMAT.format(new Date(`${group.date}T00:00:00`))}</span>
                  </strong>
                  <span>{group.items.length === 1 ? '1 opzetje' : `${group.items.length} opzetjes`}</span>
                </div>
                <div className="planned-list">
                  {group.items.map((planned) => (
                    <PlannedBetRow
                      key={planned.id}
                      planned={planned}
                      bookmakers={bookmakers}
                      onPlaced={onPlaced}
                      onRemoved={onRemoved}
                      onError={setError}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
