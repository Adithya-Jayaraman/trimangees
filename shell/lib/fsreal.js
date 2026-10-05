// ============================================================
// TriFS — the OS's real filesystem layer.
//
// The desktop still speaks "virtual" paths like /home/Adithya/Documents,
// exactly as before. This module maps them onto a real directory tree:
//
//   in the full OS   /            -> /trifs        (the TriFS drive)
//                    /home/...    -> /home/...     (bind-mounted from /trifs/home)
//                    /media,/mnt  -> the real ones (USB sticks, VirtualBox shares)
//   in dev mode      /            -> $TRIFS_ROOT   (a folder, for testing)
//                    /home/...    -> $TRIFS_ROOT/home/...
//
// Everything here is plain node fs on a real disk: nothing is a JSON blob.
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');

const IN_SESSION = process.env.TRIMANGEES_SESSION === '1';
let ROOT = '/trifs';          // where virtual "/" lives
let HOME_ROOT = '/home';      // where virtual "/home" lives
const PASSTHROUGH = ['/media', '/mnt', '/run/media'];

function setRoot(root, homeRoot) {
  ROOT = path.resolve(root);
  HOME_ROOT = path.resolve(homeRoot || path.join(ROOT, 'home'));
}
const getRoot = () => ROOT;
const getHomeRoot = () => HOME_ROOT;

// POSIX-normalise a user-supplied path: always absolute, no "..", no "\".
function norm(p) {
  p = String(p == null ? '/' : p).replace(/\\/g, '/');
  const segs = [];
  for (const part of p.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { segs.pop(); continue; }
    segs.push(part);
  }
  return '/' + segs.join('/');
}

// virtual path -> real path on the machine
function real(v) {
  v = norm(v);
  if (v === '/') return ROOT;
  if (v === '/home' || v.startsWith('/home/')) return HOME_ROOT + v.slice(5);
  if (IN_SESSION) {
    for (const pre of PASSTHROUGH) if (v === pre || v.startsWith(pre + '/')) return v;
  }
  return ROOT + v;
}

// real path -> virtual path (for files picked in a native file dialog)
function virt(p) {
  p = path.resolve(String(p));
  if (p === HOME_ROOT || p.startsWith(HOME_ROOT + '/')) return '/home' + p.slice(HOME_ROOT.length);
  if (p === ROOT || p.startsWith(ROOT + '/')) return norm(p.slice(ROOT.length) || '/');
  return p;
}

const homePath = (user) => (user ? '/home/' + user : '/home');

function resolveTarget(base, target, user) {
  let p;
  if (!target || target === '~') p = homePath(user);
  else if (target.startsWith('~/')) p = homePath(user) + '/' + target.slice(2);
  else if (target.startsWith('/')) p = target;
  else p = (base || '/') + '/' + target;
  return norm(p);
}

const HIDE_ALWAYS = new Set(['lost+found']);
const PROTECTED = (v) => {
  v = norm(v);
  if (v === '/' || v === '/home' || v === '/Applications' || v === '/shared' || v === '/system') return true;
  return /^\/home\/[^/]+$/.test(v);            // a whole account's home
};

function parentOf(v) {
  v = norm(v);
  if (v === '/') return '/';
  return '/' + v.split('/').filter(Boolean).slice(0, -1).join('/');
}

function list(dir, opts = {}) {
  const v = norm(dir || '/');
  const r = real(v);
  let st;
  try { st = fs.statSync(r); } catch { return { ok: false, error: 'no such directory' }; }
  if (!st.isDirectory()) return { ok: false, error: 'not a directory' };
  let names;
  try { names = fs.readdirSync(r); } catch (e) { return { ok: false, error: e.code === 'EACCES' ? 'permission denied' : e.message }; }
  const entries = [];
  for (const name of names) {
    if (HIDE_ALWAYS.has(name)) continue;
    if (name.startsWith('.') && !opts.hidden) continue;
    let s;
    try { s = fs.statSync(path.join(r, name)); }          // follows links
    catch { try { s = fs.lstatSync(path.join(r, name)); } catch { continue; } }
    entries.push({ name, isDir: s.isDirectory(), size: s.isDirectory() ? 0 : s.size, mtime: s.mtimeMs });
  }
  entries.sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  return { ok: true, dir: v, entries, parent: parentOf(v) };
}

function resolveDir(base, target, user) {
  const v = resolveTarget(base, target, user);
  let s;
  try { s = fs.statSync(real(v)); } catch { return { ok: false, error: 'no such directory' }; }
  if (!s.isDirectory()) return { ok: false, error: 'not a directory' };
  return { ok: true, path: v };
}

function readText(file, max = 2 * 1024 * 1024) {
  try {
    const r = real(file); const s = fs.statSync(r);
    if (!s.isFile()) return { ok: false, error: 'no such file' };
    if (s.size > max) return { ok: false, error: 'file larger than ' + Math.round(max / 1048576) + ' MB' };
    return { ok: true, content: fs.readFileSync(r, 'utf8') };
  } catch { return { ok: false, error: 'no such file' }; }
}
function readB64(file, max = 40 * 1024 * 1024) {
  try {
    const r = real(file); const s = fs.statSync(r);
    if (!s.isFile()) return { ok: false, error: 'no such file' };
    if (s.size > max) return { ok: false, error: 'file larger than ' + Math.round(max / 1048576) + ' MB' };
    return { ok: true, b64: fs.readFileSync(r).toString('base64') };
  } catch { return { ok: false, error: 'no such file' }; }
}
function writeFile(file, data, enc) {
  try {
    const r = real(file);
    try { if (fs.statSync(r).isDirectory()) return { ok: false, error: 'is a directory' }; } catch {}
    if (!fs.existsSync(path.dirname(r))) return { ok: false, error: 'no such directory' };
    fs.writeFileSync(r, enc === 'base64' ? Buffer.from(String(data), 'base64') : String(data));
    return { ok: true };
  } catch (e) { return { ok: false, error: e.code === 'EACCES' ? 'permission denied' : e.message }; }
}
function mkdir(dir) {
  try {
    const r = real(dir);
    if (fs.existsSync(r)) return { ok: false, error: 'already exists' };
    if (!fs.existsSync(path.dirname(r))) return { ok: false, error: 'no such directory' };
    fs.mkdirSync(r); return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}
function rename(from, to) {
  try {
    const a = real(from), b = real(to);
    if (!fs.existsSync(a)) return { ok: false, error: 'no such file' };
    if (fs.existsSync(b)) return { ok: false, error: 'a file with that name exists' };
    if (!fs.existsSync(path.dirname(b))) return { ok: false, error: 'no such directory' };
    try { fs.renameSync(a, b); }
    catch (e) {
      if (e.code !== 'EXDEV') throw e;                      // different disk: copy then delete
      fs.cpSync(a, b, { recursive: true }); fs.rmSync(a, { recursive: true, force: true });
    }
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}
function remove(target) {
  try {
    if (PROTECTED(target)) return { ok: false, error: 'cannot delete a system folder' };
    const r = real(target);
    if (!fs.existsSync(r) && !isLink(r)) return { ok: false, error: 'no such file' };
    fs.rmSync(r, { recursive: true, force: true }); return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}
function isLink(p) { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } }
function copy(from, to) {
  try {
    const a = real(from); let b = real(to);
    if (!fs.existsSync(a)) return { ok: false, error: 'no such file' };
    try { if (fs.statSync(b).isDirectory()) b = path.join(b, path.basename(a)); } catch {}
    if (fs.existsSync(b)) return { ok: false, error: 'already exists' };
    fs.cpSync(a, b, { recursive: true }); return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}
function exists(v) { try { fs.statSync(real(v)); return true; } catch { return false; } }
function isDir(v) { try { return fs.statSync(real(v)).isDirectory(); } catch { return false; } }

// Pick a name that doesn't clash: "file.txt" -> "file (2).txt"
function uniqueChild(dirV, filename) {
  const dir = real(dirV);
  if (!fs.existsSync(path.join(dir, filename))) return norm(dirV + '/' + filename);
  const dot = filename.lastIndexOf('.');
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : '';
  let i = 2;
  while (fs.existsSync(path.join(dir, `${stem} (${i})${ext}`))) i++;
  return norm(dirV + '/' + `${stem} (${i})${ext}`);
}

const HOME_SUBDIRS = ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Music', 'Videos'];
function mk(p) { try { fs.mkdirSync(p, { recursive: true }); } catch {} }

// The shape of the disk: /home /Applications /shared /system
function ensureLayout() {
  mk(HOME_ROOT);
  for (const d of ['Applications', 'shared', 'system']) mk(path.join(ROOT, d));
  const readme = path.join(ROOT, 'Applications', 'README.txt');
  if (!fs.existsSync(readme)) {
    try {
      fs.writeFileSync(readme,
        'Drop apps in here and they show up in the Start menu.\n\n' +
        '  .html        opens in its own window\n' +
        '  .exe .msi    runs with Wine (Windows programs)\n' +
        '  .AppImage    runs directly\n\n' +
        'You can also double-click an installer anywhere (for example in Downloads)\n' +
        'and the program it installs will appear in the Start menu by itself.\n');
    } catch {}
  }
}

function ensureHome(user) {
  ensureLayout();
  if (!user) return '/home';
  const h = path.join(HOME_ROOT, user);
  mk(h);
  for (const sub of HOME_SUBDIRS) mk(path.join(h, sub));
  const w = path.join(h, 'Welcome.txt');
  if (!fs.existsSync(w)) {
    try {
      fs.writeFileSync(w,
        `Welcome to TrimangeesOS, ${user}!\n\n` +
        'This is your home folder on the TriFS drive. Everything here is a real file\n' +
        'on a real filesystem: it is still here after a restart.\n\n' +
        'Download a program from the Browser, then double-click its .exe in Downloads\n' +
        'to install it. Windows programs run through Wine.\n\n' +
        '— forged in the Central Storm ⚡\n');
    } catch {}
  }
  return '/home/' + user;
}

// ── Disk numbers for Settings -> System ──────────────────────
function usage() {
  try {
    const s = fs.statfsSync(ROOT);
    const total = Number(s.blocks) * Number(s.bsize);
    const free = Number(s.bavail) * Number(s.bsize);
    return { total, free, used: total - free };
  } catch { return { total: 0, free: 0, used: 0 }; }
}

// ── Cloud sync of an account's home (Firebase) ───────────────
// The desktop keeps a *small* copy of each home in the cloud. With a
// real disk we only mirror ordinary files (no dotfiles, so never the
// Wine prefix), cap the size, and only ever ADD / UPDATE — importing
// never deletes anything.
const TEXT_EXT = new Set(['txt','md','csv','tsv','json','js','ts','html','htm','css','svg','xml',
  'log','yml','yaml','ini','cfg','sh','py','c','cpp','h','tridocs','trisheet','trippt','trimage','trilang']);
function exportHome(user, budget = 1_300_000) {
  const base = real(homePath(user));
  let used = 0, truncated = false;
  const walk = (dir, depth) => {
    const node = { t: 'd', c: {}, m: Date.now() };
    let names = [];
    try { names = fs.readdirSync(dir); } catch { return node; }
    for (const name of names) {
      if (name.startsWith('.') || used > budget) { if (used > budget) truncated = true; continue; }
      const p = path.join(dir, name);
      let s; try { s = fs.lstatSync(p); } catch { continue; }
      if (s.isSymbolicLink()) continue;
      if (s.isDirectory()) { if (depth < 8) node.c[name] = walk(p, depth + 1); continue; }
      if (!s.isFile()) continue;
      if (s.size > 400_000) { truncated = true; continue; }
      const ext = (name.split('.').pop() || '').toLowerCase();
      const buf = fs.readFileSync(p);
      used += buf.length;
      node.c[name] = TEXT_EXT.has(ext)
        ? { t: 'f', data: buf.toString('utf8'), enc: 'utf8', m: s.mtimeMs }
        : { t: 'f', data: buf.toString('base64'), enc: 'base64', m: s.mtimeMs };
    }
    return node;
  };
  try { if (!fs.statSync(base).isDirectory()) return null; } catch { return null; }
  const root = walk(base, 0);
  return { root, truncated };
}
function importHome(user, node) {
  if (!node || node.t !== 'd') return false;
  const base = real(homePath(user));
  mk(base);
  const put = (dir, n) => {
    mk(dir);
    for (const [name, child] of Object.entries(n.c || {})) {
      if (!name || name.includes('/') || name === '..' || name.startsWith('.')) continue;
      const p = path.join(dir, name);
      if (child.t === 'd') { put(p, child); continue; }
      if (child.t !== 'f') continue;
      let write = true;
      try { const s = fs.statSync(p); write = (child.m || 0) > s.mtimeMs + 1000; } catch {}
      if (!write) continue;
      try {
        fs.writeFileSync(p, child.enc === 'base64' ? Buffer.from(child.data, 'base64') : String(child.data));
        if (child.m) { const t = new Date(child.m); fs.utimesSync(p, t, t); }
      } catch {}
    }
  };
  put(base, node);
  return true;
}

module.exports = { IN_SESSION, setRoot, virt, getRoot, getHomeRoot, norm, real, homePath, resolveTarget,
  parentOf, list, resolveDir, readText, readB64, writeFile, mkdir, rename, remove, copy, exists, isDir,
  uniqueChild, ensureLayout, ensureHome, usage, exportHome, importHome, PROTECTED };
