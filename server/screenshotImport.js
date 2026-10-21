// Bets uit screenshots of uit de tekst van een bookmakerpagina (via de
// browserextensie) halen via de Anthropic Messages API. De uitkomst is alleen een voorstel: de frontend toont
// het als bewerkbare preview en niets wordt opgeslagen voor de gebruiker het
// bevestigt.

import { applyEarlyPayout } from './earlyPayout.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const ALLOWED_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const EXTRACT_TOOL = {
  name: 'register_bets',
  description: 'Registreer alle weddenschappen (bet slips) die op de screenshots of in de paginatekst staan.',
  input_schema: {
    type: 'object',
    properties: {
      bets: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            bookmaker: { type: ['string', 'null'], description: 'Naam van de bookmaker, alleen als die zichtbaar is (logo/naam/UI-stijl), anders null.' },
            stake: { type: ['number', 'null'], description: 'Inzet in euro.' },
            odds: { type: ['number', 'null'], description: 'Totale odds (bij een combi de gecombineerde odds; bij een single de odds van de selectie).' },
            status: { type: 'string', enum: ['open', 'won', 'lost', 'void', 'cashed_out'], description: 'open als nog niet afgehandeld.' },
            payout: { type: ['number', 'null'], description: 'Totaal uitbetaalbedrag in euro INCLUSIEF inzet: bij een open bet de mogelijke uitbetaling/potentiële winst ("Mogelijke uitbetaling", "Potential payout", "Te winnen", het bedrag achter een pijl → of het totaalbedrag onder de odds), bij een gewonnen bet de werkelijke uitbetaling, bij cash-out het cash-out bedrag. Is alleen de winst zonder inzet zichtbaar, tel de inzet erbij op. Anders null (ook bij een verloren bet).' },
            placedAt: { type: ['string', 'null'], description: 'Moment van plaatsen als lokale Nederlandse tijd "YYYY-MM-DDTHH:mm" zonder tijdzone, inclusief jaar en altijd met de tijd als die zichtbaar is (bv. "3 Okt 2026 • 16:00" → "2026-10-03T16:00"). Alleen als zichtbaar, anders null.' },
            settledAt: { type: ['string', 'null'], description: 'Moment van afhandeling als lokale Nederlandse tijd "YYYY-MM-DDTHH:mm" zonder tijdzone, alleen als expliciet zichtbaar (niet de aftrap). Anders null.' },
            couponId: { type: ['string', 'null'], description: 'Coupon-/ticket-/referentienummer van de bet, alleen als zichtbaar. Anders null.' },
            note: { type: ['string', 'null'], description: 'Korte opmerking alleen als iets afgeleid of onzeker is (bv. "odds leg 3 afgeleid uit totaal", "boost: odds per leg niet zichtbaar"). Anders null.' },
            legs: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  home: { type: ['string', 'null'], description: 'Thuisteam/speler 1.' },
                  away: { type: ['string', 'null'], description: 'Uitteam/speler 2.' },
                  selection: { type: 'string', description: 'De gekozen uitkomst letterlijk zoals op de slip, inclusief markt en teamnaam (bv. "Reguliere speeltijd: Engeland", "Eerste doelpuntenmaker: Harry Kane", "Beide teams scoren: Ja"). Niet herformuleren of vertalen, zodat er nooit een verkeerd team in komt; alleen vertalen als de slip niet in het Nederlands is.' },
                  odds: { type: ['number', 'null'], description: 'Odds van deze selectie (bij een bet builder de gezamenlijke odd).' },
                  parts: {
                    type: ['array', 'null'],
                    description: 'Alleen bij een bet builder (meerdere selecties op deze wedstrijd met één gezamenlijke odd): de losse onderdelen, in de volgorde van de slip. Anders null.',
                    items: {
                      type: 'object',
                      properties: {
                        market: { type: ['string', 'null'], description: 'De markt letterlijk zoals op de slip (bv. "Aantal Goals - Over/Under 2.5", "Beide Teams Scoren"), of null als alleen de keuze zichtbaar is.' },
                        pick: { type: 'string', description: 'De gekozen uitkomst letterlijk zoals op de slip (bv. "Over 2.5", "Ja").' },
                      },
                      required: ['pick'],
                    },
                  },
                  kickoffAt: { type: ['string', 'null'], description: 'Aftrap (datum + tijd) van deze wedstrijd als lokale Nederlandse tijd "YYYY-MM-DDTHH:mm" zonder tijdzone, alleen als zichtbaar op de slip. Anders null.' },
                },
                required: ['selection'],
              },
            },
          },
          required: ['status', 'legs'],
        },
      },
      skippedKnown: { type: 'integer', description: 'Aantal bets op de pagina dat is overgeslagen omdat het al in de lijst met bekende bets stond.' },
    },
    required: ['bets'],
  },
};

const SYSTEM_PROMPT = `Je leest screenshots of de platte tekst van een pagina met weddenschappen bij (Nederlandse) bookmakers en zet ze om naar gestructureerde data.
- Elke bet slip is één bet; een combi heeft meerdere legs, een single precies één.
- Verzin niets: als een waarde niet zichtbaar is, geef je null. Gok geen bookmaker.
- Staat dezelfde bet op meerdere screenshots (overlap), registreer hem dan één keer.
- Paginatekst bevat ook menu's, promoties, wedstrijdaanbod en odds die niet gespeeld zijn: registreer alleen geplaatste bets (met een inzet), geen losse odds uit het aanbod of een lege betslip.
- Bet builder / meerdere selecties op dezelfde wedstrijd met alleen een gezamenlijke odd: maak daar één leg van met de gezamenlijke odd als odds, en zet de losse onderdelen (markt + keuze) in parts. Zet in selection dan alleen "Bet builder". Ook binnen een combi is een bet builder één leg.
- Ontbreekt in een combi precies één leg-odd en is er geen boost, leid die dan af als totale odds gedeeld door het product van de andere legs (2 decimalen) en zet dat in note. Bij een boost (totaal hoger dan het product) of als meer odds ontbreken: laat ze null.
- Krijg je een lijst met bekende bets, sla die dan over: registreer ze niet (ook niet als de status inmiddels veranderd is) en tel ze in skippedKnown. Een bet is bekend als het coupon-nummer overeenkomt, of anders inzet + totale odds + wedstrijden.
- Vul payout altijd in zodra er een uitbetaal-/te-winnen-bedrag zichtbaar is, ook bij een bet die nog open staat.
- Lees bedragen en odds exact over (decimale odds, punt als scheidingsteken).
- De huidige datum is ${new Date().toISOString().slice(0, 10)}; gebruik die om een jaar af te leiden als alleen dag/maand zichtbaar is.
Roep altijd de tool register_bets aan.`;

function inputError(message) {
  return Object.assign(new Error(message), { status: 400 });
}

// known: compacte regels met bets die al in de tracker staan, zodat het model
// die overslaat - dat scheelt output-tokens bij een lange historiepagina.
function knownBlock(known) {
  if (!known?.length) return [];
  return [{ type: 'text', text: `Bekende bets (staan al in de tracker, overslaan):\n${known.join('\n')}` }];
}

export async function extractBetsFromImages(images, { known } = {}) {
  if (!Array.isArray(images) || images.length === 0) throw inputError('Geen afbeeldingen meegegeven');

  const content = [];
  for (const image of images) {
    const mediaType = ALLOWED_MEDIA_TYPES.has(image?.mediaType) ? image.mediaType : null;
    if (!mediaType || typeof image.data !== 'string') throw inputError('Ongeldige afbeelding (alleen jpeg/png/webp/gif)');
    content.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: image.data } });
  }
  content.push(...knownBlock(known), { type: 'text', text: 'Haal alle bets uit deze screenshot(s).' });
  return runExtraction(content);
}

// Paginatekst (document.body.innerText) is meestal nauwkeuriger en goedkoper
// dan een screenshot en bevat ook wat buiten beeld gescrold staat. Erg lange
// pagina's (oneindig scrollende historie) kappen we af.
const MAX_PAGE_TEXT = 60000;

export async function extractBetsFromText(text, { url, title, known } = {}) {
  if (typeof text !== 'string' || !text.trim()) throw inputError('Geen paginatekst meegegeven');
  const header = [url && `URL: ${url}`, title && `Titel: ${title}`].filter(Boolean).join('\n');
  const content = [
    ...knownBlock(known),
    {
      type: 'text',
      text: `Haal alle geplaatste bets uit deze tekst van een bookmakerpagina.
${header}

<pagina>
${text.slice(0, MAX_PAGE_TEXT)}
</pagina>`,
    },
  ];
  return runExtraction(content);
}

async function runExtraction(content) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw Object.assign(new Error('ANTHROPIC_API_KEY ontbreekt op de server'), { status: 503 });

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL,
      // Een pagina met bet-historie kan tientallen slips bevatten.
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      tools: [EXTRACT_TOOL],
      tool_choice: { type: 'tool', name: EXTRACT_TOOL.name },
      messages: [{ role: 'user', content }],
    }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.error?.message || `status ${response.status}`;
    throw Object.assign(new Error(`Anthropic API: ${detail}`), { status: 502 });
  }
  const toolUse = data?.content?.find((block) => block.type === 'tool_use');
  // Het model levert `bets` soms als JSON-tekst i.p.v. als echte array (en
  // soms zelfs met de {bets: [...]} wrapper erbij); dat vangen we hier op.
  let bets = toolUse?.input?.bets;
  if (typeof bets === 'string') {
    try {
      bets = JSON.parse(bets);
    } catch {
      bets = [];
    }
  }
  if (bets && !Array.isArray(bets) && Array.isArray(bets.bets)) bets = bets.bets;
  // "Vroege uitbetaling" uit de tekst halen en als vlag op de leg zetten, zodat
  // de preview in de importmodal al de EP-markering toont.
  const cleaned = (Array.isArray(bets) ? bets : []).map((bet) => ({
    ...bet,
    legs: Array.isArray(bet?.legs) ? bet.legs.map((leg) => applyEarlyPayout(leg || {})) : bet?.legs,
  }));
  return { bets: cleaned, skippedKnown: Number(toolUse?.input?.skippedKnown) || 0 };
}
