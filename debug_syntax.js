const fs = require('fs');

// Read the file
const content = fs.readFileSync('extractors.mjs', 'utf8');

// Extract the function body passed to evaluate
const startMarker = 'extractFacebookMetadata(page) {';
const evaluateMarker = 'page.evaluate(() => {';

const startIndex = content.indexOf(startMarker);
const evaluateIndex = content.indexOf(evaluateMarker, startIndex);

if (evaluateIndex === -1) {
    console.log('Could not find page.evaluate call');
    process.exit(1);
}

const codeStart = evaluateIndex + evaluateMarker.length;
const codeEnd = content.lastIndexOf('});');
const codeToTest = content.substring(codeStart, codeEnd);

console.log('Testing code block serialization...');

// Check for the problematic bullet character in the serialized code
if (codeToTest.includes('•')) {
    console.log('❌ FAIL: The code still contains the bullet character (•)!');
    console.log('This will cause a syntax error in the browser.');

    // Show context
    const lines = codeToTest.split('\n');
    lines.forEach((line, i) => {
        if (line.includes('•')) {
            console.log(`Line ${i + 1}: ${line.trim()}`);
        }
    });
} else {
    console.log('✅ PASS: No bullet characters found in the code block.');
}

// Check if we have the correct escape sequence
if (codeToTest.includes('\\u2022')) {
    console.log('✅ PASS: Found correct escape sequence (\\\\u2022).');
} else {
    console.log('⚠️ WARNING: Did not find \\\\u2022 escape sequence.');
}

console.log('\nSimulating browser evaluation...');
try {
    // This simulates what the browser does
    const fn = new Function(codeToTest);
    console.log('✅ Syntax check passed! The code is valid JavaScript.');
} catch (e) {
    console.log('❌ Syntax check FAILED:', e.message);
    console.log('--- CODE START ---');
    const lines = codeToTest.split('\n');
    lines.forEach((line, i) => {
        console.log(`${i + 1}: ${line}`);
    });
    console.log('--- CODE END ---');
}
