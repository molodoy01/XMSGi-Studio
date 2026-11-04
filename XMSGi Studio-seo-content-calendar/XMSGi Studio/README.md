<div align="center">

# XMSGi Studio

### ✈️ Telegram messages, when you choose.

<p>
  <a href="https://github.com/molodoy01/XMSGi-Studio/releases"><img alt="Release" src="https://img.shields.io/github/v/release/molodoy01/XMSGi-Studio?style=flat-square"></a>
  <a href="https://github.com/molodoy01/XMSGi-Studio/actions/workflows/release-check.yml"><img alt="Build" src="https://github.com/molodoy01/XMSGi-Studio/actions/workflows/release-check.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square"></a>
  <a href="https://github.com/molodoy01/XMSGi-Studio/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/molodoy01/XMSGi-Studio?style=flat-square"></a>
</p>

<img src="website/screenshots/01.png" alt="XMSGi Studio workspace" width="880" />

A desktop workspace for **writing, scheduling, and reviewing Telegram messages** — straight from your own account, **no bot required**. Available for Windows, Linux, and macOS; the Windows build is portable.

<br>

<a href="https://github.com/molodoy01/XMSGi-Studio/releases/latest"><img alt="Download latest release" src="https://img.shields.io/badge/⬇%20Download-latest-6c7cff?style=for-the-badge"></a>
&nbsp;
<a href="https://molodoy01.github.io/XMSGi-Studio/"><img alt="Website" src="https://img.shields.io/badge/Website-molodoy01.github.io-101218?style=for-the-badge"></a>
&nbsp;
<a href="https://github.com/molodoy01/XMSGi-Studio"><img alt="GitHub" src="https://img.shields.io/badge/GitHub-Repository-181717?style=for-the-badge&logo=github"></a>

</div>

---

## ✨ Key Features

### 📱 Telegram Integration
- Pick chats, groups, and channels directly from your account — no bots needed.
- Send messages to any Telegram entity (private, group, channel) with full control over content and timing.

### ⏰ Scheduling & Repeats
- **One-time or future sends**: Schedule messages for any date/time.
- **Repeat options**: Daily, weekly (including selected weekdays), every two weeks, or monthly — up to 15 scheduled occurrences.
- **Reschedule/cancel**: Easily adjust or cancel messages in the queue.

### ⚡ Studio first, Quick Planner for speed
Studio is the main workspace for composing and organizing posts. Quick Planner handles fast sends, schedules, and drafts; Planner drafts can be continued in Studio and reviewed in Posts/History.

### 🌗 Themes & activity
- Choose a light or dark theme for the entire app in Settings.
- Track confirmed sends in the Quick Planner activity chart, with 7-day and 30-day views.

### 🖋️ Message Composition
- **Rich formatting**: Use bold, italic, links, and more.
- **Attachments**: Support for images, documents, and other media.

### 🗂️ Organization & History
- **Studio drafts**: Organize documents with color tags and revisit their edit history.
- **Posts/History**: Review schedules and delivery outcomes from both work surfaces.
- **Templates**: Save frequent phrases for quick access.

### 🔒 Security & Privacy
- **Local drafts and session**: Drafts and account session are stored on your device. Message content and attachments are sent to Telegram when you send or schedule them.
- **No bot dependency**: Avoid third-party intermediaries for message delivery.
- **Secure session handling**: Leverage platform-specific secure storage where available.

## 🎛️ Control

Full control over every post in the queue — right up to the moment it's sent.

<table>
  <tr>
    <td width="50%" valign="top">
      <b>✏️ Edit before sending</b><br>
      Change the text and media of an already scheduled post — it goes out in the new version.
    </td>
    <td width="50%" valign="top">
      <b>🗓️ Reschedule or cancel</b><br>
      Shift the date and time or cancel delivery in one click.
    </td>
  </tr>
  <tr>
    <td valign="top">
      <b>🔁 Repeats</b><br>
      Daily, weekly (including selected weekdays), every two weeks, or monthly — up to 15 scheduled occurrences.
    </td>
    <td valign="top">
      <b>📝 Templates</b><br>
      Frequent phrases in one click. Stored locally.
    </td>
  </tr>
  <tr>
    <td valign="top">
      <b>🎨 Colored drafts</b><br>
      Organize ideas by color. Bring them back to the editor any time.
    </td>
    <td valign="top">
      <b>🚦 FloodWait auto-retry</b><br>
      On a Telegram flood limit the send pauses and retries by itself.
    </td>
  </tr>
</table>

## 🖼️ Screenshots

<p align="center">
  <img src="../screenshots/02.png" alt="Posts history and saved messages" width="32%" />
  <img src="../screenshots/03.png" alt="Quick Planner composer and activity chart" width="32%" />
  <img src="../screenshots/05.png" alt="XMSGi Studio brand artwork" width="32%" />
</p>

## 📥 Download

**[Download the latest release and choose your platform](https://github.com/molodoy01/XMSGi-Studio/releases/latest).**

| Platform | Format | Download |
| --- | --- | --- |
| Windows | Portable `.exe` | [XMSGi Studio.exe](https://github.com/molodoy01/XMSGi-Studio/releases/download/v1.3.6/XMSGi.Studio.exe) — no installation required |
| Linux | AppImage (x64) | [XMSGi.Studio-1.3.6.AppImage](https://github.com/molodoy01/XMSGi-Studio/releases/download/v1.3.6/XMSGi.Studio-1.3.6.AppImage) |
| Linux | `.deb` (x64) | [xmsgi-studio_1.3.6_amd64.deb](https://github.com/molodoy01/XMSGi-Studio/releases/download/v1.3.6/xmsgi-studio_1.3.6_amd64.deb) |
| macOS | `.dmg` (Intel, unsigned) | [XMSGi.Studio-1.3.6.dmg](https://github.com/molodoy01/XMSGi-Studio/releases/download/v1.3.6/XMSGi.Studio-1.3.6.dmg) |
| macOS | `.dmg` (Apple Silicon, unsigned) | [XMSGi.Studio-1.3.6-arm64.dmg](https://github.com/molodoy01/XMSGi-Studio/releases/download/v1.3.6/XMSGi.Studio-1.3.6-arm64.dmg) |

The v1.3.6 download links will work after the release and its platform packages are published.

### First launch on macOS

macOS builds are unsigned and not notarized. Control-click XMSGi Studio in Finder,
choose **Open**, then confirm **Open**.
If macOS still blocks it, go to **System Settings → Privacy & Security → Open Anyway**.
Only bypass this warning for a copy downloaded from the official releases page.

## 🚀 Quick start

Requirements:

- Node.js 20+
- npm
- A supported desktop target: Windows, Linux (x64), or macOS (x64 / arm64)

Run locally:

```bash
npm install
npm run build
npm run electron
```

Build a Windows release package:

```bash
npm run dist
```

<details>
<summary>🏗️ <b>Studio architecture</b> · for developers</summary>

The Electron host owns the window, Telegram session and IPC bridge. Studio and Quick Planner are pages in the same React application. Studio is composed in `src/studio/App.tsx` and mounted through `src/workspace/StudioMount.tsx` with the host-owned scheduler runtime.

Studio's internal feature structure lives under `src/studio/`:

- `src/studio/App.tsx` composes the workspace and scheduler.
- `src/studio/pages/WorkspacePage.tsx` owns the workspace page.
- `src/studio/components/stages/` contains the chat, schedule, draft and template stages.
- `src/studio/services/` adapts publishing operations to the Telegram bridge.
- `packages/shared/` provides types, translations and utilities shared across the application.
- `telegram-errors.cjs` classifies Telegram errors; the account rate-limit interceptor waits and retries FloodWaits. IPC passes error category and retry metadata to Studio's operation-aware error handler.

Studio's locale context is provided by the host. Keep `StudioMount` under the host's `LocaleProvider`, and pass the existing connection, chats, account ID and scheduler runtime:

```tsx
<StudioMount
  connected={connected}
  activeAccountId={activeAccountId}
  chats={chats}
  scheduler={scheduler}
/>
```

The `@/`, `@studio/` and `@shared/` aliases are configured by the host Vite and TypeScript settings. Run `npm run typecheck`, `npm test` and `npm run build` from the application root to validate the complete app, including Studio.

### Scheduler ownership

When Studio is embedded, the Host `useScheduler` runtime is authoritative for scheduling history, cancellation, retry state and FloodWait pauses. Studio receives that runtime through the versioned React-props contract in `packages/shared/bridge/`; History/Archive callbacks are part of the same contract. There is no separate event stream.

If the scheduler prop is omitted in a preview or isolated component test, Studio uses `useStudioScheduler` as a fallback. The Electron application always passes the host runtime, which is authoritative for scheduling history, cancellation, retry state and FloodWait pauses.

</details>

## 📚 Documentation

Full documentation lives in the [`docs/`](docs/README.md) directory:

- [User guide](docs/ru/user-guide.md) — features, modes, installation, workflows (RU)
- [Architecture](docs/ru/architecture.md) — process layers, modules, data flows (RU)
- [Development](docs/ru/development.md) — setup, commands, tests, conventions (RU)
- [Security and privacy](docs/ru/security.md) — storage, encryption, trust boundaries (RU)
- [IPC reference](docs/ru/ipc-reference.md) — renderer ⇄ main channels (RU)

## 🧪 Automated tests

The v1.3.6 release-candidate run is verified with the project test suite before publication.

Validated with `npm test`, `npm run typecheck`, and `git diff --check`.

## 🔒 Security &amp; privacy

XMSGi Studio keeps Telegram data local to the device. Session and account data are stored in the user data directory, and secure storage is used where the platform supports it.

This app does not depend on a Telegram bot for its core scheduling flow.

## 🤝 Contributing

We welcome focused pull requests and bug reports. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting changes.

## 🛡️ Security reporting

Please report vulnerabilities privately through the repository security process. Do not disclose critical issues in public issues or pull requests. See [SECURITY.md](SECURITY.md).

## 📦 Repository

- Source code: https://github.com/molodoy01/XMSGi-Studio
- Website: https://molodoy01.github.io/XMSGi-Studio/

## 📄 License

This project is licensed under the MIT License. The canonical license text is in [LICENSE](LICENSE).

---
XMSGi Studio keeps Telegram scheduling simple, local, and reliable.
