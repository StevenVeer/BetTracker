# Bet Tracker

Persoonlijk, single-user dashboard voor voetbalweddenschappen: wat je hebt gezet, bij welke bookmaker, tegen welke odds en inzet, en hoe je ervoor staat. Bets worden (deels) automatisch afgehandeld via live scores, en je kunt ze invoeren met de hand, via een screenshot of via de browserextensie.

Frontend: React + Vite. Backend: Express + Postgres. Alles draait lokaal via Docker Compose.

## Functies

- **Bets** – invoeren (wedstrijd, markt, odds, inzet; ook combi's met meerdere legs), filteren op status, handmatig settelen.
- **Automatische settlement** – op aanvraag haalt de server scores op bij The Odds API en settelt de markten `1x2`, `dubbelkans`, `btts` en `over_under`. Andere markten (bv. `anders`) blijven open voor handmatige settlement.
- **Live scores** – los overzicht van lopende wedstrijden via ESPN's publieke scoreboard-API (gratis, geen key, wel onofficieel), met favorieten en een handmatige koppeling van een wedstrijd aan een live-ID als de automatische match misgrijpt. Klik op een wedstrijd voor een detailpagina met statistieken (balbezit, schoten, corners, passes, kaarten), tijdlijn, opstellingen en een afgeleide druk-grafiek. Pressure, big chances, xG en een shotmap leveren gratis bronnen niet.
- **Geplande bets** – opzetjes zonder inzet; "plaatsen" maakt er een echte bet van.
- **Screenshot-import** – bets uit screenshots van een bookmaker-app halen via de Anthropic API. Het resultaat is alleen een voorstel: je bewerkt en bevestigt het voordat er iets wordt opgeslagen.
- **Browserextensie** (`extension/`) – één klik op een bookmakerpagina stuurt de paginatekst (met een screenshot als terugval) naar de app, die de import-modal opent met de gevonden bets. Zie "Browserextensie installeren".
- **Bookmaker-overzicht** – saldo per bookmaker met ledger: stortingen, opnames en correcties. Een tekort bij het plaatsen van een bet wordt automatisch als storting gelogd.
- **ING-rekening** – eigen kaart en ledger voor je bankrekening, met overboekingen die live worden afgeleid uit de bookmaker-stortingen en -opnames.
- **Overzichten** – resultaat per dag, rendement per markt en een equity curve.
- **Rapporten** – export van afgehandelde picks per periode, plus notities. Het rapport zelf schrijf je op aanvraag met Claude (zie hieronder).

## Starten (Docker, aanbevolen)

```bash
cp .env.example .env
# vul de waarden in .env in (zie "Omgevingsvariabelen")
docker compose up -d --build
```

Open daarna `http://localhost:6070`.

Containers: `bettracker-db-1` (Postgres 16), `bettracker-api-1` (Express, poort 3001 intern) en `bettracker-web-1` (nginx met de gebouwde frontend; proxyt `/api/` naar de API).

Na een wijziging in `server/` of `src/`:

```bash
docker compose build api web && docker compose up -d api web
docker logs bettracker-api-1 --tail 30   # controleer op een schone start
```

## Starten (lokale ontwikkeling zonder Docker)

Vereist een lokaal draaiende Postgres-instantie.

```bash
npm install
npm run dev            # frontend, http://localhost:5173

cd server
npm install
# .env met minimaal DATABASE_URL en ODDS_API_KEY
node index.js          # API, http://localhost:3001
```

## Omgevingsvariabelen

Zie `.env.example`.

| Variabele | Nodig voor |
| --- | --- |
| `POSTGRES_PASSWORD` | Database (verplicht) |
| `ODDS_API_KEY` | Wedstrijden en settlement via The Odds API (verplicht) |
| `ANTHROPIC_API_KEY` | Screenshot- en pagina-import (optioneel; model overschrijfbaar met `ANTHROPIC_MODEL`) |
| `LIVE_SCORES_POLL_MS` | Poll-interval live scores, standaard 20000 ms |

## Browserextensie installeren

1. Ga in Chrome (of Edge/Brave) naar `chrome://extensions` en zet **Ontwikkelaarsmodus** aan.
2. Klik **Uitgepakte extensie laden** en kies de map `extension/`.
3. Zet het groene B-icoon vast in de werkbalk.

Gebruik: open op de site van je bookmaker "Mijn weddenschappen" en klik op het icoon (of druk Alt+Shift+B). De app opent (of hergebruikt een open tab op `localhost:6070`) met de gevonden bets ter controle. Selecteer je eerst een stuk tekst, dan wordt alleen dat meegestuurd. Leest de tekst niets uit, dan valt de app automatisch terug op een screenshot van het zichtbare deel. Met **Via screenshot uitlezen** kun je dat ook zelf doen. Na wijzigingen in `extension/` klik je op het herlaad-icoon bij de extensie in `chrome://extensions`.

## Projectstructuur

```
src/
  App.jsx                    – hoofdscherm: filters, samenvatting, laden/verversen van bets
  api.js                     – fetch-wrapper voor alle /api-endpoints
  markets.js                 – markt-definities en leesbare selectie-labels
  dailyResults.js            – resultaat per dag berekenen
  notifications.js           – browsernotificaties
  components/
    BetForm, BetList, MatchPicker           – bets invoeren en beheren
    PlannedBetForm, PlannedBetsModal        – geplande bets
    ScreenshotImportModal                   – screenshot-import
    OpenBetsModal, LiveScores               – open bets en live scores
    BookmakerOverview                       – bookmaker- en ING-ledger
    Overview, DailyOverview, MarketOverview, EquityCurve  – overzichten
    ReportPanel, Markdown                   – rapporten en notities
    AmountsToggle, NotificationToggle, ToolbarActions     – toolbar
server/
  index.js                   – Express-API: bets, ledger, rapporten, scores, live-koppelingen
  db.js                      – Postgres-pool en schema (ensureSchema)
  leagues.js                 – gedeelde competitielijst
  liveScores.js              – ESPN-poller voor het live-overzicht
  matchDetail.js             – ESPN-detailpagina: statistieken, tijdlijn, opstellingen, druk
  teamMatch.js               – fuzzy teamnaam-matching
  screenshotImport.js        – screenshot/paginatekst → bets via de Anthropic API
  reportGenerator.js         – export voor dag-/weekrapporten
nginx.conf                   – serveert de frontend, proxyt /api/ naar de API
docker-compose.yml           – db, api en web
```

## Database

Het schema staat in `server/db.js` en wordt bij het opstarten van de API automatisch toegepast door `ensureSchema()`. Migraties zijn bewust additief en idempotent (`create table if not exists`, `add column if not exists`), zodat ze veilig tegen de bestaande data kunnen draaien.

## Hoe settlement werkt

Via de knop "Live scores ophalen" haalt de server op aanvraag scores op bij The Odds API (`/scores`) voor alle sporten met open bets op wedstrijden die al zijn afgetrapt, en settelt automatisch wat uit de eindstand af te leiden is. De knop toont het huidige verbruik (`gebruikt/totaal` credits in de lopende periode), zodat je zelf bepaalt wanneer een call het waard is.

Er is geen achtergrond-poller voor de Odds API: dat kostte credits ook als er niemand keek. Alleen het live-overzicht heeft een poller, en die gebruikt ESPN, dat gratis is en geen key of quotum heeft (bij een 429 of 403 pauzeert hij een paar cycli). Het is een onofficiële API: als ESPN iets wijzigt valt alleen de live-tab uit, bets en settlement blijven werken. Het detail-endpoint haalt alleen data op zolang iemand een detailpagina open heeft (15 s server-cache).

## Rapporten

Er is geen ingebouwde rapportgenerator met eigen API-key. De rapportknop exporteert de afgehandelde picks van de gekozen periode als bestand; dat geef je aan Claude om het dag- of weekrapport te laten schrijven. De uitkomst kun je als notitie bewaren. Marktconsensus-odds worden niet opgeslagen, dus "favoriet" in de rapporten is een proxy op basis van je eigen odds.
