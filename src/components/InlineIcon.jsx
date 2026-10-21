// Kleine lijn-iconen voor in knoppen. Oswald (het knoppenfont) heeft geen
// pijltekens zoals ← of ↓, waardoor de browser die uit een fallback-font
// haalt - scheef en op een andere hoogte dan de tekst. Een SVG in
// currentColor lijnt altijd netjes uit en kleurt mee met hover.
const PATHS = {
  'arrow-left': 'M19 12H5M11 6l-6 6 6 6',
  'sort-time': 'M4 6h10M4 12h7M4 18h4M18 5v14M15 16l3 3 3-3',
  'sort-default': 'M4 6h16M4 12h16M4 18h16',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3',
};

export default function InlineIcon({ name, size = 12 }) {
  return (
    <svg className="inline-icon" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
