// extractors.mjs
// Smart content extraction for different social media platforms (with fallbacks)

export const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const cleanText = (s = "") => s.replace(/\u200B/g, "").replace(/\s+/g, " ").trim();

export async function waitForLikelyContent(page, url) {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes("facebook.com")) {
        // Try multiple selectors for Facebook posts (dialog first - most reliable)
        const selectors = [
            '[role="dialog"][aria-modal="true"]',  // Modal post view (most reliable)
            '[role="main"] article',                // Main feed post
            '[role="article"]',                    // Generic article with role
            'article',                              // Plain article fallback
            'div[data-pagelet]',                    // Facebook pagelet container
        ];

        let found = false;
        for (const selector of selectors) {
            try {
                await page.waitForSelector(selector, { timeout: 15000 });
                console.log(`✅ Found content with selector: ${selector}`);
                found = true;
                await delay(3000); // Wait for content to load
                break;
            } catch (e) {
                // Try next selector
                continue;
            }
        }

        if (!found) {
            console.log("⚠️ Post modal/article not found, using full-page load (this is normal for some post types).");
            await page.waitForSelector("body", { timeout: 60000 });
            await delay(6000);
        }
    } else if (host.endsWith("instagram.com")) {
        await page.waitForSelector('article, main, [role="dialog"]', { timeout: 120000 });
        await delay(5000);
    } else if (host.endsWith("tiktok.com")) {
        try { await page.waitForSelector('[data-e2e="video-desc"], h1, h2', { timeout: 15000 }); } catch { }
        await delay(1200);
    } else {
        await page.waitForSelector("main, article, body", { timeout: 15000 });
        await delay(800);
    }
}

function parsePostDate(dateStr) {
    if (!dateStr) return '';
    const now = new Date();
    let postDate = new Date();
    const num = parseInt(dateStr.match(/\d+/)?.[0] || 0);

    if (dateStr.includes('yesterday')) postDate.setDate(now.getDate() - 1);
    else if (dateStr.includes('day') || dateStr.includes('d')) postDate.setDate(now.getDate() - num);
    else if (dateStr.includes('week') || dateStr.includes('w')) postDate.setDate(now.getDate() - num * 7);
    else if (dateStr.includes('month') || dateStr.includes('mo')) postDate.setMonth(now.getMonth() - num);
    else if (dateStr.includes('year') || dateStr.includes('y')) postDate.setFullYear(now.getFullYear() - num);
    else if (dateStr.includes('hour') || dateStr.includes('hr') || dateStr.includes('h')) postDate = now;
    else if (dateStr.includes('minute') || dateStr.includes('min') || dateStr.includes('m')) postDate = now;
    else if (dateStr.includes('just now')) postDate = now;

    const d = String(postDate.getDate()).padStart(2, '0');
    const m = String(postDate.getMonth() + 1).padStart(2, '0');
    const y = String(postDate.getFullYear()).slice(-2);
    return `${d}.${m}.${y}`;
}

// Extract post content text
export async function extractPostContent(page, url) {
    const host = new URL(url).hostname.toLowerCase();

    if (host.includes('facebook.com')) {
        try {
            return await page.evaluate(() => {
                console.log('=== Extracting Post Content ===');

                // Strategy 1: Find the main post text in article (dialog first!)
                const article = document.querySelector('[role="dialog"][aria-modal="true"]') ||
                    document.querySelector('[role="article"]') ||
                    document.querySelector('article');

                if (article) {
                    // Look for div[dir="auto"] elements that contain actual post text
                    const divs = article.querySelectorAll('div[dir="auto"]');

                    let longestText = '';
                    for (const div of divs) {
                        const text = div.textContent.trim();

                        // Skip if it's metadata (likes, comments, shares)
                        if (/^\d+\s*(like|comment|share|reaction)/i.test(text)) continue;
                        if (/^(like|comment|share)/i.test(text)) continue;

                        // Skip if it's a date/time
                        if (/\d+\s*(h|hr|hour|min|minute|day|week|month|year)s?\s*ago/i.test(text)) continue;
                        if (/yesterday|today/i.test(text) && text.length < 20) continue;

                        // Skip if it's just a name (too short)
                        if (text.length < 30) continue;

                        // Take the longest meaningful text
                        if (text.length > longestText.length) {
                            longestText = text;
                            console.log(`Found candidate: ${text.substring(0, 100)}...`);
                        }
                    }

                    if (longestText.length > 50) {
                        console.log(`Selected post content: ${longestText.substring(0, 150)}...`);
                        return longestText;
                    }
                }

                // Strategy 2: Try specific selectors
                const selectors = [
                    '[data-ad-preview="message"]',
                    '[data-ad-comet-preview="message"]',
                    '[data-testid="post_message"]',
                    '.userContent'
                ];

                for (const sel of selectors) {
                    const el = document.querySelector(sel);
                    if (el && el.textContent && el.textContent.length > 50) {
                        console.log(`Found via selector ${sel}: ${el.textContent.substring(0, 100)}...`);
                        return el.textContent.trim();
                    }
                }

                // Fallback: get article text but clean it
                if (article) {
                    const text = article.textContent.trim();
                    console.log(`Fallback to article text: ${text.substring(0, 100)}...`);
                    return text;
                }

                console.log('No post content found, using body');
                return document.body.textContent.substring(0, 2000);
            });
        } catch (error) {
            console.error('Error extracting post content:', error.message);
            return ''; // Return empty string on error
        }
    }

    try {
        return await page.evaluate(() => document.body.textContent.substring(0, 2000));
    } catch (error) {
        console.error('Error extracting page content:', error.message);
        return '';
    }
}

// Generic text extraction function
export async function extractTextByHost(page, url) {
    const host = new URL(url).hostname.toLowerCase();

    if (host.includes('facebook.com')) {
        const metadata = await extractFacebookMetadata(page);
        const content = await extractPostContent(page, url);
        return { ...metadata, content };
    } else if (host.includes('instagram.com')) {
        return await page.evaluate(() => {
            const title = document.querySelector('h1')?.textContent || '';
            const content = document.querySelector('article')?.textContent || document.body.textContent;
            return { title, content: content.substring(0, 500) };
        });
    } else if (host.includes('tiktok.com')) {
        return await page.evaluate(() => {
            const title = document.querySelector('[data-e2e="video-desc"]')?.textContent || '';
            const content = document.body.textContent;
            return { title, content: content.substring(0, 500) };
        });
    } else {
        return await page.evaluate(() => {
            const title = document.querySelector('h1')?.textContent || document.title;
            const content = document.body.textContent;
            return { title, content: content.substring(0, 500) };
        });
    }
}

export async function extractFacebookMetadata(page) {
    const data = await page.evaluate(() => {
        let metadata = { senderName: '', postDate: '', groupName: '', likes: 0, comments: 0, shares: 0 };

        // Helper to decode unicode escapes if they appear as literal text
        const decodeText = (str) => {
            if (!str) return '';
            try {
                // If text looks like unicode escapes (e.g. \u05d4)
                if (str.includes('\\u')) {
                    return JSON.parse(`"${str}"`);
                }
            } catch (e) {
                // Ignore parse errors and return original
            }
            return str;
        };

        try {
            // ===== STEP 1: EXTRACT FROM JSON SCRIPTS =====
            console.log('=== Searching JSON scripts ===');
            const scripts = document.querySelectorAll('script[type="application/json"]');

            for (let script of scripts) {
                try {
                    const content = script.textContent || '';

                    // Extract sender name from JSON (most reliable)
                    if (!metadata.senderName && content.includes('actor')) {
                        const patterns = [
                            /"actor"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/,
                            /"author"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/,
                            /"actor_name"\s*:\s*"([^"]+)"/,
                            /"profile_name"\s*:\s*"([^"]+)"/,
                            /"__typename"\s*:\s*"User"[^}]*"name"\s*:\s*"([^"]+)"/,
                        ];
                        for (const pattern of patterns) {
                            const match = content.match(pattern);
                            if (match && match[1]) {
                                const name = decodeText(match[1].trim());
                                if (name.length > 2 && name.length < 50 &&
                                    !name.includes('Facebook') && !name.includes('See more')) {
                                    metadata.senderName = name;
                                    console.log('Found sender name in JSON:', name);
                                    break;
                                }
                            }
                        }
                    }

                    // Extract group name from JSON (most reliable)
                    if (!metadata.groupName && content.includes('group')) {
                        const patterns = [
                            /"group"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/,
                            /"group_name"\s*:\s*"([^"]+)"/,
                            /"target"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"[^}]*"__typename"\s*:\s*"Group"/,
                            /"__typename"\s*:\s*"Group"[^}]*"name"\s*:\s*"([^"]+)"/,
                        ];
                        for (const pattern of patterns) {
                            const match = content.match(pattern);
                            if (match && match[1]) {
                                const groupName = decodeText(match[1].trim());
                                if (groupName.length > 3 && groupName.length < 100 &&
                                    !groupName.includes('Facebook') && !groupName.includes('Join')) {
                                    metadata.groupName = groupName;
                                    console.log('Found group name in JSON:', groupName);
                                    break;
                                }
                            }
                        }
                    }

                    // Extract likes/reactions
                    if (!metadata.likes && content.includes('reaction_count')) {
                        const match = content.match(/"reaction_count"\s*:\s*\{\s*"count"\s*:\s*(\d+)/);
                        if (match) {
                            metadata.likes = parseInt(match[1]);
                            console.log('Found likes in JSON:', metadata.likes);
                        }
                    }

                    // Extract comments
                    if (!metadata.comments && content.includes('total_count')) {
                        const match = content.match(/"comments"\s*:\s*\{\s*"total_count"\s*:\s*(\d+)/);
                        if (match) {
                            metadata.comments = parseInt(match[1]);
                            console.log('Found comments in JSON:', metadata.comments);
                        }
                    }

                    // Share extraction removed as requested
                } catch (e) {
                    console.error('Error parsing script:', e.message);
                }
            }
        } catch (e) {
            console.error('Error in JSON extraction:', e.message);
        }


        // ===== STEP 2: GROUP NAME EXTRACTION (VISUAL/DOM FALLBACKS) =====
        try {
            if (!metadata.groupName) {
                const post = document.querySelector('[role="dialog"][aria-modal="true"]') ||
                    document.querySelector('[role="article"]') ||
                    document.querySelector('article');

                if (post) {
                    const header = post.querySelector('header, [role="banner"]');
                    if (header) {
                        const headerText = header.textContent || '';
                        const patterns = [
                            /([^>]+)\s*>\s*([^\u2022\n]+)/,
                            /shared\s+(?:a\s+)?(?:post|link|photo)\s+to\s+([^\u2022\n]+)/i,
                            /shared\s+in\s+([^\u2022\n]+)/i,
                            /בקבוצה\s+([^\u2022\n]+)/,
                            /לעמוד\s+([^\u2022\n]+)/,
                        ];

                        for (const pattern of patterns) {
                            const match = headerText.match(pattern);
                            if (match && match[match.length - 1]) {
                                const candidate = match[match.length - 1].trim();
                                if (candidate.length > 3 && candidate.length < 100 &&
                                    !candidate.includes('Facebook') && !candidate.includes('See more') &&
                                    !candidate.includes('הצטרף') && !candidate.includes('Join')) {
                                    metadata.groupName = candidate;
                                    console.log('Found group name in header pattern:', candidate);
                                    break;
                                }
                            }
                        }
                    }
                }

                if (!metadata.groupName) {
                    const groupLinks = Array.from(document.querySelectorAll('a[href*="/groups/"]'));
                    for (const link of groupLinks) {
                        const text = link.textContent.trim();
                        const href = link.getAttribute('href') || '';
                        if (text && text.length > 3 && text.length < 100 &&
                            !text.includes('Join') && !text.includes('הצטרף') &&
                            !text.includes('Facebook') && !text.includes('Groups') &&
                            href.includes('/groups/')) {
                            metadata.groupName = text;
                            console.log('Found group name from link:', text);
                            break;
                        }
                    }
                }

                if (!metadata.groupName) {
                    const banner = document.querySelector('[role="banner"]');
                    if (banner) {
                        const h1 = banner.querySelector('h1, h2');
                        if (h1) {
                            const text = h1.textContent.trim();
                            if (text && text.length > 3 && text.length < 100 &&
                                !text.includes('Facebook') && !text.includes('Home') &&
                                !text.includes('Profile') && !text.includes('Timeline')) {
                                metadata.groupName = text;
                                console.log('Found group name from banner:', text);
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.error('Error in group name extraction:', e.message);
        }


        // ===== STEP 3: SENDER NAME EXTRACTION (VISUAL/DOM FALLBACKS) =====
        try {
            console.log('=== Extracting Sender Name ===');

            if (!metadata.senderName) {
                const post = document.querySelector('[role="dialog"][aria-modal="true"]') ||
                    document.querySelector('[data-ad-preview="message"]') ||
                    document.querySelector('[role="article"]') ||
                    document.querySelector('article');

                if (post) {
                    const postHeader = post.querySelector('header, h2, h3, [role="banner"]');
                    if (postHeader) {
                        const authorLinks = Array.from(postHeader.querySelectorAll('a[href*="profile"], a[href*="/user/"], a[href*="people"], a[role="link"]'));
                        for (const link of authorLinks) {
                            const text = link.textContent.trim();
                            const href = link.getAttribute('href') || '';
                            if (text && text.length > 2 && text.length < 50 &&
                                !text.includes('See more') && !text.includes('ראה עוד') &&
                                !text.includes('Comment') && !text.includes('Like') &&
                                !text.includes('Share') && !text.match(/^\d+[hms]$/) &&
                                (href.includes('profile') || href.includes('/user/') || href.includes('people'))) {
                                metadata.senderName = text;
                                console.log('Found sender name from post header link:', text);
                                break;
                            }
                        }

                        if (!metadata.senderName) {
                            const strongElements = postHeader.querySelectorAll('strong, b, span[dir="auto"] > span, h2, h3');
                            for (const el of strongElements) {
                                const text = el.textContent.trim();
                                if (text && text.length > 2 && text.length < 50 &&
                                    !text.includes('See more') && !text.includes('ראה עוד') &&
                                    !text.match(/^\d+[hms]$/) &&
                                    text.split(/\s+/).length <= 4) {
                                    metadata.senderName = text;
                                    console.log('Found sender name from header strong:', text);
                                    break;
                                }
                            }
                        }
                    }

                    if (!metadata.senderName) {
                        const allLinks = Array.from(post.querySelectorAll('a[href*="profile"], a[href*="/user/"], a[href*="people"]'));
                        for (const link of allLinks) {
                            const text = link.textContent.trim();
                            if (text && text.length > 2 && text.length < 50 &&
                                !text.includes('See more') && !text.includes('ראה עוד') &&
                                !text.match(/^\d+[hms]$/)) {
                                metadata.senderName = text;
                                console.log('Found sender name from post link:', text);
                                break;
                            }
                        }
                    }
                }

                if (!metadata.senderName) {
                    const invalidNames = ['see more', 'ראה עוד', 'just now', 'לפני רגע',
                        'sponsored', 'ממומן', 'translate', 'comment', 'like', 'share',
                        'facebook', 'home', 'profile', 'timeline', 'groups', 'marketplace'];

                    const candidates = Array.from(document.querySelectorAll('a[href*="profile"], a[href*="/user/"], a[href*="people"]'))
                        .map(link => ({
                            text: link.textContent.trim(),
                            href: link.getAttribute('href') || ''
                        }))
                        .filter(({ text, href }) => {
                            if (!text || text.length < 3 || text.length > 50) return false;
                            const lower = text.toLowerCase();
                            return !invalidNames.some(invalid => lower.includes(invalid)) &&
                                (href.includes('profile') || href.includes('/user/') || href.includes('people'));
                        })
                        .map(({ text }) => text);

                    if (candidates.length > 0) {
                        metadata.senderName = candidates[0];
                        console.log('Found sender name from page-wide search:', candidates[0]);
                    }
                }
            }
        } catch (e) {
            console.error('Error in sender name extraction:', e.message);
        }

        // ===== STEP 4: POST DATE EXTRACTION =====
        try {
            const dateSelectors = ['abbr', 'time', '[data-utime]'];
            for (const sel of dateSelectors) {
                const el = document.querySelector(sel);
                if (el) {
                    const text = (el.innerText || el.textContent || el.getAttribute('title') || '').trim();
                    if (text) {
                        metadata.postDate = text;
                        break;
                    }
                }
            }
        } catch (e) {
            console.error('Error in post date extraction:', e.message);
        }

        // Helper: extract number from text with K/M support
        const parseNum = (str) => {
            if (!str) return 0;
            str = str.replace(/[,\s\u200f\u202c\u202a]/g, '');
            const match = str.match(/([0-9.]+)([KMkm])?/);
            if (!match) return 0;
            let num = parseFloat(match[1]);
            if (match[2]) {
                const mult = match[2].toUpperCase();
                if (mult === 'K') num *= 1000;
                if (mult === 'M') num *= 1000000;
            }
            return Math.floor(num);
        };

        // ===== STEP 5: STATS FROM VISIBLE TEXT (FALLBACK) =====
        try {
            if (!metadata.likes || !metadata.comments || !metadata.shares) {
                const modal = document.querySelector('[role="dialog"][aria-modal="true"]');
                const bodyText = (modal || document.body).innerText;
                const lines = bodyText.split('\n').map(l => l.trim()).filter(l => l);

                for (const line of lines) {
                    if (!metadata.likes) {
                        const patterns = [
                            /(\d+[\d,.kKmM]+)\s*(reactions?)/i,
                            /all\s*reactions?[:\s]+(\d+[\d,.kKmM]*)/i,
                        ];
                        for (const pattern of patterns) {
                            const match = line.match(pattern);
                            if (match) {
                                metadata.likes = parseNum(match[1]);
                                break;
                            }
                        }
                    }

                    if (!metadata.comments) {
                        const patterns = [
                            /(\d+[\d,.kKmM]+)\s*(comment)/i,
                        ];
                        for (const pattern of patterns) {
                            const match = line.match(pattern);
                            if (match) {
                                metadata.comments = parseNum(match[1]);
                                break;
                            }
                        }
                    }

                    // Shares extraction removed as requested
                }
            }
        } catch (e) {
            console.error('Error in stats extraction:', e.message);
        }

        return metadata;
    });

    // Parse date to standard format
    if (data.postDate) {
        data.postDate = parsePostDate(data.postDate);
    }

    return data;
}

// TikTok metadata extraction
export async function extractTikTokMetadata(page) {
    const data = await page.evaluate(() => {
        let metadata = { senderName: '', postDate: '', likes: 0, comments: 0, shares: 0 };

        // Author name extraction
        try {
            const authorSelectors = [
                '[data-e2e="browse-username"]',
                'h2[data-e2e="browse-username"]',
                'a[data-e2e="browse-username"]',
                'h2',
                'strong'
            ];

            for (const sel of authorSelectors) {
                const el = document.querySelector(sel);
                if (el) {
                    const text = el.textContent.trim();
                    if (text && text.length > 2 && text.length < 50 && !text.includes('@')) {
                        metadata.senderName = text.replace('@', '');
                        break;
                    }
                }
            }
        } catch (e) {
            console.error('Error in TikTok author extraction:', e.message);
        }

        // Stats extraction from JSON
        try {
            const scripts = document.querySelectorAll('script[type="application/json"]');
            for (const script of scripts) {
                try {
                    const content = script.textContent || '';

                    if (!metadata.likes && content.includes('diggCount')) {
                        const match = content.match(/"diggCount"\s*:\s*(\d+)/);
                        if (match) metadata.likes = parseInt(match[1]);
                    }

                    if (!metadata.comments && content.includes('commentCount')) {
                        const match = content.match(/"commentCount"\s*:\s*(\d+)/);
                        if (match) metadata.comments = parseInt(match[1]);
                    }

                    // Share count extraction removed
                } catch (e) {
                    console.error('Error parsing TikTok JSON script:', e.message);
                }
            }
        } catch (e) {
            console.error('Error in TikTok JSON extraction:', e.message);
        }

        // Date extraction
        try {
            const dateSelectors = ['time', '[data-e2e="browse-time"]'];
            for (const sel of dateSelectors) {
                const el = document.querySelector(sel);
                if (el) {
                    const text = el.textContent || el.getAttribute('datetime') || '';
                    if (text) {
                        metadata.postDate = text;
                        break;
                    }
                }
            }
        } catch (e) {
            console.error('Error in TikTok date extraction:', e.message);
        }

        return metadata;
    });

    if (data.postDate) {
        data.postDate = parsePostDate(data.postDate);
    }

    return data;
}
