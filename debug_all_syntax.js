const fs = require('fs');
const path = require('path');

const rootDir = process.cwd();
const ignoreDirs = ['node_modules', '.git', 'dist', 'out_new', 'chrome-profile', 'chrome-data', 'visual_engine'];

function getAllFiles(dirPath, arrayOfFiles) {
    const files = fs.readdirSync(dirPath);

    arrayOfFiles = arrayOfFiles || [];

    files.forEach(function (file) {
        if (fs.statSync(dirPath + "/" + file).isDirectory()) {
            if (!ignoreDirs.includes(file)) {
                arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles);
            }
        } else {
            if (file.endsWith('.js') || file.endsWith('.mjs')) {
                arrayOfFiles.push(path.join(dirPath, "/", file));
            }
        }
    });

    return arrayOfFiles;
}

function extractEvaluateBlocks(content) {
    const blocks = [];
    let index = 0;

    while ((index = content.indexOf('page.evaluate(', index)) !== -1) {
        let startIndex = index + 'page.evaluate('.length;
        let braceCount = 0;
        let inString = false;
        let stringChar = '';
        let endIndex = -1;

        // Simple parser to find the matching closing parenthesis of page.evaluate
        for (let i = startIndex; i < content.length; i++) {
            const char = content[i];

            if (inString) {
                if (char === stringChar && content[i - 1] !== '\\') {
                    inString = false;
                }
                continue;
            }

            if (char === '"' || char === "'" || char === '`') {
                inString = true;
                stringChar = char;
                continue;
            }

            if (char === '(') braceCount++;
            if (char === ')') {
                if (braceCount === 0) {
                    endIndex = i;
                    break;
                }
                braceCount--;
            }
        }

        if (endIndex !== -1) {
            blocks.push({
                start: index,
                end: endIndex,
                code: content.substring(startIndex, endIndex)
            });
        }

        index = startIndex;
    }

    return blocks;
}

function checkSyntax(code, filePath, lineNum) {
    try {
        // We wrap it in parentheses to ensure it's treated as an expression (like a function)
        // This catches "missing ) after argument list" type errors in the function definition itself
        new Function(`return (${code})`);
    } catch (e) {
        console.log(`❌ Syntax Error in ${path.basename(filePath)} (approx line ${lineNum}):`);
        console.log(`   ${e.message}`);
        return false;
    }
    return true;
}

function checkNonAscii(code, filePath, lineNum) {
    const nonAscii = /[^\x00-\x7F]+/g;
    let match;
    let found = false;

    while ((match = nonAscii.exec(code)) !== null) {
        // Ignore common safe characters if needed, but for now report all
        // We specifically look for the bullet point which caused issues before
        console.log(`⚠️ Non-ASCII char found in ${path.basename(filePath)} (approx line ${lineNum}):`);
        console.log(`   Char: ${JSON.stringify(match[0])} at index ${match.index}`);
        console.log(`   Context: ${code.substring(Math.max(0, match.index - 20), Math.min(code.length, match.index + 20))}`);
        found = true;
    }
    return found;
}

console.log('🔍 Starting comprehensive syntax check...\n');

const files = getAllFiles(rootDir);
let errorCount = 0;

files.forEach(file => {
    // Skip this script itself
    if (file.endsWith('debug_all_syntax.js') || file.endsWith('debug_syntax.js') || file.endsWith('check_regex.js') || file.endsWith('test_regex.js')) return;

    const content = fs.readFileSync(file, 'utf8');
    const blocks = extractEvaluateBlocks(content);

    if (blocks.length > 0) {
        // console.log(`Checking ${path.basename(file)} (${blocks.length} evaluate blocks)...`);

        blocks.forEach(block => {
            // Calculate line number
            const linesBefore = content.substring(0, block.start).split('\n').length;

            // Check for syntax errors
            if (!checkSyntax(block.code, file, linesBefore)) {
                errorCount++;
            }

            // Check for non-ASCII characters
            if (checkNonAscii(block.code, file, linesBefore)) {
                // Just a warning, not necessarily an error, but good to know
                console.log(`   (Non-ASCII characters might cause serialization issues in Puppeteer)`);
            }
        });
    }
});

if (errorCount === 0) {
    console.log('\n✅ No syntax errors found in page.evaluate blocks!');
} else {
    console.log(`\n❌ Found ${errorCount} syntax errors.`);
}
