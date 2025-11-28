// src/data_service.mjs
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { log } from './logger.mjs';

// Get current directory for this module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Lazy load sheets writer
let smartWriteToSheet;
let sheetsLoaded = false;

async function loadSheetsWriter() {
    if (sheetsLoaded) return;

    // Build path to smart_sheets_writer.mjs in root directory
    // __dirname is src/, so we go up one level to root
    const rootDir = path.dirname(__dirname);
    const sheetsWriterPath = path.resolve(rootDir, 'smart_sheets_writer.mjs');

    try {
        // Try relative import first (simpler and usually works)
        const module = await import('../smart_sheets_writer.mjs');
        smartWriteToSheet = module.smartWriteToSheet;
        log('Loaded smart_sheets_writer successfully', 'success');
    } catch (error) {
        // If relative import fails, try absolute path using file:// URL
        try {
            // Convert Windows path to file:// URL format
            // Handle Windows drive letters (C: -> /c:)
            let fileUrl = sheetsWriterPath.replace(/\\/g, '/');
            if (fileUrl.match(/^[A-Z]:/)) {
                fileUrl = '/' + fileUrl.toLowerCase();
            }
            const sheetsWriterUrl = new URL(`file://${fileUrl}`).href;

            const module = await import(sheetsWriterUrl);
            smartWriteToSheet = module.smartWriteToSheet;
            log('Loaded smart_sheets_writer using absolute path', 'success');
        } catch (fallbackError) {
            log(`Cannot find smart_sheets_writer.mjs at: ${sheetsWriterPath}`, 'error');
            log(`Relative import error: ${error.message}`, 'error');
            log(`Absolute path error: ${fallbackError.message}`, 'error');
            throw new Error(`Cannot find smart_sheets_writer.mjs. Expected location: ${sheetsWriterPath}. Make sure the file exists in the root directory.`);
        }
    }

    sheetsLoaded = true;
}

// Configuration
const OUT_DIR = path.join(process.cwd(), 'out_new');
const JSONL_FILE = path.join(OUT_DIR, 'summaries.jsonl');
const CSV_FILE = path.join(OUT_DIR, 'summaries.csv');

export async function ensureOutFiles() {
    try {
        await fs.mkdir(OUT_DIR, { recursive: true });

        // Delete old files to start fresh
        try {
            await fs.unlink(JSONL_FILE);
            log('Deleted old summaries.jsonl', 'info');
        } catch {
            // File doesn't exist, that's fine
        }

        try {
            await fs.unlink(CSV_FILE);
            log('Deleted old summaries.csv', 'info');
        } catch {
            // File doesn't exist, that's fine
        }

        // Create fresh CSV with headers
        await fs.writeFile(CSV_FILE, '\uFEFFTimestamp,Name,Date,URL,Status,AI_Sender,AI_Date,AI_Group,AI_Summary,Validation\n');
        log('Created fresh output files', 'success');
    } catch (e) {
        log(`Error creating output files: ${e.message}`, 'error');
    }
}

export async function appendJsonl(rec) {
    try {
        await fs.appendFile(JSONL_FILE, JSON.stringify(rec) + '\n');
    } catch (e) {
        log(`Failed to append to JSONL: ${e.message}`, 'error');
    }
}

export async function appendSheetsRow({ url, sender_name, post_date, group_name, summary, likes, comments, shares, validation }) {
    // CSV Append
    try {
        const row = [
            new Date().toLocaleString('he-IL'),
            csvEscape(sender_name),
            csvEscape(post_date),
            csvEscape(url),
            'OK',
            csvEscape(sender_name),
            csvEscape(post_date),
            csvEscape(group_name),
            csvEscape(summary),
            csvEscape(validation)
        ].join(',') + '\n';
        await fs.appendFile(CSV_FILE, row);
    } catch (e) {
        log(`Failed to append to CSV: ${e.message}`, 'error');
    }

    // Google Sheets Append
    const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
    const SHEET_NAME = process.env.SHEET_NAME || 'גיליון1';

    if (SPREADSHEET_ID && SPREADSHEET_ID.length > 20) {
        try {
            await loadSheetsWriter(); // Load sheets writer first
            await smartWriteToSheet({
                spreadsheetId: SPREADSHEET_ID,
                sheetName: SHEET_NAME,
                url,
                senderName: sender_name,
                postDate: post_date,
                groupName: group_name,
                summary,
                validation,
                likes: likes || 0,
                comments: comments || 0
            });
            log('Synced to Google Sheets', 'success');
        } catch (e) {
            log(`Google Sheets sync failed: ${e.message}`, 'error');
        }
    }
}

function csvEscape(s = "") {
    if (!s) return "";
    s = String(s).replace(/"/g, '""');
    if (s.includes(",") || s.includes("\n") || s.includes('"')) {
        return `"${s}"`;
    }
    return s;
}

export function formatDate(dateInput) {
    if (!dateInput) return '';

    const str = String(dateInput).trim();

    // Already in correct DD/MM/YY HH:MM format?
    if (str.match(/^\d{2}\/\d{2}\/\d{2}\s\d{2}:\d{2}$/)) {
        return str;
    }

    let dateObj;

    // If it's a Date object
    if (dateInput instanceof Date) {
        dateObj = dateInput;
    } else {
        // Try parsing DD.MM.YY or DD/MM/YY format
        const parts = str.split(/[./\-]/);
        if (parts.length >= 3) {
            const day = parseInt(parts[0]);
            const month = parseInt(parts[1]) - 1;
            let year = parseInt(parts[2]);

            // Handle 2-digit year
            if (year < 100) {
                year = year < 50 ? 2000 + year : 1900 + year;
            }

            dateObj = new Date(year, month, day);

            // Extract time if present (format like "DD.MM.YY HH:MM")
            const timeMatch = str.match(/\s+(\d{1,2}):(\d{2})/);
            if (timeMatch) {
                dateObj.setHours(parseInt(timeMatch[1]));
                dateObj.setMinutes(parseInt(timeMatch[2]));
            }
        } else {
            // Try standard parsing
            dateObj = new Date(str);
        }

        // If still invalid, return original
        if (isNaN(dateObj.getTime())) {
            return str;
        }
    }

    // Format as DD/MM/YY HH:MM
    const day = String(dateObj.getDate()).padStart(2, '0');
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const year = String(dateObj.getFullYear()).slice(-2);
    const hours = String(dateObj.getHours()).padStart(2, '0');
    const minutes = String(dateObj.getMinutes()).padStart(2, '0');

    return `${day}/${month}/${year} ${hours}:${minutes}`;
}
