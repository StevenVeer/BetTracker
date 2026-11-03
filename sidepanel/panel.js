// Zijpaneel met twee tabs: je favoriete wedstrijden uit /api/live-scores
// (favoriet = open bet erop of handmatige ster, zie getFavoriteState() in
// server/index.js), met daaronder de aankomende wedstrijden van vandaag en
// morgen per competitie, en je open bets met live-stand per leg (overlay uit
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

// Korte variant voor de compacte rijen: alleen de tijd vandaag, anders "ma 18:30".
function shortKickoff(iso) {
  const date = new Date(iso);
  const time = date.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === new Date().toDateString()) return time;
  return `${date.toLocaleDateString('nl-NL', { weekday: 'short' })} ${time}`;
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

async function favorite(match) {
  try {
    const res = await fetch(`${APP_URL}/api/favorites/${encodeURIComponent(match.id)}`, { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    showError(`Favoriet toevoegen mislukt: ${err.message}`);
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

function starIcon({ outline = false } = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  if (outline) {
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linejoin', 'round');
  } else {
    svg.setAttribute('fill', 'currentColor');
  }
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

// --- Acties (doelpunten, rode kaarten) ---------------------------------------
// De server levert per wedstrijd m.events (zie normalizeEvents() in
// server/liveScores.js). Hier onthouden we wanneer we elke actie voor het
// eerst zagen: de nieuwste krijgt 2 minuten een banner, eerdere recente
// acties een chip. Bij het openen van het paneel tellen alleen acties die
// volgens de wedstrijdminuut nog vers zijn, zodat je niet het hele
// wedstrijdverloop als "nieuw" ziet.

const EVENT_WINDOW_MS = 2 * 60_000;
const EVENT_WINDOW_MINUTES = 2;
const SEEN_KEY = 'bettracker-sidepanel-seen';
const SEEN_TTL_MS = 6 * 60 * 60_000;

const seenAt = new Map();
try {
  const stored = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}');
  for (const [key, at] of Object.entries(stored)) {
    if (Date.now() - at < SEEN_TTL_MS || at === 0) seenAt.set(key, at);
  }
} catch {
  // Geen of kapotte opslag - dan beginnen we gewoon leeg.
}

function saveSeen() {
  const cutoff = Date.now() - SEEN_TTL_MS;
  for (const [key, at] of seenAt) {
    if (at !== 0 && at < cutoff) seenAt.delete(key);
  }
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(Object.fromEntries(seenAt)));
  } catch {
    // Onthouden is een gemak, geen vereiste.
  }
}

// "45+3" -> 48, "67" -> 67.
function minuteValue(minute) {
  if (!minute) return null;
  const [base, extra] = String(minute).split('+').map(Number);
  return Number.isFinite(base) ? base + (Number.isFinite(extra) ? extra : 0) : null;
}

// Geeft de recente acties (nieuwste eerst) en of er deze render een nieuwe bij
// kwam - dat laatste stuurt het oplichten van de kaart.
function trackEvents(m) {
  const now = Date.now();
  const current = minuteValue(m.minute);
  let fresh = false;
  for (const event of m.events || []) {
    const key = `${m.id}|${event.key}`;
    if (seenAt.has(key)) continue;
    const at = minuteValue(event.minute);
    const recent = LIVE_STATUSES.has(m.status) && current !== null && at !== null && current - at <= EVENT_WINDOW_MINUTES;
    // 0 = al oud toen we hem voor het eerst zagen, nooit een banner.
    seenAt.set(key, recent ? now : 0);
    if (recent) fresh = true;
  }
  const recent = (m.events || [])
    .map((event, index) => ({ event, index, at: seenAt.get(`${m.id}|${event.key}`) || 0 }))
    .filter((x) => x.at && now - x.at < EVENT_WINDOW_MS)
    .sort((a, b) => b.at - a.at || b.index - a.index)
    .map((x) => x.event);
  return { recent, fresh };
}

const BALL_PATH =
  'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 4.2 3.4 2.5-1.3 4h-4.2l-1.3-4zM4.6 9.6l2.4.8 1.3 4-1.5 2.1-2.4-.1a8 8 0 0 1 .2-6.8zm14.8 0a8 8 0 0 1 .2 6.8l-2.4.1-1.5-2.1 1.3-4zM9.4 17.1h5.2l1.2 2.2a8 8 0 0 1-7.6 0z';

function ballIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('fill-rule', 'evenodd');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', BALL_PATH);
  svg.append(path);
  return svg;
}

function eventIcon(event) {
  return event.type === 'goal' ? ballIcon() : el('span', 'red-card');
}

function eventBanner(event, m) {
  const team = event.side === 'home' ? m.home : event.side === 'away' ? m.away : '';
  const banner = el('div', `event-banner${event.type === 'red' ? ' is-red' : ''}`);
  let text;
  if (event.type === 'goal') {
    const suffix = event.ownGoal ? ' (e.d.)' : event.penalty ? ' (pen.)' : '';
    text = `Goal · ${event.player || team}${suffix} ${event.minute ?? ''}'`;
  } else {
    text = `Rode kaart · ${team}${event.player ? ` (${event.player})` : ''} ${event.minute ?? ''}'`;
  }
  const label = el('span', 'event-text', text);
  label.title = text;
  banner.append(eventIcon(event), label);
  // De nieuwste goal is altijd de laatste scorewijziging, dus de huidige stand klopt.
  if (event.type === 'goal') banner.append(el('span', 'event-score', `${m.homeScore ?? '–'}-${m.awayScore ?? '–'}`));
  return banner;
}

function eventChips(events) {
  const chips = el('div', 'event-chips');
  for (const event of events) {
    const chip = el('span', `event-chip${event.type === 'red' ? ' is-red' : ''}`);
    chip.append(eventIcon(event), document.createTextNode(`${event.minute ?? ''}'`));
    chip.title = event.player || '';
    chips.append(chip);
  }
  return chips;
}

// Laatst getoonde stand per wedstrijd, om een gewijzigde score te laten opveren.
const lastScores = new Map();

function teamRow(team, score, { redCards = 0, bump = false } = {}) {
  const row = el('div', 'fav-card-table-row');
  const name = el('span', 'team', team);
  // Een rode kaart blijft de rest van de wedstrijd als markering staan.
  for (let i = 0; i < redCards; i++) name.append(el('span', 'red-card'));
  row.append(name, el('span', `score${bump ? ' bump' : ''}`, score));
  return row;
}

function renderMatch(m) {
  const done = DONE_STATUSES.has(m.status);
  const { recent, fresh } = trackEvents(m);
  const card = el('div', `fav-card${done ? ' is-done' : ''}${fresh ? ' flash' : ''}`);
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

  if (recent.length > 0) {
    card.append(eventBanner(recent[0], m));
    if (recent.length > 1) card.append(eventChips(recent.slice(1)));
  }

  const started = m.status !== 'NS';
  const previous = lastScores.get(m.id);
  lastScores.set(m.id, { home: m.homeScore, away: m.awayScore });
  const reds = (side) => (m.events || []).filter((e) => e.type === 'red' && e.side === side).length;
  const table = el('div', 'fav-card-table');
  table.append(
    teamRow(m.home, started ? String(m.homeScore ?? '–') : '', {
      redCards: reds('home'),
      bump: Boolean(previous) && previous.home !== m.homeScore,
    }),
    teamRow(m.away, started ? String(m.awayScore ?? '–') : '', {
      redCards: reds('away'),
      bump: Boolean(previous) && previous.away !== m.awayScore,
    })
  );
  card.append(table);

  if (m.picks && m.picks.length > 0) card.append(pickLines(m.picks, m));
  return card;
}

// Dezelfde pick uit meerdere bets één keer, met "3×" ervoor (zelfde regel
// als groupSamePicks in src/markets.js). Bet builders blijven los.
function groupSamePicks(picks) {
  const groups = new Map();
  picks.forEach((p, i) => {
    const key =
      Array.isArray(p.parts) && p.parts.length > 1
        ? `bb:${p.legId ?? p.id ?? i}`
        : [p.market, String(p.selection ?? '').trim().toLowerCase(), p.line ?? '', p.earlyPayout ? 'ep' : ''].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  });
  return [...groups.values()];
}

function oddsRange(picks) {
  const odds = picks.map((p) => Number(p.odds)).filter((n) => Number.isFinite(n) && n > 0);
  if (odds.length === 0) return null;
  const lo = Math.min(...odds).toFixed(2);
  const hi = Math.max(...odds).toFixed(2);
  return lo === hi ? lo : `${lo}–${hi}`;
}

function pickLines(picks, match) {
  const lines = el('div', 'pick-lines');
  for (const same of groupSamePicks(picks)) {
    const p = same[0];
    const row = el('div', 'pick-line');
    row.append(el('span', 'market', MARKET_ABBR[p.market] || p.market));
    if (same.length > 1) {
      const count = el('span', 'pick-count', `${same.length}×`);
      count.title = same.map((s) => s.bookmaker).filter(Boolean).join(', ');
      row.append(count);
    }
    row.append(document.createTextNode(pickLabel(p, match)));
    const odds = oddsRange(same);
    if (odds) row.append(el('span', 'odds', odds));
    lines.append(row);
  }
  return lines;
}

// ESPN kent alleen gisteren t/m morgen. Een open bet op een wedstrijd verder
// weg (of een die niet te koppelen is) tonen we daarom vanuit de bet zelf,
// gegroepeerd per wedstrijd. Legs die al als pick op een ESPN-wedstrijd
// staan slaan we over, zodat niets dubbel verschijnt.
function upcomingBetMatches(bets, knownLegIds) {
  const now = Date.now();
  const byMatch = new Map();
  for (const bet of bets) {
    for (const leg of bet.legs || []) {
      const kickoff = legKickoff(leg);
      if (leg.status !== 'open' || knownLegIds.has(leg.id) || !kickoff || new Date(kickoff).getTime() <= now) continue;
      const key = leg.match?.id || `${legLabel(leg)}|${kickoff}`;
      if (!byMatch.has(key)) {
        byMatch.set(key, {
          league: leg.match?.competition || '',
          home: leg.match?.home || legLabel(leg),
          away: leg.match?.away || '',
          kickoff,
          picks: [],
        });
      }
      byMatch.get(key).picks.push({ ...leg, bookmaker: bet.bookmaker });
    }
  }
  return [...byMatch.values()];
}

function renderBetMatch(m) {
  const card = el('div', 'fav-card');
  card.title = 'Open BetTracker';
  card.addEventListener('click', openApp);
  const top = el('div', 'fav-card-top');
  const star = el('span', 'star-btn is-static');
  star.title = 'Favoriet door een open bet';
  star.append(starIcon());
  top.append(el('span', 'league', m.league), el('span', 'badge', kickoffLabel(m.kickoff)), star);
  const table = el('div', 'fav-card-table');
  table.append(teamRow(m.home, ''));
  if (m.away) table.append(teamRow(m.away, ''));
  card.append(top, table, pickLines(m.picks, m));
  return card;
}

// --- Inklapbare secties ------------------------------------------------------
// De kopjes op de favorietentab (live, aankomend, afgelopen, aankomende
// wedstrijden) klap je in met een klik; het paneel onthoudt welke dicht staan.

const COLLAPSED_KEY = 'bettracker-sidepanel-collapsed';
let collapsedSections = new Set();
try {
  const stored = localStorage.getItem(COLLAPSED_KEY);
  if (stored) collapsedSections = new Set(JSON.parse(stored));
} catch {
  // Onthouden is een gemak, geen vereiste.
}

function toggleSection(key) {
  if (collapsedSections.has(key)) collapsedSections.delete(key);
  else collapsedSections.add(key);
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsedSections]));
  } catch {
    // Zie hierboven.
  }
  render();
}

// Kopje met pijltje en teller; geeft terug of de sectie open staat.
function sectionHead(key, title, count, className = '') {
  const isOpen = !collapsedSections.has(key);
  const head = el('button', `group-title section-head${className ? ` ${className}` : ''}`);
  head.type = 'button';
  head.setAttribute('aria-expanded', String(isOpen));
  head.append(el('span', 'chevron', isOpen ? '▾' : '▸'), el('span', 'section-name', title), el('span', 'group-count', String(count)));
  head.addEventListener('click', () => toggleSection(key));
  listEl.append(head);
  return isOpen;
}

// --- Aankomende wedstrijden, per competitie inklapbaar -----------------------

const OPEN_LEAGUES_KEY = 'bettracker-sidepanel-open-leagues';
let openLeagues = null; // null = nog nooit iets ingeklapt: alleen de eerste competitie open
try {
  const stored = localStorage.getItem(OPEN_LEAGUES_KEY);
  if (stored) openLeagues = new Set(JSON.parse(stored));
} catch {
  // Onthouden is een gemak, geen vereiste.
}

function toggleLeague(league, leagues) {
  if (!openLeagues) openLeagues = new Set(leagues.slice(0, 1));
  if (openLeagues.has(league)) openLeagues.delete(league);
  else openLeagues.add(league);
  try {
    localStorage.setItem(OPEN_LEAGUES_KEY, JSON.stringify([...openLeagues]));
  } catch {
    // Zie hierboven.
  }
  render();
}

function renderUpcomingRow(m) {
  const row = el('div', 'up-row');
  row.title = 'Open BetTracker';
  row.addEventListener('click', openApp);
  const star = el('button', 'star-btn is-off');
  star.type = 'button';
  star.title = 'Aan favorieten toevoegen';
  star.setAttribute('aria-label', star.title);
  star.append(starIcon({ outline: true }));
  star.addEventListener('click', (e) => {
    e.stopPropagation();
    favorite(m);
  });
  const teams = el('span', 'up-teams', `${m.home} – ${m.away}`);
  teams.title = teams.textContent;
  row.append(el('span', 'up-time', shortKickoff(m.kickoff)), teams, star);
  return row;
}

function renderUpcomingGames(matches) {
  // Competities op hun eerstvolgende aftrap; matches komt al gesorteerd binnen.
  const byLeague = new Map();
  for (const m of matches) {
    if (!byLeague.has(m.league)) byLeague.set(m.league, []);
    byLeague.get(m.league).push(m);
  }
  const leagues = [...byLeague.keys()];
  const open = openLeagues || new Set(leagues.slice(0, 1));

  listEl.append(el('div', 'divider'));
  if (!sectionHead('games', 'Aankomende wedstrijden vandaag', matches.length)) return;
  for (const league of leagues) {
    const isOpen = open.has(league);
    const head = el('button', `league-head${isOpen ? ' is-open' : ''}`);
    head.type = 'button';
    head.setAttribute('aria-expanded', String(isOpen));
    head.append(el('span', 'chevron', isOpen ? '▾' : '▸'), el('span', 'league-name', league), el('span', 'league-count', String(byLeague.get(league).length)));
    head.addEventListener('click', () => toggleLeague(league, leagues));
    listEl.append(head);
    if (isOpen) for (const m of byLeague.get(league)) listEl.append(renderUpcomingRow(m));
  }
}

function favoriteSections({ matches, upcoming, bets }) {
  const byKickoff = (a, b) => new Date(a.kickoff) - new Date(b.kickoff);
  const favorites = matches.filter((m) => m.favorite);
  const knownLegIds = new Set([...matches, ...upcoming].flatMap((m) => (m.picks || []).map((p) => p.legId)));
  return {
    live: favorites.filter((m) => LIVE_STATUSES.has(m.status)).sort(byKickoff),
    // Een favoriet die nog niet begonnen is (ESPN), plus open bets op
    // wedstrijden die ESPN (nog) niet kent - als kaart vanuit de bet zelf.
    upcoming: [
      ...favorites.filter((m) => m.status === 'NS'),
      ...upcoming.filter((m) => m.favorite),
      ...upcomingBetMatches(bets, knownLegIds).map((m) => ({ ...m, fromBet: true })),
    ].sort(byKickoff),
    done: favorites.filter((m) => DONE_STATUSES.has(m.status)).sort((a, b) => byKickoff(b, a)),
    // Alleen het programma van vandaag; ESPN levert ook morgen, maar dat
    // maakt de lijst te lang.
    others: upcoming.filter((m) => !m.favorite && new Date(m.kickoff).toDateString() === new Date().toDateString()),
  };
}

function renderFavorites(sections) {
  const groups = [
    { key: 'live', title: 'Live', items: sections.live },
    { key: 'upcoming', title: 'Aankomende favorieten', items: sections.upcoming },
    { key: 'done', title: 'Afgelopen', className: 'muted', items: sections.done },
  ];
  if (groups.every((g) => g.items.length === 0)) {
    listEl.append(el('div', 'empty', 'Geen favorieten. Zet een ster op een wedstrijd hieronder of in BetTracker, of plaats een bet.'));
  }
  for (const group of groups) {
    if (group.items.length === 0) continue;
    if (!sectionHead(group.key, group.title, group.items.length, group.className)) continue;
    for (const m of group.items) listEl.append(m.fromBet ? renderBetMatch(m) : renderMatch(m));
  }
  if (sections.others.length > 0) renderUpcomingGames(sections.others);
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
const state = { matches: [], upcoming: [], bets: [], overlay: {} };
let activeTab = 'favorites';
try {
  activeTab = localStorage.getItem(TAB_KEY) === 'bets' ? 'bets' : 'favorites';
} catch {
  // Geen opslag beschikbaar - dan gewoon op favorieten beginnen.
}

function render() {
  const sections = favoriteSections(state);
  document.getElementById('count-favorites').textContent = String(sections.live.length + sections.upcoming.length + sections.done.length);
  document.getElementById('count-bets').textContent = String(state.bets.length);
  for (const button of tabButtons) {
    const active = button.dataset.tab === activeTab;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  }
  listEl.replaceChildren();
  if (activeTab === 'bets') renderBets(state.bets, state.overlay);
  else renderFavorites(sections);
  saveSeen();
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
    state.upcoming = live.upcoming || [];
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
// Sluit het zijpaneel zelf; openen gaat weer via het icoon of Alt+Shift+F.
document.getElementById('close').addEventListener('click', () => window.close());
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
