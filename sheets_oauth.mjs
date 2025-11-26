// sheets_oauth.mjs - Google Sheets with OAuth 2.0
import { google } from 'googleapis';
import fs from 'fs/promises';
import http from 'http';
import { URL } from 'url';
import open from 'open';

const TOKEN_PATH = 'token.json';
const CREDENTIALS_PATH = 'oauth_credentials.json';

// קריאת credentials
async function loadCredentials() {
  try {
    const content = await fs.readFile(CREDENTIALS_PATH, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error('❌ לא נמצא קובץ oauth_credentials.json');
    console.error('📚 עקוב אחרי המדריך ב-OAUTH_SETUP.md ליצירת הקובץ');
    throw new Error(`לא נמצא קובץ oauth_credentials.json. צור אותו ב-Google Cloud Console.`);
  }
}

// יצירת OAuth2 Client
async function createOAuth2Client() {
  const credentials = await loadCredentials();
  const { client_id, client_secret, redirect_uris } = credentials.installed || credentials.web;
  
  return new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );
}

// בדיקה אם יש token שמור
async function loadSavedToken(oAuth2Client) {
  try {
    const token = await fs.readFile(TOKEN_PATH, 'utf8');
    oAuth2Client.setCredentials(JSON.parse(token));
    return true;
  } catch {
    return false;
  }
}

// שמירת token
async function saveToken(token) {
  await fs.writeFile(TOKEN_PATH, JSON.stringify(token));
}

// התחברות דרך דפדפן
async function authenticateUser(oAuth2Client) {
  return new Promise((resolve, reject) => {
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    console.log('\n🔐 פותח דפדפן להתחברות...');
    console.log('אם הדפדפן לא נפתח, העתק את הקישור הזה:');
    console.log(authUrl);

    let server = null;
    let timeoutId = null;

    // שרת זמני לקבלת הקוד
    server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, 'http://localhost');
        const code = url.searchParams.get('code');

        if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
            <html dir="rtl">
              <body style="font-family: Arial; text-align: center; padding: 50px;">
                <h1>✅ התחברת בהצלחה!</h1>
                <p>אפשר לסגור את הדף הזה ולחזור לאפליקציה</p>
                <script>setTimeout(() => window.close(), 2000)</script>
              </body>
            </html>
          `);

          if (timeoutId) clearTimeout(timeoutId);
          server.close();

          // קבלת Token
          const { tokens } = await oAuth2Client.getToken(code);
          oAuth2Client.setCredentials(tokens);
          await saveToken(tokens);
          
          console.log('✅ התחברות הושלמה!');
          resolve(oAuth2Client);
        }
      } catch (error) {
        if (timeoutId) clearTimeout(timeoutId);
        server.close();
        reject(error);
      }
    });

    // Try port 3000, if busy try random port
    const tryListen = (port) => {
      server.listen(port, async (err) => {
        if (err) {
          if (err.code === 'EADDRINUSE' && port === 3000) {
            console.log('⚠️ Port 3000 busy, trying random port...');
            tryListen(0); // 0 = random available port
          } else {
            reject(err);
          }
        } else {
          await open(authUrl);
        }
      });
    };

    tryListen(3000);

    // timeout של 5 דקות
    timeoutId = setTimeout(() => {
      server.close();
      reject(new Error('Timeout - לא התחברת בזמן'));
    }, 5 * 60 * 1000);
  });
}

// קבלת Auth Client מוכן לשימוש
export async function getAuthenticatedClient() {
  const oAuth2Client = await createOAuth2Client();
  
  // נסה לטעון token קיים
  const hasToken = await loadSavedToken(oAuth2Client);
  
  if (!hasToken) {
    // אין token - צריך להתחבר
    await authenticateUser(oAuth2Client);
  }
  
  return oAuth2Client;
}

// חילוץ Spreadsheet ID
export function extractSpreadsheetId(url) {
  if (!url) return null;
  if (!url.includes('/')) return url;
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}

// קריאת נתונים
export async function readSheet(spreadsheetUrl, sheetName = 'גיליון1', range = 'A1:Z1000') {
  const auth = await getAuthenticatedClient();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = extractSpreadsheetId(spreadsheetUrl);

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetName}'!${range}`,
  });

  return response.data.values || [];
}

// כתיבת נתונים
export async function writeSheet(spreadsheetUrl, sheetName, range, values) {
  const auth = await getAuthenticatedClient();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = extractSpreadsheetId(spreadsheetUrl);

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${sheetName}'!${range}`,
    valueInputOption: 'USER_ENTERED',
    resource: { values },
  });

  return { success: true };
}

// הוספת שורה
export async function appendRow(spreadsheetUrl, sheetName, rowData) {
  const auth = await getAuthenticatedClient();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = extractSpreadsheetId(spreadsheetUrl);

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${sheetName}'!A:A`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    resource: {
      values: [rowData],
    },
  });

  return { success: true };
}

// בדיקת חיבור
export async function testConnection(spreadsheetUrl) {
  const auth = await getAuthenticatedClient();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = extractSpreadsheetId(spreadsheetUrl);

  const response = await sheets.spreadsheets.get({ spreadsheetId });

  return {
    success: true,
    title: response.data.properties.title,
    sheets: response.data.sheets.map(s => s.properties.title),
    spreadsheetId,
  };
}

// ניקוי התחברות (logout)
export async function logout() {
  try {
    await fs.unlink(TOKEN_PATH);
    console.log('✅ התנתקת בהצלחה');
    return { success: true };
  } catch {
    return { success: false, error: 'אין משתמש מחובר' };
  }
}

// בדיקה אם יש משתמש מחובר
export async function isAuthenticated() {
  try {
    await fs.access(TOKEN_PATH);
    return true;
  } catch {
    return false;
  }
}
