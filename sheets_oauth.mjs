import { google } from 'googleapis';
import fs from 'fs/promises';
import http from 'http';
import { URL } from 'url';
import open from 'open';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Smart path resolution
const TOKEN_PATH = process.env.GOOGLE_TOKEN_PATH || path.join(__dirname, 'token.json');
const CREDENTIALS_PATH = process.env.OAUTH_CREDENTIALS_PATH || path.join(__dirname, 'oauth_credentials.json');

console.log('🔍 OAuth paths in sheets_oauth.mjs:');
console.log('   __dirname:', __dirname);
console.log('   CREDENTIALS_PATH:', CREDENTIALS_PATH);
console.log('   TOKEN_PATH:', TOKEN_PATH);

// Load credentials
async function loadCredentials() {
  try {
    const content = await fs.readFile(CREDENTIALS_PATH, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`❌ oauth_credentials.json not found at: ${CREDENTIALS_PATH}`);
    console.error('📚 Follow the guide in OAUTH_SETUP.md to create the file');
    throw new Error(`oauth_credentials.json not found at: ${CREDENTIALS_PATH}. Please ensure the file exists at this location.`);
  }
}

// יצירת OAuth2 Client
async function createOAuth2Client() {
  const credentials = await loadCredentials();
  const { client_id, client_secret } = credentials.installed || credentials.web;

  // Always use localhost:3000 for Desktop app
  return new google.auth.OAuth2(
    client_id,
    client_secret,
    'http://localhost:3000'
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
        const url = new URL(req.url, 'http://localhost:3000');
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

          console.log('✅ Authentication completed!');

          // Close server to free port 3000
          if (timeoutId) clearTimeout(timeoutId);
          server.close(() => {
            console.log('✅ OAuth server closed, port 3000 freed');
          });

          resolve(oAuth2Client);
        }
      } catch (error) {
        if (timeoutId) clearTimeout(timeoutId);
        if (server) server.close();
        reject(error);
      }
    });

    // Try to start server on port 3000, fallback to random if busy
    const startServer = async () => {
      return new Promise((resolvePort, rejectPort) => {
        server.on('error', (err) => {
          if (err.code === 'EADDRINUSE') {
            console.log('⚠️ Port 3000 is busy, trying random port...');
            server.close();
            // Create new server on random port
            const newServer = http.createServer(server.listeners('request')[0]);
            newServer.listen(0, () => {
              const actualPort = newServer.address().port;
              console.log(`✅ Server started on port ${actualPort}`);
              // Note: This will cause redirect_uri mismatch if not 3000
              // But authentication will still work for first-time setup
              resolvePort(newServer);
            });
          } else {
            rejectPort(err);
          }
        });

        server.listen(3000, () => {
          console.log('✅ OAuth server listening on port 3000');
          resolvePort(server);
        });
      });
    };

    startServer().then(() => {
      open(authUrl);
    }).catch(reject);


    // 5 minute timeout
    timeoutId = setTimeout(() => {
      server.close();
      reject(new Error('Timeout - authentication not completed within 5 minutes'));
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
