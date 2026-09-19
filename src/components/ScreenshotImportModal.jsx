import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

const MAX_DIMENSION = 1600;
const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'won', label: 'Gewonnen' },
  { value: 'lost', label: 'Verloren' },
  { value: 'void', label: 'Void' },
  { value: 'cashed_out', label: 'Cash-out' },
];

// Screenshots zijn vaak enkele MB's groot; verkleinen + JPEG houdt de upload
// (en de API-kosten) klein terwijl tekst nog prima leesbaar blijft.
function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
      resolve({ preview: dataUrl, mediaType: 'image/jpeg', data: dataUrl.split(',')[1] });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Kon de afbeelding niet lezen'));
    };
    img.src = url;
  });
}

function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toDraft(bet, bookmakers) {
  const match = bookmakers.find((b) => b.toLowerCase() === String(bet.bookmaker || '').toLowerCase());
  const settledAt = bet.settledAt && !Number.isNaN(new Date(bet.settledAt).getTime()) ? new Date(bet.settledAt).toISOString() : null;
  return {
    include: !bet.duplicateOf,
    duplicate: Boolean(bet.duplicateOf),
    bookmaker: match || '',
    stake: bet.stake != null ? String(bet.stake) : '',
    odds: bet.odds != null ? String(bet.odds) : '',
    status: bet.status || 'open',
    payout: bet.payout != null ? String(bet.payout) : '',
    placedAt: toLocalInput(bet.placedAt),
    settledAt,
    legs: (bet.legs || []).map((leg) => ({
      home: leg.home || '',
      away: leg.away || '',
      selection: leg.selection || '',
      odds: leg.odds != null ? String(leg.odds) : '',
    })),
  };
}

function draftProblem(draft) {
  if (!draft.bookmaker) return 'kies een bookmaker';
  if (!(Number(draft.stake) > 0)) return 'vul een inzet in';
  if (draft.legs.length === 0) return 'geen selecties';
  for (const leg of draft.legs) {
    if (!leg.selection.trim()) return 'selectie ontbreekt';
    if (!leg.home.trim() && !leg.away.trim()) return 'wedstrijd ontbreekt';
    if (!(Number(leg.odds) >= 1.01)) return 'odds ontbreken';
  }
  return null;
}

function legOddsProduct(draft) {
  return draft.legs.reduce((acc, leg) => acc * Number(leg.odds || 0), 1);
}

export default function ScreenshotImportModal({ onClose, onCreated }) {
  const [images, setImages] = useState([]);
  const [drafts, setDrafts] = useState(null);
  const [bookmakers, setBookmakers] = useState([]);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef(null);

  useEffect(() => {
    api.getBookmakers().then(setBookmakers).catch(() => {});
  }, []);

  async function addFiles(files) {
    const imageFiles = [...files].filter((f) => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    setError(null);
    try {
      const converted = await Promise.all(imageFiles.map(fileToImage));
      setImages((prev) => [...prev, ...converted]);
      setDrafts(null);
    } catch (err) {
      setError(err.message);
    }
  }

  // Ctrl+V overal in de modal, zodat je direct een screenshot uit het
  // klembord kunt plakken zonder eerst iets te selecteren.
  useEffect(() => {
    function onPaste(e) {
      const files = [...(e.clipboardData?.files || [])];
      if (files.length > 0) {
        e.preventDefault();
        addFiles(files);
      }
    }
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);

  async function handleRead() {
    setReading(true);
    setError(null);
    try {
      const { bets } = await api.importScreenshot(images.map(({ mediaType, data }) => ({ mediaType, data })));
      if (bets.length === 0) setError('Geen bets gevonden op deze screenshot(s).');
      setDrafts(bets.map((bet) => toDraft(bet, bookmakers)));
    } catch (err) {
      setError(err.message);
    } finally {
      setReading(false);
    }
  }

  function updateDraft(index, patch) {
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }

  function updateLeg(index, legIndex, patch) {
    setDrafts((prev) =>
      prev.map((d, i) =>
        i === index ? { ...d, legs: d.legs.map((l, j) => (j === legIndex ? { ...l, ...patch } : l)) } : d
      )
    );
  }

  const selected = drafts ? drafts.filter((d) => d.include) : [];
  const invalidCount = selected.filter(draftProblem).length;

  async function handleSave() {
    setSaving(true);
    setError(null);
    const failed = new Set();
    let created = 0;
    let lastError = null;
    for (const [index, draft] of drafts.entries()) {
      if (!draft.include) continue;
      try {
        const totalOdds = draft.odds ? Number(draft.odds) : legOddsProduct(draft);
        const bet = await api.createBet({
          bookmaker: draft.bookmaker,
          stake: Number(draft.stake),
          odds: totalOdds,
          placedAt: draft.placedAt ? new Date(draft.placedAt).toISOString() : undefined,
          legs: draft.legs.map((leg) => ({
            match: null,
            manualLabel: [leg.home.trim(), leg.away.trim()].filter(Boolean).join(' - '),
            market: 'anders',
            selection: leg.selection.trim(),
            odds: Number(leg.odds),
          })),
        });
        let final = bet;
        if (draft.status !== 'open') {
          const patch = { status: draft.status };
          if (draft.payout !== '') patch.potentialPayout = Number(draft.payout);
          if (draft.settledAt) patch.settledAt = draft.settledAt;
          final = await api.updateBet(bet.id, patch);
        }
        onCreated(final);
        created += 1;
      } catch (err) {
        failed.add(index);
        lastError = `Bet ${index + 1}: ${err.message}`;
      }
    }
    setSaving(false);
    if (failed.size === 0) {
      onClose();
    } else {
      // Alleen wat mislukte blijft staan, zodat opnieuw proberen geen dubbelen maakt.
      setDrafts((prev) => prev.filter((_, i) => failed.has(i)));
      setError(`${created} toegevoegd, ${failed.size} mislukt. ${lastError}`);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal import-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Bets importeren uit screenshot</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Sluiten" title="Sluiten">
            ×
          </button>
        </div>

        <div
          className={`import-drop${dragging ? ' is-dragging' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            addFiles(e.dataTransfer.files);
          }}
          onClick={() => fileInput.current?.click()}
        >
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <strong>Plak (Ctrl+V), sleep of klik om screenshots toe te voegen</strong>
          <span className="muted">Meerdere screenshots tegelijk mag.</span>
        </div>

        {images.length > 0 && (
          <div className="import-thumbs">
            {images.map((img, i) => (
              <div className="import-thumb" key={i}>
                <img src={img.preview} alt={`Screenshot ${i + 1}`} />
                <button
                  type="button"
                  aria-label="Verwijderen"
                  onClick={() => {
                    setImages((prev) => prev.filter((_, j) => j !== i));
                    setDrafts(null);
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {images.length > 0 && !drafts && (
          <button type="button" className="btn btn-primary import-read-btn" onClick={handleRead} disabled={reading}>
            {reading ? 'Uitlezen…' : `Bets uitlezen (${images.length} screenshot${images.length === 1 ? '' : 's'})`}
          </button>
        )}

        {error && <p className="error-text">{error}</p>}

        {drafts && drafts.length > 0 && (
          <>
            <p className="hint-text">Controleer en pas aan waar nodig. Er wordt pas iets opgeslagen na het toevoegen.</p>
            <div className="import-drafts">
              {drafts.map((draft, i) => {
                const problem = draft.include ? draftProblem(draft) : null;
                return (
                  <div className={`import-draft${draft.include ? '' : ' is-skipped'}`} key={i}>
                    <div className="import-draft-head">
                      <label className="import-include">
                        <input
                          type="checkbox"
                          checked={draft.include}
                          onChange={(e) => updateDraft(i, { include: e.target.checked })}
                        />
                        {draft.legs.length > 1 ? `Combi (${draft.legs.length})` : 'Single'}
                      </label>
                      {draft.duplicate && <span className="bet-tag">Mogelijk al aanwezig</span>}
                      {problem && <span className="import-problem">{problem}</span>}
                    </div>
                    <div className="import-fields">
                      <label className="field">
                        <span>Bookmaker</span>
                        <select value={draft.bookmaker} onChange={(e) => updateDraft(i, { bookmaker: e.target.value })}>
                          <option value="">Kies…</option>
                          {bookmakers.map((b) => (
                            <option key={b} value={b}>
                              {b}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span>Inzet (€)</span>
                        <input type="number" step="0.01" min="0" value={draft.stake} onChange={(e) => updateDraft(i, { stake: e.target.value })} />
                      </label>
                      <label className="field">
                        <span>Totale odds</span>
                        <input type="number" step="0.01" min="1" value={draft.odds} onChange={(e) => updateDraft(i, { odds: e.target.value })} />
                      </label>
                      <label className="field">
                        <span>Status</span>
                        <select value={draft.status} onChange={(e) => updateDraft(i, { status: e.target.value })}>
                          {STATUS_OPTIONS.map((s) => (
                            <option key={s.value} value={s.value}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      {(draft.status === 'won' || draft.status === 'cashed_out') && (
                        <label className="field">
                          <span>Uitbetaling (€)</span>
                          <input type="number" step="0.01" min="0" value={draft.payout} onChange={(e) => updateDraft(i, { payout: e.target.value })} />
                        </label>
                      )}
                      <label className="field">
                        <span>Geplaatst</span>
                        <input type="datetime-local" value={draft.placedAt} onChange={(e) => updateDraft(i, { placedAt: e.target.value })} />
                      </label>
                    </div>
                    {draft.legs.map((leg, j) => (
                      <div className="import-leg" key={j}>
                        <input placeholder="Thuis" value={leg.home} onChange={(e) => updateLeg(i, j, { home: e.target.value })} />
                        <input placeholder="Uit" value={leg.away} onChange={(e) => updateLeg(i, j, { away: e.target.value })} />
                        <input placeholder="Selectie" value={leg.selection} onChange={(e) => updateLeg(i, j, { selection: e.target.value })} />
                        <input
                          className="import-leg-odds"
                          type="number"
                          step="0.01"
                          min="1"
                          placeholder="Odds"
                          value={leg.odds}
                          onChange={(e) => updateLeg(i, j, { odds: e.target.value })}
                        />
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
            <div className="import-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setDrafts(null)} disabled={saving}>
                Opnieuw uitlezen
              </button>
              <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving || selected.length === 0 || invalidCount > 0}>
                {saving ? 'Toevoegen…' : `${selected.length} bet${selected.length === 1 ? '' : 's'} toevoegen`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
