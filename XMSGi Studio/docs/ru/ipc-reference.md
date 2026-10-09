# Справочник IPC-каналов XMSGi Studio

Все каналы связи renderer ⇄ main-процесс.
Источник истины: `main.cjs` (хендлеры), `preload.cjs` (API рендера),
`ipc-security.cjs` (валидация). Соответствует версии **1.1.0**.

**Всего: 43 `ipcMain.handle` + 1 `ipcRenderer.sendSync`
+ 1 push-событие.**

---

## 1. Правила безопасности

Каждый хендлер начинается с проверки отправителя:

- **`assertTrustedRenderer`** — вызывать может только главный
  `BrowserWindow`, загрузивший локальный `dist/index.html`;
  используется для Telegram-, Gemini- и chat-storage-каналов.
- **`assertDraftStorageRenderer`** — узкий допуск для
  черновиков и истории.

Далее payload проходит `validate*` из `ipc-security.cjs`.
Любая ошибка валидации — ответ `{ success: false, error }`,
main-процесс не завершается.

Формат ответов (типовой):

```ts
{ success: boolean, error?: string, ...канал-специфичные поля }
```

Push-статус Telegram: main шлёт рендереру событие
**`telegram-status`** со снапшотом
`{ accountId, status, category?, error?, waitSecondsText? }`,
`status ∈ normal | rate-limited | slowmode | auth required |
network/retrying | error`.
Подписка в рендере — `window.telegram.onStatus(cb)`
(ref-counted, `preload.cjs`).

---

## 2. Telegram: подключение и аккаунт

| Канал | Payload | Ответ / заметки |
|---|---|---|
| `telegram-config` | — | `{ hasCredentials, hasSession, connected, ... }` |
| `telegram-save-credentials` | `{ API_ID?, API_HASH?, apiId?, apiHash? }` | `API_ID` — только цифры (regex), `API_HASH` — ограниченной длины; сохраняется зашифрованно |
| `telegram-login` | `{ phoneNumber/phone, phoneCode?, password?, API_ID?, API_HASH? }` | `{ success, requiresCode?, requiresPassword?, nextStep?: 'code'\|'password', isCodeViaApp?, error? }` |
| `telegram-connect` | — | восстановление клиента из сохранённой сессии |
| `telegram-auth-state` | — | состояние авторизации/аккаунта |
| `telegram-sign-out-keep-session` | — | выход с сохранением аккаунта |
| `telegram-welcome-back` | — | вход по сохранённому аккаунту |
| `telegram-forget-account` | — | полное удаление данных аккаунта |
| `telegram-clear-session` | — | очистка session-данных клиента |

## 3. Telegram: чаты и справочники

| Канал | Payload | Ответ / заметки |
|---|---|---|
| `telegram-chats` | — | список чатов `{ id, name, username?, type?, avatarDataUrl? }` |
| `telegram-chat-avatar` | `chatId` | аватар (data URL) |
| `telegram-chat-permissions` | `chatId` | права: view/send/schedule |
| `telegram-chat-history` | `{ chatId, limit? }` | история сообщений чата |
| `telegram-saved-message:delete` | `{ chatId, messageId }` | удаление из «Избранного» |
| `telegram-contacts` | — | контакты |
| `telegram-effects` | — | доступные эффекты сообщений |
| `telegram-find-chat` | `query` | поиск по dialogs |

## 4. Telegram: отправка и планирование

| Канал | Payload | Ответ / заметки |
|---|---|---|
| `telegram-send` | `{ accountId?, chatId, message, attachments?, entities?, replyMarkup?, silent?, effect?, idempotencyKey? }` | мгновенная отправка |
| `telegram-schedule` | `{ chatId, message, date?, time?, targetTimestamp?, attachments?, entities?, replyMarkup?, silent?, effect?, ... }` | отложенная отправка на сервере Telegram; идемпотентна |
| `telegram-schedule-identities` | `{ operations }` | сверка idempotency-ключей с уже запланированным |
| `telegram-cancel` | `{ chatId?, id/ids, ... }` | отмена запланированного |
| `telegram-status` (handle) | — | текущий снапшот статуса |
| `telegram-rate-limit-state` | — | `{ current: { status, paused, pausedUntil, remainingMs, ... } }` |
| `telegram-wait-for-rate-limit` | — | ожидание окончания FloodWait |

---

## 5. Черновики и вложения (`window.draftStorage`)

| Канал | Guard | Payload / заметки |
|---|---|---|
| `draft-store:load` | draft | чтение стора (schemaVersion, savedDrafts, workspaceDraft, backups) |
| `draft-store:save` | draft | запись стора (нормализация + версия схемы) |
| `draft-store:migrate` | draft | миграция legacy-данных рендера |
| `draft-store:restore-backup` | draft | восстановление по индексу бэкапа |
| `draft-store:copy-attachment` | draft | копирование файла вложения в каталог черновиков |
| `draft-store:export` | draft | экспорт бэкапа (системный диалог) |
| `draft-store:import` | draft | импорт бэкапа (системный диалог) |
| `draft-store:flush` | sendSync | **синхронная** запись при закрытии окна |
| `editor-text:export` | draft | экспорт текста редактора в файл |
| `editor-text:import` | draft | импорт текста из файла |

---

## 6. История планирования

| Канал | Guard | Payload / заметки |
|---|---|---|
| `schedule-history:load` | draft | `scope ∈ upcoming \| sent \| snapshot`; ответ `{ history: { upcoming, sent }, needsMigration? }`; прерванные статусы восстанавливаются в `failed` |
| `schedule-history:save` | draft | `{ scope, field, messages }`; белые списки scope/field; лимит 8 МБ; полная валидация записей (до 2000) |

## 7. Список чатов

| Канал | Guard | Payload / заметки |
|---|---|---|
| `chat-storage-load` | trusted | чтение `xmsgi-studio-chats.json` |
| `chat-storage-save` | trusted | атомарная запись списка чатов |

---

## 8. Gemini-ассистент (`window.gemini`)

| Канал | Payload / заметки |
|---|---|
| `gemini-generate` | `{ prompt, context }` — валидируется длина prompt (MAX_PROMPT_LENGTH); требует включённой функции и ключа |
| `gemini-settings-status` | `{ maskedKey, enabled, encryptionAvailable }` |
| `gemini-save-key` | ключ → шифруется `safeStorage` |
| `gemini-remove-key` | удаление ключа |
| `gemini-set-enabled` | `enabled: boolean` |

---

## 9. Соответствие API рендера

`preload.cjs` разворачивает каналы в три объекта:

```ts
window.telegram       // getConfig, login, connect, getChats, send,
                      // schedule, cancel, onStatus, …
window.draftStorage   // load, save, flush, migrate, restoreBackup,
                      // exportBackup, importBackup, exportText,
                      // importText, copyAttachment, getFilePath
window.gemini         // generate, getSettings, saveKey, removeKey,
                      // setEnabled
```

Типы объявлены в `src/telegram.d.ts`.

---

## 10. Как добавить новый канал

1. Добавьте `ipcMain.handle('<name>', ...)` в `main.cjs`
   с `assertTrustedRenderer` (или `assertDraftStorageRenderer`)
   и валидацией через `ipc-security.cjs`.
2. Добавьте метод в `preload.cjs` (whitelist — без прямого
   доступа рендера к `ipcRenderer`).
3. Опишите тип в `src/telegram.d.ts`.
4. Добавьте проверки в `ipc-security.test.mjs`
   (канал, guard, валидация payload).
5. Ответ — только `{ success, error?, ... }`.

