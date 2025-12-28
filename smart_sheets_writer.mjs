// smart_sheets_writer.mjs - Smart Google Sheets writer (מפושט)
import { google } from 'googleapis';
import fs from 'fs';

const CREDENTIALS_PATH = process.env.CREDENTIALS_PATH || 'credentials.json';

async function getAuthClient() {
  try {
    const { getAuthenticatedClient } = await import('./sheets_oauth.mjs');
    return await getAuthenticatedClient();
  } catch {
    if (!fs.existsSync(CREDENTIALS_PATH)) {
      throw new Error(`❌ לא נמצא credentials.json`);
    }
    const auth = new google.auth.GoogleAuth({
      keyFile: CREDENTIALS_PATH,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    return await auth.getClient();
  }
}

function parseDate(dateStr) {
  if (!dateStr) return null;
  const parts = dateStr.split(/[.\-\/]/);
  if (parts.length === 3) {
    const day = parseInt(parts[0]);
    const month = parseInt(parts[1]) - 1;
    let year = parseInt(parts[2]);
    if (year < 100) year = 2000 + year;
    return new Date(year, month, day);
  }
  return null;
}

function getColumnLetter(index) {
  let letter = '';
  while (index >= 0) {
    letter = String.fromCharCode(65 + (index % 26)) + letter;
    index = Math.floor(index / 26) - 1;
  }
  return letter;
}

async function ensureSheetStructure(sheets, spreadsheetId, sheetName) {
  const response = await sheets.spreadsheets.get({ spreadsheetId });
  const existingSheet = response.data.sheets.find(s => s.properties.title === sheetName);

  if (!existingSheet) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: { requests: [{ addSheet: { properties: { title: sheetName } } }] }
    });

    const headers = [
      'URL',
      'Name',
      'Group',
      'Date',
      'Summary',
      'Likes',
      'Comments',
      'AI Validation'
    ];

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${sheetName}'!A1:${getColumnLetter(headers.length - 1)}1`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [headers] }
    });

    console.log(`✅ נוצר גיליון "${sheetName}" עם כותרות מותאמות`);
  } else {
    // בדוק אם הלשונית ריקה
    const fullCheck = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!A1:Z1`
    });

    if (!fullCheck.data.values || fullCheck.data.values.length === 0) {
      const headers = [
        'URL',
        'Name',
        'Group',
        'Date',
        'Summary',
        'Likes',
        'Comments',
        'AI Validation'
      ];

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${sheetName}'!A1:${getColumnLetter(headers.length - 1)}1`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [headers] }
      });
      console.log(`📝 לשונית "${sheetName}" הייתה ריקה - הוספנו כותרות`);
    }
  }
}

// פונקציה פשוטה לכתיבה לגיליון (לתאימות לאחור)
export async function smartWriteToSheet({
  spreadsheetId,
  sheetName,
  url,
  senderName,
  groupName,
  postDate,
  summary,
  likes = 0,
  comments = 0,
  validation
}) {
  const sheets = google.sheets({ version: 'v4', auth: await getAuthClient() });

  // ודא שיש כותרות מתאימות
  await ensureSheetStructure(sheets, spreadsheetId, sheetName);

  const values = [[
    url,
    senderName,
    groupName,
    postDate,
    summary,
    likes,
    comments,
    validation
  ]];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${sheetName}'!A:A`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    resource: { values }
  });

  return { success: true, action: 'appended' };
}

export function extractSpreadsheetId(input) {
  if (!input) return null;
  if (input.endsWith('.gsheet')) {
    try {
      const content = fs.readFileSync(input, 'utf8');
      const match = content.match(/"doc_id"\s*:\s*"([^"]+)"/);
      if (match) return match[1];
    } catch { }
  }
  if (input.includes('/')) {
    const match = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (match) return match[1];
  }
  return input;
}