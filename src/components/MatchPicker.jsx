import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../api.js';

const EUROPEAN_COUNTRIES = new Set([
  'England', 'Spain', 'Germany', 'Italy', 'France', 'Netherlands',
  'Portugal', 'Belgium', 'Sweden', 'Norway', 'Europe',
]);

const COUNTRY_CODES = {
  England: 'EN', Spain: 'ES', Germany: 'DE', Italy: 'IT', France: 'FR',
  Netherlands: 'NL', Portugal: 'PT', Belgium: 'BE',
  Sweden: 'SE', Norway: 'NO', USA: 'US',
};

function countryLabel(country) {
  return country === 'International' ? 'Internationale toernooien' : country;
}

function groupByCountry(otherLeagues) {
  const order = [];
  const byCountry = new Map();
  otherLeagues.forEach((league) => {
    if (!byCountry.has(league.country)) {
      byCountry.set(league.country, []);
      order.push(league.country);
    }
    byCountry.get(league.country).push(league);
  });
  const europe = [];
  const world = [];
  order.forEach((country) => {
    const target = country !== 'International' && EUROPEAN_COUNTRIES.has(country) ? europe : world;
    target.push({ country, leagues: byCountry.get(country) });
  });
  return { europe, world };
}

const kickoffFormatter = new Intl.DateTimeFormat('nl-NL', {
  weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
});
const shortDateFormatter = new Intl.DateTimeFormat('nl-NL', {
  weekday: 'short', day: 'numeric', month: 'short',
});

function shiftDate(value, days) {
  const next = new Date(`${value}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function monthLabel(value) {
  return new Intl.DateTimeFormat('nl-NL', { month: 'long', year: 'numeric' }).format(value);
}

function calendarDays(month) {
  const firstDay = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
  const startOffset = (firstDay.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
  return Array.from({ length: 42 }, (_, index) => {
    const day = index - startOffset + 1;
    return day > 0 && day <= daysInMonth
      ? new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), day))
      : null;
  });
}

export default function MatchPicker({ selectedMatch, onSelect }) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [matches, setMatches] = useState([]);
  const [leagues, setLeagues] = useState([]);
  const [leagueId, setLeagueId] = useState('top');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date(`${date}T12:00:00Z`));
  const [menuOpen, setMenuOpen] = useState(false);
  const [open, setOpen] = useState(true);
  const bodyId = useId();
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    function handleClickOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) setMenuOpen(false);
    }
    function handleKeyDown(event) {
      if (event.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api
      .getMatches(date)
      .then((data) => {
        if (cancelled) return;
        setMatches(data.matches || []);
        setLeagues(data.leagues || []);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [date]);

  function selectMatch(match) {
    onSelect(selectedMatch?.id === match.id ? null : match);
  }

  function chooseDate(nextDate) {
    setDate(nextDate);
    setCalendarMonth(new Date(`${nextDate}T12:00:00Z`));
    setCalendarOpen(false);
  }

  function changeLeague(nextLeague) {
    setLeagueId(nextLeague);
    setMenuOpen(false);
  }

  const visibleMatches = leagueId === 'all'
    ? matches
    : leagueId === 'top'
      ? matches.filter((match) => match.tier === 'top')
      : matches.filter((match) => match.competition === leagueId);
  const groupedMatches = leagues
    .map((league) => ({ ...league, matches: visibleMatches.filter((match) => match.competition === league.name) }))
    .filter((league) => league.matches.length > 0);
  const topLeagues = leagues.filter((league) => league.tier === 'top');
  const otherLeagues = leagues.filter((league) => league.tier !== 'top');
  const { europe: europeGroups, world: worldGroups } = groupByCountry(otherLeagues);
  const leagueLabel = leagueId === 'top' ? 'Top competities' : leagueId === 'all' ? 'Alle competities' : leagueId;
  const today = new Date().toISOString().slice(0, 10);
  const quickDates = [today, shiftDate(today, 1)];
  const days = calendarDays(calendarMonth);

  function renderCountryGroup(group) {
    if (group.leagues.length === 1) {
      const league = group.leagues[0];
      const code = COUNTRY_CODES[group.country];
      return (
        <button type="button" key={group.country} className={`menu-row${leagueId === league.name ? ' selected' : ''}`} onClick={() => changeLeague(league.name)}>
          <span>{league.name}</span>
          {code && <span className="badge">{code}</span>}
        </button>
      );
    }
    return (
      <details className="country-group" key={group.country}>
        <summary>
          <span className="caret" aria-hidden="true">▸</span>
          <span>{countryLabel(group.country)}</span>
          <span className="count">{group.leagues.length}</span>
        </summary>
        <div className="country-leagues">
          {group.leagues.map((league) => (
            <button type="button" key={league.id} className={`menu-row${leagueId === league.name ? ' selected' : ''}`} onClick={() => changeLeague(league.name)}>
              {league.name}
            </button>
          ))}
        </div>
      </details>
    );
  }

  return (
    <section className={`match-picker${open ? ' open' : ''}`} aria-label="Wedstrijd kiezen">
      <div className="match-picker-heading">
        <div>
          <span className="section-kicker">Wedstrijd</span>
          <h2>Kies een wedstrijd</h2>
        </div>
        <div className="match-picker-heading-actions">
          {open && (
            <div className="date-picker-control">
              <button type="button" className="date-step" onClick={() => chooseDate(shiftDate(date, -1))} aria-label="Vorige dag">‹</button>
              <button type="button" className="date-display" onClick={() => setCalendarOpen((isOpen) => !isOpen)} aria-expanded={calendarOpen}>
                <span aria-hidden="true">▣</span>
                {shortDateFormatter.format(new Date(`${date}T12:00:00Z`))}
              </button>
              <button type="button" className="date-step" onClick={() => chooseDate(shiftDate(date, 1))} aria-label="Volgende dag">›</button>
              {calendarOpen && (
                <div className="calendar-popover">
                  <div className="calendar-header">
                    <button type="button" onClick={() => setCalendarMonth((month) => new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() - 1, 1)))} aria-label="Vorige maand">‹</button>
                    <strong>{monthLabel(calendarMonth)}</strong>
                    <button type="button" onClick={() => setCalendarMonth((month) => new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1)))} aria-label="Volgende maand">›</button>
                  </div>
                  <div className="calendar-weekdays">{['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'].map((day) => <span key={day}>{day}</span>)}</div>
                  <div className="calendar-grid">
                    {days.map((day, index) => day ? (
                      <button type="button" className={day.toISOString().slice(0, 10) === date ? 'selected' : ''} key={day.toISOString()} onClick={() => chooseDate(day.toISOString().slice(0, 10))}>
                        {day.getUTCDate()}
                      </button>
                    ) : <span className="calendar-empty" key={`empty-${index}`} />)}
                  </div>
                </div>
              )}
            </div>
          )}
          <button
            type="button"
            className="match-picker-toggle"
            onClick={() => setOpen((isOpen) => !isOpen)}
            aria-expanded={open}
            aria-controls={bodyId}
            aria-label={open ? 'Inklappen' : 'Uitklappen'}
            title={open ? 'Inklappen' : 'Uitklappen'}
          >
            <span className="match-picker-caret" aria-hidden="true">▾</span>
          </button>
        </div>
      </div>

      {open && (
      <div id={bodyId}>
        <div className="match-picker-controls">
          <div className="quick-dates" aria-label="Snelle datumkeuze">
            {quickDates.map((quickDate, index) => (
              <button type="button" className={date === quickDate ? 'active' : ''} key={quickDate} onClick={() => chooseDate(quickDate)}>
                {index === 0 ? 'Vandaag' : 'Morgen'}
              </button>
            ))}
          </div>
          <div className="competition-menu" ref={menuRef}>
            <button type="button" className="menu-trigger" aria-haspopup="true" aria-expanded={menuOpen} aria-label="Competitiefilter" onClick={() => setMenuOpen((isOpen) => !isOpen)}>
              {leagueLabel}
            </button>
            {menuOpen && (
              <div className="menu-popover" role="menu">
                <button type="button" className={`menu-row${leagueId === 'top' ? ' selected' : ''}`} onClick={() => changeLeague('top')}>Top competities</button>
                <button type="button" className={`menu-row${leagueId === 'all' ? ' selected' : ''}`} onClick={() => changeLeague('all')}>Alle competities</button>
                {topLeagues.map((league) => (
                  <button type="button" key={league.id} className={`menu-row${leagueId === league.name ? ' selected' : ''}`} onClick={() => changeLeague(league.name)}>
                    <span>{league.name}</span>
                    {COUNTRY_CODES[league.country] && <span className="badge">{COUNTRY_CODES[league.country]}</span>}
                  </button>
                ))}
                {europeGroups.length > 0 && <div className="menu-group-label">Europa</div>}
                {europeGroups.map((group) => renderCountryGroup(group))}
                {worldGroups.length > 0 && <div className="menu-group-label">Buiten Europa</div>}
                {worldGroups.map((group) => renderCountryGroup(group))}
              </div>
            )}
          </div>
          <span className="data-note">{matches.length} wedstrijden</span>
        </div>

        {loading && <div className="picker-message">Wedstrijden laden…</div>}
        {error && <div className="error-text picker-error">Wedstrijden ophalen mislukt: {error}</div>}
        {!loading && !error && visibleMatches.length === 0 && (
          <div className="picker-message">Geen wedstrijden gevonden op deze datum.</div>
        )}
        <div className="match-groups">
          {groupedMatches.map((league) => (
            <div className="match-group" key={league.id}>
              <div className="match-group-heading">
                <strong>{league.name}</strong>
                <span>{league.matches.length} {league.matches.length === 1 ? 'wedstrijd' : 'wedstrijden'}</span>
              </div>
              <div className="match-list">
                {league.matches.map((match) => (
                  <button
                    type="button"
                    className={`match-item${selectedMatch?.id === match.id ? ' selected' : ''}`}
                    key={match.id}
                    onClick={() => selectMatch(match)}
                  >
                    <span className="match-kickoff">{kickoffFormatter.format(new Date(match.commenceTime))}</span>
                    <strong>{match.home} <span>vs</span> {match.away}</strong>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      )}
    </section>
  );
}
