// ============================================================
// Trimangees OS — extras: setup wizard, accounts, big Settings,
// New-file menu, desktop shortcuts. Loaded after os.js.
// ============================================================
"use strict";

const EX = (() => {
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const prefs = () => (CFG.prefs || (CFG.prefs = {}));
  const save = () => { try { kernel.setConfig(CFG); } catch {} };
  const sh = async (cmd, t) => { try { return await kernel.sh(cmd, t); } catch (e) { return { ok: false, out: "", err: String(e) }; } };
  const home = () => USER_HOME || "/home/" + (CURRENT_USER || "");

  // ── small modal: ask for a line of text ──────────────────
  function askText(title, label, def = "") {
    return new Promise((resolve) => {
      const ov = document.createElement("div");
      ov.className = "ex-modal";
      ov.innerHTML = `<div class="ex-box"><h3>${esc(title)}</h3><label>${esc(label)}</label>
        <input type="text" spellcheck="false"><div class="ex-btns"><button class="set-btn" data-x="0">Cancel</button>
        <button class="set-btn primary" data-x="1">OK</button></div></div>`;
      const inp = ov.querySelector("input"); inp.value = def;
      const done = (v) => { ov.remove(); resolve(v); };
      ov.querySelector('[data-x="0"]').onclick = () => done(null);
      ov.querySelector('[data-x="1"]').onclick = () => done(inp.value);
      inp.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") done(inp.value); if (e.key === "Escape") done(null); });
      document.body.appendChild(ov); setTimeout(() => { inp.focus(); inp.select(); }, 20);
    });
  }

  // ── accounts / avatars ───────────────────────────────────
  const gradient = (c) => `linear-gradient(160deg,${c},color-mix(in srgb,${c} 55%,#000))`;
  const info = (n) => USERS[n] || { color: "#4a8af0" };
  const avatarText = (n) => { const i = info(n); return i.avatarImg ? "" : (i.avatar || n[0]); };
  const avatarCss = (n) => {
    const i = info(n);
    return i.avatarImg ? `background:url('${i.avatarImg}') center/cover;` : `background:${gradient(i.color || "#4a8af0")};`;
  };
  const avatarStyle = (el, n) => { el.style.cssText += avatarCss(n); };
  function applyAccounts() {
    const acc = CFG.accounts || {};
    for (const n of CFG.removedUsers || []) delete USERS[n];
    for (const [n, a] of Object.entries(acc)) {
      const prev = USERS[n] || {};
      USERS[n] = { interests: "", flavor: "Welcome back!", ...prev, ...a,
        theme: a.theme || prev.theme || { preset: 0, accent: a.color || "#4a8af0" } };
    }
  }
  function setAccount(name, a) {
    CFG.accounts = CFG.accounts || {};
    CFG.accounts[name] = { ...(CFG.accounts[name] || {}), ...a };
    CFG.removedUsers = (CFG.removedUsers || []).filter((x) => x !== name);
    applyAccounts(); save(); try { buildLock(); } catch {}
  }

  // ── "New" file types (right-click → New) ─────────────────
  const T = (label, ext, content = "") => ({ label, ext, content });
  const NEW_TYPES = [
    T("Text document", "txt"), T("Markdown", "md", "# Title\n\n"),
    T("HTML page", "html", "<!doctype html>\n<html>\n<head><meta charset=\"utf-8\"><title>Page</title></head>\n<body>\n  <h1>Hello</h1>\n</body>\n</html>\n"),
    T("CSS stylesheet", "css", "body {\n  margin: 0;\n}\n"), T("JavaScript", "js", "console.log('hello');\n"),
    T("JSON", "json", "{}\n"), T("Python script", "py", "print('hello')\n"),
    T("Shell script", "sh", "#!/bin/bash\necho hello\n"), T("C source", "c", "#include <stdio.h>\n\nint main(void) {\n  printf(\"hello\\n\");\n  return 0;\n}\n"),
    T("C++ source", "cpp", "#include <iostream>\n\nint main() {\n  std::cout << \"hello\\n\";\n}\n"),
    T("Java source", "java", "public class Main {\n  public static void main(String[] a) {\n    System.out.println(\"hello\");\n  }\n}\n"),
    T("XML", "xml", "<?xml version=\"1.0\"?>\n<root/>\n"), T("YAML", "yaml", ""), T("CSV table", "csv", "A,B,C\n"),
    T("TriSheet", "trisheet", ""), T("Windows batch", "bat", "@echo off\r\n"), T("Log file", "log"),
    T("Empty file (any type)…", "", ""),
  ];
  async function createNew(dir, type, startRename) {
    const sep = dir.endsWith("/") ? "" : "/";
    const res = await kernel.listDir(dir, true);
    const names = res.ok ? res.entries.map((x) => x.name) : [];
    if (type === "folder") {
      let n = "New Folder", i = 1; while (names.includes(n)) n = `New Folder ${++i}`;
      const r = await kernel.mkdir(dir + sep + n); if (!r.ok) return toast("New folder", r.error);
      refreshExplorers(); startRename && startRename(n); return n;
    }
    let base = type.ext ? "New " + type.label.replace(/ \(.*|…/g, "").trim() : "New File";
    let n = type.ext ? `${base}.${type.ext}` : base, i = 1;
    while (names.includes(n)) n = type.ext ? `${base} ${++i}.${type.ext}` : `${base} ${++i}`;
    const r = await kernel.writeFile(dir + sep + n, type.content || "");
    if (!r.ok) return toast("New file", r.error);
    refreshExplorers(); startRename && startRename(n); return n;
  }
  function newItems(getDir, startRename) {
    const items = [{ label: "\u{1F4C1}  Folder", run: () => createNew(getDir(), "folder", startRename) }];
    for (const t of NEW_TYPES) items.push({ label: "\u{1F4C4}  " + t.label, run: () => createNew(getDir(), t, startRename) });
    items.push("-");
    items.push({ label: "\u{1F517}  Shortcut…", run: () => shortcutWizard(getDir()) });
    return items;
  }
  function bgMenu(x, y, getDir, refresh, startRename) {
    showContextMenu(x, y, [
      { label: "New ▸", run: () => setTimeout(() => showContextMenu(x, y, newItems(getDir, startRename)), 0) },
      "-",
      { label: "Open Terminal here", run: () => { launch("terminal"); } },
      { label: "Refresh", run: refresh },
    ]);
  }

  // ── desktop shortcuts ────────────────────────────────────
  const deskDir = () => home() + "/Desktop";
  async function makeShortcut(sc, dir) {
    dir = dir || deskDir();
    await kernel.mkdir(dir);
    const res = await kernel.listDir(dir, true);
    const names = res.ok ? res.entries.map((x) => x.name) : [];
    let base = (sc.name || "Shortcut").replace(/[\/\\]/g, "_"), n = base + ".trilink", i = 1;
    while (names.includes(n)) n = `${base} ${++i}.trilink`;
    const r = await kernel.writeFile(dir + "/" + n, JSON.stringify(sc));
    if (r.ok) { toast("Shortcut created", dir === deskDir() ? "On your desktop: " + sc.name : n); refreshExplorers(); }
    else toast("Couldn't make the shortcut", r.error || "");
  }
  async function shortcutWizard(dir) {
    const t = await askText("New shortcut", "Type a web address (https://...), a path (like /home/Adithya/Documents), or an app name:");
    if (!t || !t.trim()) return;
    const v = t.trim();
    const app = APPS.find((a) => a.name.toLowerCase() === v.toLowerCase() || a.id === v.toLowerCase());
    if (app) return makeShortcut({ kind: "app", id: app.id, name: app.name }, dir);
    if (/^https?:\/\//i.test(v) || /^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(v))
      return makeShortcut({ kind: "url", url: /^https?:/i.test(v) ? v : "https://" + v, name: v.replace(/^https?:\/\//i, "").replace(/\/.*/, "") }, dir);
    if (v.startsWith("/") || v.startsWith("~")) {
      const p = v.startsWith("~") ? home() + v.slice(1) : v;
      return makeShortcut({ kind: "path", path: p, name: p.split("/").filter(Boolean).pop() || "Files" }, dir);
    }
    toast("Shortcut", "I didn't recognise that. Try a web address, a path, or an app's name.");
  }
  async function openShortcut(sc) {
    if (sc.kind === "app") return launch(sc.id);
    if (sc.kind === "url") return kernel.openBrowser(sc.url);
    if (sc.kind === "cmd") { launch("terminal"); return; }
    if (sc.kind === "path") {
      const r = await kernel.listDir(sc.path, true);
      if (r.ok) launch("explorer", sc.path); else openFileInOS(sc.path);
    }
  }
  const DESK_BUILTIN = 4;
  let deskBusy = false, deskAgain = false;
  async function desktopRefresh() {
    if (!CURRENT_USER) return;
    if (deskBusy) { deskAgain = true; return; }
    deskBusy = true;
    try {
      await kernel.mkdir(deskDir());
      const res = await kernel.listDir(deskDir(), false);
      const host = $("#icons"); if (!host) return;
      host.querySelectorAll(".desk-icon.ex").forEach((e) => e.remove());
      const pos = prefs().deskPos || (prefs().deskPos = {});
      const rows = Math.max(3, Math.floor((innerHeight - TASKBAR_H - 30) / 102));
      let k = 0;
      for (const en of (res.ok ? res.entries : [])) {
        const el = document.createElement("div");
        el.className = "desk-icon ex";
        let label = en.name, glyphHTML = en.isDir ? "\u{1F4C1}" : "\u{1F4C4}", tileColor = null, sc = null;
        const ext = (en.name.split(".").pop() || "").toLowerCase();
        const full = deskDir() + "/" + en.name;
        if (ext === "trilink" && !en.isDir) {
          label = en.name.replace(/\.trilink$/, "");
          try { sc = JSON.parse((await kernel.readFile(full)).content || "{}"); } catch { sc = null; }
          if (sc && sc.kind === "app") { const a = appById(sc.id); if (a) { tileColor = a.color; glyphHTML = a.letter || a.name[0]; } }
          else if (sc && sc.kind === "url") { tileColor = "#3c96ff"; glyphHTML = "\u{1F310}"; }
          else if (sc && sc.kind === "path") { glyphHTML = "\u{1F4C1}"; }
          else glyphHTML = "\u{1F517}";
          if (!tileColor && sc) tileColor = "#4a5568";
        } else if (!en.isDir) {
          if (["exe", "msi", "appimage"].includes(ext)) glyphHTML = "⚙️";
          else if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) glyphHTML = "\u{1F5BC}️";
          else if (["html", "htm"].includes(ext)) glyphHTML = "\u{1F310}";
        }
        el.innerHTML = `<div class="glyph"></div><span></span>${sc ? '<i class="lnk">↗</i>' : ""}`;
        const g = el.querySelector(".glyph");
        if (tileColor) { g.classList.add("tile"); g.style.background = gradient(tileColor); }
        g.textContent = glyphHTML;
        el.querySelector("span").textContent = label;
        const key = en.name;
        const col = Math.floor(k / rows), row = k % rows; k++;
        const p = pos[key] || { x: 130 + col * 104, y: 20 + row * 102 };
        el.style.left = p.x + "px"; el.style.top = p.y + "px";
        const open = () => { if (sc) openShortcut(sc); else if (en.isDir) launch("explorer", full); else openFileInOS(full); };
        el.onclick = () => { $$(".desk-icon").forEach((d) => d.classList.remove("selected")); el.classList.add("selected"); };
        el.ondblclick = open;
        el.oncontextmenu = (e) => {
          e.preventDefault(); e.stopPropagation();
          el.click();
          showContextMenu(e.clientX, e.clientY, [
            { label: "Open", run: open }, "-",
            { label: "Rename", run: async () => {
                const nn = await askText("Rename", "New name:", sc ? label : en.name);
                if (nn && nn.trim()) { await kernel.rename(full, deskDir() + "/" + nn.trim() + (sc ? ".trilink" : "")); refreshExplorers(); } } },
            { label: "Delete", run: async () => { if (await confirmDialog(`Remove "${label}" from the desktop?`)) { await kernel.remove(full); refreshExplorers(); } } },
            { label: "Show in File Explorer", run: () => launch("explorer", deskDir()) },
          ]);
        };
        // drag to move
        el.addEventListener("pointerdown", (e) => {
          if (e.button !== 0) return;
          const sx = e.clientX, sy = e.clientY, ox = parseInt(el.style.left), oy = parseInt(el.style.top); let moved = false;
          const mv = (m) => { if (Math.abs(m.clientX - sx) + Math.abs(m.clientY - sy) > 5) moved = true;
            if (moved) { el.style.left = Math.max(0, ox + m.clientX - sx) + "px"; el.style.top = Math.max(0, oy + m.clientY - sy) + "px"; } };
          const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up);
            if (moved) { pos[key] = { x: parseInt(el.style.left), y: parseInt(el.style.top) }; save(); } };
          addEventListener("pointermove", mv); addEventListener("pointerup", up);
        });
        host.appendChild(el);
      }
    } finally { deskBusy = false; if (deskAgain) { deskAgain = false; setTimeout(desktopRefresh, 50); } }
  }
  function desktopMenu(x, y) {
    showContextMenu(x, y, [
      { label: "New ▸", run: () => setTimeout(() => showContextMenu(x, y, newItems(deskDir, null)), 0) },
      { label: "Refresh desktop", run: desktopRefresh },
      "-",
      { label: "Open Terminal", run: () => launch("terminal") },
      { label: "Open File Explorer", run: () => launch("explorer") },
      "-",
      { label: "Display & Settings", run: () => launch("settings") },
      { label: "About Trimangees OS", run: () => { const w = launch("settings"); w && w.setSection && w.setSection(4); } },
    ]);
  }

  // ── default apps ─────────────────────────────────────────
  const DEFAULT_CHOICES = {
    txt: [["TRiDOCS", "tridocs"], ["Text Editor", "editor"]], md: [["TRiDOCS", "tridocs"], ["Text Editor", "editor"]],
    html: [["HTML Viewer", "htmlview"], ["Trimangees Browser", "browser"], ["Chrome", "chrome"], ["Text Editor", "editor"]],
    png: [["Image Viewer", "viewer"], ["TRiDRAW", "tridraw"]], jpg: [["Image Viewer", "viewer"], ["TRiDRAW", "tridraw"]],
    pdf: [["HTML Viewer", "htmlview"], ["Trimangees Browser", "browser"], ["Chrome", "chrome"]],
    csv: [["TRiSHEETS", "trisheets"], ["Text Editor", "editor"]],
  };
  function openDefault(path) {
    const ext = (path.split(".").pop() || "").toLowerCase();
    const d = (prefs().defaults || {})[ext];
    if (!d) return false;
    if (d === "browser" || d === "chrome") {
      toDataUrlThen(path, (u) => { if (d === "chrome") launch("chrome", u); else launch("browser", u); }); return true;
    }
    launch(d, path); return true;
  }
  async function toDataUrlThen(path, cb) { try { cb("file://" + (await kernel.sh(`realpath ${JSON.stringify(path)}`)).out.trim() || path); } catch { cb(path); } }

  // ── prefs applied to the desktop ─────────────────────────
  function applyPrefs(p) {
    const b = document.body;
    b.classList.toggle("hide-icons", !!p.hideIcons);
    b.classList.toggle("big-icons", p.iconSize === "large");
    b.classList.toggle("small-icons", p.iconSize === "small");
    b.classList.toggle("hi-contrast", !!p.contrast);
    b.classList.toggle("big-text", p.textSize === "large");
    document.documentElement.style.zoom = p.zoom && p.zoom !== 1 ? String(p.zoom) : "";
    $("#clock-date") && ($("#clock-date").style.display = p.hideDate ? "none" : "");
  }
  let idleT = null, idleMs = 0;
  function resetIdle() { clearTimeout(idleT); if (idleMs && CURRENT_USER) idleT = setTimeout(() => osDoLogout(), idleMs); }
  ["pointerdown", "keydown", "pointermove"].forEach((ev) => addEventListener(ev, resetIdle, true));
  function onLogin() {
    const p = prefs();
    idleMs = (p.autoLock || 0) * 60000; resetIdle();
    if (p.kbLayout) sh(`setxkbmap ${p.kbLayout}`);
    if (p.volume != null) sh(`pactl set-sink-volume @DEFAULT_SINK@ ${p.volume}%`);
    desktopRefresh();
    setTimeout(() => (p.startup || []).forEach((id) => { try { launch(id); } catch {} }), 1500);
  }

  // ── Settings: extra sections ─────────────────────────────
  const sectionNames = ["Network", "Sound", "Keyboard & Language", "Time & Clock", "Desktop & Taskbar", "Accessibility",
    "Default apps", "Startup", "Storage", "Notifications", "Privacy & Security", "Users", "Power", "Keyboard shortcuts",
    "Backup & Cloud", "Developer"];
  const row = (title, sub, ctrl) => `<div class="ex-row"><div class="ex-l"><b>${title}</b>${sub ? `<span>${sub}</span>` : ""}</div><div class="ex-r">${ctrl}</div></div>`;
  const toggle = (id, on) => `<label class="ex-sw"><input type="checkbox" id="${id}" ${on ? "checked" : ""}><i></i></label>`;
  const pre = (t) => `<pre class="ex-pre">${esc(t || "(nothing)")}</pre>`;

  async function renderSection(i, main) {
    const name = sectionNames[i];
    const p = prefs();
    const H = (sub) => `<h2>${name}</h2>${sub ? `<p class="set-note">${sub}</p>` : ""}`;
    const bindToggle = (id, key, after) => { const el = main.querySelector("#" + id); if (el) el.onchange = () => { p[key] = el.checked; save(); applyPrefs(p); after && after(); }; };
    const bindSel = (id, key, conv, after) => { const el = main.querySelector("#" + id); if (el) el.onchange = () => { p[key] = conv ? conv(el.value) : el.value; save(); applyPrefs(p); after && after(el.value); }; };
    const again = () => renderSection(i, main);

    if (name === "Network") {
      main.innerHTML = H("Wi-Fi and cable connections. Virtual machines usually show one wired connection that just works.") + `<div class="ex-load">Looking…</div>`;
      const [dev, wifi, ip] = await Promise.all([
        sh("nmcli -t -f DEVICE,TYPE,STATE,CONNECTION dev 2>&1"), sh("nmcli -t -f SSID,SIGNAL,SECURITY dev wifi list 2>/dev/null | head -25"),
        sh("ip -brief addr 2>&1")]);
      const nets = (wifi.out || "").trim().split("\n").filter((l) => l && !l.startsWith(":")).map((l) => l.split(":"));
      main.innerHTML = H("Wi-Fi and cable connections. Virtual machines usually show one wired connection that just works.") +
        `<h3>Devices</h3>${pre(dev.out.replace(/:/g, "   "))}<h3>Addresses</h3>${pre(ip.out)}
         <div class="set-row-btns"><button class="set-btn" id="n-ping">Test internet</button><button class="set-btn" id="n-scan">Rescan Wi-Fi</button><button class="set-btn" id="n-ed">Advanced editor</button></div>
         <div id="n-res"></div>
         <h3>Wi-Fi networks</h3>${nets.length ? nets.map((n, k) => row(esc(n[0] || "(hidden)"), `${n[1]}% signal · ${esc(n[2] || "open")}`,
           `<button class="set-btn" data-c="${k}">Connect</button>`)).join("") : '<p class="set-note">No Wi-Fi found (normal inside VirtualBox).</p>'}`;
      main.querySelector("#n-ping").onclick = async () => { const r = await sh("ping -c 2 -W 3 1.1.1.1 2>&1 | tail -3", 12000); main.querySelector("#n-res").innerHTML = pre(r.out || r.err); };
      main.querySelector("#n-scan").onclick = async () => { await sh("nmcli dev wifi rescan", 8000); again(); };
      main.querySelector("#n-ed").onclick = () => sh("setsid nm-connection-editor >/dev/null 2>&1 &");
      main.querySelectorAll("[data-c]").forEach((b) => b.onclick = async () => {
        const n = nets[+b.dataset.c]; const pw = await askText("Connect to " + n[0], "Password (leave empty if open):");
        if (pw === null) return; b.textContent = "…";
        const r = await sh(`nmcli dev wifi connect ${JSON.stringify(n[0])} ${pw ? "password " + JSON.stringify(pw) : ""} 2>&1`, 30000);
        toast("Wi-Fi", (r.out || r.err).trim().slice(0, 120)); again();
      });
    } else if (name === "Sound") {
      const v = await sh("pactl get-sink-volume @DEFAULT_SINK@ 2>&1 | head -1; pactl get-sink-mute @DEFAULT_SINK@ 2>&1");
      const m = (v.out.match(/(\d+)%/) || [])[1] || "70";
      main.innerHTML = H("Output volume for this computer.") +
        row("Volume", "", `<input type="range" id="s-vol" min="0" max="150" value="${m}"><span id="s-v">${m}%</span>`) +
        row("Mute", "", toggle("s-mute", /yes/.test(v.out))) +
        `<div class="set-row-btns"><button class="set-btn" id="s-test">Play test sound</button><button class="set-btn" id="s-mix">Open mixer (terminal)</button></div>` +
        `<h3>Devices</h3>${pre((await sh("pactl list short sinks 2>&1")).out)}`;
      const vol = main.querySelector("#s-vol");
      vol.oninput = () => { main.querySelector("#s-v").textContent = vol.value + "%"; };
      vol.onchange = () => { p.volume = +vol.value; save(); sh(`pactl set-sink-volume @DEFAULT_SINK@ ${vol.value}%`); };
      main.querySelector("#s-mute").onchange = (e) => sh(`pactl set-sink-mute @DEFAULT_SINK@ ${e.target.checked ? 1 : 0}`);
      main.querySelector("#s-test").onclick = () => sh("speaker-test -t sine -f 600 -l 1 -p 400 >/dev/null 2>&1 &");
      main.querySelector("#s-mix").onclick = () => kernel.xterm();
    } else if (name === "Keyboard & Language") {
      const cur = await sh("setxkbmap -query 2>&1");
      const L = [["us", "English (US)"], ["gb", "English (UK)"], ["in", "English (India)"], ["in:tam", "Tamil"], ["in:hin-wx", "Hindi"], ["de", "German"], ["fr", "French"], ["es", "Spanish"], ["it", "Italian"], ["pt", "Portuguese"], ["ru", "Russian"], ["jp", "Japanese"], ["us:dvorak", "Dvorak"]];
      main.innerHTML = H("Keyboard layout applies right away and at every login.") +
        row("Layout", "", `<select id="k-l">${L.map(([c, n]) => `<option value="${c}" ${(p.kbLayout || "us") === c ? "selected" : ""}>${n}</option>`).join("")}</select>`) +
        row("Key repeat speed", "", `<select id="k-r"><option value="">Normal</option><option value="250 40">Fast</option><option value="500 15">Slow</option></select>`) +
        `<h3>Current</h3>${pre(cur.out)}`;
      main.querySelector("#k-l").onchange = (e) => { const [l, v] = e.target.value.split(":"); p.kbLayout = e.target.value; save(); sh(`setxkbmap ${l} ${v || ""}`); };
      main.querySelector("#k-r").onchange = (e) => { if (e.target.value) sh(`xset r rate ${e.target.value}`); };
    } else if (name === "Time & Clock") {
      const t = await sh("timedatectl 2>&1 | head -6");
      main.innerHTML = H("Clock format applies immediately. The time zone is set for the whole computer.") +
        row("24-hour clock", "", toggle("t-24", p.clock24)) + row("Show seconds", "", toggle("t-s", p.clockSeconds)) + row("Show date on taskbar", "", toggle("t-d", !p.hideDate)) +
        row("Time zone", "", `<input id="t-z" list="t-zl" placeholder="Asia/Kolkata" style="width:190px"><datalist id="t-zl"></datalist><button class="set-btn" id="t-set">Set</button>`) +
        `<h3>Now</h3>${pre(t.out)}`;
      sh("timedatectl list-timezones").then((r) => { main.querySelector("#t-zl").innerHTML = r.out.split("\n").map((z) => `<option value="${z}">`).join(""); });
      main.querySelector("#t-24").onchange = (e) => { p.clock24 = e.target.checked; save(); applyPrefs(p); tickClock(); };
      main.querySelector("#t-s").onchange = (e) => { p.clockSeconds = e.target.checked; save(); window.__clockSeconds = e.target.checked; tickClock(); };
      main.querySelector("#t-d").onchange = (e) => { p.hideDate = !e.target.checked; save(); applyPrefs(p); };
      main.querySelector("#t-set").onclick = async () => { const z = main.querySelector("#t-z").value.trim(); if (!z) return;
        const r = await sh(`sudo -n timedatectl set-timezone ${JSON.stringify(z)} 2>&1`); toast("Time zone", r.ok ? "Set to " + z : (r.out || r.err)); again(); };
    } else if (name === "Desktop & Taskbar") {
      main.innerHTML = H("How the desktop looks and behaves.") +
        row("Show desktop icons", "", toggle("d-i", !p.hideIcons)) +
        row("Icon size", "", `<select id="d-sz"><option value="small">Small</option><option value="">Medium</option><option value="large">Large</option></select>`) +
        row("Reduce animations", "", toggle("d-m", p.reduceMotion)) +
        `<div class="set-row-btns"><button class="set-btn" id="d-reset">Reset icon positions</button><button class="set-btn" id="d-pins">Reset taskbar pins</button></div>`;
      main.querySelector("#d-sz").value = p.iconSize || "";
      main.querySelector("#d-i").onchange = (e) => { p.hideIcons = !e.target.checked; save(); applyPrefs(p); };
      bindSel("d-sz", "iconSize"); bindToggle("d-m", "reduceMotion", applyPrefs.bind(null, p));
      main.querySelector("#d-reset").onclick = () => { p.deskPos = {}; save(); desktopRefresh(); toast("Desktop", "Icons tidied."); };
      main.querySelector("#d-pins").onclick = () => { delete p.pins; if (CFG.pins) delete CFG.pins; save(); toast("Taskbar", "Restart the desktop to see the default pins."); };
    } else if (name === "Accessibility") {
      main.innerHTML = H("Make things easier to see.") +
        row("Zoom the whole desktop", "", `<select id="a-z">${[0.8, 0.9, 1, 1.15, 1.3, 1.5].map((z) => `<option value="${z}" ${(p.zoom || 1) === z ? "selected" : ""}>${Math.round(z * 100)}%</option>`).join("")}</select>`) +
        row("Larger text", "", toggle("a-t", p.textSize === "large")) + row("High contrast", "", toggle("a-c", p.contrast)) +
        row("Reduce animations", "", toggle("a-m", p.reduceMotion));
      main.querySelector("#a-z").onchange = (e) => { p.zoom = +e.target.value; save(); applyPrefs(p); };
      main.querySelector("#a-t").onchange = (e) => { p.textSize = e.target.checked ? "large" : ""; save(); applyPrefs(p); };
      bindToggle("a-c", "contrast"); bindToggle("a-m", "reduceMotion");
    } else if (name === "Default apps") {
      const d = p.defaults || (p.defaults = {});
      main.innerHTML = H("Choose what opens each kind of file when you double-click it.") +
        Object.entries(DEFAULT_CHOICES).map(([ext, ch]) => row("." + ext + " files", "", `<select data-e="${ext}"><option value="">Automatic</option>${ch.map(([n, id]) => `<option value="${id}" ${d[ext] === id ? "selected" : ""}>${n}</option>`).join("")}</select>`)).join("");
      main.querySelectorAll("select[data-e]").forEach((s) => s.onchange = () => { if (s.value) d[s.dataset.e] = s.value; else delete d[s.dataset.e]; save(); });
    } else if (name === "Startup") {
      const st = new Set(p.startup || []);
      main.innerHTML = H("Apps that open by themselves after you sign in.") +
        APPS.filter((a) => !a.hidden).sort((a, b) => a.name.localeCompare(b.name)).map((a) => row(esc(a.name), a.category || "", toggle("su-" + a.id, st.has(a.id)))).join("");
      main.querySelectorAll('input[id^="su-"]').forEach((c) => c.onchange = () => { c.checked ? st.add(c.id.slice(3)) : st.delete(c.id.slice(3)); p.startup = [...st]; save(); });
    } else if (name === "Storage") {
      main.innerHTML = H("Where your space is going. Everything lives on TriFS.") + `<div class="ex-load">Measuring…</div>`;
      const [df, du] = await Promise.all([sh("df -h /trifs / /tmp 2>&1"), sh(`du -sh ${JSON.stringify(home())}/* /Applications /trifs/shared 2>/dev/null | sort -rh | head -20`, 25000)]);
      main.innerHTML = H("Where your space is going. Everything lives on TriFS.") + `<h3>Drives</h3>${pre(df.out)}<h3>Biggest folders</h3>${pre(du.out)}
        <div class="set-row-btns"><button class="set-btn" id="st-dl">Empty Downloads folder</button><button class="set-btn" id="st-cache">Clear caches</button></div>`;
      main.querySelector("#st-dl").onclick = async () => { if (await confirmDialog("Delete everything in Downloads?")) { await sh(`rm -rf ${JSON.stringify(home())}/Downloads/* 2>&1`); toast("Storage", "Downloads emptied."); again(); } };
      main.querySelector("#st-cache").onclick = async () => { await sh(`rm -rf ${JSON.stringify(home())}/.cache/* 2>&1`); toast("Storage", "Caches cleared."); again(); };
    } else if (name === "Notifications") {
      main.innerHTML = H("The little pop-ups in the corner.") + row("Show notifications", "", toggle("no-on", !p.quiet)) +
        `<div class="set-row-btns"><button class="set-btn" id="no-t">Send a test notification</button></div>`;
      main.querySelector("#no-on").onchange = (e) => { p.quiet = !e.target.checked; save(); };
      main.querySelector("#no-t").onclick = () => { const q = p.quiet; p.quiet = false; toast("Test", "This is a notification."); p.quiet = q; };
    } else if (name === "Privacy & Security") {
      main.innerHTML = H("Your PIN locks the screen. It is a convenience lock for people sharing the computer, not strong security.") +
        row("Lock screen after being idle", "", `<select id="pv-l">${[[0, "Never"], [2, "2 minutes"], [5, "5 minutes"], [10, "10 minutes"], [30, "30 minutes"]].map(([m, n]) => `<option value="${m}" ${(p.autoLock || 0) === m ? "selected" : ""}>${n}</option>`).join("")}</select>`) +
        row("Change my PIN", "", `<input id="pv-p" type="password" maxlength="12" placeholder="new PIN" style="width:110px"><button class="set-btn" id="pv-b">Change</button>`) +
        row("Send my settings to the cloud (Firebase)", "Turn off to keep everything only on TriFS", toggle("pv-c", !p.noCloud)) +
        `<div class="set-row-btns"><button class="set-btn" id="pv-lock">Lock now</button><button class="set-btn" id="pv-clr">Clear browser data</button></div>`;
      main.querySelector("#pv-l").onchange = (e) => { p.autoLock = +e.target.value; idleMs = p.autoLock * 60000; save(); resetIdle(); };
      main.querySelector("#pv-b").onclick = () => { const v = main.querySelector("#pv-p").value; if (v.length < 4) return toast("PIN", "Use at least 4 digits."); setAccount(CURRENT_USER, { pin: v }); toast("PIN", "Changed."); main.querySelector("#pv-p").value = ""; };
      main.querySelector("#pv-c").onchange = (e) => { p.noCloud = !e.target.checked; save(); };
      main.querySelector("#pv-lock").onclick = () => osDoLogout();
      main.querySelector("#pv-clr").onclick = async () => { await sh("rm -rf ~/.config/google-chrome ~/.cache/google-chrome 2>&1"); toast("Privacy", "Chrome data cleared."); };
    } else if (name === "Users") {
      const list = Object.keys(USERS);
      main.innerHTML = H("People who use this computer. Each has a private home folder on TriFS.") +
        list.map((n) => `<div class="ex-row"><div class="ex-l"><span class="acct-uav" style="${avatarCss(n)};display:inline-flex">${avatarText(n)}</span> <b>${esc(n)}</b>${n === CURRENT_USER ? " <span>(you)</span>" : ""}</div>
          <div class="ex-r"><button class="set-btn" data-e="${esc(n)}">Edit</button>${n !== CURRENT_USER ? `<button class="set-btn" data-d="${esc(n)}">Remove</button>` : ""}</div></div>`).join("") +
        `<div class="set-row-btns"><button class="set-btn primary" id="u-add">+ Add a person</button></div>`;
      main.querySelector("#u-add").onclick = () => accountEditor(null, again);
      main.querySelectorAll("[data-e]").forEach((b) => b.onclick = () => accountEditor(b.dataset.e, again));
      main.querySelectorAll("[data-d]").forEach((b) => b.onclick = async () => {
        if (!(await confirmDialog(`Remove ${b.dataset.d} from the sign-in screen? Their files stay on TriFS.`))) return;
        CFG.removedUsers = [...(CFG.removedUsers || []), b.dataset.d]; delete USERS[b.dataset.d]; if (CFG.accounts) delete CFG.accounts[b.dataset.d]; save(); buildLock(); again(); });
    } else if (name === "Power") {
      main.innerHTML = H("Shut down safely so TriFS is closed properly before you unplug the drive.") +
        `<div class="set-row-btns"><button class="set-btn" id="pw-lock">Lock</button><button class="set-btn" id="pw-re">Restart</button><button class="set-btn primary" id="pw-off">Shut down</button></div>` +
        row("Lock screen when idle", "", `<select id="pw-i">${[[0, "Never"], [5, "5 min"], [15, "15 min"], [30, "30 min"]].map(([m, n]) => `<option value="${m}" ${(p.autoLock || 0) === m ? "selected" : ""}>${n}</option>`).join("")}</select>`);
      main.querySelector("#pw-lock").onclick = () => osDoLogout();
      main.querySelector("#pw-re").onclick = () => kernel.power("restart"); main.querySelector("#pw-off").onclick = () => kernel.power("shutdown");
      main.querySelector("#pw-i").onchange = (e) => { p.autoLock = +e.target.value; idleMs = p.autoLock * 60000; save(); resetIdle(); };
    } else if (name === "Keyboard shortcuts") {
      const K = [["Alt + Tab", "Switch windows"], ["Windows key / Ctrl + Esc", "Start menu"], ["Ctrl + H (in Files)", "Show hidden files"], ["F2 (in Files)", "Rename"], ["Right-click desktop", "New file, shortcut, settings"],
        ["Ctrl + C (in Terminal)", "Stop the running command"], ["Ctrl + L (in Terminal)", "Clear the terminal"], ["Tab (in Terminal)", "Complete a name"], ["Ctrl + Alt + F2", "Emergency text console (user: trimangees)"], ["Ctrl + Alt + F1", "Back to the desktop"]];
      main.innerHTML = H("") + K.map(([a, b]) => row(`<code>${a}</code>`, "", esc(b))).join("");
    } else if (name === "Backup & Cloud") {
      main.innerHTML = H("Your files are already on TriFS. These tools make extra copies.") +
        `<div class="set-row-btns"><button class="set-btn primary" id="bk-apps">Copy my cloud apps into TriFS</button><button class="set-btn" id="bk-push">Sync to cloud now</button><button class="set-btn" id="bk-exp">Back up my home folder</button></div><div id="bk-res"></div>`;
      main.querySelector("#bk-apps").onclick = async () => { const r = await transferCloudApps((m) => (main.querySelector("#bk-res").innerHTML = pre(m))); toast("Apps", `${r.done} copied, ${r.failed} failed`); };
      main.querySelector("#bk-push").onclick = () => { try { cloudPush(); fsSchedulePush(true); toast("Cloud", "Syncing…"); } catch (e) { toast("Cloud", String(e)); } };
      main.querySelector("#bk-exp").onclick = async () => { const r = await kernel.fsBackup(); toast("Backup", r && r.ok ? "Saved." : (r && r.error) || "Cancelled."); };
    } else if (name === "Developer") {
      main.innerHTML = H("For tinkering.") +
        `<div class="set-row-btns"><button class="set-btn" id="dv-x">Open a full terminal window</button><button class="set-btn" id="dv-log">Show desktop log</button><button class="set-btn" id="dv-st">Self-test</button><button class="set-btn" id="dv-dev">Open developer tools</button></div><div id="dv-o"></div>` +
        row("Show hidden files in Files by default", "", toggle("dv-h", p.showHidden));
      const out = main.querySelector("#dv-o");
      main.querySelector("#dv-x").onclick = () => kernel.xterm();
      main.querySelector("#dv-log").onclick = async () => { out.innerHTML = pre((await sh("tail -n 60 /var/log/trimangees/shell.log 2>&1")).out); };
      main.querySelector("#dv-st").onclick = async () => { out.innerHTML = pre((await sh("/usr/local/bin/trimangees-selftest 2>&1 | head -60", 30000)).out); };
      main.querySelector("#dv-dev").onclick = () => { try { kernel.sh("true"); } catch {} document.dispatchEvent(new KeyboardEvent("keydown", { key: "F12" })); };
      bindToggle("dv-h", "showHidden");
    }
  }

  // add / edit a person
  const EMOJIS = ["\u{1F600}", "\u{1F60E}", "\u{1F913}", "\u{1F920}", "\u{1F9D1}‍\u{1F680}", "\u{1F9B8}", "\u{1F9D9}", "\u{1F431}", "\u{1F436}", "\u{1F98A}", "\u{1F981}", "\u{1F984}", "⚡", "\u{1F329}️", "✈️", "\u{1FAA8}", "\u{1F3AE}", "\u{1F680}", "\u{1F525}", "\u{1F31F}", "\u{1F3B8}", "\u{1F3C0}", "⚽", "\u{1F355}"];
  const COLORS = ["#4a8af0", "#f07830", "#c85ae0", "#3cc850", "#e8453c", "#f0b423", "#5ee6c7", "#8b93ff"];
  function avatarPicker(state) {
    return `<div class="ex-avs">${EMOJIS.map((e) => `<span data-em="${e}" class="${state.avatar === e && !state.avatarImg ? "on" : ""}">${e}</span>`).join("")}</div>
      <div class="ex-cols">${COLORS.map((c) => `<span data-col="${c}" style="background:${c}" class="${state.color === c ? "on" : ""}"></span>`).join("")}</div>
      <button class="set-btn" type="button" data-photo="1">Use a photo…</button> <button class="set-btn" type="button" data-nophoto="1">Use letter instead</button>`;
  }
  function wirePicker(root, state, redraw) {
    root.querySelectorAll("[data-em]").forEach((s) => s.onclick = () => { state.avatar = s.dataset.em; state.avatarImg = ""; redraw(); });
    root.querySelectorAll("[data-col]").forEach((s) => s.onclick = () => { state.color = s.dataset.col; redraw(); });
    const nop = root.querySelector("[data-nophoto]"); if (nop) nop.onclick = () => { state.avatar = ""; state.avatarImg = ""; redraw(); };
    const ph = root.querySelector("[data-photo]");
    if (ph) ph.onclick = () => {
      const f = document.createElement("input"); f.type = "file"; f.accept = "image/*";
      f.onchange = () => { const file = f.files[0]; if (!file) return; const img = new Image(); const fr = new FileReader();
        fr.onload = () => { img.onload = () => { const c = document.createElement("canvas"); c.width = c.height = 96; const x = c.getContext("2d");
          const m = Math.min(img.width, img.height); x.drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, 96, 96); state.avatarImg = c.toDataURL("image/jpeg", 0.8); redraw(); }; img.src = fr.result; };
        fr.readAsDataURL(file); };
      f.click();
    };
  }
  function accountEditor(name, done) {
    const cur = name ? { ...USERS[name] } : { color: COLORS[Object.keys(USERS).length % COLORS.length], avatar: EMOJIS[0] };
    const state = { color: cur.color, avatar: cur.avatar || "", avatarImg: cur.avatarImg || "" };
    const ov = document.createElement("div"); ov.className = "ex-modal";
    const draw = () => {
      ov.innerHTML = `<div class="ex-box wide"><h3>${name ? "Edit " + esc(name) : "Add a person"}</h3>
        <div class="ex-prev" style="${state.avatarImg ? `background:url('${state.avatarImg}') center/cover` : `background:${gradient(state.color)}`}">${state.avatarImg ? "" : state.avatar || (name || "?")[0]}</div>
        <label>Name</label><input id="ae-n" value="${esc(name || "")}" ${name ? "disabled" : ""} maxlength="20">
        <label>PIN (4 or more digits)</label><input id="ae-p" type="password" maxlength="12" placeholder="${name ? "leave empty to keep" : ""}">
        <label>Picture</label>${avatarPicker(state)}
        <div class="ex-btns"><button class="set-btn" id="ae-c">Cancel</button><button class="set-btn primary" id="ae-s">Save</button></div></div>`;
      wirePicker(ov, state, () => { const n = ov.querySelector("#ae-n").value, p = ov.querySelector("#ae-p").value; draw(); ov.querySelector("#ae-n").value = n; ov.querySelector("#ae-p").value = p; });
      ov.querySelector("#ae-c").onclick = () => ov.remove();
      ov.querySelector("#ae-s").onclick = async () => {
        const n = (name || ov.querySelector("#ae-n").value.trim()).replace(/[^\w .-]/g, "");
        const p = ov.querySelector("#ae-p").value;
        if (!n) return toast("Person", "Type a name.");
        if (!name && USERS[n]) return toast("Person", "That name is taken.");
        if ((!name && p.length < 4) || (p && p.length < 4)) return toast("PIN", "Use at least 4 characters.");
        const rec = { color: state.color, avatar: state.avatar, avatarImg: state.avatarImg };
        if (p) rec.pin = p;
        if (!name) { rec.interests = ""; rec.flavor = "Welcome, " + n + "!"; await kernel.userHome(n); }
        setAccount(n, rec); ov.remove(); done && done();
      };
    };
    draw(); document.body.appendChild(ov);
  }

  // ── move apps into TriFS ─────────────────────────────────
  async function transferCloudApps(progress) {
    let done = 0, failed = 0; const log = [];
    let apps = [];
    try { apps = (await Cloud.loadAppManifest()).filter((a) => a.url && !a.builtin); } catch (e) { log.push("Couldn't reach the cloud: " + e.message); }
    await kernel.mkdir("/Applications");
    for (const a of apps) {
      const safe = (a.name || a.id).replace(/[^\w .-]/g, "_");
      const r = await kernel.saveUrlText(a.url, "/Applications/" + safe + ".html");
      if (r && r.ok) { done++; log.push("✓ " + a.name); } else { failed++; log.push("✗ " + a.name + " — " + ((r && r.error) || "failed")); }
      progress && progress(log.join("\n"));
    }
    if (!apps.length && !log.length) log.push("No cloud apps found.");
    progress && progress(log.join("\n"));
    try { await refreshLocalApps(); } catch {}
    return { done, failed, total: apps.length };
  }

  // ── first-run wizard ─────────────────────────────────────
  async function maybeFirstRun() {
    try {
      if (CFG.setupDone) { maybeTriFSWizard(); return; }
      const st = await kernel.trifsStatus();
      runWizard(st);
    } catch { maybeTriFSWizard(); }
  }
  function runWizard(st0) {
    const W = { step: 0, name: "Adithya", pin: "", color: COLORS[0], avatar: "⚡", avatarImg: "", keepFamily: true,
      copyApps: true, cloud: true, preset: 3, accent: COLORS[0], extra: [] };
    let drive = st0 || {};
    const ov = document.createElement("div"); ov.id = "ex-wiz"; document.body.appendChild(ov);
    const steps = ["Welcome", "Drive", "You", "Apps", "Look", "Finish"];
    const driveOk = () => drive && drive.ok !== false && drive.mounted;
    async function draw() {
      const dots = `<div class="wz-dots">${steps.map((s, i) => `<i class="${i === W.step ? "on" : i < W.step ? "done" : ""}"></i>`).join("")}</div>`;
      let body = "", next = "Next", canNext = true;
      if (W.step === 0) body = `<h1>Welcome to TrimangeesOS</h1><p>A few quick questions and your computer is ready. Everything you save goes on your TRIMANGEES drive (TriFS). Nothing is written to your Windows C: or D: drives.</p>`;
      if (W.step === 1) {
        drive = await kernel.trifsStatus().catch(() => drive);
        body = `<h1>Your drive</h1>` + (driveOk()
          ? `<div class="wz-ok">✔ TriFS is ready — ${twFmt(drive.total || 0)} drive, ${twFmt(drive.free || 0)} free.</div><p>Your files, programs and settings will be kept there.</p>`
          : `<div class="wz-warn">No TriFS drive yet — nothing would be saved.</div><p>Choose where TriFS lives: a blank disk, a drive labelled TRIFS, or a TriFS file on your TRIMANGEES drive (you choose the size).</p><button class="set-btn primary" id="wz-drive">Choose / create the drive…</button>`);
        canNext = driveOk(); if (!canNext) next = "Skip for now";
      }
      if (W.step === 2) body = `<h1>Who are you?</h1>
        <div class="ex-prev" style="${W.avatarImg ? `background:url('${W.avatarImg}') center/cover` : `background:${gradient(W.color)}`}">${W.avatarImg ? "" : W.avatar || (W.name || "?")[0]}</div>
        <label>Your name</label><input id="wz-n" value="${esc(W.name)}" maxlength="20">
        <label>Choose a PIN (4 or more digits) — you type it to sign in</label><input id="wz-p" type="password" maxlength="12" value="${esc(W.pin)}">
        <label>Your picture</label>${avatarPicker(W)}
        <label class="wz-chk"><input type="checkbox" id="wz-fam" ${W.keepFamily ? "checked" : ""}> Also keep the other family accounts (Tarun, Arjun)</label>`;
      if (W.step === 3) body = `<h1>Your apps</h1><p>Your old TrimangeesOS apps live in your cloud (Firebase). I can copy them into TriFS so they work offline and stay on your drive. The cloud copy stays too.</p>
        <label class="wz-chk"><input type="checkbox" id="wz-ca" ${W.copyApps ? "checked" : ""}> Yes, copy my cloud apps into TriFS</label>
        <label class="wz-chk"><input type="checkbox" id="wz-cl" ${W.cloud ? "checked" : ""}> Keep syncing my settings and files to the cloud (Firebase)</label>
        <p class="set-note">You can also add your own .exe / .html apps any time: Settings → Apps → Add a program.</p>
        <button class="set-btn" id="wz-pick">Add program files now…</button> <span id="wz-picked"></span><pre class="ex-pre" id="wz-log" hidden></pre>`;
      if (W.step === 4) body = `<h1>Make it yours</h1><label>Colour</label><div class="ex-cols">${COLORS.map((c) => `<span data-acc="${c}" style="background:${c}" class="${W.accent === c ? "on" : ""}"></span>`).join("")}</div>
        <label>Wallpaper</label><div class="swatches">${[0, 1, 2, 3].map((i) => `<div class="swatch sw-${i} ${W.preset === i ? "on" : ""}" data-pre="${i}"></div>`).join("")}</div>`;
      if (W.step === 5) { body = `<h1>All set, ${esc(W.name)}!</h1><p>Your account, drive and apps are ready. Sign in with your PIN on the next screen.</p>`; next = "Finish"; }
      ov.innerHTML = `<div class="wz-card">${dots}${body}<div class="wz-foot">${W.step > 0 ? '<button class="set-btn" id="wz-back">Back</button>' : "<span></span>"}<button class="set-btn primary" id="wz-next">${next}</button></div></div>`;
      wire(canNext);
    }
    function grab() {
      const g = (id) => ov.querySelector(id);
      if (W.step === 2) { W.name = g("#wz-n").value.trim(); W.pin = g("#wz-p").value; W.keepFamily = g("#wz-fam").checked; }
      if (W.step === 3) { W.copyApps = g("#wz-ca").checked; W.cloud = g("#wz-cl").checked; }
    }
    function wire(canNext) {
      const g = (id) => ov.querySelector(id);
      const back = g("#wz-back"); if (back) back.onclick = () => { grab(); W.step--; draw(); };
      g("#wz-next").onclick = async () => {
        grab();
        if (W.step === 2) {
          const n = W.name.replace(/[^\w .-]/g, "");
          if (!n) return toast("Setup", "Please type your name.");
          if (W.pin.length < 4) return toast("Setup", "Your PIN needs at least 4 characters.");
          W.name = n;
        }
        if (W.step === 3 && W.copyApps) {
          const log = g("#wz-log"); log.hidden = false; g("#wz-next").disabled = true; log.textContent = "Copying…";
          await transferCloudApps((m) => { log.textContent = m; log.scrollTop = 1e6; });
          g("#wz-next").disabled = false; W.copyApps = false; return;      // show result; press Next again to continue
        }
        if (W.step === 5) return finish();
        W.step++; draw();
      };
      if (W.step === 1 && g("#wz-drive")) g("#wz-drive").onclick = () => { ov.style.display = "none"; showTriFSWizard(); };
      if (W.step === 2) { wirePicker(ov, W, () => { grab(); draw(); }); }
      if (W.step === 3) g("#wz-pick").onclick = () => {
        const f = document.createElement("input"); f.type = "file"; f.multiple = true; f.accept = ".exe,.msi,.html,.htm,.AppImage";
        f.onchange = async () => { let n = 0; for (const file of f.files) { const r = await kernel.copy(kernel.pathOf(file), "/Applications"); if (r && r.ok) n++; }
          g("#wz-picked").textContent = n + " added"; try { refreshLocalApps(); } catch {} }; f.click();
      };
      if (W.step === 4) {
        ov.querySelectorAll("[data-acc]").forEach((s) => s.onclick = () => { W.accent = s.dataset.acc; draw(); });
        ov.querySelectorAll("[data-pre]").forEach((s) => s.onclick = () => { W.preset = +s.dataset.pre; draw(); });
      }
    }
    async function finish() {
      const rec = { pin: W.pin, color: W.accent || W.color, avatar: W.avatar, avatarImg: W.avatarImg,
        interests: "", flavor: "Welcome back, " + W.name + "!", theme: { preset: W.preset, accent: W.accent } };
      if (W.avatarImg === "" && !W.avatar) rec.avatar = "";
      CFG.accounts = { ...(CFG.accounts || {}), [W.name]: rec };
      if (!W.keepFamily) CFG.removedUsers = Object.keys(USERS).filter((n) => n !== W.name);
      CFG.users = CFG.users || {}; CFG.users[W.name] = { ...rec.theme };
      CFG.prefs = { ...(CFG.prefs || {}), noCloud: !W.cloud };
      CFG.lastUser = W.name; CFG.setupDone = true;
      applyAccounts(); try { await kernel.userHome(W.name); } catch {}
      await kernel.setConfig(CFG);
      try { buildLock(); selectLockUser(W.name); } catch {}
      ov.remove();
    }
    draw();
  }

  return { applyAccounts, avatarText, avatarCss, avatarStyle, bgMenu, desktopMenu, desktopRefresh, makeShortcut, openDefault,
    applyPrefs, onLogin, sectionNames, renderSection, maybeFirstRun, askText, transferCloudApps, newItems };
})();
window.EX = EX;
