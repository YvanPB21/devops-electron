const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fetch = require('node-fetch');
const keytar = require('keytar');

const PORT = process.env.PORT || 3000;
const HEALTH_URL = `http://localhost:${PORT}/api/health`;
const SERVICE = 'azdo-pipeline-dashboard';
const ACCOUNT = 'credentials';

let serverStarted = false;

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'electron-preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  win.loadURL(`http://localhost:${PORT}/`);
  return win;
}

function createSettingsWindow() {
  const win = new BrowserWindow({
    width: 640,
    height: 420,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'electron-preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  win.loadFile(path.join(__dirname, 'public', 'settings.html'));
  return win;
}

async function waitForServer(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(HEALTH_URL);
      if (res.ok) return true;
    } catch (e) {
      // ignore
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function getStoredCredentials() {
  try {
    const txt = await keytar.getPassword(SERVICE, ACCOUNT);
    if (!txt) return null;
    return JSON.parse(txt);
  } catch (e) {
    console.warn('getStoredCredentials error', e);
    return null;
  }
}

async function saveCredentialsToStore(obj) {
  await keytar.setPassword(SERVICE, ACCOUNT, JSON.stringify(obj));
}

async function startServerWithCredentials(creds) {
  if (serverStarted) return;
  // set env vars before requiring server.js
  process.env.AZDO_ORG = creds.AZDO_ORG;
  process.env.AZDO_PROJECT = creds.AZDO_PROJECT;
  process.env.AZDO_PAT = creds.AZDO_PAT;
  try {
    require(path.join(__dirname, 'server.js'));
    serverStarted = true;
  } catch (e) {
    console.error('Error starting server:', e);
  }
  await waitForServer(20000);
}

// IPC handlers for renderer
ipcMain.handle('get-credentials', async () => {
  return await getStoredCredentials();
});

ipcMain.handle('save-credentials', async (event, data) => {
  await saveCredentialsToStore(data);
  // start server now that creds are saved (do not await so renderer isn't blocked)
  startServerWithCredentials(data).catch(e => console.error('Error starting server after save:', e));
  return { ok: true };
});

ipcMain.handle('delete-credentials', async () => {
  await keytar.deletePassword(SERVICE, ACCOUNT);
  return { ok: true };
});

// allow renderer to open settings window on demand
let _settingsWin = null;
ipcMain.handle('open-settings', async () => {
  try {
    if (_settingsWin && !_settingsWin.isDestroyed()) {
      _settingsWin.focus();
      return { ok: true };
    }
    _settingsWin = createSettingsWindow();
    _settingsWin.on('closed', () => { _settingsWin = null; });
    return { ok: true };
  } catch (e) {
    console.error('open-settings error', e);
    return { ok: false, error: e && e.message };
  }
});

app.whenReady().then(async () => {
  // Check stored credentials
  const stored = await getStoredCredentials();
  if (stored && stored.AZDO_ORG && stored.AZDO_PROJECT && stored.AZDO_PAT) {
    await startServerWithCredentials(stored);
    createMainWindow();
  } else {
    // open settings window to collect credentials; when saved, IPC handler will start server
    const settingsWin = createSettingsWindow();
    settingsWin.on('closed', async () => {
      const s = await getStoredCredentials();
      if (s && s.AZDO_ORG && s.AZDO_PROJECT && s.AZDO_PAT) {
        await startServerWithCredentials(s);
        createMainWindow();
      }
    });
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
