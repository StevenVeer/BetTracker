export const MARKETS = [
  { key: 'team_wint', label: 'Team wint' },
  { key: 'dubbelkans', label: 'Dubbele kans' },
  { key: 'btts', label: 'Beide teams scoren' },
  { key: 'over_under', label: 'Over/onder doelpunten' },
  { key: 'handicap', label: 'Handicap' },
  { key: 'correct_score', label: 'Correcte score' },
  { key: 'anders', label: 'Anders' },
];

// Korte labels voor markten in krappe ruimtes (bv. de live-tab).
export const MARKET_ABBR = {
  team_wint: 'Winnaar',
  dubbelkans: 'Dub. kans',
  btts: 'BTTS',
  over_under: 'O/U',
  handicap: 'Hcp',
  correct_score: 'Score',
  anders: 'Overig',
};

// Markten die een select met vaste opties gebruiken (naast eventueel een lijn).
const LINE_MARKETS = new Set(['over_under']);
// Markten waarvoor de server de uitslag automatisch kan bepalen uit de eindstand.
export const AUTO_SETTLED_MARKETS = new Set(['team_wint', 'dubbelkans', 'btts', 'over_under', 'handicap', 'correct_score']);

export function isLineMarket(market) {
  return LINE_MARKETS.has(market);
}

export function selectionOptions(market, match) {
  const home = match?.home || 'Thuisteam';
  const away = match?.away || 'Uitteam';
  switch (market) {
    case 'team_wint':
      return [
        { value: 'home', label: `${home} wint` },
        { value: 'away', label: `${away} wint` },
      ];
    case 'dubbelkans':
      return [
        { value: 'home_draw', label: `${home} of gelijk` },
        { value: 'home_away', label: `${home} of ${away}` },
        { value: 'draw_away', label: `Gelijk of ${away}` },
      ];
    case 'btts':
      return [
        { value: 'yes', label: 'Ja' },
        { value: 'no', label: 'Nee' },
      ];
    case 'over_under':
      return [
        { value: 'over', label: 'Over' },
        { value: 'under', label: 'Onder' },
      ];
    case 'handicap':
      return [
        { value: 'home', label: home },
        { value: 'away', label: away },
      ];
    default:
      return []; // 'correct_score' (twee cijfervelden) en 'anders' (vrije tekst)
  }
}

export function describeBet(bet) {
  const options = selectionOptions(bet.market, bet.match);
  if (bet.market === 'over_under') {
    const dir = bet.selection === 'over' ? 'Over' : 'Onder';
    return `${dir} ${bet.line ?? '?'} doelpunten`;
  }
  if (bet.market === 'handicap') {
    const team = options.find((o) => o.value === bet.selection)?.label || bet.selection;
    const line = Number(bet.line);
    const sign = line > 0 ? '+' : '';
    return `${team} (${sign}${line})`;
  }
  if (bet.market === 'correct_score') {
    return `Correcte score ${bet.selection}`;
  }
  const match = options.find((o) => o.value === bet.selection);
  if (match) return match.label;
  return bet.selection; // 'anders' → vrije tekst
}

export const STATUS_LABELS = {
  open: 'Open',
  won: 'Gewonnen',
  lost: 'Verloren',
  void: 'Void',
  cashed_out: 'Cashed out',
};
