import { GoogleGenAI } from "@google/genai";
import fs from 'fs/promises';
import dotenv from 'dotenv';

// Load .env file, but don't override env vars already set
dotenv.config({ override: false });

// Get API key dynamically
function getClient() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error('[ERR] GEMINI_API_KEY not found!');
        return null;
    }
    console.log(`[OK] Using API key: ${apiKey.substring(0, 15)}...`);
    return new GoogleGenAI({ apiKey });
}

// Retry with exponential backoff for quota errors
async function callGeminiWithRetry(client, prompt, maxRetries = 3) {
    const delays = [16000, 32000, 64000];

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
                console.warn(`[WARN] Quota exceeded - waiting ${delays[attempt] / 1000}s...`);
                await new Promise(r => setTimeout(r, delays[attempt]));
                continue;
            }
            if (is429) {
                console.warn('[WARN] Gemini quota exhausted');
                return null;
            }
            throw error;
        }
    }
}

/**
 * Analyzes a social media post screenshot using Gemini Vision.
 */
export async function analyzePostImage(imagePath, puppeteerStats = null) {
    try {
        const client = getClient();
        if (!client) {
            throw new Error('[ERR] Gemini API not initialized. Set GEMINI_API_KEY.');
        }

        console.log(`👁️ Analyzing: ${imagePath}`);

        const imageBuffer = await fs.readFile(imagePath);
        const imageBase64 = imageBuffer.toString('base64');
        const currentTime = new Date().toLocaleString('en-US');

        // Build prompt
        const statsSection = puppeteerStats ? `
6. **Stats** - Extract likes/comments as NUMBERS.
7. **Validation** - Puppeteer found: Likes=${puppeteerStats.likes || 0}, Comments=${puppeteerStats.comments || 0}
   Return "OK" if match, or "L:X C:Y" with your numbers.` : `
6. **Stats** - Extract likes/comments as NUMBERS.`;

        const prompt = [{
            text: `Analyze this social media post screenshot. Extract:

1. **sender_name** - The person who posted (exact name)
2. **group_name** - The group/page name if visible, or null
3. **post_date** - Format: DD/MM/YY HH:MM (current: ${currentTime})
4. **content** - Full text content
5. **summary** - 1-2 sentences IN HEBREW
${statsSection}

**ENCODING RULES (CRITICAL):**
- Use actual UTF-8 Hebrew characters like: "חתולים ונהנים"
- DO NOT use Unicode escapes like: "\\u05d7\\u05ea\\u05d5\\u05dc\\u05d9\\u05dd"
- DO NOT escape special characters
- Return plain text in native encoding

Return ONLY valid JSON:
{
  "sender_name": "string",
  "group_name": "string or null",
  "post_date": "DD/MM/YY HH:MM",
  "content": "string",
  "summary": "string in Hebrew",
  "likes": number,
  "comments": number${puppeteerStats ? ',\n  "validation": "OK or L:X C:Y"' : ''}
}`
        }, {
            inlineData: { mimeType: 'image/jpeg', data: imageBase64 }
        }];

        const response = await callGeminiWithRetry(client, prompt);

        // Fallback if quota exhausted
        if (!response) {
            return {
                sender_name: puppeteerStats?.sender || 'Unknown',
                group_name: puppeteerStats?.groupName || '',
                post_date: puppeteerStats?.postDate || '',
                content: '[AI Skipped]',
                summary: '[ניתוח AI לא זמין]',
                likes: puppeteerStats?.likes || 0,
                comments: puppeteerStats?.comments || 0,
                validation: 'Quota Exhausted'
            };
        }

        let jsonStr = response.text.trim();

        // DEBUG
        console.log('=== RAW GEMINI ===');
        console.log(jsonStr.substring(0, 500));
        console.log('==================');

        // Pre-process to fix common Gemini issues
        jsonStr = jsonStr
            .replace(/^\uFEFF/, '')           // Remove BOM
            .replace(/\/\/.*/g, '')           // Remove comments
            .replace(/\r\n/g, '\n');          // Fix line endings

        // Remove markdown code blocks
        if (jsonStr.includes('```')) {
            jsonStr = jsonStr.replace(/```json/gi, '').replace(/```/g, '').trim();
        }

        let data;
        try {
            // First attempt: Direct parse
            data = JSON.parse(jsonStr);
            console.log('✅ JSON parsed successfully (direct)');

        } catch (parseError) {
            console.warn('⚠️ Direct parse failed, trying fixes...');

            try {
                // Second attempt: Fix double-escaped backslashes
                const fixedJson = jsonStr.replace(/\\\\u([0-9a-fA-F]{4})/g, '\\u$1');
                data = JSON.parse(fixedJson);
                console.log('✅ JSON parsed after fixing double-escapes');

            } catch (secondError) {
                // Last resort: Extract JSON with regex
                const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    try {
                        data = JSON.parse(jsonMatch[0]);
                        console.log('✅ JSON extracted via regex');
                    } catch (regexError) {
                        console.error('❌ All parse attempts failed');
                        throw new Error(`Invalid JSON: ${jsonStr.substring(0, 200)}`);
                    }
                } else {
                    throw new Error(`No JSON found: ${jsonStr.substring(0, 200)}`);
                }
            }
        }

        // ENHANCED: Decode Unicode in ALL string values
        const decodeAllUnicode = (obj) => {
            if (typeof obj === 'string') {
                let decoded = obj;

                // Handle \uXXXX sequences
                decoded = decoded.replace(/\\u([0-9a-fA-F]{4})/g, (match, hex) => {
                    return String.fromCharCode(parseInt(hex, 16));
                });

                // Handle \\uXXXX sequences
                decoded = decoded.replace(/\\\\u([0-9a-fA-F]{4})/g, (match, hex) => {
                    return String.fromCharCode(parseInt(hex, 16));
                });

                return decoded;
            }

            if (Array.isArray(obj)) {
                return obj.map(decodeAllUnicode);
            }

            if (obj && typeof obj === 'object') {
                const result = {};
                for (const [key, value] of Object.entries(obj)) {
                    result[key] = decodeAllUnicode(value);
                }
                return result;
            }

            return obj;
        };

        // Apply decoding
        data = decodeAllUnicode(data);

        // FINAL SAFETY: Force decode if still encoded
        const forceDecodeIfNeeded = (str) => {
            if (!str || typeof str !== 'string') return str;
            if (str.includes('\\u')) {
                try {
                    return eval(`"${str.replace(/"/g, '\\"')}"`);
                } catch {
                    return str;
                }
            }
            return str;
        };

        data.sender_name = forceDecodeIfNeeded(data.sender_name);
        data.group_name = forceDecodeIfNeeded(data.group_name);
        data.summary = forceDecodeIfNeeded(data.summary);
        data.content = forceDecodeIfNeeded(data.content);

        // DEBUG: Log decoded values
        console.log('=== DECODED VALUES ===');
        console.log('sender_name:', data.sender_name);
        console.log('group_name:', data.group_name);
        console.log('summary:', data.summary?.substring(0, 50));
        console.log('======================');

        console.log('✅ AI Analysis complete');
        return data;

    } catch (error) {
        console.error('❌ AI Vision Error:', error);
        throw error;
    }
}
