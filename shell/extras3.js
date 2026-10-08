// ============================================================
// extras3 — taskbar tray (volume / Wi-Fi / notifications / calendar),
// virtual desktops, show-desktop, file search, pin anything,
// disk-almost-full warning, window snap keys.
// ============================================================
"use strict";

(() => {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const sh = (c, t) => kernel.sh(c, t).catch((e) => ({ ok: false, out: "", err: String(e) }));
  const save = () => { try { kernel.setConfig(CFG); } catch {} };
  const q = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";

  EX.appSources = EX.appSources || [];
  EX.extraApps = () => EX.appSources.flatMap((f) => { try { return f() || []; } catch { return []; } });

  // ── pin anything to the taskbar ──────────────────────────
  const pinId = (p) => "pp-" + [...p].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(36);
  EX.appSources.push(() => (CFG.pinPaths || []).map((x) => ({
    id: pinId(x.path), name: x.name, color: x.dir ? "#f0b423" : "#6a8caf", letter: x.dir ? "\u{1F4C1}" : (x.name[0] || "?").toUpperCase(),
    category: "Pinned", exec: { type: "path", path: x.path, dir: !!x.dir }, userApp: true })));
  EX.pinPath = (path, name, dir) => {
    CFG.pinPaths = (CFG.pinPaths || []).filter((x) => x.path !== path);
    CFG.pinPaths.push({ path, name, dir: !!dir });
    const id = pinId(path);
    mergeApps();
    const set = new Set(effectivePins()); set.add(id); CFG.pins = [...set];
    PINNED = effectivePins(); buildTaskbar(); updateTaskbar(); save();
    toast("Taskbar", "Pinned " + name);
  };

  // ── notification history ─────────────────────────────────
  EX.notes = []; let unread = 0;
  EX.logNote = (title, body) => {
    EX.notes.unshift({ t: Date.now(), title: String(title), body: String(body || "") });
    if (EX.notes.length > 60) EX.notes.pop();
    unread++; paintTray();
  };

  // ── tray ─────────────────────────────────────────────────
  let tray, pop, popKind = null;
  const vol = { v: 50, muted: false }, net = { name: "", wifi: false, up: false };
  function paintTray() {
    if (!tray) return;
    tray.querySelector("#tr-vol").textContent = vol.muted || vol.v === 0 ? "\u{1F507}" : vol.v < 40 ? "\u{1F509}" : "\u{1F50A}";
    tray.querySelector("#tr-net").textContent = net.up ? (net.wifi ? "\u{1F4F6}" : "\u{1F5A7}") : "⚠️";
    const b = tray.querySelector("#tr-bell"); b.dataset.n = unread ? (unread > 9 ? "9+" : unread) : "";
    tray.querySelector("#tr-desk").textContent = (EX.desk + 1);
  }
  async function pollSys() {
    const v = await sh("pactl get-sink-volume @DEFAULT_SINK@ 2>/dev/null | head -1; pactl get-sink-mute @DEFAULT_SINK@ 2>/dev/null");
    const m = /(\d+)%/.exec(v.out || ""); if (m) vol.v = +m[1]; vol.muted = /Mute: yes/.test(v.out || "");
    const n = await sh("nmcli -t -f TYPE,STATE,CONNECTION dev 2>/dev/null | grep ':connected:' | head -1");
    const l = (n.out || "").trim().split(":");
    net.up = l[0] && /ethernet|wifi/.test(l[0]); net.wifi = l[0] === "wifi"; net.name = l[2] || "";
    paintTray();
  }
  function closePop() { if (pop) { pop.remove(); pop = null; popKind = null; } }
  function openPop(kind, html, wire) {
    if (popKind === kind) return closePop();
    closePop(); popKind = kind;
    pop = document.createElement("div"); pop.id = "ex-pop"; pop.innerHTML = html;
    document.body.appendChild(pop);
    pop.addEventListener("pointerdown", (e) => e.stopPropagation());
    wire && wire(pop);
  }
  document.addEventListener("pointerdown", (e) => { if (pop && !e.target.closest("#tray, #clock")) closePop(); }, true);

  function volPanel() {
    openPop("vol", `<h4>Sound</h4>
      <input type="range" id="p-vol" min="0" max="100" value="${vol.v}" style="width:100%">
      <div class="pp-row"><button class="set-btn" id="p-mute">${vol.muted ? "Unmute" : "Mute"}</button><span id="p-vn">${vol.v}%</span></div>`, (p) => {
      p.querySelector("#p-vol").oninput = (e) => { vol.v = +e.target.value; p.querySelector("#p-vn").textContent = vol.v + "%"; sh(`pactl set-sink-volume @DEFAULT_SINK@ ${vol.v}%`); CFG.prefs = { ...(CFG.prefs || {}), volume: vol.v }; paintTray(); };
      p.querySelector("#p-vol").onchange = save;
      p.querySelector("#p-mute").onclick = async () => { await sh("pactl set-sink-mute @DEFAULT_SINK@ toggle"); await pollSys(); closePop(); };
    });
  }
  async function netPanel() {
    openPop("net", `<h4>Network</h4><div class="pp-note">Looking…</div>`);
    const st = await sh("nmcli -t -f ACTIVE,SSID,SIGNAL,SECURITY dev wifi list 2>/dev/null | head -12");
    const rows = (st.out || "").trim().split("\n").filter(Boolean).map((l) => l.split(":"));
    if (!pop || popKind !== "net") return;
    pop.innerHTML = `<h4>Network</h4><div class="pp-note">${net.up ? "Connected" + (net.name ? " — " + esc(net.name) : "") : "Not connected"}</div>
      ${rows.length ? rows.map((r, i) => `<div class="pp-item" data-i="${i}"><span>${r[0] === "yes" ? "✓ " : ""}${esc(r[1] || "(hidden)")}</span><i>${esc(r[2] || "")}%${r[3] ? " \u{1F512}" : ""}</i></div>`).join("") : `<div class="pp-note">No Wi-Fi found (wired connections just work).</div>`}
      <div class="pp-row"><button class="set-btn" id="p-adv">Network settings</button></div>`;
    pop.querySelectorAll(".pp-item").forEach((el) => el.onclick = async () => {
      const r = rows[+el.dataset.i]; if (!r[1]) return;
      let cmd = `nmcli dev wifi connect ${q(r[1])} 2>&1`;
      if (r[3]) { const pw = await EX.askText("Wi-Fi password", "Password for " + r[1], ""); if (pw == null) return; cmd = `nmcli dev wifi connect ${q(r[1])} password ${q(pw)} 2>&1`; }
      toast("Wi-Fi", "Connecting…"); const o = await sh(cmd, 40000); toast("Wi-Fi", (o.out || o.err || "done").trim().slice(0, 120)); pollSys(); closePop();
    });
    pop.querySelector("#p-adv").onclick = () => { closePop(); launch("settings"); };
  }
  function bellPanel() {
    unread = 0; paintTray();
    openPop("bell", `<h4>Notifications <button class="set-btn" id="p-clr" style="float:right">Clear</button></h4>
      ${EX.notes.length ? EX.notes.map((n) => `<div class="pp-note2"><b>${esc(n.title)}</b><span>${esc(n.body)}</span><i>${new Date(n.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</i></div>`).join("") : `<div class="pp-note">Nothing new.</div>`}`, (p) => {
      p.querySelector("#p-clr").onclick = () => { EX.notes = []; closePop(); };
    });
  }
  let calM = new Date();
  function calPanel() {
    const draw = () => {
      const y = calM.getFullYear(), m = calM.getMonth(), first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
      const today = new Date();
      let cells = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => `<b>${d}</b>`).join("");
      for (let i = 0; i < first; i++) cells += "<span></span>";
      for (let d = 1; d <= days; d++) cells += `<span class="${d === today.getDate() && m === today.getMonth() && y === today.getFullYear() ? "td" : ""}">${d}</span>`;
      pop.innerHTML = `<div class="cal-h"><button class="set-btn" id="c-p">‹</button><b>${calM.toLocaleDateString([], { month: "long", year: "numeric" })}</b><button class="set-btn" id="c-n">›</button></div><div class="cal-g">${cells}</div>
        <div class="pp-note" style="margin-top:8px">${today.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}</div>`;
      pop.querySelector("#c-p").onclick = () => { calM = new Date(y, m - 1, 1); draw(); };
      pop.querySelector("#c-n").onclick = () => { calM = new Date(y, m + 1, 1); draw(); };
    };
    calM = new Date(); openPop("cal", "", draw); if (pop) draw();
  }

  // ── virtual desktops ─────────────────────────────────────
  EX.desk = 0; const DESKS = 4;
  EX.onNewWin = (w) => { w.desk = EX.desk; };
  function switchDesk(n) {
    n = (n + DESKS) % DESKS; EX.desk = n;
    wins.forEach((w) => w.el.classList.toggle("desk-hidden", (w.desk ?? 0) !== n));
    const top = activeWin(); if (top) focusWin(top); else updateTaskbar();
    paintTray();
  }
  EX.switchDesk = switchDesk;
  function deskPanel() {
    openPop("desk", `<h4>Desktops</h4>${Array.from({ length: DESKS }, (_, i) => `<div class="pp-item ${i === EX.desk ? "on" : ""}" data-d="${i}"><span>Desktop ${i + 1}</span><i>${wins.filter((w) => (w.desk ?? 0) === i).length} windows</i></div>`).join("")}
      <div class="pp-row"><button class="set-btn" id="p-mv">Move this window to next desktop</button></div>
      <div class="pp-note">Tip: Ctrl+Alt+← / → switches desktop.</div>`, (p) => {
      p.querySelectorAll("[data-d]").forEach((el) => el.onclick = () => { switchDesk(+el.dataset.d); closePop(); });
      p.querySelector("#p-mv").onclick = () => { const a = activeWin(); if (a) { a.desk = (EX.desk + 1) % DESKS; closePop(); switchDesk(EX.desk); toast("Desktops", "Moved to desktop " + (a.desk + 1)); } };
    });
  }

  // ── show desktop ─────────────────────────────────────────
  let hid = null;
  function showDesktop() {
    if (hid) { hid.forEach((w) => w.el.classList.remove("minimized")); const t = hid[hid.length - 1]; hid = null; if (t) focusWin(t); return; }
    const vis = wins.filter((w) => !w.el.classList.contains("minimized") && !w.el.classList.contains("desk-hidden"));
    if (!vis.length) return;
    hid = vis; vis.forEach((w) => { w.el.classList.add("minimized"); w.el.classList.remove("active"); }); updateTaskbar();
  }
  EX.showDesktop = showDesktop;

  // ── snap keys ────────────────────────────────────────────
  function snapKey(zone) { const a = activeWin(); if (!a) return; if (a.el.classList.contains("maximized")) toggleMaximize(a); applySnap(a, zone); }
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.altKey && e.key === "ArrowRight") { e.preventDefault(); switchDesk(EX.desk + 1); }
    else if (e.ctrlKey && e.altKey && e.key === "ArrowLeft") { e.preventDefault(); switchDesk(EX.desk - 1); }
    else if (e.metaKey && e.key === "ArrowLeft") { e.preventDefault(); snapKey("l"); }
    else if (e.metaKey && e.key === "ArrowRight") { e.preventDefault(); snapKey("r"); }
    else if (e.metaKey && e.key === "ArrowUp") { e.preventDefault(); snapKey("max"); }
    else if (e.metaKey && (e.key === "d" || e.key === "D")) { e.preventDefault(); showDesktop(); }
  }, true);

  // ── build the tray ───────────────────────────────────────
  function buildTray() {
    const clock = document.getElementById("clock"); if (!clock || document.getElementById("tray")) return;
    tray = document.createElement("div"); tray.id = "tray";
    tray.innerHTML = `<button class="tray-btn" id="tr-desk" title="Virtual desktops">1</button>
      <button class="tray-btn" id="tr-vol" title="Sound">\u{1F50A}</button>
      <button class="tray-btn" id="tr-net" title="Network">\u{1F4F6}</button>
      <button class="tray-btn" id="tr-bell" title="Notifications">\u{1F514}</button>`;
    clock.before(tray);
    clock.style.cursor = "pointer"; clock.onclick = calPanel;
    const sd = document.createElement("button"); sd.id = "show-desk"; sd.title = "Show desktop"; sd.onclick = showDesktop; clock.after(sd);
    tray.querySelector("#tr-desk").onclick = deskPanel;
    tray.querySelector("#tr-vol").onclick = volPanel;
    tray.querySelector("#tr-net").onclick = netPanel;
    tray.querySelector("#tr-bell").onclick = bellPanel;
    tray.querySelector("#tr-vol").addEventListener("wheel", (e) => { e.preventDefault(); vol.v = Math.max(0, Math.min(100, vol.v + (e.deltaY < 0 ? 5 : -5))); sh(`pactl set-sink-volume @DEFAULT_SINK@ ${vol.v}%`); paintTray(); });
    paintTray(); pollSys(); setInterval(pollSys, 20000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", buildTray); else buildTray();

  // ── search also finds files ──────────────────────────────
  const sCache = {}; let sTimer = null;
  function addFileRows(panel, list, close) {
    panel.querySelectorAll(".sr-file,.sr-hd").forEach((x) => x.remove());
    if (!list.length) return;
    const hd = document.createElement("div"); hd.className = "sr-hd"; hd.textContent = "Files"; panel.appendChild(hd);
    for (const f of list) {
      const row = document.createElement("div"); row.className = "sr-row sr-file";
      row.innerHTML = `<span class="tb-icon" style="background:#4a5470">${f.dir ? "\u{1F4C1}" : "\u{1F4C4}"}</span><span class="name"></span><span class="kind"></span>`;
      row.querySelector(".name").textContent = f.name; row.querySelector(".kind").textContent = f.parent;
      row.onclick = () => { close(); f.dir ? launch("explorer", f.path) : openFileInOS(f.path); };
      panel.appendChild(row);
    }
  }
  EX.searchFiles = (term, panel, close) => {
    if (term.length < 2) return;
    panel.querySelectorAll(".sr-empty").forEach((x) => { if (sCache[term] && sCache[term].length) x.remove(); });
    if (sCache[term]) return addFileRows(panel, sCache[term], close);
    clearTimeout(sTimer);
    sTimer = setTimeout(async () => {
      const home = USER_HOME || "/home/" + (CURRENT_USER || "");
      const pat = term.replace(/[^\w .-]/g, "?");
      const r = await sh(`find ${q(home)} /media -maxdepth 7 -iname ${q("*" + pat + "*")} -not -path '*/.*' -not -path '*/node_modules/*' 2>/dev/null | head -12`, 8000);
      const list = (r.out || "").trim().split("\n").filter(Boolean).map((p) => ({ path: p, name: p.split("/").pop(), parent: p.replace(/\/[^/]*$/, "").replace(home, "~"), dir: false }));
      if (list.length) {
        const isd = await sh(list.map((f) => `[ -d ${q(f.path)} ] && echo D || echo F`).join(";"), 5000);
        (isd.out || "").trim().split("\n").forEach((x, i) => { if (list[i]) list[i].dir = x === "D"; });
      }
      sCache[term] = list;
      if (document.getElementById("search-input").value.trim() === term) {
        const p = document.getElementById("search-panel"); if (!p.hidden) { p.querySelectorAll(".sr-empty").forEach((x) => list.length && x.remove()); addFileRows(p, list, close); }
      }
    }, 280);
  };

  // ── disk almost full ─────────────────────────────────────
  let lastWarn = 0;
  async function diskCheck() {
    const r = await sh("df -P /trifs 2>/dev/null | tail -1 || true");
    const m = /(\d+)%/.exec(r.out || ""); if (!m) return;
    const pct = +m[1];
    if (pct >= 90 && Date.now() - lastWarn > 6 * 3600e3) {
      lastWarn = Date.now();
      const left = (r.out.trim().split(/\s+/)[3] || 0) * 1024;
      toast("Disk almost full", `Your TriFS disk is ${pct}% full (${(left / 1073741824).toFixed(1)} GB free). Delete things or empty the Recycle Bin.`);
    }
  }

  // ── on login ─────────────────────────────────────────────
  const prevLogin = EX.onLogin;
  EX.onLogin = (u) => {
    prevLogin && prevLogin(u);
    mergeApps(); switchDesk(0); pollSys();
    setTimeout(diskCheck, 8000); if (!EX._dk) EX._dk = setInterval(diskCheck, 30 * 60 * 1000);
  };
})();
