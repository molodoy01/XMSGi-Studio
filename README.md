<div align="center">

# XMSGi Studio

### ✈️ Telegram messages, when you choose.

<p>
  <a href="https://github.com/molodoy01/XMSGi-Studio/releases"><img alt="Release" src="https://img.shields.io/github/v/release/molodoy01/XMSGi-Studio?style=flat-square"></a>
  <a href="https://github.com/molodoy01/XMSGi-Studio/actions"><img alt="Build" src="https://img.shields.io/badge/build-passing-brightgreen?style=flat-square"></a>
  <a href="XMSGi%20Studio/LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square"></a>
  <a href="https://github.com/molodoy01/XMSGi-Studio/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/molodoy01/XMSGi-Studio?style=flat-square"></a>
</p>

<img src="XMSGi%20Studio/website/screenshots/01.png" alt="XMSGi Studio workspace" width="880" />

A desktop workspace for **writing, scheduling, and reviewing Telegram messages** — straight from your own account, **no bot required**. Built for Windows, kept local, and portable.

<br>

<a href="https://github.com/molodoy01/XMSGi-Studio/releases"><img alt="Download" src="https://img.shields.io/badge/⬇%20Download-v1.1.0-6c7cff?style=for-the-badge"></a>
&nbsp;
<a href="https://github.com/molodoy01/XMSGi-Studio"><img alt="GitHub" src="https://img.shields.io/badge/GitHub-Repository-181717?style=for-the-badge&logo=github"></a>

</div>

---

## ✨ Features

<table>
  <tr>
    <td width="50%" valign="top">
      <b>💬 Telegram, your way</b><br>
      Pick chats, groups and channels straight from your own account — no bot.
    </td>
    <td width="50%" valign="top">
      <b>⏰ Send now or later</b><br>
      One-time and future messages scheduled for a chosen date and time.
    </td>
  </tr>
  <tr>
    <td valign="top">
      <b>✍️ Compose fully</b><br>
      Attachments, rich text formatting and inline buttons.
    </td>
    <td valign="top">
      <b>🗂️ Stay on top of it</b><br>
      Drafts, the scheduled queue and delivery outcomes in a single history.
    </td>
  </tr>
  <tr>
    <td valign="top">
      <b>🔒 Private by design</b><br>
      Sessions stay on the device, protected with Electron <code>safeStorage</code>.
    </td>
    <td valign="top">
      <b>📦 Portable Windows build</b><br>
      No installation, no setup — runs from anywhere.
    </td>
  </tr>
</table>

## 🖼️ Screenshots

<p align="center">
  <img src="XMSGi%20Studio/website/screenshots/01.png" alt="XMSGi Studio workspace" width="32%" />
  <img src="XMSGi%20Studio/website/screenshots/02.png" alt="Telegram chat selection" width="32%" />
  <img src="XMSGi%20Studio/website/screenshots/03.png" alt="Message composition and preview" width="32%" />
</p>

## 📥 Download

| Platform | Format | Notes |
| --- | --- | --- |
| Windows | Portable `.exe` | No installation required. Runs from anywhere. |
| Linux | AppImage | Build target available via `npm run dist` on Linux. |
| macOS | `.dmg` | Build target available via `npm run dist` on macOS. |

Grab the latest build from [GitHub Releases](https://github.com/molodoy01/XMSGi-Studio/releases).

## 🚀 Quick start

Requirements:

- Node.js 20+
- npm
- Windows for the packaged desktop experience

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

The Electron host owns the window, Telegram session and IPC bridge. The React host mounts Studio through `src/workspace/StudioMount.tsx`; the Vite `$studio` alias resolves that import to the shared `../Studio/Studio module/src/App.tsx`.

The embedded Studio source is kept as a separate Vite/React module:

- `../Studio/Studio module/src/App.tsx` composes the Studio workspace and scheduler.
- `../Studio/Studio module/src/pages/WorkspacePage.tsx` owns the workspace page.
- `../Studio/Studio module/src/components/stages/` contains the chat, schedule, draft, template and inline-button stages.
- `../Studio/Studio module/src/services/` adapts publishing operations to the Telegram bridge.
- `packages/shared/` provides types, translations and utilities used by both host and Studio.
- `XMSGi/telegram-errors.cjs` classifies Telegram errors; the account rate-limit interceptor waits and retries FloodWaits. IPC passes error category and retry metadata to Studio's operation-aware error handler.

Studio's locale context is provided by the host. Keep `StudioMount` under the host's `LocaleProvider`, and pass the existing connection, chats, account ID and scheduler runtime:

```tsx
<StudioMount
  connected={connected}
  activeAccountId={activeAccountId}
  chats={chats}
  scheduler={scheduler}
/>
```

The `$studio`, `@/` and `@shared/` aliases are configured by the host Vite plugin. The Studio module is embedded from this repository's source tree rather than consumed as a separately published npm package. To check it directly, run `npm --prefix "Studio/Studio module" run typecheck`, `npm --prefix "Studio/Studio module" test` and `npm --prefix "Studio/Studio module" run build` from the repository root.

### Scheduler ownership

When Studio is embedded, the Host `useScheduler` runtime is authoritative for scheduling history, cancellation, retry state and FloodWait pauses. Studio receives that runtime through the versioned React-props contract in `packages/shared/bridge/`; History/Archive callbacks are part of the same contract. There is no separate event stream.

If the scheduler prop is omitted, Studio uses `useStudioScheduler` as a standalone fallback. It is a separate, simpler implementation and is not the source of truth for embedded History/Archive workflows. Keep changes to the two paths aligned and covered independently; do not combine them into one scheduler until standalone support requirements are decided.

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

We welcome focused pull requests and bug reports. Please read [CONTRIBUTING.md](XMSGi%20Studio/CONTRIBUTING.md) before submitting changes.

## 🛡️ Security reporting

Please report vulnerabilities privately through the repository security process. Do not disclose critical issues in public issues or pull requests. See [SECURITY.md](XMSGi%20Studio/SECURITY.md).

## 📦 Repository

GitHub repository:

- https://github.com/molodoy01/XMSGi-Studio.git

To connect this project to the remote repository manually:

```bash
git remote add origin https://github.com/molodoy01/XMSGi-Studio.git
git branch -M main
git push -u origin main
```

## 📄 License

This project is licensed under the MIT License. The canonical license text is in [LICENSE](XMSGi%20Studio/LICENSE); the Studio module also declares `MIT` in its package metadata.

---
XMSGi Studio keeps Telegram scheduling simple, local, and reliable.
