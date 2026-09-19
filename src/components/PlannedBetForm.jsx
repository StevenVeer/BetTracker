import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { MARKETS, selectionOptions, describeBet, isLineMarket } from '../markets.js';
import MatchPicker from './MatchPicker.jsx';

const EMPTY_LEG_DRAFT = {
  market: 'team_wint',
  selection: '',
  line: '',
  scoreHome: '',
  scoreAway: '',
  pick: '',
};

const EMPTY_MANUAL_DRAFT = {
  home: '',
  away: '',
  odds: '',
};

function needsLine(market) {
  return isLineMarket(market) || market === 'handicap';
}

// 'anders' heeft geen vaste opties (zie markets.js) - daar is de vrije tekst
// (draft.pick) zelf de selectie, net zoals bij een Telegram-pick die geen
// markt kon worden toegewezen.
function legSelectionFor(draft) {
  if (draft.market === 'correct_score') {
    if (draft.scoreHome === '' || draft.scoreAway === '') return '';
    return `${draft.scoreHome}-${draft.scoreAway}`;
  }
  if (draft.market === 'anders') return draft.pick.trim();
  return draft.selection;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function shiftDateStr(value, days) {
  const next = new Date(`${value}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

const QUICK_DAY_LABELS = ['Vandaag', 'Morgen', 'Overmorgen'];

export default function PlannedBetForm({ onCreated }) {
  const [open, setOpen] = useState(false);
  const [bookmaker, setBookmaker] = useState('');
  const [bookmakers, setBookmakers] = useState([]);
  const [match, setMatch] = useState(null);
  const [legOdds, setLegOdds] = useState('');
  const [legDraft, setLegDraft] = useState(EMPTY_LEG_DRAFT);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualDraft, setManualDraft] = useState(EMPTY_MANUAL_DRAFT);
  const [manualLegDraft, setManualLegDraft] = useState(EMPTY_LEG_DRAFT);
  const [legs, setLegs] = useState([]);
  const [totalOdds, setTotalOdds] = useState('');
  const [forDate, setForDate] = useState(todayStr);
  const [forDateTouched, setForDateTouched] = useState(false);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) api.getBookmakers().then(setBookmakers).catch(() => {});
  }, [open]);

  const options = selectionOptions(legDraft.market, match);
  const manualOptions = selectionOptions(manualLegDraft.market, { home: manualDraft.home, away: manualDraft.away });

  function updateLegDraft(field, value) {
    setLegDraft((d) => ({ ...d, [field]: value }));
  }

  function updateManualLegDraft(field, value) {
    setManualLegDraft((d) => ({ ...d, [field]: value }));
  }

  function chooseForDate(value) {
    setForDateTouched(true);
    setForDate(value);
  }

  function resetForm() {
    setBookmaker('');
    setMatch(null);
    setLegOdds('');
    setLegDraft(EMPTY_LEG_DRAFT);
    setManualDraft(EMPTY_MANUAL_DRAFT);
    setManualLegDraft(EMPTY_LEG_DRAFT);
    setManualOpen(false);
    setLegs([]);
    setTotalOdds('');
    setForDate(todayStr());
    setForDateTouched(false);
    setNotes('');
  }

  function addMatchLeg() {
    setError(null);
    const selection = legSelectionFor(legDraft);
    if (!match) {
      setError('Kies eerst een wedstrijd.');
      return;
    }
    if (!selection) {
      setError('Vul een selectie in voor deze pick.');
      return;
    }
    if (needsLine(legDraft.market) && legDraft.line === '') {
      setError('Vul een lijn in (bv. 2.5, of -1.5 voor een handicap).');
      return;
    }
    const leg = {
      key: `m-${match.id}-${Date.now()}`,
      kind: 'match',
      match,
      label: `${match.home} – ${match.away}`,
      market: legDraft.market,
      selection,
      line: needsLine(legDraft.market) ? Number(legDraft.line) : null,
      odds: legOdds ? Number(legOdds) : null,
    };
    setLegs((ls) => [...ls, leg]);
    setLegDraft(EMPTY_LEG_DRAFT);
    setLegOdds('');
    // Volgt automatisch de datum van de eerste toegevoegde wedstrijd, tot je
    // 'm zelf aanpast - net als bij de totale odds in BetForm.
    if (!forDateTouched) setForDate(new Date(match.commenceTime).toISOString().slice(0, 10));
  }

  function addManualLeg() {
    setError(null);
    const home = manualDraft.home.trim();
    const away = manualDraft.away.trim();
    const selection = legSelectionFor(manualLegDraft);
    if (!home || !away) {
      setError('Vul beide teams in voor de handmatige selectie.');
      return;
    }
    if (!selection) {
      setError('Vul een selectie in voor deze pick.');
      return;
    }
    if (needsLine(manualLegDraft.market) && manualLegDraft.line === '') {
      setError('Vul een lijn in (bv. 2.5, of -1.5 voor een handicap).');
      return;
    }
    const leg = {
      key: `h-${Date.now()}`,
      kind: 'manual',
      match: { home, away },
      label: `${home} – ${away}`,
      manualLabel: `${home} - ${away}`,
      market: manualLegDraft.market,
      selection,
      line: needsLine(manualLegDraft.market) ? Number(manualLegDraft.line) : null,
      odds: manualDraft.odds ? Number(manualDraft.odds) : null,
    };
    setLegs((ls) => [...ls, leg]);
    setManualDraft(EMPTY_MANUAL_DRAFT);
    setManualLegDraft(EMPTY_LEG_DRAFT);
  }

  function removeLeg(key) {
    setLegs((ls) => ls.filter((l) => l.key !== key));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (legs.length === 0) {
      setError('Voeg minstens 1 selectie toe.');
      return;
    }

    setSubmitting(true);
    try {
      const created = await api.createPlannedBet({
        bookmaker: bookmaker || null,
        odds: totalOdds ? Number(totalOdds) : null,
        notes: notes.trim() || null,
        forDate,
        legs: legs.map((leg) => ({
          match: leg.kind === 'match'
            ? {
                id: leg.match.id,
                sportKey: leg.match.sportKey,
                competition: leg.match.competition,
                home: leg.match.home,
                away: leg.match.away,
                commenceTime: leg.match.commenceTime,
              }
            : null,
          manualLabel: leg.kind === 'manual' ? leg.manualLabel : null,
          market: leg.market,
          selection: leg.selection,
          line: leg.line,
          odds: leg.odds,
        })),
      });
      onCreated(created);
      resetForm();
      setOpen(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-primary planned-add-toggle" onClick={() => setOpen(true)}>
        + Nieuw opzetje
      </button>
    );
  }

  const quickDates = [todayStr(), shiftDateStr(todayStr(), 1), shiftDateStr(todayStr(), 2)];

  return (
    <form className="card bet-form planned-add-form" onSubmit={handleSubmit}>
      <div className="card-header">
        <h3>Nieuw opzetje</h3>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            resetForm();
            setOpen(false);
          }}
        >
          Annuleren
        </button>
      </div>

      <MatchPicker selectedMatch={match} onSelect={setMatch} />

      <div className="leg-builder">
        <div className="field-row">
          <label className="field">
            <span>Markt</span>
            <select value={legDraft.market} onChange={(e) => updateLegDraft('market', e.target.value)}>
              {MARKETS.filter((m) => m.key !== 'anders').map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>

          {legDraft.market === 'correct_score' ? (
            <>
              <label className="field">
                <span>Doelpunten thuis</span>
                <input type="number" min="0" placeholder="2" value={legDraft.scoreHome} onChange={(e) => updateLegDraft('scoreHome', e.target.value)} />
              </label>
              <label className="field">
                <span>Doelpunten uit</span>
                <input type="number" min="0" placeholder="1" value={legDraft.scoreAway} onChange={(e) => updateLegDraft('scoreAway', e.target.value)} />
              </label>
            </>
          ) : (
            <label className="field field-grow">
              <span>Selectie</span>
              <select value={legDraft.selection} onChange={(e) => updateLegDraft('selection', e.target.value)}>
                <option value="">Kies selectie</option>
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          {needsLine(legDraft.market) && (
            <label className="field">
              <span>Lijn</span>
              <input
                type="number"
                step="0.25"
                placeholder={legDraft.market === 'handicap' ? '-1.5' : '2.5'}
                value={legDraft.line}
                onChange={(e) => updateLegDraft('line', e.target.value)}
              />
            </label>
          )}

          <label className="field">
            <span>Odds <span className="field-hint">(optioneel)</span></span>
            <input type="number" step="0.01" min="1.01" placeholder="nog onbekend" value={legOdds} onChange={(e) => setLegOdds(e.target.value)} />
          </label>

          <div className="field add-leg-btn-wrap">
            <button type="button" className="btn btn-primary btn-small" onClick={addMatchLeg}>
              + Toevoegen
            </button>
          </div>
        </div>
      </div>

      <div className={`manual-entry${manualOpen ? ' open' : ''}`}>
        <button type="button" className="manual-entry-toggle" onClick={() => setManualOpen((o) => !o)} aria-expanded={manualOpen}>
          <span>Handmatige invoer (wedstrijd niet gevonden?)</span>
          <span className="manual-entry-caret" aria-hidden="true">▾</span>
        </button>
        {manualOpen && (
          <div className="manual-entry-body">
            <div className="field-row">
              <label className="field field-grow">
                <span>Wedstrijd</span>
                <div className="match-teams-input">
                  <input type="text" placeholder="Thuisteam" value={manualDraft.home} onChange={(e) => setManualDraft((d) => ({ ...d, home: e.target.value }))} />
                  <span aria-hidden="true">–</span>
                  <input type="text" placeholder="Uitteam" value={manualDraft.away} onChange={(e) => setManualDraft((d) => ({ ...d, away: e.target.value }))} />
                </div>
              </label>
            </div>
            <div className="field-row">
              <label className="field">
                <span>Markt</span>
                <select value={manualLegDraft.market} onChange={(e) => updateManualLegDraft('market', e.target.value)}>
                  {MARKETS.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>

              {manualLegDraft.market === 'correct_score' ? (
                <>
                  <label className="field">
                    <span>Doelpunten thuis</span>
                    <input type="number" min="0" placeholder="2" value={manualLegDraft.scoreHome} onChange={(e) => updateManualLegDraft('scoreHome', e.target.value)} />
                  </label>
                  <label className="field">
                    <span>Doelpunten uit</span>
                    <input type="number" min="0" placeholder="1" value={manualLegDraft.scoreAway} onChange={(e) => updateManualLegDraft('scoreAway', e.target.value)} />
                  </label>
                </>
              ) : manualLegDraft.market === 'anders' ? (
                <label className="field field-grow">
                  <span>Pick</span>
                  <input type="text" placeholder="bv. Ajax wint" value={manualLegDraft.pick} onChange={(e) => updateManualLegDraft('pick', e.target.value)} />
                </label>
              ) : (
                <label className="field field-grow">
                  <span>Selectie</span>
                  <select value={manualLegDraft.selection} onChange={(e) => updateManualLegDraft('selection', e.target.value)}>
                    <option value="">Kies selectie</option>
                    {manualOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {needsLine(manualLegDraft.market) && (
                <label className="field">
                  <span>Lijn</span>
                  <input
                    type="number"
                    step="0.25"
                    placeholder={manualLegDraft.market === 'handicap' ? '-1.5' : '2.5'}
                    value={manualLegDraft.line}
                    onChange={(e) => updateManualLegDraft('line', e.target.value)}
                  />
                </label>
              )}

              <label className="field">
                <span>Odds <span className="field-hint">(optioneel)</span></span>
                <input type="number" step="0.01" min="1.01" placeholder="nog onbekend" value={manualDraft.odds} onChange={(e) => setManualDraft((d) => ({ ...d, odds: e.target.value }))} />
              </label>
              <div className="field add-leg-btn-wrap">
                <button type="button" className="btn btn-primary btn-small" onClick={addManualLeg}>
                  + Toevoegen
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="pick-list-heading">
        <span>Toegevoegde selecties ({legs.length})</span>
      </div>
      <div className="pick-list">
        {legs.length === 0 && <div className="empty">Nog geen selecties toegevoegd.</div>}
        {legs.map((leg) => (
          <div className="pick-row" key={leg.key}>
            <div className="info">
              <b>{leg.label}</b>
              {describeBet(leg)}
            </div>
            <div className={`pick-row-odds${leg.odds ? '' : ' is-empty'}`}>{leg.odds ? Number(leg.odds).toFixed(2) : 'nog geen odds'}</div>
            <button type="button" className="del" onClick={() => removeLeg(leg.key)} title="Verwijderen">
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="field-row planned-for-day">
        <div className="field field-grow">
          <span className="planned-for-day-label">Voor welke dag</span>
          <div className="planned-for-day-row">
            <div className="quick-dates">
              {quickDates.map((date, index) => (
                <button type="button" key={date} className={forDate === date ? 'active' : ''} onClick={() => chooseForDate(date)}>
                  {QUICK_DAY_LABELS[index]}
                </button>
              ))}
            </div>
            <input type="date" value={forDate} onChange={(e) => chooseForDate(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="field-row">
        <label className="field">
          <span>Bookmaker <span className="field-hint">(optioneel)</span></span>
          <select value={bookmaker} onChange={(e) => setBookmaker(e.target.value)}>
            <option value="">Nog geen voorkeur</option>
            {bookmakers.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Totale odds <span className="field-hint">(optioneel)</span></span>
          <input type="number" step="0.01" min="1.01" placeholder="—" value={totalOdds} onChange={(e) => setTotalOdds(e.target.value)} />
        </label>
        <label className="field field-grow">
          <span>Notities <span className="field-hint">(optioneel)</span></span>
          <input type="text" placeholder="bv. wachten op opstelling" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>

      <div className="card-footer">
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? 'Opslaan…' : 'Opzetje opslaan'}
        </button>
      </div>
    </form>
  );
}
