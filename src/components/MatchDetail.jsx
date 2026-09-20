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

// Verdeelt de basisspelers over linies: eerst via de formatie (bv. "4-3-3",
// spelers komen van achter naar voor), anders via de positie-afkortingen.
function lineupRows(lineup) {
  const { starters, formation } = lineup;
  const counts = formation ? formation.split('-').map(Number) : [];
  if (counts.length > 0 && counts.every((n) => n > 0) && counts.reduce((a, b) => a + b, 1) === starters.length) {
    const rows = [[starters[0]]];
    let i = 1;
    for (const n of counts) {
      rows.push(starters.slice(i, i + n));
      i += n;
    }
    return rows;
  }
  const rows = [[], [], [], []];
  for (const p of starters) {
    const pos = p.position || '';
    let k = 3;
    if (pos === 'G') k = 0;
    else if (/^(CD|SW)|B$/.test(pos)) k = 1;
    else if (/^(CM|DM|AM)|M$/.test(pos)) k = 2;
    rows[k].push(p);
  }
  return rows.filter((r) => r.length > 0);
}

function shortName(name) {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(' ') : parts[0];
}

function useIsNarrow() {
  const query = '(max-width: 640px)';
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return narrow;
}

function PitchLines({ vertical }) {
  const w = vertical ? 68 : 105;
  const h = vertical ? 105 : 68;
  return (
    <svg className="md-pitch-lines" viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <g fill="none" stroke="rgba(244, 242, 232, 0.35)" strokeWidth="0.35">
        <rect x="0.5" y="0.5" width={w - 1} height={h - 1} />
        <circle cx={w / 2} cy={h / 2} r="9.15" />
        {vertical ? (
          <>
            <line x1="0.5" y1={h / 2} x2={w - 0.5} y2={h / 2} />
            <rect x="13.85" y="0.5" width="40.3" height="16.5" />
            <rect x="13.85" y={h - 17} width="40.3" height="16.5" />
            <rect x="24.85" y="0.5" width="18.3" height="5.5" />
            <rect x="24.85" y={h - 6} width="18.3" height="5.5" />
          </>
        ) : (
          <>
            <line x1={w / 2} y1="0.5" x2={w / 2} y2={h - 0.5} />
            <rect x="0.5" y="13.85" width="16.5" height="40.3" />
            <rect x={w - 17} y="13.85" width="16.5" height="40.3" />
            <rect x="0.5" y="24.85" width="5.5" height="18.3" />
            <rect x={w - 6} y="24.85" width="5.5" height="18.3" />
          </>
        )}
      </g>
    </svg>
  );
}

function PitchTeam({ lineup, side, vertical }) {
  const rows = lineupRows(lineup);
  return rows.flatMap((row, i) => {
    // Keeper vlak bij de eigen doellijn, de voorste linie tot net voorbij de middellijn.
    const depth = 7 + (i * 40) / Math.max(rows.length - 1, 1);
    const along = side === 'home' ? depth : 100 - depth;
    return row.map((p, j) => {
      const across = ((j + 0.5) * 100) / row.length;
      const style = vertical ? { left: `${across}%`, top: `${along}%` } : { left: `${along}%`, top: `${across}%` };
      return (
        <div className="md-pl" style={style} key={`${side}-${i}-${j}`}>
          <span className={`md-pl-dot is-${side}`}>{p.number}</span>
          <span className="md-pl-name">{shortName(p.name)}</span>
        </div>
      );
    });
  });
}

function BenchList({ lineup, fallbackName }) {
  if (!lineup || lineup.subs.length === 0) return <div />;
  return (
    <div>
      <div className="md-lineup-sub-head">Bank {lineup.team || fallbackName}</div>
      {lineup.subs.map((p, i) => (
        <div className="md-bench-row" key={i}>
          <span className="md-bench-num">{p.number}</span>
          {p.name}
          {p.position && <span className="muted"> · {p.position}</span>}
        </div>
      ))}
    </div>
  );
}

function LineupPitch({ lineups, match }) {
  const vertical = useIsNarrow();
  const { home, away } = lineups;
  const teamLabel = (l, fallback) => (
    <span>
      {l?.team || fallback}
      {l?.formation && <span className="muted"> · {l.formation}</span>}
    </span>
  );
  return (
    <>
      <div className="md-pitch-legend">
        <span className="is-home">{teamLabel(home, match.home)}</span>
        <span className="is-away">{teamLabel(away, match.away)}</span>
      </div>
      <div className={`md-pitch${vertical ? ' is-vertical' : ''}`}>
        <PitchLines vertical={vertical} />
        {home && <PitchTeam lineup={home} side="home" vertical={vertical} />}
        {away && <PitchTeam lineup={away} side="away" vertical={vertical} />}
      </div>
      <div className="md-lineup-grid">
        <BenchList lineup={home} fallbackName={match.home} />
        <BenchList lineup={away} fallbackName={match.away} />
      </div>
    </>
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
        <button type="button" className="btn btn-back btn-small" onClick={onBack}>
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
          {detail.lineups && (
            <div className="md-card md-lineups">
              <div className="md-card-title">Opstellingen</div>
              <LineupPitch lineups={detail.lineups} match={match} />
            </div>
          )}

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


          <p className="hint-text md-source">
            Bron: ESPN · ververst elke 20 seconden zolang deze pagina open staat
            {detail.updatedAt && ` · laatst opgehaald ${new Date(detail.updatedAt).toLocaleTimeString('nl-NL')}`}
          </p>
        </>
      ) : null}
    </div>
  );
}
