const fs = require('fs');
const path = require('path');

// 1. Simulate Gemini Response (with double escapes as seen in logs)
const mockGeminiResponse = `
{
  "group_name": "נשים מדברות על הכל", 
  "escaped_group": "\\u05e0\\u05e9\\u05d9\\u05dd \\u05de\\u05d3\\u05d1\\u05e8\\u05d5\\u05ea"
}
`;

console.log('--- 1. Raw Gemini Response ---');
console.log(mockGeminiResponse);

// 2. Parse Logic (Simulating ai_vision.mjs)
let data;
try {
    data = JSON.parse(mockGeminiResponse);
} catch (e) {
    console.error('Parse error:', e);
}

console.log('\n--- 2. After JSON.parse ---');
console.log('group_name:', data.group_name);
console.log('escaped_group:', data.escaped_group); // This will unlikely trigger double decode automatically

// 3. Apply our fix logic
const decodeUnicodeEscapes = (str) => {
    if (typeof str !== 'string') return str;
    try {
        if (str.includes('\\u')) {
            return JSON.parse(`"${str}"`);
        }
    } catch (e) {
        return str.replace(/\\u([0-9a-fA-F]{4})/g, (match, hex) => {
            return String.fromCharCode(parseInt(hex, 16));
        });
    }
    return str;
};

const decoded = decodeUnicodeEscapes(data.escaped_group);
console.log('\n--- 3. After Decode Fix ---');
console.log('Decoded:', decoded);
console.log('Is correct?', decoded === 'נשים מדברות');

// 4. Test File Writing (Simulating data_service.mjs)
const jsonlPath = path.join(__dirname, 'test_output.jsonl');
const rec = { test: decoded, original: "שלום" };

// Bad write (default JSON.stringify sometimes escapes non-ASCII)
console.log('\n--- 4. File Writing Test ---');
const jsonStr = JSON.stringify(rec);
console.log('JSON.stringify output:', jsonStr);

// Should be written as UTF-8
fs.writeFileSync(jsonlPath, JSON.stringify(rec) + '\n', { encoding: 'utf8' });
console.log(`\nWrote to ${jsonlPath}. Checking content...`);

const writtenContent = fs.readFileSync(jsonlPath, 'utf8');
console.log('File Content:', writtenContent);
