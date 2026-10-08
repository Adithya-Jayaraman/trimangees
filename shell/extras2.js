// ============================================================
// extras2 — File Explorer power features:
// multi-select, copy/cut/paste, Recycle Bin, zip/unzip, thumbnails,
// preview (space), drag & drop, "open terminal here".
// ============================================================
"use strict";

(() => {
  const q = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
  const home = () => USER_HOME || "/home/" + (CURRENT_USER || "");
  const trashDir = () => home() + "/.Trash";
  const inTrash = (p) => p.startsWith(trashDir() + "/") || p === trashDir();
  const extOf = (n) => (n.split(".").pop() || "").toLowerCase();
  const fileUrl = (p) => "file://" + encodeURI(p).replace(/#/g, "%23").replace(/\?/g, "%3F");
  const IMG = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"];
  const VID = ["mp4", "webm", "mkv", "mov", "m4v", "ogv"];
  const AUD = ["mp3", "wav", "ogg", "flac", "m4a", "aac", "opus"];
  const ARCH = ["zip", "tar", "gz", "tgz", "xz", "bz2", "7z", "rar"];
  const TXT = ["txt", "md", "json", "js", "css", "py", "sh", "c", "cpp", "h", "java", "xml", "yaml", "yml", "csv", "log", "ini", "cfg", "html", "htm", "ts", "toml"];
  const sh = (c, t) => kernel.sh(c, t).catch((e) => ({ ok: false, out: "", err: String(e) }));
  const nameOf = (p) => p.split("/").filter(Boolean).pop() || p;
  const dirOf = (p) => p.replace(/\/[^/]*$/, "") || "/";

  EX.clip = { paths: [], mode: "copy" };
  EX.drag = null;

  // ── Recycle Bin ──────────────────────────────────────────
  async function readInfo() {
    try { const r = await kernel.readFile(trashDir() + "/.info.json"); return r.ok ? JSON.parse(r.content || "{}") : {}; } catch { return {}; }
  }
  async function writeInfo(info) { await kernel.writeFile(trashDir() + "/.info.json", JSON.stringify(info)); }
  EX.trash = async (paths) => {
    await kernel.mkdir(trashDir());
    const info = await readInfo(); let n = 0, err = "";
    for (const p of paths) {
      const dest = await kernel.fsUnique(trashDir(), nameOf(p));
      const r = await kernel.fsMove(p, dest);
      if (r.ok) { info[nameOf(dest)] = p; n++; } else err = r.error;
    }
    await writeInfo(info);
    if (n) toast("Recycle Bin", n === 1 ? `Moved "${nameOf(paths[0])}" (restore it from the Recycle Bin)` : `Moved ${n} items`);
    if (err) toast("Couldn't delete", err);
    refreshExplorers();
  };
  EX.deleteForever = async (paths) => {
    let err = "";
    for (const p of paths) { const r = await kernel.remove(p); if (!r.ok) err = r.error; }
    const info = await readInfo(); for (const p of paths) delete info[nameOf(p)]; await writeInfo(info).catch(() => {});
    if (err) toast("Delete failed", err);
    refreshExplorers();
  };
  EX.deletePaths = async (paths) => {
    if (paths.every(inTrash)) {
      if (await confirmDialog(`Permanently delete ${paths.length === 1 ? '"' + nameOf(paths[0]) + '"' : paths.length + " items"}? This cannot be undone.`)) await EX.deleteForever(paths);
    } else await EX.trash(paths);
  };
  EX.restore = async (paths) => {
    const info = await readInfo();
    for (const p of paths) {
      const orig = info[nameOf(p)]; if (!orig) { toast("Restore", "I don't know where that came from."); continue; }
      const dest = await kernel.fsUnique(dirOf(orig), nameOf(orig));
      await kernel.mkdir(dirOf(orig));
      const r = await kernel.fsMove(p, dest);
      if (r.ok) delete info[nameOf(p)]; else toast("Restore failed", r.error);
    }
    await writeInfo(info); refreshExplorers();
  };
  EX.emptyTrash = async () => {
    if (!(await confirmDialog("Empty the Recycle Bin? Everything in it is deleted for good."))) return;
    const r = await kernel.listDir(trashDir(), false);
    if (r.ok) for (const en of r.entries) await kernel.remove(trashDir() + "/" + en.name);
    await writeInfo({}); refreshExplorers(); toast("Recycle Bin", "Emptied.");
  };

  // ── copy / cut / paste ───────────────────────────────────
  EX.copyPaths = (paths, mode) => { EX.clip = { paths: [...paths], mode }; toast(mode === "cut" ? "Cut" : "Copied", paths.length === 1 ? nameOf(paths[0]) : paths.length + " items"); };
  EX.paste = async (dir) => {
    const c = EX.clip; if (!c.paths.length) return toast("Paste", "Nothing copied yet.");
    for (const p of c.paths) {
      if (dir === p || dir.startsWith(p + "/")) { toast("Paste", "Can't put a folder inside itself."); continue; }
      const dest = await kernel.fsUnique(dir, nameOf(p));
      if (c.mode === "cut") { if (dirOf(p) === dir) continue; const r = await kernel.fsMove(p, dest); if (!r.ok) toast("Move failed", r.error); }
      else { const r = await kernel.copy(p, dest); if (!r.ok) toast("Copy failed", r.error); }
    }
    if (c.mode === "cut") EX.clip = { paths: [], mode: "copy" };
    refreshExplorers();
  };
  EX.transfer = async (paths, dir, copy) => {
    for (const p of paths) {
      if (dir === p || dir.startsWith(p + "/") || dirOf(p) === dir) continue;
      const dest = await kernel.fsUnique(dir, nameOf(p));
      const r = copy ? await kernel.copy(p, dest) : await kernel.fsMove(p, dest);
      if (!r.ok) toast(copy ? "Copy failed" : "Move failed", r.error);
    }
    refreshExplorers();
  };
  EX.importFiles = async (files, dir) => {      // files dragged in from Windows (VirtualBox drag & drop)
    let n = 0;
    for (const f of files) {
      try {
        const rp = kernel.pathOf(f); if (!rp) continue;
        const vp = await kernel.toVirtual(rp);
        const dest = await kernel.fsUnique(dir, f.name);
        const r = await kernel.copy(vp || rp, dest); if (r.ok) n++; else toast("Couldn't copy " + f.name, r.error);
      } catch {}
    }
    if (n) toast("Copied in", n + " file" + (n > 1 ? "s" : "")); refreshExplorers();
  };

  // ── zip / unzip ──────────────────────────────────────────
  EX.zip = async (paths) => {
    const dir = dirOf(paths[0]);
    const base = paths.length === 1 ? nameOf(paths[0]).replace(/\.[^.]+$/, "") || nameOf(paths[0]) : "Archive";
    const out = await kernel.fsUnique(dir, base + ".zip");
    const [rd, ro] = await kernel.fsRealMany([dir, out]);
    toast("Compressing", "Please wait…");
    const r = await sh(`cd ${q(rd)} && zip -rq ${q(ro)} ${paths.map((p) => q(nameOf(p))).join(" ")}`, 10 * 60 * 1000);
    toast(r.ok ? "Zip created" : "Zip failed", r.ok ? nameOf(out) : (r.err || r.out).slice(0, 120)); refreshExplorers();
  };
  EX.unzip = async (p) => {
    const dir = dirOf(p), ext = extOf(p);
    const dest = await kernel.fsUnique(dir, nameOf(p).replace(/\.(tar\.(gz|xz|bz2)|tgz|zip|7z|rar|gz|xz|bz2|tar)$/i, "") || "Extracted");
    const [rp, rd] = await kernel.fsRealMany([p, dest]);
    toast("Extracting", "Please wait…");
    const cmd = ext === "zip" ? `unzip -q -o ${q(rp)} -d ${q(rd)}`
      : (ext === "7z" || ext === "rar") ? `7z x -y -o${q(rd)} ${q(rp)}`
      : `mkdir -p ${q(rd)} && tar -xf ${q(rp)} -C ${q(rd)}`;
    const r = await sh(cmd, 10 * 60 * 1000);
    toast(r.ok ? "Extracted" : "Extract failed", r.ok ? nameOf(dest) : (r.err || r.out).slice(0, 120)); refreshExplorers();
  };

  // ── preview (space bar) ──────────────────────────────────
  EX.preview = async (p) => {
    const ext = extOf(p); const [rp] = await kernel.fsRealMany([p]); const url = fileUrl(rp);
    const ov = document.createElement("div"); ov.className = "ex-modal ex-prev-ov"; ov.tabIndex = 0;
    let inner = "";
    if (IMG.includes(ext)) inner = `<img src="${url}">`;
    else if (VID.includes(ext)) inner = `<video src="${url}" controls autoplay></video>`;
    else if (AUD.includes(ext)) inner = `<audio src="${url}" controls autoplay></audio>`;
    else if (ext === "pdf") inner = `<iframe src="${url}"></iframe>`;
    else if (TXT.includes(ext)) {
      const r = await kernel.readFile(p);
      const pre = document.createElement("pre"); pre.className = "ex-pre"; pre.style.maxHeight = "70vh";
      pre.textContent = r.ok ? r.content.slice(0, 200000) : r.error; inner = pre.outerHTML;
    } else inner = `<div class="ex-pre">No preview for .${esc2(ext)} files. Double-click to open.</div>`;
    ov.innerHTML = `<div class="ex-prev-box"><div class="ex-prev-t">${esc2(nameOf(p))}</div>${inner}</div>`;
    const close = () => ov.remove();
    ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
    ov.addEventListener("keydown", (e) => { if (e.key === "Escape" || e.key === " ") { e.preventDefault(); close(); } });
    document.body.appendChild(ov); ov.focus();
  };
  const esc2 = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // ── right-click menu for one or several selected items ───
  function rowMenu(x, y, ctx, items) {
    const paths = items.map((i) => i.full);
    const single = items.length === 1 ? items[0] : null;
    const trashed = paths.every(inTrash);
    const manage = ["-"];
    if (trashed) {
      manage.push({ label: "Restore", run: () => EX.restore(paths) });
      manage.push({ label: "Delete permanently", run: () => EX.deletePaths(paths) });
    } else {
      manage.push({ label: "Cut", run: () => EX.copyPaths(paths, "cut") });
      manage.push({ label: "Copy", run: () => EX.copyPaths(paths, "copy") });
      if (single && single.en.isDir && EX.clip.paths.length) manage.push({ label: "Paste into folder", run: () => EX.paste(single.full) });
      manage.push("-");
      if (single) manage.push({ label: "Rename", run: () => ctx.startRename(single.en.name) });
      manage.push({ label: "Move to Recycle Bin", run: () => EX.deletePaths(paths) });
      manage.push("-");
      manage.push({ label: "Create desktop shortcut", run: () => paths.forEach((p) => EX.makeShortcut({ kind: "path", path: p, name: nameOf(p).replace(/\.[^.]+$/, "") || nameOf(p) })) });
      if (single) manage.push({ label: "Pin to taskbar", run: () => EX.pinPath(single.full, single.en.name.replace(/\.[^.]+$/, "") || single.en.name, single.en.isDir) });
      manage.push({ label: "Compress to ZIP", run: () => EX.zip(paths) });
      if (single && !single.en.isDir && ARCH.includes(extOf(single.en.name))) manage.push({ label: "Extract here", run: () => EX.unzip(single.full) });
    }
    if (!single) { showContextMenu(x, y, manage.slice(1)); return; }
    if (single.en.isDir) {
      showContextMenu(x, y, [
        { label: "Open", run: () => ctx.show(single.full) },
        { label: "Open terminal here", run: () => launch("terminal", single.full) }, ...manage]);
    } else if (trashed) {
      showContextMenu(x, y, manage.slice(1));
    } else {
      fileOpenWithMenu(x, y, single.full, manage);
    }
  }

  // ── wire up one directory listing ────────────────────────
  EX.decorate = (ctx) => {
    const { list, st, rows } = ctx;
    const sel = new Set(); let anchor = -1;
    list.tabIndex = 0;
    const mark = () => rows.forEach((r) => r.row.classList.toggle("selected", sel.has(r.full)));
    const chosen = () => rows.filter((r) => sel.has(r.full));
    ctx.chosen = chosen;
    const isBin = () => st.dir === trashDir();

    rows.forEach((r, i) => {
      r.row.onclick = (e) => {
        if (e.shiftKey && anchor >= 0) { sel.clear(); for (let k = Math.min(anchor, i); k <= Math.max(anchor, i); k++) sel.add(rows[k].full); }
        else if (e.ctrlKey || e.metaKey) { sel.has(r.full) ? sel.delete(r.full) : sel.add(r.full); anchor = i; }
        else { sel.clear(); sel.add(r.full); anchor = i; }
        mark(); list.focus();
      };
      r.row.oncontextmenu = (e) => {
        e.preventDefault(); e.stopPropagation();
        if (!sel.has(r.full)) { sel.clear(); sel.add(r.full); anchor = i; mark(); }
        rowMenu(e.clientX, e.clientY, ctx, chosen());
      };
      r.row.draggable = true;
      r.row.ondragstart = (e) => {
        if (!sel.has(r.full)) { sel.clear(); sel.add(r.full); mark(); }
        EX.drag = chosen().map((x) => x.full);
        e.dataTransfer.setData("text/plain", EX.drag.join("\n")); e.dataTransfer.effectAllowed = "copyMove";
      };
      r.row.ondragend = () => { EX.drag = null; list.querySelectorAll(".drop").forEach((x) => x.classList.remove("drop")); };
      if (r.en.isDir) {
        r.row.ondragover = (e) => { if (EX.drag && !EX.drag.includes(r.full)) { e.preventDefault(); e.stopPropagation(); r.row.classList.add("drop"); } };
        r.row.ondragleave = () => r.row.classList.remove("drop");
        r.row.ondrop = (e) => {
          r.row.classList.remove("drop");
          if (EX.drag) { e.preventDefault(); e.stopPropagation(); const d = EX.drag; EX.drag = null; EX.transfer(d, r.full, e.ctrlKey); }
          else if (e.dataTransfer.files && e.dataTransfer.files.length) { e.preventDefault(); e.stopPropagation(); EX.importFiles(e.dataTransfer.files, r.full); }
        };
      }
    });

    list.onclick = (e) => { if (e.target === list) { sel.clear(); mark(); } };
    list.ondragover = (e) => { if (EX.drag || (e.dataTransfer && e.dataTransfer.types.includes("Files"))) e.preventDefault(); };
    list.ondrop = (e) => {
      e.preventDefault();
      if (EX.drag) { const d = EX.drag; EX.drag = null; EX.transfer(d, st.dir, e.ctrlKey); }
      else if (e.dataTransfer.files && e.dataTransfer.files.length) EX.importFiles(e.dataTransfer.files, st.dir);
    };
    list.onkeydown = (e) => {
      const c = chosen();
      if (e.ctrlKey && e.key.toLowerCase() === "a") { e.preventDefault(); rows.forEach((r) => sel.add(r.full)); mark(); }
      else if (e.ctrlKey && e.key.toLowerCase() === "c" && c.length) { e.preventDefault(); EX.copyPaths(c.map((x) => x.full), "copy"); }
      else if (e.ctrlKey && e.key.toLowerCase() === "x" && c.length) { e.preventDefault(); EX.copyPaths(c.map((x) => x.full), "cut"); }
      else if (e.ctrlKey && e.key.toLowerCase() === "v") { e.preventDefault(); EX.paste(st.dir); }
      else if (e.key === "Delete" && c.length) { e.preventDefault(); e.shiftKey ? EX.deleteForever(c.map((x) => x.full)) : EX.deletePaths(c.map((x) => x.full)); }
      else if (e.key === "F2" && c.length === 1) { e.preventDefault(); ctx.startRename(c[0].en.name); }
      else if (e.key === "Enter" && c.length === 1) { e.preventDefault(); c[0].row.ondblclick(); }
      else if (e.key === " " && c.length === 1 && !c[0].en.isDir) { e.preventDefault(); EX.preview(c[0].full); }
      else if (e.key === "Backspace") { e.preventDefault(); ctx.body.querySelector(".e-up").click(); }
      else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && rows.length) {
        e.preventDefault();
        const cur = c.length ? rows.indexOf(c[c.length - 1]) : -1;
        const nx = Math.max(0, Math.min(rows.length - 1, cur + (e.key === "ArrowDown" ? 1 : -1)));
        if (!e.shiftKey) sel.clear(); sel.add(rows[nx].full); anchor = nx; mark(); rows[nx].row.scrollIntoView({ block: "nearest" });
      }
    };

    // thumbnails for pictures
    const pics = rows.filter((r) => !r.en.isDir && ["png", "jpg", "jpeg", "gif", "webp", "bmp"].includes(extOf(r.en.name))).slice(0, 150);
    if (pics.length) kernel.fsRealMany(pics.map((r) => r.full)).then((reals) => {
      pics.forEach((r, k) => {
        const ic = r.row.querySelector(".fic"); if (!ic || !reals[k]) return;
        ic.innerHTML = `<img src="${fileUrl(reals[k])}" loading="lazy" style="width:22px;height:22px;object-fit:cover;border-radius:4px;vertical-align:middle">`;
      });
    }).catch(() => {});

    // Recycle Bin banner
    if (isBin() && rows.length) {
      const b = document.createElement("div"); b.className = "ex-bin-bar";
      b.innerHTML = `<span>Recycle Bin</span><button class="set-btn">Empty Recycle Bin</button>`;
      b.querySelector("button").onclick = EX.emptyTrash; list.prepend(b);
    }
  };

  // sidebar: Recycle Bin entry + drop targets
  EX.sidebarExtras = (side, show) => {
    const sep = document.createElement("div"); sep.className = "exp-sep"; side.appendChild(sep);
    const d = document.createElement("div"); d.textContent = "\u{1F5D1}️ Recycle Bin"; d.dataset.path = trashDir();
    d.onclick = async () => { await kernel.mkdir(trashDir()); show(trashDir()); };
    side.appendChild(d);
    side.querySelectorAll("div[data-path]").forEach((el) => {
      el.ondragover = (e) => { if (EX.drag) { e.preventDefault(); el.classList.add("drop"); } };
      el.ondragleave = () => el.classList.remove("drop");
      el.ondrop = (e) => {
        el.classList.remove("drop");
        if (EX.drag) { e.preventDefault(); const dd = EX.drag; EX.drag = null; el.dataset.path === trashDir() ? EX.trash(dd) : EX.transfer(dd, el.dataset.path, e.ctrlKey); }
        else if (e.dataTransfer.files && e.dataTransfer.files.length) { e.preventDefault(); EX.importFiles(e.dataTransfer.files, el.dataset.path); }
      };
    });
  };

  // dropping things on the desktop: files copied from Windows land on the Desktop; Files items become shortcuts
  document.addEventListener("DOMContentLoaded", () => {}, { once: true });
  const dsk = document.getElementById("desktop");
  if (dsk) {
    dsk.addEventListener("dragover", (e) => { if (EX.drag || (e.dataTransfer && e.dataTransfer.types.includes("Files"))) e.preventDefault(); });
    dsk.addEventListener("drop", (e) => {
      if (e.target.closest && e.target.closest(".win")) return;
      e.preventDefault();
      if (EX.drag) { const d = EX.drag; EX.drag = null; d.forEach((p) => EX.makeShortcut({ kind: "path", path: p, name: nameOf(p).replace(/\.[^.]+$/, "") || nameOf(p) })); }
      else if (e.dataTransfer.files && e.dataTransfer.files.length) EX.importFiles(e.dataTransfer.files, home() + "/Desktop");
    });
  }

  // Explorer background menu (replaces the simple one in extras.js)
  EX.bgMenu = (x, y, getDir, refresh, startRename) => {
    const items = [
      { label: "New ▸", run: () => setTimeout(() => showContextMenu(x, y, EX.newItems(getDir, startRename)), 0) },
    ];
    if (EX.clip.paths.length) items.push({ label: "Paste (" + EX.clip.paths.length + ")", run: () => EX.paste(getDir()) });
    if (getDir() === trashDir()) items.push({ label: "Empty Recycle Bin", run: EX.emptyTrash });
    items.push("-", { label: "Open terminal here", run: () => launch("terminal", getDir()) }, { label: "Refresh", run: refresh });
    showContextMenu(x, y, items);
  };
})();
