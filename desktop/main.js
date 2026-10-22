/**
 * Electron desktop wrapper for Tukuk-OS.
 *
 * Boots a child `node index.js` process on port 8000 if one is not already listening,
 * then loads http://127.0.0.1:8000 into a single Chromium window. Menu shortcuts mirror
 * what a desktop user would expect (Cmd/Ctrl+K to focus search, Cmd/Ctrl+R to reload,
 * Cmd/Ctrl+Shift+I for DevTools, and a manual "Restart the Server" item for development).
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
      icon: path.join(__dirname, 'public', 'favicon.ico'),
      webPreferences: {
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
        icon: path.join(__dirname, 'public', 'favicon.ico'),
        webPreferences: {
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

  // Open the main UI.
  mainWindow.loadURL('http://127.0.0.1:8000');

  // Open DevTools in development mode.
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/** If a health check on 127.0.0.1:8000 succeeds we reuse it; otherwise spawn our own. */
function startLocalServer() {
  // Try the local server connection first.
  const http = require('http');
  const req = http.get('http://127.0.0.1:8000/health', (res) => {
    if (res.statusCode === 200) {
      console.log('[desktop] local server is already running.');
      return;
    }
    spawnServer();
  });
  req.on('error', () => {
    spawnServer();
  });
}

/** Spawn `node index.js` from the packaged app root and pipe stdio for developer visibility. */
function spawnServer() {
  console.log('[desktop] starting the local server...');
  const serverPath = path.join(__dirname, 'index.js');
  serverProcess = spawn('node', [serverPath], {
    cwd: __dirname,
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
