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

// Dynamic imports for modules that might be in root or src
const importExtractors = async () => {
    try {
        return await import('../extractors.mjs');
    } catch {
        return await import('./extractors.mjs');
    }
};

// Dynamic imports for visual engine (to keep startup fast)
const importVisualEngine = async () => {
    const { analyzePostImage } = await import('../visual_engine/ai_vision.mjs');
    const { optimizeImage } = await import('../visual_engine/image_optimizer.mjs');
    return { analyzePostImage, optimizeImage };
};

export async function main() {
    log('Starting Scraper Controller...', 'info');

    // 1. Setup
    try {
        await ensureOutFiles();
    } catch (e) {
        log(`Failed to setup output files: ${e.message}`, 'error');
        process.exit(1);
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
        log(`Failed to read links file: ${e.message}`, 'error');
        process.exit(1);
    }

    if (links.length === 0) {
        log('No links found to scrape.', 'warning');
        process.exit(0);
    }

    // 2. Launch Browser
    let browser;
    try {
        browser = await launchBrowser();
    } catch (e) {
        log(`Failed to launch browser: ${e.message}`, 'error');
        process.exit(1);
    }

    const succeeded = [], failed = [];
    let idx = 0;

    // 3. Process Links
    for (const row of links) {
        idx++;
        const { name, date, url } = row;
        const ts = new Date().toLocaleDateString("he-IL");

        log(`Processing [${idx}/${links.length}]: ${name || url}`, 'info', { step: idx, total: links.length });

        // Check types
        const isStory = url.toLowerCase().includes('story') || url.toLowerCase().includes('stories');
        const isReel = url.toLowerCase().includes('reel');
        const isTikTok = url.includes('tiktok.com');
        const IS_VISUAL_MODE = process.env.VISUAL_MODE === 'true';


        // SKIP LOGIC: Stories & Reels in Regular Mode
        if ((isStory || isReel) && !IS_VISUAL_MODE) {
            const type = isStory ? 'סטורי' : 'רילס';
            log(`${type} detected - Skipping (Regular Mode)`, 'warning', { indent: true });

            const payload = {
                sender_name: name || "Unknown",
                group_name: "",
                post_date: formatDate(date),
                summary: `${type} - לא ניתן לחלץ תוכן`
            };

            await appendSheetsRow({ url, ...payload, likes: 0, comments: 0, shares: 0, validation: "" });
            await appendJsonl({ ts, name, date, url, ok: false, ai: payload, metadata: {}, skipped: type.toLowerCase() });
            continue;
        }

        // STORY HANDLING (Visual Mode)
        if (isStory && IS_VISUAL_MODE) {
            log('Story in Visual Mode - Extracting from URL', 'info', { indent: true });

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
                    summary: `סטורי של ${senderName} - תוכן זמני שאינו ניתן לחילוץ`
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
            log('Reel detected - Extracting with AI', 'info', { indent: true });

            let page;
            try {
                page = await navigateWithRetry(browser, url, name);
                const { waitForLikelyContent, extractFacebookMetadata, extractTikTokMetadata } = await importExtractors();
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
                const screenshotsDir = path.join(process.cwd(), 'visual_engine', 'screen_shots');
                await fs.mkdir(screenshotsDir, { recursive: true });

                // Create filename from URL
                const sanitizedUrl = url.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 100);
                const screenshotPath = path.join(screenshotsDir, `reel_${sanitizedUrl}.jpg`);

                await page.screenshot({ path: screenshotPath, fullPage: false });

                // Use AI to extract date and other info from screenshot
                const { analyzePostImage, optimizeImage } = await importVisualEngine();
                const optimizedPath = await optimizeImage(screenshotPath);
                const aiData = await analyzePostImage(optimizedPath, statsMetadata);

                // Use AI date if available, otherwise use Puppeteer date, otherwise use formatDate(date)
                const extractedDate = aiData.post_date || statsMetadata.postDate || formatDate(date);
                const finalDate = extractedDate ? formatDate(extractedDate) : formatDate(date);

                // Prioritize AI shares if available
                const finalShares = aiData.shares !== undefined && aiData.shares !== null
                    ? aiData.shares
                    : (statsMetadata.shares || 0);

                // Save to sheets with AI-extracted data
                const payload = {
                    sender_name: aiData.sender_name || name || "Unknown",
                    group_name: aiData.group_name || statsMetadata.groupName || "",
                    post_date: finalDate,
                    summary: aiData.summary || "רילס"
                };

                await appendSheetsRow({ url, ...payload, likes: statsMetadata.likes || 0, comments: statsMetadata.comments || 0, shares: finalShares, validation: aiData.validation || "" });
                await appendJsonl({ ts, name, date, url, ok: true, ai: payload, metadata: statsMetadata, reel: true, screenshot: optimizedPath });
                succeeded.push({ name, date, url });
            } catch (e) {
                log(`Error processing Reel: ${e.message}`, 'error');
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
                const { waitForLikelyContent, extractFacebookMetadata, extractTikTokMetadata } = await importExtractors();
                await waitForLikelyContent(page, url);
                const { analyzePostImage, optimizeImage } = await importVisualEngine();

                // Screenshot
                const screenshotsDir = path.join(process.cwd(), 'visual_engine', 'screen_shots');
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
                let statsMetadata = { likes: 0, comments: 0, shares: 0, groupName: '', postDate: '' };
                if (url.includes('facebook.com')) {
                    log('Starting Facebook metadata extraction...', 'info');
                    try {
                        const fbMeta = await extractFacebookMetadata(page);
                        if (fbMeta) Object.assign(statsMetadata, fbMeta);
                        log('Facebook metadata extraction completed', 'success');
                    } catch (err) {
                        log(`Facebook metadata extraction failed: ${err.message}`, 'error');
                        throw err; // Re-throw to catch in main loop
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
                let aiData;
                try {
                    aiData = await analyzePostImage(optimizedPath, statsMetadata);
                    log('AI analysis completed', 'success');
                } catch (err) {
                    log(`AI analysis failed: ${err.message}`, 'error');
                    throw err;
                }

                // Prioritize AI shares if available, otherwise use Puppeteer
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
                    summary: aiData.summary || aiData.content || "No content"
                };

                await appendSheetsRow({
                    url,
                    ...payload,
                    likes: statsMetadata.likes || 0,
                    comments: statsMetadata.comments || 0,
                    shares: finalShares,
                    validation: aiData.validation || ""
                });

                // Save OPTIMIZED path to logs, so repair tool uses the small file
                await appendJsonl({ ts, name, date, url, ok: true, ai: payload, metadata: statsMetadata, visual: true, screenshot: optimizedPath });
                succeeded.push({ name, date, url });

                // Cleanup: Delete the huge original screenshot
                // Note: We do this in a separate async task to not block the main flow
                if (screenshotPath !== optimizedPath) {
                    // Schedule deletion after a delay to ensure file handles are released
                    setTimeout(async () => {
                        try {
                            // Wait longer to ensure all file handles are released
                            await new Promise(r => setTimeout(r, 5000));

                            // Try multiple times with retries
                            let deleted = false;
                            for (let attempt = 0; attempt < 5; attempt++) {
                                try {
                                    await fs.unlink(screenshotPath);
                                    deleted = true;
                                    log('Deleted original high-res screenshot', 'info');
                                    break;
                                } catch (unlinkError) {
                                    if (attempt < 4) {
                                        // Wait progressively longer before retry
                                        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
                                    }
                                }
                            }

                            if (!deleted) {
                                // Silent failure - don't spam logs with this
                                // The file will be cleaned up later or on next run
                            }
                        } catch (e) {
                            // Silent failure - file will be cleaned up later
                        }
                    }, 1000); // Start deletion attempt after 1 second
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
        }
    }

    // 4. Cleanup
    try {
        await browser.close();
        console.log('✅ Browser closed');
    } catch (e) {
        console.error(`⚠️ Error closing browser: ${e.message}`);
    }

    log(`Scrape completed. Succeeded: ${succeeded.length}, Failed: ${failed.length}`, 'success');
    console.log(`✅ SCRAPE COMPLETED - Succeeded: ${succeeded.length}, Failed: ${failed.length}`);

    if (failed.length > 0 && succeeded.length === 0) {
        console.error('❌ All links failed to process');
        process.exit(1);
    }
}

// Always run main when executed
main().catch(err => {
    console.error('❌ Fatal error in main():', err.message);
    console.error('Stack trace:', err.stack);
    log(`Fatal error: ${err.message}`, 'error');
    process.exit(1);
});
