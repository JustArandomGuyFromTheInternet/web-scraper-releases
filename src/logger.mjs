// src/logger.mjs
import fs from 'fs/promises';
import path from 'path';

// Simple logger to match existing format
export function log(msg, level = 'info', meta = {}) {
  // 🤐 Filter out debug logs in production unless explicitly enabled
  if (level === 'debug' && process.env.DEBUG !== 'true') return;

  const timestamp = new Date().toLocaleTimeString('en-US');
  let icon = '[INFO]';

  if (level === 'success') icon = '✅';
  else if (level === 'warning') icon = '⚠️';
  else if (level === 'error') icon = '❌';
  else if (level === 'debug') icon = '🔍';

  const indent = meta.indent ? '   ' : '';
  const stepInfo = meta.step ? `[${meta.step}/${meta.total}] ` : '';

  // Use professional emojis and cleaner formatting
  console.log(`${indent}${stepInfo}${icon} ${msg}`);
}
