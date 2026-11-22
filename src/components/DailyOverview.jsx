import { Fragment, useState } from 'react';
import { betWinst, groupByDay, todayKey } from '../dailyResults.js';
import { LegRow, PayoutCell, legLabel } from './BetList.jsx';
import { STATUS_LABELS, isBetBuilder } from '../markets.js';
import EquityCurve from './EquityCurve.jsx';
import { Amount } from './AmountsToggle.jsx';
import InlineIcon from './InlineIcon.jsx';

function fmt(n) {
  return Number(n).toFixed(2);
}

function signed(n) {
  return (
    <Amount>
      {n >= 0 ? '+' : '−'} € {fmt(Math.abs(n))}
    </Amount>
  );
}

function formatDate(key) {
  const [y, m, d] = key.split('-');
  return `${d}-${m}-${y}`;
}

function betLabel(bet) {
  return bet.legs.length > 1 ? `Combi (${bet.legs.length} selecties)` : legLabel(bet.legs[0]);
}

function resultClass(n) {
  if (n > 0) return 'amount-positive';
  if (n < 0) return 'amount-negative';
  return '';
}

function placedTime(bet) {
  return new Date(bet.placedAt).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}

// "2 van 3 goed" voor een combi - alleen zodra elke (niet-void) selectie
// een uitslag heeft; een handmatig afgerekende bet heeft soms nog open legs.
function legsSummary(bet) {
  if (bet.legs.length < 2) return null;
  const counted = bet.legs.filter((l) => l.status !== 'void');
  if (counted.length === 0 || counted.some((l) => l.status === 'open')) return null;
  const won = counted.filter((l) => l.status === 'won').length;
  return `${won} van ${counted.length} selecties goed`;
}

// Het bonnetje onder een uitgeklapte rij: wanneer geplaatst, totale odds,
// (mogelijke) uitbetaling en elke selectie met odds en uitslag.
function BetSlip({ bet }) {
  const isCombi = bet.legs.length > 1;
  const builderCard = !isCombi && isBetBuilder(bet.legs[0]);
  const summary = legsSummary(bet);
  return (
    <div className="day-slip">
      <div className="day-slip-meta">
        <span>Geplaatst {placedTime(bet)}</span>
        {isCombi && <span>Totaal @ {Number(bet.odds).toFixed(2)}</span>}
        <PayoutCell bet={bet} />
        {summary && <span className={bet.status === 'lost' ? 'amount-negative' : ''}>{summary}</span>}
      </div>
      <div className="leg-list">
        {bet.legs.map((leg) => (
          <LegRow key={leg.id} leg={leg} builderCard={builderCard} />
        ))}
      </div>
    </div>
  );
}

function DayDetail({ day, onBack }) {
  const [openIds, setOpenIds] = useState(() => new Set());
  const toggle = (id) =>
    setOpenIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="bookmaker-ledger">
      <div className="card-header">
        <h3>{formatDate(day.date)}</h3>
        <button type="button" className="btn btn-back" onClick={onBack}>
          <InlineIcon name="arrow-left" /> Terug naar overzicht
        </button>
      </div>
      <div className="ledger-balance">
        <span className="muted">Resultaat</span>
        <strong className={resultClass(day.result)}>{signed(day.result)}</strong>
      </div>
      <div className="table-wrap">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>Selectie</th>
              <th>Bookmaker</th>
              <th>Inzet</th>
              <th>Status</th>
              <th>Winst</th>
            </tr>
          </thead>
          <tbody>
            {day.bets.map((bet) => {
              const winst = betWinst(bet);
              const open = openIds.has(bet.id);
              return (
                <Fragment key={bet.id}>
                <tr
                  className={`day-bet-row${open ? ' is-open' : ''}`}
                  onClick={() => toggle(bet.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggle(bet.id);
                    }
                  }}
                  tabIndex={0}
                  aria-expanded={open}
                >
                  <td>
                    <span className="day-bet-caret" aria-hidden="true">▸</span>
                    {betLabel(bet)}
                  </td>
                  <td>{bet.bookmaker}</td>
                  <td>
                    € <Amount>{fmt(bet.stake)}</Amount>
                  </td>
                  <td>
                    <span className={`status-badge status-${bet.status}`}>{STATUS_LABELS[bet.status]}</span>
                  </td>
                  <td className={winst > 0 ? 'amount-positive' : ''}>
                    {winst > 0 ? <Amount>{`+ € ${fmt(winst)}`}</Amount> : '—'}
                  </td>
                </tr>
                {open && (
                  <tr className="day-bet-detail">
                    <td colSpan={5}>
                      <BetSlip bet={bet} />
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function DailyOverview({ bets }) {
  const [selectedDate, setSelectedDate] = useState(null);

  const days = groupByDay(bets);
  const displayDays = days.slice().reverse();
  const selected = displayDays.find((d) => d.date === selectedDate) || null;

  if (selected) {
    return <DayDetail day={selected} onBack={() => setSelectedDate(null)} />;
  }

  return (
    <div className="bookmaker-overview">
      <EquityCurve bets={bets} onSelectDay={setSelectedDate} />
      <div className="bookmaker-hero">
        <h3>Overzicht per dag</h3>
      </div>
      {displayDays.length === 0 ? (
        <p className="hint-text">Nog geen bets geplaatst.</p>
      ) : (
        <div className="bookmaker-cards">
          {displayDays.map((day) => (
            <div className="bookmaker-card" key={day.date} onClick={() => setSelectedDate(day.date)}>
              <div className="bookmaker-card-top">
                <span className="bookmaker-name">
                  {formatDate(day.date)}
                  {day.date === todayKey() && <span className="today-chip">Vandaag</span>}
                </span>
                <span className="bookmaker-open-chip">{day.bets.length} bets</span>
              </div>
              <p className={`bookmaker-balance ${resultClass(day.result)}`}>{signed(day.result)}</p>
              <div className="day-card-foot">
                <span>
                  Inzet € <Amount>{fmt(day.staked)}</Amount>
                </span>
                <span>
                  Winst € <Amount>{fmt(day.won)}</Amount>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
