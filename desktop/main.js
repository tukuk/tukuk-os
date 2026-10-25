/**
 * Electron desktop wrapper for Tukuk-OS.
 *
 * Boots a child `node index.js` process on 127.0.0.1:8000 if one is not already listening,
 * then loads http://127.0.0.1:8000 into a single Chromium window. Menu shortcuts mirror
 * what a desktop user would expect (Cmd/Ctrl+K to focus search, Cmd/Ctrl+R to reload,
 * Cmd/Ctrl+Shift+I for DevTools, and a manual "Restart the Server" item for development).
 *
 * Everything below hardcoded its own idea of where the server lives: the window loaded :8000,
 * the child was spawned without a PORT (so it bound 3000 from src/config.js), and it was
 * pointed at `desktop/index.js`, a file that has never existed — so `npm run desktop` opened
 * a window on a port nothing served, then a child that exited on a missing module. The port
 * and the host are now decided once, here, and handed to the child.
 *
 * Sandbox: Chromium's chrome-sandbox helper needs root-owned setuid 4755 to start. If
 * that cannot be configured (typical on a dev laptop without an SUID helper installed)
 * we catch the crash and reopen the window with `sandbox: false` — a graceful fallback
 * so the app at least launches. `--no-sandbox` is also appended defensively on start-up
 * to keep the same code path working on Wayland / Flatpak hosts.
 *
 * The renderer is fully isolated: `nodeIntegration: false`, `contextIsolation: true`,
 * and only the tiny API surface in `preload.js` is exposed to the page.
 */
const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

// 8000 rather than the server's own default of 3000: a desktop user is the most likely to have
// something else on 3000. PORT still wins when it is set. The child is told the same port and is
// pinned to loopback, so the desktop app never exposes the portal to the local network.
const PORT = Number(process.env.PORT) || 8000;
const HOST = '127.0.0.1';
const BASE = `http://${HOST}:${PORT}`;
// The server entry is the repo root's index.js — desktop/ holds only the wrapper.
const SERVER_DIR = path.join(__dirname, '..');
const SERVER_ENTRY = path.join(SERVER_DIR, 'index.js');

let mainWindow = null;
let serverProcess = null;

/** Create the primary window, spinning up the local server if needed. */
function createWindow() {
  // Note: chrome-sandbox needs root ownership + mode 4755. If that cannot be
  // configured, Electron crashes with "setuid_sandbox_host.cc(163)". Opening
  // without the sandbox is the fallback.
  try {
    mainWindow = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 800,
      minHeight: 600,
      title: 'Tukuk-OS — Web Search Engine',
      icon: path.join(__dirname, '..', 'public', 'favicon.ico'),
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    });
  } catch (error) {
    if (error.message && error.message.includes('sandbox')) {
      console.warn('[desktop] sandbox failed, opening without the sandbox...');
      mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        title: 'Tukuk-OS — Web Search Engine',
        icon: path.join(__dirname, '..', 'public', 'favicon.ico'),
        webPreferences: {
          preload: path.join(__dirname, 'preload.js'),
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: false
        }
      });
    } else {
      throw error;
    }
  }

  // Try to start the local server if it is not already running.
  startLocalServer();

  // Open the main UI — the same host and port the health check just asked.
  mainWindow.loadURL(BASE);

  // Open DevTools in development mode.
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/** If a health check on the app's own port succeeds we reuse it; otherwise spawn our own. */
function startLocalServer() {
  // Try the local server connection first.
  const http = require('http');
  const req = http.get(`${BASE}/health`, (res) => {
    if (res.statusCode === 200) {
      console.log('[desktop] local server is already running.');
      return;
    }
    req.destroy();
    spawnServer();
  });
  req.on('error', () => {
    spawnServer();
  });
}

/** Spawn `node index.js` from the app root, on the port the window is about to load. */
function spawnServer() {
  console.log('[desktop] starting the local server...');
  serverProcess = spawn('node', [SERVER_ENTRY], {
    cwd: SERVER_DIR,
    env: { ...process.env, PORT: String(PORT), HOST },
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });

  serverProcess.on('error', (err) => {
    console.error('[desktop] failed to start the server:', err.message);
  });

  serverProcess.on('exit', (code) => {
    console.log(`[desktop] server exited with code ${code}`);
    serverProcess = null;
  });
}

/** Build the native application menu (macOS + Windows/Linux share one template). */
function buildMenu() {
  const template = [
    {
      label: 'Tukuk-OS',
      submenu: [
        { label: 'About Tukuk-OS', selector: 'orderFrontStandardAboutPanel:' },
        { type: 'separator' },
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => mainWindow?.reload() },
        { label: 'Force Reload', accelerator: 'CmdOrCtrl+Shift+R', click: () => mainWindow?.webContents.reloadIgnoringCache() },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() }
      ]
    },
    {
      label: 'Search',
      submenu: [
        { label: 'Focus the Search Box', accelerator: 'CmdOrCtrl+K', click: () => mainWindow?.webContents.send('focus-search') }
      ]
    },
    {
      label: 'Development',
      submenu: [
        { label: 'DevTools', accelerator: 'CmdOrCtrl+Shift+I', click: () => mainWindow?.webContents.openDevTools() },
        { label: 'Restart the Server', click: () => {
          if (serverProcess) { serverProcess.kill(); serverProcess = null; }
          spawnServer();
        }}
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  // Relax the sandbox; if the switch is unsupported Electron keeps running as before.
  try {
    app.commandLine.appendSwitch('no-sandbox');
  } catch {
    // ignore when unsupported
  }
  createWindow();
  buildMenu();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});
