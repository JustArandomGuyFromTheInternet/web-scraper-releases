// src/logger.mjs
import fs from 'fs/promises';
import path from 'path';

// Simple logger to match existing format
export function log(msg, level = 'info', meta = {}) {
  const timestamp = new Date().toLocaleTimeString('he-IL');
  let icon = 'ℹ️';
  
  if (level === 'success') icon = '✅';
  else if (level === 'warning') icon = '⚠️';
  else if (level === 'error') icon = '❌';
  else if (level === 'debug') icon = '🐛';

  const indent = meta.indent ? '   ' : '';
  const stepInfo = meta.step ? `[${meta.step}/${meta.total}] ` : '';
  
  console.log(`${indent}${stepInfo}${icon} ${msg}`);
}
