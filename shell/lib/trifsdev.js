// ============================================================
// TriFS device manager — talks to the root helper (trifs) so the
// desktop can find, set up and mount the TriFS drive.
// In development (no helper, not in the full OS) it reports a plain
// folder as "mounted" so the rest of the shell behaves the same.
// ============================================================
'use strict';
const { execFile, execFileSync } = require('child_process');
const fs = require('fs');

const IN_SESSION = process.env.TRIMANGEES_SESSION === '1';
const HELPER = process.env.TRIFS_HELPER || '/usr/local/sbin/trifs';
const asRoot = process.getuid && process.getuid() === 0;
const haveHelper = () => { try { fs.accessSync(HELPER, fs.constants.X_OK); return true; } catch { return false; } };
const usable = () => haveHelper() && (IN_SESSION || !!process.env.TRIFS_HELPER);

function argv(args) {
  return asRoot || process.env.TRIFS_NOSUDO ? [HELPER, ...args] : ['sudo', '-n', HELPER, ...args];
}
function parse(out) { try { return JSON.parse(String(out).trim().split('\n').pop()); } catch { return null; } }

function runSync(args, timeout = 60000) {
  if (!usable()) return null;
  const a = argv(args);
  try { return parse(execFileSync(a[0], a.slice(1), { timeout, stdio: ['ignore', 'pipe', 'pipe'] })); }
  catch (e) { return parse(e.stdout) || { ok: false, error: String(e.message).split('\n')[0] }; }
}
function run(args, timeout = 30 * 60 * 1000) {
  return new Promise((resolve) => {
    if (!usable()) return resolve({ ok: false, error: 'the drive manager is only available in the full OS' });
    const a = argv(args);
    execFile(a[0], a.slice(1), { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      const j = parse(stdout);
      if (j) return resolve(j);
      resolve({ ok: false, error: err ? String(err.message).split('\n')[0] : 'no answer from the drive manager' });
    });
  });
}

module.exports = {
  usable,
  statusSync: () => runSync(['status']) || { ok: true, mounted: true, mode: 'dev', dev: true },
  status: async () => usable() ? run(['status'], 20000) : { ok: true, mounted: true, mode: 'dev', dev: true },
  scan: () => run(['scan'], 120000),
  mount: () => run(['mount'], 120000),
  format: (disk) => run(['format', String(disk)]),
  createImg: (part, gb) => run(['create-img', String(part), String(Math.floor(Number(gb)))]),
  unmount: () => run(['unmount'], 60000),
  unmountSync: () => runSync(['unmount'], 30000),

  // TriOS MAX: one blank disk -> everything (hidden system part + a shared
  // exFAT part any account can then pick in userAssign).
  comboFormat: (disk, sysgb) => run(['combo-format', String(disk), String(Math.floor(Number(sysgb) || 4))]),

  // TriOS MAX: the mounted system TriFS was set up as a plain whole-disk
  // format (no room left for anyone's files) — wipe that same disk and
  // redo it as system + shared, in one step. Destructive; UI must confirm.
  redoCombo: (sysgb) => run(['redo-combo', String(Math.floor(Number(sysgb) || 4))], 5 * 60 * 1000),

  // TriOS MAX: each account picks its own drive, independent of the others.
  userScan:      ()              => usable() ? run(['user-scan'], 120000) : Promise.resolve({ ok: true, drives: [] }),
  userAssign:    (user, dev)     => run(['user-assign', String(user), String(dev)], 5 * 60 * 1000),
  userMount:     (user)          => usable() ? run(['user-mount', String(user)], 60000) : Promise.resolve({ ok: true, user, mounted: true, dev: true }),
  userMountAll:  ()              => run(['user-mount-all'], 120000),
  userStatus:    ()              => usable() ? run(['user-status'], 20000) : Promise.resolve({ ok: true, drives: {} }),
  userUnassign:  (user)          => run(['user-unassign', String(user)]),
};
