// Klik op het extensie-icoon (of Alt+Shift+F) opent het zijpaneel met je
// favoriete wedstrijden. Het paneel zelf (panel.js) haalt de data op.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => console.error(err));
