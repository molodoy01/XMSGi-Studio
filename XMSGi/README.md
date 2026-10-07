# XMSGi Studio

Telegram scheduling for Windows, built for your own account.

XMSGi Studio is a desktop app for scheduling and sending Telegram messages without a bot. It runs locally on your Windows machine and keeps the workflow simple: select a chat, write a message, schedule it, and let it send when the time arrives.

## Why it exists

- schedule one-time and future Telegram messages
- keep the app local and lightweight
- work with your personal Telegram session
- preserve local drafts and scheduling history
- ship as a portable Windows desktop app

## Features

- Telegram chat selection and quick switching
- instant send and delayed send
- local draft and history management
- message media and keyboard support
- secure local storage for credentials where supported
- portable Windows distribution

## Quick start

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

## Studio architecture

The Electron host lives in `XMSGi/`. It owns the window, Telegram session and IPC bridge. The React host mounts Studio through `src/workspace/StudioMount.tsx`; the Vite `$studio` alias resolves that import to `Studio/Studio module/src/App.tsx`.

The embedded Studio source is kept as a separate Vite/React module:

- `Studio/Studio module/src/App.tsx` composes the Studio workspace and scheduler.
- `Studio/Studio module/src/pages/WorkspacePage.tsx` owns the workspace page.
- `Studio/Studio module/src/components/stages/` contains the chat, schedule, draft, template and inline-button stages.
- `Studio/Studio module/src/services/` adapts publishing operations to the Telegram bridge.
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

## Security and privacy

XMSGi Studio keeps Telegram data local to the device. Session and account data are stored in the user data directory, and secure storage is used where the platform supports it.

This app does not depend on a Telegram bot for its core scheduling flow.

## Contribution

We welcome focused pull requests and bug reports. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting changes.

## Security reporting

Please report vulnerabilities privately through the repository security process. Do not disclose critical issues in public issues or pull requests. See [SECURITY.md](SECURITY.md).

## Repository

GitHub repository:

- https://github.com/molodoy01/XMSGi-Studio.git

To connect this project to the remote repository manually:

```bash
git remote add origin https://github.com/molodoy01/XMSGi-Studio.git
git branch -M main
git push -u origin main
```

## License

This project is licensed under the MIT License. The canonical license text is in [LICENSE](LICENSE); the Studio module also declares `MIT` in its package metadata.

---
XMSGi Studio keeps Telegram scheduling simple, local, and reliable.
