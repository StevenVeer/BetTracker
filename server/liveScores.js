// Live-wedstrijden overzicht - volledig los van de bet-settlement/Odds API-
// flow in index.js. Odds API kost credits en wordt daarom spaarzaam gepolld;
// deze feed komt van ESPN's publieke (gratis, onofficiële) scoreboard-API en
// mag dus vaak ververst worden zonder ooit tegen een quotum aan te lopen.
// Eén gedeelde poll-cyclus voor alle open tabbladen samen, niet een aparte
// upstream-call per binnenkomende /api/live-scores-request.
import { LEAGUES } from './leagues.js';
import { teamNamesMatch } from './teamMatch.js';

// 'all' levert alle voetbalwedstrijden van een dag in één call; zonder limit
// kapt ESPN af op 100 events, en op een drukke dag zijn dat er ruim 400.
const ESPN_SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard';
const POLL_MS = Number(process.env.LIVE_SCORES_POLL_MS || 20000);
// Bij een 429 (of ander teken van blokkade) pauzeren we een paar cycli i.p.v.
// gewoon door te blijven proberen, zodat we het niet erger maken.
const BACKOFF_MS = 2 * 60 * 1000;
const RETENTION_TZ = 'Europe/Amsterdam';

// ESPN-competitie-ID's (het l:<id>-deel van event.uid) per competitie uit
// leagues.js. Bewust op ID gematcht en niet op naam: ESPN heeft ook
// vrouwencompetities e.d. waarvan de teamnamen identiek zijn (Real Madrid in
// Liga F i.p.v. La Liga). ID's zijn geverifieerd tegen de per-competitie
// scoreboards (site/v2/sports/soccer/<slug>/scoreboard -> leagues[0].id).
const ESPN_LEAGUE_IDS = {
  soccer_epl: '700',
  soccer_spain_la_liga: '740',
  soccer_germany_bundesliga: '720',
  soccer_italy_serie_a: '730',
  soccer_france_ligue_one: '710',
  soccer_netherlands_eredivisie: '725',
  soccer_uefa_champs_league: '775',
  soccer_uefa_europa_league: '776',
  soccer_uefa_europa_conference_league: '20296',
  soccer_portugal_primeira_liga: '715',
  soccer_efl_champ: '3914',
  soccer_fa_cup: '3918',
  soccer_england_efl_cup: '3920',
  soccer_spl: '735',
  soccer_italy_serie_b: '3931',
  soccer_italy_coppa_italia: '3956',
  soccer_germany_bundesliga2: '3927',
  soccer_germany_dfb_pokal: '3954',
  soccer_france_ligue_two: '3926',
  soccer_spain_segunda_division: '3921',
  soccer_spain_copa_del_rey: '3951',
  soccer_switzerland_superleague: '3944',
  soccer_belgium_first_div: '3901',
  soccer_sweden_allsvenskan: '3945',
  soccer_norway_eliteserien: '3960',
  soccer_usa_mls: '770',
  soccer_fifa_world_cup: '606',
  soccer_uefa_european_championship: '781',
  soccer_uefa_nations_league: '2395',
  soccer_africa_cup_of_nations: '3908',
  soccer_africa_cup_of_nations_qual: '8315',
  soccer_concacaf_gold_cup: '4004',
  soccer_concacaf_gold_cup_qual: '19778',
  soccer_concacaf_nations_league: '19267',
};

// ESPN-ID -> { index, name } - index bepaalt de volgorde (dezelfde tier-
// volgorde als de dropdown, top eerst), name is onze eigen leesbare naam.
const LEAGUE_BY_ESPN_ID = new Map();
LEAGUES.forEach((league, index) => {
  const id = ESPN_LEAGUE_IDS[league.key];
  if (id) LEAGUE_BY_ESPN_ID.set(id, { index, name: league.name });
});

const IN_PLAY_STATUSES = new Set(['1H', '2H', 'HT', 'ET', 'ET1', 'ET2']);

// De rest van de app (live-tab, overlay op open picks) werkt met de korte
// statuscodes uit de vroegere bron (1H/HT/2H/ET/FT/AET/PEN/...); ESPN's
// status.type.name wordt hier naar dezelfde codes vertaald zodat de UI niet
// hoeft te weten waar de data vandaan komt. Onbekende namen vallen terug op
// status.type.state (pre/in/post) i.p.v. een wedstrijd stil te laten hangen.
const ESPN_STATUS_CODES = {
  STATUS_SCHEDULED: 'NS',
  STATUS_FIRST_HALF: '1H',
  STATUS_HALFTIME: 'HT',
  STATUS_SECOND_HALF: '2H',
  STATUS_END_OF_REGULATION: 'HT',
  STATUS_FIRST_HALF_EXTRA_TIME: 'ET',
  STATUS_HALFTIME_ET: 'ET',
  STATUS_SECOND_HALF_EXTRA_TIME: 'ET',
  STATUS_END_OF_EXTRA_TIME: 'ET',
  STATUS_EXTRA_TIME: 'ET',
  STATUS_SHOOTOUT: 'PEN',
  STATUS_FULL_TIME: 'FT',
  STATUS_FINAL: 'FT',
  STATUS_FINAL_AET: 'AET',
  STATUS_FINAL_PEN: 'AET',
  STATUS_POSTPONED: 'POST',
  STATUS_CANCELED: 'CANC',
  STATUS_CANCELLED: 'CANC',
  STATUS_ABANDONED: 'CANC',
};

function toStatusCode(status) {
  const type = status?.type;
  if (!type) return null;
  const mapped = ESPN_STATUS_CODES[type.name];
  if (mapped) return mapped;
  if (type.state === 'in') return status.period === 1 ? '1H' : '2H';
  if (type.state === 'post') return 'FT';
  return 'NS';
}

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

// Eigen state per wedstrijd-ID, zodat een wedstrijd tot 02:00 de volgende dag
// zichtbaar blijft ongeacht welke dagen ESPN in een poll teruggeeft.
const matchStore = new Map(); // id -> genormaliseerde match (incl. kickoff)

let cache = { matches: [], updatedAt: null, error: null };
let pausedUntil = 0;

// "45'+3'" -> "45+3" (de UI plakt zelf de apostrof erachter).
function normalizeMinute(displayClock) {
  if (!displayClock) return null;
  const cleaned = String(displayClock).replace(/'/g, '').trim();
  return cleaned || null;
}

function normalizeMatch(event) {
  const leagueId = (event.uid || '').match(/~l:(\d+)/)?.[1];
  const info = LEAGUE_BY_ESPN_ID.get(leagueId);
  if (!info) return null; // niet een van onze getrackte competities - overslaan
  const status = event.status;
  // Nog niet begonnen: de live-tab toont alleen wat bezig is of net is
  // afgelopen, niet het hele programma van de dag.
  if (status?.type?.state === 'pre') return null;
  const competition = event.competitions?.[0];
  const home = competition?.competitors?.find((c) => c.homeAway === 'home');
  const away = competition?.competitors?.find((c) => c.homeAway === 'away');
  if (!home || !away) return null;
  const toScore = (c) => (c.score !== undefined && c.score !== null && c.score !== '' ? Number(c.score) : null);
  return {
    id: String(event.id),
    league: info.name,
    sortIndex: info.index,
    home: home.team.displayName,
    away: away.team.displayName,
    homeScore: toScore(home),
    awayScore: toScore(away),
    status: toStatusCode(status), // bv. '1H', 'HT', '2H', 'FT'
    minute: normalizeMinute(status?.displayClock),
    kickoff: event.date || null, // ISO met Z-suffix, echt UTC
  };
}

// Parseert een aftraptijd als UTC, ook als het suffix ontbreekt - zodat de
// tijdzone van de servermachine nooit meespeelt.
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

function yyyymmdd(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

// ESPN's scoreboard is per dag; een wedstrijd van gisteravond laat kan nog
// lopen (of net afgelopen zijn) terwijl het al een nieuwe UTC-dag is, dus we
// halen gisteren én vandaag op.
async function fetchScoreboardEvents() {
  const now = Date.now();
  const days = [yyyymmdd(new Date(now - 24 * 60 * 60 * 1000)), yyyymmdd(new Date(now))];
  const responses = await Promise.all(days.map((day) => fetch(`${ESPN_SCOREBOARD_URL}?dates=${day}&limit=500`)));
  const events = [];
  for (const response of responses) {
    if (response.status === 429 || response.status === 403) {
      pausedUntil = Date.now() + BACKOFF_MS;
      throw new Error(`geblokkeerd/rate limited door ESPN (${response.status}) - pauzeer even`);
    }
    if (!response.ok) throw new Error(`ESPN gaf status ${response.status}`);
    const data = await response.json();
    events.push(...(data.events || []));
  }
  return events;
}

async function poll() {
  if (Date.now() < pausedUntil) return;
  try {
    const events = await fetchScoreboardEvents();
    const incoming = events.map(normalizeMatch).filter(Boolean);
    const incomingIds = new Set(incoming.map((m) => m.id));
    // ESPN levert een afgelopen wedstrijd gewoon met FT, dus dit hoort zelden
    // te gebeuren. Valt een in-play wedstrijd toch uit de response (bv. een
    // dag-grens of een hik), zet 'm dan op FT i.p.v. voor eeuwig op de laatst
    // bekende minuut te laten hangen - komt hij een poll later terug, dan
    // overschrijft de merge hieronder dit weer met de echte status.
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

// Zelfde fuzzy match als findLiveMatchFor, maar geeft het live-ID terug i.p.v.
// de overlay - gebruikt om favorieten-op-basis-van-een-bet te herkennen (zie
// getFavoriteState() in index.js) zonder de matching-logica te dupliceren.
export function findLiveMatchIdFor(params) {
  const live = findLiveRecordFor(params);
  return live ? live.id : null;
}

// Handmatige koppeling (zie PATCH /api/matches/:id/live-link) - overschrijft
// de fuzzy-matching hierboven met een expliciet gekozen live-ID, voor als de
// automatische match een keer misgrijpt (bv. een afwijkende teamnaamspelling).
// De koppeling zelf staat in matches.tsdb_live_id (historische kolomnaam, bevat
// nu ESPN-event-ID's); hier alleen opzoeken of die wedstrijd op dit moment
// ook echt in de live-cache zit (staat hij er niet meer in - bv. na de
// 02:00-cutoff, of is het een oud ID uit de vorige bron - dan gewoon niets
// tonen, net als een mislukte automatische match).
export function getLiveMatchOverlayById(liveId) {
  const live = matchStore.get(liveId);
  return live ? toOverlay(live) : null;
}

// Voor de detailpagina (zie matchDetail.js): de opgeslagen match zelf.
export function getLiveMatchById(liveId) {
  return matchStore.get(String(liveId)) || null;
}

export function isInPlayStatus(status) {
  return IN_PLAY_STATUSES.has(status);
}

export function getLiveScores() {
  return cache;
}

export function startLiveScoresPoller() {
  poll();
  setInterval(poll, POLL_MS);
}
