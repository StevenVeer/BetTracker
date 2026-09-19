import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Amount } from './AmountsToggle.jsx';

function formatEUR(n) {
  return (
    <>
      EUR <Amount>{Number(n).toFixed(2)}</Amount>
    </>
  );
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const BOOKMAKER_SITES = {
  Bet365: 'https://www.bet365.nl',
  BetCity: 'https://www.betcity.nl',
  Toto: 'https://www.toto.nl',
  Unibet: 'https://www.unibet.nl',
  BetMGM: 'https://www.betmgm.nl',
  '711': 'https://www.711.nl/',
  Jacks: 'https://jacks.nl/sports#sports-hub/football',
};

function bookmakerUrl(name) {
  return BOOKMAKER_SITES[name] || `https://www.google.com/search?q=${encodeURIComponent(name)}`;
}

function WithdrawForm({ bookmaker, onDone }) {
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!amount || Number(amount) <= 0) return;
    setSubmitting(true);
    try {
      await api.addWithdrawal(bookmaker, Number(amount));
      setAmount('');
      onDone();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="withdraw-form" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
      <input type="number" step="0.5" min="0" placeholder="bedrag" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <button type="submit" className="btn btn-primary btn-small" disabled={submitting}>
        Uitbetaald
      </button>
    </form>
  );
}

function DepositForm({ bookmaker, onDone, compact = false }) {
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!amount || Number(amount) <= 0) return;
    setSubmitting(true);
    try {
      await api.addDeposit(bookmaker, Number(amount));
      setAmount('');
      onDone();
    } finally {
      setSubmitting(false);
    }
  }

  if (compact) {
    return (
      <form className="mini-form" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <input type="number" step="0.5" min="0" placeholder="bedrag" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <button type="submit" disabled={submitting} title="Storten">
          +
        </button>
      </form>
    );
  }

  return (
    <form className="withdraw-form deposit-form" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
      <input type="number" step="0.5" min="0" placeholder="bedrag" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <button type="submit" className="btn btn-small" disabled={submitting}>
        Gestort
      </button>
    </form>
  );
}

function CorrectionForm({ target, onDone, isIng = false }) {
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(e) {
    e.preventDefault();
    e.stopPropagation();
    const value = Number(amount);
    if (!amount || Number.isNaN(value) || value === 0) return;
    setSubmitting(true);
    try {
      if (isIng) {
        await api.addIngCorrection(value);
      } else {
        await api.addCorrection(target, value);
      }
      setAmount('');
      onDone();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="withdraw-form correction-form" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
      <input
        type="number"
        step="0.01"
        placeholder="±bedrag"
        title="Correctie op het berekende saldo, bv. door afrondingsverschil bij de bookmaker"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <button type="submit" className="btn btn-ghost btn-small" disabled={submitting}>
        Corrigeer
      </button>
    </form>
  );
}

function LedgerDetail({ bookmaker, onBack, onChanged }) {
  const [ledger, setLedger] = useState(null);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    api
      .getBookmakerLedger(bookmaker)
      .then(setLedger)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookmaker]);

  function handleChanged() {
    load();
    onChanged();
  }

  return (
    <div className="bookmaker-ledger">
      <div className="card-header">
        <h3>{bookmaker}</h3>
        <button type="button" className="btn btn-ghost" onClick={onBack}>
          ← Terug naar overzicht
        </button>
      </div>

      {loading || !ledger ? (
        <p className="hint-text">Laden…</p>
      ) : (
        <>
          <div className="ledger-balance">
            <span className="muted">Huidig saldo</span>
            <strong>{formatEUR(ledger.balance)}</strong>
          </div>
          <div className="ledger-actions">
            <DepositForm bookmaker={bookmaker} onDone={handleChanged} />
            <WithdrawForm bookmaker={bookmaker} onDone={handleChanged} />
            <CorrectionForm target={bookmaker} onDone={handleChanged} />
          </div>

          {ledger.rows.length === 0 ? (
            <p className="hint-text">Nog geen activiteit bij deze bookmaker.</p>
          ) : (
            <div className="table-wrap">
              <table className="ledger-table">
                <thead>
                  <tr>
                    <th>Datum</th>
                    <th>Type</th>
                    <th>Bedrag</th>
                    <th>Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.rows.map((row, index) => (
                    <tr key={index}>
                      <td>{formatDate(row.at)}</td>
                      <td>
                        {row.label}
                        {row.auto && <span className="tag-auto">auto</span>}
                      </td>
                      <td className={row.amount >= 0 ? 'amount-positive' : 'amount-negative'}>
                        {row.amount >= 0 ? '+' : ''}
                        {formatEUR(row.amount)}
                      </td>
                      <td>{formatEUR(row.balanceAfter)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function BankIcon({ size = 18, color = '#8fc0e3' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10 12 4l9 6" />
      <path d="M5 10v9M10 10v9M14 10v9M19 10v9" />
      <path d="M3 21h18" />
    </svg>
  );
}

function IngLedger({ onBack, onChanged }) {
  const [ledger, setLedger] = useState(null);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    api
      .getIngLedger()
      .then(setLedger)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  function handleChanged() {
    load();
    onChanged();
  }

  return (
    <div className="bookmaker-ledger ing-ledger">
      <div className="card-header">
        <h3>
          <BankIcon />
          ING
        </h3>
        <button type="button" className="btn btn-ghost" onClick={onBack}>
          ← Terug naar overzicht
        </button>
      </div>

      {loading || !ledger ? (
        <p className="hint-text">Laden…</p>
      ) : (
        <>
          <div className="ledger-balance">
            <span className="muted">Huidig saldo</span>
            <strong className="is-bank">{formatEUR(ledger.balance)}</strong>
          </div>
          <p className="hint-text">
            Startsaldo {formatEUR(ledger.startingBalance)} op {formatDate(ledger.startingAt)} — overboekingen naar/van bookmakers
            en de automatische maandstorting van vóór die datum tellen niet mee.
          </p>
          <div className="ledger-actions">
            <CorrectionForm target="ING" isIng onDone={handleChanged} />
          </div>

          {ledger.rows.length === 0 ? (
            <p className="hint-text">Nog geen overboekingen sinds het startsaldo.</p>
          ) : (
            <div className="table-wrap">
              <table className="ledger-table">
                <thead>
                  <tr>
                    <th>Datum</th>
                    <th>Type</th>
                    <th>Bedrag</th>
                    <th>Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.rows.map((row, index) => (
                    <tr key={index}>
                      <td>{formatDate(row.at)}</td>
                      <td>
                        {row.label}
                        {row.auto && <span className="tag-auto">auto</span>}
                      </td>
                      <td className={row.amount >= 0 ? 'amount-positive' : 'amount-negative'}>
                        {row.amount >= 0 ? '+' : ''}
                        {formatEUR(row.amount)}
                      </td>
                      <td>{formatEUR(row.balanceAfter)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function BookmakerOverview() {
  const [overview, setOverview] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  function loadOverview() {
    setLoading(true);
    api
      .getBookmakerOverview()
      .then(setOverview)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadOverview();
  }, []);

  if (selected === 'ING') {
    return <IngLedger onBack={() => setSelected(null)} onChanged={loadOverview} />;
  }
  if (selected) {
    return <LedgerDetail bookmaker={selected} onBack={() => setSelected(null)} onChanged={loadOverview} />;
  }

  const bookmakerRows = overview.filter((o) => !o.isBank).sort((a, b) => Number(b.balance) - Number(a.balance));
  const activeRows = bookmakerRows.filter((o) => Number(o.balance) > 0 || Number(o.openBets) > 0);
  const emptyRows = bookmakerRows.filter((o) => Number(o.balance) <= 0 && Number(o.openBets) === 0);
  const ing = overview.find((o) => o.isBank);
  const totalBalance = bookmakerRows.reduce((sum, o) => sum + Number(o.balance), 0) + Number(ing?.balance || 0);

  return (
    <div className="bookmaker-overview">
      <div className="bookmaker-hero">
        <h3>Overzicht per bookmaker</h3>
        <div className="bookmaker-hero-stat">
          <span className="muted">Totaal vermogen</span>
          <strong>{formatEUR(totalBalance)}</strong>
        </div>
      </div>
      {loading ? (
        <p className="hint-text">Laden…</p>
      ) : (
        <div className="bookmaker-cards">
          {ing && (
            <div className="bookmaker-card is-bank" onClick={() => setSelected('ING')}>
              <div className="bookmaker-card-top">
                <span className="bookmaker-name">
                  <BankIcon />
                  ING
                </span>
                <span className="bookmaker-open-chip bank-chip">Bankrekening</span>
              </div>
              <p className="bookmaker-balance is-bank">{formatEUR(ing.balance)}</p>
              <p className="bank-card-note">Bron van stortingen · doel van opnames</p>
            </div>
          )}
          {activeRows.map(({ bookmaker, balance, openBets }) => (
            <div className="bookmaker-card" key={bookmaker} onClick={() => setSelected(bookmaker)}>
              <div className="bookmaker-card-top">
                <span className="bookmaker-name">
                  {bookmaker}
                  <a
                    href={bookmakerUrl(bookmaker)}
                    target="_blank"
                    rel="noreferrer"
                    className="site-link-btn"
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`${bookmaker} openen in nieuw tabblad`}
                    title={`${bookmaker} openen`}
                  >
                    ↗
                  </a>
                </span>
                <span className="bookmaker-open-chip">{openBets === 0 ? 'Geen open bets' : `${openBets} open`}</span>
              </div>
              <p className="bookmaker-balance">{formatEUR(balance)}</p>
              <div className="bookmaker-card-actions">
                <DepositForm bookmaker={bookmaker} onDone={loadOverview} />
                <WithdrawForm bookmaker={bookmaker} onDone={loadOverview} />
              </div>
            </div>
          ))}
        </div>
      )}
      {!loading && emptyRows.length > 0 && (
        <div className="mini-grid">
          {emptyRows.map(({ bookmaker, balance, openBets }) => (
            <div className="mini-card" key={bookmaker} onClick={() => setSelected(bookmaker)}>
              <div className="mini-top">
                <span className="mini-name">{bookmaker}</span>
                {openBets > 0 && <span className="mini-dot" title={`${openBets} open`} />}
              </div>
              <p className="mini-bal">{formatEUR(balance)}</p>
              <DepositForm bookmaker={bookmaker} onDone={loadOverview} compact />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
