import { useMemo, useState } from 'react';
import { describeBet } from '../markets.js';
import { formatKickoff, toDatetimeLocalValue } from './BetList.jsx';

// Open handmatige selecties (zonder gekoppelde wedstrijd) per wedstrijdnaam,
// zodat je in één keer de aftraptijd van alle picks op hetzelfde duel
// invult. Zonder starttijd eerst - die sorteren nu achteraan en tellen niet
// mee bij het schatten van settled_at of het zoeken naar koppelsuggesties.
function groupManualPicks(picks) {
  const groups = new Map();
  for (const pick of picks) {
    if (pick.match) continue;
    const key = (pick.manualLabel || pick.id).toLowerCase();
    if (!groups.has(key)) groups.set(key, { key, label: pick.manualLabel || 'Handmatige selectie', picks: [] });
    groups.get(key).picks.push(pick);
  }
  const time = (g) => {
    const t = g.picks.find((p) => p.kickoffAt)?.kickoffAt;
    return t ? new Date(t).getTime() : -Infinity;
  };
  return [...groups.values()].sort((a, b) => time(a) - time(b));
}

function KickoffRow({ group, onSave }) {
  const current = group.picks.find((p) => p.kickoffAt)?.kickoffAt || null;
  const mixed = group.picks.some((p) => (p.kickoffAt || null) !== current);
  const [value, setValue] = useState(() => toDatetimeLocalValue(current));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const dirty = value !== toDatetimeLocalValue(current) || (mixed && value);

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      const iso = value ? new Date(value).toISOString() : null;
      await onSave(group.picks.map((p) => p.id), iso);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={`ob-group${current ? '' : ' kickoff-missing'}`}>
      <header className="ob-group-head">
        <div className="ob-group-title">
          <strong>{group.label}</strong>
          <span>
            {current ? formatKickoff(current) : 'geen starttijd'} · {group.picks.map((p) => describeBet(p)).join(' · ')}
          </span>
        </div>
      </header>
      <div className="kickoff-edit-row">
        <input
          type="datetime-local"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setSaved(false);
          }}
          onKeyDown={(e) => e.key === 'Enter' && dirty && save()}
        />
        <button type="button" className="btn btn-primary btn-small" disabled={!dirty || saving} onClick={save}>
          {saving ? 'Opslaan…' : 'Opslaan'}
        </button>
        {saved && !dirty && <span className="amount-positive">Opgeslagen</span>}
      </div>
    </section>
  );
}

export default function KickoffTimesModal({ picks, onSave, onClose }) {
  const groups = useMemo(() => groupManualPicks(picks), [picks]);
  const missing = groups.filter((g) => !g.picks.some((p) => p.kickoffAt)).length;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal open-bets-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>
            Starttijden ({groups.length})
            {missing > 0 && <span className="open-bets-sub"> · {missing} zonder tijd</span>}
          </h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Sluiten" title="Sluiten">
            ×
          </button>
        </div>
        <p className="hint-text live-link-modal-subtitle">
          Handmatig ingevoerde open picks. Gekoppelde wedstrijden halen hun tijd uit de feed en staan hier niet.
        </p>
        {groups.length === 0 ? (
          <p className="hint-text">Geen open handmatige picks.</p>
        ) : (
          <div className="ob-groups">
            {groups.map((group) => (
              <KickoffRow key={group.key} group={group} onSave={onSave} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
