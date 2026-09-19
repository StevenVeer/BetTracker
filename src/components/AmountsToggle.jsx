import { createContext, useContext, useEffect, useState } from 'react';

const STORAGE_KEY = 'bettracker-amounts-visible';

const AmountsVisibilityContext = createContext(true);

export function useAmountsVisible() {
  const [visible, setVisible] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) !== 'false';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(visible));
    } catch {
      // localStorage kan geblokkeerd zijn (bv. privémodus) - voorkeur onthouden we dan niet, geen probleem.
    }
  }, [visible]);

  return { visible, setVisible };
}

export function AmountsVisibilityProvider({ visible, children }) {
  return <AmountsVisibilityContext.Provider value={visible}>{children}</AmountsVisibilityContext.Provider>;
}

// Vervangt een bedrag door stippen (zelfde kleur/positie als het origineel,
// geen blur) zodra de eye-toggle uit staat - net als bij Yahoo Finance/
// Robinhood. `children` is de al-geformatteerde waarde (getal of tekst).
export function Amount({ children }) {
  const visible = useContext(AmountsVisibilityContext);
  if (visible) return children;
  return (
    <span className="amount-dots" aria-hidden="true">
      •••••
    </span>
  );
}

export default function AmountsToggle({ visible, setVisible }) {
  return (
    <button
      type="button"
      className="btn icon-btn amounts-toggle"
      onClick={() => setVisible((v) => !v)}
      aria-pressed={!visible}
      aria-label={visible ? 'Bedragen verbergen' : 'Bedragen tonen'}
      title={visible ? 'Bedragen verbergen' : 'Bedragen tonen'}
    >
      {visible ? (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M1.5 12S5.5 4.5 12 4.5 22.5 12 22.5 12 18.5 19.5 12 19.5 1.5 12 1.5 12Z" />
          <circle cx="12" cy="12" r="3.25" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9.9 5.02A10.9 10.9 0 0 1 12 4.5c6.5 0 10.5 7.5 10.5 7.5a17.6 17.6 0 0 1-3.62 4.59M6.53 6.53C3.4 8.55 1.5 12 1.5 12S5.5 19.5 12 19.5a10.7 10.7 0 0 0 4.24-.86" />
          <path d="M9.88 9.88a3.25 3.25 0 0 0 4.24 4.24" />
          <path d="M2 2l20 20" />
        </svg>
      )}
    </button>
  );
}
