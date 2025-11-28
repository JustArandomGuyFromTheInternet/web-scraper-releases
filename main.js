// Suppress deprecation warnings (punycode is used by dependencies, not our code)
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  // Only suppress punycode deprecation warnings
  if (warning.name === 'DeprecationWarning' && warning.message.includes('punycode')) {
    // Silently ignore - this is from dependencies (googleapis/puppeteer)
    return;
  }
  // Show other warnings
  console.warn(warning.name, warning.message);
});

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const { spawn } = require('child_process');
const WebSocket = require('ws');
const { google } = require('googleapis');
const { readFileSync, writeFileSync } = require('fs');
require('dotenv').config();

// 🔄 Auto-Updater Configuration
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

// Configure auto-updater logging
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';
log.info('App starting...');

// Auto-updater event handlers
autoUpdater.on('checking-for-update', () => {
  log.info('Checking for updates...');
});

autoUpdater.on('update-available', (info) => {
  log.info('Update available:', info.version);
  if (mainWindow && !mainWindow.isDestroyed()) {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'עדכון זמין',
      message: `גרסה חדשה ${info.version} זמינה להורדה.`,
      detail: 'העדכון מתחיל להירדות ברקע...',
      buttons: ['אישור']
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
  let message = `מוריד עדכון: ${progressObj.percent.toFixed(1)}%`;
  log.info(message);
});

autoUpdater.on('update-downloaded', (info) => {
  log.info('Update downloaded:', info.version);
  if (mainWindow && !mainWindow.isDestroyed()) {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'עדכון מוכן',
      message: 'עדכון הותקן בהצלחה.',
      detail: 'האפליקציה תופעל מחדש כעת להפעלת העדכון.',
      buttons: ['הפעל מחדש', 'מאוחר יותר']
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  }
});

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

ipcMain.handle('save-settings', async (event, settings) => {
  try {
    await fs.writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2));

    // Update .env file with API key
    if (settings.apiKey) {
      const envPath = path.join(process.cwd(), '.env');
      let envContent = '';
      try {
        envContent = readFileSync(envPath, 'utf8');
      } catch { }

      // Update or add GEMINI_API_KEY
      if (envContent.includes('GEMINI_API_KEY=')) {
        envContent = envContent.replace(/GEMINI_API_KEY=.*/g, `GEMINI_API_KEY=${settings.apiKey}`);
      } else {
        envContent += `\nGEMINI_API_KEY=${settings.apiKey}\n`;
      }

      writeFileSync(envPath, envContent);
      process.env.GEMINI_API_KEY = settings.apiKey;
    }

    return { success: true };
  } catch (error) {
    throw new Error(`Failed to save settings: ${error.message}`);
  }
});

// Register IPC handlers
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
    const credentials = readFileSync(CREDENTIALS_PATH, 'utf8');
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
    const scriptPath = path.join(__dirname, 'src', 'scrape_controller.mjs');

    // Support legacy array-of-links or new payload { links, spreadsheetId, sheetName, smartTableSync }
    let links = [];
    let spreadsheetId = null;
    let sheetName = null;
    let smartTableSync = false;

    if (Array.isArray(payload)) {
      links = payload;
    } else if (payload && Array.isArray(payload.links)) {
      links = payload.links;
      spreadsheetId = payload.spreadsheetId || null;
      sheetName = payload.sheetName || null;
      smartTableSync = payload.smartTableSync || false;
    } else {
      throw new Error('Invalid payload for run-scrape. Expected links array or { links, spreadsheetId, sheetName }');
    }

    // Write links to links.json file
    const linksData = links.map(url => ({ url, name: '', date: '' }));
    const linksPath = path.join(process.cwd(), 'links.json');
    await fs.writeFile(linksPath, JSON.stringify(linksData, null, 2));
    console.log(`✅ Wrote ${linksData.length} links to ${linksPath}`);

    // Build environment for child process so it can read SPREADSHEET_ID / SHEET_NAME
    const envVars = Object.assign({}, process.env);
    console.log('\n=== MAIN.JS DEBUG ===');
    console.log('Received payload:', JSON.stringify(payload, null, 2));
    console.log('spreadsheetId:', spreadsheetId);
    console.log('sheetName:', sheetName);
    console.log('visualMode:', payload.visualMode);
    console.log('=====================\n');

    if (spreadsheetId) envVars.SPREADSHEET_ID = spreadsheetId;
    // Always set SHEET_NAME - use provided value or default to 'Summaries'
    envVars.SHEET_NAME = sheetName || 'Summaries';
    if (payload.updateExisting) envVars.UPDATE_EXISTING = 'true';
    // Always set VISUAL_MODE to true if visualMode is in payload (default behavior)
    envVars.VISUAL_MODE = (payload.visualMode !== false) ? 'true' : 'false';
    console.log(`Setting VISUAL_MODE=${envVars.VISUAL_MODE}`);

    scrapingProcess = spawn('node', [scriptPath], {
      env: envVars,
      stdio: ['pipe', 'pipe', 'pipe']
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
    const { repairSheetData } = await import('./src/repair_manager.mjs');
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
    const { repairField } = await import('./src/repair_manager.mjs');
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
    const { repairAllFields } = await import('./src/repair_manager.mjs');
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
    const screenshotsDir = path.join(process.cwd(), 'visual_engine', 'screen_shots');
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
    const screenshotsDir = path.join(process.cwd(), 'visual_engine', 'screen_shots');
    await shell.openPath(screenshotsDir);
    return { success: true };
  } catch (error) {
    return { success: false, message: error.message };
  }
});


// Test Google Sheets connection with OAuth
ipcMain.handle('test-sheets-connection', async (event, { url }) => {
  try {
    if (!url) {
      throw new Error('URL is required');
    }

    // Try OAuth first
    const { testConnection } = await import('./sheets_oauth.mjs');
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

// Check if user is authenticated with OAuth
ipcMain.handle('is-authenticated', async () => {
  try {
    const { isAuthenticated } = await import('./sheets_oauth.mjs');
    return await isAuthenticated();
  } catch (error) {
    return false;
  }
});

// Force Google OAuth authentication
ipcMain.handle('force-google-auth', async () => {
  try {
    console.log('Starting forced Google OAuth...');
    const { getAuthenticatedClient } = await import('./sheets_oauth.mjs');

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
    const { logout } = await import('./sheets_oauth.mjs');
    return await logout();
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Open browser for OAuth
ipcMain.handle('open-browser', async () => {
  try {
    const { openBrowser } = await import('./open_browser.mjs');

    // Run in background - don't wait for it to complete
    openBrowser().catch(error => {
      console.error('Browser error:', error);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('scraping-output', {
          type: 'error',
          message: `Browser error: ${error.message}`
        });
      }
    });
    return { success: true, message: 'Browser opening...' };
  } catch (error) {
    console.error('Failed to start browser:', error);
    throw new Error(`Failed to open browser: ${error.message}`);
  }
});

let mainWindow;
let scrapingProcess = null;
let repairProcess = null;
let webSocketServer = null;
let googleSheetsClient = null;

// Google Sheets configuration
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 750,
    height: 850,
    minWidth: 700,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(process.cwd(), "preload.js"),
    },
    icon: path.join(__dirname, "icon.png"),
    titleBarStyle: 'default',
  });

  mainWindow.loadFile("index.html");

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Register keyboard shortcuts
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' || (input.control && input.key === 'i')) {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    if (scrapingProcess) {
      scrapingProcess.kill();
    }
    if (webSocketServer) {
      webSocketServer.close();
    }
  });
}

app.whenReady().then(() => {
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

  console.log('WebSocket server started on port 8080');
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
