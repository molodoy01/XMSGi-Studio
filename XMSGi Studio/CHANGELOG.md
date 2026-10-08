# Changelog

## 1.1.0 - 2026-10-07

### Highlights

- Renamed the desktop product to XMSGi Studio while keeping the in-app header brand as XMSGi.
- Added rich-text composition with attachments, inline buttons, templates, and saved drafts.
- Expanded scheduling and history workflows for queued posts, cancellation, and rescheduling.
- Improved Telegram sign-in, reconnect, session storage, and account-data migration.
- Migrated active app-data filenames to the XMSGi Studio name while retaining legacy data migration.

### Packaging and quality

- Synchronized the Windows app, embedded Studio module, and Settings version to 1.1.0.
- Hardened IPC validation and portable Windows packaging.
- Expanded regression coverage across authentication, editing, history, and scheduling.

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

### Compatibility

- No breaking changes are intended for existing users.
- Existing Telegram sessions and locally stored scheduled message data are preserved when using Logout.
- Forget account removes the saved account data from the device.
- The experimental Gemini prototype requires a user-provided Gemini API key in Settings.

### Known limitations

- The Windows build is currently distributed as a portable application.
- A local `.env` file may be used for development credentials, but it is excluded from Git and production packaging. Credentials stored there must never be committed or published.
