const fs = require('fs');
const content = fs.readFileSync('extractors.mjs', 'utf8');
const lines = content.split('\n');

// Find all lines with regex patterns
lines.forEach((line, idx) => {
    if (line.includes('/') && (line.includes('[^') || line.includes('\\s'))) {
        console.log(`Line ${idx + 1}: ${line.trim()}`);
    }
});

console.log('\n\nChecking for special characters:');
lines.forEach((line, idx) => {
    // Check for bullet character
    if (line.includes('•') || line.includes('\u2022')) {
        console.log(`Line ${idx + 1} has bullet: ${JSON.stringify(line)}`);
    }
});
