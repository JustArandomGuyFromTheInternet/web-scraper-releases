// src/browser_manager.mjs
import puppeteer from 'puppeteer';
import fs from 'fs/promises';
import path from 'path';
import { log } from './logger.mjs';
import { injectCookiesIntoPuppeteer } from './cookie_sync.mjs';

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

    // 🔍 DEBUG: Log exactly what paths we're using
    log(`🔍 DEEP DEBUG: Chrome configuration:`, 'debug');
    log(`   CHROME_EXE: ${CHROME_EXE}`, 'debug');
    log(`   USER_DATA_DIR: ${USER_DATA_DIR}`, 'debug');
    log(`   PROFILE_DIR: ${PROFILE_DIR}`, 'debug');

    // Check if system Chrome folder
    const isSystemChromeFolder = USER_DATA_DIR && USER_DATA_DIR.includes('Google') && (USER_DATA_DIR.includes('Chrome') || USER_DATA_DIR.includes('chrome'));
    log(`   Is SYSTEM Chrome folder? ${isSystemChromeFolder ? 'YES ✅' : 'NO ❌'}`, 'debug');

    // Verify path exists
    let pathExists = false;
    try {
        await fs.access(USER_DATA_DIR);
        pathExists = true;
        log(`   Path ACCESSIBLE ✅: ${USER_DATA_DIR}`, 'debug');
    } catch (e) {
        log(`   Path NOT accessible ❌: ${USER_DATA_DIR}`, 'debug');
    }

    // ⚠️  If Chrome might be running, wait a moment for locks to release
    if (isSystemChromeFolder) {
        log(`\n⏳ Waiting 2 seconds for any Chrome processes to release file locks...`, 'info');
        await new Promise(r => setTimeout(r, 2000));
    }

    // Try multiple launch strategies
    const strategies = [
        // Strategy 1: Use your ACTUAL Chrome profile with your login session
        async () => {
            log(`Strategy 1: Launching Puppeteer with your Chrome session...`, 'debug');
            log(`   📍 Profile: ${USER_DATA_DIR}`, 'debug');

            // Ensure profile folder exists
            await fs.mkdir(USER_DATA_DIR, { recursive: true });

            const opts = {
                headless: true,
                userDataDir: USER_DATA_DIR,  // Use your actual Chrome folder with login
                timeout: 60000,  // 60 second timeout for launch
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--disable-gpu',
                    '--force-device-scale-factor=0.85',
                    '--disable-sync',  // Disable sync to prevent conflicts during scraping
                    '--disable-breakpad',
                    '--disable-renderer-backgrounding',
                    '--disable-backgrounding-timer-throttling',
                    `--profile-directory=${PROFILE_DIR || 'Default'}`,
                ]
            };

            // Use Chrome executable if it exists
            if (CHROME_EXE && CHROME_EXE.trim() !== '' && CHROME_EXE !== 'chrome') {
                try {
                    await fs.access(CHROME_EXE);
                    opts.executablePath = CHROME_EXE;
                    log(`   Using Chrome executable: ${CHROME_EXE}`, 'debug');
                } catch (e) {
                    log(`   Chrome path not accessible, will try auto-detect`, 'warning');
                }
            }

            log(`   Launching Puppeteer (timeout: 60 seconds)...`, 'debug');

            try {
                const browser = await puppeteer.launch(opts);
                log(`   ✅ Browser launched with your login session!`, 'success');
                return browser;
            } catch (launchError) {
                log(`   ❌ Launch failed: ${launchError.message}`, 'error');

                // Check if Chrome is in use
                if (launchError.message.includes('PROFILE_IN_USE') ||
                    launchError.message.includes('already in use') ||
                    launchError.message.includes('Failed to launch')) {
                    log(`\n   🔴 CHROME IS STILL RUNNING! 🔴`, 'error');
                    log(`   `, 'error');
                    log(`   You must CLOSE Chrome completely before running the scraper:`, 'error');
                    log(`   1. Close all Chrome windows`, 'error');
                    log(`   2. Wait 2-3 seconds`, 'error');
                    log(`   3. Try running the scraper again`, 'error');
                    log(`   `, 'error');
                    log(`   💡 TIP: If Chrome won't close, try: taskkill /F /IM chrome.exe`, 'warning');
                }

                throw launchError;
            }
        }
    ];

    let lastError = null;
    for (let i = 0; i < strategies.length; i++) {
        try {
            const browser = await strategies[i]();
            log(`\n✅✅✅ Browser launched successfully with your login!`, 'success');
            return browser;
        } catch (error) {
            lastError = error;
            log(`\n❌ Strategy ${i + 1} failed: ${error.message}`, 'error');
        }
    }

    log(`Failed to launch browser: ${lastError?.message}`, 'error');
    throw new Error(`Failed to launch browser: ${lastError?.message}`);
    throw new Error(`Failed to launch browser: ${lastError?.message}`);
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

            // Skip cookie injection - we're using the profile directly with Puppeteer's userDataDir
            // The cookies are already available in the browser profile

            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

            // 🎯 אחרי הטעינה, ודא שה-zoom מוחל
            await page.evaluate(() => {
                document.body.style.zoom = '0.85';
            });

            // 🔐 Wait for login indicators to appear (profile pic, name, etc.)
            // This ensures the page has fully loaded with authentication
            try {
                await Promise.race([
                    page.waitForSelector('[role="navigation"]', { timeout: 5000 }).catch(() => { }),
                    page.waitForSelector('img[alt*="profile"], img[alt*="Avatar"]', { timeout: 5000 }).catch(() => { }),
                    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 5000 }).catch(() => { })
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
