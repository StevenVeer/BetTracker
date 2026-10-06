// Klik op het extensie-icoon (of Alt+Shift+B) op een bookmakerpagina: de
// extensie pakt de paginatekst + een screenshot van het zichtbare deel, zet
// die klaar in de BetTracker-API en opent de app met ?import=<id>. Daar lees
// je de bets uit en vink je ze af, net als bij de screenshot-import. De
// extensie kent geen bookmakers: het herkennen doet Claude op de server, dus
// er zijn geen selectors die stukgaan bij een redesign.

const APP_URL = 'http://localhost:6070';

// Draait in de pagina. Is er tekst geselecteerd, dan alleen die (handig om
// je te beperken tot één blok), anders de hele zichtbare tekst.
function grabText() {
  const selection = String(window.getSelection?.() || '').trim();
  return selection.length > 20 ? selection : document.body?.innerText || '';
}

async function pageText(tabId) {
  // Sommige bookmakers renderen de betslips in een iframe; probeer daarom
  // alle frames. Frames waar activeTab geen toegang toe geeft laten we vallen.
  let results;
  try {
    results = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: grabText });
  } catch {
    results = await chrome.scripting.executeScript({ target: { tabId }, func: grabText });
  }
  return results
    .map((r) => (typeof r.result === 'string' ? r.result.trim() : ''))
    .filter(Boolean)
    .join('\n\n----- frame -----\n\n');
}

async function screenshot(windowId) {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 85 });
    return { mediaType: 'image/jpeg', data: dataUrl.split(',')[1] };
  } catch {
    return null;
  }
}

function setBadge(text, color, title) {
  chrome.action.setBadgeText({ text });
  if (color) chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setTitle({ title: title || 'Stuur bets naar BetTracker' });
}

async function openApp(importId) {
  const url = `${APP_URL}/?import=${encodeURIComponent(importId)}`;
  const [existing] = await chrome.tabs.query({ url: `${APP_URL}/*` });
  if (existing) {
    await chrome.tabs.update(existing.id, { url, active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || tab.url?.startsWith(APP_URL)) return;
  setBadge('…', '#6b7280', 'Bezig met versturen…');
  try {
    // Screenshot eerst: dat moet gebeuren zolang deze tab nog in beeld is.
    const shot = await screenshot(tab.windowId);
    const text = await pageText(tab.id).catch(() => '');
    if (!text && !shot) throw new Error('Kon deze pagina niet lezen');

    const response = await fetch(`${APP_URL}/api/page-imports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: tab.url, title: tab.title, text, screenshot: shot }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || `BetTracker gaf status ${response.status}`);

    setBadge('', null);
    await openApp(data.id);
  } catch (error) {
    const message = error instanceof TypeError ? 'BetTracker niet bereikbaar op localhost:6070 - draait Docker?' : error.message;
    setBadge('!', '#dc2626', `Mislukt: ${message}`);
    setTimeout(() => setBadge('', null), 8000);
  }
});
