// ============================================================
// extras4 — App Store (flatpak/apt), Linux apps in Start, media player,
// themes + lock-screen polish, backups, desktop updates, Windows add-ons,
// VirtualBox helpers.
// ============================================================
"use strict";

(() => {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const sh = (c, t) => kernel.sh(c, t).catch((e) => ({ ok: false, out: "", err: String(e) }));
  const save = () => { try { kernel.setConfig(CFG); } catch {} };
  const q = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
  const prefs = () => (CFG.prefs = CFG.prefs || {});
  const row = (title, sub, ctrl) => `<div class="ex-row"><div class="ex-l"><b>${title}</b>${sub ? `<span>${sub}</span>` : ""}</div><div class="ex-r">${ctrl}</div></div>`;
  const fmt = (n) => n < 1048576 ? (n / 1024).toFixed(0) + " KB" : n < 1073741824 ? (n / 1048576).toFixed(1) + " MB" : (n / 1073741824).toFixed(2) + " GB";
  const sections = window.EX.extraSections = window.EX.extraSections || {};
  const addSection = (name, fn) => { if (!EX.sectionNames.includes(name)) EX.sectionNames.push(name); sections[name] = fn; };

  // ── Linux apps show up in Start / search ─────────────────
  EX._linux = [];
  EX.appSources.push(() => EX._linux.map((l) => ({ id: l.id, name: l.name, color: "#4a5470", iconUrl: l.icon || undefined,
    letter: (l.name[0] || "?").toUpperCase(), category: "Linux apps", userApp: true,
    exec: { type: "linux", exec: l.exec, terminal: l.terminal } })));
  let lxSig = "";
  EX.refreshLinuxApps = async () => {
    try {
      const l = await kernel.appsLinux(); const sig = JSON.stringify(l.map((x) => x.id));
      if (sig === lxSig) return; lxSig = sig; EX._linux = l; mergeApps();
    } catch {}
  };

  // ============================================================
  // App Store
  // ============================================================
  const CATALOG = [
    ["VLC media player", "Plays almost any video or music file", "org.videolan.VLC", "\u{1F3AC}"],
    ["LibreOffice", "Word, Excel and PowerPoint compatible office suite", "org.libreoffice.LibreOffice", "\u{1F4C4}"],
    ["GIMP", "Photo editing, like Photoshop", "org.gimp.GIMP", "\u{1F3A8}"],
    ["Visual Studio Code", "Code editor", "com.visualstudio.code", "\u{1F4BB}"],
    ["Firefox", "Another web browser", "org.mozilla.firefox", "\u{1F98A}"],
    ["Blender", "3D modelling and animation", "org.blender.Blender", "\u{1F9CA}"],
    ["Inkscape", "Vector drawing", "org.inkscape.Inkscape", "\u2712\uFE0F"],
    ["Krita", "Digital painting", "org.kde.krita", "\u{1F58C}\uFE0F"],
    ["OBS Studio", "Screen recording and streaming", "com.obsproject.Studio", "\u{1F534}"],
    ["Audacity", "Audio editor", "org.audacityteam.Audacity", "\u{1F3A7}"],
    ["Kdenlive", "Video editor", "org.kde.kdenlive", "\u{1F39E}\uFE0F"],
    ["Thunderbird", "Email", "org.mozilla.Thunderbird", "\u2709\uFE0F"],
    ["Discord", "Chat", "com.discordapp.Discord", "\u{1F4AC}"],
    ["Telegram", "Chat", "org.telegram.desktop", "\u2708\uFE0F"],
    ["Spotify", "Music streaming", "com.spotify.Client", "\u{1F3B5}"],
    ["Steam", "Games", "com.valvesoftware.Steam", "\u{1F3AE}"],
    ["Stellarium", "Night sky planetarium", "org.stellarium.Stellarium", "\u{1F30C}"],
    ["Celestia", "Space simulator", "space.celestia.Celestia", "\u{1FA90}"],
  ];
  const FLATHUB = "flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo";
  async function installedFlatpaks() {
    const r = await sh("flatpak list --app --columns=application 2>/dev/null");
    return new Set((r.out || "").trim().split("\n").filter(Boolean));
  }
  EX.builders = EX.builders || {};
  EX.builders.store = (body, w) => {
    body.innerHTML = `<div class="store"><div class="st-top"><h2>App Store</h2><input id="st-q" placeholder="Filter apps…" spellcheck="false"></div>
      <p class="set-note">Apps are downloaded from Flathub (a big free app store) into your TriFS drive, so they stay after restarts. A black window shows the progress — it needs internet.</p>
      <div class="st-grid"></div>
      <h3>Anything else</h3>
      <div class="set-row-btns"><input id="st-id" placeholder="Flathub app id, e.g. org.gnome.Calculator" style="flex:1"><button class="set-btn" id="st-fi">Install from Flathub</button></div>
      <div class="set-row-btns"><input id="st-ap" placeholder="apt package name, e.g. htop" style="flex:1"><button class="set-btn" id="st-ai">Install with apt</button></div>
      <p class="set-note">Packages installed with apt are kept on TriFS too, so they are still there after you restart.</p></div>`;
    const grid = body.querySelector(".st-grid"); let have = new Set();
    const paint = () => {
      const f = body.querySelector("#st-q").value.toLowerCase();
      grid.innerHTML = CATALOG.filter((c) => !f || c[0].toLowerCase().includes(f) || c[1].toLowerCase().includes(f)).map((c) =>
        `<div class="st-card"><div class="st-ic">${c[3]}</div><div class="st-tx"><b>${esc(c[0])}</b><span>${esc(c[1])}</span></div>
         <button class="set-btn ${have.has(c[2]) ? "" : "primary"}" data-id="${c[2]}" data-has="${have.has(c[2]) ? 1 : 0}">${have.has(c[2]) ? "Remove" : "Install"}</button></div>`).join("");
      grid.querySelectorAll("button").forEach((b) => b.onclick = async () => {
        const id = b.dataset.id, name = CATALOG.find((c) => c[2] === id)[0];
        const cmd = b.dataset.has === "1" ? `flatpak uninstall --user -y ${id}` : `${FLATHUB}; flatpak install --user -y flathub ${id}`;
        await kernel.xtermRun(cmd, (b.dataset.has === "1" ? "Removing " : "Installing ") + name);
        toast("App Store", "Watch the black window. When it finishes, press Enter in it, then press Refresh.");
      });
    };
    const refresh = async () => { have = await installedFlatpaks(); paint(); EX.refreshLinuxApps(); };
    body.querySelector("#st-q").oninput = paint;
    body.querySelector("#st-fi").onclick = () => { const v = body.querySelector("#st-id").value.trim(); if (v) kernel.xtermRun(`${FLATHUB}; flatpak install --user -y flathub ${q(v)}`, "Installing " + v); };
    body.querySelector("#st-ai").onclick = () => { const v = body.querySelector("#st-ap").value.trim().replace(/[^\w.+-]/g, ""); if (v) kernel.xtermRun(`sudo apt-get update && sudo apt-get install -y ${v}`, "Installing " + v); };
    const rb = document.createElement("button"); rb.className = "set-btn"; rb.textContent = "Refresh"; rb.onclick = refresh; body.querySelector(".st-top").appendChild(rb);
    paint(); refresh();
    const iv = setInterval(() => { if (!document.body.contains(body)) clearInterval(iv); else refresh(); }, 20000);
  };

  // ============================================================
  // Media player
  // ============================================================
  const MEDIA = ["mp4", "webm", "mkv", "mov", "m4v", "ogv", "mp3", "wav", "ogg", "flac", "m4a", "aac", "opus"];
  const isVid = (n) => ["mp4", "webm", "mkv", "mov", "m4v", "ogv"].includes((n.split(".").pop() || "").toLowerCase());
  EX.builders.player = (body, w) => {
    body.innerHTML = `<div class="pl"><div class="pl-stage"><div class="pl-empty">Open a video or song to start.<br><button class="set-btn primary" id="pl-open">Open file…</button></div></div>
      <div class="pl-bar"><button class="set-btn" id="pl-prev">\u23EE</button><button class="set-btn" id="pl-next">\u23ED</button><span id="pl-name"></span><button class="set-btn" id="pl-open2">Open…</button></div>
      <div class="pl-list"></div></div>`;
    const stage = body.querySelector(".pl-stage"), list = body.querySelector(".pl-list");
    let items = [], idx = -1;
    async function playAt(i) {
      if (i < 0 || i >= items.length) return; idx = i;
      const real = await kernel.fsReal(items[i]);
      const el = document.createElement(isVid(items[i]) ? "video" : "audio");
      el.controls = true; el.autoplay = true; el.src = "file://" + encodeURI(real).replace(/#/g, "%23").replace(/\?/g, "%3F");
      el.style.cssText = "width:100%;height:" + (el.tagName === "VIDEO" ? "100%" : "54px") + ";background:#000";
      el.onended = () => playAt(idx + 1);
      el.onerror = () => toast("Player", "Can't play this file here. Try VLC from the App Store.");
      stage.innerHTML = ""; stage.appendChild(el);
      if (el.tagName === "AUDIO") stage.insertAdjacentHTML("afterbegin", `<div class="pl-art">\u{1F3B5}</div>`);
      body.querySelector("#pl-name").textContent = items[i].split("/").pop();
      setWinTitle(w, items[i].split("/").pop() + " — Media Player");
      list.querySelectorAll("div").forEach((d, k) => d.classList.toggle("on", k === i));
    }
    async function openPath(p) {
      const dir = p.replace(/\/[^/]*$/, "") || "/";
      const r = await kernel.listDir(dir); const all = r.ok ? r.entries.filter((e) => !e.isDir && MEDIA.includes((e.name.split(".").pop() || "").toLowerCase())).map((e) => (dir === "/" ? "" : dir) + "/" + e.name) : [p];
      items = all.length ? all : [p];
      list.innerHTML = items.map((x, k) => `<div data-k="${k}">${esc(x.split("/").pop())}</div>`).join("");
      list.querySelectorAll("div").forEach((d) => d.onclick = () => playAt(+d.dataset.k));
      playAt(Math.max(0, items.indexOf(p)));
    }
    const pick = () => { const f = document.createElement("input"); f.type = "file"; f.accept = "video/*,audio/*,.mkv,.flac,.m4a,.opus"; f.onchange = () => { if (f.files[0]) openPath(kernel.pathOf(f.files[0])); }; f.click(); };
    body.querySelector("#pl-open").onclick = pick; body.querySelector("#pl-open2").onclick = pick;
    body.querySelector("#pl-prev").onclick = () => playAt(idx - 1); body.querySelector("#pl-next").onclick = () => playAt(idx + 1);
    w.openArg = openPath; w.onClose = () => { stage.innerHTML = ""; };
    if (typeof w.arg === "string" && w.arg) openPath(w.arg);
  };

  // ============================================================
  // Themes, wallpapers, lock screen
  // ============================================================
  const G = (a, b, c) => `radial-gradient(90vw 70vh at 85% 10%, ${a}, transparent 62%), radial-gradient(80vw 60vh at 10% 90%, ${b}, transparent 60%), linear-gradient(130deg, ${c})`;
  const THEMES = [
    [5, "Midnight", G("rgba(90,120,255,.3)", "rgba(40,60,160,.35)", "#05060f 0%, #0b1030 60%, #070b22 100%")],
    [6, "Sunset", G("rgba(255,120,80,.5)", "rgba(190,60,160,.4)", "#2a0a2e 0%, #5a1a3a 55%, #8a3a1e 100%")],
    [7, "Ocean", G("rgba(60,200,230,.4)", "rgba(20,90,200,.45)", "#021a2e 0%, #053a5e 55%, #0a5a7a 100%")],
    [8, "Mint", G("rgba(120,240,190,.35)", "rgba(40,160,140,.35)", "#06241e 0%, #0b4a3e 55%, #136a58 100%")],
    [9, "Graphite", G("rgba(200,200,220,.12)", "rgba(120,120,150,.14)", "#101114 0%, #1b1d24 55%, #262932 100%")],
    [10, "Rose", G("rgba(255,120,170,.4)", "rgba(180,60,120,.35)", "#2a0618 0%, #52143a 55%, #7a2250 100%")],
    [11, "Lightning", G("rgba(255,230,120,.38)", "rgba(110,90,255,.35)", "#0a0a26 0%, #1a1650 55%, #2a2a8a 100%")],
    [12, "Desert", G("rgba(255,190,100,.38)", "rgba(200,100,60,.3)", "#2a1408 0%, #55301a 55%, #7a4a26 100%")],
  ];
  const BASE = [[0, "Aurora"], [1, "Ember"], [2, "Forest"], [3, "Storm"]];
  const st = document.createElement("style");
  st.textContent = THEMES.map(([i, , css]) => `body.preset-${i}{background:${css}}`).join("\n");
  document.head.appendChild(st);
  const themeCss = (i) => (THEMES.find((t) => t[0] === i) || [])[2];
  const baseCss = { 0: "linear-gradient(120deg,#1a0530,#120a3e 45%,#0a1560)", 1: "linear-gradient(120deg,#2a060e,#4a1010 55%,#6e1e08)", 2: "linear-gradient(120deg,#04200f,#0a3220 50%,#0a1440)", 3: "linear-gradient(160deg,#0a0c22,#16203e 45%,#28407a)" };
  function applyLockBg() {
    const lock = document.getElementById("lock"); if (!lock) return;
    const b = CFG.lockBg;
    if (b && b.image) { loadWallpaperImage(lock, b.image); }
    else if (b && b.preset != null) lock.style.background = themeCss(b.preset) || baseCss[b.preset] || "";
    else lock.style.background = "";
  }
  EX.applyLockBg = applyLockBg;

  addSection("Themes & Wallpapers", async (main, again, H) => {
    const uc = getUserCfg();
    const sw = (i, name, css) => `<div class="tw-sw ${uc.preset === i ? "on" : ""}" data-p="${i}" style="background:${css}" title="${name}"><span>${name}</span></div>`;
    const lsw = (i, name, css) => `<div class="tw-sw small ${CFG.lockBg && CFG.lockBg.preset === i ? "on" : ""}" data-l="${i}" style="background:${css}" title="${name}"></div>`;
    const all = [...BASE.map(([i, n]) => [i, n, baseCss[i]]), ...THEMES.map(([i, n, c]) => [i, n, c])];
    main.innerHTML = H("Pick the look of your desktop. (TrimangeesOS is a dark system — there is no light mode.)") +
      `<h3>Desktop wallpaper</h3><div class="tw-grid">${all.map((x) => sw(...x)).join("")}</div>
       <div class="set-row-btns"><button class="set-btn" id="tw-img">Use my own picture…</button></div>
       <h3>Sign-in screen background</h3><div class="tw-grid">${all.map((x) => lsw(...x)).join("")}</div>
       <div class="set-row-btns"><button class="set-btn" id="tw-limg">Use my own picture…</button><button class="set-btn" id="tw-lreset">Default</button></div>`;
    main.querySelectorAll("[data-p]").forEach((el) => el.onclick = () => { uc.preset = +el.dataset.p; osApplyTheme(); saveTheme(); again(); });
    main.querySelectorAll("[data-l]").forEach((el) => el.onclick = () => { CFG.lockBg = { preset: +el.dataset.l }; applyLockBg(); save(); again(); });
    const pick = (cb) => { const f = document.createElement("input"); f.type = "file"; f.accept = "image/*"; f.onchange = async () => { if (!f.files[0]) return;
      const dest = (USER_HOME || "/home/" + CURRENT_USER) + "/Pictures"; await kernel.mkdir(dest); const r = await kernel.copy(kernel.pathOf(f.files[0]), dest);
      cb(dest + "/" + f.files[0].name); }; f.click(); };
    main.querySelector("#tw-img").onclick = () => pick((p) => { uc.preset = 4; uc.wallpaperImage = p; osApplyTheme(); saveTheme(); again(); });
    main.querySelector("#tw-limg").onclick = () => pick((p) => { CFG.lockBg = { image: p }; applyLockBg(); save(); again(); });
    main.querySelector("#tw-lreset").onclick = () => { delete CFG.lockBg; applyLockBg(); save(); again(); };
  });

  // lock screen: big clock, bigger avatar, show-PIN eye
  function polishLock() {
    const lock = document.getElementById("lock"), pin = document.getElementById("lock-pin");
    if (!lock || !pin || document.getElementById("lock-clock")) return;
    const c = document.createElement("div"); c.id = "lock-clock"; c.innerHTML = `<div id="lc-t"></div><div id="lc-d"></div>`; lock.prepend(c);
    const wrap = document.createElement("div"); wrap.className = "pin-wrap"; pin.before(wrap); wrap.appendChild(pin);
    const eye = document.createElement("button"); eye.type = "button"; eye.className = "pin-eye"; eye.textContent = "\u{1F441}"; eye.title = "Show PIN";
    eye.onclick = () => { pin.type = pin.type === "password" ? "text" : "password"; pin.focus(); };
    wrap.appendChild(eye);
    const tick = () => { const n = new Date(); c.querySelector("#lc-t").textContent = n.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: !window.__clock24 });
      c.querySelector("#lc-d").textContent = n.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" }); };
    tick(); setInterval(tick, 5000);
  }
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", polishLock) : polishLock();
  setTimeout(applyLockBg, 400); setTimeout(applyLockBg, 2500);

  // ============================================================
  // Backups
  // ============================================================
  addSection("Backups", async (main, again, H) => {
    main.innerHTML = H("Your home folder is copied to TriFS automatically once a day (the newest 3 copies are kept).") + `<div class="ex-load">Looking…</div>`;
    const list = await kernel.backupList(CURRENT_USER);
    const last = (CFG.users[CURRENT_USER] || {}).lastBackup;
    main.innerHTML = H("Your home folder is copied to TriFS automatically once a day (the newest 3 copies are kept).") +
      row("Automatic daily backup", last ? "Last backup: " + new Date(last).toLocaleString() : "No backup yet", `<label class="ex-sw"><input type="checkbox" id="bk-on" ${prefs().noBackup ? "" : "checked"}><i></i></label>`) +
      `<div class="set-row-btns"><button class="set-btn primary" id="bk-now">Back up now</button><span id="bk-st" class="set-note"></span></div>` +
      `<h3>Backups</h3>` + (list.length ? list.map((b, i) => row(esc(b.name), fmt(b.size), `<button class="set-btn" data-r="${i}">Restore</button>`)).join("") : `<div class="pp-note">None yet.</div>`) +
      `<p class="set-note">Restoring puts the old files in a new folder called "Restored-…" in your home folder. Nothing is overwritten.</p>`;
    main.querySelector("#bk-on").onchange = (e) => { prefs().noBackup = !e.target.checked; save(); };
    main.querySelector("#bk-now").onclick = async () => { const s = main.querySelector("#bk-st"); s.textContent = "Backing up… (this can take a few minutes)"; const r = await EX.backupNow(); s.textContent = r.ok ? "Done." : "Failed: " + r.error; again(); };
    main.querySelectorAll("[data-r]").forEach((b) => b.onclick = async () => { const r = await kernel.backupRestore(CURRENT_USER, list[+b.dataset.r].name); toast("Restore", r.ok ? "Restored into " + r.dest : "Failed: " + r.error); });
  });
  EX.backupNow = async () => {
    const r = await kernel.backupRun(CURRENT_USER);
    if (r.ok) { CFG.users[CURRENT_USER] = { ...(CFG.users[CURRENT_USER] || {}), lastBackup: Date.now() }; save(); }
    return r;
  };
  async function autoBackup() {
    if (prefs().noBackup || !CURRENT_USER) return;
    const last = (CFG.users[CURRENT_USER] || {}).lastBackup || 0;
    if (Date.now() - last < 20 * 3600e3) return;
    const r = await EX.backupNow(); if (r.ok) toast("Backup", "Your files were backed up (" + fmt(r.size) + ").");
  }

  // ============================================================
  // Desktop updates (no new ISO needed)
  // ============================================================
  addSection("Desktop updates", async (main, again, H) => {
    const s = await kernel.updateStatus();
    main.innerHTML = H("Small fixes can be installed without downloading the whole ISO again.") +
      row("Status", s.safe ? "Safe mode is on (the desktop crashed a few times)." : "", s.override ? `Using an update${s.version ? " (" + esc(s.version) + ")" : ""}` : "Built-in version") +
      `<div class="set-row-btns"><button class="set-btn primary" id="up-get">Get the latest update from GitHub</button><button class="set-btn" id="up-file">Choose a shell-update.zip…</button>${s.override ? '<button class="set-btn" id="up-rev">Go back to the built-in version</button>' : ""}</div>
       <div id="up-o" class="set-note"></div>`;
    const o = main.querySelector("#up-o");
    const done = async (r) => { if (!r.ok) { o.textContent = "Failed: " + r.error; return; } o.textContent = "Installed. Restarting the desktop…"; setTimeout(() => kernel.restartShell(), 800); };
    main.querySelector("#up-get").onclick = async () => {
      o.textContent = "Downloading…"; const dl = (USER_HOME || "/home/" + CURRENT_USER) + "/Downloads"; await kernel.mkdir(dl);
      const r = await sh(`curl -fL --max-time 120 -o ${q(dl + "/shell-update.zip")} https://github.com/Adithya-Jayaraman/trimangees/releases/latest/download/shell-update.zip 2>&1`, 130000);
      if (!r.ok) { o.textContent = "Could not download (is the repo private, or the internet off?). You can download shell-update.zip yourself and use 'Choose a file'."; return; }
      o.textContent = "Installing…"; done(await kernel.updateInstall(dl + "/shell-update.zip"));
    };
    main.querySelector("#up-file").onclick = () => { const f = document.createElement("input"); f.type = "file"; f.accept = ".zip"; f.onchange = async () => { if (!f.files[0]) return; o.textContent = "Installing…"; done(await kernel.updateInstall(kernel.pathOf(f.files[0]))); }; f.click(); };
    const rv = main.querySelector("#up-rev"); if (rv) rv.onclick = async () => { await kernel.updateRevert(); o.textContent = "Reverted. Restarting…"; setTimeout(() => kernel.restartShell(), 800); };
  });

  // ============================================================
  // Windows add-ons (winetricks)
  // ============================================================
  addSection("Windows programs", async (main, again, H) => {
    const ADD = [["Visual C++ runtimes", "Needed by most games and apps", "vcrun2022"], ["Older Visual C++ (2015)", "", "vcrun2015"], [".NET Framework 4.8", "Needed by many Windows apps (slow)", "dotnet48"],
      ["Windows fonts", "Arial, Times New Roman, etc.", "corefonts"], ["DirectX 9", "Older games", "d3dx9"], ["DXVK (faster graphics)", "Better game speed", "dxvk"]];
    main.innerHTML = H("Windows programs (.exe) run with Wine. If one won't start, it may need one of these add-ons. A black window shows the progress.") +
      ADD.map((a, i) => row(a[0], a[1], `<button class="set-btn" data-a="${i}">Install</button>`)).join("") +
      `<h3>Run a program</h3><div class="set-row-btns"><button class="set-btn primary" id="wp-run">Choose a .exe / .msi to run…</button><button class="set-btn" id="wp-cfg">Wine settings</button><button class="set-btn" id="wp-un">Installed Windows programs</button></div>
       <p class="set-note">Tip: you can also double-click any .exe in Files. Your Windows programs stay on TriFS.</p>`;
    main.querySelectorAll("[data-a]").forEach((b) => b.onclick = () => kernel.xtermRun(`winetricks -q ${ADD[+b.dataset.a][2]}`, "Installing " + ADD[+b.dataset.a][0]));
    main.querySelector("#wp-run").onclick = () => { const f = document.createElement("input"); f.type = "file"; f.accept = ".exe,.msi,.bat"; f.onchange = () => { if (f.files[0]) kernel.runFile(kernel.pathOf(f.files[0])).then((r) => r && !r.ok && toast("Run", r.error)); }; f.click(); };
    main.querySelector("#wp-cfg").onclick = () => kernel.runWineTool(["winecfg"]);
    main.querySelector("#wp-un").onclick = () => kernel.runWineTool(["uninstaller"]);
  });

  // ============================================================
  // VirtualBox helpers
  // ============================================================
  addSection("VirtualBox", async (main, again, H) => {
    main.innerHTML = H("Sharing files and the clipboard with Windows.") + `<div class="ex-load">Looking…</div>`;
    const [cl, sf, mt] = await Promise.all([sh("pgrep -a VBoxClient | head -5; pgrep -a VBoxService | head -2"), sh("VBoxControl --nologo sharedfolder list 2>&1 | head -12"), sh("ls /media 2>&1 | head -20")]);
    main.innerHTML = H("Sharing files and the clipboard with Windows.") +
      `<h3>Guest additions</h3>${cl.out.trim() ? `<pre class="ex-pre">${esc(cl.out)}</pre>` : `<div class="pp-note">Not running (you are probably not inside VirtualBox).</div>`}
       <div class="set-row-btns"><button class="set-btn" id="vb-re">Reconnect clipboard, drag &amp; drop and screen</button></div>
       <h3>Shared folders</h3><pre class="ex-pre">${esc(sf.out.trim() || "(none)")}</pre><pre class="ex-pre">/media: ${esc(mt.out.trim() || "(empty)")}</pre>
       <div class="set-row-btns"><button class="set-btn" id="vb-mount">Mount shared folders now</button><button class="set-btn" id="vb-files">Open /media in Files</button></div>
       <h3>How to set it up (once, in the VirtualBox window)</h3>
       <ol class="set-note" style="line-height:1.7;margin-left:18px">
         <li><b>Clipboard:</b> menu <i>Devices → Shared Clipboard → Bidirectional</i>.</li>
         <li><b>Drag &amp; drop files from Windows:</b> <i>Devices → Drag and Drop → Bidirectional</i>, then drag a file onto a Files window or the desktop.</li>
         <li><b>Shared folder:</b> <i>Devices → Shared Folders → Shared Folder Settings → +</i>, choose a Windows folder (on E:, not C:/D:), tick <i>Auto-mount</i>, OK. It then shows up in Files as "Shared: …" (restart the VM or press "Mount shared folders now").</li>
         <li><b>Full-screen:</b> <i>View → Auto-resize Guest Display</i>.</li></ol>`;
    main.querySelector("#vb-re").onclick = async () => { await sh("pkill VBoxClient; (VBoxClient --clipboard; VBoxClient --draganddrop; VBoxClient --vmsvga-session || VBoxClient --vmsvga) >/dev/null 2>&1 &"); toast("VirtualBox", "Reconnected."); setTimeout(again, 1200); };
    main.querySelector("#vb-mount").onclick = async () => {
      await sh(`VBoxControl --nologo sharedfolder list 2>/dev/null | sed -n 's/^ *[0-9]* - \\([^ ]*\\).*/\\1/p' | while read n; do [ -d /media/sf_$n ] || { sudo -n mkdir -p /media/sf_$n; sudo -n mount -t vboxsf -o uid=$(id -u),gid=$(id -g) $n /media/sf_$n; }; done`);
      toast("VirtualBox", "Done — look under Shared in Files."); again(); };
    main.querySelector("#vb-files").onclick = () => launch("explorer", "/media");
  });

  // safe mode (the desktop crashed three times): skip startup apps and explain
  try { kernel.updateStatus().then((s) => { if (s && s.safe) { EX._safe = true; setTimeout(() => toast("Safe mode", "The desktop crashed a few times, so it started in safe mode. A bad update was put aside. Use Settings → Desktop updates if you want to try again."), 4000); } }); } catch {}

  // ── on login ─────────────────────────────────────────────
  const prev = EX.onLogin;
  EX.onLogin = (u) => {
    prev && prev(u);
    applyLockBg(); EX.refreshLinuxApps();
    if (!EX._lx) EX._lx = setInterval(EX.refreshLinuxApps, 45000);
    setTimeout(autoBackup, 90000);
  };
})();
