// Live-wedstrijden overzicht - volledig los van de bet-settlement/Odds API-
// flow in index.js. Odds API kost credits en wordt daarom spaarzaam gepolld;
// deze feed komt van TheSportsDB's publieke (gratis) livescore-endpoint en
// mag dus vaak ververst worden zonder ooit tegen een quotum aan te lopen.
// Eén gedeelde poll-cyclus voor alle open tabbladen samen, niet een aparte
// upstream-call per binnenkomende /api/live-scores-request.
import { LEAGUES } from './leagues.js';
import { teamNamesMatch } from './teamMatch.js';

const TSDB_LIVESCORE_URL = 'https://www.thesportsdb.com/api/v1/json/3/livescore.php?s=Soccer';
const POLL_MS = Number(process.env.LIVE_SCORES_POLL_MS || 20000);
// TheSportsDB's gratis testkey deelt een rate limit met alle gebruikers
// ervan - bij een 429 pauzeren we een paar cycli i.p.v. gewoon door te
// blijven proberen, zodat we het niet erger maken en zelf ook sneller
// herstellen.
const BACKOFF_MS = 2 * 60 * 1000;
const RETENTION_TZ = 'Europe/Amsterdam';

// TheSportsDB noemt competities net anders dan de Odds API/onze eigen
// dropdown (zie leagues.js) - alleen de competities die hier een alias
// hebben komen in het live-overzicht terecht, exact zo genoemd als in de
// dropdown. Namen zijn geverifieerd via TheSportsDB's eigen lookup-endpoints
// (search_all_leagues.php / lookupleague.php met de gratis testkey); een
// paar minder-vaak-live competities (WK, EK) zijn een best-effort gok op
// basis van hun naamgevingspatroon en kunnen missen tot ze een keer live
// zijn bevestigd.
const TSDB_ALIASES = {
  soccer_epl: ['english premier league'],
  soccer_spain_la_liga: ['spanish la liga'],
  soccer_germany_bundesliga: ['german bundesliga'],
  soccer_italy_serie_a: ['italian serie a'],
  soccer_france_ligue_one: ['french ligue 1'],
  soccer_netherlands_eredivisie: ['dutch eredivisie'],
  soccer_uefa_champs_league: ['uefa champions league'],
  soccer_uefa_europa_league: ['uefa europa league'],
  soccer_uefa_europa_conference_league: ['uefa europa conference league'],
  soccer_portugal_primeira_liga: ['portuguese primeira liga'],
  soccer_efl_champ: ['english league championship'],
  soccer_fa_cup: ['fa cup'],
  soccer_england_efl_cup: ['efl cup'],
  soccer_spl: ['scottish premier league'],
  soccer_italy_serie_b: ['italian serie b'],
  soccer_italy_coppa_italia: ['coppa italia'],
  soccer_germany_bundesliga2: ['german 2. bundesliga'],
  soccer_germany_dfb_pokal: ['dfb-pokal'],
  soccer_france_ligue_two: ['french ligue 2'],
  soccer_spain_segunda_division: ['spanish la liga 2', 'spanish segunda division', 'spanish segunda división'],
  soccer_spain_copa_del_rey: ['copa del rey'],
  soccer_switzerland_superleague: ['swiss super league'],
  soccer_belgium_first_div: ['belgian pro league'],
  soccer_sweden_allsvenskan: ['swedish allsvenskan'],
  soccer_norway_eliteserien: ['norwegian eliteserien'],
  soccer_usa_mls: ['american major league soccer'],
  soccer_fifa_world_cup: ['fifa world cup'],
  soccer_uefa_european_championship: ['uefa european championship'],
  soccer_uefa_nations_league: ['uefa nations league'],
};

// alias (lowercase) -> { index, name } - index bepaalt de volgorde
// (dezelfde tier-volgorde als de dropdown, top eerst), name is onze eigen
// leesbare naam (bv. "Premier League" i.p.v. TheSportsDB's "English Premier
// League"), zodat het overzicht er hetzelfde uitziet als de rest van de app.
const LEAGUE_BY_ALIAS = new Map();
LEAGUES.forEach((league, index) => {
  for (const alias of TSDB_ALIASES[league.key] || []) {
    LEAGUE_BY_ALIAS.set(alias, { index, name: league.name });
  }
});

const IN_PLAY_STATUSES = new Set(['1H', '2H', 'HT', 'ET', 'ET1', 'ET2']);

// Wordt zowel voor het live-tabblad als voor de live-overlay op open picks
// (zie findLiveMatchFor hieronder) gebruikt: 1H/2H/HT/ET tellen als "live",
// de rest (FT, AET, PEN, ...) als afgerond.
function toOverlayStatus(status) {
  return IN_PLAY_STATUSES.has(status) ? 'live' : 'finished';
}

// Specifiek voor het automatisch uitzetten van de favorieten-ster als een
// wedstrijd is afgelopen (zie /api/live-scores in index.js) - bewust smaller
// dan "niet live": NS (nog niet begonnen) en PEN (penalty's, nog bezig) mogen
// niet meetellen, anders verdwijnt een favoriet vóór aftrap of midden in een
// shootout.
export const FINISHED_STATUSES = new Set(['FT', 'AET']);

// TheSportsDB laat een afgelopen wedstrijd zelf ergens (ongedocumenteerd)
// uit de livescore-feed vallen - vaak al binnen een paar uur. Om zelf te
// kunnen garanderen dat een wedstrijd tot 02:00 de volgende dag zichtbaar
// blijft, houden we een eigen state bij per wedstrijd-ID i.p.v. bij elke
// poll domweg te herhalen wat TheSportsDB net teruggeeft.
const matchStore = new Map(); // id -> genormaliseerde match (incl. kickoff)

let cache = { matches: [], updatedAt: null, error: null };
let pausedUntil = 0;

function normalizeMatch(m) {
  const info = LEAGUE_BY_ALIAS.get((m.strLeague || '').toLowerCase());
  if (!info) return null; // niet een van onze getrackte competities - overslaan
  return {
    id: m.idEvent,
    league: info.name,
    sortIndex: info.index,
    home: m.strHomeTeam,
    away: m.strAwayTeam,
    homeScore: m.intHomeScore !== null && m.intHomeScore !== undefined ? Number(m.intHomeScore) : null,
    awayScore: m.intAwayScore !== null && m.intAwayScore !== undefined ? Number(m.intAwayScore) : null,
    status: m.strStatus || null, // bv. '1H', 'HT', '2H', 'FT'
    minute: m.strProgress || null,
    kickoff: m.strTimestamp || null, // TheSportsDB levert dit als UTC, zonder 'Z'-suffix
  };
}

// TheSportsDB's strTimestamp mist het tijdzone-suffix maar is in de praktijk
// UTC (vergeleken met bekende lokale aftraptijden) - hier expliciet als UTC
// parsen i.p.v. de tijdzone van de servermachine te laten gokken.
export function parseKickoffUtc(kickoffIso) {
  const hasOffset = /[Zz]$|[+-]\d\d:\d\d$/.test(kickoffIso);
  return new Date(hasOffset ? kickoffIso : `${kickoffIso}Z`);
}

export function amsterdamDateParts(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: RETENTION_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

// Zet een lokale (Amsterdamse) wandkloktijd om naar een echt UTC-tijdstip -
// via een gok-en-corrigeer aanpak, zodat dit klopt ongeacht winter-/
// zomertijd en ongeacht in welke tijdzone de servermachine zelf draait.
export function amsterdamWallTimeToUtcMs(year, month, day, hour, minute) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: RETENTION_TZ,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(guess))
      .map((p) => [p.type, p.value])
  );
  const shownAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second)
  );
  return guess + (guess - shownAsUtc);
}

// Een wedstrijd blijft zichtbaar tot 02:00 (Nederlandse tijd) de dag NA de
// wedstrijddag - een wedstrijd op zaterdag 11:00 blijft dus tot zondag 02:00
// staan, ongeacht hoe laat op zaterdag hij precies was.
function retentionCutoffMs(kickoffIso) {
  const kickoff = parseKickoffUtc(kickoffIso);
  const { year, month, day } = amsterdamDateParts(kickoff);
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1)); // dag+1 normaliseert vanzelf over maandgrenzen
  return amsterdamWallTimeToUtcMs(nextDay.getUTCFullYear(), nextDay.getUTCMonth() + 1, nextDay.getUTCDate(), 2, 0);
}

function pruneExpired() {
  const now = Date.now();
  for (const [id, match] of matchStore) {
    if (!match.kickoff || now >= retentionCutoffMs(match.kickoff)) matchStore.delete(id);
  }
}

function buildSortedMatches() {
  return [...matchStore.values()].sort((a, b) => {
    if (a.sortIndex !== b.sortIndex) return a.sortIndex - b.sortIndex;
    return parseKickoffUtc(a.kickoff) - parseKickoffUtc(b.kickoff);
  });
}

async function poll() {
  if (Date.now() < pausedUntil) return;
  try {
    const response = await fetch(TSDB_LIVESCORE_URL);
    if (response.status === 429) {
      pausedUntil = Date.now() + BACKOFF_MS;
      throw new Error('rate limited door TheSportsDB (429) - pauzeer even');
    }
    if (!response.ok) throw new Error(`TheSportsDB gaf status ${response.status}`);
    const data = await response.json();
    const incoming = (data.livescore || []).map(normalizeMatch).filter(Boolean);
    const incomingIds = new Set(incoming.map((m) => m.id));
    // TheSportsDB flikt de status van een afgelopen wedstrijd niet betrouwbaar
    // naar FT - hij laat 'm vaak gewoon stilletjes uit de feed vallen (zie
    // comment bij matchStore hierboven). Zonder ingrijpen blijft zo'n
    // wedstrijd hier voor eeuwig op zijn laatst bekende status/minuut hangen
    // (bv. "90+4") tot de 02:00-cutoff. Was een wedstrijd nog in-play en zit
    // hij nu niet meer in de response, dan is dat zelf al een vrij
    // betrouwbaar signaal dat hij is afgelopen - zet 'm dan zelf op FT. Komt
    // hij een volgende poll alsnog weer terug (tijdelijke hik in de feed),
    // dan overschrijft de merge hieronder deze gok gewoon weer met de echte
    // status.
    for (const [id, existing] of matchStore) {
      if (!incomingIds.has(id) && IN_PLAY_STATUSES.has(existing.status)) {
        matchStore.set(id, { ...existing, status: 'FT' });
      }
    }
    for (const match of incoming) {
      matchStore.set(match.id, match);
    }
    pruneExpired();
    cache = { matches: buildSortedMatches(), updatedAt: new Date().toISOString(), error: null };
  } catch (error) {
    console.error('[live-scores] poll mislukt:', error.message);
    // Bestaande wedstrijden blijven staan (tot hun eigen 02:00-cutoff) i.p.v.
    // dat een enkele mislukte poll de weergave meteen leegtrekt.
    pruneExpired();
    cache = { matches: buildSortedMatches(), updatedAt: cache.updatedAt, error: error.message };
  }
}

// Kleine marge tegen een langgezocht vals-positief: dezelfde twee teams
// kunnen (zelden) meerdere keren tegen elkaar spelen binnen de periode dat
// we afgelopen wedstrijden bewaren (tot 02:00 de volgende dag) - alleen
// koppelen als de aftraptijden ook echt bij elkaar in de buurt liggen.
const MATCH_TIME_WINDOW_MS = 18 * 60 * 60 * 1000;

// Live-overlay voor open picks (zie /api/live-scores/open-matches in
// index.js) - matcht op exact dezelfde competitienaam (beide kanten gebruiken
// leagues.js) en fuzzy teamnamen (zelfde matcher als bij de Telegram-picks).
// Puur informatief: dit raakt nooit bet_legs.status of een payout, alleen de
// weergave van een nog open pick. Mislukt de match, dan blijft de bestaande
// "Live scores ophalen"-knop gewoon werken zoals altijd.
function toOverlay(live) {
  return {
    homeScore: live.homeScore,
    awayScore: live.awayScore,
    status: toOverlayStatus(live.status),
    minute: live.minute,
  };
}

function findLiveRecordFor({ home, away, competition, commenceTime }) {
  const commence = commenceTime ? new Date(commenceTime).getTime() : null;
  for (const live of matchStore.values()) {
    if (live.league !== competition) continue;
    if (!teamNamesMatch(live.home, home) || !teamNamesMatch(live.away, away)) continue;
    if (commence !== null && live.kickoff) {
      const liveKickoffMs = parseKickoffUtc(live.kickoff).getTime();
      if (Math.abs(liveKickoffMs - commence) > MATCH_TIME_WINDOW_MS) continue;
    }
    return live;
  }
  return null;
}

export function findLiveMatchFor(params) {
  const live = findLiveRecordFor(params);
  return live ? toOverlay(live) : null;
}

// Zelfde fuzzy match als findLiveMatchFor, maar geeft het TheSportsDB-ID
// terug i.p.v. de overlay - gebruikt om favorieten-op-basis-van-een-bet te
// herkennen (zie getFavoriteState() in index.js) zonder de matching-logica
// te dupliceren.
export function findLiveMatchIdFor(params) {
  const live = findLiveRecordFor(params);
  return live ? live.id : null;
}

// Handmatige koppeling (zie PATCH /api/matches/:id/live-link) - overschrijft
// de fuzzy-matching hierboven met een expliciet gekozen TheSportsDB-ID, voor
// als de automatische match een keer misgrijpt (bv. een afwijkende
// teamnaamspelling). De koppeling zelf staat in matches.tsdb_live_id; hier
// alleen opzoeken of die wedstrijd op dit moment ook echt in de live-cache
// zit (staat hij er niet meer in - bv. na de 02:00-cutoff - dan gewoon niets
// tonen, net als een mislukte automatische match).
export function getLiveMatchOverlayById(tsdbId) {
  const live = matchStore.get(tsdbId);
  return live ? toOverlay(live) : null;
}

export function getLiveScores() {
  return cache;
}

export function startLiveScoresPoller() {
  poll();
  setInterval(poll, POLL_MS);
}
