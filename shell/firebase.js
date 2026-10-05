// ============================================================
// Trimangees OS — Firebase backbone
// One place for every cloud URL, and the small helper the desktop
// uses to read its app list, sync per-user themes, and turn a file
// in Storage into a URL the OS can open.
//
// Nothing here needs the Firebase SDK — it's plain REST, so it works
// from a file:// page with no build step. The desktop reads this as
// window.Cloud (loaded before os.js).
//
// ── To point the OS at a different project, change these two lines ──
// ============================================================
const FB_RTDB   = "https://trimangeesos-default-rtdb.firebaseio.com"; // Realtime Database
const FB_BUCKET = "trimangeesos.firebasestorage.app";                 // Storage bucket

// ============================================================
// A default set of nice accent colours to hand out to cloud apps
// that don't name their own, so every tile still looks deliberate.
// ============================================================
const APP_PALETTE = ["#4a8af0", "#3cc850", "#f07830", "#c85ae0",
                     "#f0c020", "#f04a6e", "#3cc8c8", "#8c6cf0", "#e0a030"];
const pickColor = (seed) => {
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return APP_PALETTE[h % APP_PALETTE.length];
};

const isImageRef = (s) => typeof s === "string" && /^(https?:|data:image\/)/i.test(s.trim());
const prettyName = (file) =>
  file.replace(/^apps\//i, "").replace(/\.html?$/i, "")
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, c => c.toUpperCase())
      .trim() || "App";

window.Cloud = {
  RTDB: FB_RTDB,
  BUCKET: FB_BUCKET,

  // ── Realtime Database (plain REST) ────────────────────────
  // Everything is best-effort: if the network or the rules say no,
  // the OS keeps working from its built-in list and local config.
  async rtdbGet(pathNoExt, timeout = 5000) {
    const url = `${FB_RTDB}/${pathNoExt}.json`;
    const r = await fetch(url, { signal: AbortSignal.timeout(timeout) });
    if (!r.ok) throw new Error("rtdb " + r.status);
    return r.json();
  },
  async rtdbPut(pathNoExt, value) {
    return fetch(`${FB_RTDB}/${pathNoExt}.json`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    });
  },
  async rtdbPatch(pathNoExt, value) {
    return fetch(`${FB_RTDB}/${pathNoExt}.json`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    });
  },
  async rtdbRemove(pathNoExt) {
    return fetch(`${FB_RTDB}/${pathNoExt}.json`, { method: "DELETE" });
  },

  // ── Storage ───────────────────────────────────────────────
  // Turn an object path ("apps/notepad.html") into a URL the OS can
  // load in a webview. Works for any file whose Storage rules allow read.
  storageUrl(objectPath) {
    const clean = String(objectPath).replace(/^\/+/, "");
    return `https://firebasestorage.googleapis.com/v0/b/${FB_BUCKET}` +
           `/o/${encodeURIComponent(clean)}?alt=media`;
  },
  // List *.html under a prefix (default apps/). Routed through the kernel
  // so there's no browser CORS wall. Returns [] if the bucket won't list.
  async storageListApps(prefix = "apps/") {
    try {
      if (!window.kernel || !kernel.storageList) return [];
      const res = await kernel.storageList(FB_BUCKET, prefix);
      if (!res || !res.ok || !Array.isArray(res.items)) return [];
      return res.items.filter(n => /\.html?$/i.test(n));
    } catch { return []; }
  },
  // Upload an app into the bucket. `src` is either { filePath } (a file the
  // user picked) or { content } (raw HTML text). Returns { ok, ... }.
  async storageUpload(objectPath, src = {}) {
    if (!window.kernel || !kernel.storageUpload)
      return { ok: false, error: "storage upload unavailable" };
    return kernel.storageUpload({
      bucket: FB_BUCKET,
      objectPath: String(objectPath).replace(/^\/+/, ""),
      filePath: src.filePath,
      content: src.content,
      contentType: src.contentType || "text/html; charset=utf-8",
    });
  },
  async storageDelete(objectPath) {
    if (!window.kernel || !kernel.storageDelete)
      return { ok: false, error: "storage delete unavailable" };
    return kernel.storageDelete(FB_BUCKET, String(objectPath).replace(/^\/+/, ""));
  },

  // ── Turn one raw manifest entry into an OS app definition ──
  normalizeApp(id, raw) {
    if (!raw || typeof raw !== "object") return null;
    if (raw.enabled === false) return null;
    let url = raw.url && String(raw.url).trim();
    if (!url && raw.storagePath) url = this.storageUrl(raw.storagePath);
    if (!url) return null;                       // nothing to open — skip
    const app = {
      id: String(id),
      name: raw.name || prettyName(String(id)),
      color: raw.color || pickColor(id),
      url,
      category: raw.category || "Apps",
      cloud: true,
      cloudPinned: raw.pinned === true,
      hidden: raw.hidden === true,
      order: typeof raw.order === "number" ? raw.order : 100,
      // remote pages open in a webview; a local path opens in an iframe
      local: /^(\.\/|apps\/)/i.test(url) && !/^https?:/i.test(url),
    };
    if (raw.storagePath) app.storagePath = String(raw.storagePath).replace(/^\/+/, "");
    if (isImageRef(raw.icon)) app.iconUrl = raw.icon.trim();
    else app.letter = (raw.icon && String(raw.icon).slice(0, 2)) ||
                      app.name[0].toUpperCase();
    return app;
  },

  // ── The one call the desktop makes at boot ────────────────
  // Reads /apps from RTDB, auto-discovers *.html in Storage/apps,
  // and returns a clean array of app definitions (RTDB wins on id).
  async loadAppManifest() {
    const apps = new Map();

    // 1) Explicit registrations in RTDB  (/apps/{id})
    try {
      const node = await this.rtdbGet("apps");
      if (node && typeof node === "object") {
        for (const [id, raw] of Object.entries(node)) {
          const a = this.normalizeApp(id, raw);
          if (a) apps.set(a.id, a);
        }
      }
    } catch (e) { console.warn("[Cloud] app manifest unavailable:", e.message); }

    // 2) Auto-discovered *.html in Storage  (drop-a-file workflow)
    try {
      const files = await this.storageListApps("apps/");
      for (const file of files) {
        const id = file.replace(/^apps\//i, "").replace(/\.html?$/i, "");
        if (apps.has(id)) continue;              // RTDB entry already covers it
        apps.set(id, {
          id, name: prettyName(file), color: pickColor(id),
          url: this.storageUrl(file), storagePath: file, category: "Apps",
          cloud: true, discovered: true, order: 100,
          letter: prettyName(file)[0].toUpperCase(), local: false,
        });
      }
    } catch { /* bucket not listable — RTDB list still works */ }

    return [...apps.values()].sort((a, b) => a.order - b.order);
  },

  // Quick reachability check for the Settings → System panel
  async status() {
    try { await this.rtdbGet(".info/connected", 3500); return true; }
    catch { return false; }
  },
};
