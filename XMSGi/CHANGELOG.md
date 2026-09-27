# Changelog

## 2.2.0 - 2026-09-23

### Highlights

- Added the XMSGi logo to the authentication and registration screens.
- Added System Tray support with Open and Exit actions.
- Added the complete Telegram dialog list, including channel visibility fixes.
- Added migration for the new hidden-chat state.
- Added a small hover `x` control for removing individual chats.
- Improved attachment UX with stable composer layout, compact thumbnails, and image long-press preview.

### Packaging and quality

- Updated the Windows production package to the XMSGi portable release format.
- Included the required Telegram dialog and inline-keyboard runtime modules in packaging.
- Cleaned up related code and expanded regression coverage for the released changes.

## 2.1.7 - 2026-09-13

### Highlights

- Improved performance and scrolling responsiveness.
- Improved Login and Logout flows.
- Logout keeps the account on the device for quick **Welcome back** access.
- **Forget account** fully removes the saved account data from the device.
- Added small UI/UX refinements across the main workflows.

### Fixes and stability

- Improved encrypted local account storage and IPC validation.
- Improved error handling, reconnect behavior, and overall application stability.

### Experimental

- The Gemini AI Assistant remains an experimental prototype for evaluation and is not an official feature of this release.

### Compatibility

- No breaking changes are intended for existing users.
- Existing Telegram sessions and locally stored scheduled message data are preserved when using Logout.
- Forget account removes the saved account data from the device.
- The experimental Gemini prototype requires a user-provided Gemini API key in Settings.

### Known limitations

- The Windows build is currently distributed as a portable application.
- Telegram and Gemini availability depends on the corresponding external services.
- A local `.env` file may be used for development credentials, but it is excluded from Git and production packaging. Credentials stored there must never be committed or published.
