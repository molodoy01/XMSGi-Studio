<div align="center">

# XMSGi Studio

### Plan and publish Telegram posts from your own account.

Write, schedule, and manage posts in a focused desktop workspace. Your Telegram session stays on your device; no bot is required for publishing.

<p>
  <a href="https://github.com/molodoy01/XMSGi-Studio/releases/latest"><img alt="Download the latest release" src="https://img.shields.io/badge/Download-latest%20release-536dfe?style=for-the-badge"></a>
  &nbsp;
  <a href="https://molodoy01.github.io/XMSGi-Studio/"><img alt="Product website" src="https://img.shields.io/badge/Product-website-20232a?style=for-the-badge"></a>
</p>

<p>
  <a href="https://github.com/molodoy01/XMSGi-Studio/releases"><img alt="Latest release" src="https://img.shields.io/github/v/release/molodoy01/XMSGi-Studio?style=flat-square"></a>
  <a href="https://github.com/molodoy01/XMSGi-Studio/actions/workflows/release-check.yml"><img alt="Release checks" src="https://github.com/molodoy01/XMSGi-Studio/actions/workflows/release-check.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square"></a>
</p>

<img src="screenshots/01.png" alt="XMSGi Studio desktop workspace" width="840">

</div>

## Your publishing workflow

- **Compose:** format messages, add media, and preview posts before sending.
- **Schedule:** publish once or set daily, weekly, biweekly, or monthly repeats, up to 15 occurrences.
- **Stay organized:** keep drafts, reusable templates, scheduled posts, and publishing history together.
- **Work from your account:** publish to Telegram chats, groups, and channels without a bot.
- **Keep control:** manage queued posts and retain session data locally, using Electron `safeStorage` where supported.

Studio is the main workspace for preparing and organizing posts. Quick Planner is there for fast sends, schedules, and drafts that can be continued in Studio.

## Screenshots

<p align="center">
  <img src="screenshots/02.png" alt="Posts history and saved messages" width="32%">
  <img src="screenshots/03.png" alt="Quick Planner composer and activity chart" width="32%">
  <img src="screenshots/04-zoom.png" alt="XMSGi Studio sign-in screen" width="32%">
</p>

## Download

**[Get the latest release](https://github.com/molodoy01/XMSGi-Studio/releases/latest)** for Windows, Linux, or macOS.

The release page contains the current Windows portable app, Linux AppImage and `.deb` packages, and macOS `.dmg` and `.zip` builds.

**macOS note:** builds are unsigned and not notarized. Open the app from Finder using **Control-click → Open**, and only bypass this warning for a copy downloaded from the official releases page.

## Documentation and website

- [Product website](https://molodoy01.github.io/XMSGi-Studio/) — product overview and downloads.
- [Telegram post scheduler (RU)](https://molodoy01.github.io/XMSGi-Studio/ru/telegram-post-scheduler/) · [English](https://molodoy01.github.io/XMSGi-Studio/en/telegram-post-scheduler/) — product information and guides.
- [User guide (RU)](XMSGi%20Studio/XMSGi%20Studio/docs/ru/user-guide.md) — setup, features, and workflows.
- [Development guide (RU)](XMSGi%20Studio/XMSGi%20Studio/docs/ru/development.md) — local setup, tests, and conventions.
- [Architecture (RU)](XMSGi%20Studio/XMSGi%20Studio/docs/ru/architecture.md) · [Security and privacy (RU)](XMSGi%20Studio/XMSGi%20Studio/docs/ru/security.md) · [IPC reference (RU)](XMSGi%20Studio/XMSGi%20Studio/docs/ru/ipc-reference.md).

The bilingual website and its search-engine pages, metadata, and sitemap are maintained in [`website/`](website/).

## Run from source

Requirements: Node.js 20+ and npm.

```bash
cd "XMSGi Studio/XMSGi Studio"
npm ci
npm test
npm run typecheck
npm run build
npm run electron
```

Create a Windows portable package with `npm run dist`.

## Project layout

- [`XMSGi Studio/`](XMSGi%20Studio/) — desktop application and its technical documentation.
- [`website/`](website/) — bilingual product site and SEO pages.
- [`screenshots/`](screenshots/) — product screenshots used on this page.

## Contributing and security

Focused pull requests and bug reports are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before contributing. For vulnerability reports, follow [SECURITY.md](SECURITY.md) and avoid posting sensitive details publicly.

## License

XMSGi Studio is released under the [MIT License](LICENSE).
