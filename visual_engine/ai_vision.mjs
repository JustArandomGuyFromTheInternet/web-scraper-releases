import { GoogleGenAI } from "@google/genai";
import fs from 'fs/promises';
import dotenv from 'dotenv';

dotenv.config();

// Initialize Gemini Client  
const apiKey = process.env.GEMINI_API_KEY;
const client = new GoogleGenAI({ apiKey });

/**
 * Analyzes a social media post screenshot using Gemini Vision.
 * @param {string} imagePath - Path to the image file.
 * @param {Object} puppeteerStats - Stats extracted by Puppeteer {likes, comments, shares}
 * @returns {Promise<Object>} - Extracted data including validation results.
 */
export async function analyzePostImage(imagePath, puppeteerStats = null) {
    try {
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

6. Validation (IMPORTANT - אימות):
   Puppeteer extracted these stats from the page:
   - Likes: ${puppeteerStats.likes || 0}
   - Comments: ${puppeteerStats.comments || 0}
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
        const currentTime = new Date().toLocaleString('he-IL');
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
     * "Sender Name > Group Name" (שיתוף לקבוצה) → Group Name is after ">"
     * "Sender Name שיתף ב-שם קבוצה" → Group Name is after "ב-"
     * "Sender Name shared to Group" → Group Name is after "to"
     * **NEW RULE**: If the name appears *immediately below* the small text that indicates the sender (e.g., "ARDEL" below the share line) → This is the Page/Group name
   - If NO group/page context is visible, return **null**

3. **Post Date & Time** (CRITICAL FORMAT):
   - Extract date AND time if visible
   - **PRIORITIZE** explicit dates (e.g., "November 3 at 5:47 AM") and convert them to DD/MM/YY HH:MM format
   - Return in format: DD/MM/YY HH:MM
   - Examples: "25/11/24 14:30", "20/10/24 09:15"
   - If only date visible: "25/11/24 00:00"
   - If relative time ("2h ago", "5m", "לפני שעתיים"):
     * Current time is: ${currentTime}
     * Convert to actual DD/MM/YY HH:MM based on current time
   - If you see "Yesterday" or "אתמול": calculate yesterday's date

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
  * **If the top text is:** "פרסום חופשי כל הנתב 24/7 > Sender Name · November 3 at 5:47 AM · 🌍"
  * **The JSON should be:** { "sender_name": "Sender Name", "group_name": "פרסום חופשי כל הנתב 24/7", "post_date": "03/11/25 05:47" }
  
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

        // Call Gemini (using same model as regular scraping)
        const response = await client.models.generateContent({
            model: 'models/gemini-2.0-flash-001',
            contents: prompt
        });

        const text = response.text;

        // Clean up code blocks if present
        let jsonStr = text.trim();

        // Remove markdown code blocks
        if (jsonStr.includes('```')) {
            jsonStr = jsonStr.replace(/```json/gi, '').replace(/```/g, '').trim();
        }

        const data = JSON.parse(jsonStr);

        console.log('✅ AI Analysis complete');
        return data;

    } catch (error) {
        console.error('❌ AI Vision Error:', error);
        throw error;
    }
}
