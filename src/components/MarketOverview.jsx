import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { STATUS_LABELS, MARKET_CATEGORIES } from '../markets.js';
import InlineIcon from './InlineIcon.jsx';

// Markt (en bij vrije tekst de titel) van één pick handmatig aanpassen.
function PickEditor({ pick, onSave, onCancel }) {
  const { edit } = pick;
  const [category, setCategory] = useState(edit.category);
  const [title, setTitle] = useState(edit.title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function save(e) {
    e.preventDefault();
    if (edit.titleEditable && !title.trim()) {
      setError('Vul een titel in');
      return;
    }
    const patch = { partIndex: edit.partIndex, category };
    if (edit.titleEditable && title.trim() !== edit.title) patch.title = title.trim();
    setSaving(true);
    setError(null);
    try {
      await onSave(edit.legId, patch);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  async function reset() {
    setSaving(true);
    setError(null);
    try {
      await onSave(edit.legId, { partIndex: edit.partIndex, category: null });
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <form className="pick-editor" onSubmit={save}>
      {edit.titleEditable && (
        <label className="field">
          <span>Titel</span>
          <input value={title} onChange={(e) => { setTitle(e.target.value); setError(null); }} />
        </label>
      )}
      <label className="field">
        <span>Markt</span>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {MARKET_CATEGORIES.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      {edit.wholeLeg && <p className="hint-text">Geldt voor de hele selectie; die wordt dan niet meer opgesplitst.</p>}
      {error && <p className="error-text">{error}</p>}
      <div className="pick-editor-actions">
        <button type="button" className="btn btn-ghost" onClick={reset} disabled={saving} title="Markt weer automatisch uit de tekst bepalen">
          Automatisch
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>
          Annuleren
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Opslaan…' : 'Opslaan'}
        </button>
      </div>
    </form>
  );
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function signedPct(n) {
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

// yield is null zolang er nog geen enkele geprijsde leg is - dan expliciet
// "—" tonen, nooit 0.0%, want dat zou een echte nul-yield suggereren.
function yieldFmt(n) {
  return n === null ? '—' : signedPct(n);
}

function yieldClass(n) {
  if (n === null) return 'amount-flat';
  return n >= 0 ? 'amount-positive' : 'amount-negative';
}

function betsFmt(row) {
  return `${row.totalLegs} (${row.singles} single / ${row.combi} combi)`;
}

// Onder deze grens is een hitrate/yield te veel toeval om als signaal te
// vertrouwen (bv. 1 bet gewonnen = 100% hitrate, maar zegt niks). Zulke
// rijen blijven zichtbaar (nooit data verbergen), maar worden gedempt en
// krijgen een n=X badge, en tellen niet mee voor "beste/slechtste markt".
const MIN_SAMPLE = 10;

function isLowSample(row) {
  return row.totalLegs < MIN_SAMPLE;
}

export default function MarketOverview() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [expandedPicks, setExpandedPicks] = useState({});
  const [editingPick, setEditingPick] = useState(null);

  // Het endpoint geeft meteen het nieuwe overzicht terug; open rijen blijven
  // open (de pick kan naar een andere rij zijn verhuisd).
  async function savePick(legId, patch) {
    const next = await api.updateLegCategory(legId, patch);
    setData(next);
    setEditingPick(null);
  }

  useEffect(() => {
    setLoading(true);
    setExpanded({});
    setExpandedPicks({});
    api
      .getMarketOverview()
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  function toggle(marketKey) {
    setExpanded((prev) => ({ ...prev, [marketKey]: !prev[marketKey] }));
  }

  function togglePicks(marketKey, selectionKey) {
    const key = `${marketKey}::${selectionKey}`;
    setExpandedPicks((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const markets = data?.markets || [];
  // 'Anders' is een restbak van losse selecties, geen markt om op te sturen.
  const realMarkets = markets.filter((m) => m.key !== 'anders');
  const confident = realMarkets.filter((m) => !isLowSample(m));
  const rankedForBestWorst = confident.length > 0 ? confident : realMarkets.length > 0 ? realMarkets : markets;
  const best = rankedForBestWorst[0];
  const worst = rankedForBestWorst.length > 1 ? rankedForBestWorst[rankedForBestWorst.length - 1] : null;

  return (
    <div>
      {error && <p className="error-text">{error}</p>}

      {loading ? (
        <p className="hint-text">Laden…</p>
      ) : markets.length === 0 ? (
        <p className="hint-text">Nog geen afgehandelde bets.</p>
      ) : (
        <>
          <div className="stat-row">
            <div className="stat-tile">
              <div className="label">Legs meegeteld</div>
              <div className="value mono">{data.totalLegs}</div>
            </div>
            <div className="stat-tile">
              <div className="label">Beste markt</div>
              <div className={`value mono ${yieldClass(best.yield)}`}>{yieldFmt(best.yield)}</div>
              <div className="sub">{best.label}</div>
            </div>
            <div className="stat-tile">
              <div className="label">Slechtste markt</div>
              <div className={`value mono ${yieldClass(worst ? worst.yield : best.yield)}`}>{yieldFmt(worst ? worst.yield : best.yield)}</div>
              <div className="sub">{worst ? worst.label : best.label}</div>
            </div>
          </div>

          <div className="market-table">
            <div className="market-row-header">
              <div>Markt / selectie</div>
              <div>Bets (single / combi)</div>
              <div>Hitrate</div>
              <div>Yield</div>
              <div />
            </div>
            {markets.map((m) => {
              const isOpen = !!expanded[m.key];
              const lowSample = isLowSample(m);
              return (
                <div className={`market-row ${isOpen ? 'is-expanded' : ''} ${lowSample ? 'market-row--low-sample' : ''}`} key={m.key}>
                  <div className="market-row-main" onClick={() => toggle(m.key)}>
                    <div className="market-name">
                      {m.label}
                      {m.freeform && <span className="tag-freeform">vrije tekst</span>}
                      {lowSample && <span className="sample-badge" title={`Minder dan ${MIN_SAMPLE} legs — nog geen betrouwbaar signaal`}>n={m.totalLegs}</span>}
                    </div>
                    <div className="mono">{betsFmt(m)}</div>
                    <div className="hitrate-cell">
                      <span className="mono">{Math.round(m.hitrate)}%</span>
                      <div className="bar-track">
                        <div className="bar-fill" style={{ width: `${Math.max(0, Math.min(100, m.hitrate))}%` }} />
                      </div>
                    </div>
                    <div className={`mono market-roi-cell ${yieldClass(m.yield)}`}>{yieldFmt(m.yield)}</div>
                    <div className="market-chevron">›</div>
                  </div>
                  {isOpen && (
                    <div className="market-row-detail">
                      {m.selections.map((s) => {
                        const picksKey = `${m.key}::${s.key}`;
                        const picksOpen = !!expandedPicks[picksKey];
                        const selectionLowSample = isLowSample(s);
                        return (
                          <div key={s.key}>
                            <div
                              className={`market-sub-row ${picksOpen ? 'is-expanded' : ''} ${selectionLowSample ? 'market-row--low-sample' : ''}`}
                              onClick={() => togglePicks(m.key, s.key)}
                            >
                              <div>
                                {s.label}
                                {selectionLowSample && (
                                  <span className="sample-badge" title={`Minder dan ${MIN_SAMPLE} legs — nog geen betrouwbaar signaal`}>
                                    n={s.totalLegs}
                                  </span>
                                )}
                              </div>
                              <div className="mono">{betsFmt(s)}</div>
                              <div className="hitrate-cell">
                                <span className="mono">{Math.round(s.hitrate)}%</span>
                                <div className="bar-track">
                                  <div className="bar-fill" style={{ width: `${Math.max(0, Math.min(100, s.hitrate))}%` }} />
                                </div>
                              </div>
                              <div className={`mono market-roi-cell ${yieldClass(s.yield)}`}>{yieldFmt(s.yield)}</div>
                              <div className="market-chevron">›</div>
                            </div>
                            {picksOpen && (
                              <div className="market-picks">
                                <div className="leg-list">
                                  {s.picks.map((pick) => (
                                    <div key={pick.legId}>
                                    <div className="leg-row">
                                      <div className="leg-info">
                                        <span className="leg-match">{pick.label}</span>
                                        {pick.pick && <span className="muted">{pick.pick}</span>}
                                        <span className="muted">
                                          {pick.bookmaker} · {formatDate(pick.placedAt)}
                                          {pick.isPart ? ' · onderdeel van combi' : pick.isCombi ? ' · combi' : ''}
                                        </span>
                                      </div>
                                      <span className="leg-odds" title={pick.odds === null ? 'Onderdeel zonder eigen odds - telt niet mee in de yield' : undefined}>
                                        {pick.odds === null ? '—' : `@ ${pick.odds.toFixed(2)}`}
                                      </span>
                                      <span className={`leg-status leg-status-${pick.status}`}>{STATUS_LABELS[pick.status]}</span>
                                      {pick.edit && (
                                        <button
                                          type="button"
                                          className="pick-edit-btn"
                                          aria-label="Markt aanpassen"
                                          title="Markt aanpassen"
                                          onClick={() => setEditingPick((cur) => (cur === pick.legId ? null : pick.legId))}
                                        >
                                          <InlineIcon name="edit" size={14} />
                                        </button>
                                      )}
                                    </div>
                                    {editingPick === pick.legId && (
                                      <PickEditor pick={pick} onSave={savePick} onCancel={() => setEditingPick(null)} />
                                    )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <p className="table-note">
            <b>Yield</b> = fictief rendement bij gelijke inzet per pick, op basis van de eigen odds van elke selectie — geen echt geld,
            wel een eerlijke vergelijking tussen markten ook als bijna alles combi is.
            <br />
            <b>S</b> = single · <b>C</b> = combi-leg. Hitrate telt alle legs, single én combi; Gesorteerd op yield
            (aflopend).
            <br />
            Bet builders en gecombineerde selecties ("X + Y") tellen per onderdeel in hun eigen markt. Onderdelen hebben geen eigen
            odds: ze tellen mee in de hitrate, niet in de yield. Een onderdeel zonder uitslag in een verloren combi telt niet mee
            (onbekend of dát onderdeel verloor).
            <br />
            Rijen met minder dan {MIN_SAMPLE} legs (badge <b>n=…</b>) zijn gedempt — te weinig data voor een betrouwbaar signaal, en ze
            tellen niet mee voor "beste/slechtste markt" hierboven.
          </p>
        </>
      )}
    </div>
  );
}
