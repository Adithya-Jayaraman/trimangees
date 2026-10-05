const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: () => process.versions.electron,
  isElectron:    true,
  platform:      process.platform,
  minimize:      () => ipcRenderer.send('win-minimize'),
  maximize:      () => ipcRenderer.send('win-maximize'),
  close:         () => ipcRenderer.send('win-close'),
});

console.log('Preload loaded — Electron', process.versions.electron);

// ============================================================
// Trimangees OS upgrade: the titlebar traffic dots in browser.html
// were never wired to anything. This connects them to real window
// controls — and keeps working when browser.html gets updated, as
// long as the #tb-traffic dots stay.
//   red = close, yellow = minimize, green = maximize/restore
// ============================================================
window.addEventListener('DOMContentLoaded', () => {
  const wire = (sel, channel, tip) => {
    const el = document.querySelector(sel);
    if (!el) return;
    el.style.webkitAppRegion = 'no-drag';   // the titlebar is a drag zone
    el.style.cursor = 'pointer';
    el.title = tip;
    el.addEventListener('click', () => ipcRenderer.send(channel));
  };
  wire('#tb-traffic .dot.r', 'win-close', 'Close');
  wire('#tb-traffic .dot.y', 'win-minimize', 'Minimize');
  wire('#tb-traffic .dot.g', 'win-maximize', 'Maximize / Restore');
  // Clear Windows-style buttons on the right (same actions)
  wire('#win-ctrls .wc-min', 'win-minimize', 'Minimize');
  wire('#win-ctrls .wc-max', 'win-maximize', 'Maximize / Restore');
  wire('#win-ctrls .wc-close', 'win-close', 'Close');
});
