const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const { google } = require('googleapis');
const { readFileSync, writeFileSync } = require('fs');
require('dotenv').config();

let mainWindow = null; // Declare global window reference

// Helper function to resolve module paths
function getModulePath(moduleName) {
  let possiblePaths = [
    path.join(__dirname, moduleName),
  ];

  // When app is packaged, ASAR unpacking puts files in app.asar.unpacked
  if (app.isPackaged) {
    const appPath = app.getAppPath();
    // If running from app.asar, also check app.asar.unpacked
    if (appPath.includes('app.asar')) {
      const unpackedPath = appPath.replace(/app\.asar.*/, 'app.asar.unpacked');
      possiblePaths.push(path.join(unpackedPath, moduleName));
    }
    // Also check in resources for backwards compatibility
    possiblePaths.push(path.join(process.resourcesPath, moduleName));
  }

  // Log all paths being checked
  console.log(`[Debug] Checking for module: ${moduleName}`);
  for (const tryPath of possiblePaths) {
    console.log(`[Debug]   - ${tryPath}`);
    if (fsSync.existsSync(tryPath)) {
      console.log(`[Path] Found: ${tryPath}`);
      return tryPath;
    }
  }

  throw new Error(`Cannot find module: ${moduleName}. Tried: ${possiblePaths.join(', ')}`);
}

// Helper function to find Chrome executable
async function getChromePath() {
  const possiblePaths = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'], 'Google', 'Chrome', 'Application', 'chrome.exe')
  ];

  for (const chromePath of possiblePaths) {
    try {
      if (fsSync.existsSync(chromePath)) {
        console.log(`[Chrome] Found at: ${chromePath}`);
        return chromePath;
      }
    } catch (e) {
      // Skip invalid paths
    }
  }

  return null; // Chrome not found
}

// 🔄 Auto-Updater Configuration
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

// Configure auto-updater logging
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';
log.info('App starting...');

// Suppress Punycode warning
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (warning.name === 'DeprecationWarning' && warning.message.includes('punycode')) {
    return;
  }
  console.warn(warning);
});

// Auto-updater event handlers
// Auto-updater event handlers
autoUpdater.on('error', (err) => {
  log.error('Error in auto-updater:', err);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', {
      status: 'error',
      message: 'בדיקת עדכונים נכשלה. לחץ כאן להורדה ידנית.',
      link: 'https://github.com/JustArandomGuyFromTheInternet/Web-Scraper/releases/latest'
    });
  }
});

autoUpdater.on('checking-for-update', () => {
  log.info('Checking for updates...');
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', { status: 'checking', message: 'בודק עדכונים...' });
  }
});

autoUpdater.on('update-available', (info) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', { status: 'available', message: `נמצאה גרסה חדשה! (${info.version}) מוריד...` });
  }
});

autoUpdater.on('update-not-available', (info) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', { status: 'not-available', message: 'הגרסה שלך מעודכנת.' });
  }
});

// IPC Handler for manual check
ipcMain.handle('check-for-updates', async () => {
  try {
    await autoUpdater.checkForUpdates();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

autoUpdater.on('download-progress', (progressObj) => {
  let message = `Downloading update: ${progressObj.percent.toFixed(1)}%`;
  log.info(message);
});

autoUpdater.on('update-downloaded', (info) => {
  log.info('Update downloaded:', info.version);
  if (mainWindow && !mainWindow.isDestroyed()) {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Ready',
      message: 'Update installed successfully.',
      detail: 'The app will restart now to apply the update.',
      buttons: ['Restart', 'Later']
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  }
});

// Re-define createWindow and startup logic correctly
function createWindow() {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#16161f',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      sandbox: false,
    },
    icon: process.platform === 'win32'
      ? (app.isPackaged ? path.join(process.resourcesPath, 'ICON-modified.png') : path.join(__dirname, 'ICON-modified.png'))
      : path.join(__dirname, 'ICON-modified.png')
  });

  mainWindow.loadURL('file://' + path.join(__dirname, 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');

// Settings handlers
ipcMain.handle('get-settings', async () => {
  try {
    const data = await fs.readFile(SETTINGS_PATH, 'utf8');
    return JSON.parse(data);
  } catch {
    return {};
  }
});

ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.handle('save-settings', async (event, settings) => {
  try {
    await fs.writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2));
    if (settings.apiKey) {
      process.env.GEMINI_API_KEY = settings.apiKey;
    }
    return { success: true };
  } catch (error) {
    throw new Error(`Failed to save settings: ${error.message}`);
  }
});

// Scraping Process Controls
let scrapingProcess = null;
let repairProcess = null;

ipcMain.handle('run-scrape', async (event, payload) => {
  try {
    if (scrapingProcess) throw new Error('Scraping process already running');

    const scriptPath = getModulePath('src/scrape_controller.mjs');
    const userDataPath = app.getPath('userData');

    // Prepare links.json
    const links = payload.links || payload;
    const linksData = links.map(url => ({ url, name: '', date: '' }));
    await fs.writeFile(path.join(userDataPath, 'links.json'), JSON.stringify(linksData, null, 2));

    // Build environment
    const envVars = Object.assign({}, process.env);
    envVars.LINKS_FILE = path.join(userDataPath, 'links.json');
    envVars.SCREENSHOTS_DIR = path.join(userDataPath, 'screenshots');
    envVars.OUTPUT_DIR = payload.savePath || path.join(userDataPath, 'output');
    envVars.VISUAL_MODE = (payload.visualMode !== false) ? 'true' : 'false';

    if (payload.spreadsheetId) envVars.SPREADSHEET_ID = payload.spreadsheetId;
    envVars.SHEET_NAME = payload.sheetName || 'Summaries';

    const chromeExePath = await getChromePath();
    if (chromeExePath) envVars.CHROME_EXE = chromeExePath;

    scrapingProcess = spawn('node', [scriptPath], {
      env: envVars,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: __dirname,
      windowsHide: true
    });

    scrapingProcess.stdout.on('data', (data) => {
      const message = data.toString().trim();
      if (mainWindow) mainWindow.webContents.send('scraping-output', { type: 'info', message });
    });

    scrapingProcess.stderr.on('data', (data) => {
      const message = data.toString().trim();
      if (mainWindow) mainWindow.webContents.send('scraping-output', { type: 'error', message });
    });

    return new Promise((resolve) => {
      scrapingProcess.on('close', (code) => {
        scrapingProcess = null;
        resolve({ success: code === 0 });
      });
    });
  } catch (error) {
    log.error('Scraping error:', error);
    throw error;
  }
});

ipcMain.on('stop-scraping', () => {
  if (scrapingProcess) {
    scrapingProcess.kill();
    scrapingProcess = null;
  }
});

// Sync to Sheets Handler
ipcMain.handle('sync-to-sheets', async (event, config) => {
  try {
    const { syncToSheets } = await import('./smart_sheets_writer.mjs');
    return await syncToSheets(config);
  } catch (error) {
    return { success: false, message: error.message };
  }
});

// Repair Handlers
ipcMain.handle('repair-all-fields', async (event, payload) => {
  try {
    const { repairAllFields } = await import('./src/repair_manager.mjs');
    return await repairAllFields(payload.spreadsheetId, payload.sheetName || 'Summaries', mainWindow);
  } catch (error) {
    return { success: false, message: error.message };
  }
});

// File & folder handlers
ipcMain.handle('browse-save-path', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'בחר תיקייה לשמירת התוצאות',
    defaultPath: app.getPath('documents')
  });
  if (!result.canceled) return result.filePaths[0];
  throw new Error('No directory selected');
});

ipcMain.handle('browse-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: 'בחר קובץ CSV/Excel קיים',
    filters: [{ name: 'Data Files', extensions: ['csv', 'xlsx'] }]
  });
  if (!result.canceled) return result.filePaths[0];
  throw new Error('No file selected');
});

ipcMain.handle('delete-screenshots', async () => {
  try {
    const dir = path.join(app.getPath('userData'), 'screenshots');
    const files = await fs.readdir(dir);
    for (const file of files) await fs.unlink(path.join(dir, file));
    return { success: true, count: files.length };
  } catch (e) { return { success: false, message: e.message }; }
});

ipcMain.handle('open-screenshots-folder', async () => {
  const dir = path.join(app.getPath('userData'), 'screenshots');
  await fs.mkdir(dir, { recursive: true });
  shell.openPath(dir);
  return { success: true };
});

ipcMain.handle('get-icon-path', () => {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'ICON-modified.png')
    : path.join(__dirname, 'ICON-modified.png');
});

// OAuth & Google Sheets handlers
ipcMain.handle('test-sheets-connection', async (event, { url }) => {
  const { testConnection, isAuthenticated } = await import('./sheets_oauth.mjs');
  if (!url) return { success: await isAuthenticated() };
  return await testConnection(url);
});

ipcMain.handle('authenticate-google', async () => {
  const { getAuthenticatedClient } = await import('./sheets_oauth.mjs');
  await getAuthenticatedClient();
  return { success: true };
});

ipcMain.handle('is-authenticated', async () => {
  const { isAuthenticated } = await import('./sheets_oauth.mjs');
  return await isAuthenticated();
});

ipcMain.handle('logout-sheets', async () => {
  const { logout } = await import('./sheets_oauth.mjs');
  return await logout();
});

ipcMain.handle('open-browser', async () => {
  const chromeExe = await getChromePath() || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const userDataDir = path.join(app.getPath('userData'), 'chrome-profile');
  await fs.mkdir(userDataDir, { recursive: true });
  spawn(chromeExe, [
    `--user-data-dir=${userDataDir}`,
    'https://www.facebook.com',
    'https://www.instagram.com'
  ], { detached: true });
  return { success: true };
});

// License handlers
ipcMain.handle('get-license-info', async () => {
  const { checkLicense } = await import('./src/license_manager.mjs');
  return await checkLicense();
});

ipcMain.handle('activate-license', async (event, key) => {
  const { activateLicense } = await import('./src/license_manager.mjs');
  return await activateLicense(key);
});

// Utility Handlers
ipcMain.handle('test-api', () => 'API is working');
ipcMain.handle('check-api-status', async () => {
  return {
    ipc: true,
    websocket: false, // WebSocket server is managed in scrape_controller
    googleSheets: true
  };
});

ipcMain.handle('get-diagnostic-info', async () => {
  return {
    version: app.getVersion(),
    isPackaged: app.isPackaged,
    env: {
      OAUTH_CREDENTIALS_PATH: process.env.OAUTH_CREDENTIALS_PATH,
      GOOGLE_TOKEN_PATH: process.env.GOOGLE_TOKEN_PATH
    },
    paths: {
      userData: app.getPath('userData'),
      resources: process.resourcesPath,
      executable: app.getPath('exe')
    }
  };
});

ipcMain.handle('load-oauth-credentials', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (result.canceled) throw new Error('Canceled');
  const target = path.join(app.getPath('userData'), 'oauth_credentials.json');
  await fs.copyFile(result.filePaths[0], target);
  process.env.OAUTH_CREDENTIALS_PATH = target;
  return { success: true, path: target };
});

ipcMain.handle('repair-field', async (event, { spreadsheetId, sheetName, field }) => {
  const { repairField } = await import('./src/repair_manager.mjs');
  return await repairField(spreadsheetId, sheetName || 'Summaries', field, mainWindow);
});

ipcMain.handle('force-google-auth', async () => {
  const { getAuthenticatedClient } = await import('./sheets_oauth.mjs');
  await getAuthenticatedClient(true);
  return { success: true };
});

// File system bridging handlers
ipcMain.handle('read-file', async (event, filePath) => await fs.readFile(filePath, 'utf8'));
ipcMain.handle('write-file', async (event, { filePath, data }) => await fs.writeFile(filePath, data));
ipcMain.handle('export-results', async (event, data) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.join(app.getPath('documents'), 'results.json'),
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (!result.canceled) await fs.writeFile(result.filePath, JSON.stringify(data, null, 2));
  return { success: !result.canceled };
});

// 🚀 App Lifecycle
app.whenReady().then(async () => {
  // 1. License Check
  try {
    const { checkLicense } = await import('./src/license_manager.mjs');
    const license = await checkLicense();
    if (!license.valid) {
      dialog.showMessageBoxSync({
        type: 'error',
        title: 'License Expired',
        message: 'Your trial period has ended.',
        detail: `Machine ID: ${license.machineId || 'Unknown'}\nPlease contact support.`
      });
      app.quit();
      return;
    }
  } catch (err) {
    log.error('License check bypassed/failed:', err);
  }

  // 2. Directories & Packaging Setup
  const userDataPath = app.getPath('userData');
  await fs.mkdir(path.join(userDataPath, 'screenshots'), { recursive: true });
  await fs.mkdir(path.join(userDataPath, 'output'), { recursive: true });

  if (app.isPackaged) {
    const targetPath = path.join(userDataPath, 'oauth_credentials.json');
    const sourcePath = path.join(process.resourcesPath, 'oauth_credentials.json');

    log.info(`[OAuth] Target: ${targetPath}`);
    log.info(`[OAuth] Source exists? ${fsSync.existsSync(sourcePath)}`);

    if (!fsSync.existsSync(targetPath) && fsSync.existsSync(sourcePath)) {
      try {
        fsSync.copyFileSync(sourcePath, targetPath);
        log.info('Auto-copied oauth_credentials.json to userData');
      } catch (e) {
        log.error('Failed to auto-copy credentials:', e);
      }
    }
    process.env.OAUTH_CREDENTIALS_PATH = targetPath;
    process.env.GOOGLE_TOKEN_PATH = path.join(userDataPath, 'token.json');
    process.env.USER_DATA_PATH = userDataPath;
  } else {
    process.env.OAUTH_CREDENTIALS_PATH = path.join(__dirname, 'oauth_credentials.json');
    process.env.GOOGLE_TOKEN_PATH = path.join(__dirname, 'token.json');
  }

  // 3. Start App
  createWindow();

  // 4. Initial Update Check
  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify();
  }, 5000);
});

// Windows/Darwin lifecycle
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
