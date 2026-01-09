# Architecture Overview - AI Visual Web Scraper

This document provides a high-level architectural overview of the application for AI analysis.

## 1. System Overview
**Type**: Desktop Electron Application
**Purpose**: Automated social media scraping (Facebook, Instagram, TikTok) using a "Visual-First" approach (AI Vision) combined with traditional DOM scraping.
**Core Philosophy**: The system combines Puppeteer's high-fidelity automation with Google Gemini's multimodal AI to robustly extract content, even when DOM structures change. It uses a **Unified Browser Profile** to share state between manual sessions and automated scraping.

## 2. Technology Stack
*   **Runtime/App Shell**: [Electron](https://www.electronjs.org/) (Node.js + Chromium).
*   **Browser Automation**: [Puppeteer](https://pptr.dev/) (headless Chrome control).
*   **AI / Vision**: [Google Gemini 2.0 Flash](https://ai.google.dev/) (via `@google/genai`).
*   **Image Processing**: `sharp` / `jimp` (Optimization before AI analysis).
*   **Data Storage**: Google Sheets API (Remote), JSONL (Local), CSV.
*   **Build System**: `electron-builder`.

## 3. Data Flow Pipeline
The core logic resides in `src/scrape_controller.mjs`.

1.  **Input**: Reads targets from `links.json` (User-provided URLs).
2.  **Navigation**: `browser_manager.mjs` launches Puppeteer and navigates to the target URL.
3.  **Hybrid Extraction**:
    *   **Path A (DOM)**: `extractors.mjs` attempts to read metadata (Likes, Comments, Shares, Dates) using CSS selectors. This serves as a *baseline*.
    *   **Path B (Visual)**:
        1.  `screenshot.mjs` captures a viewport screenshot of the post.
        2.  `image_optimizer.mjs` compresses/resizes the image.
        3.  `ai_vision.mjs` sends the image + DOM metadata to **Google Gemini**.
        4.  **Gemini** extracts text, sender, date, and visual stats, and validates them against the DOM baseline.
4.  **Normalization**: Dates are standardized; fallback logic decides whether to trust AI or DOM based on confidence/validation.
5.  **Output**: Data is pushed to:
    *   Google Sheets (`smart_sheets_writer.mjs`).
    *   `test_output.jsonl` (Audit log).

## 4. Key Component Structure

### A. Main Process (Entry Point)
*   **`main.js`**: Electron main thread. Handles window creation, IPC events, and app lifecycle.
*   **`renderer.js`**: Frontend logic (UI). Triggers scraping via IPC.

### B. The Scraper Core (`src/`)
*   **`scrape_controller.mjs`**: The central orchestrator. Loops through links, manages error handling, and coordinates sub-modules.
*   **`browser_manager.mjs`**: Encapsulates Puppeteer logic (launch options, page stealth settings, navigation retries).
*   **`extractors.mjs`**: Contains site-specific logic (Facebook/TikTok selectors) to scroll to content and extract raw DOM data.

### C. The Visual Engine (`visual_engine/`)
*   **`ai_vision.mjs`**: The AI Brain.
    *   Manages API keys and Quota handling (Exponential backoff).
    *   Constructs prompts for Gemini.
    *   **Crucial**: Includes robust JSON repair logic (fixing broken JSON responses from AI, decoding Unicode).
*   **`screenshot.mjs` & `image_optimizer.mjs`**: Responsible for creating "AI-ready" images (handling high-DPI, cropping, file size limits).

### D. Data Services
*   **`data_service.mjs`**: Abstraction layer for file I/O (CSV/JSONL operations).
*   **`sheets_oauth.mjs`**: Handles Google OAuth flows and token management.

## 5. Directory Structure Map
```text
Root
├── main.js                  # Electron Main Process
├── src/
│   ├── scrape_controller.mjs # Core Logic Loop
│   ├── browser_manager.mjs   # Puppeteer Wrapper
│   └── extractors.mjs        # DOM Selectors logic
├── visual_engine/
│   ├── ai_vision.mjs        # Gemini AI Integration
│   └── screenshot.mjs       # Image Capture
└── electron-builder.yml     # Build Config
```

## 6. Important Workflows
- **Unified Profile Management**: Both visual and manual browsers share `userData/chrome-profile`.
- **Production Logging**: Filtered, professional output with professional emojis (✅, ⚠️, ❌).
- **Error Recovery**: `FileCleanupQueue` manages temporary assets; `navigateWithRetry` ensures stability.
