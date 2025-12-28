# Web Scraper v1.0.0 - Installation Notes

## Latest Build Information
**Date**: December 28, 2025  
**Version**: 1.0.0  
**Git Commit**: f7b5da3  

## Major Changes in This Release

### ✨ Excel Export Format
- **Switched from CSV to native Excel (.xlsx) format**
- Full Unicode support for Hebrew and multilingual text
- Automatic headers in Excel sheet
- No more encoding issues when opening in Excel

### 📦 Dependencies Added
- `xlsx` - Native Excel file support

### 🗑️ Removed Features
- Removed "Shares" column from output (not relevant)
- Removed CSV-related code and utilities
- Cleaned up legacy CSV handling

### 🔧 Code Cleanup
- Removed unused `csvEscape()` function
- Updated file references to use `EXCEL_FILE` instead of `CSV_FILE`
- Removed hardcoded CSV header creation

### 📋 Updated Documentation
- README.md updated with Excel export information
- UI labels changed from "CSV" to "Excel"
- Output format specifications added

## Output Format

The Excel file now contains the following columns:
1. **Timestamp** - Date and time the record was created
2. **Sender_Name** - Name of the person who posted
3. **Post_Date** - Date of the original post
4. **URL** - Link to the original post
5. **Status** - Record status (OK/Pending/Error)
6. **Group_Name** - Name of the Facebook group
7. **Summary** - AI-generated summary (in Hebrew)
8. **Likes** - Number of likes
9. **Comments** - Number of comments
10. **Validation** - Validation details

## Installation Instructions

### Building from Source
```bash
# Install dependencies
npm install

# Build installer (creates .exe in dist/ folder)
npm run build

# Run in development mode
npm start
```

### System Requirements
- Windows 10 or higher
- Node.js 20.x (for development builds)
- 500 MB free disk space

## Git Information
- **Repository**: https://github.com/JustArandomGuyFromTheInternet/Web-Scraper
- **Branch**: main
- **Latest Commit**: f7b5da3 - "Switch from CSV to Excel export format with Hebrew support"

## Known Notes
- First build after code changes may take 2-3 minutes
- Installer size: ~95 MB
- The application includes Electron v33.2.0 and all dependencies

## Support
For issues and feedback, visit: https://github.com/JustArandomGuyFromTheInternet/Web-Scraper/issues
