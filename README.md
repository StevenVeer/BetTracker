# Bet Tracker

Persoonlijk dashboard voor je voetbalweddenschappen: welke wedstrijd, welke bookmaker, welke odds/inzet, en straks automatisch of die gewonnen of verloren is via live scores.

Fase 0 + 1 van de [blauwdruk](../SoccerPicks): projectskelet, databaseschema, en een dashboard met handmatige invoer + automatische settlement zodra een wedstrijd afgelopen is. De bookmarklets per bookmaker (Bet365, BetCity, Toto, Unibet, 711, BetMGM) volgen in fase 3.

## Starten (Docker, aanbevolen)

```bash
cp .env.example .env
# vul POSTGRES_PASSWORD en ODDS_API_KEY in .env in
docker compose up -d --build
```

Open daarna `http://localhost:6070`.

## Starten (lokale ontwikkeling zonder Docker)

Vereist een lokaal draaiende Postgres-instantie.

```bash
npm install
npm run dev            # frontend, http://localhost:5173

cd server
npm install
# .env met DATABASE_URL en ODDS_API_KEY
node index.js           # API, http://localhost:3001
```

## Projectstructuur

```
src/
  App.jsx                  – filters, samenvatting, laadt/ververst bets
  components/
    BetForm.jsx             – nieuwe bet invoeren (wedstrijd, markt, odds, inzet)
    BetList.jsx              – lijst bets met live score en handmatige settle-knoppen
    MatchPicker.jsx            – datum + wedstrijd kiezen via de Odds API
  markets.js                   – markt-definities en leesbare selectie-labels
server/
  index.js                     – Express-API: wedstrijden-proxy, bets-CRUD, scores-poller + auto-settlement
  db.js                        – Postgres-connectiepool + schema
```

## Hoe settlement werkt

Via de knop "Live scores ophalen" in het dashboard haalt de server op aanvraag de score op bij The Odds API (`/scores`) voor alle sporten met open bets op wedstrijden die al zijn afgetrapt, en settelt automatisch de markten `1x2`, `dubbelkans`, `btts` en `over_under`. De markt `anders` (en elke market waarvoor de uitslag niet uit de eindstand is af te leiden) blijft open voor handmatige settlement via de knoppen in het dashboard.

Er is geen automatische achtergrond-poller meer — dat kostte Odds API-credits ook als er niemand keek. De knop toont het huidige verbruik (`gebruikt/totaal` credits in de lopende periode), zodat je zelf kunt bepalen wanneer je een call "waard" is.
