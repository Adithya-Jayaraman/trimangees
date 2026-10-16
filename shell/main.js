// ============================================================
// Trimangees OS — Electron main process  (Linux edition)
//
// This is the "kernel" of the desktop. It runs as the logged-in system
// user inside the TrimangeesOS image and provides:
//   - a REAL filesystem (TriFS, on the TRIMANGEES drive)
//   - a real shell (bash) for the Terminal app
//   - Windows programs (Wine), Chrome, and a list of their windows
//   - power, drive setup, downloads, settings
// ============================================================
const { app, BrowserWindow, ipcMain, shell, screen, session, dialog } = require('electron');
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const fsr = require('./lib/fsreal');
const trifs = require('./lib/trifsdev');
const runner = require('./lib/runner');
const extwin = require('./lib/extwin');

const inSession = process.env.TRIMANGEES_SESSION === '1';
let win = null;
const APP_ICON = path.join(__dirname, 'icon.ico');
const SHELL_TITLE = extwin.SHELL_TITLE;

// ── Chromium switches (before the app is ready) ──────────────
if (inSession) {
  app.commandLine.appendSwitch('no-sandbox');                 // live system, single trusted user
  if (process.env.TRIMANGEES_GPU !== '1') app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-dev-shm-usage');
  app.commandLine.appendSwitch('password-store', 'basic');
}

// ── Where does TriFS live, and is it mounted? ────────────────
// The helper mounts the drive at /trifs before the desktop starts. If it
// is mounted, ALL of this app's data (settings, cookies, browser profile)
// goes there too, so it survives reboots.
let trifsStatus = trifs.statusSync();
if (inSession) {
  fsr.setRoot('/trifs', '/home');
  if (trifsStatus && trifsStatus.mounted) {
    try {
      const ud = '/trifs/system/electron';
      fs.mkdirSync(ud, { recursive: true });
      app.setPath('userData', ud);
    } catch {}
  }
} else {
  const base = process.env.TRIFS_ROOT || path.join(app.getPath('userData'), 'trifs-dev');
  fsr.setRoot(base);
  if (process.env.TRIFS_ROOT) {
    try { fs.mkdirSync(path.join(base, 'system', 'electron'), { recursive: true }); app.setPath('userData', path.join(base, 'system', 'electron')); } catch {}
  }
}
fsr.ensureLayout();
const isMounted = () => !!(trifsStatus && trifsStatus.mounted);

// ── Config persistence ───────────────────────────────────────
const cfgFile = () => path.join(app.getPath('userData'), 'trimangees-config.json');
function loadConfig() { try { return JSON.parse(fs.readFileSync(cfgFile(), 'utf8')); } catch { return {}; } }
function saveConfig(cfg) { try { fs.mkdirSync(path.dirname(cfgFile()), { recursive: true }); fs.writeFileSync(cfgFile(), JSON.stringify(cfg, null, 2)); } catch {} }

// ── Tell the desktop things ──────────────────────────────────
const send = (channel, payload) => { try { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); } catch {} };
runner.setNotifier(send);

let fsChangedTimer = null;
function fsChanged() {
  clearTimeout(fsChangedTimer);
  fsChangedTimer = setTimeout(() => send('fs:changed'), 600);
}

// ── Window ───────────────────────────────────────────────────
function createWindow() {
  const opts = {
    width: 1280, height: 760, minWidth: 940, minHeight: 580,
    backgroundColor: '#0a0a14', autoHideMenuBar: true,
    title: SHELL_TITLE, icon: APP_ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
      webviewTag: true,       // the Browser app embeds pages
      webSecurity: false,     // the desktop only loads LOCAL files; lets it hand files to suite apps
    },
    show: false,
  };
  if (inSession) {
    // NOT fullscreen/kiosk: a fullscreen window would sit above every program.
    // This is a borderless window the size of the screen that the window manager
    // keeps at the BOTTOM, so Windows programs and Chrome open on top of it.
    const { bounds } = screen.getPrimaryDisplay();
    Object.assign(opts, { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
      frame: false, resizable: true, movable: false, fullscreenable: false, skipTaskbar: true,
      minWidth: 0, minHeight: 0 });
  }
  win = new BrowserWindow(opts);
  win.on('page-title-updated', (e) => e.preventDefault());    // keep the title the WM rule matches
  win.once('ready-to-show', () => {
    win.show();
    if (inSession) {
      extwin.pinShellBelow();
      setTimeout(extwin.pinShellBelow, 1200);
      setTimeout(extwin.pinShellBelow, 4000);
    }
  });
  if (inSession) {
    const refit = () => { try { win.setBounds(screen.getPrimaryDisplay().bounds); extwin.pinShellBelow(); } catch (e) {} };
    screen.on('display-metrics-changed', refit);
    screen.on('display-added', refit);
    // The VM window can be resized at any time (VirtualBox full screen etc.): follow the real X screen size.
    let lastDim = '';
    setInterval(() => {
      require('child_process').exec('xdpyinfo 2>/dev/null | grep dimensions', { env: process.env, timeout: 3000 }, (err, out) => {
        const m = /(\d+)x(\d+) pixels/.exec(out || ''); if (!m) return;
        const W = +m[1], H = +m[2], cur = win.getBounds();
        if (lastDim === W + 'x' + H && cur.width === W && cur.height === H) return;
        lastDim = W + 'x' + H;
        try { win.setBounds({ x: 0, y: 0, width: W, height: H }); } catch (e) {}
        if (cur.width !== W || cur.height !== H) {
          require('child_process').exec(`wmctrl -r "TrimangeesOS Shell" -e 0,0,0,${W},${H}`, () => {});
        }
        extwin.pinShellBelow();
      });
    }, 1500);
  }
  win.loadFile('os.html');
  setupDownloads(session.defaultSession);
  extwin.start((list) => send('ext:windows', list));
}

app.whenReady().then(() => {
  createWindow();

  // Spoof the User-Agent so Google/YouTube serve the full site to the browser webviews.
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['User-Agent'] =
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    callback({ requestHeaders: details.requestHeaders });
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _p, callback) => callback(true));
  session.defaultSession.setPermissionCheckHandler(() => true);
});
app.on('window-all-closed', () => app.quit());

app.on('web-contents-created', (e, wc) => {
  if (wc.getType() === 'webview') {
    wc.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('mailto:') || url.startsWith('tel:')) shell.openExternal(url);
      else send('brw:newtab', url);
      return { action: 'deny' };
    });
  }
});
app.on('certificate-error', (event, _wc, _url, _err, _cert, callback) => { event.preventDefault(); callback(true); });

// ── Trimangees Browser — the full tabbed browser, in its own window ──
let browserWin = null;
function sendBrowserState() {
  const alive = browserWin && !browserWin.isDestroyed();
  send('browser:state', { open: !!alive, focused: !!(alive && browserWin.isFocused() && !browserWin.isMinimized()) });
}
function openBrowser(url) {
  if (browserWin && !browserWin.isDestroyed()) {
    browserWin.show(); browserWin.focus();
    if (url) browserWin.webContents.executeJavaScript(`typeof newTab === 'function' && newTab(${JSON.stringify(url)})`).catch(() => {});
    return;
  }
  const opts = {
    width: 1300, height: 800, minWidth: 800, minHeight: 600,
    frame: false, titleBarStyle: 'hidden', autoHideMenuBar: true,
    backgroundColor: '#0a0a0f', show: false, icon: APP_ICON, title: 'Trimangees Browser',
    webPreferences: {
      webviewTag: true, nodeIntegration: false, contextIsolation: true,
      preload: path.join(__dirname, 'browser', 'browser-preload.js'),
    },
  };
  if (inSession) {
    const { workArea } = screen.getPrimaryDisplay();
    Object.assign(opts, { x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height });
  }
  browserWin = new BrowserWindow(opts);
  browserWin.once('ready-to-show', () => {
    browserWin.show();
    if (url) browserWin.webContents.executeJavaScript(`typeof newTab === 'function' && newTab(${JSON.stringify(url)})`).catch(() => {});
  });
  browserWin.loadFile(path.join(__dirname, 'browser', 'browser.html'));
  for (const ev of ['focus', 'blur', 'minimize', 'restore', 'show']) browserWin.on(ev, sendBrowserState);
  browserWin.on('closed', () => { browserWin = null; sendBrowserState(); });
  browserWin.webContents.setWindowOpenHandler(({ url: u }) => {
    if (u.startsWith('mailto:') || u.startsWith('tel:')) { shell.openExternal(u); return { action: 'deny' }; }
    browserWin.webContents.executeJavaScript(`typeof newTab === 'function' && newTab(${JSON.stringify(u)})`).catch(() => {});
    return { action: 'deny' };
  });
}
ipcMain.handle('browser:open', (e, { url } = {}) => { openBrowser(url); return true; });
ipcMain.handle('browser:toggle', () => {
  const alive = browserWin && !browserWin.isDestroyed();
  if (alive && browserWin.isFocused() && !browserWin.isMinimized()) browserWin.minimize();
  else openBrowser();
  sendBrowserState();
  return true;
});
ipcMain.on('win-minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize());
ipcMain.on('win-maximize', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w) w.isMaximized() ? w.unmaximize() : w.maximize();
});
ipcMain.on('win-close', (e) => BrowserWindow.fromWebContents(e.sender)?.close());

// ============================================================
// Who is logged in
// ============================================================
let currentUser = null;
ipcMain.handle('session:setUser', (e, { name } = {}) => {
  currentUser = name || null;
  runner.setUser(currentUser);
  if (name) {
    fsr.ensureHome(name);
    // Get the Windows environment ready in the background so the first .exe starts fast.
    if (isMounted() && runner.which('wine')) setTimeout(() => runner.preparePrefix(name).catch(() => {}), 6000);
  }
  return true;
});
ipcMain.handle('user:home', (e, { name }) => { currentUser = name || currentUser; runner.setUser(currentUser); return fsr.ensureHome(name); });

// ============================================================
// Files — a real filesystem (TriFS)
// ============================================================
ipcMain.handle('fs:list', (e, { dir, hidden } = {}) => fsr.list(dir, { hidden }));
ipcMain.handle('fs:resolveDir', (e, { base, target }) => fsr.resolveDir(base, target, currentUser));
ipcMain.handle('fs:read', (e, { file }) => fsr.readText(file));
ipcMain.handle('fs:readB64', (e, { file }) => fsr.readB64(file));
ipcMain.handle('fs:write', (e, { file, content }) => { const r = fsr.writeFile(file, content); if (r.ok) fsChanged(); return r; });
ipcMain.handle('fs:writeB64', (e, { file, b64 }) => { const r = fsr.writeFile(file, b64, 'base64'); if (r.ok) fsChanged(); return r; });
ipcMain.handle('fs:mkdir', (e, { dir }) => { const r = fsr.mkdir(dir); if (r.ok) fsChanged(); return r; });
ipcMain.handle('fs:rename', (e, { from, to }) => { const r = fsr.rename(from, to); if (r.ok) fsChanged(); return r; });
ipcMain.handle('fs:delete', (e, { target }) => { const r = fsr.remove(target); if (r.ok) fsChanged(); return r; });
ipcMain.handle('fs:copy', (e, { from, to }) => { const r = fsr.copy(from, to); if (r.ok) fsChanged(); return r; });
ipcMain.handle('fs:exists', (e, { target }) => fsr.exists(target));
ipcMain.handle('fs:home', () => '/');
ipcMain.handle('fs:toVirtual', (e, { p }) => fsr.virt(p));
ipcMain.handle('fs:open', (e, { target }) => runner.runFile(target, currentUser));

// Disk numbers + cloud-sync helpers
ipcMain.handle('fs:stat', () => ({ ...fsr.usage(), mounted: isMounted(), root: fsr.getRoot(), status: trifsStatus }));
ipcMain.handle('fs:exportHome', (e, { user } = {}) => fsr.exportHome(user || currentUser));
ipcMain.handle('fs:importHome', (e, { user, root } = {}) => ({ ok: fsr.importHome(user || currentUser, root) }));
ipcMain.handle('fs:reset', () => {
  // Erase this account's home folder contents (keeps the account itself)
  try {
    const h = fsr.real('/home/' + currentUser);
    for (const n of fs.readdirSync(h)) fs.rmSync(path.join(h, n), { recursive: true, force: true });
    fsr.ensureHome(currentUser); fsChanged();
    return { ok: true };
  } catch (err) { return { ok: false, error: err.message }; }
});
// Backup / restore this account's home as a .tgz anywhere the user picks
ipcMain.handle('fs:backup', async () => {
  try {
    if (!currentUser) return { ok: false, error: 'nobody is signed in' };
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Back up my home folder', defaultPath: path.join(fsr.real('/home/' + currentUser), 'Documents', `${currentUser}-backup.tgz`),
      filters: [{ name: 'Backup', extensions: ['tgz'] }] });
    if (canceled || !filePath) return { ok: false, canceled: true };
    await new Promise((res, rej) => execFile('tar', ['-czf', filePath, '--exclude=./.wine', '--exclude=./.cache', '-C', fsr.real('/home/' + currentUser), '.'],
      { maxBuffer: 1 << 20 }, (er) => er ? rej(er) : res()));
    return { ok: true, path: filePath };
  } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('fs:restore', async () => {
  try {
    if (!currentUser) return { ok: false, error: 'nobody is signed in' };
    const { canceled, filePaths } = await dialog.showOpenDialog(win, { title: 'Restore a backup', properties: ['openFile'],
      filters: [{ name: 'Backup', extensions: ['tgz', 'tar.gz'] }] });
    if (canceled || !filePaths || !filePaths[0]) return { ok: false, canceled: true };
    await new Promise((res, rej) => execFile('tar', ['-xzf', filePaths[0], '-C', fsr.real('/home/' + currentUser)], (er) => er ? rej(er) : res()));
    fsChanged();
    return { ok: true };
  } catch (err) { return { ok: false, error: err.message }; }
});

// ============================================================
// Terminal — real bash on the real filesystem
// ============================================================
const ANSI = /\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07]*\x07/g;
const termProcs = new Map();
ipcMain.handle('term:run', (e, { id, cmd, cwd }) => {
  const sendLine = (line, stream = 'out') => send('term:out', { id, line, stream });
  const done = (code = 0) => { termProcs.delete(id); send('term:done', { id, code }); };
  const env = runner.envFor(currentUser || 'guest');
  const workdir = fsr.real(cwd || '/home/' + (currentUser || ''));
  let child;
  try {
    child = spawn('/bin/bash', ['-c', cmd], { cwd: fs.existsSync(workdir) ? workdir : env.HOME, env,
      detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) { setImmediate(() => { sendLine('error: ' + err.message, 'err'); done(1); }); return { ok: true }; }
  termProcs.set(id, child);
  const pump = (stream, kind) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d.toString('utf8').replace(ANSI, '').replace(/\r(?!\n)/g, '\n');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { sendLine(buf.slice(0, i), kind); buf = buf.slice(i + 1); }
    });
    stream.on('end', () => { if (buf) sendLine(buf, kind); });
  };
  pump(child.stdout, 'out'); pump(child.stderr, 'err');
  child.on('error', (err) => { sendLine('error: ' + err.message, 'err'); done(1); });
  child.on('close', (code, sig) => { fsChanged(); done(sig ? -1 : (code || 0)); });
  return { ok: true };
});
ipcMain.handle('term:stdin', (e, { id, text } = {}) => {
  const c = termProcs.get(id);
  try { if (c && c.stdin && !c.stdin.destroyed) { c.stdin.write(text); return { ok: true }; } } catch {}
  return { ok: false };
});
// quick one-shot command for Settings pages (network, sound, keyboard...)
ipcMain.handle('sh:exec', (e, { cmd, timeout } = {}) => new Promise((resolve) => {
  const env = runner.envFor(currentUser || 'guest');
  require('child_process').exec(String(cmd || ''), { env, timeout: timeout || 15000, maxBuffer: 4 * 1024 * 1024, shell: '/bin/bash' },
    (err, out, errout) => resolve({ ok: !err, code: err ? (err.code || 1) : 0, out: out || '', err: errout || '' }));
}));
// a real terminal window (xterm) for full-screen / interactive programs
ipcMain.handle('sys:xterm', () => {
  try {
    const env = runner.envFor(currentUser || 'guest');
    const c = spawn('xterm', ['-fa', 'DejaVu Sans Mono', '-fs', '12', '-bg', '#0d1117', '-fg', '#e6edf3', '-title', 'Terminal'],
      { cwd: env.HOME, env, detached: true, stdio: 'ignore' });
    c.on('error', () => {}); c.unref();
    return { ok: true };
  } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('net:saveText', async (e, { url, dest } = {}) => {
  try {
    const r = await require('electron').net.fetch(url);
    if (!r.ok) return { ok: false, error: 'HTTP ' + r.status };
    const txt = await r.text();
    return fsr.writeFile(dest, txt, 'utf8') || { ok: true };
  } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('term:kill', (e, { id } = {}) => {
  const c = termProcs.get(id);
  if (c) { try { process.kill(-c.pid, 'SIGTERM'); } catch { try { c.kill(); } catch {} } }
  return { ok: true };
});

// ============================================================
// Downloads — straight into the account's Downloads on TriFS
// ============================================================
const wiredSessions = new WeakSet();
function setupDownloads(sess) {
  if (!sess || wiredSessions.has(sess)) return; wiredSessions.add(sess);
  sess.on('will-download', (event, item) => {
    const filename = (item.getFilename() || 'download').replace(/[\/\\]/g, '_');
    const dlDir = currentUser ? `/home/${currentUser}/Downloads` : '/home';
    try { fs.mkdirSync(fsr.real(dlDir), { recursive: true }); } catch {}
    const vTarget = fsr.uniqueChild(dlDir, filename);
    item.setSavePath(fsr.real(vTarget));
    item.once('done', (e2, state) => {
      if (state === 'completed') { send('fs:downloaded', { name: path.basename(vTarget), path: vTarget }); fsChanged(); }
      else send('fs:downloaded', { name: filename, failed: true });
    });
  });
}
app.on('session-created', (s) => { try { setupDownloads(s); } catch {} });

// ============================================================
// Firebase Storage (listed in the main process to skip CORS)
// ============================================================
ipcMain.handle('storage:list', async (e, { bucket, prefix } = {}) => {
  try {
    const base = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o`;
    const items = []; let pageToken;
    do {
      const params = new URLSearchParams();
      if (prefix) params.set('prefix', prefix);
      if (pageToken) params.set('pageToken', pageToken);
      const r = await fetch(`${base}?${params.toString()}`);
      if (!r.ok) return { ok: false, error: 'storage ' + r.status, items: [] };
      const data = await r.json();
      for (const it of (data.items || [])) items.push(it.name);
      pageToken = data.nextPageToken;
    } while (pageToken);
    return { ok: true, items };
  } catch (err) { return { ok: false, error: err.message, items: [] }; }
});
ipcMain.handle('storage:upload', async (e, { bucket, objectPath, filePath, content, contentType } = {}) => {
  try {
    let body;
    if (filePath) body = fs.readFileSync(filePath);
    else if (typeof content === 'string') body = Buffer.from(content, 'utf8');
    else return { ok: false, error: 'nothing to upload' };
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(objectPath)}`;
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': contentType || 'application/octet-stream' }, body });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, status: r.status, error: (data.error && data.error.message) || ('storage ' + r.status) };
    return { ok: true, name: data.name, size: body.length, token: data.downloadTokens || (data.metadata && data.metadata.firebaseStorageDownloadTokens) };
  } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('storage:delete', async (e, { bucket, objectPath } = {}) => {
  try {
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(objectPath)}`;
    const r = await fetch(url, { method: 'DELETE' });
    if (!r.ok && r.status !== 404) {
      const data = await r.json().catch(() => ({}));
      return { ok: false, status: r.status, error: (data.error && data.error.message) || ('storage ' + r.status) };
    }
    return { ok: true };
  } catch (err) { return { ok: false, error: err.message }; }
});

// ============================================================
// Programs: Windows (Wine), Chrome, local apps, external windows
// ============================================================
ipcMain.handle('apps:local', () => runner.listLocalApps());
ipcMain.handle('apps:wine', () => runner.listWineApps(currentUser));
ipcMain.handle('apps:runWineApp', (e, { file }) => runner.runWineApp(file, currentUser));
ipcMain.handle('apps:runWineTool', (e, { args }) => runner.runWineTool(Array.isArray(args) ? args.map(String) : [String(args)], currentUser));
ipcMain.handle('run:file', (e, { target }) => runner.runFile(target, currentUser));
ipcMain.handle('run:chrome', (e, { url } = {}) => runner.runChrome(url, currentUser));
ipcMain.handle('apps:has', () => ({ wine: !!runner.which('wine'), chrome: !!runner.chromeBin(), flatpak: !!runner.which('flatpak'), xterm: !!runner.which('xterm') }));

ipcMain.handle('ext:list', () => extwin.list());
ipcMain.handle('ext:activate', async (e, { id }) => { await extwin.activate(id); return true; });
ipcMain.handle('ext:minimize', async (e, { id }) => { await extwin.minimize(id); return true; });
ipcMain.handle('ext:close', async (e, { id }) => { await extwin.close(id); return true; });

// ============================================================
// TriFS drive setup (the first-run wizard + Settings -> System)
// ============================================================
ipcMain.handle('trifs:status', async () => { trifsStatus = await trifs.status(); return trifsStatus; });
ipcMain.handle('trifs:scan', () => trifs.scan());
ipcMain.handle('trifs:mount', async () => { trifsStatus = await trifs.mount(); return trifsStatus; });
ipcMain.handle('trifs:format', (e, { disk }) => trifs.format(disk));
ipcMain.handle('trifs:createImg', (e, { part, gb }) => trifs.createImg(part, gb));
ipcMain.handle('trifs:unmount', () => trifs.unmount());
// After the drive is set up the desktop restarts so its settings/profile move onto it.
ipcMain.handle('trifs:restart', () => {
  if (inSession) { setTimeout(() => app.exit(0), 300); }           // the session loop starts it again
  else { app.relaunch(); setTimeout(() => app.exit(0), 300); }
  return true;
});

// ============================================================
// Config + system info + power
// ============================================================

// ============================================================
// Extra kernel features: file helpers, Linux apps, diagnostics,
// backups, updates
// ============================================================
const { exec: cpExec } = require('child_process');
const shq = (t) => "'" + String(t).replace(/'/g, "'\\''") + "'";
const run = (cmd, timeout = 20000) => new Promise((resolve) =>
  cpExec(cmd, { env: runner.envFor(currentUser || 'guest'), timeout, maxBuffer: 16 * 1024 * 1024, shell: '/bin/bash' },
    (err, out, errout) => resolve({ ok: !err, out: out || '', err: errout || '', code: err ? (err.code || 1) : 0 })));
const sysDir = (sub) => { const d = path.join(fsr.real('/system'), sub); try { fs.mkdirSync(d, { recursive: true }); } catch {} return d; };

ipcMain.handle('fs:real', (e, { p }) => fsr.real(p));
ipcMain.handle('fs:realMany', (e, { ps }) => (ps || []).map((p) => fsr.real(p)));
ipcMain.handle('fs:unique', (e, { dir, name }) => fsr.uniqueChild(dir, name));
ipcMain.handle('fs:move', (e, { from, to }) => { const r = fsr.rename(from, to); if (r.ok) fsChanged(); return r; });

ipcMain.handle('apps:linux', () => { try { return runner.listLinuxApps(currentUser); } catch { return []; } });
ipcMain.handle('run:linux', (e, { exec, terminal }) => runner.runLinuxApp(exec, terminal, currentUser));

// a visible terminal window running one command (winetricks, flatpak installs ...)
ipcMain.handle('sys:xtermRun', (e, { cmd, title }) => {
  try {
    const env = runner.envFor(currentUser || 'guest'); env.TERM = 'xterm';
    const c = spawn('xterm', ['-fa', 'DejaVu Sans Mono', '-fs', '11', '-bg', '#0d1117', '-fg', '#e6edf3', '-T', title || 'TrimangeesOS',
      '-e', 'bash', '-c', String(cmd) + '; echo; echo "--- finished. Press Enter to close ---"; read'],
      { cwd: env.HOME, env, detached: true, stdio: 'ignore' });
    c.on('error', () => {}); c.unref(); return { ok: true };
  } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('sys:restartShell', () => { if (inSession) setTimeout(() => app.exit(0), 300); return { ok: true, session: inSession }; });

// ── diagnostics: one block of text the user can paste to me ──
ipcMain.handle('sys:diag', async () => {
  const parts = [
    ['TrimangeesOS', null, `version ${app.getVersion()}  build ${(() => { try { return fs.readFileSync('/etc/trimangees-build', 'utf8').trim(); } catch { return 'dev'; } })()}  session=${inSession}  user=${currentUser}`],
    ['kernel/mem', 'uname -a; cat /proc/cmdline; free -m'],
    ['drives', 'lsblk -o NAME,SIZE,TYPE,FSTYPE,LABEL,MOUNTPOINTS 2>&1; df -h 2>&1 | head -20'],
    ['trifs', 'sudo -n /usr/local/sbin/trifs status 2>&1; cat /run/trimangees/trifs.state 2>/dev/null'],
    ['screen', 'xdpyinfo 2>/dev/null | grep -E "dimensions|version number"; xrandr 2>&1 | head -6; pgrep -a VBoxClient | head'],
    ['network', 'nmcli -t dev 2>&1 | head; ip -brief addr 2>&1'],
    ['wine/chrome', 'wine --version 2>&1; ls /opt/trimangees/wineprefix-template 2>&1 | head -3; google-chrome --version 2>&1 | head -1'],
    ['shell log', 'tail -n 60 /var/log/trimangees/shell.log 2>&1'],
    ['system warnings', 'journalctl -b -p warning --no-pager 2>&1 | tail -n 40'],
    ['programs log', 'tail -n 30 ~/.cache/trimangees/programs.log 2>&1'],
  ];
  let text = `TrimangeesOS diagnostics  ${new Date().toISOString()}\n`;
  for (const [title, cmd, raw] of parts) {
    const r = cmd === null ? { out: raw, err: '' } : await run(cmd, 15000);
    text += `\n===== ${title} =====\n${(r.out + r.err).slice(0, 6000).trim()}\n`;
  }
  try { fs.writeFileSync(path.join(sysDir('logs'), 'diag-' + Date.now() + '.txt'), text); } catch {}
  return { ok: true, text };
});

// ── backups of a home folder (kept on TriFS, last 3) ─────────
ipcMain.handle('backup:run', async (e, { user }) => {
  user = user || currentUser; if (!user) return { ok: false, error: 'no user' };
  const dir = sysDir('backups/' + user);
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const zstd = !!runner.which('zstd');
  const file = path.join(dir, `${stamp}.tar${zstd ? '.zst' : '.gz'}`);
  const home = fsr.real('/home');
  const ex = ['.cache', '.wine', '.local/share/flatpak', '.Trash', '.config/google-chrome/*/Cache', '.config/google-chrome/*/Code Cache']
    .map((x) => `--exclude=${shq(user + '/' + x)}`).join(' ');
  const r = await run(`nice -n 19 tar ${zstd ? '--zstd' : '-z'} -cf ${shq(file)} ${ex} -C ${shq(home)} ${shq(user)} 2>&1`, 20 * 60 * 1000);
  if (!r.ok && !fs.existsSync(file)) return { ok: false, error: r.err || r.out };
  try {   // keep the newest 3
    const all = fs.readdirSync(dir).filter((f) => f.includes('.tar')).sort();
    for (const old of all.slice(0, Math.max(0, all.length - 3))) fs.unlinkSync(path.join(dir, old));
  } catch {}
  return { ok: true, file, size: (() => { try { return fs.statSync(file).size; } catch { return 0; } })() };
});
ipcMain.handle('backup:list', (e, { user }) => {
  const dir = sysDir('backups/' + (user || currentUser));
  try { return fs.readdirSync(dir).filter((f) => f.includes('.tar')).sort().reverse().map((f) => ({ name: f, size: fs.statSync(path.join(dir, f)).size })); } catch { return []; }
});
ipcMain.handle('backup:restore', async (e, { user, name }) => {
  user = user || currentUser;
  const file = path.join(sysDir('backups/' + user), path.basename(name));
  const dest = path.join(fsr.real('/home'), user, 'Restored-' + path.basename(name).split('.')[0]);
  fs.mkdirSync(dest, { recursive: true });
  const r = await run(`tar -xf ${shq(file)} -C ${shq(dest)} 2>&1`, 20 * 60 * 1000);
  fsChanged();
  return r.ok ? { ok: true, dest: fsr.virt ? fsr.virt(dest) : dest } : { ok: false, error: r.err || r.out };
});

// ── update the desktop from a zip file, without a new ISO ────
ipcMain.handle('update:install', async (e, { zip }) => {
  if (!inSession) return { ok: false, error: 'Updates install into the real OS (boot the ISO).' };
  const src = fsr.real(zip);
  const base = fsr.real('/system'), tmp = path.join(base, 'shell-update-tmp'), dest = path.join(base, 'shell-override');
  const r1 = await run(`rm -rf ${shq(tmp)} && mkdir -p ${shq(tmp)} && unzip -q -o ${shq(src)} -d ${shq(tmp)} 2>&1`, 60000);
  if (!r1.ok) return { ok: false, error: 'Could not open that zip. ' + (r1.err || r1.out).slice(0, 200) };
  let root = tmp;                                  // allow the zip to hold a single top folder
  const need = ['main.js', 'os.js', 'os.html', 'preload.js'];
  if (!need.every((f) => fs.existsSync(path.join(root, f)))) {
    const sub = fs.readdirSync(tmp).map((d) => path.join(tmp, d)).find((d) => need.every((f) => fs.existsSync(path.join(d, f))));
    if (!sub) return { ok: false, error: "That zip doesn't look like a TrimangeesOS desktop update." };
    root = sub;
  }
  const chk = await run(`node --check ${shq(path.join(root, 'main.js'))} 2>&1`, 20000).catch(() => ({ ok: true }));
  // TriOS MAX .triupdate files can also carry extra .deb packages (new coding
  // tools, etc.) in a packages/ folder — installed before the shell swap, so
  // TriFS (your files) is never touched either way.
  const pkgDir = path.join(root, 'packages');
  let pkgResult = null;
  if (fs.existsSync(pkgDir)) {
    const debs = fs.readdirSync(pkgDir).filter((f) => f.endsWith('.deb'));
    if (debs.length) {
      const r2 = await run(`sudo -n dpkg -i ${debs.map((f) => shq(path.join(pkgDir, f))).join(' ')} 2>&1; sudo -n apt-get -y -f install 2>&1`, 10 * 60 * 1000);
      pkgResult = { installed: debs, ok: r2.ok };
    }
  }
  // A .triupdate can also carry a system/ folder — the exact same layout as
  // this repo's system/ directory (system/usr/local/sbin/trifs, systemd
  // units, etc.). It's overlaid straight onto the real root filesystem, so a
  // fix to something like the trifs script itself doesn't need a whole new
  // ISO. /usr and /etc are already kept across reboots by the persistence
  // overlay, so this survives too — and it still never touches TriFS/home.
  const sysDir2 = path.join(root, 'system');
  let sysResult = null;
  if (fs.existsSync(sysDir2)) {
    const r3 = await run(
      `sudo -n cp -a ${shq(sysDir2)}/. / 2>&1 && ` +
      `sudo -n chmod +x /usr/local/sbin/trifs 2>/dev/null; ` +
      `sudo -n systemctl daemon-reload 2>&1`, 60000);
    sysResult = { ok: r3.ok, detail: r3.ok ? '' : (r3.err || r3.out).slice(0, 300) };
  }
  await run(`rm -rf ${shq(dest + '.prev')}; [ -d ${shq(dest)} ] && mv ${shq(dest)} ${shq(dest + '.prev')}; mv ${shq(root)} ${shq(dest)}; rm -rf ${shq(tmp)}`, 60000);
  return { ok: true, packages: pkgResult, system: sysResult };
});
ipcMain.handle('update:revert', async () => {
  const base = fsr.real('/system');
  await run(`rm -rf ${shq(path.join(base, 'shell-override'))}`, 30000);
  return { ok: true };
});
ipcMain.handle('update:status', () => {
  const base = fsr.real('/system');
  const has = fs.existsSync(path.join(base, 'shell-override', 'main.js'));
  let ver = '';
  try { ver = JSON.parse(fs.readFileSync(path.join(base, 'shell-override', 'package.json'), 'utf8')).version; } catch {}
  return { override: has, version: ver, running: __dirname, safe: process.env.TRIMANGEES_SAFE === '1' };
});

ipcMain.handle('cfg:get', () => loadConfig());

// ── Lite edition: no app loading from storage, built-in AI tools ─────
const LITE_FLAG = '/etc/trimangees-lite';
let isLite = false;
try { isLite = fs.existsSync(LITE_FLAG) || process.env.TRIMANGEES_LITE === '1'; } catch {}
ipcMain.handle('sys:lite', () => isLite);

// TriOS MAX: every account picks its own drive, independent of the others.
const MAX_FLAG = '/etc/trimangees-max';
let isMax = false;
try { isMax = fs.existsSync(MAX_FLAG) || process.env.TRIMANGEES_MAX === '1'; } catch {}
ipcMain.handle('sys:max', () => isMax);
ipcMain.handle('trifs:userScan', () => trifs.userScan());
ipcMain.handle('trifs:userAssign', (e, { user, dev }) => trifs.userAssign(user, dev));
ipcMain.handle('trifs:userMount', (e, { user }) => trifs.userMount(user));
ipcMain.handle('trifs:userMountAll', () => trifs.userMountAll());
ipcMain.handle('trifs:userStatus', () => trifs.userStatus());
ipcMain.handle('trifs:userUnassign', (e, { user }) => trifs.userUnassign(user));

// ── AI calls go through the main process (keys never touch a renderer
// page that could leak them to a webview; also avoids CORS entirely) ──
const AI_ENDPOINTS = {
  zai:    { url: 'https://api.z.ai/api/paas/v4/chat/completions', auth: (k) => ({ Authorization: `Bearer ${k}` }) },
  openai: { url: 'https://api.openai.com/v1/chat/completions',    auth: (k) => ({ Authorization: `Bearer ${k}` }) },
  groq:   { url: 'https://api.groq.com/openai/v1/chat/completions', auth: (k) => ({ Authorization: `Bearer ${k}` }) },
  gemini: { url: (m) => `https://generativelanguage.googleapis.com/v1beta/models/${m || 'gemini-2.0-flash'}:generateContent`, auth: () => ({}) },
};
ipcMain.handle('ai:call', async (e, { provider, apiKey, model, messages }) => {
  try {
    if (!apiKey) return { ok: false, error: 'No API key set for ' + provider + ' (Settings → AI keys).' };
    const ep = AI_ENDPOINTS[provider];
    if (!ep) return { ok: false, error: 'Unknown provider ' + provider };
    let url, body, headers = { 'Content-Type': 'application/json', ...ep.auth(apiKey) };
    if (provider === 'gemini') {
      url = ep.url(model) + '?key=' + encodeURIComponent(apiKey);
      body = JSON.stringify({ contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })) });
    } else {
      url = ep.url;
      body = JSON.stringify({ model: model || (provider === 'groq' ? 'llama-3.3-70b-versatile' : provider === 'zai' ? 'glm-4.6' : 'gpt-4o-mini'), messages });
    }
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 60000);
    const res = await fetch(url, { method: 'POST', headers, body, signal: ctrl.signal });
    clearTimeout(t);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: (json.error && (json.error.message || JSON.stringify(json.error))) || ('HTTP ' + res.status) };
    let text = '';
    if (provider === 'gemini') text = json.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
    else text = json.choices?.[0]?.message?.content || '';
    return { ok: true, text: text || '(empty response)' };
  } catch (err) {
    return { ok: false, error: err.name === 'AbortError' ? 'Timed out' : err.message };
  }
});

ipcMain.handle('cfg:set', (e, cfg) => { saveConfig(cfg); return true; });

ipcMain.handle('app:file', (e, { rel } = {}) => {
  try {
    const p = path.join(__dirname, rel);
    if (!p.startsWith(__dirname)) return null;
    return fs.readFileSync(p, 'utf8');
  } catch { return null; }
});

let wineVersion;
function getWineVersion() {
  return new Promise((resolve) => {
    if (wineVersion !== undefined) return resolve(wineVersion);
    if (!runner.which('wine')) { wineVersion = null; return resolve(null); }
    execFile('wine', ['--version'], { timeout: 8000, env: { ...process.env, WINEDEBUG: '-all' } }, (err, out) => {
      wineVersion = err ? null : String(out).trim(); resolve(wineVersion);
    });
  });
}
ipcMain.handle('sys:info', async () => ({
  hostname: os.hostname(), platform: process.platform, arch: process.arch,
  session: inSession, version: app.getVersion(), electron: process.versions.electron,
  kernel: os.release(), memTotal: os.totalmem(), memFree: os.freemem(), cpus: os.cpus().length,
  wine: await getWineVersion(), chrome: !!runner.chromeBin(),
  trifs: trifsStatus, userData: app.getPath('userData'),
}));

ipcMain.handle('win:fullscreen', (e, { on }) => {
  if (inSession) return false;                 // never fullscreen in the real OS (it would cover every program)
  if (win && !win.isDestroyed()) win.setFullScreen(!!on);
  return win?.isFullScreen() ?? false;
});
ipcMain.handle('win:isFullscreen', () => (inSession ? false : (win?.isFullScreen() ?? false)));

ipcMain.handle('power', async (e, { action }) => {
  if (!inSession) {
    if (action === 'shutdown' || action === 'restart') app.quit();
    return { ok: true, dev: true };
  }
  if (action === 'sleep') return { ok: true, lock: true };         // a lock screen, not a suspend (safer in a VM)
  const cmd = { restart: 'reboot', shutdown: 'poweroff' }[action];
  if (!cmd) return { ok: false };
  try { trifs.unmountSync(); } catch {}                            // flush the drive before power goes
  spawn('sudo', ['-n', 'systemctl', cmd], { stdio: 'ignore', detached: true }).unref();
  return { ok: true };
});

// Quiet shutdown of the drive if the shell quits
app.on('before-quit', () => { extwin.stop(); });
