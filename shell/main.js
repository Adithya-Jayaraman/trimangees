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
ipcMain.handle('apps:has', () => ({ wine: !!runner.which('wine'), chrome: !!runner.chromeBin(), xterm: !!runner.which('xterm') }));

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
ipcMain.handle('cfg:get', () => loadConfig());
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
