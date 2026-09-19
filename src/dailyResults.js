export function dayKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function todayKey() {
  return dayKey(new Date());
}

// Wat een bet aan winst teruggeeft, los van de inzet: bij winst/cashout de
// volledige uitbetaling, bij void de inzet terug. Bij verlies (of nog open)
// gebeurt er niets meer - dat geld is al "weg" op het moment van inzetten.
export function betWinst(bet) {
  if (bet.status === 'won' || bet.status === 'cashed_out') return Number(bet.potentialPayout);
  if (bet.status === 'void') return Number(bet.stake);
  return 0;
}

// Maandag van de week waarin `date` valt, als dayKey - vaste ankerdag per
// week zodat elke dag in die week op dezelfde period-key uitkomt.
function weekKey(date) {
  const dow = date.getDay(); // 0 = zondag
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(date);
  monday.setDate(date.getDate() + mondayOffset);
  return dayKey(monday);
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
}

function periodKey(date, granularity) {
  if (granularity === 'month') return monthKey(date);
  if (granularity === 'week') return weekKey(date);
  return dayKey(date);
}

// Groepeert bets op de dag dat ze GEPLAATST zijn, niet op de dag waarop de
// automatische settlement toevallig langskomt. Zo blijft een bet altijd bij
// de dag horen waarop hij is neergelegd, ook als de uitslag pas dagen later
// (of na een herstart van de settlement-poller) binnenkomt. Alle bets tellen
// meteen mee (ook nog-open bets, met betWinst 0) - per dag/week/maand te
// groeperen voor de zoom-niveaus van de equity curve, die op dezelfde basis
// draait als het dagoverzicht.
export function groupByPlacedPeriod(bets, granularity = 'day') {
  const byPeriod = new Map();
  for (const bet of bets) {
    const key = periodKey(new Date(bet.placedAt), granularity);
    if (!byPeriod.has(key)) byPeriod.set(key, []);
    byPeriod.get(key).push(bet);
  }

  const periods = Array.from(byPeriod.entries())
    .map(([date, periodBets]) => {
      const staked = periodBets.reduce((s, b) => s + Number(b.stake), 0);
      const won = periodBets.reduce((s, b) => s + betWinst(b), 0);
      return { date, bets: periodBets, staked, won, result: won - staked };
    })
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  let cumulative = 0;
  for (const period of periods) {
    cumulative += period.result;
    period.cumulative = cumulative;
  }
  return periods;
}

export function groupByDay(bets) {
  return groupByPlacedPeriod(bets, 'day');
}
