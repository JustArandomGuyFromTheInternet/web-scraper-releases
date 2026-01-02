// src/scrape_controller.mjs
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { launchBrowser, navigateWithRetry } from './browser_manager.mjs';
import { ensureOutFiles, appendSheetsRow, appendJsonl, formatDate } from './data_service.mjs';
import { log } from './logger.mjs';

// Module caching system (lazy singleton pattern)
let extractorsModule = null;
let visualEngineModule = null;

const getExtractors = async () => {
    if (!extractorsModule) {
        extractorsModule = await import('./extractors.mjs');
    }
    return extractorsModule;
};

const getVisualEngine = async () => {
    if (!visualEngineModule) {
        const vision = await import('../visual_engine/ai_vision.mjs');
        const optimizer = await import('../visual_engine/image_optimizer.mjs');
        visualEngineModule = { analyzePostImage: vision.analyzePostImage, optimizeImage: optimizer.optimizeImage };
    }
    return visualEngineModule;
};

// File cleanup queue - safer than setTimeout
class FileCleanupQueue {
    constructor() {
        this.queue = [];
    }
    async add(filePath) {
        this.queue.push(filePath);
    }
    async process() {
        for (const filePath of this.queue) {
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    await fs.unlink(filePath);
                    log(`Cleanup: ${filePath}`, 'debug');
                    break;
                } catch (e) {
                    if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
                }
            }
        }
        this.queue = [];
    }
}
const cleanupQueue = new FileCleanupQueue();

export async function main() {
    log('Initializing scraper...', 'info');

    // Stop mechanism
    let shouldStop = false;
    process.on('SIGINT', () => { shouldStop = true; });
    process.on('SIGTERM', () => { shouldStop = true; });

    // 1. Setup
    try {
        await ensureOutFiles();
    } catch (e) {
        log(`Output setup failed: ${e.message}`, 'error');
        throw e; // Don't kill process immediately
    }

    const LINKS_FILE = process.env.LINKS_FILE || "links.json";

    let links = [];
    try {
        const content = await fs.readFile(LINKS_FILE, 'utf-8');
        links = JSON.parse(content);

        // Handle both array format and object format
        if (!Array.isArray(links)) {
            if (links.links && Array.isArray(links.links)) {
                links = links.links;
            } else {
                throw new Error('Invalid links format - expected array or object with links array');
            }
        }

    } catch (e) {
        log(`Cannot read links file: ${e.message}`, 'error');
        throw e;
    }

    if (links.length === 0) {
        log('No links provided to scrape', 'warning');
        return;
    }
    // 2. Launch Browser
    let browser;
    try {
        // Silently launch browser in headless mode
        log('Initializing browser...', 'info');
        browser = await launchBrowser();
    } catch (e) {
        log(`Browser launch failed: ${e.message}`, 'error');
        throw e;
    }

    const succeeded = [], failed = [];
    let idx = 0;

    // 3. Process Links
    try {
        for (const row of links) {
            if (shouldStop) {
                log('Scraping stopped by user', 'warning');
                break;
            }

            idx++;
            const { name, date, url } = row;
            const ts = new Date().toLocaleDateString("he-IL");

            log(`[${idx}/${links.length}] Processing link...`, 'info', { step: idx, total: links.length });

            // Check types
            const isStory = url.toLowerCase().includes('story') || url.toLowerCase().includes('stories');
            const isReel = url.toLowerCase().includes('reel');
            const isTikTok = url.includes('tiktok.com');
            const IS_VISUAL_MODE = process.env.VISUAL_MODE === 'true';


            // SKIP LOGIC: Stories & Reels in Regular Mode
            if ((isStory || isReel) && !IS_VISUAL_MODE) {
                const type = isStory ? 'Story' : 'Reel';
                log(`Skipping ${type} (not supported in this mode)`, 'warning', { indent: true });

                const payload = {
                    sender_name: name || "Unknown",
                    group_name: "",
                    post_date: formatDate(date),
                    summary: `${type} - Cannot extract content in regular mode`
                };

                await appendSheetsRow({ url, ...payload, likes: 0, comments: 0, shares: 0, validation: "" });
                await appendJsonl({ ts, name, date, url, ok: false, ai: payload, metadata: {}, skipped: type.toLowerCase() });
                continue;
            }

            // STORY HANDLING (Visual Mode)
            if (isStory && IS_VISUAL_MODE) {
                log('Story found - extracting...', 'info', { indent: true });

                let senderName = name || "Unknown";
                try {
                    const urlObj = new URL(url);
                    if (urlObj.hostname.includes('instagram.com')) {
                        const match = url.match(/stories\/([^\/\?]+)/);
                        if (match && match[1]) senderName = match[1].replace(/_/g, ' ').replace(/\./g, ' ');
                    } else if (urlObj.hostname.includes('facebook.com')) {
                        const match = url.match(/\/stories\/([^\/\?]+)/);
                        if (match && match[1] && isNaN(match[1])) senderName = match[1].replace(/_/g, ' ').replace(/\./g, ' ');
                    }

                    const payload = {
                        sender_name: senderName,
                        group_name: "",
                        post_date: formatDate(date),
                        summary: `Story from ${senderName} - Temporary content cannot be extracted`
                    };

                    await appendSheetsRow({ url, ...payload, likes: 0, comments: 0, shares: 0, validation: "" });
                    await appendJsonl({ ts, name: senderName, date, url, ok: true, ai: payload, metadata: {}, story: true });
                    succeeded.push({ name: senderName, date, url });
                } catch (e) {
                    failed.push({ name, date, url, error: e.message });
                }
                continue;
            }

            // REEL HANDLING (Visual Mode) - Screenshot with AI for date extraction
            if (isReel && IS_VISUAL_MODE) {
                log('Reel found - analyzing with AI...', 'info', { indent: true });

                let page;
                try {
                    page = await navigateWithRetry(browser, url, name);
                    const extractors = await getExtractors();
                    const { waitForLikelyContent, extractFacebookMetadata, extractTikTokMetadata } = extractors;
                    await waitForLikelyContent(page, url);

                    // Extract metadata (including date) using Puppeteer
                    let statsMetadata = { likes: 0, comments: 0, shares: 0, groupName: '', postDate: '' };
                    if (url.includes('facebook.com')) {
                        const fbMeta = await extractFacebookMetadata(page);
                        if (fbMeta) Object.assign(statsMetadata, fbMeta);
                    } else if (url.includes('tiktok.com')) {
                        const ttMeta = await extractTikTokMetadata(page);
                        if (ttMeta) Object.assign(statsMetadata, ttMeta);
                    }

                    // Take screenshot with URL-based filename
                    const screenshotsDir = process.env.SCREENSHOTS_DIR || path.join(process.cwd(), 'visual_engine', 'screen_shots');
                    await fs.mkdir(screenshotsDir, { recursive: true });

                    // Create filename from URL
                    const sanitizedUrl = url.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 100);
                    const screenshotPath = path.join(screenshotsDir, `reel_${sanitizedUrl}.jpg`);

                    await page.screenshot({ path: screenshotPath, fullPage: false });

                    // Use AI to extract date and other info from screenshot
                    const visualEngine = await getVisualEngine();
                    const optimizedPath = await visualEngine.optimizeImage(screenshotPath);
                    const { analyzePostImage } = visualEngine;
                    const aiData = await analyzePostImage(optimizedPath, statsMetadata);

                    // Use AI date if available, otherwise use Puppeteer date, otherwise use formatDate(date)
                    const extractedDate = aiData.post_date || statsMetadata.postDate || formatDate(date);
                    const finalDate = extractedDate ? formatDate(extractedDate) : formatDate(date);

                    // Prioritize AI stats, fallback to Puppeteer
                    const finalLikes = (aiData.likes !== undefined && aiData.likes !== null && aiData.likes > 0)
                        ? aiData.likes
                        : (statsMetadata.likes || 0);
                    const finalComments = (aiData.comments !== undefined && aiData.comments !== null && aiData.comments > 0)
                        ? aiData.comments
                        : (statsMetadata.comments || 0);
                    const finalShares = aiData.shares !== undefined && aiData.shares !== null
                        ? aiData.shares
                        : (statsMetadata.shares || 0);

                    // Save to sheets with AI-extracted data
                    const payload = {
                        sender_name: aiData.sender_name || name || "Unknown",
                        group_name: aiData.group_name || statsMetadata.groupName || "",
                        post_date: finalDate,
                        summary: aiData.summary || "Reel"
                    };

                    await appendSheetsRow({ url, ...payload, likes: finalLikes, comments: finalComments, shares: finalShares, validation: aiData.validation || "✓" });
                    await appendJsonl({ ts, name, date, url, ok: true, ai: payload, metadata: statsMetadata, reel: true, screenshot: optimizedPath });
                    succeeded.push({ name, date, url });
                } catch (e) {
                    log(`Failed to analyze reel: ${e.message}`, 'error');
                    failed.push({ name, date, url, error: e.message });
                } finally {
                    if (page) await page.close();
                }
                continue;
            }

            // REGULAR / VISUAL SCRAPE
            let page;
            try {
                page = await navigateWithRetry(browser, url, name);

                if (IS_VISUAL_MODE) {
                    const extractors = await getExtractors();
                    const { waitForLikelyContent, extractFacebookMetadata, extractTikTokMetadata } = extractors;
                    await waitForLikelyContent(page, url);
                    const visualEngine = await getVisualEngine();
                    const { analyzePostImage, optimizeImage } = visualEngine;

                    // Screenshot
                    const screenshotsDir = process.env.SCREENSHOTS_DIR || path.join(process.cwd(), 'visual_engine', 'screen_shots');
                    await fs.mkdir(screenshotsDir, { recursive: true });

                    // Create filename from URL (sanitize and limit length)
                    const sanitizedUrl = url.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 100);
                    const screenshotPath = path.join(screenshotsDir, `post_${sanitizedUrl}.jpg`);

                    // Use improved capture strategy
                    let capturePostScreenshot;
                    try {
                        const module = await import('../visual_engine/screenshot.mjs');
                        capturePostScreenshot = module.capturePostScreenshot;
                    } catch (e) {
                        log(`Failed to import screenshot module: ${e.message}`, 'error');
                        throw e;
                    }
                    await capturePostScreenshot(page, screenshotPath);

                    const optimizedPath = await optimizeImage(screenshotPath);

                    // Puppeteer Stats
                    let statsMetadata = { likes: 0, comments: 0, groupName: '', postDate: '' };
                    if (url.includes('facebook.com')) {
                        log('Starting Facebook metadata extraction...', 'info');
                        try {
                            const fbMeta = await extractFacebookMetadata(page);
                            if (fbMeta) Object.assign(statsMetadata, fbMeta);
                            log('Facebook metadata extraction completed', 'success');
                        } catch (err) {
                            log(`Facebook metadata extraction failed: ${err.message}`, 'error');
                            // DON'T throw - continue with empty metadata
                            console.warn('⚠️ Continuing without Facebook metadata');
                        }
                    } else if (isTikTok) {
                        log('Starting TikTok metadata extraction...', 'info');
                        try {
                            const ttMeta = await extractTikTokMetadata(page);
                            if (ttMeta) Object.assign(statsMetadata, ttMeta);
                            log('TikTok metadata extraction completed', 'success');
                        } catch (err) {
                            log(`TikTok metadata extraction failed: ${err.message}`, 'error');
                            throw err;
                        }
                    }

                    // AI Analysis (pass shares from Puppeteer for validation)
                    log('Starting AI analysis...', 'info');
                    let aiData = null;
                    try {
                        aiData = await analyzePostImage(optimizedPath, statsMetadata);
                        log('AI analysis completed', 'success');
                        console.log('--- DEBUG ENCODING ---');
                        console.log('AI Group Name:', aiData.group_name);
                        console.log('Puppeteer Group Name:', statsMetadata.groupName);
                        console.log('----------------------');
                    } catch (err) {
                        log(`[WARN] AI analysis failed: ${err.message}`, 'warning');
                        log('[INFO] Continuing with Puppeteer data only (no AI validation)', 'info');
                        // Don't throw - continue with what we have from Puppeteer
                        aiData = {
                            sender_name: null,
                            group_name: null,
                            summary: null,
                            post_date: null,
                            shares: null,
                            validation: null,
                            ai_error: err.message
                        };
                    }

                    // Prioritize AI stats, fallback to Puppeteer
                    const finalLikes = (aiData.likes !== undefined && aiData.likes !== null && aiData.likes > 0)
                        ? aiData.likes
                        : (statsMetadata.likes || 0);
                    const finalComments = (aiData.comments !== undefined && aiData.comments !== null && aiData.comments > 0)
                        ? aiData.comments
                        : (statsMetadata.comments || 0);
                    const finalShares = aiData.shares !== undefined && aiData.shares !== null
                        ? aiData.shares
                        : (statsMetadata.shares || 0);

                    // Format date properly
                    const extractedDate = aiData.post_date || statsMetadata.postDate || formatDate(date);
                    const finalDate = extractedDate ? formatDate(extractedDate) : formatDate(date);

                    // Save
                    const payload = {
                        sender_name: aiData.sender_name || name || "Unknown",
                        group_name: aiData.group_name || statsMetadata.groupName || "",
                        post_date: finalDate,
                        summary: aiData.summary || aiData.content || "No content (AI analysis skipped)"
                    };

                    await appendSheetsRow({
                        url,
                        ...payload,
                        likes: finalLikes,
                        comments: finalComments,
                        shares: finalShares,
                        validation: aiData.validation || (aiData.ai_error ? `[AI Error: ${aiData.ai_error}]` : "✓")
                    });

                    // Save OPTIMIZED path to logs, so repair tool uses the small file
                    await appendJsonl({ ts, name, date, url, ok: true, ai: payload, metadata: statsMetadata, visual: true, screenshot: optimizedPath });
                    succeeded.push({ name, date, url });

                    // Cleanup: Delete the huge original screenshot (via queue, non-blocking)
                    if (screenshotPath !== optimizedPath) {
                        await cleanupQueue.add(screenshotPath);
                        log('Screenshot queued for cleanup', 'debug');
                    }

                } else {
                    // Regular text mode - not used in current implementation (visual mode is default)
                    log('Regular text mode is not used - visual mode is the default', 'info');
                }

            } catch (error) {
                log(`Error processing ${url}: ${error.message}`, 'error');
                failed.push({ name, date, url, error: error.message });
            } finally {
                if (page) await page.close();

                // Rate limiting: Add delay between posts in visual mode to avoid Gemini quota issues
                if (IS_VISUAL_MODE && (succeeded.length + failed.length) < links.length) {
                    const delaySeconds = 1; // 1 second between posts (reduced for speed)
                    log(`[INFO] Waiting ${delaySeconds}s before next post...`, 'info');
                    await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
                }
            }
        }
    } catch (loopError) {
        log(`Fatal error in scraping loop: ${loopError.message}`, 'error');
        throw loopError;
    } finally {
        // 4. Cleanup - Always close browser
        if (browser) {
            try {
                await browser.close();
                console.log('[OK] Browser closed');
            } catch (e) {
                console.error(`[WARN] Error closing browser: ${e.message}`);
            }
        }
    }

    log(`Scrape completed. Succeeded: ${succeeded.length}, Failed: ${failed.length}`, 'success');
    console.log(`✅ SCRAPE COMPLETED - Succeeded: ${succeeded.length}, Failed: ${failed.length}`);
}

// Always run main when executed
main().catch(err => {
    console.error('❌ Fatal error in main():', err.message);
    console.error('Stack trace:', err.stack);
    log(`Fatal error: ${err.message}`, 'error');
    // Don't call process.exit - let Electron handle it
});
