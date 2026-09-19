import { useState } from 'react';
import BookmakerOverview from './BookmakerOverview.jsx';
import DailyOverview from './DailyOverview.jsx';
import TelegramComparison from './TelegramComparison.jsx';
import MarketOverview from './MarketOverview.jsx';
import ReportPanel from './ReportPanel.jsx';

const TABS = [
  { key: 'bookmakers', label: 'Bookmakers' },
  { key: 'perdag', label: 'Per dag' },
  { key: 'telegram', label: 'Vergelijking' },
  { key: 'markten', label: 'Per markt' },
  { key: 'rapport', label: 'Rapport' },
];

export default function Overview({ bets, telegramBets = [] }) {
  const [tab, setTab] = useState('bookmakers');
  // Verhoogt bij elke tabklik, ook als de tab al actief is - zo dwingt een
  // herklik op "Per dag"/"Bookmakers" altijd terug naar het overzicht, ook
  // als je in een dag- of bookmakerdetail zit.
  const [resetTick, setResetTick] = useState(0);

  function selectTab(key) {
    setTab(key);
    setResetTick((n) => n + 1);
  }

  return (
    <div>
      <nav className="filters view-switch">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`filter-tab ${tab === t.key ? 'is-active' : ''}`}
            onClick={() => selectTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      {tab === 'bookmakers' ? (
        <BookmakerOverview key={resetTick} />
      ) : tab === 'perdag' ? (
        <DailyOverview key={resetTick} bets={bets} telegramBets={telegramBets} />
      ) : tab === 'telegram' ? (
        <TelegramComparison key={resetTick} bets={bets} telegramBets={telegramBets} />
      ) : tab === 'markten' ? (
        <MarketOverview key={resetTick} />
      ) : (
        <ReportPanel key={resetTick} />
      )}
    </div>
  );
}
