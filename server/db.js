import pg from 'pg';

const { Pool, types } = pg;

// planned_bets.for_date is een pure DATE-kolom (geen tijd/tijdzone). pg's
// standaardparser (OID 1082) zet die om naar een JS Date op lokale middernacht,
// en .toISOString() daarop schuift de dag terug zodra de servertijdzone vóór
// UTC ligt (bv. Europe/Amsterdam) - "2026-09-20" kwam er zo als "2026-09-19"
// weer uit. Als platte 'YYYY-MM-DD'-string laten staan voorkomt die conversie
// helemaal.
types.setTypeParser(1082, (value) => value);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

let schemaReady = null;
export function ensureSchema() {
  if (!schemaReady) {
    schemaReady = pool.query(`
      create table if not exists matches (
        id text primary key,
        sport_key text not null,
        competition text,
        home text not null,
        away text not null,
        commence_time timestamptz not null,
        status text not null default 'scheduled',
        home_score int,
        away_score int,
        last_score_sync_at timestamptz,
        tsdb_live_id text
      );
      alter table matches add column if not exists tsdb_live_id text;

      -- Een bet is een "slip": één of meer selecties (bet_legs). Een single
      -- is gewoon een slip met precies 1 leg.
      create table if not exists bets (
        id text primary key,
        bookmaker text not null,
        odds numeric not null,
        stake numeric not null,
        potential_payout numeric not null,
        status text not null default 'open',
        source text not null default 'manual',
        placed_at timestamptz not null default now(),
        settled_at timestamptz,
        notes text,
        telegram_message_id text
      );
      alter table bets add column if not exists telegram_message_id text;

      create table if not exists bet_legs (
        id text primary key,
        bet_id text not null references bets(id) on delete cascade,
        position int not null default 0,
        match_id text references matches(id),
        manual_label text,
        market text not null,
        selection text not null,
        line numeric,
        odds numeric not null,
        status text not null default 'open'
      );

      create table if not exists bookmaker_withdrawals (
        id text primary key,
        bookmaker text not null,
        amount numeric not null,
        occurred_at timestamptz not null default now(),
        notes text
      );

      -- Handmatig gelogde stortingen naar een bookmaker (het spiegelbeeld van
      -- bookmaker_withdrawals). Dekt een stake nog een gat dat hier niet door
      -- gedekt wordt, dan vult buildBookmakerLedger dat resterende tekort nog
      -- steeds automatisch aan (zie de toelichting bij buildBookmakerLedger).
      create table if not exists bookmaker_deposits (
        id text primary key,
        bookmaker text not null,
        amount numeric not null,
        occurred_at timestamptz not null default now(),
        notes text
      );

      -- Handmatige correctie op een berekend saldo (bookmaker-naam of 'ING'
      -- als target) — voor kleine driftjes doordat een bookmaker een payout
      -- net anders afrondt dan potential_payout, niet voor echte stortingen/
      -- opnames (die blijven bookmaker_deposits/bookmaker_withdrawals, en
      -- worden wél naar ING gespiegeld). Een correctie wordt nooit gespiegeld.
      create table if not exists balance_corrections (
        id text primary key,
        target text not null,
        amount numeric not null,
        occurred_at timestamptz not null default now(),
        notes text
      );

      -- Eén rij (id=1) met het startpunt van de ING-rekening: saldo en
      -- moment vanaf waar overboekingen naar/van bookmakers en de
      -- automatische maandstorting worden meegeteld. Bets/stortingen/opnames
      -- van vóór starting_at tellen niet mee in het ING-journaal - dat
      -- verleden is niet als echte overboeking terug te herleiden.
      create table if not exists ing_account (
        id int primary key default 1,
        starting_balance numeric not null default 0,
        starting_at timestamptz not null default now(),
        monthly_deposit numeric not null default 100,
        constraint ing_account_singleton check (id = 1)
      );

      -- Eén rij per keer dat de Odds API-responseheaders veranderen (niet per
      -- call) — zo kun je het verbruik binnen de huidige periode aflezen uit
      -- de laatste rij, en een reset herkennen doordat requests_used daalt.
      create table if not exists odds_api_usage (
        id serial primary key,
        checked_at timestamptz not null default now(),
        requests_used int not null,
        requests_remaining int not null,
        requests_last int
      );

      -- Telegram-parlays zijn gewoon bets (source='telegram') met meerdere
      -- legs — geen aparte tabel nodig, ze hergebruiken dezelfde combi- en
      -- settlement-logica als eigen bets. Vroegere losse telegram_picks-tabel
      -- is niet meer in gebruik.
      drop table if exists telegram_picks;

      -- Het geschreven rapport (markdown) dat je terugkrijgt nadat je een
      -- export uit /api/reports/export aan Claude hebt gegeven — hier
      -- opgeslagen zodat het in het dashboard zelf te bekijken is, niet
      -- alleen als losse download.
      create table if not exists report_notes (
        id text primary key,
        period text not null,
        source text not null default 'manual',
        pick_count int,
        generated_at timestamptz not null default now(),
        content text not null,
        created_at timestamptz not null default now()
      );

      -- Favoriet-overrides voor live wedstrijden - zie getFavoriteState() in
      -- index.js: een wedstrijd is standaard favoriet zodra er een open bet
      -- op zit (via matches.tsdb_live_id, handmatig gekoppeld of fuzzy
      -- gematcht). De rij hier overschrijft dat default in beide richtingen -
      -- favorite=true voor een handmatige ster op een wedstrijd zonder bet,
      -- favorite=false om een bet-favoriet toch uit te zetten - zodat de
      -- ster-knop altijd klikbaar blijft, ook op een wedstrijd waar je op
      -- inzet.
      create table if not exists favorite_matches (
        tsdb_live_id text primary key,
        favorited_at timestamptz not null default now()
      );
      alter table favorite_matches add column if not exists favorite boolean not null default true;

      -- Opzetjes: bet-ideeën voor komende wedstrijden, nog zonder inzet. Geen
      -- eigen statusveld nodig - "plaatsen" betekent een echte bet aanmaken
      -- (in bets/bet_legs) en dit opzetje meteen verwijderen (zie
      -- POST /api/planned-bets en de plaats-flow in de client), "afwijzen" is
      -- gewoon verwijderen. Bookmaker/odds/notes zijn optioneel: alleen
      -- wedstrijd + markt + selectie per leg staan al vast.
      create table if not exists planned_bets (
        id text primary key,
        bookmaker text,
        odds numeric,
        notes text,
        for_date date not null default current_date,
        created_at timestamptz not null default now()
      );

      create table if not exists planned_bet_legs (
        id text primary key,
        planned_bet_id text not null references planned_bets(id) on delete cascade,
        position int not null default 0,
        match_id text references matches(id),
        manual_label text,
        market text not null,
        selection text not null,
        line numeric,
        odds numeric
      );

      create index if not exists planned_bets_for_date_idx on planned_bets (for_date);
      create index if not exists planned_bet_legs_planned_bet_id_idx on planned_bet_legs (planned_bet_id);
      create index if not exists planned_bet_legs_match_id_idx on planned_bet_legs (match_id);

      create index if not exists bets_status_idx on bets (status);
      create index if not exists bets_source_idx on bets (source);
      create unique index if not exists bets_telegram_message_idx on bets (telegram_message_id) where telegram_message_id is not null;
      create index if not exists bet_legs_bet_id_idx on bet_legs (bet_id);
      create index if not exists bet_legs_match_id_idx on bet_legs (match_id);
      create index if not exists report_notes_source_idx on report_notes (source);
      create index if not exists report_notes_generated_at_idx on report_notes (generated_at desc);
      create index if not exists bookmaker_withdrawals_bookmaker_idx on bookmaker_withdrawals (bookmaker);
      create index if not exists bookmaker_deposits_bookmaker_idx on bookmaker_deposits (bookmaker);
      create index if not exists odds_api_usage_checked_at_idx on odds_api_usage (checked_at desc);
      create index if not exists balance_corrections_target_idx on balance_corrections (target);

      -- Startsaldo eenmalig gezet op het moment dat deze rekening in de app
      -- kwam; latere runs laten deze rij met rust (on conflict do nothing).
      insert into ing_account (id, starting_balance, starting_at, monthly_deposit)
      values (1, 400, now(), 100)
      on conflict (id) do nothing;
    `);
  }
  return schemaReady;
}
