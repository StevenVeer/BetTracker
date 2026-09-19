import { useState } from 'react';
import { dayKey, groupByPlacedPeriod } from '../dailyResults.js';
import { Amount } from './AmountsToggle.jsx';

const GRANULARITIES = [
  { key: 'day', label: 'Dag' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Maand' },
];

function fmt(n) {
  return Number(n).toFixed(2);
}
function signed(n) {
  return (
    <Amount>
      {n >= 0 ? '+ € ' : '− € '}
      {fmt(Math.abs(n))}
    </Amount>
  );
}

// Elke period-key is altijd een dayKey (dag: de dag zelf; week: de maandag;
// maand: de 1e) - dus overal hetzelfde 'YYYY-MM-DD'-formaat, alleen het
// label verschilt per zoom-niveau.
function periodLabel(dateKeyStr, granularity) {
  const [y, m, d] = dateKeyStr.split('-').map(Number);
  if (granularity === 'month') {
    return new Date(y, m - 1, 1).toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' });
  }
  if (granularity === 'week') {
    return `week van ${String(d).padStart(2, '0')}-${String(m).padStart(2, '0')}-${y}`;
  }
  return `${String(d).padStart(2, '0')}-${String(m).padStart(2, '0')}-${y}`;
}

// Synthetisch startpunt op 0, ruim vóór het eerste echte punt, zodat de
// curve altijd zichtbaar vanaf nul vertrekt - de terugstap schaalt mee met
// het zoom-niveau (2 dagen / 1 week / 1 maand) zodat 'm niet wegvalt tegen
// de rest van de reeks.
function buildSeries(periods, granularity) {
  if (periods.length === 0) return [];
  const [y, m, d] = periods[0].date.split('-').map(Number);
  const origin = new Date(y, m - 1, d);
  if (granularity === 'month') origin.setMonth(origin.getMonth() - 1);
  else if (granularity === 'week') origin.setDate(origin.getDate() - 7);
  else origin.setDate(origin.getDate() - 2);
  return [
    { date: dayKey(origin), cum: 0, result: 0, isOrigin: true },
    ...periods.map((p) => ({ date: p.date, cum: p.cumulative, result: p.result, isOrigin: false })),
  ];
}

function buildChart(points, w, h, pad) {
  const cums = points.map((p) => p.cum);
  const min = Math.min(0, ...cums);
  const max = Math.max(0, ...cums);
  const range = max - min || 1;
  const n = points.length;
  const xStep = n > 1 ? (w - pad * 2) / (n - 1) : 0;
  const scaleY = (v) => h - pad - ((v - min) / range) * (h - pad * 2);
  const coords = points.map((p, i) => ({ x: pad + i * xStep, y: scaleY(p.cum) }));
  const line = coords.map((c, i) => (i === 0 ? 'M' : 'L') + c.x.toFixed(1) + ',' + c.y.toFixed(1)).join(' ');
  const base = (h - pad).toFixed(1);
  const area = `${line} L${coords[coords.length - 1].x.toFixed(1)},${base} L${coords[0].x.toFixed(1)},${base} Z`;
  return { coords, line, area, zeroY: scaleY(0) };
}

const CHART_W = 1320;
const CHART_H = 200;
const CHART_PAD = 14;

export default function EquityCurve({ bets, telegramBets }) {
  const [source, setSource] = useState('manual');
  const [granularity, setGranularity] = useState('day');
  const [collapsed, setCollapsed] = useState(true);
  const [hoverIndex, setHoverIndex] = useState(null);

  // Alleen afgeronde bets: een nog-open bet telt in groupByPlacedPeriod als
  // volledig verloren inzet (winst 0) en zou de curve onterecht laten dalen.
  const settled = (source === 'manual' ? bets : telegramBets).filter((b) => b.status !== 'open');
  const periods = groupByPlacedPeriod(settled, granularity);
  const series = buildSeries(periods, granularity);
  const hasData = series.length > 0;

  const total = hasData ? series[series.length - 1].cum : 0;
  const positive = total >= 0;
  const lineColor = positive ? 'var(--win-text)' : 'var(--loss-text)';

  const chart = hasData ? buildChart(series, CHART_W, CHART_H, CHART_PAD) : null;
  // index 0 = het synthetische startpunt (geen echte periode) - alleen de
  // echte datapunten (1..n) zijn hoverbaar.
  const realPoints = hasData ? series.slice(1).map((p, i) => ({ ...p, ...chart.coords[i + 1] })) : [];
  const hovered = hoverIndex !== null ? realPoints[hoverIndex] : null;
  const gradientId = `equityFill-${source}`;

  return (
    <div className={`equity-card ${collapsed ? 'is-collapsed' : ''}`}>
      <div className="equity-head">
        <div className="equity-title">
          <p className="eyebrow">Equity curve</p>
          {hasData && (
            <>
              <div className={`equity-total mono ${positive ? 'profit-positive' : 'profit-negative'}`}>{signed(total)}</div>
              <span className="equity-sub">
                {periodLabel(periods[0].date, granularity)} — {periodLabel(periods[periods.length - 1].date, granularity)}
              </span>
            </>
          )}
        </div>
        <div className="equity-controls">
          <nav className="filters">
            {GRANULARITIES.map((g) => (
              <button
                key={g.key}
                type="button"
                className={`filter-tab ${granularity === g.key ? 'is-active' : ''}`}
                onClick={() => setGranularity(g.key)}
              >
                {g.label}
              </button>
            ))}
          </nav>
          <nav className="filters">
            <button type="button" className={`filter-tab ${source === 'manual' ? 'is-active' : ''}`} onClick={() => setSource('manual')}>
              Eigen bets
            </button>
            <button type="button" className={`filter-tab ${source === 'telegram' ? 'is-active' : ''}`} onClick={() => setSource('telegram')}>
              Telegram
            </button>
          </nav>
          <button
            type="button"
            className="equity-toggle"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Uitklappen' : 'Inklappen'}
            title={collapsed ? 'Uitklappen' : 'Inklappen'}
          >
            <span className="equity-caret" aria-hidden="true">▾</span>
          </button>
        </div>
      </div>

      {!collapsed &&
        (hasData ? (
          <div className="equity-chart-wrap">
            <svg className="equity-chart" viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none">
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={lineColor} stopOpacity="0.28" />
                  <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
                </linearGradient>
              </defs>
              <line x1="0" y1={chart.zeroY} x2={CHART_W} y2={chart.zeroY} stroke="rgba(244,242,232,0.18)" strokeWidth="1" strokeDasharray="4 4" />
              <path d={chart.area} fill={`url(#${gradientId})`} stroke="none" />
              <path d={chart.line} fill="none" stroke={lineColor} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
              {realPoints.map((p, i) => (
                <g key={i}>
                  <circle cx={p.x} cy={p.y} r={i === realPoints.length - 1 ? 5.5 : 3.5} fill={lineColor} stroke={i === realPoints.length - 1 ? 'var(--ink)' : 'none'} strokeWidth="2" />
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r="12"
                    fill="transparent"
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={() => setHoverIndex(i)}
                    onMouseLeave={() => setHoverIndex((cur) => (cur === i ? null : cur))}
                  />
                </g>
              ))}
            </svg>
            {hovered && (
              <div
                className="equity-tooltip"
                style={{ left: `${(hovered.x / CHART_W) * 100}%`, top: `${(hovered.y / CHART_H) * 100}%` }}
              >
                <div className="equity-tooltip-date">{periodLabel(hovered.date, granularity)}</div>
                <div className={`equity-tooltip-total mono ${hovered.cum >= 0 ? 'amount-positive' : 'amount-negative'}`}>{signed(hovered.cum)}</div>
                <div className="equity-tooltip-period mono">{signed(hovered.result)} dit venster</div>
              </div>
            )}
            <div className="equity-axis">
              <span>{periodLabel(series[0].date, granularity)}</span>
              <span>{periodLabel(series[series.length - 1].date, granularity)}</span>
            </div>
          </div>
        ) : (
          <div className="equity-empty">Nog geen afgehandelde bets voor deze bron.</div>
        ))}
    </div>
  );
}
