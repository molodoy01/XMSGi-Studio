<div align="center">

# XMSGi Studio

### ✈️ Telegram messages, when you choose.

<p>
  <a href="https://github.com/molodoy01/XMSGi-Studio/releases"><img alt="Release" src="https://img.shields.io/github/v/release/molodoy01/XMSGi-Studio?style=flat-square"></a>
  <a href="https://github.com/molodoy01/XMSGi-Studio/actions/workflows/release-check.yml"><img alt="Build" src="https://github.com/molodoy01/XMSGi-Studio/actions/workflows/release-check.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square"></a>
  <a href="https://github.com/molodoy01/XMSGi-Studio/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/molodoy01/XMSGi-Studio?style=flat-square"></a>
</p>

**XMSGi Studio** делает планирование встреч и создание публикаций в Telegram простым, локальным и **надежным**.

<p align="center">
  <a href="https://github.com/molodoy01/XMSGi-Studio/releases/latest"><img alt="Download latest release" src="https://img.shields.io/badge/⬇%20Download-latest-6c7cff?style=for-the-badge"></a>
</p>

<img src="screenshots/01.png" alt="XMSGi Studio workspace" width="760" />

<p align="center">
  <a href="https://molodoy01.github.io/XMSGi-Studio/"><img alt="Website" src="https://img.shields.io/badge/Website-molodoy01.github.io-101218?style=for-the-badge"></a>
  &nbsp;
  <a href="https://github.com/molodoy01/XMSGi-Studio"><img alt="GitHub" src="https://img.shields.io/badge/GitHub-Repository-181717?style=for-the-badge&logo=github"></a>
</p>

</div>

---

## ✨ Features

### ⚡ Studio first, Quick Planner when speed matters
Studio is the main workspace for composing and organizing posts. Quick Planner handles fast sends, schedules, and drafts that can be continued in Studio or revisited in Posts/History.

- **Publish:** send from your own Telegram account to chats, groups, and channels. No bot required.
- **Compose and schedule:** rich text, attachments, inline buttons, one-time posts, and daily, weekly, biweekly, or monthly repeats (up to 15 occurrences).
- **Stay organized:** color-coded drafts, reusable templates, and document history.
- **Keep control:** edit, reschedule, or cancel queued posts; FloodWait limits retry automatically.
- **Keep data local:** sessions stay on the device and use Electron <code>safeStorage</code> where supported. Portable Windows build available.

For setup and workflow details, see the [user guide](XMSGi%20Studio/docs/ru/user-guide.md).

## 🖼️ Screenshots

<p align="center">
  <img src="screenshots/03.png" alt="Quick Planner composer" width="32%" />
  <img src="screenshots/04-zoom.png" alt="XMSGi Studio sign-in screen" width="32%" />
  <img src="screenshots/02.png" alt="Telegram chat selection" width="32%" />
</p>

## 📥 Download

**[Download the latest release and choose your platform](https://github.com/molodoy01/XMSGi-Studio/releases/latest).**

| Platform | Format | Download |
| --- | --- | --- |
| Windows | Portable `.exe` | [XMSGi.Studio.1.3.0.exe](https://github.com/molodoy01/XMSGi-Studio/releases/download/v1.3.0/XMSGi.Studio.1.3.0.exe) — no installation required |
| Linux | AppImage (x64) | [XMSGi.Studio-1.3.0.AppImage](https://github.com/molodoy01/XMSGi-Studio/releases/download/v1.3.0/XMSGi.Studio-1.3.0.AppImage) |
| Linux | `.deb` (x64) | [xmsgi-studio_1.3.0_amd64.deb](https://github.com/molodoy01/XMSGi-Studio/releases/download/v1.3.0/xmsgi-studio_1.3.0_amd64.deb) |
| macOS | `.dmg` (Intel, unsigned) | [XMSGi.Studio-1.3.0.dmg](https://github.com/molodoy01/XMSGi-Studio/releases/download/v1.3.0/XMSGi.Studio-1.3.0.dmg) |
| macOS | `.dmg` (Apple Silicon, unsigned) | [XMSGi.Studio-1.3.0-arm64.dmg](https://github.com/molodoy01/XMSGi-Studio/releases/download/v1.3.0/XMSGi.Studio-1.3.0-arm64.dmg) |

The v1.3.0 download links will work after the release and its platform packages are published.

### First launch on macOS

macOS builds are unsigned and not notarized. Control-click XMSGi Studio in Finder,
choose **Open**, then confirm **Open**.
If macOS still blocks it, go to **System Settings → Privacy & Security → Open Anyway**.
Only bypass this warning for a copy downloaded from the official releases page.

## 🚀 Quick start

Requirements:

- Node.js 20+
- npm
- Windows, Linux (x64), or macOS (x64 / Apple Silicon) for the packaged desktop app

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

The Electron host owns the window, Telegram session and IPC bridge. Studio and Quick Planner are pages in the same React application. Studio is composed in `XMSGi Studio/src/studio/App.tsx` and mounted through `XMSGi Studio/src/workspace/StudioMount.tsx` with the host-owned scheduler runtime.

Studio's internal feature structure lives under `XMSGi Studio/src/studio/`:

- `XMSGi Studio/src/studio/App.tsx` composes the workspace and scheduler.
- `XMSGi Studio/src/studio/pages/WorkspacePage.tsx` owns the workspace page.
- `XMSGi Studio/src/studio/components/stages/` contains the chat, schedule, draft, template and inline-button stages.
- `XMSGi Studio/src/studio/services/` adapts publishing operations to the Telegram runtime.
- `XMSGi Studio/packages/shared/` provides types, translations and utilities shared across the application.
- `XMSGi Studio/telegram-errors.cjs` classifies Telegram errors; the account rate-limit interceptor waits and retries FloodWaits. IPC passes error category and retry metadata to Studio's operation-aware error handler.

Studio's locale context is provided by the host. Keep `StudioMount` under the host's `LocaleProvider`, and pass the existing connection, chats, account ID and scheduler runtime:

```tsx
<StudioMount
  connected={connected}
  activeAccountId={activeAccountId}
  chats={chats}
  scheduler={scheduler}
/>
```

The `@/`, `@studio/` and `@shared/` aliases are configured by the host Vite and TypeScript settings. Run `npm --prefix "XMSGi Studio" run typecheck`, `npm --prefix "XMSGi Studio" test` and `npm --prefix "XMSGi Studio" run build` from the repository root to validate the complete app, including Studio.

### Scheduler ownership

When Studio is embedded, the Host `useScheduler` runtime is authoritative for scheduling history, cancellation, retry state and FloodWait pauses. Studio receives that runtime through the versioned React-props contract in `packages/shared/bridge/`; History/Archive callbacks are part of the same contract. There is no separate event stream.

The Electron application always passes the host scheduler runtime, which is authoritative for scheduling history, cancellation, retry state and FloodWait pauses. `useStudioScheduler` remains a fallback for isolated previews and component tests.

</details>

## 📚 Documentation

Full documentation lives in the [`docs/`](XMSGi%20Studio/docs/README.md) directory:

- [User guide](XMSGi%20Studio/docs/ru/user-guide.md) — features, modes, installation, workflows (RU)
- [Architecture](XMSGi%20Studio/docs/ru/architecture.md) — process layers, modules, data flows (RU)
- [Development](XMSGi%20Studio/docs/ru/development.md) — setup, commands, tests, conventions (RU)
- [Security and privacy](XMSGi%20Studio/docs/ru/security.md) — storage, encryption, trust boundaries (RU)
- [IPC reference](XMSGi%20Studio/docs/ru/ipc-reference.md) — renderer ⇄ main channels (RU)

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
Why XMSGi Studio?

XMSGi Studio was created because existing Telegram scheduling tools felt slow, bloated and disconnected from the actual Telegram experience.
