import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import DecimalInput from './DecimalInput.jsx';
import InlineIcon from './InlineIcon.jsx';
import { EarlyPayoutToggle } from './EarlyPayoutBadge.jsx';

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

// Een losse datum ("2026-10-03") leest new Date() als middernacht UTC - dat
// wordt hier 02:00. Zonder tijd dus als lokale datum behandelen.
function parseLocal(iso) {
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00` : iso);
}

function toLocalInput(iso) {
  if (!iso) return '';
  const d = parseLocal(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const hasOdds = (leg) => Number(leg.odds) >= 1.01;
const matchKey = (leg) => `${leg.home.trim().toLowerCase()}|${leg.away.trim().toLowerCase()}`;

const round2 = (n) => Math.round(n * 100) / 100;

// Bookmakers tonen bij meerdere selecties op dezelfde wedstrijd (bet builder,
// "Dubbel" op één wedstrijd) vaak alleen de gezamenlijke odds, die het model
// dan bij één van die legs zet terwijl de rest leeg blijft. Deze functie
// verdeelt de odds zo dat het product weer op de totale odds uitkomt
// (meetkundig: elke leg krijgt de n-de machtswortel). Let op: de verdeelde
// odds staan niet zo op de slip; de totale odds blijven leidend.
// - Dekken de ingevulde odds samen al het totaal, dan zijn het gezamenlijke
//   odds per wedstrijd: per wedstrijd verdelen over al zijn legs.
// - Anders verdelen we het restant (totaal / ingevulde odds) over de lege legs.
// Geeft null terug als er niets zinnigs af te leiden valt.
function fillMissingOdds(draft) {
  const total = Number(draft.odds);
  const missing = draft.legs.filter((leg) => !hasOdds(leg));
  if (!(total > 1) || missing.length === 0) return null;
  const present = draft.legs.filter(hasOdds).reduce((acc, leg) => acc * Number(leg.odds), 1);
  const residual = total / present;

  let fill;
  if (Math.abs(residual - 1) < 0.02) {
    const groups = new Map();
    for (const leg of draft.legs) groups.set(matchKey(leg), [...(groups.get(matchKey(leg)) || []), leg]);
    const perLeg = new Map();
    for (const legs of groups.values()) {
      if (legs.every(hasOdds)) continue;
      // Een wedstrijd met alleen lege legs valt hier niet te vullen: het totaal is al op.
      if (!legs.some(hasOdds)) return null;
      const groupOdds = legs.filter(hasOdds).reduce((acc, leg) => acc * Number(leg.odds), 1);
      for (const leg of legs) perLeg.set(leg, round2(groupOdds ** (1 / legs.length)));
    }
    fill = (leg) => perLeg.get(leg);
  } else if (residual >= 1.01) {
    const each = round2(residual ** (1 / missing.length));
    fill = (leg) => (hasOdds(leg) ? undefined : each);
  } else {
    return null;
  }

  const legs = draft.legs.map((leg) => {
    const odds = fill(leg);
    return odds ? { ...leg, odds: String(Math.max(odds, 1.01)) } : leg;
  });
  if (legs.some((leg) => !hasOdds(leg))) return null;
  return { legs, notes: [draft.notes, 'odds per leg verdeeld uit totaal'].filter(Boolean).join(' - ') };
}

function toDraft(bet, bookmakers) {
  const match = bookmakers.find((b) => b.toLowerCase() === String(bet.bookmaker || '').toLowerCase());
  const settledAt = bet.settledAt && !Number.isNaN(parseLocal(bet.settledAt).getTime()) ? parseLocal(bet.settledAt).toISOString() : null;
  return {
    include: !bet.duplicateOf,
    duplicate: Boolean(bet.duplicateOf),
    bookmaker: match || '',
    stake: bet.stake != null ? String(bet.stake) : '',
    // Ontbreken de totale odds maar zijn inzet en uitbetaling wel zichtbaar,
    // dan volgen de odds daaruit.
    odds:
      bet.odds != null
        ? String(bet.odds)
        : bet.stake > 0 && bet.payout > 0
          ? String(Math.round((bet.payout / bet.stake) * 100) / 100)
          : '',
    status: bet.status || 'open',
    payout: bet.payout != null ? String(bet.payout) : '',
    placedAt: toLocalInput(bet.placedAt),
    settledAt,
    // Coupon-nummer in de notitie: daarmee herkent een volgende import de bet
    // als al aanwezig.
    notes: [bet.couponId && `Coupon ${bet.couponId}`, bet.note].filter(Boolean).join(' - '),
    legs: (bet.legs || []).map((leg) => ({
      home: leg.home || '',
      away: leg.away || '',
      selection: leg.selection || '',
      odds: leg.odds != null ? String(leg.odds) : '',
      kickoffAt: toLocalInput(leg.kickoffAt),
      parts: (leg.parts || []).map((part) => ({ market: part.market || '', pick: part.pick || '' })),
      earlyPayout: Boolean(leg.earlyPayout),
    })),
  };
}

const isBetBuilder = (leg) => leg.parts.length > 1;

// selection blijft bij een bet builder een samengevoegde tekst: rapporten,
// duplicaatherkenning en link-suggesties lezen alleen dat veld.
const partText = (part) => [part.market.trim(), part.pick.trim()].filter(Boolean).join(': ');

function legSelection(leg) {
  const parts = leg.parts.filter((part) => part.pick.trim());
  if (parts.length < 2) return leg.selection.trim() || (parts[0] ? partText(parts[0]) : '');
  return `${parts.map(partText).join(' + ')} (bet builder)`;
}

function draftProblem(draft) {
  if (!draft.bookmaker) return 'kies een bookmaker';
  if (!(Number(draft.stake) > 0)) return 'vul een inzet in';
  if (draft.legs.length === 0) return 'geen selecties';
  for (const leg of draft.legs) {
    if (isBetBuilder(leg) ? leg.parts.some((part) => !part.pick.trim()) : !legSelection(leg)) return 'selectie ontbreekt';
    if (!leg.home.trim() && !leg.away.trim()) return 'wedstrijd ontbreekt';
    if (!(Number(leg.odds) >= 1.01)) return 'odds ontbreken';
  }
  return null;
}

function legOddsProduct(draft) {
  return draft.legs.reduce((acc, leg) => acc * Number(leg.odds || 0), 1);
}

const METHOD_LABELS = {
  text: 'uit de paginatekst',
  screenshot: 'via het screenshot (geen bruikbare paginatekst)',
  'screenshot-fallback': 'via het screenshot (de paginatekst leverde niets op)',
};

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

// pageImportId: gezet als de app geopend is vanuit de browserextensie
// (?import=<id>); dan lezen we die pagina meteen uit i.p.v. op screenshots te
// wachten.
export default function ScreenshotImportModal({ onClose, onCreated, pageImportId = null }) {
  const [images, setImages] = useState([]);
  const [drafts, setDrafts] = useState(null);
  const [bookmakers, setBookmakers] = useState([]);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [pageImport, setPageImport] = useState(null);
  const fileInput = useRef(null);

  useEffect(() => {
    api.getBookmakers().then(setBookmakers).catch(() => {});
  }, []);

  async function readPageImport(method) {
    setReading(true);
    setError(null);
    setDrafts(null);
    try {
      const [result, list] = await Promise.all([api.extractPageImport(pageImportId, method), api.getBookmakers()]);
      setBookmakers(list);
      setPageImport(result);
      if (result.bets.length === 0) {
        setError(result.skippedKnown > 0 ? 'Geen nieuwe bets: alles op deze pagina staat er al in.' : 'Geen bets gevonden op deze pagina.');
      }
      setDrafts(result.bets.map((bet) => toDraft(bet, list)));
    } catch (err) {
      setError(err.message);
    } finally {
      setReading(false);
    }
  }

  useEffect(() => {
    if (pageImportId) readPageImport();
  }, [pageImportId]);

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

  function updatePart(index, legIndex, partIndex, patch) {
    setDrafts((prev) =>
      prev.map((d, i) =>
        i === index
          ? { ...d, legs: d.legs.map((l, j) => (j === legIndex ? { ...l, parts: l.parts.map((p, k) => (k === partIndex ? { ...p, ...patch } : p)) } : l)) }
          : d
      )
    );
  }

  function removeLeg(index, legIndex) {
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, legs: d.legs.filter((_, j) => j !== legIndex) } : d)));
  }

  // Valt een bet builder terug naar één onderdeel, dan wordt het weer een
  // gewone leg met dat onderdeel als selectie.
  function removePart(index, legIndex, partIndex) {
    const leg = drafts[index].legs[legIndex];
    const parts = leg.parts.filter((_, k) => k !== partIndex);
    updateLeg(index, legIndex, parts.length > 1 ? { parts } : { parts: [], selection: legSelection({ ...leg, selection: '', parts }) });
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
          // Bij verloren/void geen override: de uitbetaling is dan niet relevant.
          potentialPayout: draft.payout !== '' && !['lost', 'void'].includes(draft.status) ? Number(draft.payout) : undefined,
          placedAt: draft.placedAt ? new Date(draft.placedAt).toISOString() : undefined,
          notes: draft.notes || undefined,
          legs: draft.legs.map((leg) => ({
            match: null,
            manualLabel: [leg.home.trim(), leg.away.trim()].filter(Boolean).join(' - '),
            market: 'anders',
            selection: legSelection(leg),
            parts: isBetBuilder(leg) ? leg.parts.map((part) => ({ market: part.market.trim() || null, pick: part.pick.trim() })) : undefined,
            odds: Number(leg.odds),
            // Aftrap bepaalt de geschatte afhandeltijd (einde laatste wedstrijd).
            kickoffAt: leg.kickoffAt ? new Date(leg.kickoffAt).toISOString() : undefined,
            earlyPayout: leg.earlyPayout,
          })),
        });
        let final = bet;
        if (draft.status !== 'open') {
          const patch = { status: draft.status };
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
          <h3>{pageImportId ? 'Bets importeren uit pagina' : 'Bets importeren uit screenshot'}</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Sluiten" title="Sluiten">
            ×
          </button>
        </div>

        {pageImportId && (
          <div className="import-page-info">
            {reading && !drafts && <p className="hint-text">Pagina uitlezen…</p>}
            {pageImport && (
              <p className="hint-text">
                Gelezen {METHOD_LABELS[pageImport.method] || ''}
                {hostOf(pageImport.url) ? ` van ${hostOf(pageImport.url)}` : ''}.
                {pageImport.skippedKnown > 0 &&
                  ` ${pageImport.skippedKnown} bet${pageImport.skippedKnown === 1 ? '' : 's'} stond${pageImport.skippedKnown === 1 ? '' : 'en'} er al in en ${pageImport.skippedKnown === 1 ? 'is' : 'zijn'} overgeslagen.`}
              </p>
            )}
            {pageImport?.screenshot && (
              <div className="import-thumbs">
                <div className="import-thumb">
                  <img src={`data:${pageImport.screenshot.mediaType};base64,${pageImport.screenshot.data}`} alt="Screenshot van de pagina" />
                </div>
              </div>
            )}
          </div>
        )}

        {!pageImportId && (
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
        )}

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

        {!pageImportId && images.length > 0 && !drafts && (
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
                      {draft.legs.some((leg) => !hasOdds(leg)) && fillMissingOdds(draft) && (
                        <button type="button" className="btn btn-ghost btn-small" onClick={() => updateDraft(i, fillMissingOdds(draft))}>
                          Odds aanvullen
                        </button>
                      )}
                      {draft.notes && <span className="muted">{draft.notes}</span>}
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
                        <DecimalInput value={draft.stake} onChange={(e) => updateDraft(i, { stake: e.target.value })} />
                      </label>
                      <label className="field">
                        <span>Totale odds</span>
                        <DecimalInput value={draft.odds} onChange={(e) => updateDraft(i, { odds: e.target.value })} />
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
                      {draft.status !== 'lost' && draft.status !== 'void' && (
                        <label className="field">
                          <span>{draft.status === 'open' ? 'Mogelijke uitbetaling (€)' : 'Uitbetaling (€)'}</span>
                          <DecimalInput
                            placeholder={Number(draft.stake) > 0 && Number(draft.odds) > 0 ? (Number(draft.stake) * Number(draft.odds)).toFixed(2) : ''}
                            value={draft.payout}
                            onChange={(e) => updateDraft(i, { payout: e.target.value })}
                          />
                        </label>
                      )}
                      <label className="field import-field-date">
                        <span>Geplaatst</span>
                        <input type="datetime-local" value={draft.placedAt} onChange={(e) => updateDraft(i, { placedAt: e.target.value })} />
                      </label>
                    </div>
                    {draft.legs.map((leg, j) => (
                      <div key={j}>
                      <div className="import-leg">
                        <input placeholder="Thuis" value={leg.home} onChange={(e) => updateLeg(i, j, { home: e.target.value })} />
                        <input placeholder="Uit" value={leg.away} onChange={(e) => updateLeg(i, j, { away: e.target.value })} />
                        {isBetBuilder(leg) ? (
                          <span className="import-leg-builder">Bet builder · {leg.parts.length} selecties</span>
                        ) : (
                          <input placeholder="Selectie" value={leg.selection} onChange={(e) => updateLeg(i, j, { selection: e.target.value })} />
                        )}
                        <DecimalInput
                          className="import-leg-odds"
                          placeholder="Odds"
                          value={leg.odds}
                          onChange={(e) => updateLeg(i, j, { odds: e.target.value })}
                        />
                        <EarlyPayoutToggle value={leg.earlyPayout} onChange={(on) => updateLeg(i, j, { earlyPayout: on })} />
                        {/* Geen aftrap-veld: een uitgelezen aftrap gaat ongezien mee, en
                            anders komt hij via "Koppel games". */}
                        <button type="button" className="import-part-delete" aria-label="Selectie verwijderen" title="Selectie verwijderen" onClick={() => removeLeg(i, j)}>
                          <InlineIcon name="trash" size={16} />
                        </button>
                      </div>
                      {isBetBuilder(leg) && (
                        <div className="import-leg-parts">
                          {leg.parts.map((part, k) => (
                            <div className="import-leg-part" key={k}>
                              <input placeholder="Markt" value={part.market} onChange={(e) => updatePart(i, j, k, { market: e.target.value })} />
                              <input placeholder="Keuze" value={part.pick} onChange={(e) => updatePart(i, j, k, { pick: e.target.value })} />
                              <button type="button" className="import-part-delete" aria-label="Onderdeel verwijderen" title="Onderdeel verwijderen" onClick={() => removePart(i, j, k)}>
                                <InlineIcon name="trash" size={16} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
            <div className="import-actions">
              {pageImportId ? (
                pageImport?.method === 'text' &&
                pageImport.hasScreenshot && (
                  <button type="button" className="btn btn-ghost" onClick={() => readPageImport('screenshot')} disabled={saving || reading}>
                    Via screenshot uitlezen
                  </button>
                )
              ) : (
                <button type="button" className="btn btn-ghost" onClick={() => setDrafts(null)} disabled={saving}>
                  Opnieuw uitlezen
                </button>
              )}
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
