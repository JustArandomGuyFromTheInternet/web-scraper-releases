// src/browser_manager.mjs
import puppeteer from 'puppeteer';
import fs from 'fs/promises';
import { log } from './logger.mjs';

// Lazy load config on first use
let CHROME_EXE, USER_DATA_DIR, PROFILE_DIR;
let configLoaded = false;

async function loadConfig() {
    if (configLoaded) return;

    const config = await import('./scrape_config.mjs');
    CHROME_EXE = config.CHROME_EXE;
    USER_DATA_DIR = config.USER_DATA_DIR;
    PROFILE_DIR = config.PROFILE_DIR;

    configLoaded = true;
}

export async function launchBrowser() {
    await loadConfig();
    log('Launching browser...', 'info');

    // Try multiple launch strategies
    const strategies = [
        // Strategy 1: With userDataDir + profile + system Chrome (PRIORITY - keeps Facebook login!)
        async () => {
            if (!USER_DATA_DIR || USER_DATA_DIR.trim() === '') {
                throw new Error('No user data dir configured');
            }

            log(`Using USER_DATA_DIR: ${USER_DATA_DIR}`, 'info');
            log(`Using PROFILE_DIR: ${PROFILE_DIR}`, 'info');
            
            await fs.mkdir(USER_DATA_DIR, { recursive: true });

            const opts = {
                headless: true,
                userDataDir: USER_DATA_DIR,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--disable-gpu',
                    '--force-device-scale-factor=0.85',  // 🎯 zoom out 85%
                    '--disable-sync',  // Disable Chrome sync to avoid conflicts
                    '--disable-breakpad',  // Disable crash reporting
                ]
            };

            // Add profile directory if configured
            if (PROFILE_DIR && PROFILE_DIR.trim() !== '') {
                opts.args.push(`--profile-directory=${PROFILE_DIR}`);
            }

            // Add Chrome executable if configured AND exists
            if (CHROME_EXE && CHROME_EXE.trim() !== '' && CHROME_EXE !== 'chrome') {
                try {
                    await fs.access(CHROME_EXE);
                    opts.executablePath = CHROME_EXE;
                    log(`Using system Chrome at: ${CHROME_EXE}`, 'success');
                } catch {
                    log(`Chrome not accessible at: ${CHROME_EXE}`, 'warning');
                    log('Will continue without explicit path...', 'info');
                }
            }

            return await puppeteer.launch(opts);
        },

        // Strategy 2: Simple launch with Puppeteer defaults (no profile, no explicit Chrome)
        async () => {
            log('Trying Puppeteer with defaults (no profile)...', 'info');
            const opts = {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--disable-gpu',
                    '--force-device-scale-factor=0.85',
                    '--disable-sync',  // Disable Chrome sync to avoid conflicts
                    '--disable-breakpad',  // Disable crash reporting
                ]
            };

            // Also try to use system Chrome here
            if (CHROME_EXE && CHROME_EXE.trim() !== '' && CHROME_EXE !== 'chrome') {
                try {
                    await fs.access(CHROME_EXE);
                    opts.executablePath = CHROME_EXE;
                    log(`Using system Chrome at: ${CHROME_EXE}`, 'success');
                } catch (e) {
                    log(`Chrome not accessible: ${e.message}`, 'warning');
                }
            }

            return await puppeteer.launch(opts);
        }
    ];

    let lastError = null;
    for (let i = 0; i < strategies.length; i++) {
        try {
            log(`Trying launch strategy ${i + 1}/${strategies.length}...`, 'info');
            const browser = await strategies[i]();
            log(`Browser launched successfully (strategy ${i + 1}) with 85% zoom`, 'success');
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

    // 🎯 Set larger viewport to take advantage of zoom out
    // Instead of 1920x1080, we use 2258x1270 (approximately) - this gives us 1.17x more content!
    await page.setViewport({
        width: 2258,   // 1920 / 0.85
        height: 1270,  // 1080 / 0.85
        deviceScaleFactor: 1  // Keep at 1 since zoom is already in browser settings
    });

    await page.setExtraHTTPHeaders({ 'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7' });

    // Anti-detection
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        Object.defineProperty(navigator, 'languages', { get: () => ['he-IL', 'he', 'en-US', 'en'] });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    });

    // 🎯 Additional option: Set zoom via CSS (fallback if --force-device-scale-factor doesn't work)
    await page.evaluateOnNewDocument(() => {
        // This adds zoom: 0.85 to body after page loads
        document.addEventListener('DOMContentLoaded', () => {
            document.body.style.zoom = '0.85';
        });
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

            // 🎯 אחרי הטעינה, ודא שה-zoom מוחל
            await page.evaluate(() => {
                document.body.style.zoom = '0.85';
            });
            
            // 🔐 Wait for login indicators to appear (profile pic, name, etc.)
            // This ensures the page has fully loaded with authentication
            try {
                await Promise.race([
                    page.waitForSelector('[role="navigation"]', { timeout: 5000 }).catch(() => {}),
                    page.waitForSelector('img[alt*="profile"], img[alt*="Avatar"]', { timeout: 5000 }).catch(() => {}),
                    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 5000 }).catch(() => {})
                ]);
            } catch (e) {
                log('Skipping auth wait (page might not have auth elements)', 'debug');
            }

            return page;
        } catch (e) {
            attempts++;
            log(`Navigation failed: ${e.message}`, 'warning');
            if (page) await page.close();
            if (attempts >= maxAttempts) throw e;

            page = await newConfiguredPage(browser);
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
