// Indeling van picks in markten voor het marktoverzicht.
//
// Het overgrote deel van de legs is via screenshot-import binnengekomen als
// market 'anders' met de letterlijke bookmakertekst ("Reguliere Speeltijd:
// Roma", "Totaal Aantal Doelpunten door Como: Meer dan 1.5", ...). Hier
// leiden we uit die tekst alsnog de echte markt af - alléén voor weergave.
// bet_legs.market blijft ongemoeid: daarop beslist de settlement of een leg
// automatisch afgehandeld kan worden, en een vrije-tekst-selectie als
// 'team_wint' opslaan zou die settlement laten ontsporen.
//
// Bet builders (parts) en tekst-combi's ("X + Y", "X & Y", "X EN Y") worden
// opgesplitst: elk onderdeel telt in zijn eigen markt.
import { teamNamesMatch, teamNameSimilarity } from './teamMatch.js';

export const MARKET_LABELS = {
  team_wint: 'Team wint',
  dubbelkans: 'Dubbele kans',
  btts: 'Beide teams scoren',
  over_under: 'Over/onder doelpunten',
  team_totals: 'Team totals',
  handicap: 'Handicap',
  correct_score: 'Correcte score',
  speler_scoort: 'Speler scoort',
  speler_schoten: 'Speler schoten op doel',
  speler_assist: 'Speler assist',
  anders: 'Anders',
};

export const isCategory = (value) => typeof value === 'string' && Object.hasOwn(MARKET_LABELS, value);

const NUM = String.raw`(\d+(?:[.,]\d+)?)`;
const toNum = (s) => Number(String(s).replace(',', '.'));
const fmtLine = (n) => (Number.isInteger(n) ? n.toFixed(1) : String(n));

function clean(text) {
  return String(text || '')
    .replace(/\s*\(bet ?builder\)\s*$/i, '')
    .replace(/^bet ?builder:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// 'home' / 'away' / null - welke kant van de wedstrijd deze naam is.
function sideOf(name, match, { loose = true } = {}) {
  if (!name || !match) return null;
  const n = name.trim();
  if (!n) return null;
  if (match.home && teamNamesMatch(n, match.home)) return 'home';
  if (match.away && teamNamesMatch(n, match.away)) return 'away';
  if (!loose) return null;
  // Ruimer dan teamNamesMatch (tikfouten als "Arsnel", "Lillestrom" vs
  // "Lillestrøm") - mag hier, het is alleen weergave, er settelt niets op.
  const h = match.home ? teamNameSimilarity(n, match.home) : 0;
  const a = match.away ? teamNameSimilarity(n, match.away) : 0;
  if (Math.max(h, a) >= 0.5 && h !== a) return h > a ? 'home' : 'away';
  return null;
}

// Over/onder-richting + lijn. Kijkt eerst na de laatste ':' (daar staat bij
// "Aantal Goals - Over/Under 2.5: Under 2.5" de echte keuze), dan in het geheel.
function parseOverUnder(t) {
  const re = new RegExp(String.raw`(?:^|[\s(:])(meer dan|minder dan|over|onder|under|o|u)\s*\(?${NUM}`, 'i');
  const segments = t.includes(':') ? [t.slice(t.lastIndexOf(':') + 1), t] : [t];
  for (const seg of segments) {
    const m = seg.match(re);
    if (m) {
      const word = m[1].toLowerCase();
      const dir = ['meer dan', 'over', 'o'].includes(word) ? 'over' : 'under';
      return { dir, line: toNum(m[2]) };
    }
  }
  return null;
}

const ouLabel = (ou) => `${ou.dir === 'over' ? 'Over' : 'Onder'} ${fmtLine(ou.line)}`;
const GENERIC_PREFIX = /totaal|doelpunt|goals|doelen|wedstrijd|over\/under|^teams?$|^aantal/i;

// Team-naam bij een team-total, of null als het om de hele wedstrijd gaat.
// explicit = de tekst zegt zelf dat het om team-doelpunten gaat; anders is
// het alleen "naam + over/onder" en kan de naam ook een speler zijn.
function teamTotalName(t) {
  let m;
  const explicit = (name) => ({ name, explicit: true });
  if ((m = t.match(/doelpunten (?:door|voor) (.+?)(?::|$)/i))) return explicit(m[1]);
  if ((m = t.match(/team - totaal aantal doelpunten:\s*(.+?)\s+-\s/i))) return explicit(m[1]);
  if ((m = t.match(/^(.+?)\s+(?:totaal aantal doelpunten|aantal goals)\b/i)) && !GENERIC_PREFIX.test(m[1])) return explicit(m[1]);
  if ((m = t.match(/^over\/under (?!total)(.+?) total goals/i))) return explicit(m[1]);
  if ((m = t.match(/\(([^)\d]+)\)\s*$/))) return { name: m[1].replace(/team - totaal.*/i, '').trim() || m[1], explicit: /team/i.test(m[1]) };
  if ((m = t.match(/^(.+?) to score$/i))) return { name: m[1], explicit: false };
  if ((m = t.match(/^(.+?)(?:\s*[-:]\s*|\s+)(?:meer dan|minder dan|over|onder|under|o)\s*\(?\d/i)) && !GENERIC_PREFIX.test(m[1])) {
    return { name: m[1], explicit: /doelpunt/i.test(t) };
  }
  return null;
}

function playerKey(name, fallback) {
  const n = String(name || '').replace(/\s+/g, ' ').trim();
  return n ? { key: n.toLowerCase(), label: n } : { key: fallback.toLowerCase(), label: fallback };
}

function playerFromScorer(t) {
  let m;
  if ((m = t.match(/(?:scoort|doelpuntenmaker|speler scoort)[^:]*:\s*(.+?)(?:\s+-\s+(?:ja|nee))?$/i))) return m[1];
  if ((m = t.match(/^(.+?)\s+scoort\b/i))) return m[1];
  if ((m = t.match(/^([^:]+?)\s+-\s+(?:meer|minder) dan/i))) return m[1];
  return null;
}

function playerFromShots(t) {
  let m;
  if ((m = t.match(/\):\s*(.+?)\s*[-:]\s*(?:meer|minder) dan/i))) return m[1];
  if ((m = t.match(/schoten op doel:\s*(.+?):\s*\d\+/i))) return m[1];
  if ((m = t.match(/^schoten\s+(.+?):/i))) return m[1];
  if ((m = t.match(/^(.+?)\s*:?\s+(?:-\s+meer dan [\d.]+\s+schoten|\d\+ schot|aantal schoten)/i))) return m[1];
  // Handmatig ingedeeld "Christopher Nkunku - Meer dan 0.5"
  if ((m = t.match(/^([^:]+?)\s+-\s+(?:meer|minder) dan/i))) return m[1];
  if ((m = t.match(/(?:-|:)\s*([^:-]+)$/)) && !/^(meer|minder) dan|^\d/i.test(m[1].trim())) return m[1];
  return null;
}

function playerFromAssist(t) {
  let m;
  if ((m = t.match(/\):\s*(.+?)\s+-\s+(?:ja|nee)$/i))) return m[1];
  if ((m = t.match(/assists?:\s*(.+)$/i))) return m[1];
  if ((m = t.match(/^([^:]+?)\s+-\s+(?:meer|minder) dan/i))) return m[1];
  return null;
}

const res = (market, key, label) => ({ market, key, label });

// Eén (losse) tekstselectie → { market, key, label }.
export function classifyText(rawText, match) {
  const text = clean(rawText);
  const t = text.toLowerCase();
  if (!t) return res('anders', '', '(leeg)');

  // Spelers
  if (/assist/.test(t)) {
    const p = playerKey(playerFromAssist(text), text);
    return res('speler_assist', p.key, p.label);
  }
  if (/\bschot(en)?\b|kopbal/.test(t)) {
    // Teamschoten ("Totaal aantal schoten op doel door X", "Nederland Over
    // 3.5 schoten op doel") en "beiden 1+ schot" zijn geen spelermarkt.
    if (/schoten op doel door|team|^beiden|\bover [\d.,]+ schoten/.test(t)) return res('anders', t, text);
    const p = playerKey(playerFromShots(text), text);
    return res('speler_schoten', p.key, p.label);
  }
  if (/reddingen|gp-winnaar|gevaarlijke aanval|volgende ronde|beide helften|alle teams winnen|^teams over|min\.\/max\.|rust\/eind/.test(t)) {
    return res('anders', t, text);
  }
  if (/\bscoort\b|doelpuntenmaker|speler scoort/.test(t)) {
    const p = playerKey(playerFromScorer(text), text);
    return res('speler_scoort', p.key, p.label);
  }

  // Wedstrijdmarkten
  if (/beide teams scoren|both teams to score/.test(t)) {
    return /\b(nee|no)\b/.test(t) ? res('btts', 'no', 'Nee') : res('btts', 'yes', 'Ja');
  }
  if (/dubbele kans|double chance|\bof gelijk|gelijkspel of|\/draw/.test(t)) {
    let team = null;
    let m;
    if ((m = text.match(/(?:kans|chance):\s*(.+?)(?:\s+of gelijk\w*|\/draw)$/i)) || (m = text.match(/^(.+?)\s+of gelijk/i))) team = m[1];
    else if ((m = text.match(/gelijkspel of (.+)$/i))) team = m[1];
    if (team && /^1$/.test(team.trim())) return res('dubbelkans', 'home_draw', 'Thuis of gelijk');
    const side = sideOf(team, match);
    if (side === 'home') return res('dubbelkans', 'home_draw', 'Thuis of gelijk');
    if (side === 'away') return res('dubbelkans', 'draw_away', 'Gelijk of uit');
    return res('dubbelkans', 'team_draw', 'Team of gelijk (thuis/uit onbekend)');
  }
  if (/draw no bet/.test(t)) return res('handicap', 'dnb', 'Draw no bet');
  if (/3-way handicap/.test(t)) return res('handicap', '3way', '3-weg handicap');
  if (/handicap/.test(t) || new RegExp(String.raw`^[^:]+\s[+-]${NUM}$`).test(t)) {
    const m = text.match(new RegExp(String.raw`([+-])${NUM}(?!.*[+-]\d)`));
    if (m) {
      const label = `Handicap ${m[1]}${fmtLine(toNum(m[2]))}`;
      return res('handicap', label.toLowerCase(), label);
    }
    return res('handicap', 'overig', 'Handicap (overig)');
  }

  const ou = parseOverUnder(text);
  if (ou || /\bto score$/.test(t)) {
    const team = teamTotalName(text);
    if (team) {
      // Een naam die niet bij de wedstrijd hoort is waarschijnlijk een speler
      // ("Christopher Nkunku - Meer dan 0.5"): dat zeggen we niet te weten.
      if (!team.explicit && match && !sideOf(team.name, match)) return res('anders', t, text);
      const tou = ou || { dir: 'over', line: 0.5 };
      return res('team_totals', `${tou.dir}:${tou.line}`, ouLabel(tou));
    }
    if (ou) return res('over_under', `${ou.dir}:${ou.line}`, ouLabel(ou));
  }

  if (/eindresultaat|reguliere speeltijd|resultaat|full time result|match result|wedstrijdresultaat|\bwint\b/.test(t)) {
    let m;
    let team = null;
    if ((m = text.match(/:\s*(.+)$/)) && !/full time result$/i.test(text)) team = m[1];
    else if ((m = text.match(/^(.+?)(?:\s+wint\b|\s*[-:]\s*(?:eindresultaat|full time result))/i))) team = m[1];
    if (team && /^gelijk(spel)?$/i.test(team.trim())) return res('team_wint', 'draw', 'Gelijkspel');
    const side = sideOf(team, match);
    if (side === 'home') return res('team_wint', 'home', 'Thuis wint');
    if (side === 'away') return res('team_wint', 'away', 'Uit wint');
    return res('team_wint', 'team', 'Team wint (thuis/uit onbekend)');
  }

  // Alleen een teamnaam die bij de wedstrijd hoort ("Atalanta"): winnaar.
  const bareSide = sideOf(text, match, { loose: false });
  if (bareSide) return res('team_wint', bareSide, bareSide === 'home' ? 'Thuis wint' : 'Uit wint');

  return res('anders', t, text);
}

// Tekst met een vaststaande categorie (gekozen bij import of handmatig).
// Komt de tekstherkenning op dezelfde markt uit, dan nemen we die groepering
// over; anders groeperen we binnen de gekozen markt zo goed als het gaat.
export function classifyAs(category, rawText, match) {
  const guess = classifyText(rawText, match);
  if (guess.market === category) return guess;
  const text = clean(rawText);
  const ou = parseOverUnder(text);
  switch (category) {
    case 'speler_scoort': {
      const p = playerKey(playerFromScorer(text), text);
      return res(category, p.key, p.label);
    }
    case 'speler_schoten': {
      const p = playerKey(playerFromShots(text), text);
      return res(category, p.key, p.label);
    }
    case 'speler_assist': {
      const p = playerKey(playerFromAssist(text), text);
      return res(category, p.key, p.label);
    }
    case 'over_under':
    case 'team_totals':
      return ou ? res(category, `${ou.dir}:${ou.line}`, ouLabel(ou)) : res(category, text.toLowerCase(), text);
    case 'btts':
      return /\b(nee|no)\b/i.test(text) ? res(category, 'no', 'Nee') : res(category, 'yes', 'Ja');
    case 'team_wint':
      return res(category, 'team', 'Team wint (thuis/uit onbekend)');
    case 'dubbelkans':
      return res(category, 'team_draw', 'Team of gelijk (thuis/uit onbekend)');
    default:
      return res(category, text.toLowerCase(), text);
  }
}

const STRUCTURED_LABELS = {
  team_wint: { home: 'Thuis wint', away: 'Uit wint', draw: 'Gelijkspel' },
  dubbelkans: { home_draw: 'Thuis of gelijk', home_away: 'Thuis of uit', draw_away: 'Gelijk of uit' },
  btts: { yes: 'Ja', no: 'Nee' },
};

// Een leg met een vaste markt (niet 'anders').
function classifyStructured(leg) {
  const { market, selection } = leg;
  const line = leg.line !== null && leg.line !== undefined ? Number(leg.line) : null;
  if (market === 'over_under' && line !== null) {
    const ou = { dir: selection === 'over' ? 'over' : 'under', line };
    return res('over_under', `${ou.dir}:${ou.line}`, ouLabel(ou));
  }
  if (market === 'handicap' && line !== null) {
    const label = `Handicap ${line > 0 ? '+' : ''}${fmtLine(line)}`;
    return res('handicap', label.toLowerCase(), label);
  }
  return res(market, selection, STRUCTURED_LABELS[market]?.[selection] || selection);
}

// Splitst "X + Y", "X & Y", "X EN Y" alleen als minstens één stuk een echte
// markt oplevert én elk overig stuk zelf een selectie lijkt (bevat een
// getal, zoals "Nederland Over 3.5 schoten op doel"). Zo blijven namen ("St
// Vincent & The Grenadines", "Turks- & Caicoseilanden") en opsommingen
// ("Barcelona, Bayern & Inter Milan") heel.
function splitTextCombo(text, match) {
  const pieces = clean(text).split(/\s+(?:\+|&|EN)\s+/);
  if (pieces.length < 2 || pieces.some((p) => /-$/.test(p) || !p.trim())) return null;
  const classified = pieces.map((p) => ({ text: p, ...classifyText(p, match) }));
  const real = classified.filter((c) => c.market !== 'anders');
  const restLooksLikePick = classified.every((c) => c.market !== 'anders' || /\d/.test(c.text));
  return real.length >= 1 && restLooksLikePick ? classified : null;
}

// Eén leg → de onderdelen waarmee hij in het marktoverzicht meetelt:
// [{ market, key, label, status, priced, pickText, edit }]. Alleen afgeronde
// (won/lost) onderdelen komen terug. Een losse leg is "priced" (eigen odds,
// telt mee in de yield); onderdelen van een bet builder of tekst-combi niet,
// want daar is alleen de gezamenlijke odd bekend.
// edit beschrijft wat je handmatig kunt aanpassen: de categorie van de leg of
// van één bet builder-onderdeel (partIndex), en de titel als dat vrije tekst
// is. Een vaste categorie (leg.category / part.category) wint altijd van de
// tekstherkenning; een tekst-combi met een vaste categorie splitst niet meer.
export function legPieces(leg) {
  const classify = (category, text) => (isCategory(category) ? classifyAs(category, text, leg.match) : classifyText(text, leg.match));
  const legDecided = leg.status === 'won' || leg.status === 'lost';

  // Status van een onderdeel zonder eigen uitslag: in een gewonnen leg moet
  // elk onderdeel gewonnen zijn; in een verloren leg weten we het niet.
  const pieceStatus = (own) => {
    if (own === 'won' || own === 'lost') return own;
    if (own === 'void') return null;
    return leg.status === 'won' ? 'won' : null;
  };

  if (Array.isArray(leg.parts) && leg.parts.length > 1) {
    return leg.parts
      .map((part, partIndex) => {
        const txt = part.market ? `${part.market}: ${part.pick}` : part.pick;
        const c = classify(part.category, txt);
        return {
          ...c,
          status: pieceStatus(part.status),
          priced: false,
          pickText: clean(txt),
          edit: { legId: leg.id, partIndex, category: c.market, title: clean(txt), titleEditable: true },
        };
      })
      .filter((p) => p.status);
  }

  if (!legDecided) return [];

  if (leg.market !== 'anders') {
    const c = isCategory(leg.category) ? classifyAs(leg.category, leg.selection, leg.match) : classifyStructured(leg);
    return [
      {
        ...c,
        status: leg.status,
        priced: true,
        pickText: leg.selection,
        // Een vaste markt heeft een selectie-sleutel ('home', 'over'), geen titel.
        edit: { legId: leg.id, partIndex: null, category: c.market, title: leg.selection, titleEditable: false },
      },
    ];
  }

  const legEdit = (category) => ({ legId: leg.id, partIndex: null, category, title: clean(leg.selection), titleEditable: true });

  const combo = !isCategory(leg.category) && splitTextCombo(leg.selection, leg.match);
  if (combo) {
    return combo
      .map((c) => ({
        market: c.market,
        key: c.key,
        label: c.label,
        status: pieceStatus(null),
        priced: false,
        pickText: c.text,
        // Aanpassen geldt voor de hele leg (en houdt het splitsen op).
        edit: { ...legEdit(c.market), wholeLeg: true },
      }))
      .filter((p) => p.status);
  }

  const c = classify(leg.category, leg.selection);
  return [{ ...c, status: leg.status, priced: true, pickText: clean(leg.selection), edit: legEdit(c.market) }];
}
