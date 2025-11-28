# Web Scraper - README

## Overview
Web Scraper is a powerful desktop application for extracting and analyzing content from social media platforms including Facebook, Instagram, and TikTok.

## Features
- 🔍 **Multi-Platform Scraping**: Facebook, Instagram, TikTok support
- 🤖 **AI-Powered Analysis**: Uses Google Gemini AI for content extraction
- 📊 **Google Sheets Integration**: Direct export to spreadsheets
- 🔄 **Automatic Updates**: Stay up-to-date with the latest features
- 🖼️ **Visual Capture**: Screenshots with intelligent optimization
- 🔧 **Data Repair Tools**: Fix missing information automatically

## Installation

### For End Users
1. Download `WebScraperSetup.exe` from the [Releases](https://github.com/JustArandomGuyFromTheInternet/Web-Scraper/releases) page
2. Run the installer and follow the wizard
3. The application will install to `C:\Program Files\Web Scraper\`
4. A desktop shortcut will be created automatically

### For Developers
```bash
# Clone the repository
git clone https://github.com/JustArandomGuyFromTheInternet/Web-Scraper.git
cd Web-Scraper

# Install dependencies
npm install

# Run in development mode
npm start

# Build installer
npm run build
```

## Configuration

### Required API Keys
1. **Gemini API Key**: Get from [Google AI Studio](https://makersuite.google.com/app/apikey)
2. **Google Sheets OAuth**: Follow `OAUTH_SETUP.md` for configuration

### Setup Steps
1. Open the application
2. Click the ⚙️ Settings button
3. Enter your Gemini API Key
4. Connect to Google (for Sheets integration)
5. Configure your scraping preferences

## Usage

1. **Add Links**: Paste social media URLs (one per line)
2. **Choose Destination**: Select CSV file or Google Sheets
3. **Start Scraping**: Click "START SCRAPING" button
4. **Monitor Progress**: View real-time logs in the Activity Log

## Automatic Updates

The application automatically checks for updates on startup:
- ✅ Downloads updates in the background
- ✅ Notifies you when an update is ready
- ✅ Simple one-click installation

## Building from Source

### Prerequisites
- Node.js 20.x or higher
- Windows (for building Windows installer)

### Build Commands
```bash
# Development build
npm run dev

# Production build (creates installer in dist/)
npm run build

# Clean build artifacts
npm run clean
```

## Project Structure
```
Web-Scraper/
├── src/              # Core application logic
├── visual_engine/    # Screenshot and AI processing
├── main.js          # Electron main process
├── renderer.js      # UI logic
├── index.html       # Application UI
└── package.json     # Project configuration
```

## Troubleshooting

### Application won't start
- Ensure you have the latest version
- Try reinstalling the application

### Scraping fails
- Verify your API keys are correct
- Check your internet connection
- Make sure you're logged into Facebook/Instagram in the browser

### Updates not working
- Check GitHub releases page manually
- Ensure you have internet access

## License
MIT License - see LICENSE file for details

## Support
For issues and questions, please create an issue on [GitHub](https://github.com/JustArandomGuyFromTheInternet/Web-Scraper/issues).

## Version
Current version: 1.0.0
