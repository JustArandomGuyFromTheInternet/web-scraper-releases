/**
 * Cookie Synchronization between Electron and Puppeteer
 * 
 * This module copies session data (cookies, localStorage) from Electron
 * to Puppeteer so that scraping uses the same logged-in account.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { log } from './logger.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Sync cookies from Electron's profile to Puppeteer's profile
 * @param {string} electronUserDataDir - Electron app user data directory (from app.getPath('userData'))
 * @param {string} puppeteerUserDataDir - Puppeteer Chrome profile directory
 * @param {string} electronCookiesFile - Path to exported Electron cookies JSON file
 */
export async function syncCookiesFromElectron(electronUserDataDir, puppeteerUserDataDir, electronCookiesFile = null) {
    try {
        if (!electronUserDataDir || !puppeteerUserDataDir) {
            log('Cookie sync skipped - missing directories', 'warning');
            return false;
        }

        log(`🔄 Syncing cookies from Electron to Puppeteer...`, 'info');
        log(`   From: ${electronUserDataDir}`, 'debug');
        log(`   To:   ${puppeteerUserDataDir}`, 'debug');

        // Ensure directories exist
        await fs.mkdir(electronUserDataDir, { recursive: true });
        await fs.mkdir(puppeteerUserDataDir, { recursive: true });

        // ✅ FIRST TRY: Load from exported Electron cookies JSON
        if (electronCookiesFile) {
            try {
                log(`🔍 Checking for exported cookies: ${electronCookiesFile}`, 'debug');
                const data = await fs.readFile(electronCookiesFile, 'utf-8');
                const cookies = JSON.parse(data);
                
                log(`📊 Electron cookies file contains ${cookies?.length || 0} cookies`, 'debug');
                
                if (cookies && Array.isArray(cookies) && cookies.length > 0) {
                    log(`✅ Found ${cookies.length} cookies in Electron export`, 'success');
                    
                    // Log some details about the cookies
                    const fbCookies = cookies.filter(c => c.domain?.includes('facebook') || c.domain?.includes('instagram'));
                    const twCookies = cookies.filter(c => c.domain?.includes('twitter') || c.domain?.includes('x.com'));
                    log(`   📱 Facebook/Instagram cookies: ${fbCookies.length}`, 'debug');
                    log(`   🐦 Twitter/X cookies: ${twCookies.length}`, 'debug');
                    
                    // Save cookies for later injection into Puppeteer
                    const cookiesStoragePath = path.join(puppeteerUserDataDir, 'cookies.json');
                    await fs.writeFile(cookiesStoragePath, JSON.stringify(cookies, null, 2));
                    log(`✅ Cookies saved to: ${cookiesStoragePath}`, 'success');
                    return true;
                } else {
                    log(`⚠️ Electron cookies file is empty or not an array`, 'warning');
                }
            } catch (e) {
                log(`❌ Could not load from ${electronCookiesFile}: ${e.message}`, 'warning');
            }
        } else {
            log(`❌ ELECTRON_COOKIES_FILE env var not set`, 'warning');
        }

        // Copy localStorage data if present
        try {
            const electronLocalStoragePath = path.join(electronUserDataDir, 'Local Storage');
            const puppeteerLocalStoragePath = path.join(puppeteerUserDataDir, 'Default', 'Local Storage');

            await fs.access(electronLocalStoragePath);
            await fs.mkdir(puppeteerLocalStoragePath, { recursive: true });

            // Copy all files from Local Storage
            const files = await fs.readdir(electronLocalStoragePath);
            for (const file of files) {
                const src = path.join(electronLocalStoragePath, file);
                const dest = path.join(puppeteerLocalStoragePath, file);
                try {
                    await fs.copyFile(src, dest);
                } catch (copyErr) {
                    log(`   Could not copy ${file}: ${copyErr.message}`, 'debug');
                }
            }
            log('✅ Local Storage synced', 'success');
        } catch (e) {
            log(`⚠️ Could not sync Local Storage: ${e.message}`, 'warning');
        }

        // Copy Session Storage if present
        try {
            const electronSessionPath = path.join(electronUserDataDir, 'Session Storage');
            const puppeteerSessionPath = path.join(puppeteerUserDataDir, 'Default', 'Session Storage');

            await fs.access(electronSessionPath);
            await fs.mkdir(puppeteerSessionPath, { recursive: true });

            const files = await fs.readdir(electronSessionPath);
            for (const file of files) {
                const src = path.join(electronSessionPath, file);
                const dest = path.join(puppeteerSessionPath, file);
                await fs.copyFile(src, dest);
            }
            log('✅ Session Storage synced', 'success');
        } catch (e) {
            log(`⚠️ Could not sync Session Storage: ${e.message}`, 'warning');
        }

        log('🔄 Cookie sync complete', 'info');
        return true;

    } catch (error) {
        log(`❌ Cookie sync failed: ${error.message}`, 'error');
        return false;
    }
}

/**
 * Get Electron app's user data directory
 * This is typically: C:\Users\{USERNAME}\AppData\Roaming\{AppName}
 * 
 * Note: This must be called from the main process or passed from there
 * @param {string} appName - Name of the app (default: 'web-scraper')
 */
export function getElectronUserDataDir(appName = 'web-scraper') {
    // This will be called from scrape controller, which needs to receive this from main.js
    const appData = process.env.APPDATA || process.env.HOME;
    return path.join(appData, appName);
}

/**
 * Inject cookies into a Puppeteer page
 * @param {Page} page - Puppeteer page object
 * @param {string} puppeteerUserDataDir - Directory containing cookies.json
 */
export async function injectCookiesIntoPuppeteer(page, puppeteerUserDataDir) {
    try {
        const cookiesFile = path.join(puppeteerUserDataDir, 'cookies.json');
        
        log(`🔍 Looking for cookies at: ${cookiesFile}`, 'debug');
        
        // Check if cookies file exists
        try {
            await fs.access(cookiesFile);
            log(`✅ Cookies file found`, 'debug');
        } catch {
            log(`❌ Cookies file not found at: ${cookiesFile}`, 'warning');
            return false;
        }

        const data = await fs.readFile(cookiesFile, 'utf-8');
        const cookies = JSON.parse(data);

        if (!cookies || !Array.isArray(cookies) || cookies.length === 0) {
            log('❌ Cookies file is empty or invalid', 'warning');
            return false;
        }

        log(`📦 Found ${cookies.length} cookies, attempting injection...`, 'debug');
        
        // Filter out invalid cookies and log what we're injecting
        const validCookies = cookies.filter(c => c && c.name && c.value);
        log(`📋 ${validCookies.length} cookies are valid (have name & value)`, 'debug');

        // Inject cookies into the page
        if (validCookies.length === 0) {
            log(`❌ No valid cookies to inject`, 'warning');
            return false;
        }

        try {
            await page.setCookie(...validCookies);
            log(`✅ Injected ${validCookies.length} cookies into Puppeteer page`, 'success');
            
            // Log the domains we injected for
            const domains = new Set(validCookies.map(c => c.domain || c.url || 'unknown'));
            log(`   Domains: ${Array.from(domains).join(', ')}`, 'debug');
            
            return true;
        } catch (e) {
            log(`⚠️ Could not inject all cookies at once: ${e.message}`, 'warning');
            // Try to inject one by one, skipping failed ones
            let injected = 0;
            for (const cookie of validCookies) {
                try {
                    await page.setCookie(cookie);
                    injected++;
                } catch (err) {
                    log(`   Skipped cookie '${cookie.name}' for ${cookie.domain}: ${err.message}`, 'debug');
                }
            }
            log(`✅ Injected ${injected}/${validCookies.length} cookies individually`, 'success');
            return injected > 0;
        }
    } catch (error) {
        log(`❌ Cookie injection failed: ${error.message}`, 'warning');
        return false;
    }
}
