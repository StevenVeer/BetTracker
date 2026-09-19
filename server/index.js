import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { pool, ensureSchema } from './db.js';
import { parseTelegramMessage, isResultRecap } from './telegramParser.js';
import { teamNamesMatch } from './teamMatch.js';
import { startTelegramListener, backfillMessages } from './telegramClient.js';
import { buildReportExport } from './reportGenerator.js';
import { getLiveScores, startLiveScoresPoller, findLiveMatchFor, findLiveMatchIdFor, getLiveMatchOverlayById, amsterdamDateParts, amsterdamWallTimeToUtcMs, parseKickoffUtc, FINISHED_STATUSES } from './liveScores.js';
import { LEAGUES } from './leagues.js';
import { extractBetsFromImages } from './screenshotImport.js';

// Personal, single-user tool — not meant to be exposed publicly.
// There is intentionally no login/auth on any of these routes.

const app = express();
app.use(cors());
// Ruim genoeg voor een paar (client-side verkleinde) screenshots als base64.
app.use(express.json({ limit: '25mb' }));

const ODDS_API_KEY = process.env.ODDS_API_KEY;

const BOOKMAKERS = ['Bet365', 'BetCity', 'Toto', 'Unibet', '711', 'BetMGM', 'Jacks'];

// De Odds API stuurt het resterende/verbruikte quotum voor de lopende
// periode mee in elke response — we loggen alleen wanneer die cijfers
// veranderen, zodat de tabel niet volloopt met identieke rijen (bv. bij de
// gratis /events-calls). Een reset is zichtbaar als requests_used daalt
// t.o.v. de vorige rij.
let lastUsageSnapshot = null;
async function recordUsage(headers) {
  const usedRaw = headers.get('x-requests-used');
  const remainingRaw = headers.get('x-requests-remaining');
  if (usedRaw === null || remainingRaw === null) return;
  const used = Number(usedRaw);
  const remaining = Number(remainingRaw);
  if (lastUsageSnapshot && lastUsageSnapshot.used === used && lastUsageSnapshot.remaining === remaining) return;
  lastUsageSnapshot = { used, remaining };
  const lastRaw = headers.get('x-requests-last');
  await pool.query(
    `insert into odds_api_usage (requests_used, requests_remaining, requests_last) values ($1, $2, $3)`,
    [used, remaining, lastRaw !== null ? Number(lastRaw) : null]
  );
}

async function getLatestUsage() {
  const { rows } = await pool.query(
    'select requests_used, requests_remaining, checked_at from odds_api_usage order by checked_at desc limit 1'
  );
  const row = rows[0];
  if (!row) return null;
  return { used: row.requests_used, remaining: row.requests_remaining, total: row.requests_used + row.requests_remaining };
}

async function oddsApiRequest(requestPath) {
  if (!ODDS_API_KEY) throw new Error('ODDS_API_KEY is missing');
  const separator = requestPath.includes('?') ? '&' : '?';
  const response = await fetch(`https://api.the-odds-api.com/v4${requestPath}${separator}apiKey=${encodeURIComponent(ODDS_API_KEY)}`);
  try {
    await recordUsage(response.headers);
  } catch (error) {
    console.error('[odds-api] kon verbruik niet loggen:', error.message);
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || `The Odds API returned ${response.status}`);
  return data;
}

// ---------------------------------------------------------------------------
// Wedstrijden opzoeken (voor de "nieuwe bet"-form) — gratis endpoint, zelfde
// cache-aanpak als SoccerPicks: één keer per dag/competitie ophalen.
// ---------------------------------------------------------------------------
const matchesCache = new Map();
const MATCH_CACHE_MS = 6 * 60 * 60 * 1000;

function dateBounds(date) {
  return { from: `${date}T00:00:00Z`, to: `${date}T23:59:59Z` };
}

function normalizeEvent(event, league) {
  return {
    id: event.id,
    sportKey: league.key,
    competition: league.name,
    country: league.country,
    tier: league.tier,
    home: event.home_team,
    away: event.away_team,
    commenceTime: event.commence_time,
  };
}

async function getMatchesForDate(date) {
  const cached = matchesCache.get(date);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const bounds = dateBounds(date);
  const results = [];
  for (const league of LEAGUES) {
    try {
      const query = `?commenceTimeFrom=${encodeURIComponent(bounds.from)}&commenceTimeTo=${encodeURIComponent(bounds.to)}`;
      const events = await oddsApiRequest(`/sports/${league.key}/events${query}`);
      results.push(events.map((event) => normalizeEvent(event, league)));
    } catch {
      results.push([]);
    }
  }
  const value = {
    matches: results.flat().sort((a, b) => new Date(a.commenceTime) - new Date(b.commenceTime)),
    leagues: LEAGUES.map(({ key, ...league }) => ({ id: key, ...league })),
  };
  matchesCache.set(date, { value, expiresAt: Date.now() + MATCH_CACHE_MS });
  return value;
}

app.get('/api/matches', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    res.json(await getMatchesForDate(date));
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

// Zoekt bekende wedstrijden (uit de al-getrackte top-competities) rond een
// Telegram-berichtdatum. Doorzoekt een venster van een dag terug tot een
// paar dagen vooruit, want een pick wordt vaak eerder gepost dan de
// wedstrijd zelf, en een "boom, deze ging erin"-recap juist erna.
async function searchMatchesAround(aroundDate) {
  const base = aroundDate ? new Date(aroundDate) : new Date();
  const collected = [];
  for (let offset = -1; offset <= 4; offset += 1) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + offset);
    const date = d.toISOString().slice(0, 10);
    try {
      const value = await getMatchesForDate(date);
      collected.push(...value.matches);
    } catch {
      // negeren, gewoon minder wedstrijden om in te zoeken
    }
  }
  return collected;
}

// Beide teamnamen bekend (in willekeurige volgorde t.o.v. de fixture).
// Kiest, uit alle kandidaten die qua naam kloppen, het liefst de eerstvolgende
// nog te spelen wedstrijd (voor een net binnengekomen pick) - en alleen als
// zo'n team helemaal niets aankomends heeft, de meest recente al gespeelde
// (nodig voor een "boom, deze ging erin"-recap van een net afgelopen
// wedstrijd). Zonder deze voorkeur pakte een team dat zowel gisteren als over
// een paar dagen speelt per ongeluk de wedstrijd van gisteren, omdat die als
// eerste in de gesorteerde lijst staat.
function pickBestMatch(candidates, aroundDate) {
  if (candidates.length === 0) return null;
  const postedTime = new Date(aroundDate || Date.now()).getTime();
  const upcoming = candidates.filter((m) => new Date(m.commenceTime).getTime() >= postedTime);
  if (upcoming.length > 0) return upcoming[0]; // candidates is al chronologisch gesorteerd
  return candidates.reduce((latest, m) => (new Date(m.commenceTime) > new Date(latest.commenceTime) ? m : latest));
}

async function findMatchForTeams(nameA, nameB, aroundDate) {
  const matches = await searchMatchesAround(aroundDate);
  const candidates = matches.filter(
    (m) =>
      (teamNamesMatch(m.home, nameA) && teamNamesMatch(m.away, nameB)) ||
      (teamNamesMatch(m.home, nameB) && teamNamesMatch(m.away, nameA))
  );
  return pickBestMatch(candidates, aroundDate);
}

// Maar 1 teamnaam bekend (bv. "Real Madrid to win or draw" - tegenstander
// staat niet in de tekst). Geeft ook terug of dat team thuis of uit speelt.
async function findMatchForSingleTeam(teamName, aroundDate) {
  const matches = await searchMatchesAround(aroundDate);
  const candidates = matches.filter((m) => teamNamesMatch(m.home, teamName) || teamNamesMatch(m.away, teamName));
  const match = pickBestMatch(candidates, aroundDate);
  if (!match) return null;
  return { match, side: teamNamesMatch(match.home, teamName) ? 'home' : 'away' };
}

function sideOfTeamInMatch(match, teamName) {
  if (teamNamesMatch(match.home, teamName)) return 'home';
  if (teamNamesMatch(match.away, teamName)) return 'away';
  return null;
}

app.get('/api/bookmakers', (req, res) => {
  res.json(BOOKMAKERS);
});

// ---------------------------------------------------------------------------
// Bets CRUD
//
// Een bet is een slip met 1+ legs (bet_legs) — een single is een slip met
// precies 1 leg. Elke leg is ofwel gekoppeld aan een wedstrijd uit de Odds
// API (match + gestructureerde market/selection, automatisch settelbaar),
// ofwel een handmatige invoer (vrije teamnamen + vrije picktekst, market
// 'anders' — kan niet automatisch settelen, net als in SoccerPicks).
// ---------------------------------------------------------------------------
async function upsertMatch(match) {
  if (!match?.id) return null;
  await pool.query(
    `insert into matches (id, sport_key, competition, home, away, commence_time)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (id) do update set
       competition = excluded.competition,
       home = excluded.home,
       away = excluded.away,
       commence_time = excluded.commence_time`,
    [match.id, match.sportKey, match.competition || null, match.home, match.away, match.commenceTime]
  );
  return match.id;
}

function serializeLeg(row) {
  return {
    id: row.id,
    market: row.market,
    selection: row.selection,
    line: row.line !== null ? Number(row.line) : null,
    odds: Number(row.odds),
    status: row.status,
    manualLabel: row.manual_label,
    match: row.match_id
      ? {
          id: row.match_id,
          sportKey: row.sport_key,
          competition: row.competition,
          home: row.home,
          away: row.away,
          commenceTime: row.commence_time,
          status: row.match_status,
          homeScore: row.home_score,
          awayScore: row.away_score,
        }
      : null,
  };
}

function serializeBet(row, legRows) {
  return {
    id: row.id,
    bookmaker: row.bookmaker,
    odds: Number(row.odds),
    stake: Number(row.stake),
    potentialPayout: Number(row.potential_payout),
    status: row.status,
    source: row.source,
    placedAt: row.placed_at,
    settledAt: row.settled_at,
    notes: row.notes,
    legs: legRows.map(serializeLeg),
  };
}

async function fetchBetsWithLegs(whereClause, params) {
  const { rows: betRows } = await pool.query(`select * from bets ${whereClause} order by placed_at desc`, params);
  if (betRows.length === 0) return [];

  const { rows: legRows } = await pool.query(
    `select l.*, m.sport_key, m.competition, m.home, m.away, m.commence_time,
            m.status as match_status, m.home_score, m.away_score
     from bet_legs l
     left join matches m on m.id = l.match_id
     where l.bet_id = any($1)
     order by l.bet_id, l.position`,
    [betRows.map((row) => row.id)]
  );
  const legsByBet = new Map();
  for (const leg of legRows) {
    const list = legsByBet.get(leg.bet_id) || [];
    list.push(leg);
    legsByBet.set(leg.bet_id, list);
  }
  return betRows.map((bet) => serializeBet(bet, legsByBet.get(bet.id) || []));
}

app.get('/api/bets', async (req, res) => {
  const { status, source } = req.query;
  try {
    const params = [];
    const clauses = [];
    if (status && status !== 'all') {
      params.push(status);
      clauses.push(`status = $${params.length}`);
    }
    if (source && source !== 'all') {
      params.push(source);
      clauses.push(`source = $${params.length}`);
    }
    const where = clauses.length ? `where ${clauses.join(' and ')}` : '';
    res.json(await fetchBetsWithLegs(where, params));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/bets', async (req, res) => {
  const { bookmaker, stake, placedAt, notes, legs, odds } = req.body;
  if (!bookmaker || !stake || !Array.isArray(legs) || legs.length === 0) {
    res.status(400).json({ error: 'bookmaker, stake en minstens 1 selectie zijn verplicht' });
    return;
  }
  for (const leg of legs) {
    if (!leg.market || !leg.selection || !leg.odds) {
      res.status(400).json({ error: 'elke selectie heeft een markt, selectie en odds nodig' });
      return;
    }
    if (!leg.match && !leg.manualLabel) {
      res.status(400).json({ error: 'elke selectie heeft een wedstrijd of een handmatige omschrijving nodig' });
      return;
    }
  }

  try {
    await ensureSchema();
    // De opgegeven totale odds wint van het pure product van de legs — zo
    // kan een bet boost (hogere odds dan de rekenkundige combinatie) worden
    // vastgelegd, zowel bij combi's als bij singles.
    const combinedOdds = odds ? Number(odds) : legs.reduce((acc, leg) => acc * Number(leg.odds), 1);
    const potentialPayout = combinedOdds * Number(stake);
    const id = randomUUID();

    await pool.query(
      `insert into bets (id, bookmaker, odds, stake, potential_payout, status, source, placed_at, notes)
       values ($1, $2, $3, $4, $5, 'open', 'manual', coalesce($6, now()), $7)`,
      [id, bookmaker, combinedOdds, stake, potentialPayout, placedAt || null, notes || null]
    );

    let position = 0;
    for (const leg of legs) {
      const matchId = await upsertMatch(leg.match);
      await pool.query(
        `insert into bet_legs (id, bet_id, position, match_id, manual_label, market, selection, line, odds, status)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'open')`,
        [randomUUID(), id, position, matchId, matchId ? null : leg.manualLabel, leg.market, leg.selection, leg.line ?? null, leg.odds]
      );
      position += 1;
    }

    const [bet] = await fetchBetsWithLegs('where id = $1', [id]);
    res.status(201).json(bet);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Screenshot-import: leest bets uit screenshots (Claude vision) en geeft een
// voorstel terug - slaat zelf niets op. De client toont een preview en maakt de
// bevestigde bets aan via de gewone POST /api/bets. Bets die er al lijken te
// staan (zelfde bookmaker, inzet en totale odds) komen terug met
// duplicateOf, zodat de client ze standaard uitgevinkt kan tonen.
app.post('/api/bets/import-screenshot', async (req, res) => {
  try {
    const extracted = await extractBetsFromImages(req.body?.images);
    const { rows: existing } = await pool.query(
      "select id, bookmaker, stake, odds from bets where source = 'manual'"
    );
    const bets = extracted.map((bet) => {
      const duplicate = existing.find(
        (row) =>
          bet.bookmaker &&
          bet.stake != null &&
          bet.odds != null &&
          row.bookmaker.toLowerCase() === String(bet.bookmaker).toLowerCase() &&
          Math.abs(Number(row.stake) - Number(bet.stake)) < 0.005 &&
          Math.abs(Number(row.odds) - Number(bet.odds)) < 0.015
      );
      return { ...bet, duplicateOf: duplicate?.id || null };
    });
    res.json({ bets });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

const EDITABLE_BET_FIELDS = ['bookmaker', 'stake', 'odds', 'notes'];
const SETTLE_STATUSES = ['open', 'won', 'lost', 'void', 'cashed_out'];

app.patch('/api/bets/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows: existingRows } = await pool.query('select * from bets where id = $1', [id]);
    const existing = existingRows[0];
    if (!existing) {
      res.status(404).json({ error: 'Bet niet gevonden' });
      return;
    }

    const updates = {};
    for (const field of EDITABLE_BET_FIELDS) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }
    // potentialPayout mag je los van odds/stake overschrijven — een
    // bookmaker rondt de daadwerkelijke uitbetaling soms net anders af dan
    // pure odds × inzet. Wordt hij in dezelfde request niet meegegeven, dan
    // blijft hij automatisch afgeleid zoals voorheen.
    const payoutOverride = req.body.potentialPayout !== undefined ? Number(req.body.potentialPayout) : null;
    if (payoutOverride !== null) {
      updates.potential_payout = payoutOverride;
    } else if (updates.odds !== undefined || updates.stake !== undefined) {
      const nextOdds = updates.odds !== undefined ? updates.odds : existing.odds;
      const nextStake = updates.stake !== undefined ? updates.stake : existing.stake;
      updates.potential_payout = Number(nextOdds) * Number(nextStake);
    }
    if (req.body.status !== undefined) {
      if (!SETTLE_STATUSES.includes(req.body.status)) {
        res.status(400).json({ error: `status moet een van ${SETTLE_STATUSES.join(', ')} zijn` });
        return;
      }
      updates.status = req.body.status;
      updates.settled_at = req.body.status === 'open' ? null : new Date();
    }
    // placedAt achteraf corrigeren (bv. een bet die 's avonds laat is
    // geplaatst maar bij de vorige dag hoort) - los van EDITABLE_BET_FIELDS
    // omdat de kolomnaam (placed_at) niet 1-op-1 met de body-key matcht.
    if (req.body.placedAt !== undefined) {
      const nextPlacedAt = new Date(req.body.placedAt);
      if (Number.isNaN(nextPlacedAt.getTime())) {
        res.status(400).json({ error: 'placedAt is geen geldige datum' });
        return;
      }
      updates.placed_at = nextPlacedAt;
    }
    // settledAt achteraf corrigeren - staat los van de automatische
    // settled_at = now() hierboven (die wint dus niet als dit veld in
    // dezelfde request wordt meegegeven). Nodig omdat het bookmaker-journaal
    // winst/void chronologisch op settledAt plaatst: een bet die je laat
    // afrondt, ook al was 'm allang gewonnen, duwt zijn winst-boeking dan te
    // laat in de tijdlijn en het journaal vult het "tekort" voor een latere
    // inzet automatisch aan als (nep-)storting.
    if (req.body.settledAt !== undefined) {
      const nextSettledAt = new Date(req.body.settledAt);
      if (Number.isNaN(nextSettledAt.getTime())) {
        res.status(400).json({ error: 'settledAt is geen geldige datum' });
        return;
      }
      updates.settled_at = nextSettledAt;
    }

    const fields = Object.keys(updates);
    if (fields.length === 0) {
      res.status(400).json({ error: 'Niets om bij te werken' });
      return;
    }
    const setClause = fields.map((field, index) => `${field} = $${index + 2}`).join(', ');
    await pool.query(`update bets set ${setClause} where id = $1`, [id, ...fields.map((f) => updates[f])]);

    const [bet] = await fetchBetsWithLegs('where id = $1', [id]);
    res.json(bet);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/bets/:id', async (req, res) => {
  try {
    await pool.query('delete from bets where id = $1', [req.params.id]);
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const LEG_STATUSES = ['open', 'won', 'lost', 'void'];

// Handmatig een selectie in een combi bijwerken: de uitslag (bv. voor een
// markt die niet automatisch te settelen is, of een correctie) en/of de
// eigen odds (bv. een typefout rechtzetten). Een statuswijziging herbeoordeelt
// meteen de hele bet — dezelfde logica als bij automatische settlement, dus
// 1 verloren leg maakt de hele bet verloren. Een odds-wijziging raakt alleen
// die ene leg; de totale odds van de bet pas je apart aan.
app.patch('/api/bet-legs/:id', async (req, res) => {
  const { id } = req.params;
  const { status, odds } = req.body;
  const updates = {};
  if (status !== undefined) {
    if (!LEG_STATUSES.includes(status)) {
      res.status(400).json({ error: `status moet een van ${LEG_STATUSES.join(', ')} zijn` });
      return;
    }
    updates.status = status;
  }
  if (odds !== undefined) {
    if (!odds || Number(odds) < 1.01) {
      res.status(400).json({ error: 'odds moet minstens 1.01 zijn' });
      return;
    }
    updates.odds = Number(odds);
  }
  const fields = Object.keys(updates);
  if (fields.length === 0) {
    res.status(400).json({ error: 'Niets om bij te werken' });
    return;
  }

  try {
    const setClause = fields.map((field, index) => `${field} = $${index + 2}`).join(', ');
    const { rows } = await pool.query(
      `update bet_legs set ${setClause} where id = $1 returning bet_id`,
      [id, ...fields.map((f) => updates[f])]
    );
    const betId = rows[0]?.bet_id;
    if (!betId) {
      res.status(404).json({ error: 'Selectie niet gevonden' });
      return;
    }
    if (updates.status !== undefined) await reevaluateBet(betId);
    // Een leg is maar een deel van de combi-odds - na een correctie hier moet
    // de totale odds (en dus de mogelijke uitbetaling) van de hele bet weer
    // kloppen, ook voor een single (dan is het gewoon die ene leg-odds).
    if (updates.odds !== undefined) await recomputeBetOdds(betId);
    const [bet] = await fetchBetsWithLegs('where id = $1', [betId]);
    res.json(bet);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// Geplande bets ("opzetjes") — bet-ideeën voor komende wedstrijden, nog zonder
// inzet. Zelfde slip-vorm als bets/bet_legs (1+ legs, elke leg een match- of
// handmatige selectie), maar zonder de financiële velden: geen stake, geen
// potential_payout, en odds/bookmaker zijn per opzetje en per leg optioneel -
// je legt de wedstrijd/markt/selectie vast en vult de rest pas aan als je 'm
// ook echt plaatst. "Plaatsen" gebeurt client-side via de gewone
// POST /api/bets, gevolgd door DELETE hier - geen aparte "place"-route nodig.
// ---------------------------------------------------------------------------
function serializePlannedLeg(row) {
  return {
    id: row.id,
    market: row.market,
    selection: row.selection,
    line: row.line !== null ? Number(row.line) : null,
    odds: row.odds !== null ? Number(row.odds) : null,
    manualLabel: row.manual_label,
    match: row.match_id
      ? {
          id: row.match_id,
          sportKey: row.sport_key,
          competition: row.competition,
          home: row.home,
          away: row.away,
          commenceTime: row.commence_time,
        }
      : null,
  };
}

function serializePlannedBet(row, legRows) {
  return {
    id: row.id,
    bookmaker: row.bookmaker,
    odds: row.odds !== null ? Number(row.odds) : null,
    notes: row.notes,
    forDate: row.for_date,
    createdAt: row.created_at,
    legs: legRows.map(serializePlannedLeg),
  };
}

async function fetchPlannedBets(whereClause = '', params = []) {
  const { rows: betRows } = await pool.query(
    `select * from planned_bets ${whereClause} order by for_date asc, created_at asc`,
    params
  );
  if (betRows.length === 0) return [];

  const { rows: legRows } = await pool.query(
    `select l.*, m.sport_key, m.competition, m.home, m.away, m.commence_time
     from planned_bet_legs l
     left join matches m on m.id = l.match_id
     where l.planned_bet_id = any($1)
     order by l.planned_bet_id, l.position`,
    [betRows.map((row) => row.id)]
  );
  const legsByBet = new Map();
  for (const leg of legRows) {
    const list = legsByBet.get(leg.planned_bet_id) || [];
    list.push(leg);
    legsByBet.set(leg.planned_bet_id, list);
  }
  return betRows.map((bet) => serializePlannedBet(bet, legsByBet.get(bet.id) || []));
}

app.get('/api/planned-bets', async (req, res) => {
  try {
    await ensureSchema();
    res.json(await fetchPlannedBets());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/planned-bets', async (req, res) => {
  const { bookmaker, odds, notes, forDate, legs } = req.body;
  if (!Array.isArray(legs) || legs.length === 0) {
    res.status(400).json({ error: 'minstens 1 selectie is verplicht' });
    return;
  }
  for (const leg of legs) {
    if (!leg.market || !leg.selection) {
      res.status(400).json({ error: 'elke selectie heeft een markt en selectie nodig' });
      return;
    }
    if (!leg.match && !leg.manualLabel) {
      res.status(400).json({ error: 'elke selectie heeft een wedstrijd of een handmatige omschrijving nodig' });
      return;
    }
  }

  try {
    await ensureSchema();
    const id = randomUUID();
    await pool.query(
      `insert into planned_bets (id, bookmaker, odds, notes, for_date)
       values ($1, $2, $3, $4, coalesce($5, current_date))`,
      [id, bookmaker || null, odds ? Number(odds) : null, notes || null, forDate || null]
    );

    let position = 0;
    for (const leg of legs) {
      const matchId = await upsertMatch(leg.match);
      await pool.query(
        `insert into planned_bet_legs (id, planned_bet_id, position, match_id, manual_label, market, selection, line, odds)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [randomUUID(), id, position, matchId, matchId ? null : leg.manualLabel, leg.market, leg.selection, leg.line ?? null, leg.odds ?? null]
      );
      position += 1;
    }

    const [planned] = await fetchPlannedBets('where id = $1', [id]);
    res.status(201).json(planned);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/planned-bets/:id', async (req, res) => {
  try {
    await pool.query('delete from planned_bets where id = $1', [req.params.id]);
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// Telegram-picks
//
// Geen aparte tabel: een Telegram-parlay ís een bet (source='telegram') met
// meerdere legs, precies zoals een eigen combi - dezelfde settlement-logica
// (reevaluateBet) bepaalt dus ook hier of 1 verloren leg de hele parlay laat
// vallen. telegramClient.js roept ingestTelegramMessage aan per bericht;
// telegramParser.js heeft alleen-voetbal, alleen-herkenbare picks er al
// uitgefilterd en gegroepeerd per "Safer"/"Riskier"-blok (= 1 parlay).
// ---------------------------------------------------------------------------
const TELEGRAM_ASSUMED_STAKE = Number(process.env.TELEGRAM_ASSUMED_STAKE || 100);

// Voor elke pick-regel wordt hier de wedstrijd/kant opgezocht - dat kan de
// parser zelf niet, want die kent alleen tekst, geen Odds API-data. Bij
// "picked-vs-opponent"/"single-team" is zonder gevonden wedstrijd niet vast
// te stellen of de gekozen kant "home" of "away" is (dubbelkans/team_wint
// zijn fixture-relatief) - die vallen dan terug op de vrije 'anders'-markt,
// net als een handmatig ingevoerde bet. Bij "two-team" (bv. over/under) is
// de selectie al ondubbelzinnig uit de tekst zelf af te leiden, dus die
// blijft gewoon zijn eigen markt houden, ook zonder gekoppelde wedstrijd.
async function resolvePickLine(line, postedAt) {
  if (line.kind === 'two-team') {
    const found = await findMatchForTeams(line.home, line.away, postedAt);
    if (!found) {
      return { matchId: null, manualLabel: `${line.home} – ${line.away}`, market: line.market, selection: line.selection, lineValue: line.line ?? null };
    }
    return { matchId: await upsertMatch(found), manualLabel: null, market: line.market, selection: line.selection, lineValue: line.line ?? null };
  }

  if (line.kind === 'picked-vs-opponent') {
    const found = await findMatchForTeams(line.pickedTeam, line.opponentTeam, postedAt);
    const side = found ? sideOfTeamInMatch(found, line.pickedTeam) : null;
    if (!found || !side) {
      return { matchId: null, manualLabel: `${line.pickedTeam} – ${line.opponentTeam}`, market: 'anders', selection: line.lineText, lineValue: null };
    }
    return { matchId: await upsertMatch(found), manualLabel: null, market: line.market, selection: side, lineValue: null };
  }

  // 'single-team'
  const found = await findMatchForSingleTeam(line.team, postedAt);
  if (!found) {
    return { matchId: null, manualLabel: line.team, market: 'anders', selection: line.lineText, lineValue: null };
  }
  const selection = line.market === 'dubbelkans' ? (found.side === 'home' ? 'home_draw' : 'draw_away') : found.side;
  return { matchId: await upsertMatch(found.match), manualLabel: null, market: line.market, selection, lineValue: null };
}

function legSignature(leg) {
  return `${leg.matchId || leg.manualLabel}|${leg.market}|${leg.selection}|${leg.lineValue ?? ''}`;
}

// "Boom, deze ging erin!"-berichten herhalen vaak letterlijk de picks van
// eerder die dag als recap - zonder dedup zou dat dubbele parlays opleveren
// die de win-rate/ROI scheeftrekken. Exact dezelfde set legs (wedstrijd +
// markt + selectie, welke volgorde dan ook) binnen 48 uur telt als dezelfde
// parlay.
async function findDuplicateParlay(legs, postedAt) {
  const windowStart = new Date(new Date(postedAt).getTime() - 48 * 3600 * 1000);
  const recent = await fetchBetsWithLegs('where source = $1 and placed_at >= $2 and placed_at <= $3', [
    'telegram',
    windowStart,
    postedAt,
  ]);
  const candidateSignature = legs.map(legSignature).sort().join('||');
  return recent.some((bet) => {
    const betSignature = bet.legs
      .map((l) => `${l.match?.id || l.manualLabel}|${l.market}|${l.selection}|${l.line ?? ''}`)
      .sort()
      .join('||');
    return betSignature === candidateSignature;
  });
}

async function ingestTelegramMessage({ messageId, text, postedAt }) {
  await ensureSchema();
  const groups = parseTelegramMessage(text);
  const stats = { betsCreated: 0, alreadyProcessed: 0, duplicateParlay: 0 };

  if (groups.length === 0) {
    if (isResultRecap(text)) {
      console.log(`[telegram] bericht ${messageId}: recap-bericht (bevat bevestigingszin) genegeerd, geen picks ingelezen`);
    }
    return stats;
  }

  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const group = groups[groupIndex];
    const telegramMessageId = `${messageId}#${groupIndex}`;

    // Al eerder verwerkt? Dan meteen stoppen, vóór de (dure) wedstrijd-lookups
    // - anders zou een herhaalde backfill vanaf dezelfde ankerdatum steeds
    // opnieuw Odds API-credits verbruiken voor berichten die al bets zijn.
    const { rows: existing } = await pool.query('select 1 from bets where telegram_message_id = $1', [telegramMessageId]);
    if (existing.length > 0) {
      stats.alreadyProcessed += 1;
      continue;
    }

    const legs = [];
    for (const line of group) {
      legs.push(await resolvePickLine(line, postedAt));
    }
    if (legs.length === 0) continue;
    if (await findDuplicateParlay(legs, postedAt)) {
      stats.duplicateParlay += 1;
      continue;
    }

    const betId = randomUUID();
    await pool.query(
      `insert into bets (id, bookmaker, odds, stake, potential_payout, status, source, placed_at, telegram_message_id)
       values ($1, 'Telegram', 1, $2, $2, 'open', 'telegram', $3, $4)`,
      [betId, TELEGRAM_ASSUMED_STAKE, postedAt, telegramMessageId]
    );
    let position = 0;
    for (const leg of legs) {
      await pool.query(
        `insert into bet_legs (id, bet_id, position, match_id, manual_label, market, selection, line, odds, status)
         values ($1, $2, $3, $4, $5, $6, $7, $8, 1, 'open')`,
        [randomUUID(), betId, position, leg.matchId, leg.manualLabel, leg.market, leg.selection, leg.lineValue]
      );
      position += 1;
    }
    stats.betsCreated += 1;
  }

  console.log(
    `[telegram] bericht ${messageId}: ${stats.betsCreated} bet(s) aangemaakt, ${stats.alreadyProcessed} al bekend, ${stats.duplicateParlay} dubbele parlay overgeslagen`
  );
  return stats;
}

// Fictieve odds voor de winst/ROI-vergelijking — alleen opgehaald op
// aanvraag (net als scores), niet automatisch per binnenkomend bericht, om
// geen credits te verspillen. Alleen team_wint (h2h) en over_under (totals)
// zijn markten die de Odds API ook echt aanbiedt; dubbelkans/btts/anders
// tellen wel mee in de win-rate maar niet in de ROI. odds = 1 is de
// sentinel-waarde voor "nog niet opgehaald" (zie ingestTelegramMessage).
const ODDS_FETCHABLE_MARKETS = { team_wint: 'h2h', over_under: 'totals' };

async function fetchReferenceOddsForLeg(leg) {
  const marketKey = ODDS_FETCHABLE_MARKETS[leg.market];
  if (!marketKey || !leg.match_id) return null;

  let events;
  try {
    events = await oddsApiRequest(`/sports/${leg.sport_key}/odds/?regions=eu&markets=${marketKey}&eventIds=${leg.match_id}`);
  } catch {
    return null;
  }
  const event = events[0];
  if (!event) return null;

  const prices = [];
  for (const bookmaker of event.bookmakers || []) {
    const marketData = bookmaker.markets.find((m) => m.key === marketKey);
    if (!marketData) continue;
    if (leg.market === 'team_wint') {
      const teamName = leg.selection === 'home' ? leg.home : leg.away;
      const outcome = marketData.outcomes.find((o) => o.name === teamName);
      if (outcome) prices.push(Number(outcome.price));
    } else {
      const wantedLine = Number(leg.line);
      const outcome = marketData.outcomes.find(
        (o) => o.name.toLowerCase() === leg.selection && Number(o.point) === wantedLine
      );
      if (outcome) prices.push(Number(outcome.price));
    }
  }
  if (prices.length === 0) return null;
  return prices.reduce((a, b) => a + b, 0) / prices.length;
}

app.post('/api/telegram/refresh-odds', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `select l.*, m.sport_key, m.home, m.away
       from bet_legs l
       join bets b on b.id = l.bet_id
       join matches m on m.id = l.match_id
       where b.source = 'telegram' and b.status = 'open' and l.odds = 1 and l.market = any($1)`,
      [Object.keys(ODDS_FETCHABLE_MARKETS)]
    );
    let updated = 0;
    const affectedBetIds = new Set();
    for (const leg of rows) {
      const odds = await fetchReferenceOddsForLeg(leg);
      if (odds === null) continue;
      await pool.query('update bet_legs set odds = $1 where id = $2', [odds, leg.id]);
      affectedBetIds.add(leg.bet_id);
      updated += 1;
    }
    for (const betId of affectedBetIds) {
      await recomputeBetOdds(betId);
    }
    res.json({ checked: rows.length, updated, usage: await getLatestUsage() });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

// Eenmalig oudere berichten ophalen - handig om de tracker met terugwerkende
// kracht gelijk te laten lopen met de eigen bets, of om een gemiste periode
// (bv. na downtime) alsnog te verwerken. Draait via de live listener-client
// zodat er geen tweede sessie/verbinding nodig is.
let activeTelegramClient = null;

// Ankerdatum wordt bij elke druk op de knop opnieuw berekend (niet één keer
// bij het opstarten van de server) - anders blijft een lang draaiend
// container (restart: unless-stopped) hangen op de dag waarop hij ooit is
// gestart, en haalt de backfill telkens dezelfde oude berichten opnieuw op
// i.p.v. de berichten van vandaag. Standaard is dat "sinds lokale
// middernacht (Amsterdam) vandaag" - expliciet op de Amsterdamse tijdzone
// gerekend zodat dit klopt ongeacht in welke tijdzone de servermachine zelf
// draait (de container draait in UTC). TELEGRAM_BACKFILL_SINCE blijft
// beschikbaar als handmatige override voor een eenmalige inhaalslag verder
// terug in de tijd (bv. na downtime).
function startOfTodayAmsterdam() {
  const { year, month, day } = amsterdamDateParts(new Date());
  return new Date(amsterdamWallTimeToUtcMs(year, month, day, 0, 0));
}

app.post('/api/telegram/backfill', async (req, res) => {
  if (!activeTelegramClient) {
    res.status(503).json({ error: 'Telegram-listener is niet actief (TELEGRAM_* env vars ontbreken?)' });
    return;
  }
  const since = req.body?.since
    ? new Date(req.body.since)
    : process.env.TELEGRAM_BACKFILL_SINCE
      ? new Date(process.env.TELEGRAM_BACKFILL_SINCE)
      : startOfTodayAmsterdam();
  const startedAt = Date.now();
  const totals = { betsCreated: 0, alreadyProcessed: 0, duplicateParlay: 0 };
  try {
    const processed = await backfillMessages(
      activeTelegramClient,
      process.env.TELEGRAM_GROUP_ID,
      since,
      async (message) => {
        const stats = await ingestTelegramMessage(message);
        totals.betsCreated += stats.betsCreated;
        totals.alreadyProcessed += stats.alreadyProcessed;
        totals.duplicateParlay += stats.duplicateParlay;
      }
    );
    const durationMs = Date.now() - startedAt;
    console.log(
      `[telegram] backfill-endpoint klaar in ${durationMs}ms: ${processed} bericht(en), ${totals.betsCreated} nieuwe bet(s)`
    );
    res.json({ since: since.toISOString(), processed, durationMs, ...totals });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// Bookmaker-overzicht — hoeveel geld staat er waar
//
// Het journaal per bookmaker wordt live afgeleid, niet apart opgeslagen:
// "Ingezet" en "Winst"/"Void" komen uit bets. "Uitbetaald" en "Gestort" zijn
// allebei een echte tabel (bookmaker_withdrawals / bookmaker_deposits) — je
// kunt dus zelf een storting loggen. Dekt dat (nog) niet de hele inzet, dan
// vult buildBookmakerLedger het resterende tekort nog steeds automatisch aan
// zodra een inzet het saldo onder 0 zou duwen, zodat het saldo nooit negatief
// wordt.
//
// De ING-rekening (buildIngLedger hieronder) hergebruikt dit journaal: elke
// "Gestort"-regel hier (handmatig of automatisch aangevuld) is een
// overboeking ván ING náár die bookmaker, en elke "Uitbetaald"-regel is een
// overboeking terug. Er wordt dus niets dubbel opgeslagen.
// ---------------------------------------------------------------------------
// Elk tekort, hoe klein ook, wordt als automatische storting geboekt zodat
// het saldo nooit (ook niet tijdelijk) negatief blijft staan — alleen bedragen
// onder een cent worden genegeerd, dat is puur drijvende-komma-afrondruis.
const AUTO_DEPOSIT_THRESHOLD = 0.01;

// Voorkomt drijvende-komma-restjes (bv. -5.68e-14 i.p.v. 0) die na genoeg
// mutaties ontstaan doordat bedragen als 60.63 niet exact in binair passen.
function round2(n) {
  return Math.round(n * 100) / 100;
}

function betLabel(bet) {
  if (bet.legs.length > 1) return `Combi (${bet.legs.length} selecties)`;
  const leg = bet.legs[0];
  return leg.match ? `${leg.match.home} – ${leg.match.away}` : leg.manualLabel || 'Handmatige selectie';
}

async function buildBookmakerLedger(bookmaker) {
  const bets = await fetchBetsWithLegs('where bookmaker = $1', [bookmaker]);
  const { rows: withdrawals } = await pool.query(
    'select * from bookmaker_withdrawals where bookmaker = $1 order by occurred_at',
    [bookmaker]
  );
  const { rows: deposits } = await pool.query(
    'select * from bookmaker_deposits where bookmaker = $1 order by occurred_at',
    [bookmaker]
  );
  const { rows: corrections } = await pool.query(
    'select * from balance_corrections where target = $1 order by occurred_at',
    [bookmaker]
  );

  const events = [];
  for (const bet of bets) {
    events.push({ at: new Date(bet.placedAt), kind: 'stake', amount: -bet.stake, label: `Ingezet — ${betLabel(bet)}` });
    if (bet.status === 'won' || bet.status === 'cashed_out') {
      events.push({ at: new Date(bet.settledAt), kind: 'winst', amount: bet.potentialPayout, label: `Winst — ${betLabel(bet)}` });
    } else if (bet.status === 'void') {
      events.push({ at: new Date(bet.settledAt), kind: 'void', amount: bet.stake, label: `Void — ${betLabel(bet)}` });
    }
  }
  for (const w of withdrawals) {
    events.push({ at: new Date(w.occurred_at), kind: 'withdrawal', amount: -Number(w.amount), label: 'Uitbetaald' });
  }
  for (const d of deposits) {
    events.push({ at: new Date(d.occurred_at), kind: 'deposit', amount: Number(d.amount), label: 'Gestort' });
  }
  for (const c of corrections) {
    events.push({ at: new Date(c.occurred_at), kind: 'correction', amount: Number(c.amount), label: 'Correctie' });
  }
  events.sort((a, b) => a.at - b.at);

  let balance = 0;
  const rows = [];
  for (const event of events) {
    if (event.kind !== 'correction' && event.amount < 0 && balance + event.amount < 0) {
      const shortfall = round2(-(balance + event.amount));
      if (shortfall >= AUTO_DEPOSIT_THRESHOLD) {
        balance = round2(balance + shortfall);
        // Gestort ligt chronologisch vóór de regel die hij dekt, dus komt eerst
        // in de oplopende opbouw — na het omdraaien voor de aflopende weergave
        // (nieuwste boven) staat hij daardoor terecht ónder die regel.
        rows.push({ at: event.at.toISOString(), kind: 'deposit', label: 'Gestort', amount: shortfall, balanceAfter: balance, auto: true });
      }
    }
    balance = round2(balance + event.amount);
    rows.push({ at: event.at.toISOString(), kind: event.kind, label: event.label, amount: event.amount, balanceAfter: balance });
  }
  // Intern chronologisch (oplopend) opgebouwd voor een kloppend lopend saldo;
  // getoond wordt aflopend, nieuwste bovenaan.
  const openBets = bets.filter((bet) => bet.status === 'open').length;
  // Een tekort onder AUTO_DEPOSIT_THRESHOLD wordt bewust niet als storting
  // geboekt (zie hierboven) — het hoort dus ook niet als schuld getoond te
  // worden bij de bookmaker, en al helemaal niet als overboeking bij ING.
  const displayBalance = balance < 0 && -balance < AUTO_DEPOSIT_THRESHOLD ? 0 : balance;
  return { bookmaker, balance: displayBalance, openBets, rows: rows.reverse() };
}

async function getIngSettings() {
  await ensureSchema();
  const { rows } = await pool.query('select * from ing_account where id = 1');
  return rows[0];
}

// De ING-rekening is de bron van elke storting en het doel van elke opname.
// Net als bij een bookmaker wordt het journaal live afgeleid: voor elke
// bookmaker worden de "Gestort"-regels (overboeking ná ING) en
// "Uitbetaald"-regels (overboeking vóór ING) uit buildBookmakerLedger
// gespiegeld, plus de automatische maandstorting van starting_at tot nu.
// Alleen gebeurtenissen op of ná starting_at tellen mee — wat daarvoor
// gebeurde is niet als echte overboeking te herleiden.
async function buildIngLedger() {
  const settings = await getIngSettings();
  const startingBalance = Number(settings.starting_balance);
  const startingAt = new Date(settings.starting_at);
  const monthlyDeposit = Number(settings.monthly_deposit);

  const events = [];
  for (const bookmaker of BOOKMAKERS) {
    const { rows } = await buildBookmakerLedger(bookmaker);
    for (const row of rows) {
      const at = new Date(row.at);
      if (at < startingAt) continue;
      if (row.kind === 'deposit') {
        events.push({ at, amount: -row.amount, label: `Overboeking naar ${bookmaker}`, auto: row.auto || false });
      } else if (row.kind === 'withdrawal') {
        events.push({ at, amount: -row.amount, label: `Overboeking van ${bookmaker}`, auto: false });
      }
    }
  }

  const now = new Date();
  let cursor = new Date(Date.UTC(startingAt.getUTCFullYear(), startingAt.getUTCMonth(), 1));
  if (cursor < startingAt) cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  while (cursor <= now) {
    events.push({ at: cursor, amount: monthlyDeposit, label: 'Automatische storting', auto: true });
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }

  const { rows: corrections } = await pool.query(
    "select * from balance_corrections where target = 'ING' order by occurred_at"
  );
  for (const c of corrections) {
    const at = new Date(c.occurred_at);
    if (at < startingAt) continue;
    events.push({ at, amount: Number(c.amount), label: 'Correctie', auto: false });
  }

  events.sort((a, b) => a.at - b.at);

  let balance = startingBalance;
  const rows = [];
  for (const event of events) {
    balance += event.amount;
    rows.push({ at: event.at.toISOString(), label: event.label, amount: event.amount, balanceAfter: balance, auto: event.auto });
  }
  return { bookmaker: 'ING', balance, startingBalance, startingAt: startingAt.toISOString(), rows: rows.reverse() };
}

app.get('/api/bookmakers/overview', async (req, res) => {
  try {
    const overview = await Promise.all(
      BOOKMAKERS.map(async (bookmaker) => {
        const { balance, openBets } = await buildBookmakerLedger(bookmaker);
        return { bookmaker, balance, openBets };
      })
    );
    const ing = await buildIngLedger();
    res.json([{ bookmaker: 'ING', balance: ing.balance, openBets: null, isBank: true }, ...overview]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/ing/ledger', async (req, res) => {
  try {
    res.json(await buildIngLedger());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/bookmakers/:bookmaker/ledger', async (req, res) => {
  const { bookmaker } = req.params;
  if (!BOOKMAKERS.includes(bookmaker)) {
    res.status(404).json({ error: 'Onbekende bookmaker' });
    return;
  }
  try {
    res.json(await buildBookmakerLedger(bookmaker));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/bookmakers/:bookmaker/withdrawals', async (req, res) => {
  const { bookmaker } = req.params;
  const { amount, occurredAt, notes } = req.body;
  if (!BOOKMAKERS.includes(bookmaker)) {
    res.status(404).json({ error: 'Onbekende bookmaker' });
    return;
  }
  if (!amount || Number(amount) <= 0) {
    res.status(400).json({ error: 'amount moet positief zijn' });
    return;
  }
  try {
    await ensureSchema();
    await pool.query(
      `insert into bookmaker_withdrawals (id, bookmaker, amount, occurred_at, notes)
       values ($1, $2, $3, coalesce($4, now()), $5)`,
      [randomUUID(), bookmaker, amount, occurredAt || null, notes || null]
    );
    res.status(201).json(await buildBookmakerLedger(bookmaker));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/bookmaker-withdrawals/:id', async (req, res) => {
  try {
    await pool.query('delete from bookmaker_withdrawals where id = $1', [req.params.id]);
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/bookmakers/:bookmaker/deposits', async (req, res) => {
  const { bookmaker } = req.params;
  const { amount, occurredAt, notes } = req.body;
  if (!BOOKMAKERS.includes(bookmaker)) {
    res.status(404).json({ error: 'Onbekende bookmaker' });
    return;
  }
  if (!amount || Number(amount) <= 0) {
    res.status(400).json({ error: 'amount moet positief zijn' });
    return;
  }
  try {
    await ensureSchema();
    await pool.query(
      `insert into bookmaker_deposits (id, bookmaker, amount, occurred_at, notes)
       values ($1, $2, $3, coalesce($4, now()), $5)`,
      [randomUUID(), bookmaker, amount, occurredAt || null, notes || null]
    );
    res.status(201).json(await buildBookmakerLedger(bookmaker));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/bookmaker-deposits/:id', async (req, res) => {
  try {
    await pool.query('delete from bookmaker_deposits where id = $1', [req.params.id]);
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Handmatige correctie op een berekend saldo — voor kleine driftjes (bv. een
// bookmaker rondt een payout anders af dan potential_payout). Anders dan een
// storting/opname mag het bedrag negatief zijn en wordt het nooit naar ING
// gespiegeld of door de auto-aanvul-logica overschreven.
app.post('/api/bookmakers/:bookmaker/corrections', async (req, res) => {
  const { bookmaker } = req.params;
  const { amount, occurredAt, notes } = req.body;
  if (!BOOKMAKERS.includes(bookmaker)) {
    res.status(404).json({ error: 'Onbekende bookmaker' });
    return;
  }
  if (amount === undefined || amount === null || Number(amount) === 0 || Number.isNaN(Number(amount))) {
    res.status(400).json({ error: 'amount moet een getal ongelijk aan 0 zijn' });
    return;
  }
  try {
    await ensureSchema();
    await pool.query(
      `insert into balance_corrections (id, target, amount, occurred_at, notes)
       values ($1, $2, $3, coalesce($4, now()), $5)`,
      [randomUUID(), bookmaker, amount, occurredAt || null, notes || null]
    );
    res.status(201).json(await buildBookmakerLedger(bookmaker));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/ing/corrections', async (req, res) => {
  const { amount, occurredAt, notes } = req.body;
  if (amount === undefined || amount === null || Number(amount) === 0 || Number.isNaN(Number(amount))) {
    res.status(400).json({ error: 'amount moet een getal ongelijk aan 0 zijn' });
    return;
  }
  try {
    await ensureSchema();
    await pool.query(
      `insert into balance_corrections (id, target, amount, occurred_at, notes)
       values ($1, 'ING', $2, coalesce($3, now()), $4)`,
      [randomUUID(), amount, occurredAt || null, notes || null]
    );
    res.status(201).json(await buildIngLedger());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/corrections/:id', async (req, res) => {
  try {
    await pool.query('delete from balance_corrections where id = $1', [req.params.id]);
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// Markt-winstgevendheid — welke markt/selectie is eigenlijk winstgevend
//
// Bij een combi is de winst niet eerlijk in echte euro's toe te rekenen aan
// één losse leg — dat blijft een feit. Maar een gebruiker die (bijna) nooit
// singles plaatst, heeft dan aan een singles-only ROI niets: die staat altijd
// op nul. Daarom geen echt-geld-ROI, maar "yield": elke leg heeft zijn eigen
// odds (bet_legs.odds), los van de combi — dus simuleren we wat elke pick had
// opgeleverd als hij apart, met een gelijke fictieve inzet, was ingezet. De
// fictieve inzet zelf valt weg uit het percentage (schaalt lineair weg), dus
// hoeft nergens gekozen te worden:
//   yield% = (Σ(odds-1) over gewonnen legs − aantal verloren legs) / aantal
//            geprijsde beslissende legs × 100
// Hitrate telt gewoon alle beslissende legs, single én combi. Open en void
// legs zeggen niets over marktprestatie en tellen nergens in mee.
// correct_score/anders hebben vrije-tekst selecties (geen vaste opties uit
// markets.js) - die worden gewoon op de letterlijke tekst gegroepeerd, net
// als elke andere markt. Bij herhaalde identieke tekst (bv. steeds "2-1")
// vallen ze samen; verder los, zodat niks wegverstopt zit onder één rij.
// ---------------------------------------------------------------------------
const FREE_TEXT_MARKETS = new Set(['correct_score', 'anders']);

const MARKET_LABELS = {
  team_wint: 'Team wint',
  dubbelkans: 'Dubbele kans',
  btts: 'Beide teams scoren',
  over_under: 'Over/onder doelpunten',
  handicap: 'Handicap',
  correct_score: 'Correcte score',
  anders: 'Anders',
};

const SELECTION_LABELS = {
  team_wint: { home: 'Thuis wint', away: 'Uit wint' },
  dubbelkans: { home_draw: 'Thuis of gelijk', home_away: 'Thuis of uit', draw_away: 'Gelijk of uit' },
  btts: { yes: 'Ja', no: 'Nee' },
  over_under: { over: 'Over', under: 'Onder' },
  handicap: { home: 'Thuisteam', away: 'Uitteam' },
};

function marketSelectionLabel(market, selectionKey) {
  return SELECTION_LABELS[market]?.[selectionKey] || selectionKey;
}

// Een net-binnengekomen telegram-leg heeft tijdelijk odds = 1 (sentinel, zie
// TELEGRAM_ASSUMED_STAKE/ODDS_FETCHABLE_MARKETS) tot "Odds ophalen" is
// gedraaid - zonder deze check telt zo'n leg als "0 yield" mee en verwatert
// hij het gemiddelde onterecht. Per leg gecheckt (niet per bet): in dezelfde
// combi kan de ene leg al geprijsd zijn en de andere nog niet.
function isPricedLeg(leg, source) {
  return source !== 'telegram' || Number(leg.odds) !== 1;
}

function computeMarketRow(g) {
  const totalLegs = g.singles + g.combi;
  return {
    singles: g.singles,
    combi: g.combi,
    totalLegs,
    won: g.won,
    hitrate: totalLegs > 0 ? (g.won / totalLegs) * 100 : 0,
    pricedLegs: g.pricedLegs,
    yield: g.pricedLegs > 0 ? (g.yieldSum / g.pricedLegs) * 100 : null,
  };
}

async function buildMarketOverview(source) {
  const bets = await fetchBetsWithLegs('where source = $1', [source]);

  const groups = new Map(); // market -> Map(selectionKey -> { singles, combi, won, pricedLegs, yieldSum, picks })
  function getGroup(market, selectionKey) {
    let marketMap = groups.get(market);
    if (!marketMap) {
      marketMap = new Map();
      groups.set(market, marketMap);
    }
    let g = marketMap.get(selectionKey);
    if (!g) {
      g = { singles: 0, combi: 0, won: 0, pricedLegs: 0, yieldSum: 0, picks: [] };
      marketMap.set(selectionKey, g);
    }
    return g;
  }

  for (const bet of bets) {
    const isSingle = bet.legs.length === 1;
    for (const leg of bet.legs) {
      if (leg.status !== 'won' && leg.status !== 'lost') continue;
      const g = getGroup(leg.market, leg.selection);
      if (isSingle) g.singles += 1;
      else g.combi += 1;
      if (leg.status === 'won') g.won += 1;
      if (isPricedLeg(leg, source)) {
        g.pricedLegs += 1;
        g.yieldSum += leg.status === 'won' ? Number(leg.odds) - 1 : -1;
      }
      g.picks.push({
        legId: leg.id,
        label: leg.match ? `${leg.match.home} – ${leg.match.away}` : leg.manualLabel || 'Handmatige selectie',
        bookmaker: bet.bookmaker,
        isCombi: !isSingle,
        odds: Number(leg.odds),
        status: leg.status,
        placedAt: bet.placedAt,
      });
    }
  }

  const marketRoiFallback = (row) => (row.yield === null ? -Infinity : row.yield);

  const markets = [...groups.entries()]
    .map(([marketKey, selectionMap]) => {
      const freeform = FREE_TEXT_MARKETS.has(marketKey);
      const selections = [...selectionMap.entries()]
        .map(([selectionKey, g]) => ({
          key: selectionKey,
          label: marketSelectionLabel(marketKey, selectionKey),
          ...computeMarketRow(g),
          picks: g.picks.slice().sort((a, b) => new Date(b.placedAt) - new Date(a.placedAt)),
        }))
        .sort((a, b) => marketRoiFallback(b) - marketRoiFallback(a));
      const agg = selections.reduce(
        (acc, s) => ({
          singles: acc.singles + s.singles,
          combi: acc.combi + s.combi,
          won: acc.won + s.won,
          pricedLegs: acc.pricedLegs + s.pricedLegs,
          yieldSum: acc.yieldSum + (s.pricedLegs > 0 ? (s.yield / 100) * s.pricedLegs : 0),
        }),
        { singles: 0, combi: 0, won: 0, pricedLegs: 0, yieldSum: 0 }
      );
      return { key: marketKey, label: MARKET_LABELS[marketKey] || marketKey, freeform, selections, ...computeMarketRow(agg) };
    })
    .sort((a, b) => marketRoiFallback(b) - marketRoiFallback(a));

  const totalLegs = markets.reduce((sum, m) => sum + m.totalLegs, 0);
  return { markets, totalLegs };
}

app.get('/api/markets/overview', async (req, res) => {
  const source = req.query.source === 'telegram' ? 'telegram' : 'manual';
  try {
    res.json(await buildMarketOverview(source));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// Dag-/weekrapport (fase 2) — geen eigen Anthropic-integratie, exporteert
// alleen de afgehandelde picks uit de periode als bestand (zie
// reportGenerator.js voor waarom). "Dag" = sinds lokale middernacht vandaag,
// "week" = de rollende afgelopen 7 dagen (niet per se maandag-zondag, want de
// knop kan op elke dag van de week worden ingedrukt).
// ---------------------------------------------------------------------------
app.get('/api/reports/export', async (req, res) => {
  const { period, source } = req.query;
  if (period !== 'day' && period !== 'week') {
    res.status(400).json({ error: "period moet 'day' of 'week' zijn" });
    return;
  }
  const src = source === 'telegram' ? 'telegram' : 'manual';
  try {
    const since = new Date();
    if (period === 'day') since.setHours(0, 0, 0, 0);
    else since.setDate(since.getDate() - 7);

    const bets = await fetchBetsWithLegs(
      `where source = $1 and status in ('won', 'lost', 'void', 'cashed_out') and settled_at >= $2`,
      [src, since]
    );
    res.json(buildReportExport({ period, source: src, bets }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Het geschreven rapport (markdown) dat je terugkrijgt nadat je bovenstaande
// export aan Claude hebt gegeven — bewaard zodat het in het dashboard zelf
// te bekijken is, niet alleen als losse download op je eigen schijf.
app.get('/api/reports/notes', async (req, res) => {
  const source = req.query.source === 'telegram' ? 'telegram' : 'manual';
  try {
    const { rows } = await pool.query(
      `select id, period, source, pick_count, generated_at, content, created_at
       from report_notes where source = $1 order by generated_at desc`,
      [source]
    );
    res.json(
      rows.map((row) => ({
        id: row.id,
        period: row.period,
        source: row.source,
        pickCount: row.pick_count,
        generatedAt: row.generated_at,
        content: row.content,
        createdAt: row.created_at,
      }))
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/reports/notes', async (req, res) => {
  const { period, source, pickCount, generatedAt, content } = req.body;
  if (period !== 'day' && period !== 'week') {
    res.status(400).json({ error: "period moet 'day' of 'week' zijn" });
    return;
  }
  if (!content || !content.trim()) {
    res.status(400).json({ error: 'content is verplicht' });
    return;
  }
  try {
    await ensureSchema();
    const id = randomUUID();
    const src = source === 'telegram' ? 'telegram' : 'manual';
    await pool.query(
      `insert into report_notes (id, period, source, pick_count, generated_at, content)
       values ($1, $2, $3, $4, coalesce($5, now()), $6)`,
      [id, period, src, pickCount ?? null, generatedAt || null, content]
    );
    const { rows } = await pool.query('select * from report_notes where id = $1', [id]);
    const row = rows[0];
    res.status(201).json({
      id: row.id,
      period: row.period,
      source: row.source,
      pickCount: row.pick_count,
      generatedAt: row.generated_at,
      content: row.content,
      createdAt: row.created_at,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/reports/notes/:id', async (req, res) => {
  try {
    await pool.query('delete from report_notes where id = $1', [req.params.id]);
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// Live scores + automatische settlement
//
// Geen achtergrond-poller meer — dat kostte credits ook als er niemand keek.
// In plaats daarvan haalt de gebruiker scores handmatig op via de knop in de
// UI (POST /api/scores/refresh). Nog altijd alleen sporten waar een open bet
// aan een wedstrijd hangt die al is afgetrapt. daysFrom=1 kost 2 credits
// (i.p.v. 1) maar is nodig om ook het eindresultaat van net-afgelopen
// wedstrijden te krijgen.
// ---------------------------------------------------------------------------

function computeOutcome(market, selection, line, homeScore, awayScore) {
  if (homeScore === null || awayScore === null) return null;

  if (market === 'team_wint') {
    const result = homeScore > awayScore ? 'home' : homeScore < awayScore ? 'away' : 'draw';
    return selection === result ? 'won' : 'lost'; // gelijkspel = gewoon verloren, geen refund
  }
  if (market === 'dubbelkans') {
    const result = homeScore > awayScore ? 'home' : homeScore < awayScore ? 'away' : 'draw';
    const covers = {
      home_draw: ['home', 'draw'],
      home_away: ['home', 'away'],
      draw_away: ['draw', 'away'],
    };
    const covered = covers[selection];
    if (!covered) return null;
    return covered.includes(result) ? 'won' : 'lost';
  }
  if (market === 'btts') {
    const bothScored = homeScore > 0 && awayScore > 0;
    const wantsYes = selection === 'yes';
    return wantsYes === bothScored ? 'won' : 'lost';
  }
  if (market === 'over_under') {
    if (line === null || line === undefined) return null;
    const total = homeScore + awayScore;
    if (total === Number(line)) return 'void';
    const result = total > Number(line) ? 'over' : 'under';
    return selection === result ? 'won' : 'lost';
  }
  if (market === 'handicap') {
    if (line === null || line === undefined) return null;
    const selectedScore = (selection === 'home' ? homeScore : awayScore) + Number(line);
    const opponentScore = selection === 'home' ? awayScore : homeScore;
    if (selectedScore === opponentScore) return 'void';
    return selectedScore > opponentScore ? 'won' : 'lost';
  }
  if (market === 'correct_score') {
    const match = /^(\d+)-(\d+)$/.exec(selection || '');
    if (!match) return null;
    const [, predictedHome, predictedAway] = match;
    return Number(predictedHome) === homeScore && Number(predictedAway) === awayScore ? 'won' : 'lost';
  }
  return null; // 'anders' → altijd handmatig settelen
}

// Herberekent de totale odds (en dus de mogelijke uitbetaling) van een bet
// als het product van zijn eigen legs - een void leg telt daarbij als
// quotering 1.00, dezelfde conventie als reevaluateBet hieronder gebruikt.
// Nodig na elke correctie die een leg-odds verandert (handmatige fix op een
// combi-leg, of de telegram "Odds ophalen"-refresh) zodat de bet-odds nooit
// stiekem achterblijft bij wat de legs zelf zeggen.
async function recomputeBetOdds(betId) {
  const { rows: legRows } = await pool.query('select odds, status from bet_legs where bet_id = $1', [betId]);
  const { rows: betRows } = await pool.query('select stake from bets where id = $1', [betId]);
  if (!betRows[0]) return;
  const totalOdds = legRows.reduce((acc, l) => acc * (l.status === 'void' ? 1 : Number(l.odds)), 1);
  const stake = Number(betRows[0].stake);
  await pool.query('update bets set odds = $1, potential_payout = $2 where id = $3', [totalOdds, totalOdds * stake, betId]);
}

// Eén leg is maar een deel van de slip. Bij elke leg die van status
// verandert, wordt de hele bet opnieuw beoordeeld: één verloren leg maakt de
// hele bet verloren (zoals bij een echte combi/accumulator), en pas als alle
// legs een uitslag hebben (gewonnen of void) én er minstens 1 leg won, wordt
// de bet gewonnen verklaard — met de payout herberekend over de niet-void
// legs (net zoals een bookmaker een voided leg als quotering 1.00 behandelt).
async function reevaluateBet(betId) {
  const { rows: betRows } = await pool.query('select * from bets where id = $1 and status = $2', [betId, 'open']);
  const bet = betRows[0];
  if (!bet) return; // al gesetteld (of handmatig overschreven) — niet aankomen

  const { rows: legs } = await pool.query('select * from bet_legs where bet_id = $1', [betId]);

  if (legs.some((leg) => leg.status === 'lost')) {
    await pool.query('update bets set status = $1, settled_at = now() where id = $2', ['lost', betId]);
    return;
  }

  const allDecided = legs.every((leg) => leg.status === 'won' || leg.status === 'void');
  if (!allDecided) return; // nog legs open/onbeslist → bet blijft open

  const wonLegs = legs.filter((leg) => leg.status === 'won');
  if (wonLegs.length === 0) {
    // alle legs void (bv. alle wedstrijden afgelast) → hele inzet terug
    await pool.query('update bets set status = $1, settled_at = now() where id = $2', ['void', betId]);
    return;
  }
  const voidLegs = legs.filter((leg) => leg.status === 'void');
  if (voidLegs.length === 0) {
    // Geen enkele leg is void: de opgeslagen odds/payout blijven precies
    // zoals ze zijn vastgelegd — inclusief een eventuele bet boost of een
    // handmatige payout-correctie (een bookmaker rondt soms net anders af
    // dan pure odds × inzet). Niets om te herberekenen.
    await pool.query('update bets set status = $1, settled_at = now() where id = $2', ['won', betId]);
    return;
  }
  // Wél een void leg: diens eigen odds delen we uit de totale odds (alsof
  // hij quotering 1.00 had), in plaats van de odds opnieuw op te bouwen uit
  // alleen de gewonnen legs — zo blijft een boost intact. De payout wordt in
  // dit geval wel herberekend; een eerdere handmatige payout-correctie kan
  // dan niet automatisch kloppend blijven.
  const voidFactor = voidLegs.reduce((acc, leg) => acc * Number(leg.odds), 1);
  const effectiveOdds = Number(bet.odds) / voidFactor;
  const payout = effectiveOdds * Number(bet.stake);
  await pool.query(
    'update bets set status = $1, odds = $2, potential_payout = $3, settled_at = now() where id = $4',
    ['won', effectiveOdds, payout, betId]
  );
}

async function settleLegsForMatch(match) {
  const { rows: legs } = await pool.query('select * from bet_legs where match_id = $1 and status = $2', [match.id, 'open']);
  const affectedBetIds = new Set();
  for (const leg of legs) {
    const outcome = computeOutcome(leg.market, leg.selection, leg.line, match.home_score, match.away_score);
    if (!outcome) continue; // niet automatisch te bepalen, leg blijft open voor handmatige settlement
    await pool.query('update bet_legs set status = $1 where id = $2', [outcome, leg.id]);
    affectedBetIds.add(leg.bet_id);
  }
  for (const betId of affectedBetIds) {
    await reevaluateBet(betId);
  }
}

async function pollScoresOnce() {
  const { rows: pending } = await pool.query(`
    select distinct m.sport_key
    from matches m
    join bet_legs l on l.match_id = m.id
    join bets b on b.id = l.bet_id
    where b.status = 'open' and l.status = 'open' and m.status != 'final' and m.commence_time <= now()
      and m.sport_key != 'manual'
  `);
  if (pending.length === 0) return;

  for (const { sport_key: sportKey } of pending) {
    try {
      const events = await oddsApiRequest(`/sports/${sportKey}/scores/?daysFrom=1`);
      for (const event of events) {
        const homeScoreEntry = event.scores?.find((s) => s.name === event.home_team);
        const awayScoreEntry = event.scores?.find((s) => s.name === event.away_team);
        if (!homeScoreEntry || !awayScoreEntry) continue;

        const homeScore = Number(homeScoreEntry.score);
        const awayScore = Number(awayScoreEntry.score);
        const status = event.completed ? 'final' : 'live';

        const { rows } = await pool.query(
          `update matches set home_score = $1, away_score = $2, status = $3, last_score_sync_at = now()
           where id = $4 returning *`,
          [homeScore, awayScore, status, event.id]
        );
        const match = rows[0];
        if (match && status === 'final') {
          await settleLegsForMatch(match);
        }
      }
    } catch (error) {
      console.error(`[scores] poll failed for ${sportKey}: ${error.message}`);
    }
  }
}

app.post('/api/scores/refresh', async (req, res) => {
  try {
    await pollScoresOnce();
    res.json({ usage: await getLatestUsage() });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.get('/api/scores/usage', async (req, res) => {
  try {
    res.json({ usage: await getLatestUsage() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// Live-wedstrijden overzicht — los van de Odds API/settlement hierboven, zie
// liveScores.js voor waarom (gratis bron, mag dus vaak verversen).
// ---------------------------------------------------------------------------
// Favorieten voor de live-pagina: een wedstrijd is standaard favoriet zodra
// er een open bet op zit (via matches.tsdb_live_id, handmatig gekoppeld of
// fuzzy gematcht op dezelfde manier als /api/live-scores/open-matches
// hierboven). favorite_matches bevat overrides op dat default - favorite
// true voor een handmatige ster op een wedstrijd zonder bet, favorite false
// om een bet-favoriet toch uit te zetten - zodat de ster-knop altijd
// klikbaar blijft, ook op een wedstrijd waar je op inzet staat.
//
// Eén match kan meerdere open legs hebben (bv. een 1X2 én een over/onder op
// hetzelfde duel, uit dezelfde of verschillende bets) - die verzamelen we
// allemaal in picksByTsdbId i.p.v. alleen de eerst-gevondene te bewaren.
// Alleen eigen bets (source='manual') - Telegram-picks zijn niet van jou en
// horen dus niet als favoriet/pick op de live-tab te verschijnen.
async function getFavoriteState() {
  const [legRows, overrideRows] = await Promise.all([
    pool.query(`
      select l.market, l.selection, l.line,
        m.id as match_id, m.home, m.away, m.competition, m.commence_time, m.tsdb_live_id
      from matches m
      join bet_legs l on l.match_id = m.id
      join bets b on b.id = l.bet_id
      where b.status = 'open' and l.status = 'open' and b.source = 'manual'
      order by l.position
    `),
    pool.query('select tsdb_live_id, favorite from favorite_matches'),
  ]);
  const tsdbIdByMatchId = new Map();
  const picksByTsdbId = new Map();
  for (const row of legRows.rows) {
    let tsdbId = tsdbIdByMatchId.get(row.match_id);
    if (tsdbId === undefined) {
      tsdbId = row.tsdb_live_id || findLiveMatchIdFor({
        home: row.home,
        away: row.away,
        competition: row.competition,
        commenceTime: row.commence_time,
      });
      tsdbIdByMatchId.set(row.match_id, tsdbId);
    }
    if (!tsdbId) continue;
    const pick = { market: row.market, selection: row.selection, line: row.line !== null ? Number(row.line) : null };
    if (!picksByTsdbId.has(tsdbId)) picksByTsdbId.set(tsdbId, [pick]);
    else picksByTsdbId.get(tsdbId).push(pick);
  }
  const overrideById = new Map(overrideRows.rows.map((row) => [row.tsdb_live_id, row.favorite]));
  return { picksByTsdbId, overrideById };
}

app.get('/api/live-scores', async (req, res) => {
  const base = getLiveScores();
  try {
    const { picksByTsdbId, overrideById } = await getFavoriteState();
    const toPersist = [];
    const matches = base.matches.map((m) => {
      const picks = picksByTsdbId.get(m.id) || null;
      const override = overrideById.has(m.id) ? overrideById.get(m.id) : null;
      // Een favoriet blijft in het Favorieten-blok staan als de wedstrijd is
      // afgelopen, zodat je de eindstand kunt terugzien (tot de retention-
      // cutoff in liveScores.js). Een bet-favoriet verdwijnt zodra de bet
      // settled wordt (geen open leg meer), dus leggen we die vast als
      // override zolang de wedstrijd nog niet is afgelopen.
      if (override === null && picks && !FINISHED_STATUSES.has(m.status)) toPersist.push(m.id);
      const favorite = override !== null ? override : Boolean(picks);
      return {
        ...m,
        favorite,
        favoriteSource: !favorite ? null : override !== null ? 'manual' : 'bet',
        picks,
      };
    });
    res.json({ ...base, matches });
    for (const id of toPersist) {
      pool
        .query(
          'insert into favorite_matches (tsdb_live_id, favorite) values ($1, true) on conflict (tsdb_live_id) do nothing',
          [id]
        )
        .catch((err) => console.error('[favorites] vastleggen mislukt:', err.message));
    }
  } catch (error) {
    // Favorieten zijn puur verrijking - een mislukte query mag de rest van
    // het live-overzicht niet blokkeren.
    res.json(base);
  }
});

// Ster-knop op de live-pagina: zet een expliciete override, ook op een
// wedstrijd met een bet erop (zie getFavoriteState hierboven) - de knop mag
// nooit vergrendeld zijn, ook al is het default favoriet-zijn afkomstig van
// een bet.
app.post('/api/favorites/:tsdbId', async (req, res) => {
  try {
    await pool.query(
      `insert into favorite_matches (tsdb_live_id, favorite) values ($1, true)
       on conflict (tsdb_live_id) do update set favorite = true, favorited_at = now()`,
      [req.params.tsdbId]
    );
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/favorites/:tsdbId', async (req, res) => {
  try {
    await pool.query(
      `insert into favorite_matches (tsdb_live_id, favorite) values ($1, false)
       on conflict (tsdb_live_id) do update set favorite = false, favorited_at = now()`,
      [req.params.tsdbId]
    );
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Live-overlay voor open picks - matcht elke wedstrijd met een nog open pick
// op competitie + teamnamen tegen de TheSportsDB-feed (zie findLiveMatchFor).
// Puur voor de weergave (ScoreBadge in BetList/OpenBetsModal): settlement
// blijft volledig via de Odds API-knop lopen, dit wijzigt nooit bet_legs of
// bets in de database.
app.get('/api/live-scores/open-matches', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      select distinct m.id, m.home, m.away, m.competition, m.commence_time, m.tsdb_live_id
      from matches m
      join bet_legs l on l.match_id = m.id
      join bets b on b.id = l.bet_id
      where b.status = 'open' and l.status = 'open'
    `);
    // Elke gecheckte match_id komt in de response terecht, ook als er geen
    // live wedstrijd bij gevonden is (dan gewoon `null`) - zo kan de UI
    // onderscheid maken tussen "gecheckt, niet gevonden" (toon "niet live
    // gevolgd, gebruik de knop") en "nog niet gecheckt" (nog niets tonen).
    // Een handmatige koppeling (tsdb_live_id) wint altijd van de fuzzy match.
    const matches = {};
    for (const row of rows) {
      matches[row.id] = row.tsdb_live_id
        ? getLiveMatchOverlayById(row.tsdb_live_id)
        : findLiveMatchFor({
            home: row.home,
            away: row.away,
            competition: row.competition,
            commenceTime: row.commence_time,
          });
    }
    const feed = getLiveScores();
    res.json({ matches, updatedAt: new Date().toISOString(), feedUpdatedAt: feed.updatedAt, feedError: feed.error });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Handmatige koppeling met een live wedstrijd (zie ScoreBadge/LiveLinkPicker
// in src/components/BetList.jsx) - voor als de automatische fuzzy-match op
// team-/competitienaam een keer misgrijpt. tsdbLiveId: null ontkoppelt weer
// (valt terug op automatisch matchen).
app.patch('/api/matches/:id/live-link', async (req, res) => {
  const { tsdbLiveId } = req.body;
  try {
    const { rowCount } = await pool.query('update matches set tsdb_live_id = $1 where id = $2', [tsdbLiveId || null, req.params.id]);
    if (rowCount === 0) {
      res.status(404).json({ error: 'Wedstrijd niet gevonden' });
      return;
    }
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Sport_key voor een matches-rij die alleen bestaat om een handmatig
// ingevoerde selectie (geen Odds API-wedstrijd) aan een live wedstrijd te
// koppelen - zie PATCH /api/bet-legs/:id/live-link. Geen echte Odds
// API-sport, dus pollScoresOnce slaat 'm expliciet over (zie de where-clause
// daar) om geen credits te verspillen aan een sport die toch nooit een
// event-match oplevert.
const MANUAL_MATCH_SPORT_KEY = 'manual';

// Handmatig ingevoerde selecties (vrije teamnamen, geen match_id - zie
// upsertMatch/POST /api/bets hierboven) hebben nog geen matches-rij om aan
// een live wedstrijd te koppelen. Deze route maakt er op het moment van
// koppelen alsnog één aan (id = manual:<tsdbLiveId>, zodat meerdere manuele
// legs die naar dezelfde live wedstrijd wijzen 'm delen, net als upsertMatch
// voor echte Odds API-matches doet) en zet bet_legs.match_id ernaar. Heeft de
// leg al een match_id (dus een gewone Odds API-wedstrijd), dan gedraagt dit
// zich identiek aan PATCH /api/matches/:id/live-link hierboven.
app.patch('/api/bet-legs/:id/live-link', async (req, res) => {
  const { tsdbLiveId, home, away, league, kickoff } = req.body;
  try {
    const { rows } = await pool.query('select match_id from bet_legs where id = $1', [req.params.id]);
    const leg = rows[0];
    if (!leg) {
      res.status(404).json({ error: 'Selectie niet gevonden' });
      return;
    }

    if (leg.match_id) {
      await pool.query('update matches set tsdb_live_id = $1 where id = $2', [tsdbLiveId || null, leg.match_id]);
      res.status(204).end();
      return;
    }

    if (!tsdbLiveId || !home || !away) {
      res.status(400).json({ error: 'tsdbLiveId, home en away zijn verplicht om een handmatige selectie te koppelen' });
      return;
    }
    const matchId = `manual:${tsdbLiveId}`;
    const commenceTime = kickoff ? parseKickoffUtc(kickoff) : new Date();
    await pool.query(
      `insert into matches (id, sport_key, competition, home, away, commence_time, tsdb_live_id)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (id) do update set
         competition = excluded.competition,
         home = excluded.home,
         away = excluded.away,
         commence_time = excluded.commence_time,
         tsdb_live_id = excluded.tsdb_live_id`,
      [matchId, MANUAL_MATCH_SPORT_KEY, league || null, home, away, commenceTime, tsdbLiveId]
    );
    await pool.query('update bet_legs set match_id = $1 where id = $2', [matchId, req.params.id]);
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3001;
ensureSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Bet Tracker API listening on port ${PORT}`);
    });
    startLiveScoresPoller();
    startTelegramListener(ingestTelegramMessage)
      .then((client) => {
        activeTelegramClient = client;
      })
      .catch((error) => {
        console.error('[telegram] kon niet starten:', error.message);
      });
  })
  .catch((error) => {
    console.error('Kon databaseschema niet aanmaken:', error);
    process.exit(1);
  });
