import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Markdown from './Markdown.jsx';

const PERIODS = [
  { key: 'day', label: 'Dagrapport exporteren' },
  { key: 'week', label: 'Weekrapport exporteren' },
];

const PERIOD_LABELS = { day: 'dag', week: 'week' };

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });
}

// De datum waarover het rapport gaat staat tussen haakjes in de kop van de
// markdown ("# Dagrapport — Eigen bets (17 september 2026)"); generatedAt is
// alleen het moment van opslaan en kan dus een andere dag zijn.
function noteDateLabel(note) {
  const match = note.content.match(/^#[^\n]*\(([^)\n]+)\)\s*$/m);
  return match ? match[1] : formatDate(note.generatedAt);
}

const NL_MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];

// Sorteersleutel = de datum waarover het rapport gaat (bij een periode zoals
// "14 t/m 20 september 2026" telt de laatste dag); zonder herkenbare datum
// valt hij terug op het opslagmoment.
function noteSortTime(note) {
  const label = noteDateLabel(note);
  const dates = [...label.matchAll(/(\d{1,2})\s+([a-z]+)\s+(\d{4})/gi)];
  const last = dates[dates.length - 1];
  if (last) {
    const month = NL_MONTHS.indexOf(last[2].toLowerCase());
    if (month >= 0) return Date.UTC(Number(last[3]), month, Number(last[1]));
  }
  return new Date(note.generatedAt).getTime();
}

function sortNotes(list) {
  return [...list].sort(
    (a, b) => noteSortTime(b) - noteSortTime(a) || new Date(b.generatedAt) - new Date(a.generatedAt)
  );
}

function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ReportPanel() {
  const [source, setSource] = useState('manual');
  const [loadingPeriod, setLoadingPeriod] = useState(null);
  const [error, setError] = useState(null);
  const [lastExport, setLastExport] = useState(null);

  const [notes, setNotes] = useState([]);
  const [notesLoading, setNotesLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [pastePeriod, setPastePeriod] = useState('week');
  const [pasteContent, setPasteContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [showPasteForm, setShowPasteForm] = useState(false);

  function loadNotes() {
    setNotesLoading(true);
    api
      .getReportNotes(source)
      .then((data) => {
        const sorted = sortNotes(data);
        setNotes(sorted);
        setExpandedId((id) => id ?? sorted[0]?.id ?? null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setNotesLoading(false));
  }

  useEffect(() => {
    setExpandedId(null);
    loadNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  async function handleExport(period) {
    setError(null);
    setLoadingPeriod(period);
    try {
      const data = await api.exportReport(period, source);
      const dateStr = data.generatedAt.slice(0, 10);
      downloadJson(data, `bettracker-${period}rapport-${source}-${dateStr}.json`);
      setLastExport({ period, source, pickCount: data.pickCount });
      setPastePeriod(period);
      setShowPasteForm(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingPeriod(null);
    }
  }

  async function handleSaveNote(e) {
    e.preventDefault();
    if (!pasteContent.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const note = await api.saveReportNote({
        period: pastePeriod,
        source,
        pickCount: lastExport && lastExport.period === pastePeriod ? lastExport.pickCount : null,
        content: pasteContent,
      });
      setNotes((prev) => sortNotes([note, ...prev]));
      setExpandedId(note.id);
      setPasteContent('');
      setShowPasteForm(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteNote(id) {
    try {
      await api.deleteReportNote(id);
      setNotes((prev) => prev.filter((n) => n.id !== id));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <nav className="filters" style={{ marginBottom: 20 }}>
        <button type="button" className={`filter-tab ${source === 'manual' ? 'is-active' : ''}`} onClick={() => setSource('manual')}>
          Eigen bets
        </button>
        <button type="button" className={`filter-tab ${source === 'telegram' ? 'is-active' : ''}`} onClick={() => setSource('telegram')}>
          Telegram
        </button>
      </nav>

      <div className="toolbar-filters" style={{ marginBottom: 20 }}>
        {PERIODS.map((p) => (
          <button
            key={p.key}
            type="button"
            className="btn btn-primary"
            disabled={loadingPeriod !== null}
            onClick={() => handleExport(p.key)}
          >
            {loadingPeriod === p.key ? 'Exporteren…' : p.label}
          </button>
        ))}
      </div>

      {error && <p className="error-text">{error}</p>}

      {lastExport && (
        <div className="card">
          <p className="hint-text" style={{ margin: 0 }}>
            {lastExport.pickCount === 0 ? (
              'Geen afgehandelde bets in deze periode — er is een leeg bestand gedownload.'
            ) : (
              <>
                Bestand met {lastExport.pickCount} picks gedownload ({lastExport.period === 'day' ? 'dag' : 'week'},{' '}
                {lastExport.source === 'manual' ? 'eigen bets' : 'Telegram'}). Geef dit bestand aan Claude om er een
                rapport van te laten schrijven, en plak het resultaat hieronder om het hier te bewaren.
              </>
            )}
          </p>
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <h3>Geschreven rapporten</h3>
          <button type="button" className="btn" onClick={() => setShowPasteForm((v) => !v)}>
            {showPasteForm ? 'Annuleren' : 'Rapport plakken'}
          </button>
        </div>

        {showPasteForm && (
          <form className="bet-form" onSubmit={handleSaveNote} style={{ marginBottom: 20 }}>
            <div className="field-row">
              <label className="field" style={{ maxWidth: 160 }}>
                Periode
                <select value={pastePeriod} onChange={(e) => setPastePeriod(e.target.value)}>
                  <option value="day">Dag</option>
                  <option value="week">Week</option>
                </select>
              </label>
            </div>
            <div className="field-row">
              <label className="field field-grow">
                Rapporttekst (markdown)
                <textarea
                  rows={10}
                  value={pasteContent}
                  onChange={(e) => setPasteContent(e.target.value)}
                  placeholder="Plak hier het rapport dat Claude heeft geschreven op basis van het geëxporteerde bestand…"
                  required
                />
              </label>
            </div>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Opslaan…' : 'Rapport opslaan'}
            </button>
          </form>
        )}

        {notesLoading ? (
          <p className="hint-text">Laden…</p>
        ) : notes.length === 0 ? (
          <p className="hint-text">Nog geen opgeslagen rapporten voor {source === 'manual' ? 'eigen bets' : 'Telegram'}.</p>
        ) : (
          <div className="report-notes">
            {notes.map((note) => {
              const isOpen = expandedId === note.id;
              return (
                <div className="report-note" key={note.id}>
                  <button type="button" className="report-note-toggle" onClick={() => setExpandedId(isOpen ? null : note.id)}>
                    <span>
                      {PERIOD_LABELS[note.period] || note.period}rapport — {noteDateLabel(note)}
                      {note.pickCount != null && <span className="hint-text"> · {note.pickCount} picks</span>}
                    </span>
                    <span aria-hidden="true">{isOpen ? '▲' : '▼'}</span>
                  </button>
                  {isOpen && (
                    <div className="report-note-body">
                      <Markdown content={note.content} />
                      <button type="button" className="btn btn-danger" onClick={() => handleDeleteNote(note.id)}>
                        Verwijderen
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
