// ============================================================
// Trimangees OS — preload bridge
// Exposes a small, safe API from the "kernel" (main process)
// to the desktop (renderer). Nothing else from Node leaks in.
// ============================================================
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('kernel', {
  session: process.env.TRIMANGEES_SESSION === '1',

  // Terminal
  termRun:  (id, cmd, cwd) => ipcRenderer.invoke('term:run', { id, cmd, cwd }),
  termStdin: (id, text)    => ipcRenderer.invoke('term:stdin', { id, text }),
  sh: (cmd, timeout)       => ipcRenderer.invoke('sh:exec', { cmd, timeout }),
  xterm: ()                => ipcRenderer.invoke('sys:xterm'),
  saveUrlText: (url, dest) => ipcRenderer.invoke('net:saveText', { url, dest }),
  fsReal: (p) => ipcRenderer.invoke('fs:real', { p }),
  fsRealMany: (ps) => ipcRenderer.invoke('fs:realMany', { ps }),
  fsUnique: (dir, name) => ipcRenderer.invoke('fs:unique', { dir, name }),
  fsMove: (from, to) => ipcRenderer.invoke('fs:move', { from, to }),
  appsLinux: () => ipcRenderer.invoke('apps:linux'),
  runLinux: (exec, terminal) => ipcRenderer.invoke('run:linux', { exec, terminal }),
  xtermRun: (cmd, title) => ipcRenderer.invoke('sys:xtermRun', { cmd, title }),
  restartShell: () => ipcRenderer.invoke('sys:restartShell'),
  diag: () => ipcRenderer.invoke('sys:diag'),
  backupRun: (user) => ipcRenderer.invoke('backup:run', { user }),
  backupList: (user) => ipcRenderer.invoke('backup:list', { user }),
  backupRestore: (user, name) => ipcRenderer.invoke('backup:restore', { user, name }),
  updateInstall: (zip) => ipcRenderer.invoke('update:install', { zip }),
  updateCheckOnline: () => ipcRenderer.invoke('update:checkOnline'),
  updateRevert: () => ipcRenderer.invoke('update:revert'),
  updateStatus: () => ipcRenderer.invoke('update:status'),
  termKill: (id)           => ipcRenderer.invoke('term:kill', { id }),
  onTermOut:  (cb) => ipcRenderer.on('term:out',  (e, m) => cb(m)),
  onTermDone: (cb) => ipcRenderer.on('term:done', (e, m) => cb(m)),
  resolveDir: (base, target) => ipcRenderer.invoke('fs:resolveDir', { base, target }),

  // Files
  listDir: (dir, hidden) => ipcRenderer.invoke('fs:list', { dir, hidden }),
  openPath: (target) => ipcRenderer.invoke('fs:open', { target }),
  readFile:  (file)          => ipcRenderer.invoke('fs:read',  { file }),
  readFileB64: (file)        => ipcRenderer.invoke('fs:readB64', { file }),
  writeFile: (file, content) => ipcRenderer.invoke('fs:write', { file, content }),
  writeFileB64: (file, b64)  => ipcRenderer.invoke('fs:writeB64', { file, b64 }),
  copy:   (from, to) => ipcRenderer.invoke('fs:copy', { from, to }),
  exists: (target)   => ipcRenderer.invoke('fs:exists', { target }),
  toVirtual: (p)     => ipcRenderer.invoke('fs:toVirtual', { p }),
  mkdir:  (dir)      => ipcRenderer.invoke('fs:mkdir',  { dir }),
  rename: (from, to) => ipcRenderer.invoke('fs:rename', { from, to }),
  remove: (target)   => ipcRenderer.invoke('fs:delete', { target }),
  // Real disk path of a File picked in the renderer (for custom wallpaper)
  pathOf: (file) => webUtils.getPathForFile(file),
  homeDir: ()        => ipcRenderer.invoke('fs:home'),
  userHome: (name)   => ipcRenderer.invoke('user:home', { name }),
  readAppFile: (rel) => ipcRenderer.invoke('app:file', { rel }),
  // Tell the kernel who's logged in (routes downloads + resolves ~ in the shell)
  setUser: (name)    => ipcRenderer.invoke('session:setUser', { name }),
  // Fires when a saved file lands on the virtual disk
  onDownloaded: (cb) => ipcRenderer.on('fs:downloaded', (e, d) => cb(d)),
  // Disk sync + backup + stats
  fsExportHome: (user) => ipcRenderer.invoke('fs:exportHome', { user }),
  fsImportHome: (user, root) => ipcRenderer.invoke('fs:importHome', { user, root }),
  fsStat:    () => ipcRenderer.invoke('fs:stat'),
  fsReset:   () => ipcRenderer.invoke('fs:reset'),
  fsBackup:  () => ipcRenderer.invoke('fs:backup'),
  fsRestore: () => ipcRenderer.invoke('fs:restore'),
  onFsChanged: (cb) => ipcRenderer.on('fs:changed', () => cb()),

  // Trimangees Browser (opens in its own window)
  openBrowser: (url) => ipcRenderer.invoke('browser:open', { url }),
  browserToggle: ()  => ipcRenderer.invoke('browser:toggle'),
  onBrowserState: (cb) => ipcRenderer.on('browser:state', (e, s) => cb(s)),
  onBrwNewTab: (cb) => ipcRenderer.on('brw:newtab', (e, u) => cb(u)),

  // Programs: Windows apps (Wine), Chrome, /Applications, and other windows
  appsLocal: ()        => ipcRenderer.invoke('apps:local'),
  appsWine:  ()        => ipcRenderer.invoke('apps:wine'),
  runWineApp:  (file)  => ipcRenderer.invoke('apps:runWineApp', { file }),
  runWineTool: (args)  => ipcRenderer.invoke('apps:runWineTool', { args }),
  runFile:   (target)  => ipcRenderer.invoke('run:file', { target }),
  runChrome: (url)     => ipcRenderer.invoke('run:chrome', { url }),
  appsHas:   ()        => ipcRenderer.invoke('apps:has'),
  extList:     ()      => ipcRenderer.invoke('ext:list'),
  extActivate: (id)    => ipcRenderer.invoke('ext:activate', { id }),
  extMinimize: (id)    => ipcRenderer.invoke('ext:minimize', { id }),
  extClose:    (id)    => ipcRenderer.invoke('ext:close', { id }),
  onExtWindows: (cb)   => ipcRenderer.on('ext:windows', (e, l) => cb(l)),
  onRunStart:   (cb)   => ipcRenderer.on('run:start', (e, m) => cb(m)),
  onRunExit:    (cb)   => ipcRenderer.on('run:exit', (e, m) => cb(m)),
  onWineState:  (cb)   => ipcRenderer.on('wine:state', (e, m) => cb(m)),

  // TriFS drive setup
  trifsStatus:    ()          => ipcRenderer.invoke('trifs:status'),
  trifsScan:      ()          => ipcRenderer.invoke('trifs:scan'),
  trifsMount:     ()          => ipcRenderer.invoke('trifs:mount'),
  trifsFormat:    (disk)      => ipcRenderer.invoke('trifs:format', { disk }),
  trifsCreateImg: (part, gb)  => ipcRenderer.invoke('trifs:createImg', { part, gb }),
  trifsUnmount:   ()          => ipcRenderer.invoke('trifs:unmount'),
  trifsRestart:   ()          => ipcRenderer.invoke('trifs:restart'),

  // TriOS MAX: per-account drives
  isMax:              ()           => ipcRenderer.invoke('sys:max'),
  trifsComboFormat:   (disk, sysgb) => ipcRenderer.invoke('trifs:comboFormat', { disk, sysgb }),
  trifsUserScan:      ()           => ipcRenderer.invoke('trifs:userScan'),
  trifsUserAssign:    (user, dev)  => ipcRenderer.invoke('trifs:userAssign', { user, dev }),
  trifsUserMount:     (user)       => ipcRenderer.invoke('trifs:userMount', { user }),
  trifsUserMountAll:  ()           => ipcRenderer.invoke('trifs:userMountAll'),
  trifsUserStatus:    ()           => ipcRenderer.invoke('trifs:userStatus'),
  trifsUserUnassign:  (user)       => ipcRenderer.invoke('trifs:userUnassign', { user }),

  // Firebase Storage (listed in the main process to skip CORS)
  storageList: (bucket, prefix) => ipcRenderer.invoke('storage:list', { bucket, prefix }),
  storageUpload: (opts) => ipcRenderer.invoke('storage:upload', opts),
  storageDelete: (bucket, objectPath) => ipcRenderer.invoke('storage:delete', { bucket, objectPath }),

  // Settings + system
  getConfig: ()    => ipcRenderer.invoke('cfg:get'),
  setConfig: (cfg) => ipcRenderer.invoke('cfg:set', cfg),
  sysInfo:  ()     => ipcRenderer.invoke('sys:info'),
  power:    (action) => ipcRenderer.invoke('power', { action }),
  setFullscreen: (on) => ipcRenderer.invoke('win:fullscreen', { on }),
  isLite: () => ipcRenderer.invoke('sys:lite'),
  aiCall: (provider, apiKey, model, messages) => ipcRenderer.invoke('ai:call', { provider, apiKey, model, messages }),
  isFullscreen:  ()   => ipcRenderer.invoke('win:isFullscreen'),
});
