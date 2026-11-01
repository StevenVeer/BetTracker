// Zijpaneel met twee tabs: je favoriete wedstrijden uit /api/live-scores
// (favoriet = open bet erop of handmatige ster, zie getFavoriteState() in
// server/index.js) en je open bets met live-stand per leg (overlay uit
// /api/live-scores/open-matches). Ververst elke 10 seconden. Geen build-stap, dus de
// helpers uit src/ (markets.js, liveShared.jsx) staan hier in afgeslankte vorm.

const APP_URL = 'http://localhost:6070';
const REFRESH_MS = 10_000;

const LIVE_STATUSES = new Set(['1H', '2H', 'HT', 'ET', 'ET1', 'ET2', 'PEN']);
const DONE_STATUSES = new Set(['FT', 'AET', 'POST', 'CANC']);

const STATUS_LABELS = {
  HT: 'Rust',
  PEN: "Penalty's",
  FT: 'Afgelopen',
  AET: 'Afgelopen (n.v.)',
  POST: 'Uitgesteld',
  CANC: 'Afgelast',
};

const MARKET_ABBR = {
  team_wint: 'Winnaar',
  dubbelkans: 'Dub. kans',
  btts: 'BTTS',
  over_under: 'O/U',
  handicap: 'Hcp',
  correct_score: 'Score',
  anders: 'Overig',
};

const listEl = document.getElementById('list');
const errorEl = document.getElementById('error');

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Afgeslankte versie van describeBet() in src/markets.js.
function pickLabel(pick, match) {
  const { home, away } = match;
  if (Array.isArray(pick.parts) && pick.parts.length > 1) {
    return `Bet builder: ${pick.parts.map((p) => (p.market && p.pick.length <= 3 ? `${p.market}: ${p.pick}` : p.pick)).join(' + ')}`;
  }
  switch (pick.market) {
    case 'team_wint':
      return pick.selection === 'home' ? `${home} wint` : pick.selection === 'away' ? `${away} wint` : pick.selection;
    case 'dubbelkans':
      return (
        { home_draw: `${home} of gelijk`, home_away: `${home} of ${away}`, draw_away: `Gelijk of ${away}` }[pick.selection] ||
        pick.selection
      );
    case 'btts':
      return pick.selection === 'yes' ? 'Ja' : pick.selection === 'no' ? 'Nee' : pick.selection;
    case 'over_under':
      return `${pick.selection === 'over' ? 'Over' : 'Onder'} ${pick.line ?? '?'} doelpunten`;
    case 'handicap': {
      const team = pick.selection === 'home' ? home : pick.selection === 'away' ? away : pick.selection;
      const line = Number(pick.line);
      return `${team} (${line > 0 ? '+' : ''}${line})`;
    }
    case 'correct_score':
      return `Correcte score ${pick.selection}`;
    default:
      return pick.selection;
  }
}

function kickoffLabel(iso) {
  const date = new Date(iso);
  const time = date.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === new Date().toDateString()) return time;
  return `${date.toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`;
}

function stateLabel(m) {
  if (m.status === 'NS') return null;
  if (STATUS_LABELS[m.status]) return STATUS_LABELS[m.status];
  return m.minute ? `${m.minute}'` : m.status;
}

async function unfavorite(match) {
  try {
    const res = await fetch(`${APP_URL}/api/favorites/${encodeURIComponent(match.id)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    showError(`Favoriet verwijderen mislukt: ${err.message}`);
  }
  load();
}

// Zelfde aanpak als openApp() in extension/background.js: een open
// BetTracker-tab naar voren halen i.p.v. steeds een nieuwe te openen. De tab
// wordt niet herladen, dus je blijft op de pagina waar je was.
async function openApp() {
  const [existing] = await chrome.tabs.query({ url: `${APP_URL}/*` });
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: APP_URL });
  }
}

const STAR_PATH = 'M12 2.5l2.9 6.3 6.9.7-5.2 4.7 1.6 6.8L12 17.6 5.8 21l1.6-6.8-5.2-4.7 6.9-.7z';

function starIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'currentColor');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', STAR_PATH);
  svg.append(path);
  return svg;
}

function badge(m) {
  if (m.status === 'NS') return el('span', 'badge', kickoffLabel(m.kickoff));
  if (LIVE_STATUSES.has(m.status) && m.status !== 'HT') {
    const node = el('span', 'badge is-live');
    node.append(el('span', 'live-dot'), document.createTextNode(stateLabel(m)));
    return node;
  }
  return el('span', 'badge', stateLabel(m));
}

function teamRow(team, score) {
  const row = el('div', 'fav-card-table-row');
  row.append(el('span', 'team', team), el('span', 'score', score));
  return row;
}

function renderMatch(m) {
  const done = DONE_STATUSES.has(m.status);
  const card = el('div', `fav-card${done ? ' is-done' : ''}`);
  card.title = 'Open BetTracker';
  card.addEventListener('click', openApp);

  const top = el('div', 'fav-card-top');
  const star = el('button', 'star-btn');
  star.type = 'button';
  star.title = m.favoriteSource === 'bet' ? 'Favoriet door een actieve bet — klik om te verwijderen' : 'Favoriet verwijderen';
  star.setAttribute('aria-label', star.title);
  star.append(starIcon());
  star.addEventListener('click', (e) => {
    // De kaart eromheen opent de app - de ster hoort daar niet ook aan te trekken.
    e.stopPropagation();
    unfavorite(m);
  });
  top.append(el('span', 'league', m.league || ''), badge(m), star);
  card.append(top);

  const started = m.status !== 'NS';
  const table = el('div', 'fav-card-table');
  table.append(
    teamRow(m.home, started ? String(m.homeScore ?? '–') : ''),
    teamRow(m.away, started ? String(m.awayScore ?? '–') : '')
  );
  card.append(table);

  if (m.picks && m.picks.length > 0) {
    const picks = el('div', 'pick-lines');
    for (const p of m.picks) {
      const row = el('div', 'pick-line');
      row.append(el('span', 'market', MARKET_ABBR[p.market] || p.market), document.createTextNode(pickLabel(p, m)));
      if (Number.isFinite(p.odds)) row.append(el('span', 'odds', p.odds.toFixed(2)));
      picks.append(row);
    }
    card.append(picks);
  }
  return card;
}

function renderFavorites(matches) {
  const favorites = matches.filter((m) => m.favorite);
  const byKickoff = (a, b) => new Date(a.kickoff) - new Date(b.kickoff);
  const groups = [
    { title: 'Live', className: 'live', items: favorites.filter((m) => LIVE_STATUSES.has(m.status)).sort(byKickoff) },
    { title: 'Komend', items: favorites.filter((m) => m.status === 'NS').sort(byKickoff) },
    { title: 'Afgelopen', className: 'muted', items: favorites.filter((m) => DONE_STATUSES.has(m.status)).sort((a, b) => byKickoff(b, a)) },
  ];

  if (favorites.length === 0) {
    listEl.append(el('div', 'empty', 'Geen favorieten. Zet een ster op een wedstrijd in BetTracker of plaats een bet.'));
    return;
  }
  for (const group of groups) {
    if (group.items.length === 0) continue;
    listEl.append(el('div', `group-title${group.className ? ` ${group.className}` : ''}`, group.title));
    for (const m of group.items) listEl.append(renderMatch(m));
  }
}

// --- Open bets ---------------------------------------------------------------

const euro = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' });

function money(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value)) ? euro.format(Number(value)) : '—';
}

// Zelfde als legKickoff()/legLabel() in src/components/BetList.jsx.
function legKickoff(leg) {
  return leg.match?.commenceTime || leg.kickoffAt || null;
}

function legLabel(leg) {
  return leg.match ? `${leg.match.home} – ${leg.match.away}` : leg.manualLabel || 'Handmatige selectie';
}

// Live-overlay (zie /api/live-scores/open-matches) hangt aan de match-ID van
// een leg; alleen voor legs die nog open zijn.
function legOverlay(leg, overlay) {
  return leg.status === 'open' && leg.match ? overlay[leg.match.id] || null : null;
}

function isLegLive(leg, overlay) {
  return legOverlay(leg, overlay)?.status === 'live';
}

function legIcon(leg, overlay) {
  if (leg.status === 'won') return el('span', 'leg-icon won', '✓');
  if (leg.status === 'lost') return el('span', 'leg-icon lost', '✕');
  if (leg.status === 'void') return el('span', 'leg-icon void');
  if (isLegLive(leg, overlay)) {
    const icon = el('span', 'leg-icon live');
    icon.append(el('span', 'live-dot'));
    return icon;
  }
  return el('span', 'leg-icon');
}

function legState(leg, overlay) {
  const live = legOverlay(leg, overlay);
  const score = live && live.homeScore !== null ? `${live.homeScore}-${live.awayScore}` : null;
  if (live?.status === 'live') return el('span', 'leg-state is-live', `${score ?? ''}${live.minute ? ` · ${live.minute}'` : ''}`);
  if (live?.status === 'finished' && score) return el('span', 'leg-state', score);
  if (leg.status !== 'open') return el('span', 'leg-state', { won: 'Gewonnen', lost: 'Verloren', void: 'Void' }[leg.status] || '');
  const kickoff = legKickoff(leg);
  return el('span', 'leg-state', kickoff ? kickoffLabel(kickoff) : '');
}

function renderLeg(leg, overlay) {
  const row = el('div', `leg${leg.status !== 'open' ? ' is-done' : ''}`);
  const body = el('div', 'leg-body');
  const pick = el('div', 'leg-pick', pickLabel(leg, leg.match || {}));
  pick.title = pick.textContent;
  const match = el('div', 'leg-match');
  match.append(el('span', '', legLabel(leg)), legState(leg, overlay));
  body.append(pick, match);
  row.append(legIcon(leg, overlay), body);
  return row;
}

function renderBet(bet, overlay) {
  const card = el('div', 'bet-card');
  card.title = 'Open BetTracker';
  card.addEventListener('click', openApp);

  const legs = bet.legs || [];
  const head = el('div', 'bet-head');
  head.append(el('span', '', legs.length > 1 ? `Combi · ${legs.length} legs` : 'Single'), el('span', 'badge', bet.bookmaker || '—'));
  card.append(head);

  const sorted = legs.slice().sort((a, b) => new Date(legKickoff(a) || 0) - new Date(legKickoff(b) || 0));
  for (const leg of sorted) card.append(renderLeg(leg, overlay));

  if (legs.length > 1) {
    const done = legs.filter((l) => l.status === 'won' || l.status === 'void').length;
    const bar = el('div', 'progress');
    const fill = el('span');
    fill.style.width = `${Math.round((done / legs.length) * 100)}%`;
    bar.append(fill);
    bar.title = `${done} van ${legs.length} legs binnen`;
    card.append(bar);
  }

  const foot = el('div', 'bet-foot');
  const stake = el('span');
  stake.append(document.createTextNode(`${money(bet.stake)} @ `), el('span', 'mono', Number(bet.odds).toFixed(2)));
  const payout = el('span');
  payout.append(document.createTextNode('Uitbetaling '), el('span', 'mono', money(bet.potentialPayout)));
  foot.append(stake, payout);
  card.append(foot);

  if (bet.cashoutAmount !== null && bet.cashoutAmount !== undefined) {
    const cashout = el('div', 'bet-cashout');
    cashout.append(document.createTextNode('Cash-out '), el('span', 'mono', money(bet.cashoutAmount)));
    card.append(cashout);
  }
  return card;
}

function summaryTile(label, value) {
  const tile = el('div');
  tile.append(el('span', 'label', label), el('span', 'value', value));
  return tile;
}

function renderBets(bets, overlay) {
  if (bets.length === 0) {
    listEl.append(el('div', 'empty', 'Geen open bets.'));
    return;
  }
  const liveBets = new Set(bets.filter((b) => (b.legs || []).some((l) => isLegLive(l, overlay))));
  const summary = el('div', 'summary');
  summary.append(
    summaryTile('Inzet', money(bets.reduce((sum, b) => sum + Number(b.stake || 0), 0))),
    summaryTile('Mogelijk', money(bets.reduce((sum, b) => sum + Number(b.potentialPayout || 0), 0))),
    summaryTile('Live', String(liveBets.size))
  );
  // Kop in dezelfde stijl als Live/Afgelopen op de favorieten-tab.
  listEl.append(summary, el('div', 'group-title', 'Open bets'));

  // Live eerst, daarna op de eerstvolgende aftrap van een nog open leg.
  const nextKickoff = (b) => {
    const times = (b.legs || []).filter((l) => l.status === 'open').map((l) => new Date(legKickoff(l) || 0).getTime());
    return times.length ? Math.min(...times) : Infinity;
  };
  const sorted = bets.slice().sort((a, b) => Number(liveBets.has(b)) - Number(liveBets.has(a)) || nextKickoff(a) - nextKickoff(b));
  for (const bet of sorted) listEl.append(renderBet(bet, overlay));
}

// --- Tabs en laden ------------------------------------------------------------

const TAB_KEY = 'bettracker-sidepanel-tab';
const tabButtons = document.querySelectorAll('.filter-tab');
const refreshBtn = document.getElementById('refresh');
const state = { matches: [], bets: [], overlay: {} };
let activeTab = 'favorites';
try {
  activeTab = localStorage.getItem(TAB_KEY) === 'bets' ? 'bets' : 'favorites';
} catch {
  // Geen opslag beschikbaar - dan gewoon op favorieten beginnen.
}

function render() {
  document.getElementById('count-favorites').textContent = String(state.matches.filter((m) => m.favorite).length);
  document.getElementById('count-bets').textContent = String(state.bets.length);
  for (const button of tabButtons) {
    const active = button.dataset.tab === activeTab;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  }
  listEl.replaceChildren();
  if (activeTab === 'bets') renderBets(state.bets, state.overlay);
  else renderFavorites(state.matches);
}

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = !message;
}

async function getJson(path) {
  const res = await fetch(`${APP_URL}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function load() {
  try {
    const [live, bets, overlay] = await Promise.all([
      getJson('/api/live-scores'),
      getJson('/api/bets?status=open&source=manual'),
      getJson('/api/live-scores/open-matches'),
    ]);
    state.matches = live.matches || [];
    state.bets = Array.isArray(bets) ? bets : [];
    state.overlay = overlay.matches || {};
    render();
    showError('');
    refreshBtn.title = `Vernieuwen (bijgewerkt ${new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })})`;
  } catch (err) {
    showError(`BetTracker niet bereikbaar op ${APP_URL} (${err.message}). Draait Docker?`);
  }
}

for (const button of tabButtons) {
  button.addEventListener('click', () => {
    activeTab = button.dataset.tab;
    try {
      localStorage.setItem(TAB_KEY, activeTab);
    } catch {
      // Onthouden is een gemak, geen vereiste.
    }
    render();
  });
}

refreshBtn.addEventListener('click', load);
document.getElementById('open-app').addEventListener('click', openApp);
// Een verborgen paneel hoeft niet te pollen; bij terugkomen meteen verversen.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) load();
});
setInterval(() => {
  if (!document.hidden) load();
}, REFRESH_MS);
render();
load();
