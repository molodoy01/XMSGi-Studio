# Безопасность и приватность XMSGi Studio

Документ описывает модель угроз, хранение данных и границы доверия.
Соответствует версии **1.1.0**.
Политика отчётов об уязвимостях — [`SECURITY.md`](../../SECURITY.md).

---

## 1. Принципы

1. **Локальность.** Все данные аккаунта, черновики, вложения и история
   находятся только на устройстве пользователя.
2. **Отсутствие посредников.** XMSGi не использует ботов и собственные
   серверы: трафик идёт напрямую к DC Telegram по MTProto
   (библиотека `teleproto`).
3. **Отсутствие телеметрии.** В приложении нет аналитики, трекеров
   и crash-reporting.
4. **Минимум привилегий рендерера.** Renderer не имеет доступа к Node;
   весь системный доступ — через whitelist в `preload.cjs`.

---

## 2. Границы доверия

```
Renderer (недоверенный)
   │  window.telegram.* / window.draftStorage.* / window.gemini.*
   ▼
Preload — contextBridge, только ipcRenderer.invoke/sendSync
   │
   ▼
Main process
   ├─ assertTrustedRenderer()  — главный window + локальный dist/index.html
   ├─ assertDraftStorageRenderer() — узкий доступ storage-каналов
   ├─ validate*() из ipc-security.cjs — строгая валидация payload
   └─ telegram.cjs — единственное место, где живёт сессия
```

- Каждый из **43 IPC-хендлеров** проходит проверку доверенного
  отправителя (46 мест вызова проверок в `main.cjs`).
- Payload: `API_ID` — только цифры, `API_HASH`/`SESSION_STRING` —
  ограниченной длины и формата, chatId, даты, диапазоны scope/field —
  белые списки (`SCHEDULE_HISTORY_SCOPES`, `SCHEDULE_HISTORY_FIELDS`).
- `contextIsolation` и `nodeIntegration: false` — модель Electron
  по умолчанию для этого проекта; preload отдаёт только нужные методы.

---

## 3. Что где хранится

Корень данных: `%LOCALAPPDATA%\XMSGi` (packaged)
или `XMSGi-Workspace` (dev) — переопределяется в `main.cjs`,
включая `cache` и `temp` внутри этого корня.

| Данные | Файл | Защита |
|---|---|---|
| `API_ID`, `API_HASH`, `SESSION_STRING` | `xmsgi-studio-secure-config.json` | **Шифрование `safeStorage`** (Electron), поля `*_ENCRYPTED`; при недоступности safeStorage запись/чтение секретов блокируется с ошибкой |
| Ключ Gemini | тот же secure-config | `safeStorage`, в UI показывается только маска |
| Список чатов, избранное | `xmsgi-studio-chats.json` | локальный JSON, атомарная запись |
| История планирования | `xmsgi-studio-schedule-history.json` | атомарная запись, лимит 8 МБ, валидация схемы (до 2000 записей) |
| Черновики, вложения | `drafts/drafts.json` + `drafts/backups/` | атомарная запись (tmp → fsync → rename), права `0600`, ротация бэкапов, восстановление при повреждении (`DRAFT_STORE_CORRUPT`) |
| Шаблоны, локаль, режим UI | `localStorage` рендера | только неконфиденциальные данные |

Legacy-файлы `awaitmsg-*` автоматически переименовываются
в `xmsgi-studio-*` (`app-data-path.cjs`).

### Экспорт / импорт

- Черновики: `draft-store:export` / `draft-store:import` — через
  системный диалог выбора файла (только по инициативе пользователя).
- Текст из редактора: `editor-text:export` / `editor-text:import`.
- Вложения копируются в каталог черновиков (`draft-store:copy-attachment`),
  чтобы черновик не зависел от исходного пути файла.

---

## 4. Вход в Telegram

- Поддерживается полный flow: телефон → код (`isCodeViaApp`) →
  пароль 2FA (`SESSION_PASSWORD_NEEDED`).
- `phoneCodeHash` и ожидающий вход живут в памяти main-процесса
  до завершения авторизации (`pendingLogin`), не пишутся на диск.
- Ошибки кода/пароля/Flood преобразуются в дружелюбные сообщения
  без утечки внутренних деталей.

### Выход

| Команда | Эффект |
|---|---|
| `telegram-sign-out-keep-session` | закрывает клиент, **сохраняет** аккаунт на устройстве (быстрый «Welcome back») |
| `telegram-welcome-back` | восстановление сессии без повторного ввода кода |
| `telegram-forget-account` | **полное удаление** сохранённых данных аккаунта с устройства |
| `telegram-clear-session` | очистка session-данных клиента |

---

## 5. Сеть

| Направление | Назначение | Когда |
|---|---|---|
| Telegram DC (MTProto) | авторизация, чаты, отправка, планирование | всегда, когда приложение подключено |
| Google Gemini API | генерация текста ассистентом | **только** при включённой функции и наличии пользовательского ключа; ключ хранится в secure-config, модель по умолчанию `gemini-3.6-flash` |

Прокси/SOCKS поддерживается стеком `teleproto`.
Таймауты запросов — `withTimeout` в `telegram.cjs`;
сеть проверяется `checkInternetConnection` перед reconnect.

---

## 6. Rate limiting и abuse-защита

- FloodWait перехватывается, запрос ставится в паузу
  (`telegram-rate-limit-state`, `telegram-wait-for-rate-limit`)
  и повторяется — без ручных действий пользователя.
- Идемпотентность (`telegram-idempotency.cjs`) исключает
  случайное дублирование отправки/планирования.
- Slowmode и права чата проверяются до отправки
  (`telegram-chat-permissions`).
- Лимиты текста: 4096 / 1024 символа (`messageLimits.ts`).

---

## 7. Рекомендации пользователю

- Держите сессию и папку приложения при себе: кто имеет доступ к
  `%LOCALAPPDATA%\XMSGi`, имеет доступ к аккаунту.
- Не копируйте файлы `*-secure-config.json` и `drafts/` в публичные
  места (облака, репозитории, тикеты).
- Используйте **«Забыть аккаунт»** на чужом или общем компьютере.
- Храните `.env` в разработке локально — он исключён из Git
  и из packaging.

---

## 8. Рекомендации контрибьюторам

- Новые IPC-каналы — с проверкой отправителя и валидацией
  (`ipc-security.test.mjs` покрывает ожидаемые каналы).
- Не добавлять аналитику, remote logging и autoload внешних ресурсов.
- Секреты — только через `safeStorage`, никогда в localStorage
  и исходниках.
- Перед релизом — просмотр зависимостей (см. `SECURITY.md`).
