# Архитектура XMSGi Studio

Техническое описание приложения для разработчиков.
Соответствует версии **1.1.0**.

---

## 1. Общая схема

XMSGi Studio — настольное приложение на **Electron**.
Оно состоит из трёх основных слоёв:

```
┌─────────────────────────────────────────────────────────────┐
│  Electron MAIN PROCESS (Node.js)                            │
│  main.cjs — окно, Tray, IPC-хендлеры, валидация             │
│  telegram.cjs — ядро Telegram (MTProto через teleproto)     │
│  draft-store.cjs, schedule-history.cjs, chat-storage.cjs    │
│  telegram-account-storage.cjs — защищённое хранение         │
│  ipc-security.cjs — валидация всех входящих payload         │
│  gemini.cjs — экспериментальный AI-ассистент                │
└───────────────▲──────────────────────────────▲──────────────┘
                │ IPC (invoke/handle)          │ IPC event
                │ 43 канала                    │ 'telegram-status'
┌───────────────┴──────────────────────────────┴──────────────┐
│  PRELOAD (preload.cjs)                                      │
│  contextBridge: window.telegram / window.draftStorage /     │
│  window.gemini — whitelist API без доступа к Node           │
└───────────────▲─────────────────────────────────────────────┘
                │ window.* API
┌───────────────┴─────────────────────────────────────────────┐
│  RENDERER (React 18 + TypeScript + Vite)                    │
│  src/           — хост-приложение (Planner, AppShell)       │
│  ../Studio/Studio module/ — встроенная студийная область    │
│  packages/shared/ — общие типы, i18n, утилиты, bridge       │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Main process

### 2.1 Точка входа — `main.cjs`

- Перенаправляет каталоги `userData`, `sessionData`, `cache`, `temp`
  в единый корень приложения (`app-data-path.cjs`):
  `%LOCALAPPDATA%\XMSGi` (packaged) или `XMSGi-Workspace` (dev).
  Это делает приложение переносимым и независимым от системы.
- В dev-режиме читает `.env` (`API_ID`, `API_HASH`, `GEMINI_MODEL`).
  `.env` никогда не попадает в сборку и в Git.
- Создаёт `BrowserWindow`, Tray, обрабатывает `second-instance`.
- Регистрирует **43 IPC-хендлера** — см. [Справочник IPC](ipc-reference.md).

### 2.2 Граница доверия

Каждый хендлер проходит через два уровня проверки:

1. **`assertTrustedRenderer(event, webContents, expectedUrl)`** —
   вызывающий рендерер должен быть главным окном и загружать
   локальный `dist/index.html` (защита от подделки IPC).
2. **`assertDraftStorageRenderer(event)`** — узкий допуск
   для каналов чтения/записи черновиков и истории.

Далее payload валидируется функциями из `ipc-security.cjs`
(`validateLoginPayload`, `validateChatId`, `validateHistoryPayload` и т.д.).
Ошибки валидации возвращаются в рендерер как
`{ success: false, error }` — main-процесс не падает.

### 2.3 Ядро Telegram — `telegram.cjs`

Ключевой модуль (~84 КБ). Через библиотеку `teleproto`
(официальный MTProto-протокол Telegram) предоставляет:

- **Авторизация**: `loginUser` — шаги `code` → `password` (2FA),
  хранение `phoneCodeHash` в памяти до завершения входа.
- **Жизненный цикл**: `connectTelegram`, `reconnectTelegram`
  с авто-retry, `shutdownTelegram`, `welcomeBack`,
  `signOutKeepSession`, `forgetAccount`, `clearSession`.
- **Чаты и история**: `getChats`, `getChatPermissions`,
  `getChatHistory`, `getContacts`, поиск (`telegram-find-chat`),
  аватары, `GetAvailableEffects` (эффекты сообщений).
- **Отправка**: `sendMessage` и `scheduleMessage`
  (см. §3), `cancelScheduledMessage`.
- **Rate limiting**: перехват FloodWait — запрос ставится в паузу
  (`getTelegramRateLimitState`, `waitForTelegramRateLimit`),
  повторяется после истечения ожидания.
- **Идемпотентность**: `telegram-idempotency.cjs` формирует
  ключ операции; перед планированием приложение сверяется с уже
  отложенными сообщениями (`getScheduledMessages` + сравнение),
  чтобы дубль не создавался.
- **Ошибки**: `telegram-errors.cjs` классифицирует ошибки
  (flood / slowmode / auth / permission / network / unknown),
  `telegram-lifecycle.cjs` — состояние подключения,
  статус транслируется в рендерер событием `telegram-status`.

### 2.4 Хранение (main-процесс)

| Модуль | Файл в userData | Назначение |
|---|---|---|
| `telegram-account-storage.cjs` | `xmsgi-studio-secure-config.json` (legacy: `awaitmsg-secure-config.json`) | `API_ID`, `API_HASH`, `SESSION_STRING` — **зашифрованы** `safeStorage` |
| `chat-storage.cjs` | `xmsgi-studio-chats.json` | список чатов, избранное, скрытые чаты |
| `schedule-history.cjs` | `xmsgi-studio-schedule-history.json` | `upcoming` / `sent` / `snapshot`, лимит 8 МБ |
| `draft-store.cjs` | `drafts/drafts.json` + backups | черновики, вложения (`copy-attachment`), schemaVersion = 2 |

Все JSON-записи **атомарны** (tmp-файл → `fsync` → `rename`),
файлы черновиков создаются с правами `0600`.
Прерванные статусы истории (`sending`, `pending`, неизвестные)
нормализуются в `failed` с возможностью повтора
(`normalizeScheduleMessages({ recoverInterrupted: true })`).

---

## 3. Планирование

Планирование выполняется **на серверах Telegram**, не локальным таймером:

1. Рендерер вызывает `window.telegram.schedule({...})`.
2. Main вычисляет `scheduledDate` (unix-seconds) из `targetTimestamp`
   либо из пары `date + time`.
3. Создаётся idempotency-ключ; проверяется очередь
   `getScheduledMessages` на уже существующую копию.
4. Отправляется `Api.messages.SendMessage` с полем `scheduleDate`
   (для вложений — `client.sendMessage` с `schedule: timestamp`).
5. Результат записывается в историю через `schedule-history:save`.

Поэтому сообщение уйдёт, даже если приложение и компьютер выключены.

**Повторения** считаются в рендере (`src/lib/scheduling.ts`):
режимы `none | daily | weekly | biweekly | monthly`,
выбор дней недели, максимум `MAX_SCHEDULE_OCCURRENCES = 15` —
на каждый occurrence создаётся отдельная операция планирования.

---

## 4. Renderer

### 4.1 Хост-приложение (`src/`)

- `src/App.tsx` — маршрутизация (`/`, `/settings` через hash),
  выбор режима `productView: 'studio' | 'planner'`
  (ключ `xmsgi-product-view` в localStorage), composition хуков.
- `src/AppShell.tsx` / `src/workspace/AppShell.tsx` — оболочка.
- `src/pages/SchedulePage.tsx` — простой режим (Planner).
- `src/pages/SettingsPage.tsx`, `src/components/SettingsView.tsx` —
  настройки: язык (en/ru), API-данные, Gemini-ключ, выход.
- `src/hooks/` — `useTelegramAuth`, `useChats`, `useScheduler`,
  `useNotifications`, `useAssistant`.
- `src/components/` — `ChatPicker`, `RichTextEditor`,
  `InlineKeyboardBuilder`, `ChatPreviewStand` и др.
- `src/workspace/` — интеграция Studio: `StudioMount.tsx`,
  `studioLoader.ts` (ленивый `import('$studio')`),
  `HistoryDrawer.tsx` (единая история), `historyModel.ts`.

### 4.2 Studio-модуль (`../Studio/Studio module/`)

Отдельный Vite/React-модуль, встраиваемый через алиас `$studio`
(см. `vite.config.ts` → плагин `studio-aware-alias`):

- `src/App.tsx` — композиция workspace и scheduler;
- `src/pages/WorkspacePage.tsx` — рабочая страница (редактор,
  черновики, шаблоны, выбор чата, расписание);
- `src/components/` — стадии чата, расписания, черновика,
  шаблонов, inline-кнопок, `RichTextEditor`, `ChatPreviewStand`;
- `src/hooks/useStudioScheduler.ts` — fallback-планировщик;
- `src/repositories/`, `src/services/` — доступ к данным
  и адаптация publishing-операций к Telegram-мосту.

Алиасы: `$studio` → `../Studio/Studio module/src/App.tsx`,
`@/` → `src/` (хоста или Studio — зависит от импортёра),
`@shared/` → `packages/shared/`.

### 4.3 Контракт моста (`packages/shared/bridge/`)

Единственный способ общения хоста и Studio — версионированный
React-props контракт:

- `BRIDGE_PROTOCOL_VERSION = 1` (`protocol.ts`);
- `createStudioSchedulerRuntime(actions, notification, close)`
  оборачивает `StudioSchedulerActions`:
  `handleSchedule`, `handleSendNow`, `handleSendDraftNow`,
  `handleCancelMessage(s)`, `handleDeleteMessage`, `handleClearSent`;
- `StudioSchedulePayload` — чат, текст, дата/время, вложения,
  entities, replyMarkup, silent, effect;
- ошибки — `BridgeErrorDetails` (`bridge/errors.ts`),
  категория и retry-метаданные FloodWait передаются из
  `telegram-errors.cjs` в operation-aware обработчик Studio.

**Владение планировщиком:** когда Studio встроена, авторитетен
`useScheduler` хоста (история, отмена, retry, паузы FloodWait).
`useStudioScheduler` используется только как standalone-fallback;
эти два пути нельзя сливать в один без отдельного решения.

### 4.4 Rich-text

`src/lib/richText.ts` / `packages/shared/telegramText.cjs` —
нормализация entities (strong/em/u/s/a), слияние, нарезка по
длине, конвертация HTML ⇄ entities. Лимиты —
`src/lib/messageLimits.ts` (4096 / 1024 символа).

---

## 5. Данные и состояние в рендере

- **localStorage**: шаблоны (`awaitmsg_templates`), скрытые чаты
  (`awaitmsg_hidden_chats_v2`), черновик Planner, режим
  `xmsgi-product-view`, локаль (`awaitmsg_locale`).
- **Черновики** — через `window.draftStorage` в файловую систему
  (main-процесс), не в localStorage.
- **История** — `window.telegram.loadScheduleHistory(scope)`
  со scope `upcoming | sent | snapshot`.

---

## 6. Локализация

`packages/shared/i18n/` — `Locale = 'en' | 'ru'`,
`LocaleProvider` в хосте, Studio использует `useLocale` хоста.
Ключи переводов разбиты на `studioTranslations.ts` и
`historyTranslations.ts`.

---

## 7. Сборка и упаковка

- **Рендерер**: Vite → `dist/` (manualChunks: react-vendor,
  ui-vendor, telegram-vendor, telemetry-vendor).
- **Пакет**: `electron-builder` (`package.json` → `build.files`
  включает все `.cjs`-модули и `packages/shared/telegramText.cjs`,
  `asar: true`).
- **Цели**: Windows `portable`, Linux `AppImage` + `deb`,
  macOS `dmg` + `zip` (x64, arm64).

---

## 8. Смежные документы

- [Разработка и сборка](development.md)
- [Безопасность](security.md)
- [Справочник IPC](ipc-reference.md)
