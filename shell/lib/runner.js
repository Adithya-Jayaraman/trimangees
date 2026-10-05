// ============================================================
// Runner — starts real programs: Windows .exe/.msi through Wine,
// AppImages, Chrome. Also finds the programs Wine installed so they
// can appear in the Start menu.
// ============================================================
'use strict';
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const fsr = require('./fsreal');

let currentUser = null;
let notify = () => {};              // set by main: (channel, payload) => send to the desktop
const setUser = (u) => { currentUser = u; };
const setNotifier = (fn) => { notify = fn; };

const homeReal = (user) => fsr.real('/home/' + (user || currentUser || 'guest'));

// The environment every program gets. HOME is the account's home on TriFS, so
// each person has their own Wine prefix, Chrome profile and settings, saved on the drive.
function envFor(user) {
  const home = homeReal(user);
  return {
    ...process.env,
    HOME: home, USER: user || 'guest', LOGNAME: user || 'guest',
    XDG_DATA_HOME: path.join(home, '.local/share'),
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
    WINEPREFIX: path.join(home, '.wine'),
    WINEDEBUG: process.env.WINEDEBUG || '-all',
    DISPLAY: process.env.DISPLAY || ':0',
    TERM: 'dumb', NO_COLOR: '1',
  };
}
function ensureDirs(env) {
  for (const d of [env.XDG_DATA_HOME, env.XDG_CONFIG_HOME, env.XDG_CACHE_HOME, path.join(env.HOME, '.cache/trimangees')]) {
    try { fs.mkdirSync(d, { recursive: true }); } catch {}
  }
}

const which = (bin) => {
  for (const d of (process.env.PATH || '/usr/bin:/bin').split(':')) {
    try { fs.accessSync(path.join(d, bin), fs.constants.X_OK); return path.join(d, bin); } catch {}
  }
  return null;
};

// ── what kind of program is this file? ───────────────────────
function kindOf(file) {
  const ext = (file.split('.').pop() || '').toLowerCase();
  if (['exe', 'com', 'msi', 'bat', 'cmd', 'lnk'].includes(ext)) return 'wine';
  if (ext === 'appimage') return 'appimage';
  return null;
}

// ── first time per account: create the Windows environment ───
const prefixState = new Map();      // user -> 'preparing' | 'ready'
function prefixReady(user) {
  return fs.existsSync(path.join(homeReal(user), '.wine', 'system.reg'));
}
function preparePrefix(user) {
  user = user || currentUser;
  if (prefixState.get(user) === 'ready' || prefixReady(user)) { prefixState.set(user, 'ready'); return Promise.resolve(true); }
  if (prefixState.get(user) && typeof prefixState.get(user).then === 'function') return prefixState.get(user);
  if (!which('wine')) return Promise.resolve(false);
  const env = envFor(user); ensureDirs(env);
  notify('wine:state', { state: 'preparing', user });
  const p = new Promise((resolve) => {
    const child = spawn('wineboot', ['-u'], { env, stdio: 'ignore' });
    const t = setTimeout(() => { try { child.kill(); } catch {} }, 5 * 60 * 1000);
    child.on('error', () => { clearTimeout(t); resolve(false); });
    child.on('close', () => {
      clearTimeout(t);
      const ok = prefixReady(user);
      prefixState.set(user, ok ? 'ready' : undefined);
      notify('wine:state', { state: ok ? 'ready' : 'failed', user });
      resolve(ok);
    });
  });
  prefixState.set(user, p);
  return p;
}

function logFile(env, name) {
  try { return fs.openSync(path.join(env.HOME, '.cache/trimangees', name), 'a'); } catch { return 'ignore'; }
}

function launch(cmd, args, opts, label) {
  const env = opts.env;
  const out = logFile(env, 'programs.log');
  let child;
  try {
    child = spawn(cmd, args, { cwd: opts.cwd || env.HOME, env, detached: true, stdio: ['ignore', out, out] });
  } catch (e) { return { ok: false, error: e.message }; }
  const started = Date.now();
  child.on('error', (e) => notify('run:exit', { label, ok: false, error: e.message }));
  child.on('exit', (code) => {
    // A program that closes immediately with an error is worth telling the user about.
    if (code && Date.now() - started < 8000) notify('run:exit', { label, ok: false, code });
  });
  child.unref();
  return { ok: true, pid: child.pid };
}

// ── run a file that lives on TriFS (virtual path) ────────────
async function runFile(vpath, user) {
  user = user || currentUser;
  const file = fsr.real(vpath);
  if (!fs.existsSync(file)) return { ok: false, error: 'no such file' };
  const kind = kindOf(file);
  const label = path.basename(file);
  const env = envFor(user); ensureDirs(env);
  const cwd = path.dirname(file);

  if (kind === 'wine') {
    if (!which('wine')) return { ok: false, error: 'Wine is not installed in this build' };
    await preparePrefix(user);
    const ext = file.split('.').pop().toLowerCase();
    let args;
    if (ext === 'msi') args = ['msiexec', '/i', file];
    else if (ext === 'bat' || ext === 'cmd') args = ['cmd', '/c', file];
    else if (ext === 'lnk') args = ['start', '/unix', file];
    else args = [file];
    notify('run:start', { label, kind });
    return launch('wine', args, { env, cwd }, label);
  }
  if (kind === 'appimage') {
    try { fs.chmodSync(file, 0o755); } catch {}
    notify('run:start', { label, kind });
    return launch(file, [], { env, cwd }, label);
  }
  return { ok: false, error: "I don't know how to run this kind of file" };
}

// Run a bundled Wine tool (winecfg, explorer, uninstaller, notepad...)
async function runWineTool(args, user) {
  user = user || currentUser;
  if (!which('wine')) return { ok: false, error: 'Wine is not installed in this build' };
  const env = envFor(user); ensureDirs(env);
  await preparePrefix(user);
  notify('run:start', { label: args[0], kind: 'wine' });
  return launch('wine', args, { env }, args[0]);
}

// ── Google Chrome (real browser, signed-in Google works) ─────
function chromeBin() { return which('google-chrome-stable') || which('google-chrome') || which('chromium') || null; }
function runChrome(url, user) {
  const bin = chromeBin();
  if (!bin) return { ok: false, error: 'Chrome is not installed in this build' };
  const env = envFor(user || currentUser); ensureDirs(env);
  const dl = path.join(env.HOME, 'Downloads');
  try { fs.mkdirSync(dl, { recursive: true }); } catch {}
  const args = ['--no-first-run', '--no-default-browser-check', '--password-store=basic',
                '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage'];
  if (url) args.push(url);
  notify('run:start', { label: 'Chrome', kind: 'chrome' });
  return launch(bin, args, { env }, 'Chrome');
}

// ── Programs Wine has installed (from its .desktop files) ────
function parseDesktop(file) {
  const out = {}; let inEntry = false;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (line.startsWith('[')) { inEntry = line === '[Desktop Entry]'; continue; }
    if (!inEntry || !line || line.startsWith('#')) continue;
    const i = line.indexOf('='); if (i < 0) continue;
    const k = line.slice(0, i), v = line.slice(i + 1);
    if (!(k in out)) out[k] = v;
  }
  return out;
}
const unescapeDesktop = (s) => s.replace(/\\\\/g, '\\').replace(/\\s/g, ' ');
const SKIP_NAME = /(^|\s)(uninstall|uninstaller|readme|release notes|manual|documentation|licen[cs]e|help|website|visit|mono|gecko)(\s|$)/i;

function walk(dir, depth = 0, acc = []) {
  let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && depth < 6) walk(p, depth + 1, acc);
    else if (e.isFile() && e.name.endsWith('.desktop')) acc.push(p);
  }
  return acc;
}
function findIcon(env, name) {
  if (!name) return null;
  const base = path.join(env.XDG_DATA_HOME, 'icons', 'hicolor');
  let sizes = []; try { sizes = fs.readdirSync(base); } catch { return null; }
  sizes.sort((a, b) => (parseInt(b, 10) || 0) - (parseInt(a, 10) || 0));
  for (const s of sizes) {
    const p = path.join(base, s, 'apps', name + '.png');
    if (fs.existsSync(p)) return p;
  }
  return null;
}
const iconCache = new Map();
function iconData(file) {
  if (!file) return null;
  try {
    const m = fs.statSync(file).mtimeMs;
    const c = iconCache.get(file);
    if (c && c.m === m) return c.d;
    const d = 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
    iconCache.set(file, { m, d }); return d;
  } catch { return null; }
}

function listWineApps(user) {
  user = user || currentUser;
  const env = envFor(user);
  const dir = path.join(env.XDG_DATA_HOME, 'applications', 'wine');
  const apps = [];
  for (const f of walk(dir)) {
    let d; try { d = parseDesktop(f); } catch { continue; }
    if (d.Type && d.Type !== 'Application') continue;
    if (d.NoDisplay === 'true' || !d.Name || !d.Exec) continue;
    if (SKIP_NAME.test(d.Name)) continue;
    apps.push({
      id: 'wine-' + path.relative(dir, f).replace(/[^a-z0-9]+/gi, '-').toLowerCase(),
      name: d.Name, desktopFile: path.relative(dir, f),
      icon: iconData(findIcon(env, d.Icon)),
      category: 'Windows programs',
    });
  }
  apps.sort((a, b) => a.name.localeCompare(b.name));
  return apps;
}

async function runWineApp(desktopFile, user) {
  user = user || currentUser;
  const env = envFor(user); ensureDirs(env);
  const f = path.join(env.XDG_DATA_HOME, 'applications', 'wine', desktopFile);
  if (!f.startsWith(path.join(env.XDG_DATA_HOME, 'applications', 'wine'))) return { ok: false, error: 'bad path' };
  let d; try { d = parseDesktop(f); } catch { return { ok: false, error: 'that program is gone' }; }
  const exec = unescapeDesktop(d.Exec).replace(/%[a-zA-Z]/g, '').trim();
  await preparePrefix(user);
  notify('run:start', { label: d.Name, kind: 'wine' });
  return launch('/bin/sh', ['-c', exec], { env, cwd: d.Path || env.HOME }, d.Name);
}

// ── Programs the user dropped into /Applications ─────────────
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'app';
const PALETTE = ['#4a8af0', '#3cc850', '#f07830', '#c85ae0', '#f0c020', '#f04a6e', '#3cc8c8', '#8c6cf0', '#e0a030'];
const colorFor = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; };
const pretty = (f) => f.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim() || 'App';

function listLocalApps() {
  const dir = fsr.real('/Applications');
  const apps = [];
  let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return apps; }
  for (const e of ents) {
    if (e.name.startsWith('.') || /^readme/i.test(e.name)) continue;
    const full = path.join(dir, e.name);
    const vpath = '/Applications/' + e.name;
    const ext = (e.name.split('.').pop() || '').toLowerCase();
    const stem = e.name.replace(/\.[^.]+$/, '');
    let icon = null;
    for (const ie of ['png', 'jpg', 'svg']) {
      const ip = path.join(dir, stem + '.' + ie);
      if (fs.existsSync(ip)) {
        try { icon = `data:image/${ie === 'svg' ? 'svg+xml' : ie};base64,` + fs.readFileSync(ip).toString('base64'); } catch {}
        break;
      }
    }
    if (e.isFile() && ['html', 'htm'].includes(ext)) {
      apps.push({ id: 'local-' + slug(stem), name: pretty(e.name), kind: 'html', path: vpath, url: pathToFileURL(full).href, color: colorFor(stem), icon });
    } else if (e.isFile() && kindOf(e.name)) {
      apps.push({ id: 'local-' + slug(stem), name: pretty(e.name), kind: kindOf(e.name), path: vpath, color: colorFor(stem), icon });
    } else if (e.isDirectory() && fs.existsSync(path.join(full, 'index.html'))) {
      let meta = {}; try { meta = JSON.parse(fs.readFileSync(path.join(full, 'app.json'), 'utf8')); } catch {}
      apps.push({ id: 'local-' + slug(e.name), name: meta.name || pretty(e.name), kind: 'html',
                  path: vpath + '/index.html', url: pathToFileURL(path.join(full, 'index.html')).href, color: meta.color || colorFor(e.name), icon });
    }
  }
  return apps;
}

module.exports = { setUser, setNotifier, envFor, which, kindOf, runFile, runWineTool, runChrome, chromeBin,
  preparePrefix, prefixReady, listWineApps, runWineApp, listLocalApps, homeReal };
