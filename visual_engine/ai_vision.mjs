import { GoogleGenAI } from "@google/genai";
import fs from 'fs/promises';
import dotenv from 'dotenv';

// Load .env file, but don't override env vars already set
dotenv.config({ override: false });

// Get API key dynamically
function getClient() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return null;
    }
    return new GoogleGenAI({ apiKey });
}

// Retry with exponential backoff for quota errors
async function callGeminiWithRetry(client, prompt, maxRetries = 3) {
    const delays = [16000, 32000, 64000];

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const response = await client.models.generateContent({
                model: 'models/gemini-2.0-flash-001',
                contents: prompt
            });
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

        const imageBuffer = await fs.readFile(imagePath);
        const imageBase64 = imageBuffer.toString('base64');
        const currentTime = new Date().toLocaleString('en-US');

        const validationContext = puppeteerStats ? `
            9. **Validation Checklist**:
               - Puppeteer detected: Likes=${puppeteerStats.likes}, Comments=${puppeteerStats.comments}.
               - Compare with your numbers.
               - If match/close: "OK".
               - If mismatch: "AI(L:${'${this.likes}'}, C:${'${this.comments}'}) OR (L:${puppeteerStats.likes}, C:${puppeteerStats.comments})".
               - Wait, I cannot use template literal here for self-reference.
               - Instruction: Set "validation" to string "AI(L:X, C:Y) OR (L:${puppeteerStats.likes}, C:${puppeteerStats.comments})" where X,Y are your found numbers.` : '';

        const prompt = [{
            text: `Analyze this social media post screenshot with HIGH precision.
            
            1. **sender_name**: The person who posted.
            2. **group_name**: LOOK AT THE TOP HEADER accurately.
               - Format is often "Sender Name > Group Name".
               - Extract strictly the GROUP NAME.
            3. **post_date**: Format as DD/MM/YY HH:MM (Context: current time is ${currentTime}).
            4. **likes**: LOOK CAREFULLY at the bottom left.
               - Find the small numbers near the Like icon.
               - "X and Y others" -> sum them.
               - If clearly visible "1", return 1.
            5. **comments**: Number of comments.
               - CRITICAL: "Comment as..." input box = 0 comments.
               - Only count if you see "X comments" text or actual comment bubbles.
               - If no comment count text is visible, return 0.
            6. **shares**: Number of shares.
            7. **content**: Extract the full visible text content. MAX 500 characters. If longer, truncate with "..." at end.
            8. **summary**: 1-2 sentences in HEBREW.
            ${validationContext}

            **ENCODING RULES**:
            - Return RAW UTF-8 Hebrew.
            - Ensure all JSON fields are properly closed with quotes.

            Return ONLY valid JSON (no markdown, no code blocks):
            {
              "sender_name": "string",
              "group_name": "string",
              "post_date": "string",
              "likes": number,
              "comments": number,
              "shares": number,
              "content": "string (max 500 chars)",
              "summary": "string"${puppeteerStats ? ',\n              "validation": "string"' : ''}
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
            try {
                // Second attempt: Fix double-escaped backslashes
                const fixedJson = jsonStr.replace(/\\\\u([0-9a-fA-F]{4})/g, '\\u$1');
                data = JSON.parse(fixedJson);

            } catch (secondError) {
                // Third attempt: If incomplete, try to fix truncated JSON
                try {
                    let repairedJson = jsonStr;

                    // Count opening and closing braces
                    const openBraces = (repairedJson.match(/\{/g) || []).length;
                    const closeBraces = (repairedJson.match(/\}/g) || []).length;

                    // If missing closing braces, add them
                    if (openBraces > closeBraces) {
                        repairedJson += '}'.repeat(openBraces - closeBraces);
                    }

                    // If truncated string at the end (missing closing quote), close it
                    if (repairedJson.match(/,\s*"[^"]*:\s*"[^"]*$/) || repairedJson.match(/:\s*"[^"]*$/)) {
                        repairedJson = repairedJson.replace(/("(?:\\.|[^"\\])*)(}?)$/, '$1"$2');
                    }

                    data = JSON.parse(repairedJson);

                } catch (repairError) {
                    // Last resort: Extract JSON with non-greedy regex
                    const jsonMatch = jsonStr.match(/\{(?:[^{}]|(?:\{[^{}]*\}))*\}/);
                    if (!jsonMatch) {
                        throw new Error(`No JSON found: ${jsonStr.substring(0, 200)}`);
                    }

                    try {
                        data = JSON.parse(jsonMatch[0]);
                    } catch (regexError) {
                        throw new Error(`Invalid JSON: ${jsonStr.substring(0, 200)}`);
                    }
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

        return data;

    } catch (error) {
        console.error('❌ AI Vision Error:', error.message);

        // Fallback: Return Puppeteer data if AI completely fails
        if (puppeteerStats) {
            console.log('[WARN] Returning Puppeteer data as fallback...');
            return {
                sender_name: puppeteerStats.sender || 'Unknown',
                group_name: puppeteerStats.groupName || '',
                post_date: puppeteerStats.postDate || '',
                likes: puppeteerStats.likes || 0,
                comments: puppeteerStats.comments || 0,
                shares: puppeteerStats.shares || 0,
                content: '[AI Analysis Failed]',
                summary: '[ניתוח AI נכשל]',
                validation: 'AI Failed - Using Puppeteer Data'
            };
        }

        throw error;
    }
}
