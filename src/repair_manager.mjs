// src/repair_manager.mjs
import fs from 'fs/promises';
import path from 'path';
import { google } from 'googleapis';
import { log } from './logger.mjs';
import { formatDate } from './data_service.mjs';
import { analyzePostImage } from '../visual_engine/ai_vision.mjs';
import { launchBrowser, navigateWithRetry } from './browser_manager.mjs';
import { extractFacebookMetadata, extractTikTokMetadata, waitForLikelyContent } from '../extractors.mjs';
import { capturePostScreenshot } from '../visual_engine/screenshot.mjs';
import { optimizeImage } from '../visual_engine/image_optimizer.mjs';

const CREDENTIALS_PATH = process.env.CREDENTIALS_PATH || 'credentials.json';
const OUT_DIR = path.join(process.cwd(), 'out_new');
const JSONL_FILE = path.join(OUT_DIR, 'summaries.jsonl');

// Global flag to stop repair process
let shouldStopRepair = false;
export function stopRepair() {
    shouldStopRepair = true;
}

async function getSheetsClient() {
    try {
        // Try OAuth first (preferred method)
        const { getAuthenticatedClient } = await import('../sheets_oauth.mjs');
        const authClient = await getAuthenticatedClient();
        return google.sheets({ version: 'v4', auth: authClient });
    } catch (oauthError) {
        log(`OAuth failed, trying service account: ${oauthError.message}`, 'warning');
        // Fallback to service account
        try {
            if (!await fs.access(CREDENTIALS_PATH).then(() => true).catch(() => false)) {
                log('No credentials file found', 'error');
                return null;
            }
            const content = await fs.readFile(path.resolve(CREDENTIALS_PATH));
            const credentials = JSON.parse(content);
            const { client_email, private_key } = credentials;

            const client = new google.auth.JWT(
                client_email,
                null,
                private_key,
                ['https://www.googleapis.com/auth/spreadsheets']
            );

            await client.authorize();
            return google.sheets({ version: 'v4', auth: client });
        } catch (error) {
            log(`Error loading credentials: ${error.message}`, 'error');
            return null;
        }
    }
}

// Helper: Get column index by name
function findColumn(headers, candidates) {
    return headers.findIndex(h => candidates.some(c =>
        h && h.toString().trim().toLowerCase().includes(c.toLowerCase())
    ));
}

// Helper: Get column letter from index
function getColumnLetter(index) {
    let letter = '';
    while (index >= 0) {
        letter = String.fromCharCode(65 + (index % 26)) + letter;
        index = Math.floor(index / 26) - 1;
    }
    return letter;
}

// Helper: Try Puppeteer extraction for stats
async function tryPuppeteerExtraction(url, field) {
    let browser = null;
    try {
        browser = await launchBrowser();
        const page = await navigateWithRetry(browser, url, 'Repair');
        await waitForLikelyContent(page, url);

        let metadata = {};
        try {
            if (url.includes('facebook.com')) {
                metadata = await extractFacebookMetadata(page);
            } else if (url.includes('tiktok.com')) {
                metadata = await extractTikTokMetadata(page);
            }
        } catch (extractionError) {
            log(`Metadata extraction failed in repair: ${extractionError.message}`, 'warning');
            // Continue with empty metadata
        }

        await page.close();
        await browser.close();

        // Return the requested field
        if (field === 'likes') return metadata.likes || 0;
        if (field === 'comments') return metadata.comments || 0;
        if (field === 'shares') return metadata.shares || 0;
        if (field === 'sender') return metadata.senderName || '';
        if (field === 'date') return metadata.postDate || '';
        if (field === 'group') return metadata.groupName || '';

        return null;
    } catch (error) {
        log(`Puppeteer extraction failed: ${error.message}`, 'warning');
        if (browser) {
            try {
                await browser.close();
            } catch { }
        }
        return null;
    }
}

// Helper: Try AI extraction from existing screenshot
async function tryAIFromScreenshot(screenshotPath, field) {
    try {
        // Check if file exists
        try {
            await fs.access(screenshotPath);
        } catch {
            return null; // Screenshot doesn't exist
        }

        const aiData = await analyzePostImage(screenshotPath, {});

        if (field === 'likes' || field === 'comments' || field === 'shares') {
            // AI doesn't extract stats from images, return null
            return null;
        }
        if (field === 'content' || field === 'summary') {
            return aiData.summary || aiData.content || '';
        }
        if (field === 'sender') {
            return aiData.sender_name || '';
        }
        if (field === 'date') {
            return aiData.post_date || '';
        }
        if (field === 'group') {
            return aiData.group_name || '';
        }

        return null;
    } catch (error) {
        log(`AI extraction from screenshot failed: ${error.message}`, 'warning');
        return null;
    }
}

// Helper: Take new screenshot and extract with AI
async function tryNewScreenshotAndAI(url, field) {
    let browser = null;
    try {
        browser = await launchBrowser();
        const page = await navigateWithRetry(browser, url, 'Repair');
        await waitForLikelyContent(page, url);

        // Take screenshot
        const screenshotsDir = path.join(process.cwd(), 'visual_engine', 'screen_shots');
        await fs.mkdir(screenshotsDir, { recursive: true });
        const sanitizedUrl = url.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 100);
        const screenshotPath = path.join(screenshotsDir, `repair_${sanitizedUrl}_${Date.now()}.jpg`);

        await capturePostScreenshot(page, screenshotPath);
        const optimizedPath = await optimizeImage(screenshotPath);

        await page.close();
        await browser.close();

        // Extract with AI
        const result = await tryAIFromScreenshot(optimizedPath, field);

        // Cleanup
        try {
            if (screenshotPath !== optimizedPath) {
                await fs.unlink(screenshotPath);
            }
        } catch { }

        return result;
    } catch (error) {
        log(`New screenshot + AI failed: ${error.message}`, 'warning');
        if (browser) {
            try {
                await browser.close();
            } catch { }
        }
        return null;
    }
}

// Main repair function - repairs specific field
export async function repairField(spreadsheetId, sheetName, field, mainWindow) {
    log(`Starting repair for field: ${field}`, 'info');
    shouldStopRepair = false; // Reset stop flag

    if (!spreadsheetId) {
        return { success: false, message: 'Spreadsheet ID missing' };
    }

    const sheets = await getSheetsClient();
    if (!sheets) return { success: false, message: 'Auth failed' };

    try {
        // 1. Read Data
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${sheetName}!A:Z`, // Extended range
        });

        const rows = response.data.values;
        if (!rows || rows.length === 0) return { success: false, message: 'No data found' };

        const headers = rows[0];

        // Find columns
        const urlIndex = findColumn(headers, ['לינק', 'link', 'url', 'קישור']);
        if (urlIndex === -1) {
            return { success: false, message: 'URL column not found' };
        }

        // Find target column based on field
        let targetIndex = -1;
        const fieldMap = {
            'likes': ['likes', 'ריאקציות', 'reactions', 'like'],
            'comments': ['comments', 'תגובות', 'comment'],
            'shares': ['shares', 'שיתופים', 'share'],
            'content': ['content', 'תוכן', 'summary', 'סיכום'],
            'summary': ['summary', 'סיכום', 'content', 'תוכן'],
            'sender': ['sender', 'name', 'שם', 'כותב', 'sender name'],
            'date': ['date', 'תאריך', 'post date', 'תאריך פוסט'],
            'group': ['group', 'קבוצה', 'group name', 'שם קבוצה']
        };

        if (fieldMap[field]) {
            targetIndex = findColumn(headers, fieldMap[field]);
        }

        if (targetIndex === -1) {
            return { success: false, message: `Column for ${field} not found. Found headers: ${headers.join(', ')}` };
        }

        // 2. Read Local Logs (for screenshots)
        let jsonlLines = [];
        try {
            const content = await fs.readFile(JSONL_FILE, 'utf-8');
            jsonlLines = content.split('\n').filter(l => l).map(l => {
                try {
                    return JSON.parse(l);
                } catch {
                    return null;
                }
            }).filter(l => l);
        } catch (e) {
            log('No local logs found', 'info');
        }

        let updatedCount = 0;
        const updates = [];

        // 3. Determine extraction strategy based on field
        const usePuppeteer = ['likes', 'comments', 'shares', 'sender', 'date'].includes(field);
        const useAI = ['content', 'summary', 'sender', 'date', 'group'].includes(field);

        // 4. Iterate Rows
        for (let i = 1; i < rows.length; i++) {
            // Check if repair should be stopped
            if (shouldStopRepair) {
                log('Repair stopped by user', 'warning');
                return { success: false, message: 'Repair stopped by user' };
            }

            const row = rows[i];
            const url = row[urlIndex];

            if (!url || url.toString().trim() === '') {
                continue;
            }

            const urlStr = url.toString().trim();

            // Send progress to UI
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('scraping-output', {
                    type: 'info',
                    message: `Repairing row ${i + 1}/${rows.length - 1}: ${field}...`
                });
            }

            let value = null;

            // Strategy 1: Try Puppeteer (for stats, sender, date)
            if (usePuppeteer) {
                value = await tryPuppeteerExtraction(urlStr, field);
                if (value !== null && value !== '' && value !== 0) {
                    log(`Row ${i + 1}: Found ${field} via Puppeteer: ${value}`, 'success');
                }
            }

            // Strategy 2: Try AI from existing screenshot
            if ((value === null || value === '' || value === 0) && useAI) {
                const logEntry = jsonlLines.find(l => l.url === urlStr && l.screenshot);
                if (logEntry && logEntry.screenshot) {
                    const screenshotPath = logEntry.screenshot;
                    value = await tryAIFromScreenshot(screenshotPath, field);
                    if (value !== null && value !== '' && value !== 0) {
                        log(`Row ${i + 1}: Found ${field} via AI (existing screenshot): ${value}`, 'success');
                    }
                }
            }

            // Strategy 3: Take new screenshot and use AI
            if ((value === null || value === '' || value === 0) && useAI) {
                value = await tryNewScreenshotAndAI(urlStr, field);
                if (value !== null && value !== '' && value !== 0) {
                    log(`Row ${i + 1}: Found ${field} via AI (new screenshot): ${value}`, 'success');
                }
            }

            // If we found a value, add to updates (ALWAYS overwrite existing value)
            if (value !== null && value !== '' && value !== 0) {
                // Format date if needed
                let finalValue = value;
                if (field === 'date' && value) {
                    finalValue = formatDate(value);
                }

                updates.push({
                    range: `${sheetName}!${getColumnLetter(targetIndex)}${i + 1}`,
                    values: [[finalValue]]
                });
                updatedCount++;
                log(`Row ${i + 1}: Updating ${field} to ${finalValue}`, 'info');
            } else {
                log(`Row ${i + 1}: Could not find ${field}`, 'warning');
            }
        }

        // 5. Batch Update
        if (updates.length > 0) {
            await sheets.spreadsheets.values.batchUpdate({
                spreadsheetId,
                resource: {
                    data: updates,
                    valueInputOption: 'RAW'
                }
            });
            return { success: true, message: `Repaired ${updatedCount} rows for ${field}` };
        } else {
            return { success: true, message: `No missing ${field} found to repair` };
        }

    } catch (error) {
        log(`Repair failed: ${error.message}`, 'error');
        return { success: false, message: error.message };
    }
}

// Repair all missing fields
export async function repairAllFields(spreadsheetId, sheetName, mainWindow) {
    log('Starting repair for ALL fields', 'info');
    shouldStopRepair = false; // Reset stop flag

    const fields = ['group', 'likes', 'comments', 'shares', 'content', 'sender', 'date'];
    let totalRepaired = 0;
    const results = [];

    for (const field of fields) {
        // Check if repair should be stopped
        if (shouldStopRepair) {
            log('Repair stopped by user', 'warning');
            return { success: false, message: 'Repair stopped by user', details: results };
        }

        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('scraping-output', {
                type: 'info',
                message: `Repairing ${field}...`
            });
        }

        const result = await repairField(spreadsheetId, sheetName, field, mainWindow);
        results.push({ field, ...result });
        if (result.success && result.message.includes('Repaired')) {
            const match = result.message.match(/Repaired (\d+) rows/);
            if (match) totalRepaired += parseInt(match[1]);
        }
    }

    return {
        success: true,
        message: `Repair complete. Total rows repaired: ${totalRepaired}`,
        details: results
    };
}

// Legacy function - kept for backward compatibility
export async function repairSheetData(spreadsheetId, sheetName, mainWindow) {
    return await repairField(spreadsheetId, sheetName, 'group', mainWindow);
}
