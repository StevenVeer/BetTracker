// De groep post lange berichten met meerdere losse picks erin, tussen
// chit-chat/promo/emoji/links door, elk gemarkeerd met een 🔥-bullet.
// Picks die onder hetzelfde "Safer" of "Riskier"-kopje in één bericht staan
// horen bij elkaar: dat wordt straks één parlay (bet met meerdere legs),
// precies zoals een combi bij de eigen bets. Alles wat geen herkenbare
// voetbal-pick is (player props, card props, Amerikaanse sports, chit-chat,
// links) wordt hier al genegeerd - geen "needs review"-ruis, gewoon weg.
//
// parseTelegramMessage() geeft dus een ARRAY VAN GROEPEN terug (elke groep
// is 1 parlay); een bericht zonder herkenbare picks geeft een lege array.
//
// Voorbeelden uit de groep:
//   "Safer\n🔥Leeds vs Newcastle — Over 1.5 goals\n🔥Villarreal vs Betis — Over 1.5 goals"
//     -> [[ {home:'Leeds',away:'Newcastle',...}, {home:'Villarreal',away:'Betis',...} ]]
//   "🔥Real Madrid to win"                              (geen tegenstander genoemd!)
//   "🔥Bayern Munich to beat Elversberg"
//   "🔥Leipzig–Hamburg Over 1.5 goals"                   (dash aan elkaar, geen "vs")
//   "🔥Both teams to get a card"                         (geen voetbal-uitslagmarkt -> genegeerd)
//   "🔥 Haaland 1+ shot on target"                        (player prop -> genegeerd)

const PICK_BULLET = /^\u{1F525}\s*/u; // 🔥
const SECTION_MARKER = /^(safer|riskier|risky)[\s:!.]*$/i;

// De groep post af en toe een recap van al afgelopen picks ("kijk, allemaal
// raak!") die er structureel IDENTIEK uitziet aan een verse picks-post:
// zelfde 🔥-bullets, zelfde "Safer"-kop, zelfde gecombineerde
// odds onderaan. Het enige verschil zit in de vrije tekst erboven, die in de
// verleden tijd bevestigt dat de voorspellingen al zijn uitgekomen. Zo'n
// bericht mag nooit als nieuwe pick worden ingelezen (ook niet als "boom,
// deze ging erin"-recap van een net afgelopen wedstrijd, dat is een ander
// geval - zie pickBestMatch in index.js), dus zodra zo'n bevestigingszin
// ergens in het bericht staat wordt het hele bericht genegeerd.
const RESULT_RECAP_PHRASES = [
  /come true/i,
  /full house/i,
  /all hit/i,
  /all (?:of them )?(?:won|cashed|green)\b/i,
  /\bboom\b/i,
  /well done if you followed/i,
];

export function isResultRecap(rawText) {
  return RESULT_RECAP_PHRASES.some((re) => re.test(rawText));
}

const TWO_TEAM_VS_OU = /^(.+?)\s+vs\.?\s+(.+?)\s*[—–-]\s*(over|under)\s+(\d+(?:\.\d+)?)\s*goals?\.?$/i;
// Zelfde markt, maar zonder streepje tussen teamnaam en markt (bv. "Vasco vs
// Santa Fe Under 3.5 Goals" i.p.v. "Vasco vs Santa Fe — Under 3.5 Goals") -
// komt ook voor in de groep.
const TWO_TEAM_VS_OU_NO_DASH = /^(.+?)\s+vs\.?\s+(.+?)\s+(over|under)\s+(\d+(?:\.\d+)?)\s*goals?\.?$/i;
const TWO_TEAM_DASH_OU = /^([^–—-]+?)[–—](.+?)\s+(over|under)\s+(\d+(?:\.\d+)?)\s*goals?\.?$/i;
const TO_BEAT = /^(.+?)\s+to beat\s+(.+?)\.?$/i;
const TO_WIN_OR_DRAW = /^(.+?)\s+(?:to\s+)?win or draw\.?$/i;
const TO_WIN = /^(.+?)\s+to\s+win\.?$/i;

// Backward-compatible fallback: een regel die zelf al "Team A V/vs Team B -
// pick" bevat (zoals oorspronkelijk beschreven), voor het geval dat format
// ook wel eens voorkomt.
const TEAM_SPLIT = /\s+v(?:s\.?)?\s+/i;
const DASH_SPLIT = /\s[-–]\s/;

function matchTeamInPick(pickLower, home, away) {
  const homeLower = home.toLowerCase();
  const awayLower = away.toLowerCase();
  if (pickLower.includes(homeLower)) return 'home';
  if (pickLower.includes(awayLower)) return 'away';
  const lastWord = (name) => name.trim().split(/\s+/).pop().toLowerCase();
  if (pickLower.includes(lastWord(home))) return 'home';
  if (pickLower.includes(lastWord(away))) return 'away';
  return null;
}

function parseLegacyTwoTeamLine(line) {
  const dashParts = line.split(DASH_SPLIT);
  let home;
  let away;
  let pickText;
  if (TEAM_SPLIT.test(dashParts[0])) {
    const teamParts = dashParts[0].split(TEAM_SPLIT).map((p) => p.trim()).filter(Boolean);
    if (teamParts.length !== 2) return null;
    [home, away] = teamParts;
    pickText = dashParts.slice(1).join(' - ').trim();
  } else if (dashParts.length >= 3) {
    home = dashParts[0].trim();
    away = dashParts[1].trim();
    pickText = dashParts.slice(2).join(' - ').trim();
  } else {
    return null;
  }
  if (!home || !away || !pickText) return null;

  const pickLower = pickText.toLowerCase();
  const overUnder = /\b(over|under|o|u)\s*(\d+(?:\.\d+)?)\b/.exec(pickLower);
  if (overUnder) {
    return { kind: 'two-team', home, away, market: 'over_under', selection: overUnder[1].startsWith('o') ? 'over' : 'under', line: Number(overUnder[2]) };
  }
  if (/\bbtts\b|both teams to score/.test(pickLower)) {
    const wantsNo = /\bno\b/.test(pickLower) && !/\byes\b/.test(pickLower);
    return { kind: 'two-team', home, away, market: 'btts', selection: wantsNo ? 'no' : 'yes', line: null };
  }
  const correctScore = /\b(\d+)\s*[-:]\s*(\d+)\b/.exec(pickLower);
  if (correctScore) {
    return { kind: 'two-team', home, away, market: 'correct_score', selection: `${correctScore[1]}-${correctScore[2]}`, line: null };
  }
  if (/win or draw|draw or win|double chance/.test(pickLower)) {
    const side = matchTeamInPick(pickLower, home, away);
    if (!side) return null;
    return { kind: 'two-team', home, away, market: 'dubbelkans', selection: side === 'home' ? 'home_draw' : 'draw_away', line: null };
  }
  if (/\b(win|to win)\b/.test(pickLower) && !/\bdraw\b/.test(pickLower)) {
    const side = matchTeamInPick(pickLower, home, away);
    if (!side) return null;
    return { kind: 'two-team', home, away, market: 'team_wint', selection: side, line: null };
  }
  return null;
}

function parsePickLine(line) {
  let m = TWO_TEAM_VS_OU.exec(line);
  if (m) {
    return { kind: 'two-team', home: m[1].trim(), away: m[2].trim(), market: 'over_under', selection: m[3].toLowerCase(), line: Number(m[4]) };
  }
  m = TWO_TEAM_DASH_OU.exec(line);
  if (m) {
    return { kind: 'two-team', home: m[1].trim(), away: m[2].trim(), market: 'over_under', selection: m[3].toLowerCase(), line: Number(m[4]) };
  }
  m = TWO_TEAM_VS_OU_NO_DASH.exec(line);
  if (m) {
    return { kind: 'two-team', home: m[1].trim(), away: m[2].trim(), market: 'over_under', selection: m[3].toLowerCase(), line: Number(m[4]) };
  }
  m = TO_BEAT.exec(line);
  if (m) {
    return { kind: 'picked-vs-opponent', pickedTeam: m[1].trim(), opponentTeam: m[2].trim(), market: 'team_wint' };
  }
  m = TO_WIN_OR_DRAW.exec(line);
  if (m) {
    return { kind: 'single-team', team: m[1].trim(), market: 'dubbelkans' };
  }
  m = TO_WIN.exec(line);
  if (m) {
    return { kind: 'single-team', team: m[1].trim(), market: 'team_wint' };
  }
  return parseLegacyTwoTeamLine(line);
}

// Retourneert een array van groepen (parlays). Elke groep is een array van
// pick-objecten ({lineText, kind, ...}). Regels zonder 🔥-bullet, en
// 🔥-regels die geen herkenbare voetbal-uitslagmarkt zijn, tellen niet mee.
export function parseTelegramMessage(rawText) {
  if (isResultRecap(rawText)) return [];
  const lines = (rawText || '').split(/\r?\n/).map((l) => l.trim());
  const groups = [];
  let current = [];

  function flush() {
    if (current.length > 0) groups.push(current);
    current = [];
  }

  for (const rawLine of lines) {
    if (!rawLine) continue;
    if (SECTION_MARKER.test(rawLine)) {
      flush();
      continue;
    }
    if (!PICK_BULLET.test(rawLine)) continue;
    const lineText = rawLine.replace(PICK_BULLET, '').trim();
    if (!lineText) continue;
    const parsed = parsePickLine(lineText);
    if (!parsed) continue; // niet-herkende pick (player prop, card prop, andere sport, ...) -> negeren
    current.push({ lineText, ...parsed });
  }
  flush();

  return groups;
}
