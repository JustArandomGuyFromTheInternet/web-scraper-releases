import { GoogleGenAI } from "@google/genai";
import fs from 'fs/promises';
import dotenv from 'dotenv';

// Load .env file, but don't override env vars already set (override: false)
// This way, env vars from settings (via main.js) take priority
dotenv.config({ override: false });

// Get API key dynamically (so settings changes take effect)
function getClient() {
    const apiKey = process.env.GEMINI_API_KEY;
    
    if (!apiKey) {
        console.error('[ERR] GEMINI_API_KEY not found in environment variables!');
        console.error('[INFO] Please set it in Settings or .env file');
        return null;
    }
    
    const keyPreview = apiKey.substring(0, 15);
    console.log(`[OK] Using API key: ${keyPreview}...`);
    
    return new GoogleGenAI({ apiKey });
}

/**
 * Call Gemini API with automatic retry on quota exceeded (429 errors)
 * Uses exponential backoff: 16s, 32s, 64s between retries
 * Returns null on final failure to enable fallback to Puppeteer stats
 */
async function callGeminiWithRetry(client, prompt, maxRetries = 3) {
    const delays = [16000, 32000, 64000]; // 16s, 32s, 64s
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            console.log(`[Gemini] Attempt ${attempt + 1}/${maxRetries}`);
            const response = await client.models.generateContent({
                model: 'models/gemini-2.0-flash-001',
                contents: prompt
            });
            console.log('[OK] Gemini call succeeded');
            return response;
            
        } catch (error) {
            const is429 = error.status === 429 || error.message?.includes('429') || error.message?.includes('quota');
            
            if (is429 && attempt < maxRetries - 1) {
                const delayMs = delays[attempt];
                console.warn(`[WARN] Quota exceeded - waiting ${delayMs/1000}s before retry...`);
                await new Promise(resolve => setTimeout(resolve, delayMs));
                continue; // Try again
            }
            
            // Quota exceeded after all retries - return null to trigger fallback
            if (is429) {
                console.warn(`[WARN] Gemini quota exhausted after ${maxRetries} retries. Using Puppeteer stats only.`);
                return null;  // Signal to use fallback
            }
            
            // Non-quota error - throw it
            throw error;
        }
    }
}

/**
 * Analyzes a social media post screenshot using Gemini Vision.
 * @param {string} imagePath - Path to the image file.
 * @param {Object} puppeteerStats - Stats extracted by Puppeteer {likes, comments, shares}
 * @returns {Promise<Object>} - Extracted data including validation results.
 */
export async function analyzePostImage(imagePath, puppeteerStats = null) {
    try {
        const client = getClient();
        if (!client) {
            throw new Error('[ERR] Gemini API client not initialized. Please set GEMINI_API_KEY in Settings.');
        }

        console.log(`👁️ Analyzing image with AI: ${imagePath}`);
        if (puppeteerStats) {
            console.log(`📊 Puppeteer stats to validate: ${JSON.stringify(puppeteerStats)}`);
        }

        // Read image file
        const imageBuffer = await fs.readFile(imagePath);
        const imageBase64 = imageBuffer.toString('base64');

        // Build validation instructions if stats provided
        let validationInstructions = '';
        if (puppeteerStats) {
            validationInstructions = `

6. Validation (IMPORTANT):
   Puppeteer extracted these stats from the page:
   - Likes: ${puppeteerStats.likes || 0}
   - Comments: ${puppeteerStats.comments || 0}
   
   For EACH stat, validate what you SEE in the screenshot:
   - If the number MATCHES what you see → "✓"
   - If the number is DIFFERENT from what you see → "✗"
   - If you DON'T see this stat in the screenshot at all → "⚠️"
   
   Return validation as a string like: "Likes: ✓, Comments: ⚠️"
`;
        }

        // Prepare the prompt with image 
        const currentTime = new Date().toLocaleString('en-US');
        const prompt = [
            {
                text: `
Analyze this screenshot of a social media post (Facebook/Instagram/TikTok).
Extract the following information with HIGH PRECISION:

1. **Sender Name** (EXACT as shown):
   - Extract EXACTLY as shown in the screenshot
   - If in Hebrew, keep Hebrew (e.g., "משה כהן")
   - If in English, keep English (e.g., "Moshe Cohen")
   - DO NOT translate or transliterate
   - This is the PERSON who posted, not a group name
   - If you see "User > Group", the SENDER is "User" (before ">")

2. **Group/Page Name** (EXACT as shown):
   - **CRITICAL**: This is the name of the GROUP or FACEBOOK PAGE/BUSINESS where the post appears
   - Extract EXACTLY as shown
   - If in Hebrew, keep Hebrew (e.g., "קבוצת מכירות", "ARDEL")
   - If in English, keep English (e.g., "Sales Group")
   - DO NOT translate
   - Common patterns:
     * "Sender Name > Group Name" (Post shared to group) → Group Name is after ">"
     * "Sender Name shared in Group Name" → Group Name is after "in"
     * "Sender Name shared to Group" → Group Name is after "to"
     * **NEW RULE**: If the name appears *immediately below* the small text that indicates the sender (e.g., "ARDEL" below the share line) → This is the Page/Group name
   - If NO group/page context is visible, return **null**

3. **Post Date & Time** (CRITICAL FORMAT):
   - Extract date AND time if visible
   - **PRIORITIZE** explicit dates (e.g., "November 3 at 5:47 AM") and convert them to DD/MM/YY HH:MM format
   - Return in format: DD/MM/YY HH:MM
   - Examples: "25/11/24 14:30", "20/10/24 09:15"
   - If only date visible: "25/11/24 00:00"
   - If relative time ("2h ago", "5m", "2 hours ago"):
     * Current time is: ${currentTime}
     * Convert to actual DD/MM/YY HH:MM based on current time
   - If you see "Yesterday" or similar: calculate yesterday's date

4. **Content** (The full text content of the post):
   - Extract ALL visible text from the post
   - Include any text overlays on images/videos
   - Preserve line breaks if visible

5. **Summary** (MUST be in HEBREW):
   - MUST be in HEBREW (עברית) - this is critical!
   - 1-2 sentences maximum
   - Capture the essence: what is the post about?
   - If it mentions brands/products, highlight them
   - If it's a video, describe what happens based on visual context${validationInstructions}

**EXAMPLE of SUCCESSFUL Extraction (to guide the model):**
  * **If the top text is:** "Free listing all day 24/7 > Sender Name · November 3 at 5:47 AM · 🌍"
  * **The JSON should be:** { "sender_name": "Sender Name", "group_name": "Free listing all day 24/7", "post_date": "03/11/25 05:47" }
  
  * **If the top text is:** "Sender Name shared a post to X Group..."
  * **The JSON should be:** { "sender_name": "Sender Name", "group_name": "X Group" }

CRITICAL RULES:
- **Sender vs Group**: Sender is the PERSON who posted. Group is WHERE it was posted.
- **Group/Page Name Detection**: Look for small gray text at the very top, often with ">" or "shared to/in", OR the **bold/large text of the page/brand name** *just below* the share line (e.g., "ARDEL")
- **Precision**: Extract EXACT names as shown, don't add or remove words
- **Null vs Empty**: If group name is NOT visible, return null (not "" or "null" as string)

- **Hebrew Names**: Keep names in their original language - Hebrew stays Hebrew, English stays English${puppeteerStats ? `
- Validation is REQUIRED - compare what you see vs Puppeteer stats` : ''}

Return the result ONLY as a valid JSON object with these exact keys:
{
  "sender_name": "string (exact name as shown)",
  "group_name": "string or null (only if group/page context is visible, otherwise null)",
  "post_date": "string (DD/MM/YY HH:MM format REQUIRED)",
  "content": "string (full text)",
  "summary": "string in Hebrew"${puppeteerStats ? `,

  "validation": "string with emojis (e.g., Likes: ✓, Comments: ⚠️)"` : ''}
}
`
            },
            {
                inlineData: {
                    mimeType: 'image/jpeg',
                    data: imageBase64
                }
            }
        ];

        // Call Gemini WITH RETRY LOGIC for quota exceeded errors
        const response = await callGeminiWithRetry(client, prompt);

        // Fallback: If quota exhausted, use Puppeteer stats only
        if (!response) {
            console.warn('[FALLBACK] Using Puppeteer stats only (Gemini quota exhausted)');
            return {
                sender_name: puppeteerStats?.sender || 'Unknown',
                group_name: puppeteerStats?.groupName || '',
                post_date: puppeteerStats?.postDate || 'Unknown',
                content: '[AI Analysis Skipped - Quota Exhausted]',
                summary: '[קוטה של Gemini נגמרה - נתונים מ-Puppeteer בלבד]',
                validation: puppeteerStats ? `Likes: ${puppeteerStats.likes || 0}, Comments: ${puppeteerStats.comments || 0}, Shares: ${puppeteerStats.shares || 0}` : ''
            };
        }

        const text = response.text;

        // Clean up code blocks if present
        let jsonStr = text.trim();

        // Remove markdown code blocks
        if (jsonStr.includes('```')) {
            jsonStr = jsonStr.replace(/```json/gi, '').replace(/```/g, '').trim();
        }

        let data;
        try {
            data = JSON.parse(jsonStr);
        } catch (parseError) {
            console.error('❌ Failed to parse AI response as JSON:', parseError);
            console.error('Raw response:', jsonStr.substring(0, 200) + '...');
            throw new Error('AI returned invalid JSON. Please try again or check API key.');
        }

        console.log('✅ AI Analysis complete');
        return data;

    } catch (error) {
        console.error('❌ AI Vision Error:', error);
        throw error;
    }
}
