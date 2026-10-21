import InlineIcon from './InlineIcon.jsx';

// Markering voor een selectie met vroege uitbetaling (early payout / 2UP) -
// staat als vlag op de leg i.p.v. in de selectietekst (zie server/earlyPayout.js).
export default function EarlyPayoutBadge({ leg }) {
  if (!leg?.earlyPayout) return null;
  return (
    <span className="ep-badge" title="Vroege uitbetaling">
      <InlineIcon name="bolt" size={10} />
      EP
    </span>
  );
}

// Aan/uit-knop in de lijst met toegevoegde selecties (nieuwe bet, opzetje,
// screenshot-import): dezelfde pill, gedimd als de vlag uit staat.
export function EarlyPayoutToggle({ value, onChange }) {
  return (
    <button
      type="button"
      className={`ep-badge ep-toggle${value ? ' is-on' : ''}`}
      onClick={() => onChange(!value)}
      aria-pressed={Boolean(value)}
      title={value ? 'Vroege uitbetaling - klik om uit te zetten' : 'Vroege uitbetaling aanzetten'}
    >
      <InlineIcon name="bolt" size={10} />
      EP
    </button>
  );
}
