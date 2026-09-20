async function request(path, options) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || `Request naar ${path} mislukt (${response.status})`);
  }
  return data;
}

export const api = {
  getMatches: (date) => request(`/api/matches?date=${encodeURIComponent(date)}`),
  getBookmakers: () => request('/api/bookmakers'),
  getBets: (status = 'all', source = 'all') =>
    request(`/api/bets?status=${encodeURIComponent(status)}&source=${encodeURIComponent(source)}`),
  createBet: (payload) => request('/api/bets', { method: 'POST', body: JSON.stringify(payload) }),
  importScreenshot: (images) =>
    request('/api/bets/import-screenshot', { method: 'POST', body: JSON.stringify({ images }) }),
  updateBet: (id, patch) => request(`/api/bets/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteBet: (id) => request(`/api/bets/${id}`, { method: 'DELETE' }),
  updateLeg: (legId, patch) => request(`/api/bet-legs/${legId}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  refreshScores: () => request('/api/scores/refresh', { method: 'POST' }),
  getScoresUsage: () => request('/api/scores/usage'),
  getBookmakerOverview: () => request('/api/bookmakers/overview'),
  getMarketOverview: (source = 'manual') => request(`/api/markets/overview?source=${encodeURIComponent(source)}`),
  exportReport: (period, source = 'manual') =>
    request(`/api/reports/export?period=${encodeURIComponent(period)}&source=${encodeURIComponent(source)}`),
  getReportNotes: (source = 'manual') => request(`/api/reports/notes?source=${encodeURIComponent(source)}`),
  saveReportNote: (payload) => request('/api/reports/notes', { method: 'POST', body: JSON.stringify(payload) }),
  deleteReportNote: (id) => request(`/api/reports/notes/${id}`, { method: 'DELETE' }),
  getBookmakerLedger: (bookmaker) => request(`/api/bookmakers/${encodeURIComponent(bookmaker)}/ledger`),
  addWithdrawal: (bookmaker, amount) =>
    request(`/api/bookmakers/${encodeURIComponent(bookmaker)}/withdrawals`, {
      method: 'POST',
      body: JSON.stringify({ amount }),
    }),
  addDeposit: (bookmaker, amount) =>
    request(`/api/bookmakers/${encodeURIComponent(bookmaker)}/deposits`, {
      method: 'POST',
      body: JSON.stringify({ amount }),
    }),
  addCorrection: (bookmaker, amount) =>
    request(`/api/bookmakers/${encodeURIComponent(bookmaker)}/corrections`, {
      method: 'POST',
      body: JSON.stringify({ amount }),
    }),
  addIngCorrection: (amount) =>
    request('/api/ing/corrections', {
      method: 'POST',
      body: JSON.stringify({ amount }),
    }),
  getIngLedger: () => request('/api/ing/ledger'),
  refreshTelegramOdds: () => request('/api/telegram/refresh-odds', { method: 'POST' }),
  backfillTelegram: () => request('/api/telegram/backfill', { method: 'POST' }),
  getLiveScores: () => request('/api/live-scores'),
  getLiveMatchOverlay: () => request('/api/live-scores/open-matches'),
  getLiveMatchDetail: (liveId) => request(`/api/live-scores/${encodeURIComponent(liveId)}/detail`),
  linkLiveMatch: (matchId, liveId) =>
    request(`/api/matches/${encodeURIComponent(matchId)}/live-link`, { method: 'PATCH', body: JSON.stringify({ liveId }) }),
  linkLegToLiveMatch: (legId, liveMatch) =>
    request(`/api/bet-legs/${encodeURIComponent(legId)}/live-link`, {
      method: 'PATCH',
      body: JSON.stringify({
        liveId: liveMatch.id,
        home: liveMatch.home,
        away: liveMatch.away,
        league: liveMatch.league,
        kickoff: liveMatch.kickoff,
      }),
    }),
  favoriteMatch: (liveId) => request(`/api/favorites/${encodeURIComponent(liveId)}`, { method: 'POST' }),
  unfavoriteMatch: (liveId) => request(`/api/favorites/${encodeURIComponent(liveId)}`, { method: 'DELETE' }),
  getPlannedBets: () => request('/api/planned-bets'),
  createPlannedBet: (payload) => request('/api/planned-bets', { method: 'POST', body: JSON.stringify(payload) }),
  deletePlannedBet: (id) => request(`/api/planned-bets/${id}`, { method: 'DELETE' }),
};
