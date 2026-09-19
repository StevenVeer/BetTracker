import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { STATUS_LABELS } from '../markets.js';

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function signedPct(n) {
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

// yield is null zolang er nog geen enkele geprijsde leg is (bv. verse
// telegram-picks vóór "Odds ophalen") - dan expliciet "—" tonen, nooit 0.0%,
// want dat zou een echte nul-yield suggereren.
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
  const [source, setSource] = useState('manual');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [expandedPicks, setExpandedPicks] = useState({});

  useEffect(() => {
    setLoading(true);
    setExpanded({});
    setExpandedPicks({});
    api
      .getMarketOverview(source)
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [source]);

  function toggle(marketKey) {
    setExpanded((prev) => ({ ...prev, [marketKey]: !prev[marketKey] }));
  }

  function togglePicks(marketKey, selectionKey) {
    const key = `${marketKey}::${selectionKey}`;
    setExpandedPicks((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const markets = data?.markets || [];
  const confident = markets.filter((m) => !isLowSample(m));
  const rankedForBestWorst = confident.length > 0 ? confident : markets;
  const best = rankedForBestWorst[0];
  const worst = rankedForBestWorst.length > 1 ? rankedForBestWorst[rankedForBestWorst.length - 1] : null;

  return (
    <div>
      <nav className="filters" style={{ marginBottom: 20 }}>
        <button type="button" className={`filter-tab ${source === 'manual' ? 'is-active' : ''}`} onClick={() => setSource('manual')}>
          Eigen bets
        </button>
        <button type="button" className={`filter-tab ${source === 'telegram' ? 'is-active' : ''}`} onClick={() => setSource('telegram')}>
          Telegram
        </button>
      </nav>

      {error && <p className="error-text">{error}</p>}

      {loading ? (
        <p className="hint-text">Laden…</p>
      ) : markets.length === 0 ? (
        <p className="hint-text">Nog geen afgehandelde bets voor deze bron.</p>
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
                                    <div className="leg-row" key={pick.legId}>
                                      <div className="leg-info">
                                        <span className="leg-match">{pick.label}</span>
                                        <span className="muted">
                                          {pick.bookmaker} · {formatDate(pick.placedAt)}
                                          {pick.isCombi ? ' · combi' : ''}
                                        </span>
                                      </div>
                                      <span className="leg-odds">@ {pick.odds.toFixed(2)}</span>
                                      <span className={`leg-status leg-status-${pick.status}`}>{STATUS_LABELS[pick.status]}</span>
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
            <b>S</b> = single · <b>C</b> = combi-leg. Hitrate telt alle legs, single én combi; yield telt alleen legs met een bekende odds
            (een net-binnengekomen telegram-pick zonder odds telt dus wel mee in hitrate, nog niet in yield). Gesorteerd op yield
            (aflopend).
            <br />
            Rijen met minder dan {MIN_SAMPLE} legs (badge <b>n=…</b>) zijn gedempt — te weinig data voor een betrouwbaar signaal, en ze
            tellen niet mee voor "beste/slechtste markt" hierboven.
          </p>
        </>
      )}
    </div>
  );
}
