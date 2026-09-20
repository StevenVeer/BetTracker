import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import BetForm from './components/BetForm.jsx';
import BetList from './components/BetList.jsx';
import Overview from './components/Overview.jsx';
import LiveScores from './components/LiveScores.jsx';
import OpenBetsModal from './components/OpenBetsModal.jsx';
import PlannedBetsModal from './components/PlannedBetsModal.jsx';
import ScreenshotImportModal from './components/ScreenshotImportModal.jsx';
import { CountButton, LiveStatus, MoreMenu } from './components/ToolbarActions.jsx';
import NotificationToggle, { useNotificationPreference } from './components/NotificationToggle.jsx';
import AmountsToggle, { Amount, AmountsVisibilityProvider, useAmountsVisible } from './components/AmountsToggle.jsx';
import { useSettlementNotifications } from './notifications.js';
import { groupByDay, todayKey } from './dailyResults.js';

const FILTERS = [
  { key: 'open', label: 'Open' },
  { key: 'all', label: 'Alle' },
  { key: 'won', label: 'Gewonnen' },
  { key: 'lost', label: 'Verloren' },
];

const VIEWS = [
  { key: 'bets', label: 'Bets' },
  { key: 'telegram', label: 'Telegram Picks' },
  { key: 'overview', label: 'Overzicht' },
  { key: 'live', label: 'Live' },
];

// Zelfde interval als het live-tabblad (server/liveScores.js) - overlaadt
// alleen de weergave van nog open picks met een live score/minuut zodra
// competitie + teamnamen matchen met de ESPN-feed. Raakt nooit
// bet.status/leg.status of een payout - settlement blijft via de Odds
// API-knop lopen. Mislukt de match voor een pick, dan blijft die er gewoon
// zonder live-badge bij staan, precies zoals nu.
const LIVE_OVERLAY_POLL_MS = 20000;

function applyLiveOverlay(bets, overlay) {
  if (!overlay || Object.keys(overlay).length === 0) return bets;
  let anyChanged = false;
  const next = bets.map((bet) => {
    let betChanged = false;
    const legs = bet.legs.map((leg) => {
      if (leg.status !== 'open' || !leg.match) return leg;
      // Alleen aanraken als deze match_id ook echt gecheckt is (key aanwezig)
      // - anders (overlay nog niet geladen) laten we 'm ongemoeid, zodat er
      // niet even kort "niet live gevolgd" opflitst.
      if (!(leg.match.id in overlay)) return leg;
      betChanged = true;
      const live = overlay[leg.match.id];
      return {
        ...leg,
        match: live
          ? { ...leg.match, homeScore: live.homeScore, awayScore: live.awayScore, status: live.status, liveTracked: true }
          : { ...leg.match, liveTracked: false },
      };
    });
    if (!betChanged) return bet;
    anyChanged = true;
    return { ...bet, legs };
  });
  return anyChanged ? next : bets;
}

// Op starttijd van de wedstrijd, vroegste eerst - handmatige picks zonder
// wedstrijd (dus zonder kickoff) hebben geen starttijd en komen achteraan.
function byKickoff(a, b) {
  const aTime = a.match?.commenceTime ? new Date(a.match.commenceTime).getTime() : Infinity;
  const bTime = b.match?.commenceTime ? new Date(b.match.commenceTime).getTime() : Infinity;
  return aTime - bTime;
}

function splitPicks(bets) {
  const openPicks = [];
  const unsettledPicks = [];
  for (const bet of bets) {
    const target = bet.status === 'open' ? openPicks : bet.status === 'lost' ? unsettledPicks : null;
    if (!target) continue;
    const isCombi = bet.legs.length > 1;
    for (const leg of bet.legs) {
      if (leg.status === 'open') target.push({ ...leg, bookmaker: bet.bookmaker, isCombi });
    }
  }
  return { openPicks: openPicks.sort(byKickoff), unsettledPicks: unsettledPicks.sort(byKickoff) };
}

export default function App() {
  const [view, setView] = useState('bets');
  const [filter, setFilter] = useState('open');
  const [bets, setBets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Welke pick-popup open staat: { source: 'own' | 'telegram', kind: 'open' | 'unsettled' }.
  const [picksModal, setPicksModal] = useState(null);
  const [plannedBets, setPlannedBets] = useState([]);
  const [showPlanned, setShowPlanned] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [scoresUsage, setScoresUsage] = useState(null);
  const [refreshingScores, setRefreshingScores] = useState(false);
  const [telegramBets, setTelegramBets] = useState([]);
  const [telegramFilter, setTelegramFilter] = useState('open');
  const [refreshingTelegramOdds, setRefreshingTelegramOdds] = useState(false);
  const [backfillingTelegram, setBackfillingTelegram] = useState(false);
  const [backfillSummary, setBackfillSummary] = useState(null);
  const [liveOverlay, setLiveOverlay] = useState({});
  const [liveFeed, setLiveFeed] = useState({ updatedAt: null, error: null });
  const { permission: notifPermission, enabled: notifEnabled, setEnabled: setNotifEnabled, requestPermission: requestNotifPermission } =
    useNotificationPreference();
  const { visible: amountsVisible, setVisible: setAmountsVisible } = useAmountsVisible();
  useSettlementNotifications(bets, telegramBets, notifEnabled);

  function loadBets() {
    setLoading(true);
    api
      .getBets('all', 'manual')
      .then(setBets)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  function loadTelegramBets() {
    api.getBets('all', 'telegram').then(setTelegramBets).catch((err) => setError(err.message));
  }

  function loadPlannedBets() {
    api.getPlannedBets().then(setPlannedBets).catch((err) => setError(err.message));
  }

  useEffect(() => {
    loadBets();
    loadTelegramBets();
    loadPlannedBets();
    api
      .getScoresUsage()
      .then((data) => setScoresUsage(data.usage))
      .catch(() => {});
  }, []);

  // Ook los aanroepbaar (niet alleen als interval) - na een handmatige
  // koppeling (zie LiveLinkBadge) willen we niet tot de volgende poll-cyclus
  // wachten om het resultaat te zien.
  const loadLiveOverlay = useCallback(() => {
    return api
      .getLiveMatchOverlay()
      .then((data) => {
        setLiveOverlay(data.matches || {});
        setLiveFeed({ updatedAt: data.feedUpdatedAt || null, error: data.feedError || null });
      })
      .catch(() => {}); // best-effort - zonder overlay tonen we gewoon geen live-badges
  }, []);

  // Na het koppelen van een volledig handmatige selectie (geen match_id, zie
  // ScoreBadge) krijgt de leg er serverside pas een match bij - een reload
  // van de overlay alleen is dan niet genoeg, de bet zelf moet opnieuw op om
  // leg.match te laten verschijnen.
  function handleLiveLinked() {
    loadLiveOverlay();
    loadBets();
  }

  function handleTelegramLiveLinked() {
    loadLiveOverlay();
    loadTelegramBets();
  }

  useEffect(() => {
    loadLiveOverlay();
    const interval = setInterval(loadLiveOverlay, LIVE_OVERLAY_POLL_MS);
    return () => clearInterval(interval);
  }, [loadLiveOverlay]);

  async function handleRefreshScores() {
    setRefreshingScores(true);
    try {
      const { usage } = await api.refreshScores();
      setScoresUsage(usage);
      loadBets();
      loadTelegramBets();
    } catch (err) {
      setError(err.message);
    } finally {
      setRefreshingScores(false);
    }
  }

  // De Odds API-knop is de enige route die legs/bets automatisch afhandelt
  // (de gratis live-feed toont alleen), dus blijft hij bestaan - alleen niet
  // meer als losse toolbar-knop maar in het ⋯-menu.
  const scoresMenuItem = {
    key: 'scores',
    icon: 'refresh',
    label: refreshingScores ? 'Scores ophalen…' : 'Scores ophalen en afhandelen',
    meta: scoresUsage ? `${scoresUsage.used}/${scoresUsage.total}` : null,
    disabled: refreshingScores,
    onClick: handleRefreshScores,
  };

  async function handleRefreshTelegramOdds() {
    setRefreshingTelegramOdds(true);
    try {
      await api.refreshTelegramOdds();
      loadTelegramBets();
    } catch (err) {
      setError(err.message);
    } finally {
      setRefreshingTelegramOdds(false);
    }
  }

  async function handleBackfillTelegram() {
    setBackfillingTelegram(true);
    setBackfillSummary(null);
    try {
      const result = await api.backfillTelegram();
      setBackfillSummary(result);
      loadTelegramBets();
    } catch (err) {
      setError(err.message);
    } finally {
      setBackfillingTelegram(false);
    }
  }

  async function handleTelegramUpdate(id, patch) {
    try {
      const updated = await api.updateBet(id, patch);
      setTelegramBets((prev) => prev.map((b) => (b.id === id ? updated : b)));
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleTelegramLegUpdate(legId, patch) {
    try {
      const updated = await api.updateLeg(legId, patch);
      setTelegramBets((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleTelegramDelete(id) {
    try {
      await api.deleteBet(id);
      setTelegramBets((prev) => prev.filter((b) => b.id !== id));
    } catch (err) {
      setError(err.message);
    }
  }

  const overlaidBets = useMemo(() => applyLiveOverlay(bets, liveOverlay), [bets, liveOverlay]);
  const overlaidTelegramBets = useMemo(() => applyLiveOverlay(telegramBets, liveOverlay), [telegramBets, liveOverlay]);

  const visibleBets = useMemo(
    () => (filter === 'all' ? overlaidBets : overlaidBets.filter((b) => b.status === filter)),
    [overlaidBets, filter]
  );
  const visibleTelegramBets = useMemo(
    () => (telegramFilter === 'all' ? overlaidTelegramBets : overlaidTelegramBets.filter((b) => b.status === telegramFilter)),
    [overlaidTelegramBets, telegramFilter]
  );

  // "Live" = nog open / onafgehandeld, ongeacht of er al een wedstrijd bezig is.
  // Resultaat wordt geteld per dag van PLAATSING (niet settlement) - zie dailyResults.js.
  const summary = useMemo(() => {
    const liveBets = bets.filter((b) => b.status === 'open');
    const liveStake = liveBets.reduce((sum, b) => sum + Number(b.stake), 0);

    const days = groupByDay(bets);
    const today = days.find((d) => d.date === todayKey());
    const todayResult = today ? today.result : 0;

    const livePayout = liveBets.reduce((sum, b) => sum + Number(b.potentialPayout || 0), 0);

    return { liveCount: liveBets.length, liveStake, todayResult, livePayout };
  }, [bets]);

  // Alle nog niet afgeronde picks (parlay-legs of singles), los van het filter op de bets-lijst.
  // Is de bet zelf al afgerond (bv. een parlay die al is gefaald door een andere leg),
  // dan doen de resterende "open" legs er niet meer toe en tonen we ze niet.
  // Legs die nog open staan bij een al verloren bet zijn "onafgehandeld": die staan apart
  // (knop "Onafgehandeld") zodat je ze later nog alsnog op gewonnen/verloren kunt zetten.
  const { openPicks, unsettledPicks } = useMemo(() => splitPicks(overlaidBets), [overlaidBets]);
  const { openPicks: telegramOpenPicks, unsettledPicks: telegramUnsettledPicks } = useMemo(
    () => splitPicks(overlaidTelegramBets),
    [overlaidTelegramBets]
  );

  async function handleCreated(bet) {
    setBets((prev) => [bet, ...prev]);
  }

  function handlePlannedCreated(planned) {
    setPlannedBets((prev) => [...prev, planned]);
  }

  function handlePlannedRemoved(id) {
    setPlannedBets((prev) => prev.filter((p) => p.id !== id));
  }

  async function handleUpdate(id, patch) {
    try {
      const updated = await api.updateBet(id, patch);
      setBets((prev) => prev.map((b) => (b.id === id ? updated : b)));
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleLegUpdate(legId, patch) {
    try {
      const updated = await api.updateLeg(legId, patch);
      setBets((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(id) {
    try {
      await api.deleteBet(id);
      setBets((prev) => prev.filter((b) => b.id !== id));
    } catch (err) {
      setError(err.message);
    }
  }

  // Balk: groen = al verdiend vandaag, goud = potentiële winst van nog open bets.
  const earned = Math.max(summary.todayResult, 0);
  const openProfit = Math.max(summary.livePayout - summary.liveStake, 0);
  const barTotal = earned + openProfit;
  const earnedPct = barTotal ? (earned / barTotal) * 100 : 0;
  const openPct = barTotal ? (openProfit / barTotal) * 100 : 0;

  return (
    <AmountsVisibilityProvider visible={amountsVisible}>
    <div className="app">
      <header className="app-header">
        <div className="header-title">
          <h1>Bet Tracker</h1>
          <AmountsToggle visible={amountsVisible} setVisible={setAmountsVisible} />
          <NotificationToggle
            permission={notifPermission}
            enabled={notifEnabled}
            setEnabled={setNotifEnabled}
            requestPermission={requestNotifPermission}
          />
        </div>
        <div className="summary">
          <div>
            <span className="muted">
              Bets <span className="live-dot" />
            </span>
            <strong>{summary.liveCount}</strong>
          </div>
          <div>
            <span className="muted">
              Inzet <span className="live-dot" />
            </span>
            <strong>
              <Amount>{summary.liveStake.toFixed(2)}</Amount>
            </strong>
          </div>
          <div className="summary-wide">
            <div className="summary-wide-row">
              <div className="summary-wide-col">
                <span className="muted">Resultaat vandaag</span>
                <strong className={summary.todayResult >= 0 ? 'profit-positive' : 'profit-negative'}>
                  <Amount>
                    {summary.todayResult >= 0 ? '+' : ''}
                    {summary.todayResult.toFixed(2)}
                  </Amount>
                </strong>
              </div>
              <div className="summary-wide-col is-right">
                <span className="muted">
                  Potential payout <span className="live-dot" />
                </span>
                <strong>
                  <Amount>{summary.livePayout.toFixed(2)}</Amount>
                </strong>
              </div>
            </div>
            <div className="payout-bar">
              <span className="payout-bar-earned" style={{ width: `${earnedPct}%` }} />
              <span className="payout-bar-open" style={{ width: `${openPct}%` }} />
            </div>
          </div>
        </div>
      </header>

      <nav className="filters view-tabs">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            className={`filter-tab ${view === v.key ? 'is-active' : ''}`}
            onClick={() => setView(v.key)}
          >
            {v.label}
          </button>
        ))}
      </nav>

      {view === 'overview' ? (
        <Overview bets={bets} telegramBets={telegramBets} />
      ) : view === 'live' ? (
        <LiveScores />
      ) : view === 'telegram' ? (
        <>
          <div className="toolbar">
            <div className="toolbar-filters">
              <nav className="filters">
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    className={`filter-tab ${telegramFilter === f.key ? 'is-active' : ''}`}
                    onClick={() => setTelegramFilter(f.key)}
                  >
                    {f.label}
                  </button>
                ))}
              </nav>
              <CountButton
                icon="list"
                label="Open bets"
                count={telegramOpenPicks.length}
                onClick={() => setPicksModal({ source: 'telegram', kind: 'open' })}
              />
              {telegramUnsettledPicks.length > 0 && (
                <CountButton
                  icon="alert"
                  label="Onafgehandeld"
                  count={telegramUnsettledPicks.length}
                  warn
                  onClick={() => setPicksModal({ source: 'telegram', kind: 'unsettled' })}
                />
              )}
            </div>
            <MoreMenu
              items={[
                {
                  key: 'odds',
                  icon: 'send',
                  label: refreshingTelegramOdds ? 'Odds ophalen…' : 'Odds ophalen',
                  disabled: refreshingTelegramOdds,
                  onClick: handleRefreshTelegramOdds,
                },
                {
                  key: 'backfill',
                  icon: 'history',
                  label: backfillingTelegram ? 'Backfill…' : 'Backfill',
                  disabled: backfillingTelegram,
                  onClick: handleBackfillTelegram,
                },
                scoresMenuItem,
              ]}
            />
          </div>
          <LiveStatus updatedAt={liveFeed.updatedAt} error={liveFeed.error} onRefresh={loadLiveOverlay} />

          {error && <p className="error-text">{error}</p>}
          {backfillSummary && (
            <p className="hint-text">
              Backfill: {backfillSummary.processed} bericht(en) gescand sinds{' '}
              {new Date(backfillSummary.since).toLocaleString('nl-NL')}, {backfillSummary.betsCreated} nieuwe bet(s)
              {backfillSummary.alreadyProcessed > 0 ? `, ${backfillSummary.alreadyProcessed} al bekend` : ''}
              {backfillSummary.duplicateParlay > 0 ? `, ${backfillSummary.duplicateParlay} dubbele parlay overgeslagen` : ''}
              {' '}({(backfillSummary.durationMs / 1000).toFixed(1)}s)
            </p>
          )}
          <BetList
            bets={visibleTelegramBets}
            onUpdate={handleTelegramUpdate}
            onUpdateLeg={handleTelegramLegUpdate}
            onDelete={handleTelegramDelete}
            onLiveLinked={handleTelegramLiveLinked}
          />
        </>
      ) : (
        <>
          <div className="toolbar">
            <div className="toolbar-filters">
              <nav className="filters">
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    className={`filter-tab ${filter === f.key ? 'is-active' : ''}`}
                    onClick={() => setFilter(f.key)}
                  >
                    {f.label}
                  </button>
                ))}
              </nav>
              <CountButton
                icon="list"
                label="Open bets"
                count={openPicks.length}
                onClick={() => setPicksModal({ source: 'own', kind: 'open' })}
              />
              {unsettledPicks.length > 0 && (
                <CountButton
                  icon="alert"
                  label="Onafgehandeld"
                  count={unsettledPicks.length}
                  warn
                  onClick={() => setPicksModal({ source: 'own', kind: 'unsettled' })}
                />
              )}
              <CountButton icon="bookmark" label="Gepland" count={plannedBets.length} onClick={() => setShowPlanned(true)} />
            </div>
            <BetForm onCreated={handleCreated} />
            <MoreMenu
              items={[
                { key: 'import', icon: 'image', label: 'Importeer screenshot', onClick: () => setShowImport(true) },
                scoresMenuItem,
              ]}
            />
          </div>
          <LiveStatus updatedAt={liveFeed.updatedAt} error={liveFeed.error} onRefresh={loadLiveOverlay} />

          {error && <p className="error-text">{error}</p>}
          {loading ? (
            <p className="hint-text">Laden…</p>
          ) : (
            <BetList
              bets={visibleBets}
              onUpdate={handleUpdate}
              onUpdateLeg={handleLegUpdate}
              onDelete={handleDelete}
              onLiveLinked={handleLiveLinked}
            />
          )}
        </>
      )}

      {picksModal && (
        <OpenBetsModal
          picks={
            picksModal.source === 'telegram'
              ? picksModal.kind === 'open' ? telegramOpenPicks : telegramUnsettledPicks
              : picksModal.kind === 'open' ? openPicks : unsettledPicks
          }
          title={picksModal.kind === 'open' ? 'Open bets' : 'Onafgehandeld (verloren bets)'}
          emptyText={picksModal.kind === 'open' ? 'Geen open picks.' : 'Alles afgehandeld.'}
          onClose={() => setPicksModal(null)}
          onLiveLinked={picksModal.source === 'telegram' ? handleTelegramLiveLinked : handleLiveLinked}
          onSettle={picksModal.source === 'telegram' ? handleTelegramLegUpdate : handleLegUpdate}
        />
      )}

      {showImport && <ScreenshotImportModal onClose={() => setShowImport(false)} onCreated={handleCreated} />}

      {showPlanned && (
        <PlannedBetsModal
          plannedBets={plannedBets}
          onClose={() => setShowPlanned(false)}
          onCreated={handlePlannedCreated}
          onRemoved={handlePlannedRemoved}
          onPlaced={handleCreated}
        />
      )}
    </div>
    </AmountsVisibilityProvider>
  );
}
