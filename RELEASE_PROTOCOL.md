# 🚀 Release Protocol

This file is intended to remind you (and AI in future conversations) how to properly release a version update so that automatic updates work.

## 1. Code Preparation
- Ensure all changes work in Development (`npm start`).
- Ensure there are no errors in the terminal.

## 2. Version Bump
- Open the `package.json` file.
- Find the line `"version": "X.X.X"`.
- Increment the number (for example from `1.0.0` to `1.0.1`).
- Save the file.

## 3. Build
- Run in terminal:
  ```powershell
  npm run build
  ```
- Wait for completion (2-5 minutes).
- Ensure the `dist` folder was created with new files.

## 4. Update Git
- Run the following commands:
  ```powershell
  git add .
  git commit -m "Version 1.0.1"  # Change to the new version number
  git push
  ```

## 5. GitHub Release (Critical Step for Auto-Update!)
1. Open your Repository on GitHub.
2. Click on **Releases** (on the right side) -> **Draft a new release**.
3. **Choose a tag**: Create a new tag with the version number (for example `v1.0.1`).
4. **Release title**: Write a title (for example "Version 1.0.1 - Bug Fixes").
5. **Description**: Write what's new in this version.
6. **Assets (Very Important!):**
   Drag the following files from the `dist` folder on your computer into the upload area:
   - `Web Scraper Setup X.X.X.exe` (the installer file)
   - `latest.yml` (the file that tells the software there's an update)
7. Click on **Publish release**.

---

## 🤖 Instructions for AI in Future Conversations:
If the user requests to "release a version" or "make an update", you must:
1. Check the current version in `package.json`.
2. Suggest incrementing the version (Patch/Minor/Major).
3. Perform steps 2-4 (update file, build, git push).
4. Remind the user to perform step 5 manually on GitHub (since AI doesn't have access to GitHub UI).
