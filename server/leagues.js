// Gedeelde competitie-lijst - zowel de wedstrijden-proxy (dropdown in het
// bet-formulier, via de Odds API) als het live-scores overzicht (via
// ESPN, zie liveScores.js) gebruiken dezelfde competities in dezelfde
// tier-volgorde (top eerst), zodat "live" precies toont wat ook in de
// dropdown staat.
export const LEAGUES = [
  { key: 'soccer_epl', name: 'Premier League', country: 'England', tier: 'top' },
  { key: 'soccer_spain_la_liga', name: 'La Liga', country: 'Spain', tier: 'top' },
  { key: 'soccer_germany_bundesliga', name: 'Bundesliga', country: 'Germany', tier: 'top' },
  { key: 'soccer_italy_serie_a', name: 'Serie A', country: 'Italy', tier: 'top' },
  { key: 'soccer_france_ligue_one', name: 'Ligue 1', country: 'France', tier: 'top' },
  { key: 'soccer_netherlands_eredivisie', name: 'Eredivisie', country: 'Netherlands', tier: 'top' },
  { key: 'soccer_uefa_champs_league', name: 'Champions League', country: 'Europe', tier: 'top' },
  { key: 'soccer_uefa_europa_league', name: 'Europa League', country: 'Europe', tier: 'top' },

  { key: 'soccer_uefa_europa_conference_league', name: 'Conference League', country: 'Europe', tier: 'other' },
  { key: 'soccer_portugal_primeira_liga', name: 'Primeira Liga', country: 'Portugal', tier: 'other' },
  { key: 'soccer_efl_champ', name: 'Championship', country: 'England', tier: 'other' },
  { key: 'soccer_fa_cup', name: 'FA Cup', country: 'England', tier: 'other' },
  { key: 'soccer_england_efl_cup', name: 'EFL Cup', country: 'England', tier: 'other' },
  { key: 'soccer_spl', name: 'Scottish Premiership', country: 'Scotland', tier: 'other' },
  { key: 'soccer_italy_serie_b', name: 'Serie B', country: 'Italy', tier: 'other' },
  { key: 'soccer_italy_coppa_italia', name: 'Coppa Italia', country: 'Italy', tier: 'other' },
  { key: 'soccer_germany_bundesliga2', name: '2. Bundesliga', country: 'Germany', tier: 'other' },
  { key: 'soccer_germany_dfb_pokal', name: 'DFB Pokal', country: 'Germany', tier: 'other' },
  { key: 'soccer_france_ligue_two', name: 'Ligue 2', country: 'France', tier: 'other' },
  { key: 'soccer_spain_segunda_division', name: 'La Liga 2', country: 'Spain', tier: 'other' },
  { key: 'soccer_spain_copa_del_rey', name: 'Copa del Rey', country: 'Spain', tier: 'other' },
  { key: 'soccer_switzerland_superleague', name: 'Swiss Super League', country: 'Switzerland', tier: 'other' },
  { key: 'soccer_belgium_first_div', name: 'Pro League', country: 'Belgium', tier: 'other' },
  { key: 'soccer_sweden_allsvenskan', name: 'Allsvenskan', country: 'Sweden', tier: 'other' },
  { key: 'soccer_norway_eliteserien', name: 'Eliteserien', country: 'Norway', tier: 'other' },
  { key: 'soccer_usa_mls', name: 'MLS', country: 'USA', tier: 'other' },
  { key: 'soccer_fifa_world_cup', name: 'WK', country: 'International', tier: 'other' },
  { key: 'soccer_uefa_european_championship', name: 'EK', country: 'International', tier: 'other' },
  { key: 'soccer_uefa_nations_league', name: 'UEFA Nations League', country: 'International', tier: 'other' },
  { key: 'soccer_africa_cup_of_nations', name: 'Afrika Cup', country: 'International', tier: 'other' },
  // liveOnly: geen Odds API-competitie; alleen via ESPN (live-tab), dus niet in de dropdown.
  { key: 'soccer_africa_cup_of_nations_qual', name: 'Afrika Cup kwalificatie', country: 'International', tier: 'other', liveOnly: true },
  { key: 'soccer_concacaf_gold_cup', name: 'Gold Cup', country: 'International', tier: 'other' },
  { key: 'soccer_concacaf_gold_cup_qual', name: 'Gold Cup kwalificatie', country: 'International', tier: 'other', liveOnly: true },
  { key: 'soccer_concacaf_nations_league', name: 'CONCACAF Nations League', country: 'International', tier: 'other', liveOnly: true },
];
