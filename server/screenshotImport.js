// Bets uit screenshots van een bookmaker-app/-site halen via de Anthropic
// Messages API (vision). De uitkomst is alleen een voorstel: de frontend toont
// het als bewerkbare preview en niets wordt opgeslagen voor de gebruiker het
// bevestigt.

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const ALLOWED_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const EXTRACT_TOOL = {
  name: 'register_bets',
  description: 'Registreer alle weddenschappen (bet slips) die op de screenshots te zien zijn.',
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
            payout: { type: ['number', 'null'], description: 'Werkelijke uitbetaling of cash-out bedrag in euro, alleen als zichtbaar. Anders null.' },
            placedAt: { type: ['string', 'null'], description: 'Moment van plaatsen als ISO 8601 datum(-tijd) inclusief jaar, alleen als zichtbaar. Anders null.' },
            settledAt: { type: ['string', 'null'], description: 'Moment van afhandeling als ISO 8601, alleen als zichtbaar. Anders null.' },
            legs: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  home: { type: ['string', 'null'], description: 'Thuisteam/speler 1.' },
                  away: { type: ['string', 'null'], description: 'Uitteam/speler 2.' },
                  selection: { type: 'string', description: 'De gekozen uitkomst in het Nederlands, kort, bv. "Ajax wint", "Over 2.5 doelpunten", "Beide teams scoren: Ja", "Feyenoord of gelijk".' },
                  odds: { type: ['number', 'null'], description: 'Odds van deze selectie.' },
                },
                required: ['selection'],
              },
            },
          },
          required: ['status', 'legs'],
        },
      },
    },
    required: ['bets'],
  },
};

const SYSTEM_PROMPT = `Je leest screenshots van weddenschappen bij (Nederlandse) bookmakers en zet ze om naar gestructureerde data.
- Elke bet slip is één bet; een combi heeft meerdere legs, een single precies één.
- Verzin niets: als een waarde niet zichtbaar is, geef je null. Gok geen bookmaker.
- Staat dezelfde bet op meerdere screenshots (overlap), registreer hem dan één keer.
- Lees bedragen en odds exact over (decimale odds, punt als scheidingsteken).
- De huidige datum is ${new Date().toISOString().slice(0, 10)}; gebruik die om een jaar af te leiden als alleen dag/maand zichtbaar is.
Roep altijd de tool register_bets aan.`;

export async function extractBetsFromImages(images) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw Object.assign(new Error('ANTHROPIC_API_KEY ontbreekt op de server'), { status: 503 });
  if (!Array.isArray(images) || images.length === 0) {
    throw Object.assign(new Error('Geen afbeeldingen meegegeven'), { status: 400 });
  }

  const content = [];
  for (const image of images) {
    const mediaType = ALLOWED_MEDIA_TYPES.has(image?.mediaType) ? image.mediaType : null;
    if (!mediaType || typeof image.data !== 'string') {
      throw Object.assign(new Error('Ongeldige afbeelding (alleen jpeg/png/webp/gif)'), { status: 400 });
    }
    content.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: image.data } });
  }
  content.push({ type: 'text', text: 'Haal alle bets uit deze screenshot(s).' });

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
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
  return Array.isArray(toolUse?.input?.bets) ? toolUse.input.bets : [];
}
