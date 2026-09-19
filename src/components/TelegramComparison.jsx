import { betWinst } from '../dailyResults.js';
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

function pct(n) {
  return `${n >= 0 ? '+' : '−'}${Math.abs(n * 100).toFixed(1)}%`;
}

function resultClass(n) {
  if (n > 0) return 'amount-positive';
  if (n < 0) return 'amount-negative';
  return '';
}

// odds = 1 is de sentinel-waarde voor "referentie-odds nog niet opgehaald"
// (zie server: TELEGRAM_ASSUMED_STAKE / ODDS_FETCHABLE_MARKETS) - zo'n bet
// telt dan wel mee in de win-rate, maar niet in de ROI (anders vertekent een
// nep-odds-van-1 de uitkomst).
function isPriced(bet) {
  return bet.source !== 'telegram' || bet.odds !== 1;
}

function summarize(bets) {
  const decided = bets.filter((b) => ['won', 'lost', 'void'].includes(b.status));
  const won = decided.filter((b) => b.status === 'won').length;
  const lost = decided.filter((b) => b.status === 'lost').length;
  const priced = decided.filter(isPriced);
  const staked = priced.reduce((s, b) => s + Number(b.stake), 0);
  const returned = priced.reduce((s, b) => s + betWinst(b), 0);
  return {
    decidedCount: decided.length,
    winRate: won + lost > 0 ? won / (won + lost) : null,
    roi: staked > 0 ? (returned - staked) / staked : null,
    result: returned - staked,
    staked,
  };
}

function StatCard({ title, subtitle, stats, currency }) {
  return (
    <div className="bookmaker-card">
      <div className="bookmaker-card-top">
        <span className="bookmaker-name">{title}</span>
        <span className="bookmaker-open-chip">{stats.decidedCount} afgerond</span>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        {subtitle}
      </p>
      <div className="day-card-foot" style={{ marginTop: 12 }}>
        <span>Win-rate</span>
        <strong>{stats.winRate !== null ? `${(stats.winRate * 100).toFixed(1)}%` : '—'}</strong>
      </div>
      <div className="day-card-foot">
        <span>ROI{currency ? '' : ' (fictief)'}</span>
        <strong className={stats.roi !== null ? resultClass(stats.roi) : ''}>
          {stats.roi !== null ? pct(stats.roi) : '—'}
        </strong>
      </div>
      <div className="day-card-foot">
        <span>Resultaat{currency ? '' : ' (fictief)'}</span>
        <strong className={resultClass(stats.result)}>{stats.staked > 0 ? signed(stats.result) : '—'}</strong>
      </div>
    </div>
  );
}

export default function TelegramComparison({ bets, telegramBets }) {
  const betStats = summarize(bets);
  const telegramStats = summarize(telegramBets);
  const unpriced = telegramBets.filter((b) => ['won', 'lost', 'void'].includes(b.status) && !isPriced(b)).length;

  return (
    <div className="bookmaker-overview">
      <div className="bookmaker-hero">
        <h3>Mijn bets vs. Telegram-groep</h3>
      </div>
      <p className="hint-text">
        De Telegram-parlays hebben geen eigen odds/inzet — ROI en resultaat zijn een aanname op basis van een vaste
        inzet per parlay (€ <Amount>{telegramBets[0] ? fmt(telegramBets[0].stake) : '10.00'}</Amount>) en referentie-odds die je
        zelf ophaalt via "Odds ophalen". Zonder die odds telt een afgeronde parlay alleen mee in de win-rate, niet in
        de ROI.
      </p>
      <div className="bookmaker-cards">
        <StatCard title="Mijn bets" subtitle="Eigen inzet, echte odds" stats={betStats} currency />
        <StatCard title="Telegram-groep" subtitle="Gedeelde parlays, fictieve inzet" stats={telegramStats} />
      </div>
      {unpriced > 0 && (
        <p className="hint-text" style={{ marginTop: 12 }}>
          {unpriced} afgeronde parlay{unpriced === 1 ? '' : "'s"} zonder (volledige) referentie-odds — haal odds op
          om ze mee te tellen in de ROI.
        </p>
      )}
    </div>
  );
}
