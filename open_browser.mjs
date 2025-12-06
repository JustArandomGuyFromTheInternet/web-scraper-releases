// open_browser.mjs - פותח דפדפן לחיבור חשבונות
import puppeteer from "puppeteer";
import fs from "fs/promises";

export async function openBrowser() {
  console.log('🌐 פותח דפדפן לחיבור חשבונות...');

  try {
    const { CHROME_EXE, USER_DATA_DIR, PROFILE_DIR } = await import('./src/scrape_config.mjs');

    // Build launch options with fallbacks
    const launchOptions = {
      headless: false,
      defaultViewport: { width: 1920, height: 1080 },
      args: [
        '--disable-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--window-size=1920,1080',
        '--lang=he-IL'
      ]
    };

    // Try to use custom Chrome if available
    if (CHROME_EXE && CHROME_EXE.trim() !== '') {
      try {
        await fs.access(CHROME_EXE);
        launchOptions.executablePath = CHROME_EXE;
        console.log(`Using Chrome at: ${CHROME_EXE}`);
      } catch (error) {
        console.log(`Chrome not found at ${CHROME_EXE}, using Puppeteer default`);
      }
    }

    // Try to use userDataDir if available
    if (USER_DATA_DIR && USER_DATA_DIR.trim() !== '') {
      try {
        await fs.mkdir(USER_DATA_DIR, { recursive: true });
        launchOptions.userDataDir = USER_DATA_DIR;
        launchOptions.args.push(`--user-data-dir=${USER_DATA_DIR}`);
        if (PROFILE_DIR && PROFILE_DIR.trim() !== '') {
          launchOptions.args.push(`--profile-directory=${PROFILE_DIR}`);
        }
      } catch (error) {
        console.log(`Failed to setup user data dir: ${error.message}`);
      }
    }

    const browser = await puppeteer.launch(launchOptions);

    console.log('✅ הדפדפן נפתח בהצלחה');
    console.log('💡 כעת תוכל להתחבר לחשבונות שלך');
    console.log('⚠️  סגור את החלון הזה רק לאחר שסיימת להתחבר');

    try {
      const page = await browser.newPage();
      await page.goto('https://www.facebook.com', { waitUntil: 'networkidle2', timeout: 60000 });
      console.log('✅ Facebook opened. Please log in if needed.');

      // Also open Instagram in a new tab
      const instagramPage = await browser.newPage();
      await instagramPage.goto('https://www.instagram.com', { waitUntil: 'networkidle2', timeout: 60000 });
      console.log('✅ Instagram opened. Please log in if needed.');

      console.log('Browser will remain open for manual login/interaction.');
      console.log('Close the browser window when done.');

      // Keep the process running - wait for browser to close
      browser.on('disconnected', () => {
        console.log('Browser closed by user');
        process.exit(0);
      });

      // Wait indefinitely until browser is closed
      await new Promise(() => { });
    } catch (error) {
      console.error('Error during browser interaction:', error);
      await browser.close();
      throw error;
    }
  } catch (error) {
    console.error('Failed to open browser:', error);
    throw new Error(`Failed to open browser: ${error.message}`);
  }
}

// Only run if called directly (not when imported)
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('open_browser.mjs')) {
  openBrowser().catch(console.error);
}
