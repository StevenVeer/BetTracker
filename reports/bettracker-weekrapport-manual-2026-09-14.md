# Weekrapport — eigen bets (t/m 14 september 2026)

Bron: handmatige invoer · 17 afgehandelde selecties · export: `bettracker-weekrapport-manual-2026-09-14.json`

## Samenvatting

- **15 gewonnen / 2 verloren** op legniveau — 88% hit rate.
- De 17 legs zijn verdeeld over **3 combi-tickets**, één per bookmaker: BetCity (9 legs), 711 (3 legs), Toto (5 legs).
- Op **ticketniveau** is het beeld heel anders: 1 ticket volledig gewonnen (711), 2 tickets volledig verloren (BetCity, Toto). Een hoge hit rate per leg redt een combi niet zodra er één leg mist.

## Per ticket

### BetCity — 9-leg combi — ❌ verloren

| Wedstrijd | Markt | Selectie | Odds | Categorie | Uitslag |
|---|---|---|---|---|---|
| RB Leipzig - Hamburger SV | team_wint | home | 1.37 | kleine favoriet | won |
| FC Heidenheim - Holstein Kiel | dubbelkans | home_draw | 1.25 | zware favoriet | won |
| FC Heidenheim - Holstein Kiel | over_under | over | 1.44 | kleine favoriet | **lost** |
| Viking Stavanger - Kristiansund BK | team_wint | home | 1.25 | zware favoriet | won |
| Hammarby IF - IF Brommapojkarna | team_wint | home | 1.18 | zware favoriet | won |
| Levante - Barcelona | team_wint | away | 1.15 | zware favoriet | won |
| FC Zwolle - Feyenoord | team_wint | away | 1.48 | kleine favoriet | won |
| PSV Eindhoven - Sparta Rotterdam | team_wint | home | 1.17 | zware favoriet | won |
| Excelsior Rotterdam - FC Utrecht | over_under | over | 1.62 | ongeveer gelijk | won |

8 van de 9 legs wonnen — alleen de over/under-leg op FC Heidenheim - Holstein Kiel (odds 1.44) verloor, en dat volstaat om de hele combi te laten klappen.

### 711 — 3-leg combi — ✅ gewonnen

| Wedstrijd | Markt | Selectie | Odds | Categorie | Uitslag |
|---|---|---|---|---|---|
| Hammarby IF - IF Brommapojkarna | team_wint | home | 1.44 | kleine favoriet | won |
| FC Heidenheim - Holstein Kiel | team_wint | home | 1.67 | ongeveer gelijk | won |
| Club Brugge - Royal Antwerp FC | team_wint | home | 1.41 | kleine favoriet | won |

Enige ticket dat volledig raak was deze week.

### Toto — 5-leg combi — ❌ verloren

| Wedstrijd | Markt | Selectie | Odds | Categorie | Uitslag |
|---|---|---|---|---|---|
| Club Brugge - Royal Antwerp FC | team_wint | home | 1.22 | zware favoriet | won |
| Coventry City - Brighton and Hove Albion | dubbelkans | draw_away | 1.25 | zware favoriet | won |
| RB Leipzig - Hamburger SV | team_wint | home | 1.32 | kleine favoriet | won |
| Levante - Barcelona | team_wint | away | 1.16 | zware favoriet | won |
| Famalicão - Sporting Lisbon | team_wint | away | 1.46 | kleine favoriet | **lost** |

4 van de 5 legs wonnen; de laatste selectie (Famalicão - Sporting Lisbon, away) besliste het ticket.

## Analyse per markt

| Markt | Legs | Won | Verloren | Hit rate |
|---|---|---|---|---|
| team_wint | 13 | 12 | 1 | 92% |
| dubbelkans | 2 | 2 | 0 | 100% |
| over_under | 2 | 1 | 1 | 50% |

## Analyse per favorietencategorie

| Categorie | Legs | Won | Verloren | Hit rate |
|---|---|---|---|---|
| Zware favoriet (odds <1.30) | 8 | 8 | 0 | 100% |
| Kleine favoriet (1.30-1.59) | 7 | 5 | 2 | 71% |
| Ongeveer gelijk (1.60-2.19) | 2 | 2 | 0 | 100% |

Beide verliesleggen (FC Heidenheim over/under, Famalicão - Sporting Lisbon) zaten in de categorie "kleine favoriet" — de zwakste schakel deze week ten opzichte van de zware favorieten, die perfect scoorden.

## Kanttekeningen

- Deze export bevat geen inzet of einduitbetaling, dus winst/verlies in euro's is hieruit niet te berekenen — alleen aantallen gewonnen/verloren legs en tickets.
- De ticketindeling (BetCity 9-leg, 711 3-leg, Toto 5-leg) is afgeleid uit de groepering per bookmaker in de export; de ruwe data koppelt legs niet expliciet aan een bet-id.
- "Favoriet"-labels zijn een proxy op basis van de eigen inzet-odds, niet de echte implied probability van de markt (zo ook toegelicht in `server/reportGenerator.js`).
