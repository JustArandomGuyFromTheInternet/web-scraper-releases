// src/logger.mjs
import fs from 'fs/promises';
import path from 'path';

// Simple logger to match existing format
export function log(msg, level = 'info', meta = {}) {
  const timestamp = new Date().toLocaleTimeString('en-US');
  let icon = '[INFO]';
  
  if (level === 'success') icon = '[OK]';
  else if (level === 'warning') icon = '[WARN]';
  else if (level === 'error') icon = '[ERR]';
  else if (level === 'debug') icon = '[DBG]';

  const indent = meta.indent ? '   ' : '';
  const stepInfo = meta.step ? `[${meta.step}/${meta.total}] ` : '';
  
  console.log(`${indent}${stepInfo}${icon} ${msg}`);
}
