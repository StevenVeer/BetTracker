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

// Eén onderdeel van een bet builder. Een korte keuze ("Ja", "1+") zegt
// zonder markt niets, dus die krijgt de markt ervoor.
export function partLabel(part) {
  return part.market && part.pick.length <= 3 ? `${part.market}: ${part.pick}` : part.pick;
}

export function isBetBuilder(bet) {
  return Array.isArray(bet.parts) && bet.parts.length > 1;
}

export const partStatus = (part) => part.status || 'open';

// Zelfde regel als betBuilderStatus op de server: één verloren onderdeel
// maakt de leg verloren, void-onderdelen vallen weg.
export function betBuilderStatus(statuses) {
  if (statuses.includes('lost')) return 'lost';
  if (statuses.includes('open')) return 'open';
  if (statuses.every((s) => s === 'void')) return 'void';
  return 'won';
}

// De statussen van alle onderdelen, met die van onderdeel `index` gewijzigd.
export function withPartStatus(parts, index, status) {
  return parts.map((part, i) => (i === index ? status : partStatus(part)));
}

export function describeBet(bet) {
  if (isBetBuilder(bet)) return `Bet builder: ${bet.parts.map(partLabel).join(' + ')}`;
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
