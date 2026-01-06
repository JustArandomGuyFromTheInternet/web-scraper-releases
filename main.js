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
autoUpdater.on('checking-for-update', () => {
  log.info('Checking for updates...');
});

autoUpdater.on('update-available', (info) => {
  log.info('Update available:', info.version);
  if (mainWindow && !mainWindow.isDestroyed()) {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Available',
      message: `New version ${info.version} is available.`,
      detail: 'Downloading update in background...',
      buttons: ['OK']
    });
  }
});

autoUpdater.on('update-not-available', (info) => {
  log.info('Update not available:', info.version);
});

autoUpdater.on('error', (err) => {
  log.error('Error in auto-updater:', err);
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

// OAuth Paths - configure in production
if (app.isPackaged) {
  const userDataPath = app.getPath('userData');
  const OAUTH_CREDENTIALS_PATH = path.join(userDataPath, 'oauth_credentials.json');
  const GOOGLE_TOKEN_PATH = path.join(userDataPath, 'token.json');

  // 🆕 Auto-copy from resources if missing
  (async () => {
    try {
      // Check if oauth_credentials.json exists in userData
      await fs.access(OAUTH_CREDENTIALS_PATH);
      console.log('✅ OAuth credentials already exist in userData');
    } catch {
      // Not found - try to copy from resources
      const resourcesPath = path.join(process.resourcesPath, 'oauth_credentials.json');

      try {
        await fs.copyFile(resourcesPath, OAUTH_CREDENTIALS_PATH);
        console.log(`✅ OAuth credentials copied to: ${OAUTH_CREDENTIALS_PATH}`);
      } catch (copyError) {
        console.warn('⚠️ Could not copy OAuth credentials:', copyError.message);
        console.warn('   User will need to provide credentials manually via Settings.');
      }
    }
  })();

  // Set env vars
  process.env.OAUTH_CREDENTIALS_PATH = OAUTH_CREDENTIALS_PATH;
  process.env.GOOGLE_TOKEN_PATH = GOOGLE_TOKEN_PATH;

  console.log('🔧 OAuth paths configured (PRODUCTION):');
  console.log('   OAUTH_CREDENTIALS_PATH:', OAUTH_CREDENTIALS_PATH);
  console.log('   GOOGLE_TOKEN_PATH:', GOOGLE_TOKEN_PATH);
} else {
  console.log('🔧 Development mode: OAuth uses local files');
}

// Settings handlers
ipcMain.handle('get-settings', async () => {
  try {
    const data = await fs.readFile(SETTINGS_PATH, 'utf8');
    return JSON.parse(data);
  } catch {
    return {};
  }
});

app.whenReady().then(async () => {
  // 1. Dynamic License Check
  try {
    const { checkLicense } = await import('./src/license_manager.mjs');
    const license = await checkLicense();

    if (!license.valid) {
      dialog.showMessageBoxSync({
        type: 'error',
        title: 'License Expired',
        message: 'Your trial period has ended.',
        detail: `Machine ID: ${license.machineId || 'Unknown'}\nPlease contact support to purchase a license.`
      });
      app.quit();
      return;
    }

    if (!license.isPaid) {
      console.log(`[License] Trial mode: ${license.daysLeft} days remaining`);
    } else {
      console.log('[License] Licensed Pro version');
    }
  } catch (err) {
    console.error('License check failed (bypass):', err);
    // In case of error (e.g. offline fallback failed), we might choose to blocking or allow. 
    // Here we allow for robustness, but log the error.
  }

  // 2. Normal Startup
  createWindow();

  // 3. Register IPC handlers for settings
  ipcMain.handle('save-settings', async (event, settings) => {
    try {
      await fs.writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2));

      // Update .env file if key is present
      if (settings.apiKey) {
        process.env.GEMINI_API_KEY = settings.apiKey;
        try {
          const envPath = path.join(app.getAppPath(), '.env');
          let envContent = '';
          try { envContent = await fs.readFile(envPath, 'utf8'); } catch { }

          if (envContent.includes('GEMINI_API_KEY=')) {
            envContent = envContent.replace(/GEMINI_API_KEY=.*/g, `GEMINI_API_KEY=${settings.apiKey}`);
          } else {
            envContent += `\nGEMINI_API_KEY=${settings.apiKey}\n`;
          }

          if (!app.isPackaged) await fs.writeFile(envPath, envContent);
        } catch (e) {
          console.log('Error updating .env:', e.message);
        }
      }
      return { success: true };
    } catch (error) {
      throw new Error(`Failed to save settings: ${error.message}`);
    }
  });

  // NEW: License IPC Handlers
  ipcMain.handle('get-license-info', async () => {
    try {
      const { checkLicense } = await import('./src/license_manager.mjs');
      return await checkLicense();
    } catch (e) {
      console.error('IPC get-license-info error:', e);
      return { valid: false, error: e.message };
    }
  });

  ipcMain.handle('activate-license', async (event, key) => {
    try {
      const { activateLicense } = await import('./src/license_manager.mjs');
      return await activateLicense(key);
    } catch (e) {
      console.error('IPC activate-license error:', e);
      return { success: false, error: e.message };
    }
  });

  // More IPC handlers...
  ipcMain.handle('test-api', () => 'API is working');

  // Check all API connections status
  ipcMain.handle('check-api-status', async () => {
    const status = {
      ipc: true,
      websocket: webSocketServer !== null && webSocketServer.clients.size >= 0,
      googleSheets: googleSheetsClient !== null,
      credentials: false
    };

    try {
      const credentials = await fs.readFile(CREDENTIALS_PATH, 'utf8');
      status.credentials = credentials.length > 0;
    } catch (error) {
      status.credentials = false;
    }

    return status;
  });

  // Browse for save path
  ipcMain.handle('browse-save-path', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'בחר תיקייה לשמירת התוצאות',
      defaultPath: app.getPath('documents')
    });

    if (!result.canceled) {
      return result.filePaths[0];
    }
    throw new Error('No directory selected');
  });

  // Browse for existing file
  ipcMain.handle('browse-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      title: 'בחר קובץ CSV קיים',
      defaultPath: app.getPath('documents'),
      filters: [
        { name: 'CSV Files', extensions: ['csv'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0];
    }
    throw new Error('No file selected');
  });

  // Get icon path based on environment
  ipcMain.handle('get-icon-path', () => {
    return app.isPackaged
      ? path.join(process.resourcesPath, 'ICON-modified.png')
      : path.join(__dirname, 'ICON-modified.png');
  });

  // Load OAuth Credentials file
  ipcMain.handle('load-oauth-credentials', async () => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        title: 'Select oauth_credentials.json file',
        defaultPath: app.getPath('downloads'),
        filters: [
          { name: 'JSON Files', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });

      if (result.canceled || !result.filePaths.length) {
        throw new Error('No file selected');
      }

      const sourceFile = result.filePaths[0];
      const targetFile = path.join(app.getPath('userData'), 'oauth_credentials.json');

      // Copy file to userData
      await fs.copyFile(sourceFile, targetFile);

      console.log(`[OAuth] ✓ OAuth credentials copied to: ${targetFile}`);

      return {
        success: true,
        message: 'OAuth credentials loaded successfully!',
        path: targetFile
      };
    } catch (error) {
      console.error('Failed to load OAuth credentials:', error);
      throw new Error(`Failed to load OAuth credentials: ${error.message}`);
    }
  });


  // Run scraping process
  ipcMain.handle('run-scrape', async (event, payload) => {
    try {
      console.log('\n=== IPC HANDLER DEBUG ===');
      console.log('Received payload:', JSON.stringify(payload, null, 2));
      console.log('========================\n');

      if (scrapingProcess) {
        throw new Error('Scraping process already running');
      }

      // Use the new scrape controller
      let scriptPath;
      let unpackedPath;
      try {
        scriptPath = getModulePath('src/scrape_controller.mjs');
        console.log(`[SUCCESS] Found scrape_controller.mjs at: ${scriptPath}`);

        // Determine unpacked path for child process
        if (app.isPackaged) {
          const appPath = app.getAppPath();
          if (appPath.includes('app.asar')) {
            unpackedPath = appPath.replace(/app\.asar.*/, 'app.asar.unpacked');
          }
        }
      } catch (error) {
        throw new Error(`Failed to locate scrape_controller.mjs: ${error.message}`);
      }

      // Support legacy array-of-links or new payload { links, spreadsheetId, sheetName, smartTableSync }
      let links = [];
      let spreadsheetId = null;
      let sheetName = null;
      let smartTableSync = false;
      let existingFile = null;

      if (Array.isArray(payload)) {
        links = payload;
      } else if (payload && Array.isArray(payload.links)) {
        links = payload.links;
        spreadsheetId = payload.spreadsheetId || null;
        sheetName = payload.sheetName || null;
        smartTableSync = payload.smartTableSync || false;
        existingFile = payload.existingFile || null;
      } else {
        throw new Error('Invalid payload for run-scrape. Expected links array or { links, spreadsheetId, sheetName }');
      }

      // Write links to links.json file in userData to avoid permission issues
      const linksData = links.map(url => ({ url, name: '', date: '' }));
      const userDataPath = app.getPath('userData');
      const linksPath = path.join(userDataPath, 'links.json');
      await fs.writeFile(linksPath, JSON.stringify(linksData, null, 2));
      console.log(`[INFO] Wrote ${linksData.length} links to ${linksPath}`);

      // Build environment for child process so it can read SPREADSHEET_ID / SHEET_NAME
      const envVars = Object.assign({}, process.env);

      // CRITICAL: Set NODE_PATH to find node_modules
      // This is essential for ES module imports when running from unpacked directory
      const nodeModulesPaths = [
        path.join(__dirname, 'node_modules'),
        path.join(app.getAppPath(), 'node_modules'),
      ];

      if (app.isPackaged && unpackedPath) {
        nodeModulesPaths.push(path.join(unpackedPath, 'node_modules'));
        nodeModulesPaths.push(path.join(unpackedPath, '..', 'node_modules'));
      }

      envVars.NODE_PATH = nodeModulesPaths.join(path.delimiter);
      console.log(`[INFO] NODE_PATH set to: ${envVars.NODE_PATH.substring(0, 100)}...`);

      // Pass explicit paths to child process to avoid process.cwd() issues
      envVars.LINKS_FILE = linksPath;
      envVars.SCREENSHOTS_DIR = path.join(userDataPath, 'screenshots');
      envVars.OAUTH_CREDENTIALS_PATH = process.env.OAUTH_CREDENTIALS_PATH;
      envVars.GOOGLE_TOKEN_PATH = process.env.GOOGLE_TOKEN_PATH;

      // CRITICAL: Explicitly pass API key from settings to child process
      // This ensures settings override .env file in child process
      if (process.env.GEMINI_API_KEY) {
        envVars.GEMINI_API_KEY = process.env.GEMINI_API_KEY;
        const keyPreview = process.env.GEMINI_API_KEY.substring(0, 15);
        console.log(`[OK] Passing API key to scraper: ${keyPreview}...`);
        console.log(`[OK] Full key length: ${process.env.GEMINI_API_KEY.length} characters`);
      } else {
        console.log(`[ERR] No GEMINI_API_KEY in process.env!`);
      }

      // Ensure Chrome profile is in a writable location (userData)
      envVars.USER_DATA_DIR = path.join(userDataPath, 'chrome-profile');

      // CRITICAL: Pass Chrome executable path to child process
      // This allows Puppeteer to find system Chrome instead of bundled Chromium
      const chromeExePath = process.env.CHROME_EXE ||
        (await getChromePath ? await getChromePath() : null);
      if (chromeExePath) {
        envVars.CHROME_EXE = chromeExePath;
        console.log(`[OK] Passing Chrome path to scraper: ${chromeExePath}`);
      } else {
        console.log(`[WARN] No Chrome path found for child process`);
      }

      // Resolve output directory: if relative, make it absolute in userData
      let outputDir = payload.savePath || path.join(userDataPath, 'output');
      if (outputDir.startsWith('.')) {
        outputDir = path.join(userDataPath, 'output');
      }
      envVars.OUTPUT_DIR = outputDir;

      // Handle existing Excel file: if provided, use it; otherwise create new
      if (existingFile) {
        envVars.EXCEL_FILE = existingFile;
        console.log(`[OK] Using existing Excel file: ${existingFile}`);
      } else {
        // Create new Excel file
        const fileName = payload.fileName || 'summaries.xlsx';
        const excelPath = path.join(outputDir, fileName);
        envVars.EXCEL_FILE = excelPath;

        // Ensure directory exists
        await fs.mkdir(outputDir, { recursive: true });
      }

      console.log('\n=== MAIN.JS DEBUG ===');
      console.log('Received payload:', JSON.stringify(payload, null, 2));
      console.log('spreadsheetId:', spreadsheetId);
      console.log('sheetName:', sheetName);
      console.log('visualMode:', payload.visualMode);
      console.log('LINKS_FILE:', envVars.LINKS_FILE);
      console.log('SCREENSHOTS_DIR:', envVars.SCREENSHOTS_DIR);
      console.log('OUTPUT_DIR:', envVars.OUTPUT_DIR);
      console.log('=====================\n');

      if (spreadsheetId) envVars.SPREADSHEET_ID = spreadsheetId;
      // Always set SHEET_NAME - use provided value or default to 'Summaries'
      envVars.SHEET_NAME = sheetName || 'Summaries';
      if (payload.updateExisting) envVars.UPDATE_EXISTING = 'true';
      // Always set VISUAL_MODE to true if visualMode is in payload (default behavior)
      envVars.VISUAL_MODE = (payload.visualMode !== false) ? 'true' : 'false';
      console.log(`[INFO] Setting VISUAL_MODE=${envVars.VISUAL_MODE}`);

      // Determine the working directory for the spawned process
      // When packaged, we need to ensure the process can find relative imports
      let cwd = __dirname;
      let finalScriptPath = scriptPath;

      if (app.isPackaged && unpackedPath) {
        // Set cwd to the resources directory (parent of app.asar.unpacked)
        // This gives access to node_modules which is at the same level as app.asar.unpacked
        cwd = path.dirname(unpackedPath);
        // Use relative path from unpacked directory
        finalScriptPath = path.join(unpackedPath, 'src', 'scrape_controller.mjs');
      }

      console.log(`[INFO] Spawning scrape process with:`);
      console.log(`  - Script: ${finalScriptPath}`);
      console.log(`  - CWD: ${cwd}`);
      console.log(`  - App.isPackaged: ${app.isPackaged}`);
      console.log(`  - File exists: ${fsSync.existsSync(finalScriptPath)}`);

      scrapingProcess = spawn('node', [finalScriptPath], {
        env: envVars,
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: cwd,
        windowsHide: true
      });

      scrapingProcess.stdout.on('data', (data) => {
        const message = data.toString().trim();
        console.log(`[Scrape Process] ${message}`);
        if (mainWindow && !mainWindow.isDestroyed()) {
          let type = 'info';
          if (message.includes('✅')) type = 'success';
          if (message.includes('⚠️')) type = 'warning';
          if (message.includes('❌')) type = 'error';
          if (message.includes('DEBUG:')) type = 'debug';
          mainWindow.webContents.send('scraping-output', { type, message });
        }
      });

      scrapingProcess.stderr.on('data', (data) => {
        const errorMessage = data.toString().trim();
        console.error(`[Scrape Process Error] ${errorMessage}`);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('scraping-output', { type: 'error', message: errorMessage });
        }
      });

      return new Promise((resolve, reject) => {
        scrapingProcess.on('close', async (code, signal) => {
          scrapingProcess = null;
          console.log(`[Scrape Process] Exited with code ${code}, signal ${signal}`);

          // If killed by signal (user stopped), consider it a success or just return
          if (signal === 'SIGTERM' || signal === 'SIGKILL' || code === null) {
            console.log('Process killed by user');
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('scraping-output', { type: 'warning', message: '🛑 הסריקה הופסקה על ידי המשתמש' });
            }
            resolve({ success: true, stopped: true });
            return;
          }

          if (code === 0) {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('scraping-finished');
              mainWindow.webContents.send('scraping-output', { type: 'success', message: '✅ הסריקה הושלמה בהצלחה!' });
            }
            resolve({ success: true });
          } else {
            const errorMsg = `Process exited with code ${code}`;
            console.error(`[Scrape Process] ${errorMsg}`);
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('scraping-error');
              mainWindow.webContents.send('scraping-output', { type: 'error', message: `❌ שגיאה: ${errorMsg}` });
            }
            reject(new Error(errorMsg));
          }
        });

        scrapingProcess.on('error', (error) => {
          console.error(`[Scrape Process] Failed to start: ${error.message}`);
          scrapingProcess = null;
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('scraping-error');
            mainWindow.webContents.send('scraping-output', { type: 'error', message: `❌ שגיאה בהפעלת התהליך: ${error.message}` });
          }
          reject(error);
        });
      });
    } catch (error) {
      console.error('Error running scrape:', error);
      throw error;
    }
  });

  // Stop Scraping Handler
  ipcMain.on('stop-scraping', () => {
    if (scrapingProcess) {
      console.log('Stopping scraping process...');
      scrapingProcess.kill();
      scrapingProcess = null;
      if (mainWindow) {
        mainWindow.webContents.send('scraping-output', { type: 'warning', message: '🛑 Scraping stopped by user' });
      }
    }

    // Also stop repair process if running
    if (repairProcess) {
      console.log('Stopping repair process...');
      import('./src/repair_manager.mjs').then(module => {
        if (module.stopRepair) {
          module.stopRepair();
        }
      }).catch(error => {
        console.error('Error stopping repair:', error);
      });
      repairProcess = null;
      if (mainWindow) {
        mainWindow.webContents.send('scraping-output', { type: 'warning', message: '🛑 Repair stopped by user' });
      }
    }
  });

  // Repair Data Handler (legacy - for backward compatibility)
  ipcMain.handle('repair-data', async (event, payload) => {
    try {
      const modulePath = 'file://' + getModulePath('src/repair_manager.mjs').replace(/\\/g, '/');
      const { repairSheetData } = await import(modulePath);
      const spreadsheetId = payload?.spreadsheetId || process.env.SPREADSHEET_ID;
      const sheetName = payload?.sheetName || process.env.SHEET_NAME || 'גיליון1';

      const result = await repairSheetData(spreadsheetId, sheetName, mainWindow);
      return result;
    } catch (error) {
      return { success: false, message: error.message };
    }
  });

  // Repair Field Handler (new - for specific field repair)
  ipcMain.handle('repair-field', async (event, payload) => {
    try {
      repairProcess = { type: 'field', field: payload?.field }; // Mark repair as running
      const modulePath = 'file://' + path.join(__dirname, 'src', 'repair_manager.mjs').replace(/\\/g, '/');
      const { repairField } = await import(modulePath);
      const spreadsheetId = payload?.spreadsheetId || process.env.SPREADSHEET_ID;
      const sheetName = payload?.sheetName || process.env.SHEET_NAME || 'גיליון1';
      const field = payload?.field; // 'likes', 'comments', 'shares', 'content', 'sender', 'date', 'group'

      if (!field) {
        repairProcess = null;
        return { success: false, message: 'Field parameter is required' };
      }

      const result = await repairField(spreadsheetId, sheetName, field, mainWindow);
      repairProcess = null;
      return result;
    } catch (error) {
      repairProcess = null;
      return { success: false, message: error.message };
    }
  });

  // Repair All Fields Handler
  ipcMain.handle('repair-all-fields', async (event, payload) => {
    try {
      repairProcess = { type: 'all' }; // Mark repair as running
      const modulePath = 'file://' + path.join(__dirname, 'src', 'repair_manager.mjs').replace(/\\/g, '/');
      const { repairAllFields } = await import(modulePath);
      const spreadsheetId = payload?.spreadsheetId || process.env.SPREADSHEET_ID;
      const sheetName = payload?.sheetName || process.env.SHEET_NAME || 'גיליון1';

      const result = await repairAllFields(spreadsheetId, sheetName, mainWindow);
      repairProcess = null;
      return result;
    } catch (error) {
      repairProcess = null;
      return { success: false, message: error.message };
    }
  });

  // Delete screenshots handler
  ipcMain.handle('delete-screenshots', async () => {
    try {
      const screenshotsDir = path.join(app.getPath('userData'), 'screenshots');

      // Check if directory exists first
      try {
        await fs.access(screenshotsDir);
      } catch {
        return { success: true, count: 0 };
      }

      const files = await fs.readdir(screenshotsDir);
      let count = 0;
      for (const file of files) {
        if (file.match(/\.(jpg|jpeg|png|webp)$/i)) {
          await fs.unlink(path.join(screenshotsDir, file));
          count++;
        }
      }
      return { success: true, count };
    } catch (error) {
      return { success: false, message: error.message };
    }
  });

  // Open screenshots folder handler
  ipcMain.handle('open-screenshots-folder', async () => {
    try {
      const screenshotsDir = path.join(app.getPath('userData'), 'screenshots');
      await fs.mkdir(screenshotsDir, { recursive: true }); // Ensure it exists
      await shell.openPath(screenshotsDir);
      return { success: true };
    } catch (error) {
      return { success: false, message: error.message };
    }
  });


  // Test Google Sheets connection with OAuth
  ipcMain.handle('test-sheets-connection', async (event, { url }) => {
    try {
      const modulePath = 'file://' + getModulePath('sheets_oauth.mjs').replace(/\\/g, '/');

      // If no URL provided, just check if authenticated
      if (!url) {
        const { isAuthenticated } = await import(modulePath);
        const authenticated = await isAuthenticated();

        if (authenticated) {
          return {
            success: true,
            title: 'Authenticated',
            message: 'Successfully connected to Google'
          };
        } else {
          throw new Error('Not authenticated with Google. Please click "Connect to Google" button to authenticate.');
        }
      }

      // If URL provided, test actual connection
      const { testConnection } = await import(modulePath);
      const result = await testConnection(url);

      return {
        success: true,
        title: result.title,
        message: 'Successfully connected to Google Sheets'
      };
    } catch (error) {
      console.error('Sheets connection error:', error);

      // Provide helpful error messages
      if (error.message.includes('oauth_credentials.json')) {
        throw new Error('לא נמצא קובץ oauth_credentials.json. עקוב אחרי המדריך ב-OAUTH_SETUP.md');
      }

      throw new Error(error.message || 'Failed to connect to Google Sheets');
    }
  });

  // Authenticate with Google OAuth
  ipcMain.handle('authenticate-google', async () => {
    try {
      console.log('Starting Google OAuth authentication...');
      const modulePath = 'file://' + getModulePath('sheets_oauth.mjs').replace(/\\/g, '/');
      const { getAuthenticatedClient } = await import(modulePath);

      // This will trigger OAuth flow if no valid token exists
      await getAuthenticatedClient();

      return { success: true, message: 'Successfully authenticated with Google' };
    } catch (error) {
      console.error('OAuth authentication error:', error);
      return { success: false, error: error.message };
    }
  });

  // Check if user is authenticated with OAuth
  ipcMain.handle('is-authenticated', async () => {
    try {
      const modulePath = 'file://' + getModulePath('sheets_oauth.mjs').replace(/\\/g, '/');
      const { isAuthenticated } = await import(modulePath);
      return await isAuthenticated();
    } catch (error) {
      return false;
    }
  });

  // Force Google OAuth authentication
  ipcMain.handle('force-google-auth', async () => {
    try {
      console.log('Starting forced Google OAuth...');
      const modulePath = 'file://' + getModulePath('sheets_oauth.mjs').replace(/\\/g, '/');
      const { getAuthenticatedClient } = await import(modulePath);

      // This will trigger OAuth flow if no token exists
      await getAuthenticatedClient();

      return { success: true, message: 'Successfully authenticated with Google' };
    } catch (error) {
      console.error('OAuth error:', error);
      return { success: false, error: error.message };
    }
  });

  // Logout from OAuth
  ipcMain.handle('logout-sheets', async () => {
    try {
      const modulePath = 'file://' + getModulePath('sheets_oauth.mjs').replace(/\\/g, '/');
      const { logout } = await import(modulePath);
      return await logout();
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Open browser for Facebook/Instagram login
  ipcMain.handle('open-browser', async () => {
    try {
      // Use Chrome executable path from config or environment, with fallback to registry
      const chromeExe = process.env.CHROME_EXE ||
        (await getChromePath()) ||
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
      const userDataDir = path.join(app.getPath('userData'), 'chrome-profile');

      // Make sure the directory exists
      await fs.mkdir(userDataDir, { recursive: true });

      // Open Chrome with the user data dir pointing to Facebook
      // User will login here and cookies will be saved for scraping
      spawn(chromeExe, [
        `--user-data-dir=${userDataDir}`,
        '--profile-directory=Default',
        'https://www.facebook.com',
        'https://www.instagram.com',
        '--force-device-scale-factor=0.85'
      ], { detached: true });

      console.log('[OK] Chrome opened with Facebook/Instagram - please login');
      return { success: true, message: 'Chrome opened - please login to Facebook and Instagram' };
    } catch (error) {
      console.error('[ERR] Failed to open browser:', error);
      throw new Error(`Failed to open browser: ${error.message}`);
    }
  });

  // let mainWindow; // GLOBAL DECLARATION IS AT THE TOP NOAW
  let scrapingProcess = null;
  let repairProcess = null;
  let webSocketServer = null;
  let googleSheetsClient = null;

  // Google Sheets configuration
  const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
  const CREDENTIALS_PATH = path.join(app.getPath('userData'), 'credentials.json'); // Use userData for credentials

  /* DUPLICATE createWindow REMOVED */

  app.whenReady().then(async () => {
    // OAuth Paths - only configure in production (packaged app)
    if (app.isPackaged) {
      const OAUTH_CREDENTIALS_PATH = path.join(app.getPath('userData'), 'oauth_credentials.json');
      const GOOGLE_TOKEN_PATH = path.join(app.getPath('userData'), 'token.json');

      // Auto-setup: Copy oauth_credentials.json from resources to userData if it doesn't exist
      try {
        await fs.access(OAUTH_CREDENTIALS_PATH);
        console.log('✅ OAuth credentials already exist in userData');
      } catch {
        // File doesn't exist in userData, try to copy from resources
        try {
          const resourcesPath = path.join(process.resourcesPath, 'oauth_credentials.json');

          console.log(`📋 Attempting to copy OAuth credentials from: ${resourcesPath}`);

          await fs.access(resourcesPath); // Check if source exists
          await fs.copyFile(resourcesPath, OAUTH_CREDENTIALS_PATH);

          console.log(`✅ OAuth credentials auto-copied to: ${OAUTH_CREDENTIALS_PATH}`);
        } catch (copyError) {
          console.warn('⚠️ Could not auto-copy OAuth credentials. User will need to provide the file manually.');
          console.warn('   This is expected if oauth_credentials.json was not included in the build.');
        }
      }

      // Fix redirect_uris if needed (ensure :3000 port)
      try {
        const credContent = await fs.readFile(OAUTH_CREDENTIALS_PATH, 'utf8');
        const credentials = JSON.parse(credContent);

        if (credentials.installed && credentials.installed.redirect_uris) {
          let fixed = false;
          credentials.installed.redirect_uris = credentials.installed.redirect_uris.map(uri => {
            if (uri === 'http://localhost' || uri === 'http://localhost/') {
              fixed = true;
              return 'http://localhost:3000';
            }
            return uri;
          });

          if (fixed) {
            await fs.writeFile(OAUTH_CREDENTIALS_PATH, JSON.stringify(credentials, null, 2));
            console.log('✅ Fixed redirect_uris to include port :3000');
          }
        }
      } catch (fixError) {
        console.warn('⚠️ Could not auto-fix redirect_uris:', fixError.message);
      }

      // Set env vars for the current process (so sheets_oauth.mjs sees them)
      process.env.OAUTH_CREDENTIALS_PATH = OAUTH_CREDENTIALS_PATH;
      process.env.GOOGLE_TOKEN_PATH = GOOGLE_TOKEN_PATH;

      console.log('🔧 OAuth paths configured (PRODUCTION):');
      console.log('   OAUTH_CREDENTIALS_PATH:', OAUTH_CREDENTIALS_PATH);
      console.log('   GOOGLE_TOKEN_PATH:', GOOGLE_TOKEN_PATH);
    } else {
      // Development mode - still set env vars for userData paths
      const userDataPath = app.getPath('userData');
      const OAUTH_CREDENTIALS_PATH = path.join(userDataPath, 'oauth_credentials.json');
      const GOOGLE_TOKEN_PATH = path.join(userDataPath, 'token.json');

      process.env.OAUTH_CREDENTIALS_PATH = OAUTH_CREDENTIALS_PATH;
      process.env.GOOGLE_TOKEN_PATH = GOOGLE_TOKEN_PATH;

      console.log('[DEV] Development mode: OAuth will use userData files');
      console.log('   OAUTH_CREDENTIALS_PATH:', OAUTH_CREDENTIALS_PATH);
      console.log('   GOOGLE_TOKEN_PATH:', GOOGLE_TOKEN_PATH);
    }

    // Create required directories if they don't exist
    const userDataPath = app.getPath('userData');
    const screenshotsDir = path.join(userDataPath, 'screenshots');
    const outputDir = path.join(userDataPath, 'output');

    try {
      await fs.mkdir(screenshotsDir, { recursive: true });
      await fs.mkdir(outputDir, { recursive: true });
      console.log('[INFO] Required directories created/verified');
    } catch (error) {
      console.error('[ERR] Failed to create directories:', error);
    }

    createWindow();
    initializeWebSocket();

    // 🔄 Check for updates after app is ready (with delay to ensure window is shown)
    setTimeout(() => {
      autoUpdater.checkForUpdatesAndNotify();
    }, 3000);
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  // Initialize WebSocket server for real-time communication
  function initializeWebSocket() {
    try {
      webSocketServer = new WebSocket.Server({ port: 8080 });

      webSocketServer.on('connection', (ws) => {
        console.log('Frontend connected via WebSocket');

        ws.on('message', (message) => {
          try {
            const data = JSON.parse(message.toString());
            handleWebSocketMessage(data);
          } catch (error) {
            console.error('WebSocket message error:', error);
          }
        });

        ws.on('close', () => {
          console.log('Frontend disconnected');
        });
      });

      webSocketServer.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
          console.log('[WARN] Port 8080 already in use, WebSocket server skipped');
          webSocketServer = null;
        } else {
          console.error('WebSocket server error:', error);
        }
      });

      console.log('WebSocket server started on port 8080');
    } catch (error) {
      if (error.code === 'EADDRINUSE') {
        console.log('[WARN] Port 8080 already in use, WebSocket server skipped');
        webSocketServer = null;
      } else {
        console.error('Failed to start WebSocket server:', error);
      }
    }
  }

  // Handle WebSocket messages from frontend
  function handleWebSocketMessage(data) {
    switch (data.type) {
      case 'start-scraping':
        // This is handled via IPC now, but kept for compatibility
        break;
      case 'stop-scraping':
        if (scrapingProcess) scrapingProcess.kill();
        break;
    }
  }

});
