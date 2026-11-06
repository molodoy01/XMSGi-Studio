# Разработка и сборка XMSGi Studio

Инструкции для контрибьюторов и разработчиков.
Соответствует версии **1.4.1**.
Пути к исходникам в этом документе указаны относительно `app/`, если не указан
корень репозитория.

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
├── .github/                  # GitHub Actions workflows
├── app/                      # всё приложение и его npm-конфигурация
│   ├── main.cjs              # Electron main: окно, Tray, IPC, валидация
│   ├── preload.cjs           # contextBridge: window.telegram/draftStorage
│   ├── ipc-security.cjs      # валидация всех IPC-payload
│   ├── telegram*.cjs         # ядро Telegram и вспомогательные модули
│   ├── src/                  # React + TypeScript renderer и Studio
│   ├── packages/shared/      # общий код, типы, i18n и bridge
│   ├── public/               # статические ресурсы
│   ├── *.test.*              # main- и renderer-тесты
│   └── package.json          # скрипты и конфиг electron-builder
├── docs/                     # документация
├── screenshots/              # скриншоты приложения
├── website/                  # сайт продукта
├── README.md
├── CHANGELOG.md
├── CONTRIBUTING.md
├── LICENSE
└── SECURITY.md
```

---

## 3. Команды

| Команда | Назначение |
|---|---|
| `npm install --prefix app` | установка зависимостей |
| `npm --prefix app run dev` | Vite dev-сервер (рендерер) |
| `npm --prefix app run build` | production-сборка рендерера в `app/dist/` |
| `npm --prefix app run electron` | запуск Electron-оболочки (нужен build) |
| `npm --prefix app run start` | запуск Electron-оболочки (предварительно соберите renderer) |
| `npm --prefix app test` | прогон всех тестов (Vitest, `vitest run`) |
| `npm --prefix app run lint` | ESLint по всему приложению |
| `npm --prefix app run typecheck` | TypeScript-проверка (`tsconfig.app.json`) |
| `npm --prefix app run dev:electron` | Vite + Electron в режиме разработки |
| `npm --prefix app run dist` | `build` + `electron-builder --win` (портативный `.exe`) |
| `npm --prefix app run preview` | предпросмотр production-сборки Vite |

### Проверки Studio

```bash
npm --prefix app run typecheck
npm --prefix app test -- src/studio
npm --prefix app run build
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
  `npm --prefix app exec -- vitest run --reporter=json --outputFile=vitest-report.json`.

Рекомендуемый порядок перед PR:

```bash
npm --prefix app test
npm --prefix app run lint
npm --prefix app run typecheck
npm --prefix app run build
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

CI описан в `.github/workflows/`; workflow запускает проверки и сборку из
подкаталога `app/`.

- `.github/workflows/release-check.yml` — lint, typecheck и полный набор тестов
  на push в `main`, на PR и вручную. Артефакты релиза не публикует.
- `.github/workflows/release.yml` — авто-релиз desktop-приложения. Срабатывает
  **только по тегу вида `v*`** (или вручную через `workflow_dispatch`), собирает
  артефакты для Windows/Linux/macOS через electron-builder и публикует их в
  GitHub Release для этого тега — Release создаётся автоматически, если его ещё
  нет (`softprops/action-gh-release`). Перед matrix-сборками этот workflow
  выполняет `npm ci`, lint, typecheck и полный test suite; при ошибке проверок
  сборка и публикация не запускаются. Сам тег создаётся и пушится локально:
  `git tag v1.4.1 && git push origin v1.4.1`.
- `.github/workflows/static.yml` — деплой статического сайта на GitHub Pages
  (ветка `main`, каталог `website`).

Сборки desktop-релизов используют electron-builder-таргеты из `app/package.json`
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
