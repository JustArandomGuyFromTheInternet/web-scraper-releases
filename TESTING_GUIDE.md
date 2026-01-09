# Testing Guide - Scraper Profile Fix

## Summary of Changes

**Problem**: `spawn node ENOENT` error when running scraper in Electron app, or "Failed to launch browser process" when Chrome was locked.

**Solution**: Separated browser profiles:
- **UI Browser**: Uses isolated local profile (`app-data/chrome-profile`)
- **Scraper**: Uses system Chrome profile with user's login session

## Test Procedure

### Prerequisites
- Node.js installed globally (must be in PATH)
- Chrome installed
- User logged into Facebook/Instagram in system Chrome

### Test Case 1: Basic Flow

1. **Start the app**
   ```
   npm run dev
   ```

2. **Add test links**
   - Paste Facebook/Instagram URLs into the input field
   - Click somewhere to parse links

3. **Click "Open Browser"**
   - Should spawn a Chrome window with the app's local profile
   - This profile is isolated from your system Chrome

4. **Close the Chrome window**
   - This step is CRITICAL
   - The scraper cannot launch if Chrome is running

5. **Click "Start Scraping"**
   - Should show a dialog warning to close Chrome
   - If Chrome was closed, scraper should launch
   - Watch the activity log for "Launching browser..." message

### Expected Results

✅ **Success**: 
- Scraper launches Puppeteer successfully
- Gets screenshots with logged-in posts visible
- No "Failed to launch browser" errors
- Process completes with valid output

❌ **Failure**:
- Error: "Failed to launch browser process! undefined"
- Or: "🔴 CHROME IS STILL RUNNING! 🔴"
- **Solution**: Make sure ALL Chrome windows are closed

### Test Case 2: Chrome Profile Isolation

To verify profiles are isolated:

1. Open app and click "Open Browser" 
2. The UI Chrome opens with `--user-data-dir=C:\Users\<user>\AppData\Roaming\<app-data-folder>\chrome-profile`
3. This is separate from system Chrome at `C:\Users\<user>\AppData\Local\Google\Chrome\User Data`
4. Verify: Logging in the UI Chrome doesn't require entering credentials again (it's isolated)

### Test Case 3: Multiple Runs

1. Run scraping once successfully
2. Close all Chrome windows
3. Run scraping again
4. Should work both times (no permission issues)

## Key Files Modified

1. **renderer.js** (lines 114-128): Added warning dialog
2. **main.js** (lines 210-310): Confirmed spawn('node', ...) setup  
3. **open-browser handler** (lines 425-450): UI uses local profile
4. **scrape_config.mjs** (line 18): Scraper uses system Chrome
5. **README.md**: Added usage documentation

## Environment Variables Passed to Scraper

The scraper receives these critical env vars:
- `CHROME_EXE`: Path to Chrome executable
- `USER_DATA_DIR`: System Chrome profile path (set by scrape_config.mjs)
- `LINKS_FILE`: Path to links.json
- `SCREENSHOTS_DIR`: Where to save screenshots
- `ELECTRON_COOKIES_FILE`: Exported cookies (for future use)
- `VISUAL_MODE`: Set to 'true' for screenshot capture
- `ELECTRON_USER_DATA_DIR`: App's user data folder

## Known Limitations

1. **Chrome must be closed before scraping**: Windows file locks prevent concurrent access
2. **Requires Node.js globally installed**: Same as previous versions (user must have Node.js in PATH).
3. **No concurrent UI/Scraper execution**: User must complete scraping before opening UI Chrome again

## Architecture Diagram

```
┌─────────────────────────────────────────────┐
│        Electron Main Process (main.js)      │
└──────────┬──────────────────────────────────┘
           │
           ├─────────────────────────────────────────┐
           │                                         │
           │ Spawn separate Node.js process         │
           │ (src/scrape_controller.mjs)            │
           │                                         │
           ▼                                         ▼
    ┌────────────┐                          ┌──────────────────┐
    │   UI IPC   │                          │  Node Process    │
    │            │                          │  (src/scrape_*)  │
    │ Open-      │                          │                  │
    │ Browser:   │                          │ Uses system      │
    │ Opens      │                          │ Chrome profile   │
    │ Chrome     │                          │ for login        │
    │ with local │                          │ session          │
    │ profile    │                          │                  │
    └────────────┘                          └──────────────────┘
         │                                         │
         │                                         │
         ▼                                         ▼
    ┌────────────────────┐            ┌──────────────────────────┐
    │ app-data/chrome-   │            │ C:\Users\<user>\AppData  │
    │ profile            │            │ \Local\Google\Chrome\    │
    │ (Isolated, no      │            │ User Data                │
    │  conflicts)        │            │ (User's login session)   │
    └────────────────────┘            └──────────────────────────┘
```

## Future Improvements

1. **Cookie Sync Implementation**: Could activate `syncCookiesFromElectron()` to allow concurrent execution
2. **Chrome Process Monitoring**: Could auto-detect Chrome is running and advise user
3. **Electron IPC Refactor**: Could avoid spawning Node entirely using async/await in main process
