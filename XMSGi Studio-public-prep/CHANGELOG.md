# Changelog

## Unreleased

## 1.3.0 - 2026-10-24

### Highlights

- Added Quick Planner for immediate sending, Telegram scheduling, and saved drafts, with transfer into Studio and reuse from shared Posts/History.
- Added selectable light and dark themes across the application.
- Added a Planner activity chart with weekly (7-day) and monthly (30-day) views of confirmed message sends.

### Improvements

- Refined scheduling, draft recovery, and storage reliability across Planner and Studio.
- Improved the Planner and Studio workflows, responsive layouts, and interface consistency.
- Kept the clean editor outline and glow as the default, with optional per-action custom colors in editor settings.

### Packaging and quality

- Added application description and author metadata for desktop packaging.
- Added standalone Studio module typecheck, test, and build gates to release CI.
- Updated website gallery screenshots and release download links.
- Removed local debug helpers and preview artifacts from version control.
- Added `.env.example` and extended `.gitignore` coverage for local artifacts and build outputs.

## 1.2.2 - 2026-10-18

### Fixes and stability

- Fixed Telegram message direction when rebuilding chat history after restart.
- Fixed Live Preview scrolling so loaded history reaches the true bottom.
- Fixed the composer placeholder and emoji layout, and removed stray markers from loaded message bubbles.

## 1.1.0 - 2026-10-07

Version `1.1.0` follows the legacy `2.1.7` line: the desktop product was renamed
to XMSGi Studio, so the version was reset for the new product name. History under
`2.1.7` below refers to the previous XMSGi releases.

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

### Known limitations

- The Windows build is currently distributed as a portable application.
- A local `.env` file may be used for development credentials, but it is excluded from Git and production packaging. Credentials stored there must never be committed or published.
