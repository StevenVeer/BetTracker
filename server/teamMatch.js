// Fuzzy team-naam matching: Telegram-berichten gebruiken vaak bijnamen
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
