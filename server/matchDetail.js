// Detailpagina van een live wedstrijd: statistieken, tijdlijn, opstellingen en
// een afgeleide "druk"-grafiek, allemaal uit ESPN's summary-endpoint. Los van
// de scoreboard-poll in liveScores.js - dit wordt alleen opgehaald zolang er
// iemand een detailpagina open heeft.
import { getLiveMatchById, isInPlayStatus } from './liveScores.js';

const SUMMARY_URL = 'https://site.api.espn.com/apis/site/v2/sports/soccer/all/summary';
// Meerdere open tabs (of snel heen-en-weer klikken) delen één upstream-call
// per wedstrijd binnen dit venster.
const CACHE_TTL_MS = 15000;
const BUCKET_MINUTES = 5;
const MAX_SNAPSHOTS = 600;

const cache = new Map(); // id -> { at, promise }
const snapshots = new Map(); // id -> [{ minute, home: {...}, away: {...} }]

function statValue(stats, name) {
  const s = stats.find((x) => x.name === name);
  if (!s) return null;
  const n = Number(s.value ?? s.displayValue);
  return Number.isFinite(n) ? n : null;
}

// Volgorde = volgorde op de pagina. `sub` is een tweede getal onder de
// hoofdwaarde (bv. passnauwkeurigheid).
const STAT_ROWS = [
  { key: 'possession', label: 'Balbezit', name: 'possessionPct', percent: true },
  { key: 'shots', label: 'Schoten', name: 'totalShots' },
  { key: 'shotsOnTarget', label: 'Schoten op doel', name: 'shotsOnTarget' },
  { key: 'corners', label: 'Corners', name: 'wonCorners' },
  { key: 'passes', label: 'Passes', name: 'totalPasses', subName: 'passPct' },
  { key: 'tackles', label: 'Tackles', name: 'totalTackles' },
  { key: 'fouls', label: 'Overtredingen', name: 'foulsCommitted' },
  { key: 'offsides', label: 'Buitenspel', name: 'offsides' },
  { key: 'saves', label: 'Reddingen', name: 'saves' },
  { key: 'yellowCards', label: 'Gele kaarten', name: 'yellowCards' },
  { key: 'redCards', label: 'Rode kaarten', name: 'redCards' },
];

function buildStats(summary, sideByTeamId) {
  const teams = summary.boxscore?.teams || [];
  const bySide = {};
  for (const t of teams) {
    const side = sideByTeamId.get(String(t.team?.id));
    if (side) bySide[side] = t.statistics || [];
  }
  if (!bySide.home || !bySide.away) return [];
  const rows = [];
  for (const def of STAT_ROWS) {
    const home = statValue(bySide.home, def.name);
    const away = statValue(bySide.away, def.name);
    if (home === null && away === null) continue;
    const row = { key: def.key, label: def.label, home: home ?? 0, away: away ?? 0, percent: Boolean(def.percent) };
    if (def.subName) {
      const homeSub = statValue(bySide.home, def.subName);
      const awaySub = statValue(bySide.away, def.subName);
      // passPct is een fractie (0.88) - als procent doorgeven.
      row.homeSub = homeSub !== null ? Math.round(homeSub * 100) : null;
      row.awaySub = awaySub !== null ? Math.round(awaySub * 100) : null;
    }
    rows.push(row);
  }
  // Nog niets gespeeld (alles 0) heeft geen zin om te tonen.
  return rows.some((r) => r.home > 0 || r.away > 0) ? rows : [];
}

function classifyEvent(ev) {
  const text = ev.type?.text || '';
  if (ev.scoringPlay || /^goal|penalty - scored|own goal/i.test(text)) return 'goal';
  if (/yellow/i.test(text)) return 'yellow';
  if (/red/i.test(text)) return 'red';
  if (/substitution/i.test(text)) return 'sub';
  return null;
}

// "45'+3'" -> "45+3"
function cleanMinute(value) {
  return String(value || '').replace(/'/g, '').trim();
}

function buildTimeline(summary, sideByTeamId) {
  const events = [];
  for (const ev of summary.keyEvents || []) {
    const kind = classifyEvent(ev);
    if (!kind) continue;
    const players = (ev.participants || []).map((p) => p.athlete?.displayName).filter(Boolean);
    events.push({
      minute: cleanMinute(ev.clock?.displayValue),
      seconds: Number(ev.clock?.value) || 0,
      kind,
      side: sideByTeamId.get(String(ev.team?.id)) || null,
      // Bij een wissel geeft ESPN eerst de speler die erin komt, dan die eruit gaat.
      players,
      detail: kind === 'goal' ? ev.type?.text || null : null,
    });
  }
  // Nieuwste bovenaan.
  return events.sort((a, b) => b.seconds - a.seconds);
}

function buildLineups(summary) {
  const out = { home: null, away: null };
  for (const r of summary.rosters || []) {
    if (r.homeAway !== 'home' && r.homeAway !== 'away') continue;
    const players = (r.roster || []).map((p) => ({
      number: p.jersey || null,
      name: p.athlete?.displayName || '',
      position: p.position?.abbreviation || null,
      starter: Boolean(p.starter),
    }));
    if (players.length === 0) continue;
    out[r.homeAway] = {
      team: r.team?.displayName || null,
      formation: r.formation || null,
      starters: players.filter((p) => p.starter),
      subs: players.filter((p) => !p.starter),
    };
  }
  return out.home || out.away ? out : null;
}

function minuteNumber(minute) {
  const n = parseInt(minute, 10);
  return Number.isFinite(n) ? n : null;
}

// Ruwe activiteit van één team op een moment: schoten wegen 1, schoten op
// doel 2 (bovenop het schot zelf), corners 1. Bewust simpel - dit is een
// indicatie van wie de wedstrijd op dat moment domineert, geen echte
// pressure-metric zoals die van Sofascore (die niet gratis beschikbaar is).
function activity(stats) {
  return stats.shots + stats.shotsOnTarget * 2 + stats.corners;
}

function recordSnapshot(id, match, stats) {
  if (!isInPlayStatus(match.status)) return;
  const minute = minuteNumber(match.minute);
  if (minute === null) return;
  const byKey = Object.fromEntries(stats.map((r) => [r.key, r]));
  const pick = (side) => ({
    shots: byKey.shots?.[side] ?? 0,
    shotsOnTarget: byKey.shotsOnTarget?.[side] ?? 0,
    corners: byKey.corners?.[side] ?? 0,
  });
  const list = snapshots.get(id) || [];
  const last = list[list.length - 1];
  // Zelfde minuut als de vorige snapshot: overschrijven i.p.v. bijschrijven.
  const snap = { minute, home: pick('home'), away: pick('away') };
  if (last && last.minute === minute) list[list.length - 1] = snap;
  else list.push(snap);
  if (list.length > MAX_SNAPSHOTS) list.shift();
  snapshots.set(id, list);
}

// Alleen wat we hebben zien binnenkomen: de grafiek start op het moment dat
// de eerste snapshot is genomen (dus wanneer iemand de pagina opende), niet
// bij de aftrap - ESPN geeft geen minuut-voor-minuut-historie.
function buildMomentum(id) {
  const list = snapshots.get(id) || [];
  if (list.length < 2) return null;
  const buckets = new Map(); // bucketStart -> { home, away }
  for (let i = 1; i < list.length; i += 1) {
    const prev = list[i - 1];
    const cur = list[i];
    const start = Math.floor(cur.minute / BUCKET_MINUTES) * BUCKET_MINUTES;
    const b = buckets.get(start) || { start, home: 0, away: 0 };
    b.home += Math.max(0, activity(cur.home) - activity(prev.home));
    b.away += Math.max(0, activity(cur.away) - activity(prev.away));
    buckets.set(start, b);
  }
  return {
    bucketMinutes: BUCKET_MINUTES,
    since: list[0].minute,
    buckets: [...buckets.values()].sort((a, b) => a.start - b.start),
  };
}

async function fetchSummary(id) {
  const response = await fetch(`${SUMMARY_URL}?event=${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error(`ESPN gaf status ${response.status}`);
  return response.json();
}

async function loadDetail(id) {
  const summary = await fetchSummary(id);
  const competitors = summary.header?.competitions?.[0]?.competitors || [];
  const sideByTeamId = new Map(competitors.map((c) => [String(c.team?.id), c.homeAway]));
  const stats = buildStats(summary, sideByTeamId);
  const match = getLiveMatchById(id);
  if (match) recordSnapshot(id, match, stats);
  return {
    stats,
    timeline: buildTimeline(summary, sideByTeamId),
    lineups: buildLineups(summary),
    momentum: buildMomentum(id),
    venue: summary.gameInfo?.venue?.fullName || null,
    updatedAt: new Date().toISOString(),
  };
}

// null als de wedstrijd niet (meer) in de live-cache zit - de pagina hoort
// alleen bij wedstrijden uit het live-overzicht.
export async function getMatchDetail(id) {
  const match = getLiveMatchById(id);
  if (!match) return null;
  const key = String(id);
  const cached = cache.get(key);
  if (!cached || Date.now() - cached.at >= CACHE_TTL_MS) {
    const promise = loadDetail(key);
    const entry = { at: Date.now(), promise };
    cache.set(key, entry);
    // Een mislukte call niet cachen, anders blijft de fout 15 seconden hangen.
    promise.catch(() => {
      if (cache.get(key) === entry) cache.delete(key);
    });
  }
  const detail = await cache.get(key).promise;
  return { match, ...detail };
}
