# XMSGi
**Telegram message scheduler for Windows.**

XMSGi is a lightweight desktop application for sending and scheduling Telegram messages using your personal Telegram account.

## Features

- Telegram chat selection
- Instant message sending
- Scheduled message sending
- Session saving
- Session deletion
- Portable Windows application

## Download
**XMSGi 2.2.0 — Windows Portable**

Download the latest Windows `.exe` from [GitHub Releases](https://github.com/molodoy01/XMSGi/releases/tag/v2.2.0).

## How it works
XMSGi connects directly to Telegram using the MTProto protocol and your personal Telegram account.

Once a message is scheduled, your PC does not need to remain open.

## Telegram FloodWait limits

`FLOOD_WAIT_X` values up to **365 days (31,536,000 seconds)** are accepted. Values longer than this, malformed values, zero, and negative values fail with a clear error and do not create a pause or retry loop. Accepted waits longer than the Node.js timer limit are resumed through chunked timers.

FloodWait pauses are held in memory for the running process. Restart persistence for an active FloodWait is intentionally deferred; restarting XMSGi clears the in-memory pause.

## Privacy & Security
Telegram session data is stored locally and protected using Electron's secure storage where supported.

XMSGi does not require a Telegram bot for its core scheduling flow.

## Open Source
XMSGi is open source and available on GitHub.

---
**XMSGi · Telegram scheduling, kept simple.**
