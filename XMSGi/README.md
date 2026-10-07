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

This project is licensed under the MIT License. See [LICENSE](LICENSE).

---
XMSGi Studio keeps Telegram scheduling simple, local, and reliable.
