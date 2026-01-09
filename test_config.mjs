#!/usr/bin/env node
// Quick test to see what CHROME_EXE is

const config = await import('./src/scrape_config.mjs');
console.log('CHROME_EXE:', config.CHROME_EXE);
console.log('USER_DATA_DIR:', config.USER_DATA_DIR);
console.log('PROFILE_DIR:', config.PROFILE_DIR);
