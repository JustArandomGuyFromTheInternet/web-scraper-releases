# Build Instructions - Web Scraper

## Quick Build

To build the installer for Windows:

```bash
# 1. Ensure all dependencies are installed
npm install

# 2. Run the build command
npm run build

# 3. Installer will be created in the dist/ folder
# Output: Web Scraper Setup 1.0.0.exe
```

## Build Process Details

The build process:
1. Installs native dependencies via electron-rebuild
2. Packages the Electron app with all source code
3. Creates a Windows installer (.exe) 
4. Generates update metadata (latest.yml)

**Expected build time**: 2-3 minutes  
**Installer size**: ~95 MB

## Build Output

After a successful build, you'll find:
- `dist/Web Scraper Setup 1.0.0.exe` - Main installer
- `dist/Web Scraper Setup 1.0.0.exe.blockmap` - Update info
- `dist/latest.yml` - Update manifest
- `dist/win-unpacked/` - Unpacked application files

## Distribution

The installer can be:
- Distributed directly to users
- Uploaded to GitHub Releases
- Hosted on a web server
- Used with the built-in auto-update feature

## Code Changes Summary

Latest commit includes:
- Switched from CSV to Excel (.xlsx) format
- Added `xlsx` package dependency
- Removed CSV-related code
- Updated UI and documentation
- All syntax validated with `node --check`

## Pre-Build Checklist

Before building:
- ✅ All code changes committed to Git
- ✅ node_modules installed (`npm install`)
- ✅ No syntax errors (`node --check src/*.mjs`)
- ✅ package.json updated with new dependencies
- ✅ README.md and documentation updated

## Troubleshooting

If build fails:
1. Clear node_modules: `rmdir /s /q node_modules` then `npm install`
2. Clear dist folder: `rmdir /s /q dist`
3. Try building again: `npm run build`

If the app-builder process hangs:
- This is a known issue with large projects
- Wait 3-5 minutes before canceling
- Try building on a machine with more available RAM
