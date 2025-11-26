// src/browser_manager.mjs
import puppeteer from 'puppeteer';
import fs from 'fs/promises';
import { log } from './logger.mjs';

// Lazy load config on first use
let CHROME_EXE, USER_DATA_DIR, PROFILE_DIR;
let configLoaded = false;

async function loadConfig() {
    if (configLoaded) return;

    try {
        const config = await import('../scrape_config.mjs');
        CHROME_EXE = config.CHROME_EXE;
        USER_DATA_DIR = config.USER_DATA_DIR;
        PROFILE_DIR = config.PROFILE_DIR;
    } catch {
        const config = await import('./scrape_config.mjs');
        CHROME_EXE = config.CHROME_EXE;
        USER_DATA_DIR = config.USER_DATA_DIR;
        PROFILE_DIR = config.PROFILE_DIR;
    }

    configLoaded = true;
}

export async function launchBrowser() {
    await loadConfig(); // Load config first
    log('Launching browser...', 'info');

    // Try multiple launch strategies
    const strategies = [
        // Strategy 1: With userDataDir + profile (PRIORITY - keeps Facebook login!)
        async () => {
            if (!USER_DATA_DIR || USER_DATA_DIR.trim() === '') {
                throw new Error('No user data dir configured');
            }

            await fs.mkdir(USER_DATA_DIR, { recursive: true });

            const opts = {
                headless: true,
                userDataDir: USER_DATA_DIR,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--disable-gpu'
                ]
            };

            // Add profile directory if configured
            if (PROFILE_DIR && PROFILE_DIR.trim() !== '') {
                opts.args.push(`--profile-directory=${PROFILE_DIR}`);
            }

            // Add Chrome executable if configured
            if (CHROME_EXE && CHROME_EXE.trim() !== '') {
                try {
                    await fs.access(CHROME_EXE);
                    opts.executablePath = CHROME_EXE;
                } catch {
                    // Continue without custom Chrome
                }
            }

            return await puppeteer.launch(opts);
        },

        // Strategy 2: With custom Chrome but no profile
        async () => {
            if (!CHROME_EXE || CHROME_EXE.trim() === '') {
                throw new Error('No Chrome executable configured');
            }

            try {
                await fs.access(CHROME_EXE);
            } catch {
                throw new Error('Chrome executable not found');
            }

            return await puppeteer.launch({
                executablePath: CHROME_EXE,
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--disable-gpu'
                ]
            });
        },

        // Strategy 3: Minimal Puppeteer bundled Chromium (fallback)
        async () => {
            return await puppeteer.launch({
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--disable-gpu'
                ]
            });
        }
    ];

    let lastError = null;
    for (let i = 0; i < strategies.length; i++) {
        try {
            log(`Trying launch strategy ${i + 1}/${strategies.length}...`, 'info');
            const browser = await strategies[i]();
            log(`Browser launched successfully (strategy ${i + 1})`, 'success');
            return browser;
        } catch (error) {
            lastError = error;
            log(`Strategy ${i + 1} failed: ${error.message}`, 'warning');
            if (i < strategies.length - 1) {
                log('Trying next strategy...', 'info');
            }
        }
    }

    // All strategies failed
    log(`All launch strategies failed. Last error: ${lastError?.message}`, 'error');
    throw new Error(`Failed to launch browser after ${strategies.length} attempts. Last error: ${lastError?.message || 'Unknown error'}`);
}

export async function newConfiguredPage(browser) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7' });

    // Anti-detection
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        Object.defineProperty(navigator, 'languages', { get: () => ['he-IL', 'he', 'en-US', 'en'] });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    });

    return page;
}

export async function navigateWithRetry(browser, url, name) {
    let page = await newConfiguredPage(browser);
    let attempts = 0;
    const maxAttempts = 2;

    while (attempts < maxAttempts) {
        try {
            log(`Navigating to: ${name || url} (Attempt ${attempts + 1})`, 'info');
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
            return page;
        } catch (e) {
            attempts++;
            log(`Navigation failed: ${e.message}`, 'warning');
            if (page) await page.close();
            if (attempts >= maxAttempts) throw e;

            page = await newConfiguredPage(browser); // New page for retry
        }
    }
    return page;
}

// Legacy function - not currently used (kept for potential future use)
export async function toMobileFacebook(url) {
    try {
        const u = new URL(url);
        if (u.hostname === 'www.facebook.com') {
            u.hostname = 'm.facebook.com';
            return u.toString();
        }
    } catch { }
    return url;
}
