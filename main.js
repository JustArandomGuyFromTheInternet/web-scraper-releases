// 🤐 SILENCE ALL DEPRECATION WARNINGS (including Punycode)
process.env.NODE_NO_WARNINGS = '1';
process.removeAllListeners('warning');

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
        return chromePath;
      }
    } catch (e) {
    }
  }

  return null; // Chrome not found
}

// Helper function to find Node.js executable
function getNodePath() {
  // If we're on Windows and process.execPath looks like node.exe (e.g. in dev or or specific installers)
  if (process.platform === 'win32' && process.execPath.toLowerCase().endsWith('node.exe')) {
    return process.execPath;
  }

  // First, try to find bundled Node.js in the app resources
  if (app.isPackaged) {
    const bundledNodePaths = [
      path.join(process.resourcesPath, 'node', 'node.exe'),
      path.join(process.resourcesPath, 'node-win64', 'node.exe'),
      path.join(process.resourcesPath, 'bin', 'node.exe'),
      path.join(path.dirname(process.execPath), 'node.exe'), // Look next to executable
    ];

    for (const nodePath of bundledNodePaths) {
      if (fsSync.existsSync(nodePath)) {
        return nodePath;
      }
    }
  }

  // Fallback to system Node.js
  console.log(`[Node] Using system Node.js (from PATH)`);
  return 'node';
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
let currentScrapingAbortController = null;

ipcMain.handle('run-scrape', async (event, payload) => {
  try {
    // Prevent multiple concurrent scrapes
    if (scrapingProcess) {
      return { success: false, error: '⚠️ סקריפה כבר פועלת! חכה להשלמה.' };
    }

    const scriptPath = getModulePath('src/scrape_controller.mjs');
    const userDataPath = app.getPath('userData');

    // 🔐 IMPORTANT: Export Electron's cookies BEFORE launching scraper
    try {
      console.log('[Cookies] Attempting to export cookies from Electron session...');
      const cookies = await mainWindow.webContents.session.cookies.get({});
      const cookiesFile = path.join(userDataPath, 'electron-cookies.json');

      console.log(`[Cookies] Got ${cookies.length} cookies from Electron session`);

      if (cookies.length === 0) {
        console.log('[Cookies] ⚠️ WARNING: No cookies found in Electron session!');
        console.log('[Cookies] Possible causes:');
        console.log('[Cookies]   1. User not logged in to Facebook/Instagram in UI');
        console.log('[Cookies]   2. Cookies were cleared');
        console.log('[Cookies]   3. Session isolated/private mode');
      } else {
        // Log cookie details
        const fbCookies = cookies.filter(c => c.domain?.includes('facebook') || c.domain?.includes('instagram') || c.url?.includes('facebook') || c.url?.includes('instagram'));
        console.log(`[Cookies] Found ${fbCookies.length} Facebook/Instagram cookies`);
        fbCookies.slice(0, 3).forEach(c => {
          console.log(`[Cookies]   - ${c.name} @ ${c.domain || c.url}`);
        });
      }

      await fs.writeFile(cookiesFile, JSON.stringify(cookies, null, 2));
      console.log(`[Cookies] ✅ Exported cookies to: ${cookiesFile}`);
    } catch (e) {
      console.log(`[Cookies] ❌ Could not export cookies: ${e.message}`);
      console.log(e);
    }

    // Prepare links.json
    const links = payload.links || payload;
    const linksData = links.map(url => ({ url, name: '', date: '' }));
    await fs.writeFile(path.join(userDataPath, 'links.json'), JSON.stringify(linksData, null, 2));

    // Build environment variables for scraper
    const envVars = Object.assign({}, process.env);
    envVars.LINKS_FILE = path.join(userDataPath, 'links.json');
    envVars.SCREENSHOTS_DIR = path.join(userDataPath, 'screenshots');
    envVars.OUTPUT_DIR = payload.savePath || path.join(userDataPath, 'output');
    envVars.VISUAL_MODE = (payload.visualMode !== false) ? 'true' : 'false';
    envVars.ELECTRON_USER_DATA_DIR = userDataPath;
    envVars.ELECTRON_COOKIES_FILE = path.join(userDataPath, 'electron-cookies.json');

    if (payload.spreadsheetId) envVars.SPREADSHEET_ID = payload.spreadsheetId;
    envVars.SHEET_NAME = payload.sheetName || 'Summaries';

    const chromeExePath = await getChromePath();
    if (chromeExePath) envVars.CHROME_EXE = chromeExePath;

    // 🔴 AUTO-CLOSE CHROME BEFORE SCRAPING
    console.log('[Scraper] ⏹️ Closing any open Chrome windows...');
    try {
      if (process.platform === 'win32') {
        // Windows: use taskkill with aggressive timeout
        const { execSync } = require('child_process');

        // Try multiple times to ensure Chrome is dead
        for (let i = 0; i < 3; i++) {
          try {
            execSync('taskkill /F /IM chrome.exe 2>nul', { stdio: 'pipe' });
          } catch (e) {
          }
        }

        // Wait longer for processes to fully terminate and file locks to release
        await new Promise(r => setTimeout(r, 5000));
      } else {
        // Mac/Linux: use killall with sleep
        for (let i = 0; i < 3; i++) {
          try {
            execSync('killall -9 chrome 2>/dev/null || true', { stdio: 'pipe' });
          } catch (e) {
          }
        }
        await new Promise(r => setTimeout(r, 3000));
      }
    } catch (e) {
      console.log('[Scraper] ⚠️ Error closing Chrome:', e.message);
    }

    const nodePath = getNodePath();
    if (mainWindow) mainWindow.webContents.send('scraping-output', { type: 'info', message: 'Spawning background processes...' });

    scrapingProcess = spawn(nodePath, [scriptPath], {
      env: envVars,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: __dirname,
      windowsHide: true
    });

    scrapingProcess.stdout.on('data', (data) => {
      const message = data.toString().trim();
      console.log('[stdout]', message);
      if (mainWindow) mainWindow.webContents.send('scraping-output', { type: 'info', message });
    });

    scrapingProcess.stderr.on('data', (data) => {
      const message = data.toString().trim();
      console.log('[stderr]', message);
      if (mainWindow) mainWindow.webContents.send('scraping-output', { type: 'error', message });
    });

    return new Promise((resolve) => {
      scrapingProcess.on('close', (code) => {
        console.log('[Scraper] Process closed with code:', code);
        scrapingProcess = null;
        resolve({ success: code === 0 });
      });

      scrapingProcess.on('error', (err) => {
        console.error('[Scraper] Process error:', err);
        scrapingProcess = null;
        log.error('Scraping process error:', err);
        resolve({ success: false, error: err.message });
      });
    });
  } catch (error) {
    console.error('[Scraper] Handler error:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.on('stop-scraping', () => {
  if (scrapingProcess) {
    scrapingProcess.kill();
    scrapingProcess = null;
  }
});

// Reset scraping process (in case it gets stuck)
ipcMain.handle('reset-scraping', async () => {
  if (scrapingProcess) {
    try {
      if (!scrapingProcess.killed) {
        scrapingProcess.kill('SIGKILL');
      }
    } catch (e) {
      console.log('[Reset] Error killing process:', e.message);
    }
    scrapingProcess = null;
  }
  return { success: true, message: 'Scraping process reset' };
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

  // 🔐 Use a dedicated local profile for the UI browser
  // Puppeteer will also use this SAME profile for scraping to ensure login state is shared
  const userDataDir = path.join(app.getPath('userData'), 'chrome-profile');

  console.log(`[Browser] Opening Chrome at ${userDataDir}`);

  await fs.mkdir(userDataDir, { recursive: true });
  spawn(chromeExe, [
    `--user-data-dir=${userDataDir}`,
    'https://www.facebook.com',
    'https://www.instagram.com'
  ], { detached: true });

  console.log(`✅ Chrome process spawned (detached)`);
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
ipcMain.handle('get-app-version', () => app.getVersion());

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
