// scrape_config.mjs
// Browser environment, model, timeouts and prompt configuration

import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const username = os.userInfo().username;
const defaultUserDataDir = process.env.USER_DATA_DIR || 
  (process.platform === 'win32'
    ? path.join(process.cwd(), 'chrome-profile')
    : path.join(process.cwd(), 'chrome-profile'));

// Chrome executable - use env var or find it dynamically
export const CHROME_EXE = process.env.CHROME_EXE || findChrome();

function findChrome() {
  const possiblePaths = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.ProgramFiles || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe')
  ];
  
  for (const chromePath of possiblePaths) {
    try {
      if (chromePath && require('fs').existsSync(chromePath)) {
        return chromePath;
      }
    } catch (e) {
      // Skip
    }
  }
  
  return "chrome"; // Fallback to system PATH
}

export const USER_DATA_DIR = process.env.USER_DATA_DIR || defaultUserDataDir;
export const PROFILE_DIR = process.env.PROFILE_DIR || "Default";

export const NAV_TIMEOUT_MS = 300_000; // 5 minutes
export const EXTRACT_TIMEOUT_MS = 180_000; // 3 minutes
export const BETWEEN_PAGES_DELAY_MS = 1_000; // 1 second between pages (reduced for performance)

export const MAX_RETRIES = 3;
export const MODEL_NAME = "gemini-2.0-flash-001";

// Google Sheets configuration
// No hard-coded default spreadsheet or sheet name: require the UI or environment to provide them.
export const SPREADSHEET_ID = null;
export const SHEET_NAME = null;
export const SERVICE_ACCOUNT_KEY_PATH = "service_account_key.json";

// פרומפט בסיס לסיכום — מוסיף הקשר, והקריאה בפועל דורשת JSON קשיח
export const SUMMARY_PROMPT = ({ name, url, rawText }) =>
    `
נתח/י את הפוסט הבא וחזר/י JSON בפורמט הבא בדיוק:
{
  "group_name": "שם הקבוצה או העמוד בפייסבוק (אם נמצא, אחרת ריק)",
  "summary_text": "המלצה על [שם המוצר/מותג] - [תיאור קצר במשפט אחד של ההמלצה]"
}

למשל:
- "המלצה על KUPA - מכונה אלחוטית וניידת עם סוללה ל-10 שעות"
- "המלצה על FAB - סכיני גילוח נוחים ויעילים"
- "המלצה על OPI - קרם ידיים מצוין שמרכך את העור"

אם אין המלצה על מוצר, כתוב/כתבי סיכום קצר של משפט אחד.
הסיכום חייב להיות משפט אחד קצר בלבד המציין בקצרה את ההמלצה או הרמיזה להמלצה סביב המוצר.

פוסט מאת: ${name}
תוכן:
${(rawText || "").slice(0, 4000)}
`.trim();
