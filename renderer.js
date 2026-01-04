// Simple renderer.js - Fixed version
console.log('[INFO] renderer.js loaded');

// App state
const app = {
    elements: {},
    state: { links: [], isRunning: false },

    addLog: function (type, message) {
        const logViewer = document.getElementById("logViewer");
        if (!logViewer) return;

        const timestamp = new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const log = document.createElement("div");
        log.className = `log-entry log-${type}`;

        // Friendly message formatting
        let displayMessage = message;
        if (type === 'success') {
            displayMessage = `✅ ${message}`;
        } else if (type === 'error') {
            displayMessage = `❌ ${message}`;
        } else if (type === 'warning') {
            displayMessage = `⚠️  ${message}`;
        } else if (type === 'info') {
            displayMessage = `ℹ️  ${message}`;
        }

        log.innerHTML = `<span class="timestamp">${timestamp}</span> ${displayMessage}`;
        logViewer.appendChild(log);
        logViewer.scrollTop = logViewer.scrollHeight;

        // Auto-update progress bar from log messages
        const progressMatch = message.match(/\[(\d+)\/(\d+)\]/);
        if (progressMatch) {
            const current = parseInt(progressMatch[1]);
            const total = parseInt(progressMatch[2]);
            this.updateProgress(current, total);
        }
    },

    clearLog: function () {
        const logViewer = document.getElementById("logViewer");
        if (logViewer) {
            logViewer.innerHTML = '';
            this.addLog('info', 'Log cleared');
        }
    },

    parseLinks: function () {
        const linksInput = document.getElementById("linksInput");
        if (!linksInput) return;

        const input = linksInput.value;
        this.state.links = [];

        // Method 2: Split by whitespace/commas/semicolons (More robust for lists)
        // This avoids regex over-matching inside complex URLs or text
        const candidates = input.split(/[\s,;]+/);

        const cleaned = candidates
            .map(item => item.trim())
            .filter(item => item.match(/^https?:\/\//i)) // Must start with http/https
            .map(url => {
                // Remove common trailing punctuation
                let cleanUrl = url.replace(/[.,;:!?]+$/, '').trim();
                // Remove trailing slashes
                cleanUrl = cleanUrl.replace(/\/+$/, '');
                return cleanUrl;
            })
            .filter(url => {
                // Filter out invalid URLs
                if (!url || url.length < 10) return false;
                if (!url.includes('.')) return false;
                return true;
            });

        // Remove duplicates
        this.state.links = [...new Set(cleaned)];

        const statusDiv = document.getElementById("linksStatus");
        if (statusDiv) {
            if (this.state.links.length > 0) {
                statusDiv.innerHTML = `<div class="info-box">[OK] Found <strong>${this.state.links.length}</strong> valid links</div>`;
                this.addLog("success", `Found ${this.state.links.length} valid links`);
            } else {
                statusDiv.innerHTML = `<div class="warning-box">[WARN] No valid links found</div>`;
                this.addLog("warning", "No valid links found");
            }
        }
    },

    startVisualScraping: async function () {
        const visualBtn = document.getElementById('visualBtn');
        const stopBtn = document.getElementById('stopBtn');

        // Check API Key before starting
        try {
            const settings = await window.electronAPI.getSettings();
            if (!settings.apiKey) {
                this.addLog('warning', '⚠️ Missing API Key! Please configure it first.');
                this.showFirstRunSetup(); // Re-use the setup modal
                return;
            }
        } catch (e) {
            console.error('Failed to check API key:', e);
        }

        if (this.state.links.length === 0) {
            alert("Please add some links first");
            return;
        }

        if (visualBtn) {
            visualBtn.disabled = true;
            visualBtn.textContent = "⏳ Processing...";
        }
        if (stopBtn) stopBtn.disabled = false;

        this.state.isRunning = true;
        this.addLog("info", `Starting visual scraping process...`);

        try {
            // Check which tab is active
            const sheetsTab = document.querySelector('[data-target="sheets"]');
            const isSheetsMode = sheetsTab?.classList.contains('active');

            const existingFile = document.getElementById("existingFile")?.value;

            const payload = {
                links: this.state.links,
                savePath: document.getElementById("savePath")?.value || "./out_new",
                fileName: document.getElementById("fileName")?.value || "summaries.csv",
                existingFile: existingFile || undefined,  // Pass existing file path if selected
                visualMode: true // Always use visual mode for Stories/Reels support
            };

            // Add Sheets info if in Sheets mode
            if (isSheetsMode) {
                const sheetsUrl = document.getElementById("sheetsUrl")?.value;
                console.log('DEBUG: Sheets URL:', sheetsUrl);
                if (sheetsUrl) {
                    const match = sheetsUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
                    console.log('DEBUG: Match result:', match);
                    if (match) {
                        payload.spreadsheetId = match[1];
                        payload.sheetName = document.getElementById("sheetName")?.value || 'Summaries';
                        payload.smartTableSync = document.getElementById("smartTableSync")?.checked || false;
                        console.log('DEBUG: Payload with Sheets:', payload);
                        this.addLog("info", `Using Google Sheets: ${payload.spreadsheetId}`);
                    } else {
                        this.addLog("warning", "Invalid Google Sheets URL");
                    }
                } else {
                    this.addLog("warning", "No Google Sheets URL provided");
                }
            } else {
                console.log('DEBUG: CSV mode active, not using Sheets');
            }

            await window.electronAPI.runScrape(payload);
            // Reset buttons after successful completion
            this.resetButtons();
            this.addLog("success", "[OK] Scraping completed successfully!");
        } catch (error) {
            this.addLog("error", `Scraping error: ${error.message}`);
            this.resetButtons();
        }
    },

    stopScraping: function () {
        console.log('Stop button clicked!');
        this.state.isRunning = false;
        this.addLog("warning", "Stopping process...");
        // Send stop signal to main process (works for both scraping and repair)
        window.electronAPI.send('stop-scraping');
        // Reset buttons after a short delay to allow process to stop
        setTimeout(() => {
            this.resetButtons();
        }, 500);
    },


    resetButtons: function () {
        const visualBtn = document.getElementById("visualBtn");
        const stopBtn = document.getElementById("stopBtn");

        if (visualBtn) {
            visualBtn.disabled = false;
            visualBtn.textContent = "🚀 START SCRAPING";
        }
        if (stopBtn) stopBtn.disabled = true;

        this.state.isRunning = false;
    },

    setupTabs: function () {
        const tabs = document.querySelectorAll('.tab');
        const tabContents = document.querySelectorAll('.tab-content');

        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                console.log('Tab clicked:', tab.dataset.target);
                const target = tab.dataset.target;

                // Remove active from all
                tabs.forEach(t => t.classList.remove('active'));
                tabContents.forEach(tc => tc.classList.remove('active'));

                // Add active to clicked
                tab.classList.add('active');
                const targetContent = document.getElementById(`${target}-content`);
                if (targetContent) {
                    targetContent.classList.add('active');
                }
            });
        });
    },

    setupEventListeners: function () {
        console.log('Setting up event listeners...');

        // Tab switching
        this.setupTabs();


        // Stop button
        const stopBtn = document.getElementById("stopBtn");
        if (stopBtn) {
            stopBtn.addEventListener("click", () => this.stopScraping());
            console.log('[INFO] Stop button listener added');
        } else {
            console.error('[ERR] Stop button not found!');
        }

        // Clear log button
        const clearLogBtn = document.getElementById("clearLogBtn");
        if (clearLogBtn) {
            clearLogBtn.addEventListener("click", () => app.clearLog());
            console.log('[OK] Clear log button listener added');
        } else {
            console.error('[ERR] Clear log button not found!');
        }

        // Visual Scrape button
        const visualBtn = document.getElementById("visualBtn");
        if (visualBtn) {
            visualBtn.addEventListener("click", () => this.startVisualScraping());
            console.log('[OK] Visual Scrape button listener added');
        }

        // Links input
        const linksInput = document.getElementById("linksInput");
        if (linksInput) {
            linksInput.addEventListener("input", () => {
                setTimeout(() => this.parseLinks(), 300);
            })
            console.log('[OK] Links input listener added');
        }


        // Settings button
        const settingsBtn = document.getElementById('settingsBtn');
        const settingsModal = document.getElementById('settingsModal');
        const closeSettingsBtn = document.getElementById('closeSettingsBtn');
        const cancelSettingsBtn = document.getElementById('cancelSettingsBtn');
        const saveSettingsBtn = document.getElementById('saveSettingsBtn');
        const apiKeyInput = document.getElementById('apiKeyInput');
        const apiKeyStatus = document.getElementById('apiKeyStatus');
        const repairStatus = document.getElementById('repairStatus');

        // Column Checkboxes
        const colCheckboxes = {
            sender: document.getElementById('colSender'),
            group: document.getElementById('colGroup'),
            date: document.getElementById('colDate'),
            content: document.getElementById('colContent'),
            summary: document.getElementById('colSummary'),
            likes: document.getElementById('colLikes'),
            comments: document.getElementById('colComments')
        };

        if (settingsBtn) {
            settingsBtn.onclick = async () => {
                console.log('⚙️ Settings clicked');
                if (settingsModal) settingsModal.style.display = 'flex';

                // Load current settings
                if (window.electronAPI && window.electronAPI.getSettings) {
                    try {
                        const settings = await window.electronAPI.getSettings();
                        if (settings.apiKey) {
                            apiKeyInput.value = settings.apiKey;
                            apiKeyStatus.className = 'status-badge status-connected';
                            apiKeyStatus.textContent = 'Configured';
                        }
                        // Load Column Preferences with defaults
                        const defaultColumns = {
                            sender: true,
                            group: true,
                            date: true,
                            content: true,
                            summary: true,
                            likes: true,
                            comments: true
                        };

                        const columns = settings.columns || defaultColumns;
                        for (const [key, checkbox] of Object.entries(colCheckboxes)) {
                            if (checkbox) {
                                checkbox.checked = columns[key] !== undefined ? columns[key] : defaultColumns[key];
                            }
                        }
                    } catch (error) {
                        console.error('Failed to load settings:', error);
                    }
                }
            };
        }

        if (closeSettingsBtn) {
            closeSettingsBtn.onclick = () => {
                if (settingsModal) settingsModal.style.display = 'none';
            };
        }

        if (cancelSettingsBtn) {
            cancelSettingsBtn.onclick = () => {
                if (settingsModal) settingsModal.style.display = 'none';
            };
        }

        if (saveSettingsBtn) {
            saveSettingsBtn.onclick = async () => {
                const apiKey = apiKeyInput.value.trim();

                // Gather column preferences
                const columns = {};
                for (const [key, checkbox] of Object.entries(colCheckboxes)) {
                    if (checkbox) columns[key] = checkbox.checked;
                }

                if (window.electronAPI && window.electronAPI.saveSettings) {
                    try {
                        await window.electronAPI.saveSettings({ apiKey, columns });
                        this.addLog('success', 'Settings saved successfully');
                        if (settingsModal) settingsModal.style.display = 'none';

                        if (apiKeyStatus && apiKey) {
                            apiKeyStatus.className = 'status-badge status-connected';
                            apiKeyStatus.textContent = 'Configured';
                        }
                    } catch (error) {
                        this.addLog('error', `Failed to save settings: ${error.message}`);
                    }
                }
            };
        }

        // Helper function for repair operations
        const performRepair = async (field, buttonId) => {
            const sheetsUrl = document.getElementById('sheetsUrl')?.value;
            const sheetName = document.getElementById('sheetName')?.value || 'Sheet1';
            const repairStatus = document.getElementById('repairStatus');
            const button = document.getElementById(buttonId);
            const stopBtn = document.getElementById('stopBtn');

            let spreadsheetId = null;
            if (sheetsUrl) {
                const match = sheetsUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
                if (match) spreadsheetId = match[1];
            }

            if (!spreadsheetId) {
                alert('Please enter a valid Google Sheets URL in the main window first.');
                return;
            }

            if (button) button.disabled = true;
            if (stopBtn) stopBtn.disabled = false; // Enable stop button
            this.state.isRunning = true; // Mark as running

            if (repairStatus) {
                repairStatus.textContent = `Starting repair for ${field}...`;
                repairStatus.style.color = '#666';
            }
            this.addLog('info', `Starting repair for ${field}...`);

            try {
                const result = await window.electronAPI.repairField({ spreadsheetId, sheetName, field });
                if (result.success) {
                    if (repairStatus) {
                        repairStatus.textContent = result.message;
                        repairStatus.style.color = 'green';
                    }
                    this.addLog('success', result.message);
                } else {
                    if (repairStatus) {
                        repairStatus.textContent = 'Repair failed: ' + result.message;
                        repairStatus.style.color = 'red';
                    }
                    this.addLog('error', 'Repair failed: ' + result.message);
                }
            } catch (error) {
                if (repairStatus) {
                    repairStatus.textContent = 'Error: ' + error.message;
                    repairStatus.style.color = 'red';
                }
                this.addLog('error', `Repair error: ${error.message}`);
            } finally {
                if (button) button.disabled = false;
                if (stopBtn) stopBtn.disabled = true; // Disable stop button
                this.state.isRunning = false; // Mark as not running
            }
        };

        // Repair All function
        const performRepairAll = async () => {
            const sheetsUrl = document.getElementById('sheetsUrl')?.value;
            const sheetName = document.getElementById('sheetName')?.value || 'Sheet1';
            const repairStatus = document.getElementById('repairStatus');
            const button = document.getElementById('repairAllBtn');
            const stopBtn = document.getElementById('stopBtn');

            let spreadsheetId = null;
            if (sheetsUrl) {
                const match = sheetsUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
                if (match) spreadsheetId = match[1];
            }

            if (!spreadsheetId) {
                alert('Please enter a valid Google Sheets URL in the main window first.');
                return;
            }

            if (button) button.disabled = true;
            if (stopBtn) stopBtn.disabled = false; // Enable stop button
            this.state.isRunning = true; // Mark as running

            if (repairStatus) {
                repairStatus.textContent = 'Starting repair for all fields...';
                repairStatus.style.color = '#666';
            }
            this.addLog('info', 'Starting repair for all missing fields...');

            try {
                const result = await window.electronAPI.repairAllFields({ spreadsheetId, sheetName });
                if (result.success) {
                    if (repairStatus) {
                        repairStatus.textContent = result.message;
                        repairStatus.style.color = 'green';
                    }
                    this.addLog('success', result.message);
                    if (result.details) {
                        result.details.forEach(detail => {
                            this.addLog(detail.success ? 'success' : 'warning', `${detail.field}: ${detail.message}`);
                        });
                    }
                } else {
                    if (repairStatus) {
                        repairStatus.textContent = 'Repair failed: ' + result.message;
                        repairStatus.style.color = 'red';
                    }
                    this.addLog('error', 'Repair failed: ' + result.message);
                }
            } catch (error) {
                if (repairStatus) {
                    repairStatus.textContent = 'Error: ' + error.message;
                    repairStatus.style.color = 'red';
                }
                this.addLog('error', `Repair error: ${error.message}`);
            } finally {
                if (button) button.disabled = false;
                if (stopBtn) stopBtn.disabled = true; // Disable stop button
                this.state.isRunning = false; // Mark as not running
            }
        };

        // Legacy repair button (for backward compatibility)
        const repairDataBtn = document.getElementById('repairDataBtn');
        if (repairDataBtn) {
            repairDataBtn.onclick = () => performRepair('group', 'repairDataBtn');
        }

        // New repair buttons
        const repairGroupsBtn = document.getElementById('repairGroupsBtn');
        if (repairGroupsBtn) {
            repairGroupsBtn.onclick = () => performRepair('group', 'repairGroupsBtn');
        }

        const repairLikesBtn = document.getElementById('repairLikesBtn');
        if (repairLikesBtn) {
            repairLikesBtn.onclick = () => performRepair('likes', 'repairLikesBtn');
        }

        const repairCommentsBtn = document.getElementById('repairCommentsBtn');
        if (repairCommentsBtn) {
            repairCommentsBtn.onclick = () => performRepair('comments', 'repairCommentsBtn');
        }

        const repairContentBtn = document.getElementById('repairContentBtn');
        if (repairContentBtn) {
            repairContentBtn.onclick = () => performRepair('content', 'repairContentBtn');
        }

        const repairSenderBtn = document.getElementById('repairSenderBtn');
        if (repairSenderBtn) {
            repairSenderBtn.onclick = () => performRepair('sender', 'repairSenderBtn');
        }

        const repairDateBtn = document.getElementById('repairDateBtn');
        if (repairDateBtn) {
            repairDateBtn.onclick = () => performRepair('date', 'repairDateBtn');
        }

        const repairAllBtn = document.getElementById('repairAllBtn');
        if (repairAllBtn) {
            repairAllBtn.onclick = performRepairAll;
        }

        // Copy log button
        const copyLogBtn = document.getElementById("copyLogBtn");
        if (copyLogBtn) {
            copyLogBtn.addEventListener("click", () => {
                const logViewer = document.getElementById("logViewer");
                if (logViewer) {
                    const logText = Array.from(logViewer.children)
                        .map(entry => entry.textContent)
                        .join('\n');
                    navigator.clipboard.writeText(logText).then(() => {
                        this.addLog("success", "Log copied to clipboard");
                    });
                }
            });
            console.log('[OK] Copy log button listener added');
        }

        // Delete screenshots button
        const deleteScreenshotsBtn = document.getElementById('deleteScreenshotsBtn');
        if (deleteScreenshotsBtn) {
            deleteScreenshotsBtn.addEventListener('click', async () => {
                const confirmed = confirm('Are you sure you want to delete all screenshots?');
                if (confirmed) {
                    try {
                        const result = await window.electronAPI.deleteScreenshots();
                        if (result.success) {
                            this.addLog('success', `Deleted ${result.count} screenshots`);
                        } else {
                            this.addLog('error', `Failed: ${result.message}`);
                        }
                    } catch (error) {
                        this.addLog('error', `Error: ${error.message}`);
                    }
                }
            });
            console.log('[OK] Delete screenshots button listener added');
        }

        // Open screenshots folder button
        const openScreenshotsFolderBtn = document.getElementById('openScreenshotsFolderBtn');
        if (openScreenshotsFolderBtn) {
            openScreenshotsFolderBtn.addEventListener('click', async () => {
                try {
                    await window.electronAPI.openScreenshotsFolder();
                    this.addLog('info', 'Opened screenshots folder');
                } catch (error) {
                    this.addLog('error', `Failed to open folder: ${error.message}`);
                }
            });
            console.log('[OK] Open screenshots folder button listener added');
        }

        // Browse buttons
        const browseSavePathBtn = document.getElementById("browseSavePathBtn");
        if (browseSavePathBtn) {
            browseSavePathBtn.addEventListener("click", async () => {
                try {
                    const path = await window.electronAPI.browseSavePath();
                    const savePathInput = document.getElementById("savePath");
                    if (path && savePathInput) {
                        savePathInput.value = path;
                        this.addLog("success", `Selected path: ${path}`);
                    }
                } catch (error) {
                    this.addLog("error", `Path selection error: ${error.message}`);
                }
            });
            console.log('[OK] Browse save path button listener added');
        }

        const browseFileBtn = document.getElementById("browseFileBtn");
        if (browseFileBtn) {
            browseFileBtn.addEventListener("click", async () => {
                try {
                    const filePath = await window.electronAPI.browseFile();
                    const existingFileInput = document.getElementById("existingFile");
                    if (filePath && existingFileInput) {
                        existingFileInput.value = filePath;
                        this.addLog("success", `Selected file: ${filePath}`);
                    }
                } catch (error) {
                    // User probably clicked Cancel, which throws
                    if (error.message !== 'No file selected') {
                        this.addLog("error", `File selection error: ${error.message}`);
                    }
                }
            });
            console.log('[OK] Browse file button listener added');
        }

        // Test connection button
        const testConnectionBtn = document.getElementById("testConnectionBtn");
        if (testConnectionBtn) {
            testConnectionBtn.addEventListener("click", async () => {
                const sheetsUrl = document.getElementById("sheetsUrl");
                if (!sheetsUrl || !sheetsUrl.value) {
                    this.addLog("warning", "Please enter Google Sheets URL");
                    return;
                }

                this.addLog("info", "Testing Google Sheets connection...");
                try {
                    const result = await window.electronAPI.testSheetsConnection({ url: sheetsUrl.value });
                    this.addLog("success", `[OK] Connected to sheet "${result.title}"`);

                    // Update status badges
                    const authStatus = document.getElementById('authStatus');
                    const sheetsStatus = document.getElementById('sheetsStatus');
                    if (authStatus) {
                        authStatus.className = 'status-badge status-connected';
                        authStatus.textContent = 'CONNECTED';
                    }
                    if (sheetsStatus) {
                        sheetsStatus.className = 'status-badge status-connected';
                        sheetsStatus.textContent = 'CONNECTED';
                    }
                } catch (error) {
                    this.addLog("error", `[ERR] Connection error: ${error.message}`);

                    // Update status badges to disconnected
                    const authStatus = document.getElementById('authStatus');
                    const sheetsStatus = document.getElementById('sheetsStatus');
                    if (authStatus) {
                        authStatus.className = 'status-badge status-disconnected';
                        authStatus.textContent = 'Not connected';
                    }
                    if (sheetsStatus) {
                        sheetsStatus.className = 'status-badge status-disconnected';
                        sheetsStatus.textContent = 'Not connected';
                    }
                }
            });
            console.log('[OK] Test connection button listener added');
        }

        // Open browser button
        const openBrowserBtn = document.getElementById("openBrowserBtn");
        if (openBrowserBtn) {
            openBrowserBtn.addEventListener("click", async () => {
                this.addLog("info", "Opening browser...");
                try {
                    await window.electronAPI.openBrowser();
                    this.addLog("success", "Browser opened successfully");
                } catch (error) {
                    this.addLog("error", `Browser error: ${error.message}`);
                }
            });
            console.log('[OK] Open browser button listener added');
        }

        // Login/logout buttons
        const loginBtn = document.getElementById("loginBtn");
        if (loginBtn) {
            loginBtn.addEventListener("click", async () => {
                this.addLog("info", "Opening authentication...");
                try {
                    // Call the authentication handler, not test-sheets-connection
                    const result = await window.electronAPI.authenticateGoogle();

                    if (result.success) {
                        this.addLog("success", "Authentication successful!");

                        // Update status badges
                        const authStatus = document.getElementById('authStatus');
                        const sheetsStatus = document.getElementById('sheetsStatus');
                        if (authStatus) {
                            authStatus.className = 'status-badge status-connected';
                            authStatus.textContent = 'CONNECTED';
                        }
                        if (sheetsStatus) {
                            sheetsStatus.className = 'status-badge status-connected';
                            sheetsStatus.textContent = 'CONNECTED';
                        }

                        // Toggle buttons
                        loginBtn.style.display = 'none';
                        const logoutBtn = document.getElementById('logoutBtn');
                        if (logoutBtn) logoutBtn.style.display = 'inline-block';
                    } else {
                        this.addLog("error", `Authentication failed: ${result.error}`);
                    }
                } catch (error) {
                    this.addLog("error", `Authentication error: ${error.message}`);

                    // Update status badges to disconnected
                    const authStatus = document.getElementById('authStatus');
                    const sheetsStatus = document.getElementById('sheetsStatus');
                    if (authStatus) {
                        authStatus.className = 'status-badge status-disconnected';
                        authStatus.textContent = 'NOT CONNECTED';
                    }
                    if (sheetsStatus) {
                        sheetsStatus.className = 'status-badge status-disconnected';
                        sheetsStatus.textContent = 'NOT CONNECTED';
                    }
                }
            });
            console.log('[OK] Login button listener added');
        }

        const logoutBtn = document.getElementById("logoutBtn");
        if (logoutBtn) {
            logoutBtn.addEventListener("click", async () => {
                this.addLog("info", "Logging out...");
                try {
                    await window.electronAPI.logoutSheets();
                    this.addLog("success", "Logged out successfully!");

                    // Update status badges
                    const authStatus = document.getElementById('authStatus');
                    const sheetsStatus = document.getElementById('sheetsStatus');
                    if (authStatus) {
                        authStatus.className = 'status-badge status-disconnected';
                        authStatus.textContent = 'NOT CONNECTED';
                    }
                    if (sheetsStatus) {
                        sheetsStatus.className = 'status-badge status-disconnected';
                        sheetsStatus.textContent = 'NOT CONNECTED';
                    }

                    // Toggle buttons
                    loginBtn.style.display = 'inline-block';
                    logoutBtn.style.display = 'none';
                } catch (error) {
                    this.addLog("error", `Logout error: ${error.message}`);
                }
            });
            console.log('[OK] Logout button listener added');
        }


        console.log('[INFO] All event listeners set up');
    },

    updateProgress: function (current, total, message = '') {
        const progressContainer = document.getElementById('progressContainer');
        const progressFill = document.getElementById('progressFill');
        const progressText = document.getElementById('progressText');
        const progressPercent = document.getElementById('progressPercent');

        if (!progressContainer || !progressFill) return;

        const percent = total > 0 ? Math.round((current / total) * 100) : 0;

        // Show container when scraping starts
        if (current > 0 || total > 0) {
            progressContainer.style.display = 'block';
        }

        progressFill.style.width = `${percent}%`;

        if (progressText) {
            progressText.textContent = message || `Processing ${current}/${total}`;
        }

        if (progressPercent) {
            progressPercent.textContent = `${percent}%`;
        }

        // Hide when complete
        if (current === total && total > 0) {
            setTimeout(() => {
                progressContainer.style.display = 'none';
                progressFill.style.width = '0%';
            }, 2000);
        }
    },

    updateFileName: function () {
        const fileNameInput = document.getElementById("fileName");
        if (fileNameInput) {
            const now = new Date();
            const timestamp = now.toISOString().replace(/[:.]/g, "-").slice(0, -5);
            fileNameInput.value = `summaries_${timestamp}.csv`;
        }
    },

    initialize: function () {
        console.log("Initializing app...");

        // Check if electronAPI is available
        if (window.electronAPI) {
            console.log("[OK] electronAPI is available");

            // Fix Icon Path (Dynamic loading for packaged app)
            try {
                window.electronAPI.getIconPath().then(iconPath => {
                    const iconEl = document.getElementById('appIcon');
                    if (iconEl && iconPath) {
                        iconEl.src = iconPath;
                    }
                });
            } catch (e) {
                console.error('Failed to load icon path:', e);
            }

            // Listen for scraping events
            window.electronAPI.onScrapeLog((data) => {
                this.addLog(data.type, data.message);
            });

            window.electronAPI.on('scraping-output', (data) => {
                this.addLog(data.type, data.message);
            });

            window.electronAPI.on('scraping-complete', (results) => {
                this.state.isRunning = false;
                this.addLog('success', `[OK] Scraping completed! ${results.succeeded || 0} succeeded, ${results.failed || 0} failed.`);

                // Re-enable buttons after completion
                this.resetButtons();
            });

            window.electronAPI.on('scraping-error', () => {
                this.addLog("error", "[ERR] Scraping failed");
                this.resetButtons();
            });
        } else {
            console.error("[ERR] electronAPI is not available!");
            this.addLog("error", "API not available");
        }

        this.updateFileName();
        this.setupEventListeners();
        this.addLog("info", "System ready");

        // Check for first run - show API key setup if not configured
        this.checkFirstRun();

        console.log('[OK] App initialized');
    },

    checkFirstRun: async function () {
        try {
            if (!window.electronAPI || !window.electronAPI.getSettings) return;

            const settings = await window.electronAPI.getSettings();

            // If no API key is set, show the first run modal
            if (!settings.apiKey) {
                console.log('[INFO] First run detected - showing API setup');
                this.showFirstRunSetup();
            }
        } catch (error) {
            console.error('Error checking first run:', error);
        }
    },

    showFirstRunSetup: function () {
        // Create modal overlay
        const overlay = document.createElement('div');
        overlay.id = 'firstRunOverlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.8);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        `;

        const modal = document.createElement('div');
        modal.style.cssText = `
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            border-radius: 16px;
            padding: 32px;
            max-width: 450px;
            width: 90%;
            box-shadow: 0 20px 60px rgba(0,0,0,0.5);
            border: 1px solid rgba(255,255,255,0.1);
            color: white;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `;

        modal.innerHTML = `
            <div style="text-align: center; margin-bottom: 24px;">
                <div style="font-size: 48px; margin-bottom: 16px;">🚀</div>
                <h2 style="margin: 0; font-size: 24px; font-weight: 600;">Welcome to Web Scraper!</h2>
                <p style="color: #888; margin-top: 8px;">Let's set up your Gemini API key</p>
            </div>
            
            <div style="margin-bottom: 20px;">
                <label style="display: block; margin-bottom: 8px; font-weight: 500;">Gemini API Key</label>
                <input type="password" id="firstRunApiKey" placeholder="AIza..." style="
                    width: 100%;
                    padding: 12px 16px;
                    border: 2px solid rgba(255,255,255,0.1);
                    border-radius: 8px;
                    background: rgba(255,255,255,0.05);
                    color: white;
                    font-size: 14px;
                    box-sizing: border-box;
                    outline: none;
                    transition: border-color 0.2s;
                " onfocus="this.style.borderColor='#4f46e5'" onblur="this.style.borderColor='rgba(255,255,255,0.1)'">
            </div>
            
            <p style="color: #666; font-size: 12px; margin-bottom: 20px;">
                Get your API key from <a href="#" onclick="require('electron').shell.openExternal('https://aistudio.google.com/apikey'); return false;" style="color: #4f46e5;">Google AI Studio</a>
            </p>
            
            <div style="display: flex; gap: 12px;">
                <button id="firstRunSkip" style="
                    flex: 1;
                    padding: 12px;
                    border: 1px solid rgba(255,255,255,0.2);
                    border-radius: 8px;
                    background: transparent;
                    color: white;
                    cursor: pointer;
                    font-size: 14px;
                ">Skip for now</button>
                <button id="firstRunSave" style="
                    flex: 2;
                    padding: 12px;
                    border: none;
                    border-radius: 8px;
                    background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
                    color: white;
                    cursor: pointer;
                    font-size: 14px;
                    font-weight: 600;
                ">Save & Continue</button>
            </div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Event listeners
        document.getElementById('firstRunSkip').onclick = () => {
            overlay.remove();
            this.addLog('warning', 'API key not set. Some features may not work.');
        };

        document.getElementById('firstRunSave').onclick = async () => {
            const apiKey = document.getElementById('firstRunApiKey').value.trim();
            if (!apiKey) {
                alert('Please enter an API key');
                return;
            }

            try {
                await window.electronAPI.saveSettings({ apiKey });
                overlay.remove();
                this.addLog('success', '✅ API key saved successfully!');
            } catch (error) {
                alert('Failed to save: ' + error.message);
            }
        };

        // Focus input
        setTimeout(() => document.getElementById('firstRunApiKey')?.focus(), 100);
    }
};


// Initialize when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
    console.log('DOM loaded, initializing app...');
    app.initialize();
});

console.log('[OK] renderer.js fully loaded');

// ==========================================
// LICENSE TIMER LOGIC
// ==========================================

async function updateLicenseTimer() {
    try {
        if (!window.electronAPI || !window.electronAPI.getLicenseInfo) {
            console.warn('License API not available yet');
            return;
        }

        const info = await window.electronAPI.getLicenseInfo();
        const timer = document.getElementById('license-timer');
        if (!timer) return;

        timer.style.display = 'block';

        if (!info.valid) {
            timer.className = 'expired';
            timer.innerHTML = '⚠️ Trial Expired - <a href="#" onclick="showActivate()">Activate</a>';
        } else if (info.isPaid) {
            timer.className = 'pro';
            timer.innerHTML = '✅ Licensed Pro';
        } else {
            timer.className = 'trial';
            timer.innerHTML = `⏱️ Trial: ${info.daysLeft} days remaining`;
        }
    } catch (err) {
        console.error('Failed to update license info:', err);
    }
}

// Expose showActivate globally so onclick works
window.showActivate = async function () {
    const key = prompt('Enter License Key:');
    if (key) {
        try {
            const result = await window.electronAPI.activateLicense(key);
            if (result.success) {
                alert('License Activated! 🎉');
                updateLicenseTimer();
            } else {
                alert('Invalid key: ' + (result.error || 'Unknown error'));
            }
        } catch (e) {
            alert('Error activating license: ' + e.message);
        }
    }
};

// Start timer logic
document.addEventListener('DOMContentLoaded', () => {
    // Give a small delay to ensure IPC is ready
    setTimeout(() => {
        updateLicenseTimer();
        setInterval(updateLicenseTimer, 60 * 60 * 1000); // Update every hour
    }, 1000);
});
