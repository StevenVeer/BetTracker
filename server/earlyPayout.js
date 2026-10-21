// Vroege uitbetaling (early payout, bv. "2UP"): de bookmaker betaalt al uit
// zodra je team een marge voorstaat. Op de slip staat dat in de markttekst
// ("Resultaat - Vroege uitbetaling: Napoli", "IJsland wint (vroege
// uitbetaling)"); in de tracker is het een vlag op de leg (early_payout) en
// halen we de tekst eruit, zodat de selectie gewoon "Resultaat: Napoli" leest.
const EP = String.raw`(?:vroege|vroegtijdige)\s+uit-?betaling|early\s+pay-?out`;
const EP_TEST = new RegExp(EP, 'i');

export function hasEarlyPayoutText(text) {
  return EP_TEST.test(String(text || ''));
}

export function stripEarlyPayoutText(text) {
  return String(text || '')
    // "IJsland wint (vroege uitbetaling)"
    .replace(new RegExp(String.raw`\s*\(\s*(?:${EP})[^)]*\)`, 'gi'), '')
    // "Resultaat - Vroege uitbetaling: X", "Reguliere Speeltijd - Vroege Uitbetaling (2UP): X"
    .replace(new RegExp(String.raw`\s*[-–—|]\s*(?:${EP})(?:\s*\([^)]*\))?`, 'gi'), '')
    // "Vroege uitbetaling: X" / "Vroege uitbetaling - X" vooraan
    .replace(new RegExp(String.raw`^\s*(?:${EP})(?:\s*\([^)]*\))?\s*[:\-–—]\s*`, 'i'), '')
    // Restjes elders in de tekst
    .replace(new RegExp(String.raw`\s*(?:${EP})(?:\s*\([^)]*\))?`, 'gi'), '')
    .replace(/\s+:/g, ':')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Leg uit de client of de import: tekst opschonen en de vlag zetten als de
// tekst het noemde (of de client hem al expliciet meestuurde).
export function applyEarlyPayout(leg) {
  const parts = Array.isArray(leg.parts) ? leg.parts : null;
  const mentioned = hasEarlyPayoutText(leg.selection) || (parts || []).some((p) => hasEarlyPayoutText(p?.market) || hasEarlyPayoutText(p?.pick));
  return {
    ...leg,
    selection: stripEarlyPayoutText(leg.selection) || leg.selection,
    parts: parts ? parts.map((p) => ({ ...p, market: p?.market ? stripEarlyPayoutText(p.market) || null : p?.market, pick: stripEarlyPayoutText(p?.pick) || p?.pick })) : leg.parts,
    earlyPayout: Boolean(leg.earlyPayout) || mentioned,
  };
}
