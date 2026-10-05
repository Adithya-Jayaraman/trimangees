// ============================================================
// External windows — Windows programs (Wine), Chrome, and any other
// real X11 window. The shell lists them in its taskbar and can raise,
// minimise or close them. Needs wmctrl + xdotool (both ship in the OS).
// ============================================================
'use strict';
const { execFile } = require('child_process');

const SHELL_TITLE = 'TrimangeesOS Shell';
const enabled = () => process.env.TRIMANGEES_SESSION === '1' || process.env.TRIMANGEES_EXTWIN === '1';

const OWN_CLASS = /^(electron|trimangeesos|trimangees-os|trimangees|chrome-app)\./i;
const NOISE_TITLE = /^(Wine System Tray|Default IME|MSCTFIME UI|Program Manager|Desktop)$/i;

function sh(cmd, args, timeout = 3000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, env: process.env }, (err, stdout) => resolve(err ? '' : String(stdout)));
  });
}

async function list() {
  const out = await sh('wmctrl', ['-lpx']);
  const act = parseInt((await sh('xdotool', ['getactivewindow'])).trim(), 10);
  const wins = [];
  for (const line of out.split('\n')) {
    // 0x03600003  0 1234  notepad.exe.Notepad  host  Title text
    const m = line.match(/^(0x[0-9a-f]+)\s+(-?\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s?(.*)$/i);
    if (!m) continue;
    const [, id, desk, pid, cls, , title] = m;
    if (desk === '-1') continue;                       // docks / desktop surfaces
    if (OWN_CLASS.test(cls)) continue;                 // the shell and browser windows
    if (!title.trim() || title === SHELL_TITLE || NOISE_TITLE.test(title.trim())) continue;
    wins.push({ id, pid: +pid, cls, title: title.trim(),
                active: Number.isFinite(act) && parseInt(id, 16) === act });
  }
  return wins;
}

let timer = null, last = '';
function start(onChange, ms = 1200) {
  if (!enabled() || timer) return;
  const tick = async () => {
    try {
      const w = await list();
      const sig = JSON.stringify(w);
      if (sig !== last) { last = sig; onChange(w); }
    } catch {}
  };
  timer = setInterval(tick, ms); tick();
}
function stop() { if (timer) clearInterval(timer); timer = null; }

const dec = (id) => String(parseInt(id, 16));
const activate = (id) => sh('wmctrl', ['-i', '-a', id]);
const minimize = (id) => sh('xdotool', ['windowminimize', dec(id)]);
const close = (id) => sh('wmctrl', ['-i', '-c', id]);

// Keep the shell at the bottom of the stack so program windows always sit above it.
async function pinShellBelow() {
  if (!enabled()) return;
  await sh('wmctrl', ['-r', SHELL_TITLE, '-b', 'add,below,skip_taskbar,skip_pager']);
}

module.exports = { enabled, list, start, stop, activate, minimize, close, pinShellBelow, SHELL_TITLE };
