import fs from 'fs/promises';
import path from 'path';

/**
 * Captures a focused screenshot of the post content using S09 strategy.
 * @param {import('puppeteer').Page} page - The Puppeteer page instance.
 * @param {string} outputPath - The full path to save the screenshot.
 * @returns {Promise<boolean>} - True if screenshot was captured, false otherwise.
 */
/**
 * Auto-scrolls the page smoothly to load all lazy-loaded content
 * @param {import('puppeteer').Page} page - The Puppeteer page instance
 */
async function autoScrollPage(page) {
    console.log('📜 Auto-scrolling to load all content...');

    await page.evaluate(async () => {
        await new Promise((resolve) => {
            let totalHeight = 0;
            const distance = 100; // Scroll 100px at a time
            const timer = setInterval(() => {
                const scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;

                if (totalHeight >= scrollHeight) {
                    clearInterval(timer);
                    resolve();
                }
            }, 100); // Scroll every 100ms
        });
    });

    console.log('✅ Auto-scroll completed');
}

export async function capturePostScreenshot(page, outputPath) {
    try {
        console.log('📸 Attempting to capture full page screenshot...');

        // Auto-scroll to load all lazy-loaded content (likes, comments, shares, etc.)
        // console.log('📸 Calling autoScrollPage...');
        // await autoScrollPage(page);
        // console.log('📸 autoScrollPage returned');

        // Scroll back to top for clean screenshot
        console.log('📸 Scrolling to top...');
        await page.evaluate(() => window.scrollTo(0, 0));
        await new Promise(r => setTimeout(r, 500));

        // Use S09 Strategy: div[role="main"] > div > div > div
        // This strategy was tested and works best for capturing Facebook posts
        const selector = 'div[role="main"] > div > div > div';

        console.log(`🎯 Using S09 strategy: ${selector}`);

        let element = null;

        try {
            element = await page.$(selector);
            if (element) {
                // Check if element is visible and has non-zero size
                const box = await element.boundingBox();
                if (box && box.width > 0 && box.height > 0) {
                    console.log(`✅ Found target element (${Math.round(box.width)}x${Math.round(box.height)}px)`);

                    // Scroll the element into view and ensure it's fully loaded
                    await element.scrollIntoView();
                    await new Promise(r => setTimeout(r, 500));

                    // Get the actual scroll height of the element (might be taller than viewport)
                    const elementInfo = await element.evaluate((el) => {
                        return {
                            scrollHeight: el.scrollHeight,
                            clientHeight: el.clientHeight,
                            offsetHeight: el.offsetHeight
                        };
                    });

                    console.log(`📏 Element dimensions: scrollHeight=${elementInfo.scrollHeight}px, clientHeight=${elementInfo.clientHeight}px`);

                    // If element is taller than viewport, scroll within it to load lazy content
                    if (elementInfo.scrollHeight > elementInfo.clientHeight) {
                        console.log('📜 Element is tall - scrolling within element to load content...');
                        await element.evaluate((el) => {
                            return new Promise((resolve) => {
                                const maxScroll = el.scrollHeight - el.clientHeight;
                                let currentScroll = 0;
                                const scrollStep = el.clientHeight * 0.8; // Scroll 80% of viewport at a time

                                const scrollInterval = setInterval(() => {
                                    currentScroll += scrollStep;
                                    if (currentScroll >= maxScroll) {
                                        el.scrollTop = maxScroll;
                                        clearInterval(scrollInterval);
                                        // Wait a bit, then scroll back to top
                                        setTimeout(() => {
                                            el.scrollTop = 0;
                                            resolve();
                                        }, 500);
                                    } else {
                                        el.scrollTop = currentScroll;
                                    }
                                }, 300);
                            });
                        });

                        // Wait a bit after scrolling
                        await new Promise(r => setTimeout(r, 500));
                    }

                    // Scroll back to top of element
                    await element.scrollIntoView();
                    await new Promise(r => setTimeout(r, 300));

                    // 🎯 הגבלת גובה מקסימלי כדי למנוע תמונות ארוכות מדי
                    const MAX_HEIGHT = 4000; // מקסימום 4000px גובה
                    const captureBox = await element.boundingBox();

                    if (captureBox.height > MAX_HEIGHT) {
                        console.log(`⚠️ תמונה ארוכה מדי (${Math.round(captureBox.height)}px) - מגביל ל-${MAX_HEIGHT}px`);
                        await element.screenshot({
                            path: outputPath,
                            type: 'jpeg',
                            quality: 80,
                            clip: {
                                x: captureBox.x,
                                y: captureBox.y,
                                width: captureBox.width,
                                height: MAX_HEIGHT
                            }
                        });
                    } else {
                        // Capture the full element normally
                        await element.screenshot({
                            path: outputPath,
                            type: 'jpeg',
                            quality: 80
                        });
                    }

                    console.log(`📸 Screenshot saved to: ${outputPath}`);
                    return true;
                }
            }
        } catch (e) {
            console.warn(`⚠️ S09 strategy failed: ${e.message}`);
        }

        // Fallback: limited page screenshot if S09 fails
        console.warn('⚠️ S09 strategy not found. Taking limited screenshot as fallback.');

        // 🎯 צלם רק את החלק העליון של הדף (מקסימום 4000px)
        const viewport = await page.viewport();
        const MAX_HEIGHT = 4000;

        await page.screenshot({
            path: outputPath,
            type: 'jpeg',
            quality: 80,
            clip: {
                x: 0,
                y: 0,
                width: viewport.width,
                height: Math.min(MAX_HEIGHT, viewport.height)
            }
        });
        console.log(`📸 Full page screenshot saved to: ${outputPath}`);
        return true;

    } catch (error) {
        console.error('❌ Error capturing screenshot:', error);
        return false;
    }
}
