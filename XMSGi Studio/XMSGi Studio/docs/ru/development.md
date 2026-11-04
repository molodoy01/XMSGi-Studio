# Разработка и сборка XMSGi Studio

Инструкции для контрибьюторов и разработчиков.
Соответствует версии **1.3.6**.

---

## 1. Требования

- **Node.js 20+** и npm
- Git
- Windows для портативной desktop-сборки (остальные платформы собираются
  через electron-builder)
- Studio входит в renderer основного приложения и использует его зависимости.

---

## 2. Структура репозитория

```
XMSGi Studio/
├── main.cjs                  # Electron main: окно, Tray, IPC, валидация
├── preload.cjs               # contextBridge: window.telegram/draftStorage
├── ipc-security.cjs          # валидация всех IPC-payload
├── telegram.cjs              # ядро Telegram (teleproto, MTProto)
├── telegram-*.cjs            # lifecycle, errors, storage, search,
│                             # permissions, idempotency, dialogs, rate-limit
├── draft-store.cjs           # черновики: атомарная запись, бэкапы, вложения
├── schedule-history.cjs      # нормализация/валидация истории планирования
├── chat-storage.cjs          # список чатов (избранное, скрытые)
├── app-data-path.cjs         # корень данных приложения + миграция имён
├── src/                      # рендерер-хост (React + TS)
│   ├── App.tsx               # маршруты, Quick Planner/Studio, runtime composition
│   ├── appState.ts           # reducer сообщения, действия и операций приложения
│   ├── pages/                # LoginPage, SettingsPage
│   ├── components/           # QuickPlanner, ChatPicker, SettingsView…
│   ├── hooks/                # useTelegramAuth, useChats, useScheduler…
│   ├── lib/                  # scheduling, richText, plannerDraft, i18n…
│   ├── services/             # chatDomainService, adapters
│   ├── workspace/            # AppShell, StudioMount, HistoryDrawer
│   └── studio/               # Studio UI, hooks, services, repositories
├── packages/shared/          # общий код хоста и Studio
│   ├── bridge/               # версионированный контракт моста (v1)
│   ├── i18n/                 # переводы en/ru
│   ├── types/, utils/
│   └── telegramText.cjs      # rich-text утилиты для main-процесса
├── docs/                     # эта документация
├── *.test.mjs, *.test.tsx    # тесты Vitest (main и renderer)
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
| `npm run start` | запуск Electron-оболочки (предварительно соберите renderer через `npm run build`) |
| `npm test` | прогон всех тестов (Vitest, `vitest run`) |
| `npm run lint` | ESLint по всему проекту |
| `npm run typecheck` | TypeScript-проверка (`tsconfig.app.json`) |
| `npm run dev:electron` | Vite + Electron в режиме разработки |
| `npm run dist` | `build` + `electron-builder --win` (портативный `.exe`) |
| `npm run preview` | предпросмотр production-сборки Vite |

### Проверки Studio

```bash
npm run typecheck
npm test -- src/studio
npm run build
```

---

## 4. Тесты

- Фреймворк: **Vitest** (+ Testing Library для React, jsdom).
- Конфиг: `vitest.config.ts` — те же алиасы, что в `vite.config.ts`
  (`@/`, `@studio/`, `@shared/`).
- Покрытие включает:
  - main-модули (`*.test.mjs` в корне): IPC-безопасность, lifecycle
    Telegram, идемпотентность планирования, rate-limit, storage,
    миграции истории, packaging;
  - рендерер (`*.test.tsx` в `src/`): хуки, страницы, компоненты;
  - Studio renderer (`src/studio/`).
- Результат полного пререлизного прогона v1.3.0: **1065 из 1065 тестов пройдены,
  0 ошибок и 0 пропусков**. Также успешно выполнены `npm run typecheck` и
  `git diff --check`.
- Отчёты прогона в репозиторий не коммитятся (см. `.gitignore`).
  При необходимости сохраните JSON-отчёт вручную:
  `npx vitest run --reporter=json --outputFile=vitest-report.json`.

Рекомендуемый порядок перед PR:

```bash
npm test
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

1. **Quick Planner и Studio используют разные scheduler scopes.** Хост
  `useScheduler` обслуживает personal flow Quick Planner и workspace flow
  встроенной Studio. `useStudioScheduler` — standalone fallback для запуска
  Studio без host runtime. При изменении планирования проверяйте оба пути;
  не подменяйте host runtime fallback-планировщиком.
2. **Черновики связаны на уровне workflow, не файла хранения.** Planner autosave
  и коллекция быстрых черновиков находятся в `src/lib/plannerDraft.ts` и
  используют `localStorage`; документы Studio управляются `useStudioDrafts`
  через `window.draftStorage`. `HistoryDrawer` объединяет обе коллекции, а
  Planner payload можно передать в Studio.
3. **Контракт моста версионирован.** При изменении
   `packages/shared/bridge/` поднимайте осознанно
   `BRIDGE_PROTOCOL_VERSION` и обновляйте обе стороны.
4. **Каждый новый IPC-канал** обязан иметь проверку
   `assertTrustedRenderer`/`assertDraftStorageRenderer` и валидацию
   payload в `ipc-security.cjs` + тест в `ipc-security.test.mjs`.
5. **Миграции данных.** Файлы в userData переименованы
   из `awaitmsg-*` в `xmsgi-studio-*`; миграция —
   `app-data-path.cjs` (автоперименование legacy-файла).
  Схема Studio draft store версионируется константой
  `DRAFT_STORE_SCHEMA_VERSION` в `src/studio/lib/draftStoreVersion.ts`.

---

## 6. Переменные окружения

Файл `.env` (в Git и в сборку не попадает):

| Переменная | Назначение |
|---|---|
| `API_ID`, `API_HASH` | dev-креденшлы Telegram-приложения (можно задать и в UI: Настройки → Advanced API) |
| `SESSION_STRING` | dev-сессия (не коммитить) |

`.env` читается только в development-режиме (`!app.isPackaged`).

---

## 7. CI

CI описан в `.github/workflows/` (дерево репозитория — оболочка, приложение в
подкаталоге `XMSGi Studio/`).

- `.github/workflows/release-check.yml` — lint, typecheck и полный набор тестов
  на push в `main`, на PR и вручную. Артефакты релиза не публикует.
- `.github/workflows/release.yml` — авто-релиз desktop-приложения. Срабатывает
  **только по тегу вида `v*`** (или вручную через `workflow_dispatch`), собирает
  артефакты для Windows/Linux/macOS через electron-builder и публикует их в
  GitHub Release для этого тега — Release создаётся автоматически, если его ещё
  нет (`softprops/action-gh-release`). Перед matrix-сборками этот workflow
  выполняет `npm ci`, lint, typecheck и полный test suite; при ошибке проверок
  сборка и публикация не запускаются. Сам тег создаётся и пушится локально:
  `git tag v1.3.0 && git push origin v1.3.0`.
- `.github/workflows/static.yml` — деплой статического сайта на GitHub Pages
  (ветка `main`, каталог `XMSGi Studio/website`).

Сборки desktop-релизов используют electron-builder-таргеты из `package.json`
(см. [Архитектура §7](architecture.md#7-сборка-и-упаковка)).

macOS-релизы выпускаются без подписи и notarization; для первого запуска
пользователю нужно вручную разрешить приложение в настройках безопасности macOS.

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
