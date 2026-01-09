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

## Optional: Bundle Node.js with the Installer

By default, the app uses system Node.js. To include Node.js in the installer:

### Step 1: Download Node.js Portable Version

1. Go to https://nodejs.org/
2. Download the **Windows Binary (.zip)** for your architecture (x64 recommended)
3. Extract to a folder named `bundled-node` in the project root

```
bundled-node/
├── node.exe
├── npm
├── node.lib
└── ...other Node.js files
```

### Step 2: Uncomment the Build Configuration

Edit `electron-builder.yml` and uncomment the bundled-node lines:

```yaml
extraResources:
  - from: bundled-node/node.exe
    to: node/node.exe
```

### Step 3: Build

```bash
npm run build
```

The installer will now include Node.js, so users don't need to install it separately!

**Note**: Including Node.js increases installer size from ~95 MB to ~180 MB.

## Build Process Details

The build process:
1. Installs native dependencies via electron-rebuild
2. Packages the Electron app with all source code
3. Creates a Windows installer (.exe) 
4. Generates update metadata (latest.yml)

**Expected build time**: 2-3 minutes  
**Installer size**: ~95 MB (or ~180 MB with bundled Node.js)

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
- **NEW**: Auto-close Chrome before scraping
- **NEW**: Support for bundled Node.js
````
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
