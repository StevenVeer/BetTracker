// Fuzzy team-naam matching: bronnen gebruiken vaak bijnamen
// ("Man City", "Spurs") terwijl de Odds API de volledige naam levert
// ("Manchester City", "Tottenham Hotspur"). Woord-voor-woord vergelijken na
// het uitschrijven van bekende afkortingen dekt de meeste gevallen; de rest
// valt terug op "needs review" in de UI, dus fouten hier zijn niet fataal.
const ALIAS_WORDS = {
  man: 'manchester',
  utd: 'united',
  spurs: 'tottenham',
  wolves: 'wolverhampton',
  psg: 'paris',
  gladbach: 'monchengladbach',
  atleti: 'atletico',
  inter: 'internazionale',
  saints: 'southampton',
};

const DIACRITICS_REGEX = new RegExp('[̀-ͯ]', 'g');

function normalizeTeamName(name) {
  const cleaned = (name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(DIACRITICS_REGEX, '')
    .replace(/\b(fc|cf|afc|sc|ac|cd|the)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!cleaned) return [];
  return cleaned.split(' ').filter(Boolean).map((word) => ALIAS_WORDS[word] || word);
}

// Strikt: ALLE woorden van de kortste naam moeten in de langste voorkomen -
// niet zomaar de helft. Een losse overlap-fractie liet "Manchester City"
// matchen met "Bristol City" (beide delen alleen "city") en "Celta Vigo" met
// "Celta Fortuna" - foute koppelingen die daarna fout zouden settelen. Dat
// weegt zwaarder dan een gemiste match (die valt netjes terug op "needs
// review"), dus liever te streng dan te los.
export function teamNamesMatch(a, b) {
  const wordsA = normalizeTeamName(a);
  const wordsB = normalizeTeamName(b);
  if (wordsA.length === 0 || wordsB.length === 0) return false;
  const [shorter, longer] = wordsA.length <= wordsB.length ? [wordsA, wordsB] : [wordsB, wordsA];
  const longerSet = new Set(longer);
  return shorter.every((w) => longerSet.has(w));
}

// Twee woorden "lijken op elkaar": gelijk, één is een voorvoegsel van de
// ander ("borussia" / "bor", "tromso" / "tromsoe") of ze schelen maar één
// letter ("sevilla" / "sevila"). Korte woorden (<3) alleen bij exacte match,
// anders matcht "ac"-achtig ruis overal op.
function wordsSimilar(a, b) {
  if (a === b) return true;
  if (a.length < 3 || b.length < 3) return false;
  if (a.startsWith(b) || b.startsWith(a)) return true;
  if (a.length < 5 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

// Losse score (0..1) voor koppelsuggesties - bewust ruimer dan
// teamNamesMatch hierboven: dit koppelt nooit zelf, het zet alleen
// kandidaten op een lijst die je met de hand bevestigt. Score = deel van de
// woorden van de kortste naam dat een gelijkend woord in de andere heeft.
export function teamNameSimilarity(a, b) {
  const wordsA = normalizeTeamName(a);
  const wordsB = normalizeTeamName(b);
  if (wordsA.length === 0 || wordsB.length === 0) return 0;
  const [shorter, longer] = wordsA.length <= wordsB.length ? [wordsA, wordsB] : [wordsB, wordsA];
  const hits = shorter.filter((w) => longer.some((v) => wordsSimilar(w, v))).length;
  return hits / shorter.length;
}
