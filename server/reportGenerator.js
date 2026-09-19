// Dag-/weekrapport (fase 2) - op aanvraag, zonder eigen Anthropic API-key:
// de knop exporteert alleen de afgehandelde picks uit de gekozen periode als
// bestand. Dat bestand geef je aan Claude (deze sessie, al gedekt door het
// Pro/Code-abonnement) om het rapport te laten schrijven - geen aparte
// API-billing nodig voor dit stukje.
// Geen marktconsensus-odds opgeslagen (alleen de eigen inzet-odds), dus
// "favoriet" hieronder is een expliciet benoemde proxy op basis daarvan -
// niet de echte implied probability van de markt.

function favoriteBucket(odds) {
  if (odds < 1.3) return 'zware favoriet (odds <1.30)';
  if (odds < 1.6) return 'kleine favoriet (1.30-1.59)';
  if (odds < 2.2) return 'ongeveer gelijk (1.60-2.19)';
  return 'underdog (odds >=2.20)';
}

// Thuis/uit is alleen eenduidig voor markten waar de selectie zelf een kant
// kiest (team_wint, handicap) - dubbelkans/btts/over_under/anders/correct_score
// laten we bewust null, dan verzint niemand achteraf een kant die er niet is.
function favoriteSide(market, selection) {
  if (market === 'team_wint' || market === 'handicap') {
    if (selection === 'home') return 'thuis';
    if (selection === 'away') return 'uit';
  }
  return null;
}

// Elke bet blijft een eigen entry met een eigen legs-array, ook als er meerdere
// bets bij dezelfde bookmaker in de periode vallen - anders is achteraf (in de
// platte lijst) niet meer te zien welke picks daadwerkelijk samen 1 combi
// vormden en welke toevallig alleen dezelfde bookmaker/dag deelden.
function buildBets(bets) {
  return bets
    .map((bet) => {
      const legs = bet.legs.filter((leg) => leg.status === 'won' || leg.status === 'lost' || leg.status === 'void');
      return {
        betId: bet.id,
        bookmaker: bet.bookmaker,
        combi: legs.length > 1,
        inzet: Number(bet.stake),
        uitslag: bet.status,
        legs: legs.map((leg) => ({
          wedstrijd: leg.match ? `${leg.match.home} - ${leg.match.away}` : leg.manualLabel || 'Handmatig',
          markt: leg.market,
          selectie: leg.selection,
          kant: favoriteSide(leg.market, leg.selection),
          odds: Number(leg.odds),
          favoriet: favoriteBucket(Number(leg.odds)),
          uitslag: leg.status,
        })),
      };
    })
    .filter((bet) => bet.legs.length > 0);
}

export function buildReportExport({ period, source, bets: rawBets }) {
  const bets = buildBets(rawBets);
  const pickCount = bets.reduce((sum, bet) => sum + bet.legs.length, 0);
  return {
    period,
    source,
    generatedAt: new Date().toISOString(),
    betCount: bets.length,
    pickCount,
    bets,
  };
}
