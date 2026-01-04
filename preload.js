const { contextBridge, ipcRenderer } = require('electron');

// אתחול ובדיקת תקינות
console.log('Preload script starting...');

try {
    contextBridge.exposeInMainWorld('electronAPI', {
        // בדיקת API
        testAPI: () => ipcRenderer.invoke('test-api'),
        checkAPIStatus: () => ipcRenderer.invoke('check-api-status'),

        // ניהול קבצים ותיקיות
        browseSavePath: () => ipcRenderer.invoke('browse-save-path'),
        browseFile: () => ipcRenderer.invoke('browse-file'),
        exportResults: (data) => ipcRenderer.invoke('export-results', data),
        readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
        writeFile: (data) => ipcRenderer.invoke('write-file', data),

        // סריקה וסנכרון
        runScrape: (links) => ipcRenderer.invoke('run-scrape', links),
        syncToSheets: (config) => ipcRenderer.invoke('sync-to-sheets', config),
        testSheetsConnection: (config) => ipcRenderer.invoke('test-sheets-connection', config),
        openBrowser: () => ipcRenderer.invoke('open-browser'),

        // OAuth
        authenticateGoogle: () => ipcRenderer.invoke('authenticate-google'),
        isAuthenticated: () => ipcRenderer.invoke('is-authenticated'),
        logoutSheets: () => ipcRenderer.invoke('logout-sheets'),
        forceGoogleAuth: () => ipcRenderer.invoke('force-google-auth'),
        loadOAuthCredentials: () => ipcRenderer.invoke('load-oauth-credentials'),

        // Settings
        getSettings: () => ipcRenderer.invoke('get-settings'),
        saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

        // Repair
        repairData: (payload) => ipcRenderer.invoke('repair-data', payload),
        repairField: (payload) => ipcRenderer.invoke('repair-field', payload),
        repairAllFields: (payload) => ipcRenderer.invoke('repair-all-fields', payload),

        // Screenshot management
        deleteScreenshots: () => ipcRenderer.invoke('delete-screenshots'),
        openScreenshotsFolder: () => ipcRenderer.invoke('open-screenshots-folder'),

        // UI Helpers
        getIconPath: () => ipcRenderer.invoke('get-icon-path'),

        // License
        getLicenseInfo: () => ipcRenderer.invoke('get-license-info'),
        activateLicense: (key) => ipcRenderer.invoke('activate-license', key),

        // האזנה לעדכונים
        onScrapeLog: (callback) => ipcRenderer.on('scrape-log', (_, value) => callback(value)),
        onSyncLog: (callback) => ipcRenderer.on('sync-log', (_, value) => callback(value)),

        // Send function for stop scraping
        send: (channel, data) => {
            const validChannels = ['stop-scraping'];
            if (validChannels.includes(channel)) {
                ipcRenderer.send(channel, data);
            }
        },

        on: (channel, callback) => {
            // Whitelist of allowed channels
            const validChannels = ['scraping-output', 'scrape-log', 'sync-log', 'backend-message'];
            if (validChannels.includes(channel)) {
                ipcRenderer.on(channel, (_, data) => callback(data));
            }
        }
    });

    console.log('Preload script completed successfully');
} catch (error) {
    console.error('Error in preload script:', error);
}
