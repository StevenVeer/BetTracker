import { useState } from 'react';
import { betWinst, groupByDay, todayKey } from '../dailyResults.js';
import { legLabel } from './BetList.jsx';
import { STATUS_LABELS } from '../markets.js';
import EquityCurve from './EquityCurve.jsx';
import { Amount } from './AmountsToggle.jsx';

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

function DayDetail({ day, onBack }) {
  return (
    <div className="bookmaker-ledger">
      <div className="card-header">
        <h3>{formatDate(day.date)}</h3>
        <button type="button" className="btn btn-back" onClick={onBack}>
          ← Terug naar overzicht
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
              return (
                <tr key={bet.id}>
                  <td>{betLabel(bet)}</td>
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
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function DailyOverview({ bets, telegramBets = [] }) {
  const [selectedDate, setSelectedDate] = useState(null);

  const days = groupByDay(bets);
  const displayDays = days.slice().reverse();
  const selected = displayDays.find((d) => d.date === selectedDate) || null;

  if (selected) {
    return <DayDetail day={selected} onBack={() => setSelectedDate(null)} />;
  }

  return (
    <div className="bookmaker-overview">
      <EquityCurve bets={bets} telegramBets={telegramBets} />
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
