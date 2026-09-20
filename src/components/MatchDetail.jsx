import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { FavoriteButton, IN_PLAY_STATUSES, PickLines, statusLabel } from './liveShared.jsx';

// Zelfde interval als het live-overzicht; de server cachet 15 s per wedstrijd,
// dus vaker vragen levert niets op.
const POLL_MS = 20000;

function StatRow({ row }) {
  const total = row.home + row.away;
  const homePct = total > 0 ? (row.home / total) * 100 : 50;
  const fmt = (value, sub) => {
    if (row.percent) return `${Math.round(value)}%`;
    return sub !== undefined && sub !== null ? `${value} · ${sub}%` : String(value);
  };
  return (
    <div className="md-stat">
      <div className="md-stat-label">{row.label}</div>
      <div className="md-stat-line">
        <span className="md-stat-val">{fmt(row.home, row.homeSub)}</span>
        <div className="md-bar" aria-hidden="true">
          <i className="home" style={{ width: `${homePct}%` }} />
          <i className="away" style={{ width: `${100 - homePct}%` }} />
        </div>
        <span className="md-stat-val is-away">{fmt(row.away, row.awaySub)}</span>
      </div>
    </div>
  );
}

// Druk per 5 minuten: boven de middellijn het thuisteam, eronder de gasten.
// Vakjes vóór het eerste snapshot (de pagina was toen nog niet open) blijven
// leeg - ESPN geeft geen minuut-voor-minuut-historie.
function MomentumChart({ momentum, timeline }) {
  const step = momentum.bucketMinutes;
  const lastStart = momentum.buckets[momentum.buckets.length - 1].start;
  const slots = Math.max(90 / step, Math.floor(lastStart / step) + 1);
  const byStart = new Map(momentum.buckets.map((b) => [b.start, b]));
  const max = Math.max(1, ...momentum.buckets.flatMap((b) => [b.home, b.away]));
  const W = 640;
  const H = 110;
  const mid = 55;
  const slotW = W / slots;
  const barW = slotW - 6;
  const firstObserved = Math.floor(momentum.since / step) * step;

  const goals = timeline.filter((e) => e.kind === 'goal' && e.side);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Druk per vijf minuten voor beide teams">
      <line x1="0" y1={mid} x2={W} y2={mid} stroke="rgba(244,242,232,.25)" />
      {Array.from({ length: slots }, (_, i) => {
        const start = i * step;
        const x = i * slotW + 3;
        const b = byStart.get(start);
        if (!b) {
          if (start < firstObserved) return null;
          return <rect key={i} x={x} y={mid - 2} width={barW} height={4} rx={2} fill="rgba(244,242,232,.12)" />;
        }
        const hh = (b.home / max) * (mid - 12);
        const ah = (b.away / max) * (mid - 12);
        return (
          <g key={i}>
            {hh > 0 && <rect x={x} y={mid - hh} width={barW} height={hh} rx={3} fill="var(--gold)" />}
            {ah > 0 && <rect x={x} y={mid} width={barW} height={ah} rx={3} fill="var(--bank)" />}
          </g>
        );
      })}
      {goals.map((g, i) => {
        const minute = parseInt(g.minute, 10);
        if (!Number.isFinite(minute)) return null;
        const cx = Math.min(W - 6, (minute / step) * slotW);
        return <circle key={i} cx={cx} cy={g.side === 'home' ? 6 : H - 16} r={4} fill="var(--chalk)" />;
      })}
      <g fill="rgba(244,242,232,.6)" fontSize="11" textAnchor="middle">
        {[0, 30, 60, 90].filter((m) => m / step <= slots).map((m) => (
          <text key={m} x={Math.max(10, Math.min(W - 10, (m / step) * slotW))} y={H - 2}>
            {m}'
          </text>
        ))}
      </g>
    </svg>
  );
}

const KIND_LABEL = { goal: 'Goal', yellow: 'Geel', red: 'Rood', sub: 'Wissel' };

function TimelineRow({ event, match }) {
  const team = event.side === 'home' ? match.home : event.side === 'away' ? match.away : '';
  let text;
  if (event.kind === 'sub') {
    const [inPlayer, outPlayer] = event.players;
    text = outPlayer ? `${inPlayer} voor ${outPlayer}` : inPlayer;
  } else {
    text = event.players[0] || '';
  }
  // Bij een goal geeft ESPN als tweede naam de aangever.
  const assist = event.kind === 'goal' ? event.players[1] : null;
  return (
    <div className="md-tl-row">
      <span className="md-tl-min">{event.minute}'</span>
      <span className={`md-tl-chip is-${event.kind}`}>{KIND_LABEL[event.kind]}</span>
      <span className="md-tl-text">
        {text}
        {assist && <span className="muted"> (assist {assist})</span>}
        {team && <span className="muted"> · {team}</span>}
      </span>
    </div>
  );
}

function LineupColumn({ lineup, fallbackName }) {
  if (!lineup) return <div />;
  return (
    <div>
      <div className="md-lineup-head">
        {lineup.team || fallbackName}
        {lineup.formation && <span className="muted"> · {lineup.formation}</span>}
      </div>
      {lineup.starters.map((p, i) => (
        <div className="md-lineup-row" key={`s${i}`}>
          <span className="md-lineup-num">{p.number}</span>
          {p.name}
          {p.position && <span className="muted"> · {p.position}</span>}
        </div>
      ))}
      {lineup.subs.length > 0 && <div className="md-lineup-sub-head">Bank</div>}
      {lineup.subs.map((p, i) => (
        <div className="md-lineup-row is-sub" key={`b${i}`}>
          <span className="md-lineup-num">{p.number}</span>
          {p.name}
        </div>
      ))}
    </div>
  );
}

export default function MatchDetail({ listMatch, onBack, onToggleFavorite }) {
  const id = listMatch.id;
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let timer = null;

    function load() {
      api
        .getLiveMatchDetail(id)
        .then((data) => {
          if (cancelled) return;
          setDetail(data);
          setError(null);
          // Een afgelopen wedstrijd verandert niet meer - stoppen met vragen.
          const status = data.match?.status;
          if (status === 'FT' || status === 'AET') return;
          timer = setTimeout(load, POLL_MS);
        })
        .catch((err) => {
          if (cancelled) return;
          setError(err.message);
          timer = setTimeout(load, POLL_MS);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }

    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [id]);

  // Score/status komen mee met de detailrespons (of anders uit de lijst); de
  // favorietstatus altijd uit de lijst, want daar werkt de optimistische
  // ster-toggle op.
  const base = detail?.match || listMatch;
  const match = { ...base, favorite: listMatch.favorite, favoriteSource: listMatch.favoriteSource };
  const picks = base.picks || listMatch.picks;
  const live = IN_PLAY_STATUSES.has(match.status) || match.status === 'HT';

  return (
    <div className="live-scores match-detail">
      <div className="md-top">
        <button type="button" className="btn btn-ghost btn-small" onClick={onBack}>
          ← Live
        </button>
        <span className="md-league">{match.league}</span>
        <FavoriteButton match={match} onToggle={onToggleFavorite} />
      </div>

      <div className="md-score">
        <span className="md-team is-home">{match.home}</span>
        <span className="md-score-num">
          {match.homeScore ?? '–'} : {match.awayScore ?? '–'}
        </span>
        <span className="md-team is-away">{match.away}</span>
      </div>
      <div className="md-status">
        <span className={`live-match-status ${live ? 'is-live' : ''}`}>
          {live && <span className="live-dot" />}
          {live && match.minute ? `${match.minute}' · ` : ''}
          {statusLabel(match.status)}
        </span>
        {detail?.venue && <span className="muted"> · {detail.venue}</span>}
      </div>

      {error && <p className="error-text">{error}</p>}

      {picks && picks.length > 0 && (
        <div className="md-card is-picks">
          <div className="md-card-title">Jouw picks op deze wedstrijd</div>
          <PickLines picks={picks} match={match} />
        </div>
      )}

      {loading ? (
        <p className="hint-text">Laden…</p>
      ) : detail ? (
        <>
          <div className="md-card">
            <div className="md-card-title">
              Statistieken
              <span className="md-legend">
                <i className="home" /> {match.home} <i className="away" /> {match.away}
              </span>
            </div>
            {detail.stats.length > 0 ? (
              detail.stats.map((row) => <StatRow key={row.key} row={row} />)
            ) : (
              <p className="hint-text">Nog geen statistieken beschikbaar.</p>
            )}
          </div>

          <div className="md-card">
            <div className="md-card-title">
              Druk per 5 minuten
              <span className="md-legend">Afgeleid uit schoten, schoten op doel en corners</span>
            </div>
            {detail.momentum ? (
              <>
                <MomentumChart momentum={detail.momentum} timeline={detail.timeline} />
                <p className="hint-text">
                  Boven de lijn drukt {match.home}, eronder {match.away}. Opgebouwd vanaf minuut {detail.momentum.since}, het moment
                  dat deze pagina de wedstrijd voor het eerst ophaalde.
                </p>
              </>
            ) : (
              <p className="hint-text">
                {live
                  ? 'Deze grafiek bouwt zich op terwijl je de pagina open hebt staan.'
                  : 'Alleen beschikbaar voor wedstrijden die je live op deze pagina volgt.'}
              </p>
            )}
          </div>

          <div className="md-card">
            <div className="md-card-title">Tijdlijn</div>
            {detail.timeline.length > 0 ? (
              detail.timeline.map((ev, i) => <TimelineRow key={i} event={ev} match={match} />)
            ) : (
              <p className="hint-text">Nog geen doelpunten, kaarten of wissels.</p>
            )}
          </div>

          {detail.lineups && (
            <details className="md-card md-lineups">
              <summary className="md-card-title">Opstellingen</summary>
              <div className="md-lineup-grid">
                <LineupColumn lineup={detail.lineups.home} fallbackName={match.home} />
                <LineupColumn lineup={detail.lineups.away} fallbackName={match.away} />
              </div>
            </details>
          )}

          <p className="hint-text md-source">
            Bron: ESPN · ververst elke 20 seconden zolang deze pagina open staat
            {detail.updatedAt && ` · laatst opgehaald ${new Date(detail.updatedAt).toLocaleTimeString('nl-NL')}`}
          </p>
        </>
      ) : null}
    </div>
  );
}
