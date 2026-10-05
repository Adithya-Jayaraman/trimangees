// ============================================================
// Trimangees OS — desktop logic
// The whole desktop lives in this one renderer: window manager,
// taskbar, start menu, search, and the built-in apps.
// The kernel (main.js) is reached through window.kernel.
// ============================================================
"use strict";

const $  = (sel) => document.querySelector(sel);
const osAppend = (node) => document.body.appendChild(node);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const TASKBAR_H = 48;

// ── App registry ────────────────────────────────────────────
// Built-ins are always here and work offline. Cloud apps (from your
// Firebase RTDB / Storage) are merged in at boot by loadApps(), and
// an RTDB entry can even override a built-in by re-using its id.
//   external : opens in its own real window (the Browser)
//   local    : a file shipped in apps/ — opens in an iframe
//   url      : anything remote — opens in a webview
const BUILT_IN_APPS = [
  { id: "explorer",  name: "File Explorer",      color: "#f0b423", letter: "F", builtin: true, category: "System" },
  { id: "terminal",  name: "Terminal",           color: "#3cc850", letter: ">", builtin: true, category: "System" },
  { id: "browser",   name: "Trimangees Browser", color: "#3c96ff", letter: "B", builtin: true, category: "System" },
  { id: "tridocs",   name: "TRiDOCS",   color: "#4682dc", letter: "D", builtin: true, local: true, url: "apps/tridocs.html",   category: "Suite" },
  { id: "trisheets", name: "TRiSHEETS", color: "#32b464", letter: "S", builtin: true, local: true, url: "apps/trisheets.html", category: "Suite" },
  { id: "trislides", name: "TRiSLIDES", color: "#dc643c", letter: "P", builtin: true, local: true, url: "apps/trislides.html", category: "Suite" },
  { id: "tridraw",   name: "TRiDRAW",   color: "#b450dc", letter: "A", builtin: true, local: true, url: "apps/tridraw.html",   category: "Suite" },
  { id: "settings",  name: "Settings",  color: "#8287aa", letter: "\u2699", builtin: true, category: "System" },
  // ── Tri apps (single-file HTML apps that ship with the OS) ──
  { id: "mayfly",   name: "Mayfly",   color: "#5ee6c7", letter: "M",      builtin: true, local: true, url: "apps/mayfly.html",  category: "Tri apps" },
  { id: "tridb",    name: "TriDB",    color: "#8b93ff", letter: "\u25C8", builtin: true, local: true, url: "apps/tridb.html",   category: "Tri apps" },
  { id: "tripass",  name: "TriPass",  color: "#f0c674", letter: "\u26BF", builtin: true, local: true, url: "apps/tripass.html", category: "Tri apps" },
  { id: "trikeep",  name: "TriKeep",  color: "#ff6b7a", letter: "\u270E", builtin: true, local: true, url: "apps/trikeep.html", category: "Tri apps" },
  { id: "triflow",  name: "TriFlow",  color: "#5ee6c7", letter: "\u21C4", builtin: true, local: true, url: "apps/triflow.html", category: "Tri apps" },
  // ── Real programs ──
  { id: "xterm", name: "Full Terminal", color: "#2f3b4a", letter: "$", builtin: true, exec: { type: "xterm" }, needs: "xterm", category: "System" },
  { id: "chrome",   name: "Google Chrome", color: "#e8453c", letter: "C", builtin: true, exec: { type: "chrome" }, needs: "chrome", category: "System" },
  { id: "w-files",  name: "Windows Files",  color: "#3c78d8", letter: "W",      builtin: true, exec: { type: "winetool", args: ["explorer"] },            needs: "wine", category: "Windows" },
  { id: "w-notepad",name: "Notepad",        color: "#6a8caf", letter: "N",      builtin: true, exec: { type: "winetool", args: ["notepad"] },             needs: "wine", category: "Windows" },
  { id: "w-cmd",    name: "Windows Command Prompt", color: "#444a60", letter: "\u25A0", builtin: true, exec: { type: "winetool", args: ["wineconsole", "cmd"] }, needs: "wine", category: "Windows" },
  { id: "w-progs",  name: "Windows Programs", color: "#3a9d8f", letter: "U",    builtin: true, exec: { type: "winetool", args: ["uninstaller"] },         needs: "wine", category: "Windows" },
  { id: "w-config", name: "Wine Settings",  color: "#8287aa", letter: "\u2699", builtin: true, exec: { type: "winetool", args: ["winecfg"] },              needs: "wine", category: "Windows" },
  { id: "viewer",    name: "Image Viewer", color: "#4aa8c8", letter: "V", builtin: true, hidden: true },
  { id: "htmlview",  name: "HTML Viewer",  color: "#e07830", letter: "H", builtin: true, hidden: true },
  { id: "editor",    name: "Text Editor",  color: "#c8a04a", letter: "E", builtin: true, hidden: true },
];
let APPS = BUILT_IN_APPS.map(a => ({ ...a }));       // grows when cloud apps load
const DEFAULT_PINNED = ["explorer", "browser", "chrome", "terminal", "tridocs", "trisheets", "trislides", "mayfly"];
let PINNED = [...DEFAULT_PINNED];
const appById = (id) => APPS.find(a => a.id === id);

// The little glyph inside every tile/taskbar button — a letter, or an
// image if the app brought its own icon URL.
function iconInner(a) {
  if (a && a.iconUrl)
    return `<img src="${a.iconUrl}" alt="" style="width:62%;height:62%;object-fit:contain">`;
  return (a && a.letter) || ((a && a.name) ? a.name[0].toUpperCase() : "?");
}

// Which apps are pinned to the taskbar. A user-curated list (CFG.pins)
// wins; otherwise it's the built-in defaults plus any cloud app flagged
// pinned in the manifest.
function effectivePins() {
  if (Array.isArray(CFG.pins)) return CFG.pins.filter(id => appById(id));
  const cloudPins = APPS.filter(a => a.cloudPinned).map(a => a.id);
  return [...new Set([...DEFAULT_PINNED, ...cloudPins])].filter(id => appById(id));
}
function togglePin(id) {
  const set = new Set(effectivePins());
  set.has(id) ? set.delete(id) : set.add(id);
  CFG.pins = [...set];
  PINNED = effectivePins();
  buildTaskbar(); updateTaskbar();
  kernel.setConfig(CFG);
}
const slugId = (s) => String(s).toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "app";

// ── Apps: built-ins + Firebase cloud apps + /Applications + Wine programs ──
let cloudAppsLoaded = false;
let CLOUD_APPS = [], LOCAL_APPS = [], LOCAL_SIG = "";
let HAS = { wine: false, chrome: false };

function mergeApps() {
  const map = new Map(BUILT_IN_APPS.filter(a => !a.needs || HAS[a.needs]).map(a => [a.id, { ...a }]));
  for (const ca of CLOUD_APPS) {
    const base = map.get(ca.id);
    // Merge onto a built-in (keeps its builtin/local nature) or add fresh.
    map.set(ca.id, base ? { ...base, ...ca, builtin: base.builtin } : ca);
  }
  for (const la of LOCAL_APPS) map.set(la.id, la);
  APPS = [...map.values()];
  PINNED = effectivePins();
  buildTaskbar();
  updateTaskbar();
  if (typeof startMenu !== "undefined" && !startMenu.hidden) renderTiles(smInput.value.trim());
}

// Programs the user dropped in /Applications, and programs Wine installed.
async function refreshLocalApps() {
  try {
    const [loc, wine] = await Promise.all([kernel.appsLocal(), kernel.appsWine()]);
    const mapped = [];
    for (const a of loc || []) {
      const base = { id: a.id, name: a.name, color: a.color, iconUrl: a.icon || undefined,
                     letter: a.name[0].toUpperCase(), category: "My apps", userApp: true, path: a.path };
      if (a.kind === "html") mapped.push({ ...base, local: true, url: a.url });
      else mapped.push({ ...base, exec: { type: "file", path: a.path } });
    }
    for (const w of wine || []) {
      mapped.push({ id: w.id, name: w.name, color: "#3c78d8", iconUrl: w.icon || undefined,
                    letter: w.name[0].toUpperCase(), category: "Windows programs", wineApp: true,
                    exec: { type: "wineapp", file: w.desktopFile } });
    }
    const sig = JSON.stringify(mapped.map(m => [m.id, m.name, !!m.iconUrl]));
    if (sig === LOCAL_SIG) return;
    LOCAL_SIG = sig; LOCAL_APPS = mapped; mergeApps();
  } catch (e) { /* not in the full OS — no local apps */ }
}

async function loadApps() {
  let cloud = [];
  try { cloud = await Cloud.loadAppManifest(); }
  catch (e) { console.warn("loadApps:", e); }
  CLOUD_APPS = cloud;
  try { HAS = await kernel.appsHas(); } catch {}
  cloudAppsLoaded = true;
  await refreshLocalApps();
  mergeApps();
  return cloud;
}

// ── Users of this TrimangeesOS machine ──────────────────────
// PINs here are a family convenience (like a lock screen), not
// real security — anyone who can read this file can read them.
const USERS = {
  Adithya: { pin: "2407", color: "#4a8af0",
             interests: "Storms \u26a1 \u00b7 Planes \u2708\ufe0f",
             flavor: "Storm season is loading\u2026",
             theme: { preset: 3, accent: "#4a8af0" } },
  Tarun:   { pin: "2012", color: "#f07830",
             interests: "Rocks \u{1FAA8} \u00b7 Planes \u2708\ufe0f",
             flavor: "Rock-solid session ready.",
             theme: { preset: 1, accent: "#f07830" } },
  Arjun:   { pin: "2015", color: "#c85ae0",
             interests: "Games \u{1F3AE} \u00b7 Rocks \u{1FAA8}",
             flavor: "Player one, ready!",
             theme: { preset: 0, accent: "#c85ae0" } },
};
let CURRENT_USER = null;
let USER_HOME = null;      // this account's personal filespace
const LOCKED = () => !CURRENT_USER;

// Per-user themes sync under /trimangees-os in your Firebase RTDB
// (the same project as your apps — see firebase.js).
const FIREBASE_URL = Cloud.RTDB;

// ── Theme / config (per user) ───────────────────────────────
let CFG = { lastUser: null, users: {} };

function migrateConfig(raw) {
  if (raw && raw.users) return raw;
  // Old flat config from before accounts existed
  const legacy = raw && raw.accent ? { accent: raw.accent, preset: raw.preset ?? 0 } : null;
  return { lastUser: null, users: legacy ? { Adithya: legacy } : {} };
}

function getUserCfg() {
  if (CURRENT_USER && !CFG.users[CURRENT_USER]) {
    CFG.users[CURRENT_USER] = { ...USERS[CURRENT_USER].theme };
  }
  return CURRENT_USER ? CFG.users[CURRENT_USER]
                      : { accent: "#4a8af0", preset: 0 };
}

function osApplyTheme() {
  const uc = getUserCfg();
  document.documentElement.style.setProperty("--accent", uc.accent);
  const desk = document.getElementById("desktop");
  if (uc.preset === 4 && uc.wallpaperImage) {
    document.body.className = "preset-custom";
    if (desk) loadWallpaperImage(desk, uc.wallpaperImage);
  } else {
    if (desk) { desk.style.background = ""; }
    document.body.className = "preset-" + (uc.preset ?? 0);
  }
}
async function saveTheme() { await kernel.setConfig(CFG); cloudPush(); }

// Read the wallpaper file through the kernel and show it as a data URL.
// This works no matter how the file:// protocol is locked down.
const EXT_MIME = { png:"image/png", jpg:"image/jpeg", jpeg:"image/jpeg",
                   gif:"image/gif", webp:"image/webp", bmp:"image/bmp" };
let _wallpaperToken = 0;
async function loadWallpaperImage(el, filePath) {
  const token = ++_wallpaperToken;
  try {
    const res = await kernel.readFileB64(filePath);
    if (token !== _wallpaperToken) return;   // a newer wallpaper was chosen
    if (res && res.ok) {
      const ext = (filePath.split(".").pop() || "").toLowerCase();
      const mime = EXT_MIME[ext] || "image/png";
      el.style.background = `#07070f url("data:${mime};base64,${res.b64}") center / cover no-repeat`;
    } else {
      el.style.background = `#07070f url("${FILE_URL(filePath)}") center / cover no-repeat`;
    }
  } catch {
    el.style.background = `#07070f url("${FILE_URL(filePath)}") center / cover no-repeat`;
  }
}

// ── Cloud sync (best-effort: works offline, syncs when it can) ──
async function cloudPull(user) {
  try {
    const r = await fetch(`${FIREBASE_URL}/trimangees-os/${user}/theme.json`,
                          { signal: AbortSignal.timeout(4000) });
    const t = await r.json();
    if (t && typeof t === "object") {
      const local = CFG.users[user] || {};
      // A custom wallpaper points at a local file — the locally-chosen one
      // always wins over cloud accent/preset so a reload never wipes it.
      CFG.users[user] = (local.preset === 4 && local.wallpaperImage)
        ? { ...t, ...local } : { ...local, ...t };
    }
  } catch { /* offline is fine */ }
}
function cloudPush() {
  if (CFG && CFG.prefs && CFG.prefs.noCloud) return;
  if (!CURRENT_USER) return;
  try {
    fetch(`${FIREBASE_URL}/trimangees-os/${CURRENT_USER}.json`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        theme: (() => {
          const { wallpaperImage, ...rest } = CFG.users[CURRENT_USER] || {};
          return rest;   // colour + preset sync; the local image path stays local
        })(),
        lastLogin: new Date().toISOString(),
        device: "TrimangeesOS 2.0",
      }),
    }).catch(() => {});
  } catch { /* offline is fine */ }
}

// ── Virtual-disk sync — each account's HOME follows them across
// devices. Kept deliberately light on Firebase: one small node per
// user under trimangees-os/<user>/fs, pushed only when that home
// actually changed, debounced, and capped so a huge disk won't sync.
const FS_SYNC_MAX = 1_200_000;                 // ~1.2 MB ceiling per home
let fsPushTimer = null, fsLastSig = null, fsPushing = false, fsTooBig = false;
const fsSyncOn = () => CFG.fsSync !== false;    // default ON
const fsSig = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return s.length + ":" + h; };

function refreshExplorers() {
  try { if (window.EX) EX.desktopRefresh(); } catch {}
  try { wins.filter(w => w.app === "explorer").forEach(w => w.refresh && w.refresh()); } catch {}
}

async function fsCloudPull(user) {
  if (!fsSyncOn() || !user || !kernel.fsExportHome) return;
  let remote = null;
  try { remote = await Cloud.rtdbGet(`trimangees-os/${user}/fs`); }
  catch { return; }                             // offline → just keep the local disk
  const seenM = (CFG.fsHomeM && CFG.fsHomeM[user]) || 0;
  if (remote && remote.root && (remote.m || 0) > seenM) {
    const r = await kernel.fsImportHome(user, remote.root);
    if (r && r.ok) {
      CFG.fsHomeM = CFG.fsHomeM || {}; CFG.fsHomeM[user] = remote.m || 0;
      await kernel.setConfig(CFG);
      const home = await kernel.fsExportHome(user);
      fsLastSig = home && home.root ? fsSig(JSON.stringify(home.root)) : null;
      refreshExplorers();
      toast("Files synced", "Loaded your files from the cloud.");
    }
  } else {
    // Nothing newer to pull. Are we already identical to the cloud?
    const home = await kernel.fsExportHome(user);
    const localSig  = home && home.root ? fsSig(JSON.stringify(home.root)) : null;
    const remoteSig = remote && remote.root ? fsSig(JSON.stringify(remote.root)) : null;
    fsLastSig = localSig;
    if (localSig && localSig !== remoteSig) fsSchedulePush(true);   // local has edits → push
  }
}

function fsSchedulePush(now = false) {
  if (!fsSyncOn() || !CURRENT_USER || !kernel.fsExportHome) return;
  clearTimeout(fsPushTimer);
  fsPushTimer = setTimeout(fsDoPush, now ? 0 : 6000);
}
async function fsDoPush() {
  if (CFG && CFG.prefs && CFG.prefs.noCloud) return;
  if (!fsSyncOn() || !CURRENT_USER || fsPushing) return;
  let home; try { home = await kernel.fsExportHome(CURRENT_USER); } catch { return; }
  if (!home || !home.root) return;
  if (home.truncated) { fsTooBig = true; return; }
  const json = JSON.stringify(home.root);
  const sig = fsSig(json);
  if (sig === fsLastSig) return;                 // this home is unchanged since last push
  if (json.length > FS_SYNC_MAX) { fsTooBig = true; return; }   // too big — skip to avoid cost
  fsTooBig = false; fsPushing = true;
  const ts = Date.now();
  try {
    const r = await Cloud.rtdbPut(`trimangees-os/${CURRENT_USER}/fs`, { root: home.root, m: ts });
    if (!r || r.ok !== false) {
      fsLastSig = sig;
      CFG.fsHomeM = CFG.fsHomeM || {}; CFG.fsHomeM[CURRENT_USER] = ts;
      await kernel.setConfig(CFG);
    }
  } catch { /* offline — the next change will retry */ }
  fsPushing = false;
}

// ── Toasts ──────────────────────────────────────────────────
function toast(title, body) {
  if (CFG && CFG.prefs && CFG.prefs.quiet) return;
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `<b></b><p></p><div class="bar"></div>`;
  el.querySelector("b").textContent = title;
  el.querySelector("p").textContent = body;
  el.onclick = () => el.remove();
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), 3600);
}

// ============================================================
// Window manager
// ============================================================
let zTop = 10;
let nextWinId = 1;
const wins = [];           // { id, app, el, title }

function activeWin() {
  return wins.reduce((best, w) =>
    (!w.el.classList.contains("minimized") &&
     (+w.el.style.zIndex || 0) > (best ? +best.el.style.zIndex : -1)) ? w : best, null);
}

function setWinTitle(w, t) {
  w.title = t;
  w.el.querySelector(".t-title").textContent = t;
}

function focusWin(w) {
  wins.forEach(o => o.el.classList.remove("active"));
  w.el.classList.add("active");
  w.el.style.zIndex = ++zTop;
  updateTaskbar();
}

function closeWin(w) {
  if (w.app === "terminal") kernel.termKill(w.id);
  if (w.persistent) { w.el.classList.add("minimized"); updateTaskbar(); return; }  // keep it alive, just hide
  if (w.onClose) { try { w.onClose(); } catch {} }
  w.el.remove();
  wins.splice(wins.indexOf(w), 1);
  const top = activeWin();
  if (top) focusWin(top); else updateTaskbar();
}

function minimizeWin(w) {
  w.el.classList.add("minimized");
  w.el.classList.remove("active");
  const top = activeWin();
  if (top) focusWin(top); else updateTaskbar();
}

function toggleMaximize(w) {
  const el = w.el;
  if (!el.classList.contains("maximized")) {
    w.restore = { left: el.style.left, top: el.style.top, width: el.style.width, height: el.style.height };
    el.classList.add("maximized");
    Object.assign(el.style, { left: "0px", top: "0px", width: "100%", height: "100%" });
  } else {
    el.classList.remove("maximized");
    Object.assign(el.style, w.restore || { left: "120px", top: "80px", width: "760px", height: "480px" });
  }
}

function createWindow(appId, arg) {
  const app = appById(appId);
  const id = nextWinId++;
  const el = document.createElement("div");
  el.className = "win";
  const offset = (wins.length % 8) * 26;
  const size = {
    explorer: [860, 540], terminal: [760, 460], settings: [780, 560],
    viewer: [820, 600], editor: [860, 580], htmlview: [1000, 660],
    browser: [1180, 760],
  }[appId] || [1000, 680];
  const W = Math.min(size[0], innerWidth - 40);
  const H = Math.min(size[1], innerHeight - TASKBAR_H - 40);
  Object.assign(el.style, {
    left: (90 + offset) + "px", top: (60 + offset) + "px",
    width: W + "px", height: H + "px", zIndex: ++zTop,
  });

  el.innerHTML = `
    <div class="titlebar">
      <span class="dot" style="background:${app.color}"></span>
      <span class="t-title"></span>
      <button class="t-min" title="Minimize">&#8211;</button>
      <button class="t-max" title="Maximize">&#9723;</button>
      <button class="t-close" title="Close">&#10005;</button>
    </div>
    <div class="win-content"></div>
    ${["n","s","e","w","ne","nw","se","sw"].map(d => `<div class="rs rs-${d}" data-rs="${d}"></div>`).join("")}
  `;
  el.querySelector(".t-title").textContent = app.name;
  $("#windows").appendChild(el);

  const w = { id, app: appId, el, title: app.name, arg };
  wins.push(w);

  // Focus on any interaction with the window
  el.addEventListener("pointerdown", () => focusWin(w));

  // Title bar buttons
  el.querySelector(".t-close").onclick = (e) => { e.stopPropagation(); closeWin(w); };
  el.querySelector(".t-min").onclick   = (e) => { e.stopPropagation(); minimizeWin(w); };
  el.querySelector(".t-max").onclick   = (e) => { e.stopPropagation(); toggleMaximize(w); };
  el.querySelector(".titlebar").ondblclick = (e) => {
    if (e.target.tagName !== "BUTTON") toggleMaximize(w);
  };

  installDrag(w);
  installResize(w);

  // Build the app inside. Built-ins have dedicated builders; everything
  // else (suite apps + cloud apps) is a generic iframe/webview window.
  const body = el.querySelector(".win-content");
  const builder = {
    terminal: buildTerminal, explorer: buildExplorer, settings: buildSettings,
    viewer: buildViewer, editor: buildEditor, htmlview: buildHtmlView,
    browser: buildBrowser,
  }[appId];
  if (builder) builder(body, w);
  else buildGenericApp(body, w, app);

  focusWin(w);
  return w;
}

// Launch: focus an existing window of this app, or open a new one.
// `arg` carries a file path or URL for apps that open things.
async function launchExec(app, arg) {
  const ex = app.exec; let res;
  try {
    if (ex.type === "chrome")        res = await kernel.runChrome(typeof arg === "string" ? arg : undefined);
    else if (ex.type === "winetool") res = await kernel.runWineTool(ex.args);
    else if (ex.type === "wineapp")  res = await kernel.runWineApp(ex.file);
    else if (ex.type === "file")     res = await kernel.runFile(ex.path);
    else if (ex.type === "xterm")    res = await kernel.xterm();
  } catch (e) { res = { ok: false, error: e.message }; }
  if (res && !res.ok) toast(app.name, res.error || "couldn't start");
  return null;
}
function launch(appId, arg) {
  const app = appById(appId);
  if (app && app.exec) { launchExec(app, arg); return null; }
  // The Trimangees Browser uses <webview> tabs, which only work on a
  // top-level page — so it lives in its own real (desktop-styled) window
  // instead of an embedded one. Reliable, and the taskbar still tracks it.
  if (app && app.external) {
    kernel.openBrowser(typeof arg === "string" ? arg : undefined);
    return null;
  }
  const existing = wins.find(w => w.app === appId);
  if (existing && !arg) {
    existing.el.classList.remove("minimized");
    focusWin(existing);
    return existing;
  }
  if (existing && arg && existing.openArg) {
    existing.el.classList.remove("minimized");
    focusWin(existing);
    existing.openArg(arg);      // e.g. new browser tab in the open window
    return existing;
  }
  return createWindow(appId, arg);
}

// ── Dragging + snap zones ───────────────────────────────────
function installDrag(w) {
  const bar = w.el.querySelector(".titlebar");
  bar.addEventListener("pointerdown", (e) => {
    if (e.target.tagName === "BUTTON" || e.button !== 0) return;
    if (w.el.classList.contains("maximized")) return;
    const startX = e.clientX, startY = e.clientY;
    const ox = w.el.offsetLeft, oy = w.el.offsetTop;
    const preview = $("#snap-preview");
    let zone = null;

    const move = (ev) => {
      w.el.style.left = (ox + ev.clientX - startX) + "px";
      w.el.style.top  = Math.max(0, oy + ev.clientY - startY) + "px";
      zone = detectSnap(ev.clientX, ev.clientY);
      if (zone) { Object.assign(preview.style, snapRect(zone)); preview.hidden = false; }
      else preview.hidden = true;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      preview.hidden = true;
      if (zone) applySnap(w, zone);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
}

function detectSnap(x, y) {
  const m = 22, W = innerWidth, H = innerHeight - TASKBAR_H;
  if (y < m) return "max";
  if (x < m)      return y < H / 2 ? "tl" : "bl";
  if (x > W - m)  return y < H / 2 ? "tr" : "br";
  return null;
}
function snapRect(zone) {
  const W = innerWidth, H = innerHeight - TASKBAR_H;
  const R = {
    max: [0, 0, W, H],
    tl: [0, 0, W/2, H/2],       tr: [W/2, 0, W/2, H/2],
    bl: [0, H/2, W/2, H/2],     br: [W/2, H/2, W/2, H/2],
    l:  [0, 0, W/2, H],         r: [W/2, 0, W/2, H],
  }[zone];
  return { left: R[0]+"px", top: R[1]+"px", width: R[2]+"px", height: R[3]+"px" };
}
function applySnap(w, zone) {
  if (zone === "max") { if (!w.el.classList.contains("maximized")) toggleMaximize(w); return; }
  Object.assign(w.el.style, snapRect(zone));
}

// ── Resizing ────────────────────────────────────────────────
function installResize(w) {
  w.el.querySelectorAll(".rs").forEach(h => {
    h.addEventListener("pointerdown", (e) => {
      if (w.el.classList.contains("maximized")) return;
      e.stopPropagation();
      focusWin(w);
      const dir = h.dataset.rs;
      const sx = e.clientX, sy = e.clientY;
      const r = { x: w.el.offsetLeft, y: w.el.offsetTop, w: w.el.offsetWidth, h: w.el.offsetHeight };
      const move = (ev) => {
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        let { x, y, w: ww, h: hh } = r;
        if (dir.includes("e")) ww = r.w + dx;
        if (dir.includes("s")) hh = r.h + dy;
        if (dir.includes("w")) { ww = r.w - dx; x = r.x + dx; }
        if (dir.includes("n")) { hh = r.h - dy; y = r.y + dy; }
        if (ww >= 320) { w.el.style.width = ww + "px"; if (dir.includes("w")) w.el.style.left = x + "px"; }
        if (hh >= 200) { w.el.style.height = hh + "px"; if (dir.includes("n")) w.el.style.top = Math.max(0, y) + "px"; }
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
  });
}

// ============================================================
// Taskbar
// ============================================================
// The Browser runs in its own window; the kernel tells us its state.
let browserState = { open: false, focused: false };

function buildTaskbar() {
  const bar = $("#taskbar-apps");
  bar.innerHTML = "";
  for (const id of PINNED) {
    const app = appById(id);
    if (!app) continue;
    const btn = document.createElement("button");
    btn.className = "tb-app"; btn.dataset.app = id; btn.title = app.name;
    btn.innerHTML = `<span class="tb-icon" style="background:linear-gradient(160deg,${app.color},color-mix(in srgb,${app.color} 60%,#000))">${iconInner(app)}</span><span class="ind"></span>`;
    btn.onclick = () => {
      if (app.exec) { launchExec(app); return; }               // Chrome / Windows programs
      if (app.external) { kernel.browserToggle(); return; }   // Browser window
      const open = wins.filter(w => w.app === id);
      if (!open.length) return launch(id);
      const top = activeWin();
      if (top && top.app === id) minimizeWin(top);
      else { const w = open[open.length - 1]; w.el.classList.remove("minimized"); focusWin(w); }
    };
    bar.appendChild(btn);
  }
}
function updateTaskbar() {
  const top = activeWin();
  $$(".tb-app").forEach(btn => {
    const id = btn.dataset.app;
    const app = appById(id);
    if (app && app.external) {                 // Browser lives in its own window
      btn.classList.toggle("open", browserState.open);
      btn.classList.toggle("active", browserState.focused);
    } else {
      btn.classList.toggle("open", wins.some(w => w.app === id));
      btn.classList.toggle("active", !!top && top.app === id);
    }
  });
}
kernel.onBrowserState((s) => { browserState = s || browserState; updateTaskbar(); });

// ── Personalisation prefs (motion + clock seconds) ──────────
function applyPrefs() {
  const p = CFG.prefs || {};
  document.body.classList.toggle("reduce-motion", !!p.reduceMotion);
  window.__clockSeconds = !!p.clockSeconds;
  window.__clock24 = !!p.clock24;
  if (window.EX) EX.applyPrefs(p);
  tickClock();
}

// ── Clock ───────────────────────────────────────────────────
function tickClock() {
  const now = new Date();
  const opts = window.__clockSeconds
    ? { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: !window.__clock24 }
    : { hour: "2-digit", minute: "2-digit", hour12: !window.__clock24 };
  $("#clock-time").textContent = now.toLocaleTimeString([], opts);
  $("#clock-date").textContent = now.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}
setInterval(tickClock, 1000); tickClock();

// ============================================================
// Search (taskbar pill + panel)
// ============================================================
const searchInput = $("#search-input");
const searchPanel = $("#search-panel");
let searchSel = 0;

function searchApps(q) {
  q = q.toLowerCase();
  const pre = [], sub = [];
  for (const a of APPS) {
    if (a.hidden) continue;
    const n = a.name.toLowerCase();
    if (n.startsWith(q)) pre.push(a);
    else if (n.includes(q)) sub.push(a);
  }
  return [...pre, ...sub];
}

function renderSearch() {
  const q = searchInput.value.trim();
  if (!q) { searchPanel.hidden = true; return; }
  const results = searchApps(q);
  searchPanel.innerHTML = "";
  if (!results.length) {
    searchPanel.innerHTML = `<div class="sr-empty">No matching apps</div>`;
  }
  results.forEach((a, i) => {
    const row = document.createElement("div");
    row.className = "sr-row" + (i === searchSel ? " selected" : "");
    row.innerHTML = `<span class="tb-icon" style="background:linear-gradient(160deg,${a.color},color-mix(in srgb,${a.color} 60%,#000))">${iconInner(a)}</span>
                     <span class="name"></span><span class="kind">${a.cloud ? "Cloud app" : "App"}</span>`;
    row.querySelector(".name").textContent = a.name;
    row.onmouseenter = () => { searchSel = i; renderSearch(); };
    row.onclick = () => { launch(a.id); closeSearch(); };
    searchPanel.appendChild(row);
  });
  searchPanel.hidden = false;
}
function closeSearch() {
  searchInput.value = ""; searchSel = 0;
  searchPanel.hidden = true; searchInput.blur();
}

searchInput.addEventListener("input", () => { searchSel = 0; renderSearch(); });
searchInput.addEventListener("keydown", (e) => {
  const results = searchApps(searchInput.value.trim());
  if (e.key === "Escape") closeSearch();
  else if (e.key === "ArrowDown") { searchSel = (searchSel + 1) % Math.max(1, results.length); renderSearch(); e.preventDefault(); }
  else if (e.key === "ArrowUp")   { searchSel = (searchSel + results.length - 1) % Math.max(1, results.length); renderSearch(); e.preventDefault(); }
  else if (e.key === "Enter" && results.length) { launch(results[searchSel]?.id || results[0].id); closeSearch(); }
});
searchInput.addEventListener("focus", () => { closeStartMenu(); renderSearch(); });

// ============================================================
// Start menu
// ============================================================
const startMenu = $("#start-menu");
const smInput = $("#sm-search-input");

function refreshProfile() {
  const u = CURRENT_USER || "Guest";
  const info = USERS[u] || { color: "#4a8af0", interests: "TrimangeesOS" };
  const av = $(".sm-avatar");
  av.textContent = EX.avatarText(u);
  EX.avatarStyle(av, u);
  av.style.background =
    `linear-gradient(160deg, ${info.color}, color-mix(in srgb, ${info.color} 55%, #000))`;
  $(".sm-name").textContent = u;
  $(".sm-sub").textContent = info.interests;
}

function openStartMenu() {
  refreshProfile();
  closeSearch();
  smInput.value = "";
  renderTiles("");
  startMenu.hidden = false;
  setTimeout(() => smInput.focus(), 0);
}
function closeStartMenu() { startMenu.hidden = true; }
function toggleStartMenu() { startMenu.hidden ? openStartMenu() : closeStartMenu(); }

function renderTiles(q) {
  const list = q ? searchApps(q) : APPS.filter(a => !a.hidden);
  $("#sm-label").textContent = q ? `Results for "${q}"` : "Pinned";
  $(".sm-search").classList.toggle("has-text", !!q);
  const grid = $("#sm-tiles");
  grid.innerHTML = "";
  if (!list.length) {
    grid.innerHTML = `<div class="sm-none">No matching apps</div>`;
    return;
  }
  for (const a of list) {
    const tile = document.createElement("div");
    tile.className = "sm-tile";
    tile.innerHTML = `<span class="glyph" style="background:linear-gradient(160deg,${a.color},color-mix(in srgb,${a.color} 58%,#000))">${iconInner(a)}</span><span></span>`;
    tile.querySelector("span:last-child").textContent = a.name;
    tile.onclick = () => { launch(a.id); closeStartMenu(); };
    tile.oncontextmenu = (e) => { e.preventDefault(); showContextMenu(e.clientX, e.clientY, [
      { label: "Open", run: () => { launch(a.id); closeStartMenu(); } },
      { label: (effectivePins().includes(a.id) ? "Unpin from taskbar" : "Pin to taskbar"), run: () => { togglePin(a.id); renderTiles(smInput.value.trim()); } },
      { label: "Create desktop shortcut", run: () => EX.makeShortcut({ kind: "app", id: a.id, name: a.name }) } ]); };
    grid.appendChild(tile);
  }
}
smInput.addEventListener("input", () => renderTiles(smInput.value.trim()));
smInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeStartMenu();
  if (e.key === "Enter") {
    const list = searchApps(smInput.value.trim());
    if (list.length) { launch(list[0].id); closeStartMenu(); }
  }
});
$("#start-btn").onclick = (e) => { e.stopPropagation(); toggleStartMenu(); };

$$(".sm-power button").forEach(b => b.onclick = async () => {
  closeStartMenu();
  const action = b.dataset.power;
  if (action === "logout") { osDoLogout(); return; }
  const res = await kernel.power(action);
  if (res.lock) { osDoLogout(); return; }                  // "sleep" = lock the screen
  if (res.dev && action === "sleep") toast("Sleep", "Only available in the full OS session (boot the ISO).");
});

// Click anywhere else closes menus
document.addEventListener("pointerdown", (e) => {
  if (!startMenu.hidden && !startMenu.contains(e.target) && !$("#start-btn").contains(e.target)) closeStartMenu();
  if (!searchPanel.hidden && !searchPanel.contains(e.target) && !$("#search-pill").contains(e.target)) closeSearch();
  const cm = $("#context-menu");
  if (!cm.hidden && !cm.contains(e.target)) cm.hidden = true;
});

// ── Alt+Tab window switcher ─────────────────────────────────
let atOpen = false, atIdx = 0, atList = [];
function renderAltTab() {
  let ov = $("#alttab");
  if (!ov) {
    ov = document.createElement("div");
    ov.id = "alttab";
    osAppend(ov);
  }
  ov.innerHTML = "";
  atList.forEach((w, i) => {
    const app = appById(w.app) || { color: "#888" };
    const card = document.createElement("div");
    card.className = "at-card" + (i === atIdx ? " on" : "");
    card.innerHTML = `<span class="at-dot" style="background:${app.color}"></span><span></span>`;
    card.querySelector("span:last-child").textContent = w.title;
    card.onclick = () => { atIdx = i; commitAltTab(); };
    ov.appendChild(card);
  });
}
function commitAltTab() {
  const w = atList[atIdx];
  if (w) { w.el.classList.remove("minimized"); focusWin(w); }
  $("#alttab")?.remove();
  atOpen = false;
}
window.addEventListener("keyup", (e) => {
  if ((e.key === "Alt" || e.key === "Control") && atOpen) commitAltTab();
});

// Global shortcuts
window.addEventListener("keydown", async (e) => {
  if (LOCKED()) return;                    // nothing works before login
  if ((e.altKey || e.ctrlKey) && e.key === "Tab") {
    e.preventDefault();
    if (!atOpen) {
      atList = wins.filter(w => !w.el.classList.contains("minimized"))
                   .sort((a, b) => (+b.el.style.zIndex || 0) - (+a.el.style.zIndex || 0));
      if (!atList.length) return;
      atOpen = true;
      atIdx = atList.length > 1 ? 1 : 0;
    } else {
      atIdx = (atIdx + (e.shiftKey ? -1 : 1) + atList.length) % atList.length;
    }
    renderAltTab();
    return;
  }
  if (e.altKey && e.key === "F4") {
    e.preventDefault();
    const top = activeWin();
    if (top) closeWin(top);
    return;
  }
  if (e.ctrlKey && (e.key === "k" || e.key === "K")) { e.preventDefault(); searchInput.focus(); }
  if (e.key === "Meta") { toggleStartMenu(); }

  // F4 — take the whole screen (like booting the real OS).
  // Esc — give the screen back and become a window on the host desktop.
  // In the ISO session there is no host desktop, so these do nothing.
  if (e.key === "F4" && !e.altKey && !kernel.session) {
    e.preventDefault();
    const now = await kernel.setFullscreen(true);
    if (now) toast("Fullscreen", "Trimangees OS has the whole screen. Press Esc to go back.");
  }
  if (e.key === "Escape" && !kernel.session) {
    // Menus and panels get Esc first
    const menusOpen = !startMenu.hidden || !searchPanel.hidden || !$("#context-menu").hidden;
    if (!menusOpen && await kernel.isFullscreen()) {
      kernel.setFullscreen(false);
    }
  }
});

// ============================================================
// Confirm dialog — a small OS-styled yes/no
// ============================================================
function confirmDialog(msg) {
  return new Promise(res => {
    const ov = document.createElement("div");
    ov.className = "confirm-ov";
    ov.innerHTML = `<div class="confirm-box"><p></p>
      <div><button class="c-no">Cancel</button><button class="c-yes">Delete</button></div></div>`;
    ov.querySelector("p").textContent = msg;
    ov.querySelector(".c-yes").onclick = () => { ov.remove(); res(true); };
    ov.querySelector(".c-no").onclick  = () => { ov.remove(); res(false); };
    document.body.appendChild(ov);
  });
}

// ============================================================
// Context menu
// ============================================================
function showContextMenu(x, y, items) {
  const cm = $("#context-menu");
  cm.innerHTML = "";
  for (const it of items) {
    if (it === "-") { cm.appendChild(document.createElement("hr")); continue; }
    const row = document.createElement("div");
    row.textContent = it.label;
    row.onclick = () => { cm.hidden = true; it.run(); };
    cm.appendChild(row);
  }
  cm.hidden = false;
  const r = cm.getBoundingClientRect();
  cm.style.left = Math.min(x, innerWidth - r.width - 6) + "px";
  cm.style.top  = Math.min(y, innerHeight - r.height - 6) + "px";
}

$("#desktop").addEventListener("contextmenu", (e) => {
  if (e.target.closest(".win")) return;   // windows handle their own right-click
  e.preventDefault();
  if (window.EX) { EX.desktopMenu(e.clientX, e.clientY); return; }
  showContextMenu(e.clientX, e.clientY, [
    { label: "Open Terminal",       run: () => launch("terminal") },
    { label: "Open File Explorer",  run: () => launch("explorer") },
    "-",
    { label: "Settings",            run: () => launch("settings") },
    { label: "About Trimangees OS", run: () => { const w = launch("settings"); w.setSection?.(4); } },
  ]);
});

// ============================================================
// APP: Terminal — a real shell via the kernel
// ============================================================
function buildTerminal(body, w) {
  body.innerHTML = `
    <div class="term">
      <div class="term-out"></div>
      <div class="term-in">
        <span class="u"></span><span class="p"></span>
        <input type="text" autocomplete="off" spellcheck="false">
        <span class="running" hidden>[running &middot; Ctrl+C stops]</span>
      </div>
    </div>`;
  const out = body.querySelector(".term-out");
  const inp = body.querySelector("input");
  const runBadge = body.querySelector(".running");
  const promptEl = body.querySelector(".term-in .p");

  const userTag = (CURRENT_USER || "user").toLowerCase() + "@trimangees";
  body.querySelector(".term-in .u").textContent = userTag;
  const startHome = USER_HOME || "/";
  const st = { cwd: startHome, home: startHome, running: false, history: [], hIdx: null };
  if (!USER_HOME) kernel.userHome(CURRENT_USER).then(h => { st.home = h; st.cwd = h; refreshPrompt(); });

  const disp = () => {
    if (st.cwd === st.home) return "~";
    const sep = st.cwd.includes("\\") ? "\\" : "/";
    if (st.cwd.startsWith(st.home + sep)) return "~" + st.cwd.slice(st.home.length);
    return st.cwd;
  };
  const refreshPrompt = () => { promptEl.textContent = `:${disp()}$ `; };

  const line = (text, cls) => {
    const d = document.createElement("div");
    if (cls) d.className = cls;
    d.textContent = text || "\u00a0";
    out.appendChild(d);
    while (out.childElementCount > 4000) out.firstChild.remove();
    out.scrollTop = out.scrollHeight;
  };
  const echo = (cmd) => {
    const d = document.createElement("div");
    d.className = "t-echo";
    d.innerHTML = `<span class="u"></span><span class="p"></span><span class="c"></span>`;
    d.querySelector(".u").textContent = userTag;
    d.querySelector(".p").textContent = `:${disp()}$ `;
    d.querySelector(".c").textContent = cmd;
    out.appendChild(d);
    out.scrollTop = out.scrollHeight;
  };

  line("TrimangeesOS Terminal v3.0 \u2014 real bash on your TriFS drive");
  line(`Welcome, ${CURRENT_USER || "user"}!  Try:  ls   wine --version   df -h ~`);
  line("");

  w.termOut  = ({ line: l, stream }) => line(l, stream === "err" ? "t-err" : "");
  w.termDone = ({ code }) => {
    if (code && code !== 0 && code !== -1) line(`exit code: ${code}`);
    line("");
    st.running = false; runBadge.hidden = true;
  };

  async function run(cmd) {
    echo(cmd);
    st.history.push(cmd); st.hIdx = null;
    const trimmed = cmd.trim();

    if (trimmed === "clear") { out.innerHTML = ""; return; }
    if (trimmed === "exit")  { closeWin(w); return; }
    if (trimmed === "xterm" || trimmed === "fullterm") { kernel.xterm(); line("(opened a full terminal window)"); line(""); return; }
    if (trimmed === "cd" || trimmed.startsWith("cd ")) {
      const target = trimmed.slice(2).trim();
      const res = await kernel.resolveDir(st.cwd, target);
      if (res.ok) { st.cwd = res.path; refreshPrompt(); }
      else line(`cd: ${res.error}: ${target}`, "t-err");
      line(""); return;
    }

    st.running = true; runBadge.hidden = false;
    const res = await kernel.termRun(w.id, cmd, st.cwd);
    if (!res.ok) { line(res.error, "t-err"); line(""); st.running = false; runBadge.hidden = true; }
  }

  inp.addEventListener("keydown", async (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      if (st.running) return;
      const v = inp.value;
      const m = v.match(/(^|\s)(\S*)$/);
      const token = m ? m[2] : "";
      const sepIdx = Math.max(token.lastIndexOf("/"), token.lastIndexOf("\\"));
      const dirPart = sepIdx >= 0 ? token.slice(0, sepIdx + 1) : "";
      const namePart = token.slice(sepIdx + 1);
      const res = await kernel.resolveDir(st.cwd, dirPart || ".");
      if (!res.ok) return;
      const ls = await kernel.listDir(res.path);
      if (!ls.ok) return;
      const sep = st.cwd.includes("\\") ? "\\" : "/";
      const matches = ls.entries.filter(en => en.name.startsWith(namePart));
      if (!matches.length) return;
      const head = v.slice(0, v.length - namePart.length);
      if (matches.length === 1) {
        inp.value = head + matches[0].name + (matches[0].isDir ? sep : " ");
      } else {
        let lcp = matches[0].name;
        for (const en of matches)
          while (!en.name.startsWith(lcp)) lcp = lcp.slice(0, -1);
        if (lcp.length > namePart.length) inp.value = head + lcp;
        else line(matches.slice(0, 30).map(en => en.name + (en.isDir ? sep : "")).join("   "));
      }
      return;
    }
    if (e.key === "Enter") {
      const cmd = inp.value; inp.value = "";
      if (!cmd.trim()) { echo(""); return; }
      if (st.running) { echo(cmd); kernel.termStdin(w.id, cmd + "\n"); return; }
      run(cmd);
    } else if (e.key === "c" && e.ctrlKey) {
      if (st.running) { kernel.termKill(w.id); line("^C"); }
      else { echo(inp.value + "^C"); inp.value = ""; }
      e.preventDefault();
    } else if (e.key === "l" && e.ctrlKey) {
      out.innerHTML = ""; e.preventDefault();
    } else if (e.key === "d" && e.ctrlKey) {
      if (!inp.value) closeWin(w); e.preventDefault();
    } else if (e.key === "ArrowUp") {
      if (st.history.length) {
        st.hIdx = st.hIdx === null ? st.history.length - 1 : Math.max(0, st.hIdx - 1);
        inp.value = st.history[st.hIdx];
      }
      e.preventDefault();
    } else if (e.key === "ArrowDown") {
      if (st.hIdx !== null) {
        st.hIdx++;
        if (st.hIdx >= st.history.length) { st.hIdx = null; inp.value = ""; }
        else inp.value = st.history[st.hIdx];
      }
      e.preventDefault();
    }
  });

  body.querySelector(".term").addEventListener("pointerup", () => {
    if (!getSelection().toString()) inp.focus();
  });
  setTimeout(() => inp.focus(), 0);
}

// Route kernel terminal streams to the right window
kernel.onTermOut((m)  => wins.find(w => w.id === m.id)?.termOut?.(m));
kernel.onTermDone((m) => wins.find(w => w.id === m.id)?.termDone?.(m));

// ============================================================
// APP: File Explorer
// ============================================================
function buildExplorer(body, w) {
  body.innerHTML = `
    <div class="exp">
      <div class="exp-bar">
        <button class="e-back" title="Back">&#8592;</button>
        <button class="e-fwd"  title="Forward">&#8594;</button>
        <button class="e-up"   title="Up">&#8593;</button>
        <button class="e-rel"  title="Refresh">&#8635;</button>
        <button class="e-hid"  title="Show hidden files (Ctrl+H)">&#128065;</button>
        <input class="exp-addr" spellcheck="false" title="Type a path and press Enter">
        <button class="e-newf" title="New folder">+&#128193;</button>
        <button class="e-newt" title="New text file">+&#128196;</button>
      </div>
      <div class="exp-body">
        <div class="exp-side"></div>
        <div class="exp-list"></div>
      </div>
    </div>`;
  const addr = body.querySelector(".exp-addr");
  addr.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { show(addr.value.trim()); addr.blur(); }
  });
  const list = body.querySelector(".exp-list");
  const side = body.querySelector(".exp-side");
  const bBack = body.querySelector(".e-back");
  const bFwd  = body.querySelector(".e-fwd");
  const bUp   = body.querySelector(".e-up");

  const st = { hist: [], idx: -1, dir: "", hidden: false };
  const fileGlyph = (en) => {
    if (en.isDir) return "\u{1F4C1}";
    const ext = (en.name.split(".").pop() || "").toLowerCase();
    if (PROGRAM_EXT.includes(ext)) return "\u2699\uFE0F";
    if (IMG_EXT.includes(ext) || ext === "svg") return "\u{1F5BC}\uFE0F";
    if (["html", "htm"].includes(ext)) return "\u{1F310}";
    if (["zip", "tgz", "gz", "xz", "7z", "rar", "tar"].includes(ext)) return "\u{1F5DC}\uFE0F";
    if (["mp3", "wav", "ogg", "flac"].includes(ext)) return "\u{1F3B5}";
    if (["mp4", "mkv", "webm", "avi"].includes(ext)) return "\u{1F3AC}";
    return "\u{1F4C4}";
  };

  const fmtSize = (n) => n < 1024 ? n + " B"
    : n < 1048576 ? (n/1024).toFixed(1) + " KB"
    : n < 1073741824 ? (n/1048576).toFixed(1) + " MB"
    : (n/1073741824).toFixed(2) + " GB";

  async function show(dir, push = true) {
    const res = await kernel.listDir(dir, st.hidden);
    if (!res.ok) { toast("Explorer", res.error); return; }
    if (push) { st.hist = st.hist.slice(0, st.idx + 1); st.hist.push(res.dir); st.idx = st.hist.length - 1; }
    st.dir = res.dir;
    addr.value = res.dir;
    bBack.disabled = st.idx <= 0;
    bFwd.disabled  = st.idx >= st.hist.length - 1;
    list.innerHTML = "";
    for (const en of res.entries) {
      const row = document.createElement("div");
      row.className = "exp-row";
      row.innerHTML = `<span class="fic">${fileGlyph(en)}</span>
                       <span class="fname"></span><span class="fsize"></span>`;
      row.querySelector(".fname").textContent = en.name;
      row.querySelector(".fsize").textContent = en.isDir ? "" : fmtSize(en.size);
      row.onclick = () => { list.querySelector(".selected")?.classList.remove("selected"); row.classList.add("selected"); };
      const fullPath = () => {
        const sep = st.dir.endsWith("/") || st.dir.endsWith("\\") ? "" : (st.dir.includes("\\") ? "\\" : "/");
        return st.dir + sep + en.name;
      };
      row.ondblclick = () => {
        if (en.isDir) { show(fullPath()); return; }
        openFileInOS(fullPath());
      };
      row.oncontextmenu = (e) => {
        e.preventDefault(); e.stopPropagation();
        const manage = [
          "-",
          { label: "Create desktop shortcut", run: () => EX.makeShortcut({ kind: "path", path: fullPath(), name: en.name.replace(/\.[^.]+$/, "") || en.name }) },
          { label: "Rename", run: () => startRename(en.name) },
          { label: "Delete", run: async () => {
              if (await confirmDialog(`Delete "${en.name}"${en.isDir ? " and everything inside it" : ""}?`)) {
                const r = await kernel.remove(fullPath());
                if (!r.ok) toast("Delete failed", r.error);
                refresh();
              }
            } },
        ];
        if (en.isDir) {
          showContextMenu(e.clientX, e.clientY, [
            { label: "Open", run: () => show(fullPath()) }, ...manage]);
        } else {
          fileOpenWithMenu(e.clientX, e.clientY, fullPath(), manage);
        }
      };
      list.appendChild(row);
    }
    if (!res.entries.length) list.innerHTML = `<div class="sr-empty">Empty folder</div>`;
  }

  const joinDir = (name) => {
    const sep = st.dir.endsWith("/") || st.dir.endsWith("\\") ? "" : (st.dir.includes("\\") ? "\\" : "/");
    return st.dir + sep + name;
  };
  const refresh = () => show(st.dir, false);
  w.refresh = refresh;

  body.querySelector(".e-rel").onclick = refresh;
  const bHid = body.querySelector(".e-hid");
  const toggleHidden = () => { st.hidden = !st.hidden; bHid.classList.toggle("on", st.hidden); refresh(); };
  bHid.onclick = toggleHidden;
  body.addEventListener("keydown", (e) => { if (e.ctrlKey && (e.key === "h" || e.key === "H")) { e.preventDefault(); toggleHidden(); } });
  body.querySelector(".e-newf").onclick = async () => {
    let n = 1; // find a free name
    const base = "New Folder";
    const res0 = await kernel.listDir(st.dir);
    const names = res0.ok ? res0.entries.map(x => x.name) : [];
    let name = base;
    while (names.includes(name)) name = `${base} ${++n}`;
    const r = await kernel.mkdir(joinDir(name));
    if (!r.ok) { toast("Explorer", r.error); return; }
    await refresh();
    startRename(name);        // name it right away, like Windows
  };
  body.querySelector(".e-newt").onclick = async () => {
    let n = 1;
    const res0 = await kernel.listDir(st.dir);
    const names = res0.ok ? res0.entries.map(x => x.name) : [];
    let name = "New Text File.txt";
    while (names.includes(name)) name = `New Text File ${++n}.txt`;
    const r = await kernel.writeFile(joinDir(name), "");
    if (!r.ok) { toast("Explorer", r.error); return; }
    await refresh();
    startRename(name);
  };

  // Inline rename, like pressing F2 in Windows
  function startRename(name) {
    const row = [...list.querySelectorAll(".exp-row")]
      .find(r2 => r2.querySelector(".fname")?.textContent === name);
    if (!row) return;
    const span = row.querySelector(".fname");
    const inp = document.createElement("input");
    inp.className = "rename-inp";
    inp.value = name;
    span.replaceWith(inp);
    inp.focus();
    const dot = name.lastIndexOf(".");
    inp.setSelectionRange(0, dot > 0 ? dot : name.length);
    const commit = async () => {
      const nn = inp.value.trim();
      if (nn && nn !== name) {
        const r = await kernel.rename(joinDir(name), joinDir(nn));
        if (!r.ok) toast("Rename failed", r.error);
      }
      refresh();
    };
    inp.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") commit();
      if (e.key === "Escape") refresh();
    });
    inp.addEventListener("blur", commit);
  }

  // Right-click empty space: new items + refresh
  list.addEventListener("contextmenu", (e) => {
    if (e.target.closest(".exp-row")) return;
    e.preventDefault();
    EX.bgMenu(e.clientX, e.clientY, () => st.dir, refresh, startRename);
  });

  bBack.onclick = () => { if (st.idx > 0)  { st.idx--; show(st.hist[st.idx], false); } };
  bFwd.onclick  = () => { if (st.idx < st.hist.length - 1) { st.idx++; show(st.hist[st.idx], false); } };
  bUp.onclick   = async () => { const res = await kernel.listDir(st.dir); if (res.ok && res.parent !== st.dir) show(res.parent); };

  Promise.resolve(USER_HOME || kernel.userHome(CURRENT_USER)).then(home => {
    const marks = [
      ["Home",        home],
      ["Desktop",     home + "/Desktop"],
      ["Documents",   home + "/Documents"],
      ["Downloads",   home + "/Downloads"],
      ["Pictures",    home + "/Pictures"],
      ["Music",       home + "/Music"],
      ["Videos",      home + "/Videos"],
      ["-", null],
      ["Applications", "/Applications"],
      ["Shared",       "/shared"],
      ["System",       "/system"],
      ["TriFS root",   "/"],
    ];
    for (const [label, p] of marks) {
      const d = document.createElement("div");
      if (label === "-") { d.className = "exp-sep"; side.appendChild(d); continue; }
      d.textContent = label;
      d.onclick = () => show(p);
      side.appendChild(d);
    }
    // Other drives: USB sticks, the TRIMANGEES drive, VirtualBox shared folders
    (async () => {
      const found = [];
      for (const base of ["/mnt/host", "/media"]) {
        const r = await kernel.listDir(base).catch(() => null);
        if (!r || !r.ok) continue;
        for (const en of r.entries) if (en.isDir) found.push([en.name.replace(/^sf_/, "Shared: "), base + "/" + en.name]);
      }
      if (!found.length) return;
      const sep = document.createElement("div"); sep.className = "exp-sep"; side.appendChild(sep);
      for (const [label, p] of found) {
        const d = document.createElement("div"); d.textContent = label; d.title = p;
        d.onclick = () => show(p); side.appendChild(d);
      }
    })();
    show(typeof w.arg === "string" && w.arg ? w.arg : home);
  });
  w.openArg = (p) => show(p);
}

// ============================================================
// File associations — files open in TRIMANGEES apps, not Chrome
// ============================================================
const FILE_URL = (p) => "file:///" + p.replace(/\\/g, "/").replace(/^\//, "");
const IMG_EXT  = ["png","jpg","jpeg","gif","webp","bmp"];
const MIME = { png:"image/png", jpg:"image/jpeg", jpeg:"image/jpeg", gif:"image/gif",
               webp:"image/webp", bmp:"image/bmp", svg:"image/svg+xml", ico:"image/x-icon",
               pdf:"application/pdf", txt:"text/plain",
               html:"text/html", htm:"text/html", md:"text/plain" };

// TriFS files aren't real files on disk, so we can't point <img>/<webview>
// at a file:// URL. Instead read the bytes from the virtual disk and hand
// back a self-contained data: URL that renders anywhere.
async function triDataUrl(path) {
  const res = await kernel.readFileB64(path);
  if (!res.ok) return null;
  const ext = (path.split(".").pop() || "").toLowerCase();
  return `data:${MIME[ext] || "application/octet-stream"};base64,${res.b64}`;
}

// Hand a real file to a suite app through ITS OWN file input — the app
// runs its normal open code, exactly as if you'd picked the file yourself.
//   TRiDOCS: #open-in (accepts .html/.htm/.txt)
//   TRiDRAW: #fi-draw (accepts images, opens them on the canvas)
async function openInSuite(appId, inputSelector, path) {
  const w = launch(appId);
  if (!w) return;
  await w.frameReady;
  const res = await kernel.readFileB64(path);
  if (!res.ok) { toast("Open failed", res.error); return; }
  const name = path.split(/[\\/]/).pop();
  const ext = (name.split(".").pop() || "").toLowerCase();
  try {
    const bytes = Uint8Array.from(atob(res.b64), c => c.charCodeAt(0));
    const file = new File([bytes], name, { type: MIME[ext] || "application/octet-stream" });
    const input = w.frame.contentDocument.querySelector(inputSelector);
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    focusWin(w);
  } catch {
    toast(appById(appId).name, `Couldn't auto-open ${name} — use the app's Open button.`);
  }
}

const PROGRAM_EXT = ["exe", "msi", "bat", "cmd", "com", "lnk", "appimage"];
async function runProgramFile(path) {
  const r = await kernel.runFile(path);
  if (r && !r.ok) toast("Couldn't start " + path.split("/").pop(), r.error || "");
}
// Put a program or app file into /Applications so it shows up in the Start menu
async function addToApplications(path) {
  const r = await kernel.copy(path, "/Applications");
  if (r && r.ok) { toast("Added to Applications", path.split("/").pop()); refreshLocalApps(); refreshExplorers(); }
  else toast("Couldn't add it", (r && r.error) || "");
}
function openFileInOS(path) {
  if (window.EX && EX.openDefault(path)) return;
  const ext = (path.split(".").pop() || "").toLowerCase();
  const name = path.split(/[\\/]/).pop();

  // Real programs: Windows .exe/.msi (Wine) and AppImages
  if (PROGRAM_EXT.includes(ext))            { runProgramFile(path); return; }

  // Suite apps own their formats now:
  if (["txt","md"].includes(ext))          { openInSuite("tridocs",   "#open-in", path); return; }
  if (["csv","tsv","trisheet"].includes(ext)) { openInSuite("trisheets", "#open-in", path); return; }
  if (ext === "trippt")                     { openInSuite("trislides", "#open-in", path); return; }
  if (IMG_EXT.includes(ext))               { launch("viewer", path); return; }
  if (["html","htm","pdf"].includes(ext))  { launch("htmlview", path); return; }
  if (["log","json","js","ts","py","rs","toml","yaml","yml","css",
       "sh","ps1","bat","c","cpp","h","java","xml","ini","cfg"].includes(ext)) {
    launch("editor", path); return;
  }
  if (["svg","ico"].includes(ext)) { launch("viewer", path); return; }
  launch("editor", path);   // no external apps on the virtual disk — open as text
  toast("Opening", name);
}

// Right-click a file → choose which Trimangees app opens it
function fileOpenWithMenu(x, y, path, extraItems) {
  const ext = (path.split(".").pop() || "").toLowerCase();
  const items = [];
  if (["txt","md","html","htm"].includes(ext))
    items.push({ label: "Open in TRiDOCS", run: () => openInSuite("tridocs", "#open-in", path) });
  if (IMG_EXT.includes(ext)) {
    items.push({ label: "Open in TRiDRAW", run: () => openInSuite("tridraw", "#fi-draw", path) });
    items.push({ label: "Open in Image Viewer", run: () => launch("viewer", path) });
  }
  if (["csv","tsv","trisheet"].includes(ext))
    items.push({ label: "Open in TRiSHEETS", run: () => openInSuite("trisheets", "#open-in", path) });
  if (["trippt","json"].includes(ext))
    items.push({ label: "Open in TRiSLIDES", run: () => openInSuite("trislides", "#open-in", path) });
  if (["html","htm","pdf"].includes(ext)) {
    items.push({ label: "Open in HTML Viewer", run: () => launch("htmlview", path) });
    items.push({ label: "Open in Trimangees Browser",
                 run: async () => { const u = await triDataUrl(path); launch("browser", u || "about:blank"); } });
  }
  if (["exe", "msi", "bat", "cmd", "com", "lnk"].includes(ext))
    items.unshift({ label: "Run with Wine (Windows)", run: () => runProgramFile(path) });
  if (ext === "appimage") items.unshift({ label: "Run", run: () => runProgramFile(path) });
  if (["exe", "msi", "html", "htm", "appimage"].includes(ext) && !path.startsWith("/Applications/"))
    items.push({ label: "Add to Applications", run: () => addToApplications(path) });
  if (!["exe", "msi", "appimage"].includes(ext))
    items.push({ label: "Open in Text Editor", run: () => launch("editor", path) });
  if (extraItems) items.push(...extraItems);
  showContextMenu(x, y, items);
}

// ============================================================
// APP: Settings — Display / Personalise / Apps / Account / System
// ============================================================
const ACCENTS = ["#4a8af0", "#3cc850", "#f07830", "#c85ae0", "#f0c020", "#f04a6e", "#3cc8c8", "#8c6cf0"];
const PRESET_NAMES = ["Aurora", "Ember", "Forest", "Storm"];

function buildSettings(body, w) {
  const SECTIONS = ["Display", "Personalise", "Apps", "Account", "System", ...EX.sectionNames];
  body.innerHTML = `
    <div class="set">
      <div class="set-side">${SECTIONS.map((s, i) =>
        `<div data-s="${i}" class="${i === 0 ? "on" : ""}">${s}</div>`).join("")}</div>
      <div class="set-main"></div>
    </div>`;
  const main = body.querySelector(".set-main");
  const tabs = body.querySelectorAll(".set-side div");

  // Hidden picker for a custom wallpaper image
  const wallInput = document.createElement("input");
  wallInput.type = "file"; wallInput.accept = "image/*"; wallInput.style.display = "none";
  body.appendChild(wallInput);
  wallInput.onchange = async () => {
    const f = wallInput.files[0];
    if (!f) return;
    const uc = getUserCfg();
    uc.wallpaperImage = await kernel.toVirtual(kernel.pathOf(f));
    uc.preset = 4;
    osApplyTheme(); saveTheme(); render(0);
    wallInput.value = "";
  };

  // ── Display ──────────────────────────────────────────────
  function renderDisplay() {
    const uc = getUserCfg();
    main.innerHTML = `
      <h2>Display</h2>
      <p class="set-note">Wallpaper and accent apply to <b>${CURRENT_USER || "you"}</b> and sync across your devices.</p>
      <h3>Wallpaper</h3>
      <div class="swatches">${[0,1,2,3].map(i =>
        `<div class="swatch sw-${i} ${uc.preset===i?"on":""}" data-p="${i}" title="${PRESET_NAMES[i]}"></div>`).join("")}
        <div class="swatch custom ${uc.preset===4?"on":""}" title="Your own image"
             style="${uc.wallpaperImage && uc.preset===4 ? `background-image:url('${FILE_URL(uc.wallpaperImage)}');background-size:cover;background-position:center;` : ""}">${uc.wallpaperImage && uc.preset===4 ? "" : "+"}</div>
      </div>
      <h3>Accent colour</h3>
      <div class="accents">${ACCENTS.map(c =>
        `<div class="acc ${uc.accent===c?"on":""}" style="background:${c}" data-a="${c}"></div>`).join("")}</div>`;
    main.querySelectorAll(".swatch:not(.custom)").forEach(sw => sw.onclick = () => {
      uc.preset = +sw.dataset.p; osApplyTheme(); saveTheme(); renderDisplay();
    });
    main.querySelector(".swatch.custom").onclick = () => wallInput.click();
    main.querySelectorAll(".acc").forEach(a => a.onclick = () => {
      uc.accent = a.dataset.a; osApplyTheme(); saveTheme(); renderDisplay();
    });
  }

  // ── Personalise ──────────────────────────────────────────
  function renderPersonalise() {
    const p = CFG.prefs || (CFG.prefs = {});
    main.innerHTML = `
      <h2>Personalise</h2>
      <h3>Motion</h3>
      <label class="set-toggle"><input type="checkbox" id="pf-motion" ${p.reduceMotion?"checked":""}>
        <span>Reduce animations<span class="set-sub">Calms the wallpaper and window motion</span></span></label>
      <h3>Taskbar clock</h3>
      <label class="set-toggle"><input type="checkbox" id="pf-secs" ${p.clockSeconds?"checked":""}>
        <span>Show seconds</span></label>
      <h3>Theme</h3>
      <button class="set-btn" id="pf-reset">Reset to my default look</button>`;
    main.querySelector("#pf-motion").onchange = (e) => {
      p.reduceMotion = e.target.checked; applyPrefs(); kernel.setConfig(CFG);
    };
    main.querySelector("#pf-secs").onchange = (e) => {
      p.clockSeconds = e.target.checked; applyPrefs(); kernel.setConfig(CFG);
    };
    main.querySelector("#pf-reset").onclick = () => {
      const def = (USERS[CURRENT_USER] && USERS[CURRENT_USER].theme) || { preset: 0, accent: "#4a8af0" };
      CFG.users[CURRENT_USER] = { ...def };
      osApplyTheme(); saveTheme(); toast("Theme reset", "Back to your default look.");
    };
  }

  // ── Apps ─────────────────────────────────────────────────
  const APP_SRC = (a) => a.userApp ? ["My apps", "src-local"]
                        : a.wineApp ? ["Windows", "src-wine"]
                        : a.builtin ? ["Built-in", "src-builtin"]
                        : a.discovered ? ["Storage", "src-storage"]
                        : ["Cloud", "src-cloud"];
  async function renderApps() {
    const pins = new Set(effectivePins());
    const list = APPS.filter(a => !a.hidden)
      .sort((a, b) => (a.category || "").localeCompare(b.category || "") || a.name.localeCompare(b.name));
    main.innerHTML = `
      <h2>Apps</h2>
      <p class="set-note"><b>Add a program:</b> pick an <code>.exe</code> / <code>.msi</code> (Windows, runs with Wine),
        an <code>.html</code> app or an <code>.AppImage</code> &mdash; it's put in your <code>/Applications</code> folder and shows in
        the Start menu. To <b>install</b> a Windows program, just double-click its installer in Downloads; whatever it
        installs appears in the Start menu on its own.</p>
      <p class="set-note">Cloud apps: add an app by uploading its HTML — it's saved to your Storage bucket under
        <code>apps/</code> and shows up here. Files you drop into Storage yourself appear too; hit Reload
        to pick them up.</p>
      <div class="set-row-btns">
        <button class="set-btn primary" id="ap-addfile">+ Add a program or app file&hellip;</button>
        <button class="set-btn" id="ap-add-toggle">+ Add an HTML app to the cloud</button>
        <button class="set-btn" id="ap-reload">&#8635; Reload from Storage</button>
      </div>
      <div id="ap-addform" hidden>
        <div class="af-grid">
          <input id="af-name" placeholder="App name — e.g. Notepad">
          <div id="af-filemode" class="af-file">
            <button class="set-btn" id="af-pick">Choose an .html file…</button>
            <span id="af-fname" class="af-fname">no file chosen</span>
          </div>
          <textarea id="af-html" class="af-html" hidden placeholder="…or paste your app's full HTML here"></textarea>
          <a class="af-switch" id="af-mode">Paste HTML instead</a>
          <div class="af-row">
            <input id="af-icon" placeholder="Icon" maxlength="2" title="A letter for the tile">
            <input id="af-color" type="color" value="#4a8af0" title="Tile colour">
            <input id="af-cat" placeholder="Category" value="Apps">
            <label class="set-toggle inline"><input type="checkbox" id="af-pin"><span>Pin to taskbar</span></label>
          </div>
          <div class="af-actions">
            <button class="set-btn primary" id="af-save">Upload to Storage</button>
            <button class="set-btn" id="af-cancel">Cancel</button>
          </div>
          <div id="af-msg" class="af-msg"></div>
        </div>
      </div>
      <div class="app-list">${list.map(a => {
        const src = APP_SRC(a);
        const pinned = pins.has(a.id);
        const sub = a.builtin && !a.url ? "built-in app"
                  : a.storagePath ? a.storagePath : (a.local ? a.url : (a.url || ""));
        return `<div class="app-row">
          <span class="app-row-ic" style="background:linear-gradient(160deg,${a.color},color-mix(in srgb,${a.color} 60%,#000))">${iconInner(a)}</span>
          <div class="app-row-meta">
            <div class="app-row-name">${a.name} <span class="app-badge ${src[1]}">${src[0]}</span></div>
            <div class="app-row-sub" title="${sub}">${a.category || "Apps"}${sub ? " &middot; " + sub : ""}</div>
          </div>
          <div class="app-row-actions">
            ${a.external ? "" : `<button class="chip ${pinned?"on":""}" data-pin="${a.id}">${pinned?"Pinned":"Pin"}</button>`}
            ${(!a.builtin && !a.wineApp) ? `<button class="chip danger" data-del="${a.id}">Remove</button>` : ""}
          </div>
        </div>`;
      }).join("")}</div>`;

    const addInput = document.createElement("input");
    addInput.type = "file"; addInput.accept = ".exe,.msi,.html,.htm,.AppImage,.appimage,.bat"; addInput.style.display = "none";
    main.appendChild(addInput);
    main.querySelector("#ap-addfile").onclick = () => addInput.click();
    addInput.onchange = async () => {
      const f = addInput.files[0]; if (!f) return;
      const v = await kernel.toVirtual(kernel.pathOf(f));
      await addToApplications(v);
      setTimeout(renderApps, 400);
    };
    main.querySelector("#ap-reload").onclick = async (e) => {
      e.target.disabled = true; e.target.textContent = "Reloading…";
      await loadApps(); await renderApps();
      toast("Apps", "Reloaded from Firebase.");
    };
    const form = main.querySelector("#ap-addform");
    main.querySelector("#ap-add-toggle").onclick = () => { form.hidden = !form.hidden; };
    const cancel = main.querySelector("#af-cancel");
    if (cancel) cancel.onclick = () => { form.hidden = true; };

    main.querySelectorAll("[data-pin]").forEach(b => b.onclick = () => { togglePin(b.dataset.pin); renderApps(); });
    main.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
      const id = b.dataset.del;
      const a = appById(id) || {};
      if (a.userApp) {
        if (!(await confirmDialog(`Remove "${a.name}" from Applications? This deletes the file from /Applications.`))) return;
        await kernel.remove(a.path); await refreshLocalApps(); await renderApps(); return;
      }
      const objectPath = a.storagePath || (a.discovered ? "apps/" + id + ".html" : null);
      const extra = objectPath ? " This deletes it from Storage." : "";
      if (!(await confirmDialog(`Remove "${a.name || id}"?${extra}`))) return;
      b.disabled = true;
      try {
        if (objectPath) await Cloud.storageDelete(objectPath);
        await Cloud.rtdbRemove("apps/" + id);
        await loadApps(); await renderApps();
        toast("Removed", a.name || id);
      } catch { b.disabled = false; toast("Couldn't remove", "Check your Firebase rules."); }
    });

    // ── Add-app form: pick a file (or paste), upload to Storage, register ──
    if (form) {
      let picked = null;                 // { path, name }
      let paste = false;
      const fileInput = document.createElement("input");
      fileInput.type = "file"; fileInput.accept = ".html,.htm,text/html"; fileInput.style.display = "none";
      main.appendChild(fileInput);
      const fname = main.querySelector("#af-fname");
      main.querySelector("#af-pick").onclick = () => fileInput.click();
      fileInput.onchange = () => {
        const f = fileInput.files[0];
        if (!f) return;
        picked = { path: kernel.pathOf(f), name: f.name };
        fname.textContent = f.name;
      };
      const html = main.querySelector("#af-html");
      const filemode = main.querySelector("#af-filemode");
      const modeLink = main.querySelector("#af-mode");
      modeLink.onclick = () => {
        paste = !paste;
        html.hidden = !paste; filemode.hidden = paste;
        modeLink.textContent = paste ? "Upload a file instead" : "Paste HTML instead";
      };

      const save = main.querySelector("#af-save");
      save.onclick = async () => {
        const name = main.querySelector("#af-name").value.trim();
        const msg  = main.querySelector("#af-msg");
        msg.className = "af-msg";
        if (!name) { msg.textContent = "Give the app a name."; return; }
        const content = html.value;
        if (paste ? !content.trim() : !picked) {
          msg.textContent = paste ? "Paste some HTML first." : "Choose an .html file first.";
          return;
        }
        const id = slugId(name);
        const objectPath = "apps/" + id + ".html";
        save.disabled = true; msg.textContent = "Uploading to Storage…";

        const up = await Cloud.storageUpload(objectPath, paste ? { content } : { filePath: picked.path });
        if (!up || !up.ok) {
          save.disabled = false;
          msg.className = "af-msg err";
          msg.textContent = up && up.status === 403
            ? "Upload blocked — your Storage rules don't allow writes yet (see firebase-setup/RULES.md)."
            : "Upload failed" + (up && up.error ? " — " + up.error : ".");
          return;
        }

        // Save the tile's name/colour/icon so it looks deliberate. Best-effort:
        // if RTDB is locked the app still appears via Storage auto-discovery.
        const rec = { name, color: main.querySelector("#af-color").value,
                      category: main.querySelector("#af-cat").value.trim() || "Apps",
                      storagePath: objectPath };
        const ic = main.querySelector("#af-icon").value.trim();
        if (ic) rec.icon = ic;
        if (main.querySelector("#af-pin").checked) rec.pinned = true;
        msg.textContent = "Saving details…";
        let metaOk = true;
        try { const r = await Cloud.rtdbPut("apps/" + id, rec); metaOk = !(r && r.ok === false); }
        catch { metaOk = false; }

        await loadApps(); await renderApps();
        toast(metaOk ? "App added" : "App uploaded",
              metaOk ? name + " is in Storage and ready."
                     : "Saved to Storage with default name/colour (RTDB rules blocked the details).");
      };
    }
  }

  // ── Account ──────────────────────────────────────────────
  function renderAccount() {
    const u = CURRENT_USER || "Guest";
    const me = USERS[u] || { color: "#4a8af0", interests: "TrimangeesOS" };
    main.innerHTML = `
      <h2>Account</h2>
      <div class="acct-card">
        <div class="acct-av" style="${EX.avatarCss(u)}">${EX.avatarText(u)}</div>
        <div><div class="acct-name">${u}</div><div class="acct-sub">${me.interests}</div></div>
      </div>
      <h3>Switch user</h3>
      <div class="acct-users">${Object.entries(USERS).map(([name, info]) =>
        `<div class="acct-user ${name===u?"on":""}">
           <span class="acct-uav" style="background:linear-gradient(160deg,${info.color},color-mix(in srgb,${info.color} 55%,#000))">${name[0]}</span>
           <span>${name}</span></div>`).join("")}</div>
      <button class="set-btn" id="acct-logout">Sign out &amp; lock</button>
      <p class="set-note">Each account keeps its own wallpaper, accent and cloud profile.</p>`;
    main.querySelector("#acct-logout").onclick = () => osDoLogout();
  }

  // ── System ───────────────────────────────────────────────
  async function renderSystem() {
    const info = await kernel.sysInfo();
    const counts = {
      builtin: APPS.filter(a => a.builtin && !a.hidden).length,
      cloud: APPS.filter(a => a.cloud).length,
      total: APPS.filter(a => !a.hidden).length,
    };
    main.innerHTML = `
      <h2>System</h2>
      <div class="set-about">
        <b>TrimangeesOS</b> 3.0 &middot; Linux edition<br>
        Signed in: <b>${CURRENT_USER || "nobody"}</b><br>
        Device: <b>${info.hostname}</b><br>
        Platform: ${info.platform} (${info.arch}) &middot; Linux ${info.kernel || ""}<br>
        Runtime: Electron ${info.electron}<br>
        Windows programs: <b>${info.wine ? "Wine " + info.wine.replace(/^wine-/, "") : "not available"}</b> &middot;
        Chrome: <b>${info.chrome ? "installed" : "not installed"}</b><br>
        Session: ${info.session ? "Full OS (ISO)" : "Development window"}
      </div>
      <h3>Firebase</h3>
      <div class="set-about">
        Status: <b id="sys-fb">checking…</b><br>
        Database: <code>${Cloud.RTDB.replace(/^https?:\/\//, "")}</code><br>
        Storage: <code>${Cloud.BUCKET}</code><br>
        Apps: ${counts.builtin} built-in &middot; ${counts.cloud} cloud &middot; <b>${counts.total}</b> total
      </div>

      <h3>TriFS &mdash; your drive</h3>
      <div class="set-about" id="sys-disk">reading&hellip;</div>
      <div class="sys-bar" id="sys-bar" hidden><i></i></div>
      <div class="set-row-btns" id="sys-trifs-btns" style="margin-top:10px"></div>
      <label class="set-toggle" style="margin-top:10px">
        <input type="checkbox" id="sys-sync">
        <span>Mirror my Documents to Firebase &mdash; so they follow me across devices</span>
      </label>
      <div class="set-row-btns" style="margin-top:10px">
        <button class="set-btn" id="sys-backup">Back up my home&hellip;</button>
        <button class="set-btn" id="sys-restore">Restore&hellip;</button>
        <button class="set-btn danger" id="sys-reset">Erase my home&hellip;</button>
      </div>

      <button class="set-btn" id="sys-reload" style="margin-top:16px">&#8635; Reload apps from cloud</button>
      <p class="set-note">Forged in the Central Storm &#9928;</p>`;
    Cloud.status().then(ok => {
      const el = main.querySelector("#sys-fb");
      if (el) { el.textContent = ok ? "Connected" : "Offline (using built-ins)"; el.className = ok ? "ok" : "warn"; }
    });

    // TriFS drive: status, usage, eject / set up
    const fmtB = (n) => n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB"
      : n < 1073741824 ? (n / 1048576).toFixed(1) + " MB" : (n / 1073741824).toFixed(1) + " GB";
    kernel.fsStat?.().then(st => {
      const el = main.querySelector("#sys-disk"); if (!el || !st) return;
      const tf = st.status || {};
      const btns = main.querySelector("#sys-trifs-btns");
      if (!st.mounted) {
        el.innerHTML = `<b class="warn">No TriFS drive</b> &mdash; this is a temporary session. Files are lost when you shut down.`;
        btns.innerHTML = `<button class="set-btn primary" id="sys-setup">Set up TriFS&hellip;</button>`;
        main.querySelector("#sys-setup").onclick = () => showTriFSWizard();
        return;
      }
      const where = tf.mode === "image" ? `file <code>TriFS.img</code> on drive <code>${tf.device || ""}</code>`
                  : tf.mode === "partition" ? `drive <code>${tf.device || ""}</code>` : `folder <code>${st.root}</code> (development)`;
      el.innerHTML = `Stored on: ${where}<br>` +
        `Size: <b>${fmtB(st.total)}</b> &middot; used <b>${fmtB(st.used)}</b> &middot; free <b>${fmtB(st.free)}</b><br>` +
        `Cloud mirror of Documents: <b>${!fsSyncOn() ? "off" : fsTooBig ? "paused (too big)" : "on"}</b>`;
      const bar = main.querySelector("#sys-bar");
      if (st.total) { bar.hidden = false; bar.firstElementChild.style.width = Math.min(100, st.used / st.total * 100).toFixed(1) + "%"; }
      if (tf.mode === "image" || tf.mode === "partition")
        btns.innerHTML = `<button class="set-btn" id="sys-eject">Safely unmount TriFS</button>`;
      const ej = main.querySelector("#sys-eject");
      if (ej) ej.onclick = async () => {
        if (!(await confirmDialog("Unmount TriFS? Close your programs first. The desktop will restart without a drive."))) return;
        [...wins].forEach(w => closeWin(w));
        const r = await kernel.trifsUnmount();
        if (r && r.ok) { toast("TriFS", "Unmounted. Restarting the desktop\u2026"); setTimeout(() => kernel.trifsRestart(), 900); }
        else toast("Couldn't unmount", (r && r.error) || "something is still using it");
      };
    });
    const sync = main.querySelector("#sys-sync");
    sync.checked = fsSyncOn();
    sync.onchange = async () => {
      CFG.fsSync = sync.checked;
      await kernel.setConfig(CFG);
      if (sync.checked) { fsLastSig = null; fsCloudPull(CURRENT_USER); toast("Sync on", "Your files will back up to Firebase."); }
      else { clearTimeout(fsPushTimer); toast("Sync off", "Files stay on this device only."); }
      renderSystem();
    };
    main.querySelector("#sys-backup").onclick = async () => {
      const r = await kernel.fsBackup?.();
      if (r && r.ok) toast("Backed up", "Saved your home folder to " + r.path);
      else if (r && !r.canceled) toast("Export failed", r.error || "");
    };
    main.querySelector("#sys-restore").onclick = async () => {
      if (!(await confirmDialog("Restore a backup into your home folder? Files in the backup replace files with the same name."))) return;
      const r = await kernel.fsRestore?.();
      if (r && r.ok) {
        CFG.fsHomeM = {}; fsLastSig = null; await kernel.setConfig(CFG);
        refreshExplorers(); await renderSystem();
        toast("Restored", "Your files were restored from the backup.");
      } else if (r && !r.canceled) toast("Restore failed", r.error || "");
    };
    main.querySelector("#sys-reset").onclick = async () => {
      if (!(await confirmDialog("Erase everything in YOUR home folder (Documents, Downloads, your Windows programs and settings)? Other accounts are not touched. This can't be undone."))) return;
      const r = await kernel.fsReset?.();
      if (r && r.ok) {
        CFG.fsHomeM = {}; fsLastSig = null; await kernel.setConfig(CFG);
        refreshExplorers(); await renderSystem();
        toast("Home erased", "Starting fresh.");
      }
    };
    main.querySelector("#sys-reload").onclick = async (e) => {
      e.target.disabled = true; e.target.textContent = "Reloading…";
      await loadApps(); await renderSystem(); toast("Apps", "Reloaded from Firebase.");
    };
  }

  async function render(section) {
    tabs.forEach(t => t.classList.toggle("on", +t.dataset.s === section));
    if (section === 0) renderDisplay();
    else if (section === 1) renderPersonalise();
    else if (section === 2) await renderApps();
    else if (section === 3) renderAccount();
    else if (section === 4) await renderSystem();
    else await EX.renderSection(section - 5, main);
  }
  tabs.forEach(t => t.onclick = () => render(+t.dataset.s));
  w.setSection = render;
  render(0);
}

// ============================================================
// APP: Generic app window — powers the suite apps AND every cloud
// app. Local files load in an iframe (so the OS can hand them files
// through the app's own Open input); remote / Storage-hosted apps
// load in a webview (which sails past X-Frame-Options).
// ============================================================
function buildGenericApp(body, w, app) {
  const url = app.url || "about:blank";
  const remote = /^https?:/i.test(url) && !app.local;
  setWinTitle(w, app.name);

  const errorScreen = (msg) => {
    body.innerHTML = `<div class="app-missing"><div>
      <div class="app-missing-icon" style="background:linear-gradient(160deg,${app.color},color-mix(in srgb,${app.color} 60%,#000))">${iconInner(app)}</div>
      <div class="big">${app.name}</div>
      <p>${msg}</p>
      ${app.cloud ? `<code>${url}</code>` : ""}
      <button class="app-retry">Try again</button>
    </div></div>`;
    body.querySelector(".app-retry").onclick = () => buildGenericApp(body, w, app);
  };

  if (remote) {
    body.innerHTML = `<div class="appwrap">
      <div class="app-loading"><span class="app-spin"></span>Loading ${app.name}…</div>
      <webview class="appview" src="${url}" allowpopups></webview>
    </div>`;
    const wv = body.querySelector("webview");
    const loading = body.querySelector(".app-loading");
    wv.addEventListener("did-stop-loading", () => loading && loading.remove(), { once: true });
    wv.addEventListener("did-fail-load", (e) => {
      if (e.errorCode === -3) return;               // aborted navigation — ignore
      errorScreen(`Couldn't load this app (${e.errorDescription || "network error"}).`);
    });
    w.openArg = (u) => { if (u) wv.setAttribute("src", u); };
    if (typeof w.arg === "string" && w.arg) wv.setAttribute("src", w.arg);
  } else {
    const frame = document.createElement("iframe");
    frame.className = "appview";
    w.frame = frame;
    w.frameReady = new Promise(res =>
      frame.addEventListener("load", () => res(), { once: true }));
    frame.src = /^(https?|file):/i.test(url) ? url : ("./" + url.replace(/^\.\//, ""));
    body.appendChild(frame);
    frame.addEventListener("load", () => {
      try {
        const d = frame.contentDocument;
        if (d && d.title === "" && d.body && d.body.childElementCount === 0)
          errorScreen(app.local
            ? `Put <b>${url}</b> back in the app folder and reopen it.`
            : "This app's page came back empty.");
      } catch { /* cross-origin — it loaded something, fine */ }
    });
    frame.addEventListener("error", () => errorScreen("This app's file couldn't be found."));
    w.openArg = (u) => { if (u) frame.src = u; };
  }
}

// ============================================================
// APP: Trimangees Browser
// Your full browser.html uses <webview> tabs, which only work on a
// top-level page. Rather than risk transplanting its 7k-line script
// into the OS page, it opens in its own frameless, desktop-styled
// window (see main.js openBrowser) — reliable, with real min/max/close
// and its traffic-light dots already wired. launch("browser") routes
// here via the app's `external` flag; the taskbar tracks it live.
// ============================================================

// A page that wanted to pop open a new window becomes a browser tab.
kernel.onBrwNewTab((u) => {
  launch("browser");
  try { if (u && typeof newTab === "function") newTab(u); } catch {}
});

// A suite app or the browser saved something — it landed in Downloads on TriFS
kernel.onDownloaded?.((d) => {
  if (d && d.failed) toast("Download failed", d.name);
  else if (d) { toast("Downloaded", d.name + " \u2192 Downloads"); refreshExplorers(); }
});

// Programs started from the OS
kernel.onRunStart?.((m) => toast("Starting", m.label));
kernel.onRunExit?.((m) => {
  if (m && m.ok === false) toast((m.label || "Program") + " stopped",
    m.error || ("It closed straight away (code " + m.code + ")."));
  setTimeout(refreshLocalApps, 1500);
});
kernel.onWineState?.((m) => {
  if (!m) return;
  if (m.state === "preparing") toast("Windows environment", "Setting it up for " + m.user + " (first time only, about a minute)\u2026");
  else if (m.state === "ready") toast("Windows environment", "Ready. .exe files can run now.");
  else if (m.state === "failed") toast("Windows environment", "Couldn't be prepared. Check the Terminal with: wine --version");
  setTimeout(refreshLocalApps, 2500);
});

// ── Other windows (Windows programs, Chrome…) in the taskbar ──
let EXT_WINS = [];
function renderExtTaskbar(list) {
  EXT_WINS = list || [];
  const bar = $("#taskbar-ext");
  if (!bar) return;
  bar.innerHTML = "";
  for (const w of EXT_WINS) {
    const b = document.createElement("button");
    b.className = "tb-ext" + (w.active ? " active" : "");
    b.title = w.title;
    const color = w.cls && /chrome/i.test(w.cls) ? "#e8453c" : "#3c78d8";
    b.innerHTML = `<span class="tb-icon" style="background:linear-gradient(160deg,${color},color-mix(in srgb,${color} 60%,#000))"></span><span class="tb-ext-t"></span>`;
    b.querySelector(".tb-icon").textContent = (w.title[0] || "?").toUpperCase();
    b.querySelector(".tb-ext-t").textContent = w.title;
    b.onclick = () => { w.active ? kernel.extMinimize(w.id) : kernel.extActivate(w.id); };
    b.oncontextmenu = (e) => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, [
        { label: "Bring to front", run: () => kernel.extActivate(w.id) },
        { label: "Minimise", run: () => kernel.extMinimize(w.id) },
        { label: "Close window", run: () => kernel.extClose(w.id) },
      ]);
    };
    b.onauxclick = (e) => { if (e.button === 1) kernel.extClose(w.id); };
    bar.appendChild(b);
  }
}
kernel.onExtWindows?.(renderExtTaskbar);

// Any change to the disk schedules a (debounced, guarded) cloud sync
kernel.onFsChanged?.(() => fsSchedulePush(false));

// ============================================================
// APP: Image Viewer — for pictures from the file explorer
// ============================================================
// ============================================================
// APP: Trimangees Browser — TRANSPLANTED into a desktop window
// ------------------------------------------------------------
// The browser's tabs are <webview>s, which can't nest inside
// another webview/iframe. So instead of embedding it, we inject
// its HTML/CSS/JS straight into this OS page: the tab-webviews
// then live at the top level (allowed), and the browser runs as
// a normal window inside TrimangeesOS. Its CSS is scoped to
// #brw-host so it can't leak out and disturb the desktop.
// ============================================================
function scopeCssRules(css, scope) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const matchBrace = (str, open) => {
    let d = 0;
    for (let i = open; i < str.length; i++) {
      if (str[i] === "{") d++;
      else if (str[i] === "}") { d--; if (!d) return i; }
    }
    return str.length - 1;
  };
  const scopeSel = (list) => list.split(",").map(sel => {
    sel = sel.trim(); if (!sel) return sel;
    if (/^(html|body|:root)\b/i.test(sel)) return sel.replace(/^(html|body|:root)/i, scope);
    return scope + " " + sel;
  }).join(", ");
  let out = "", i = 0;
  while (i < css.length) {
    const brace = css.indexOf("{", i);
    if (brace === -1) { out += css.slice(i); break; }
    const semi = css.indexOf(";", i);
    let header = css.slice(i, brace);
    if (semi !== -1 && semi < brace && header.indexOf("@") !== -1) {
      out += css.slice(i, semi + 1); i = semi + 1; continue;   // @import / @charset
    }
    header = header.trim();
    if (header[0] === "@") {
      const at = header.split(/[\s{]/)[0].toLowerCase();
      const end = matchBrace(css, brace);
      if (/keyframes|font-face|page|counter-style|font-feature/.test(at)) {
        out += css.slice(i, end + 1);                          // copy verbatim
      } else if (/media|supports|document|layer|container/.test(at)) {
        out += header + " {\n" + scopeCssRules(css.slice(brace + 1, end), scope) + "\n}\n";
      } else {
        out += css.slice(i, end + 1);
      }
      i = end + 1; continue;
    }
    const end = css.indexOf("}", brace);
    out += scopeSel(header) + " {" + css.slice(brace + 1, end) + "}\n";
    i = end + 1;
  }
  return out;
}

async function buildBrowser(body, w) {
  setWinTitle(w, "Trimangees Browser");
  w.persistent = true;                       // closing hides it so its tabs stay alive
  body.innerHTML = `<div class="brw-host" id="brw-host"></div>`;
  const host = body.querySelector("#brw-host");

  // Already built once? Move the live browser DOM into this window.
  if (window.__brwLoaded && window.__brwInner) { host.appendChild(window.__brwInner); return; }

  let htmlText = null;
  try { htmlText = await kernel.readAppFile("browser/browser.html"); } catch {}
  if (!htmlText) { host.innerHTML = `<div style="color:#eee;padding:24px;font-family:system-ui">Couldn't load the browser file.</div>`; return; }

  const doc = new DOMParser().parseFromString(htmlText, "text/html");

  // Fonts (once)
  if (!document.getElementById("brw-fonts")) {
    const link = doc.querySelector('link[rel="stylesheet"]');
    if (link) { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = link.href; l.id = "brw-fonts"; document.head.appendChild(l); }
  }
  // Scoped CSS (once)
  if (!document.getElementById("brw-style")) {
    const styleEl = doc.querySelector("head style") || doc.querySelector("style");
    if (styleEl) {
      const st = document.createElement("style"); st.id = "brw-style";
      st.textContent = scopeCssRules(styleEl.textContent, "#brw-host");
      document.head.appendChild(st);
    }
  }
  // Inject the body content into a wrapper we keep alive across open/close
  const inner = document.createElement("div");
  inner.style.cssText = "width:100%;height:100%;display:flex;flex-direction:column;min-height:0;";
  inner.innerHTML = doc.body.innerHTML;
  host.appendChild(inner);
  window.__brwInner = inner;

  // Run the browser's script ONCE (its top-level fns become global so the
  // inline onclick handlers work), then fire the init event it waits for.
  if (!window.__brwLoaded) {
    const codeEl = [...doc.querySelectorAll("script")].filter(x => !x.src).pop();
    if (codeEl) {
      const sc = document.createElement("script");
      sc.textContent = codeEl.textContent;
      document.body.appendChild(sc);
      window.__brwLoaded = true;
      try { document.dispatchEvent(new Event("DOMContentLoaded")); } catch {}
    }
  }
}

function buildViewer(body, w) {
  const file = w.arg || "";
  const name = file.split(/[\\/]/).pop();
  setWinTitle(w, name + " - Image Viewer");
  body.innerHTML = `<div class="viewer"><img></div>`;
  const img = body.querySelector("img");
  triDataUrl(file).then(u => {
    if (u) img.src = u;
    else toast("Image Viewer", "Couldn't open " + name);
  });
  w.openArg = (f) => { w.arg = f; buildViewer(body, w); };
}

// ============================================================
// APP: HTML Viewer — renders .html and .pdf files from the
// virtual disk in their own window (via a self-contained data URL)
// ============================================================
function buildHtmlView(body, w) {
  body.innerHTML = `
    <div class="hv">
      <div class="hv-bar">
        <span class="hv-name"></span>
        <button class="hv-rel" title="Reload">&#8635;</button>
        <button class="hv-brw" title="Open in Trimangees Browser">Open in Browser</button>
      </div>
      <webview></webview>
    </div>`;
  const view = body.querySelector("webview");
  const nameEl = body.querySelector(".hv-name");
  const nameOf = (p) => (String(p).split(/[\\/]/).pop() || "page");

  async function load(p) {
    w.arg = p;
    if (!p || p === "about:blank") { view.setAttribute("src", "about:blank"); return; }
    const nn = nameOf(p);
    nameEl.textContent = nn;
    setWinTitle(w, nn + " - HTML Viewer");
    const u = await triDataUrl(p);
    w._dataUrl = u;
    view.setAttribute("src", u || "about:blank");
    if (!u) toast("HTML Viewer", "Couldn't open " + nn);
  }

  body.querySelector(".hv-rel").onclick = () => view.reload();
  body.querySelector(".hv-brw").onclick = () => launch("browser", w._dataUrl || "about:blank");
  w.openArg = (p) => load(p);
  load(w.arg || "about:blank");
}

// ============================================================
// APP: Text Editor — open, edit, Ctrl+S to save
// ============================================================
function buildEditor(body, w) {
  const file = w.arg || "";
  const name = file.split(/[\\/]/).pop();
  body.innerHTML = `
    <div class="editor">
      <div class="ed-bar"><span class="ed-name"></span><span class="ed-dirty" hidden>&#9679; unsaved</span>
        <span class="ed-hint">Ctrl+S saves</span></div>
      <textarea spellcheck="false"></textarea>
    </div>`;
  const ta = body.querySelector("textarea");
  const dirty = body.querySelector(".ed-dirty");
  body.querySelector(".ed-name").textContent = name;
  setWinTitle(w, name + " - Editor");

  kernel.readFile(file).then(res => {
    if (res.ok) ta.value = res.content;
    else { ta.value = ""; toast("Editor", res.error); }
  });
  ta.addEventListener("input", () => { dirty.hidden = false; });
  ta.addEventListener("keydown", async (e) => {
    if (e.ctrlKey && (e.key === "s" || e.key === "S")) {
      e.preventDefault();
      const res = await kernel.writeFile(file, ta.value);
      if (res.ok) { dirty.hidden = true; toast("Saved", name); }
      else toast("Save failed", res.error);
    }
  });
  setTimeout(() => ta.focus(), 0);
}

// ============================================================
// Lock screen — TrimangeesOS accounts
// ============================================================
const lockEl = () => $("#lock");
let lockUser = null;

function buildLock() {
  const tiles = $("#lock-tiles");
  tiles.innerHTML = "";
  for (const [name, info] of Object.entries(USERS)) {
    const t = document.createElement("div");
    t.className = "lk-tile";
    t.dataset.user = name;
    t.innerHTML = `<div class="lk-av" style="${EX.avatarCss(name)}">${EX.avatarText(name)}</div>
                   <div class="lk-name">${name}</div>
                   <div class="lk-int">${info.interests}</div>`;
    t.onclick = () => selectLockUser(name);
    tiles.appendChild(t);
  }
  const pin = $("#lock-pin");
  pin.addEventListener("input", () => {
    if (pin.value.length >= 4) trySubmitPin();
  });
  pin.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") trySubmitPin();
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const names = Object.keys(USERS);
      let i = names.indexOf(lockUser);
      i = (i + (e.key === "ArrowRight" ? 1 : -1) + names.length) % names.length;
      selectLockUser(names[i]);
    }
  });
  selectLockUser(CFG.lastUser && USERS[CFG.lastUser] ? CFG.lastUser : "Adithya");
}

function selectLockUser(name) {
  lockUser = name;
  $$(".lk-tile").forEach(t => t.classList.toggle("selected", t.dataset.user === name));
  $("#lock-hello").textContent = `Hi ${name} — enter your PIN`;
  const pin = $("#lock-pin");
  pin.value = "";
  $("#lock-msg").textContent = "";
  setTimeout(() => pin.focus(), 0);
}

async function trySubmitPin() {
  const pin = $("#lock-pin");
  if (pin.value !== USERS[lockUser].pin) {
    $("#lock-msg").textContent = "Wrong PIN — try again";
    const card = $(".lock-card");
    card.classList.remove("shake"); void card.offsetWidth;
    card.classList.add("shake");
    pin.value = "";
    return;
  }
  await completeLogin(lockUser);
}

async function completeLogin(user) {
  CURRENT_USER = user;
  USER_HOME = await kernel.userHome(user);
  kernel.setUser?.(user);             // route downloads + resolve ~ to this user
  CFG.lastUser = user;
  getUserCfg();                       // ensure per-user theme exists
  await cloudPull(user);              // best-effort theme sync from Firebase
  osApplyTheme();
  await kernel.setConfig(CFG);
  cloudPush();
  fsCloudPull(user);                  // best-effort: pull this account's files (non-blocking)
  lockEl().classList.add("hidden");
  setTimeout(() => { lockEl().style.display = "none"; }, 450);
  refreshProfile();
  try { EX.onLogin(user); } catch (e) { console.warn(e); }
  updateTaskbar();
  toast(`Welcome, ${user}!`, USERS[user].flavor);
}

function osDoLogout() {
  [...wins].forEach(w => closeWin(w));
  CURRENT_USER = null;
  osApplyThemeGuest();
  const el = lockEl();
  el.style.display = "";
  requestAnimationFrame(() => el.classList.remove("hidden"));
  selectLockUser(CFG.lastUser || "Adithya");
}

function osApplyThemeGuest() {
  document.body.style.backgroundImage = "";
  document.body.className = "preset-0";
}

// ============================================================
// Desktop icons
// ============================================================
function buildDesktopIcons() {
  setTimeout(() => { try { EX.desktopRefresh(); } catch {} }, 0);
  const icons = [
    { name: "File Explorer", app: "explorer", x: 22, y: 20, folder: true },
    { name: "Trimangees Browser", app: "browser", x: 22, y: 122 },
    { name: "Terminal", app: "terminal", x: 22, y: 224 },
    { name: "Mayfly", app: "mayfly", x: 22, y: 326 },
  ];
  for (const ic of icons) {
    const el = document.createElement("div");
    el.className = "desk-icon";
    el.style.left = ic.x + "px"; el.style.top = ic.y + "px";
    el.innerHTML = `<div class="glyph"></div><span></span>`;
    const a0 = appById(ic.app) || BUILT_IN_APPS.find(x => x.id === ic.app);
    if (!ic.folder && a0) {
      const g = el.querySelector(".glyph");
      g.classList.add("tile");
      g.style.background = `linear-gradient(160deg,${a0.color},color-mix(in srgb,${a0.color} 58%,#000))`;
      g.textContent = a0.letter || a0.name[0];
    }
    el.querySelector("span").textContent = ic.name;
    el.onclick = () => { $$(".desk-icon").forEach(d => d.classList.remove("selected")); el.classList.add("selected"); };
    el.ondblclick = () => launch(ic.app);
    $("#icons").appendChild(el);
  }
  $("#desktop").addEventListener("pointerdown", (e) => {
    if (e.target === $("#desktop") || e.target === $("#icons"))
      $$(".desk-icon").forEach(d => d.classList.remove("selected"));
  });
}

// ============================================================
// TriFS setup — finds / creates the drive that holds your files
// ============================================================
let twEl = null, twSkipped = false;
const twFmt = (n) => n >= 1e12 ? (n / 1e12).toFixed(1) + " TB" : n >= 1e9 ? (n / 1e9).toFixed(1) + " GB" : (n / 1e6).toFixed(0) + " MB";

async function showTriFSWizard() {
  if (!twEl) { twEl = document.createElement("div"); twEl.id = "trifs-setup"; osAppend(twEl); }
  twEl.hidden = false;
  twEl.innerHTML = `<div class="tw-card"><div class="tw-title">TriFS</div>
    <div class="tw-sub">Looking for your drive&hellip;</div><div class="tw-spin"></div></div>`;
  const scan = await kernel.trifsScan().catch(() => ({ ok: false, error: "couldn't scan" }));
  renderTriFSWizard(scan);
}
function renderTriFSWizard(scan, note) {
  const card = document.createElement("div"); card.className = "tw-card";
  const blank = (scan && scan.blank) || [], hosts = (scan && scan.hosts) || [], found = (scan && scan.found) || [];
  let html = `<div class="tw-title">Set up TriFS</div>
    <div class="tw-sub">TriFS is the drive where TrimangeesOS keeps your files, programs and settings.
      I can't find one yet, so right now <b>nothing you do would be saved</b>.</div>`;
  if (note) html += `<div class="tw-note ${note.err ? "err" : ""}">${note.text}</div>`;
  if (!scan || scan.ok === false) html += `<div class="tw-note err">${(scan && scan.error) || "The drive manager isn't available."}</div>`;
  if (found.length) {
    html += `<div class="tw-h">A TriFS drive is here</div>` + found.map(f => `
      <div class="tw-row"><div><b>${f.dev}</b><span>${twFmt(f.size)} &middot; labelled TRIFS</span></div>
      <button class="set-btn primary" data-mount="1">Use it</button></div>`).join("");
  }
  if (blank.length) {
    html += `<div class="tw-h">Blank disks <small>nothing on them, so nothing is lost</small></div>` + blank.map(d => `
      <div class="tw-row"><div><b>${d.model || "Disk"}</b><span>${twFmt(d.size)} &middot; ${d.dev}</span></div>
      <button class="set-btn primary" data-fmt="${d.dev}">Use this disk</button></div>`).join("");
  }
  if (hosts.length) {
    html += `<div class="tw-h">Use free space on a drive <small>makes one file called TriFS.img &mdash; nothing else on the drive is touched</small></div>` +
      hosts.map(h => {
        const gb = Math.max(2, Math.floor(h.free / 1073741824 * 0.92));
        return `<div class="tw-row"><div><b>${h.label || h.dev}</b><span>${h.fstype.toUpperCase()} &middot; ${twFmt(h.free)} free of ${twFmt(h.size)}</span></div>
          ${h.hasImage
            ? `<button class="set-btn primary" data-mount="1">Use the TriFS already there</button>`
            : `<span class="tw-size"><input type="number" min="2" max="${Math.floor(h.free / 1073741824) - 1}" value="${gb}" data-gb="${h.dev}"> GB
               <button class="set-btn primary" data-img="${h.dev}">Create TriFS</button></span>`}
        </div>`;
      }).join("");
  }
  if (!found.length && !blank.length && !hosts.length && scan && scan.ok !== false) {
    html += `<div class="tw-note">I don't see a disk I can use. Shut the computer down, add a second (blank) virtual disk or plug in your
      TRIMANGEES drive, then start again.</div>`;
  }
  html += `<div class="tw-foot">
      <button class="set-btn" id="tw-rescan">Scan again</button>
      <button class="set-btn" id="tw-skip">Continue without saving</button></div>`;
  card.innerHTML = html;
  twEl.innerHTML = ""; twEl.appendChild(card);

  const busy = (text) => { card.innerHTML = `<div class="tw-title">Setting up&hellip;</div><div class="tw-sub">${text}</div><div class="tw-spin"></div>`; };
  const done = async (r) => {
    if (r && r.ok && r.mounted) {
      card.innerHTML = `<div class="tw-title">TriFS is ready</div><div class="tw-sub">${twFmt(r.total || 0)} drive mounted. Restarting the desktop so it can use it&hellip;</div><div class="tw-spin"></div>`;
      setTimeout(() => kernel.trifsRestart(), 1200);
    } else if (r && r.ok) {
      renderTriFSWizard(await kernel.trifsScan(), { err: true, text: "That didn't find anything to mount." });
    } else {
      renderTriFSWizard(await kernel.trifsScan(), { err: true, text: (r && r.error) || "Something went wrong." });
    }
  };
  card.querySelectorAll("[data-mount]").forEach(b => b.onclick = async () => { busy("Mounting&hellip;"); done(await kernel.trifsMount()); });
  card.querySelectorAll("[data-fmt]").forEach(b => b.onclick = async () => { busy("Preparing the disk. This takes a few seconds&hellip;"); done(await kernel.trifsFormat(b.dataset.fmt)); });
  card.querySelectorAll("[data-img]").forEach(b => b.onclick = async () => {
    const gb = +card.querySelector(`[data-gb="${b.dataset.img}"]`).value;
    busy(`Creating a ${gb} GB TriFS file. Big drives can take a minute&hellip;`);
    done(await kernel.trifsCreateImg(b.dataset.img, gb));
  });
  card.querySelector("#tw-rescan").onclick = () => showTriFSWizard();
  card.querySelector("#tw-skip").onclick = () => { twSkipped = true; twEl.hidden = true; toast("Temporary session", "Nothing will be saved. Set up TriFS any time in Settings \u2192 System."); };
}
async function maybeTriFSWizard() {
  try {
    const st = await kernel.trifsStatus();
    if (st && st.ok !== false && !st.mounted && !twSkipped) showTriFSWizard();
  } catch {}
}

// ============================================================
// Boot
// ============================================================
(async function boot() {
  CFG = migrateConfig(await kernel.getConfig());
  applyPrefs();
  osApplyThemeGuest();
  buildTaskbar();          // built-in apps show instantly
  buildDesktopIcons();
  updateTaskbar();
  EX.applyAccounts();
  buildLock();
  // Pull the app list from Firebase in the background — cloud apps pop
  // into the taskbar / Start menu a moment later, no reboot-blocking wait.
  loadApps().catch(() => {});
  // Splash fades out to reveal the lock screen
  setTimeout(() => $("#splash").classList.add("fade"), 1300);
  setTimeout(() => $("#splash").remove(), 2000);
  setTimeout(() => EX.maybeFirstRun(), 1800);
  setInterval(() => { if (CURRENT_USER) refreshLocalApps(); }, 20000);   // programs installed in the meantime
})();
