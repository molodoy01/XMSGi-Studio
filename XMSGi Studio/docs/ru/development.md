# Разработка и сборка XMSGi Studio

Инструкции для контрибьюторов и разработчиков.
Соответствует версии **1.1.0**.

---

## 1. Требования

- **Node.js 20+** и npm
- Git
- Windows для портативной desktop-сборки (остальные платформы собираются
  через electron-builder)
- Для студийного модуля — доступ к соседнему каталогу
  `../Studio/Studio module/` (встраивается через алиас `$studio`)

---

## 2. Структура репозитория

```
XMSGi Studio/
├── main.cjs                  # Electron main: окно, Tray, IPC, валидация
├── preload.cjs               # contextBridge: window.telegram/draftStorage/gemini
├── ipc-security.cjs          # валидация всех IPC-payload
├── telegram.cjs              # ядро Telegram (teleproto, MTProto)
├── telegram-*.cjs            # lifecycle, errors, storage, search,
│                             # permissions, idempotency, dialogs, rate-limit
├── draft-store.cjs           # черновики: атомарная запись, бэкапы, вложения
├── schedule-history.cjs      # нормализация/валидация истории планирования
├── chat-storage.cjs          # список чатов (избранное, скрытые)
├── app-data-path.cjs         # корень данных приложения + миграция имён
├── gemini.cjs                # экспериментальный AI-ассистент
├── src/                      # рендерер-хост (React + TS)
│   ├── App.tsx               # маршруты, режим studio/planner
│   ├── pages/                # SchedulePage (Planner), SettingsPage
│   ├── components/           # ChatPicker, RichTextEditor, SettingsView…
│   ├── hooks/                # useTelegramAuth, useChats, useScheduler…
│   ├── lib/                  # scheduling, richText, templates, i18n…
│   ├── services/             # chatDomainService, adapters
│   └── workspace/            # StudioMount, HistoryDrawer, studioLoader
├── packages/shared/          # общий код хоста и Studio
│   ├── bridge/               # версионированный контракт моста (v1)
│   ├── i18n/                 # переводы en/ru
│   ├── types/, utils/
│   └── telegramText.cjs      # rich-text утилиты для main-процесса
├── ../Studio/Studio module/  # встраиваемый Studio-модуль (отдельный Vite app)
├── docs/                     # эта документация
├── *.test.mjs, *.test.tsx    # тесты Vitest (корень, src, Studio)
└── package.json              # скрипты, конфиг electron-builder
```

---

## 3. Команды

| Команда | Назначение |
|---|---|
| `npm install` | установка зависимостей |
| `npm run dev` | Vite dev-сервер (рендерер) |
| `npm run build` | production-сборка рендерера в `dist/` |
| `npm run electron` | запуск Electron-оболочки (нужен `npm run build`) |
| `npm run start` | `build` + `electron` одной командой |
| `npm test` | прогон всех тестов (Vitest, `vitest run`) |
| `npm run lint` | ESLint по всему проекту |
| `npm run typecheck` | TypeScript-проверка (`tsconfig.app.json`) |
| `npm run dist` | `build` + `electron-builder --win` (портативный `.exe`) |
| `npm run preview` | предпросмотр production-сборки Vite |

### Studio-модуль отдельно

```bash
npm --prefix "../Studio/Studio module" run typecheck
npm --prefix "../Studio/Studio module" test
npm --prefix "../Studio/Studio module" run build
```

---

## 4. Тесты

- Фреймворк: **Vitest** (+ Testing Library для React, jsdom).
- Конфиг: `vitest.config.ts` — те же алиасы, что в `vite.config.ts`
  (`$studio`, `@/`, `@shared/`).
- Покрытие включает:
  - main-модули (`*.test.mjs` в корне): IPC-безопасность, lifecycle
    Telegram, идемпотентность планирования, rate-limit, storage,
    миграции истории, packaging;
  - рендерер (`*.test.tsx` в `src/`): хуки, страницы, компоненты;
  - Studio-модуль (в его каталоге).
- Отчёты прогона в репозиторий не коммитятся (см. `.gitignore`).
  При необходимости сохраните JSON-отчёт вручную:
  `npx vitest run --reporter=json --outputFile=vitest-report.json`.

Рекомендуемый порядок перед PR:

```bash
npm test -- --run
npm run lint
npm run typecheck
npm run build
```

---

## 5. Требования к изменениям

Из [`CONTRIBUTING.md`](../../CONTRIBUTING.md):

- небольшие, сфокусированные изменения;
- тесты для багфиксов и регрессий;
- описание поведенческих изменений, влияющих на пользователя;
- соблюдение TypeScript-типов и модели desktop-приложения
  (Electron main/renderer/preload);
- уважение локальных ограничений хранения и приватности;
- в PR — проблема, решение и evidence из тестов/сборки;
- без нерелевантного форматирования.

### Особенности, о которых нужно помнить

1. **Два планировщика.** `useScheduler` (хост, авторитетный при
   встроенной Studio) и `useStudioScheduler` (standalone-fallback).
   Изменения в одном нужно покрывать тестами в обоих путях;
   не объединять их без явного решения.
2. **Контракт моста версионирован.** При изменении
   `packages/shared/bridge/` поднимайте осознанно
   `BRIDGE_PROTOCOL_VERSION` и обновляйте обе стороны.
3. **Каждый новый IPC-канал** обязан иметь проверку
   `assertTrustedRenderer`/`assertDraftStorageRenderer` и валидацию
   payload в `ipc-security.cjs` + тест в `ipc-security.test.mjs`.
4. **Миграции данных.** Файлы в userData переименованы
   из `awaitmsg-*` в `xmsgi-studio-*`; миграция —
   `app-data-path.cjs` (автоперименование legacy-файла).
   Новые схемы — с версией (`DRAFT_STORE_SCHEMA_VERSION = 2`).

---

## 6. Переменные окружения

Файл `.env` (в Git и в сборку не попадает):

| Переменная | Назначение |
|---|---|
| `API_ID`, `API_HASH` | dev-креденшлы Telegram-приложения (можно задать и в UI: Настройки → Advanced API) |
| `SESSION_STRING` | dev-сессия (не коммитить) |
| `GEMINI_API_KEY` | ключ Gemini для dev (основной путь — хранение через safeStorage в UI) |
| `GEMINI_MODEL` | переопределение модели (по умолчанию `gemini-3.6-flash`) |

`.env` читается только в development-режиме (`!app.isPackaged`).

---

## 7. CI

- `.github/workflows/static.yml` — деплой статического сайта
  на GitHub Pages (ветка `master`, каталог `./website`).
- Сборки desktop-релизов сопровождаются electron-builder-таргетами
  из `package.json` (см. [Архитектура §7](architecture.md#7-сборка-и-упаковка)).

---

## 8. Стиль кода

- ESLint-конфиг: `eslint.config.js` (eslint-plugin-react-hooks,
  react-refresh, typescript-eslint).
- Типы: `tsconfig.app.json` (рендерер), `tsconfig.node.json` (Vite),
  `tsconfig.json` — solution.
- CommonJS (`.cjs`) — main-процесс и модули, импортируемые из него;
  ESM + TS — рендерер и Studio.

---

## 9. Смежные документы

- [Архитектура](architecture.md)
- [Справочник IPC](ipc-reference.md)
- [Безопасность](security.md)

