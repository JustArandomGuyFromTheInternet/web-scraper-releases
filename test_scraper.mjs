#!/usr/bin/env node
// Direct scraper test - bypass Electron for debugging

import { main } from './src/scrape_controller.mjs';
import { log } from './src/logger.mjs';

console.log('\n========================================');
console.log('🧪 DIRECT SCRAPER TEST (No Electron)');
console.log('========================================\n');

try {
    log('Starting scraper test...', 'info');
    await main();
    log('Scraper test completed', 'info');
} catch (error) {
    log(`Test failed: ${error.message}`, 'error');
    console.error(error);
    process.exit(1);
}
