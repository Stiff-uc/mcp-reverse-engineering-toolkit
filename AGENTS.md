# mcp-reverse-engineering-toolkit

Платформа для реверс-инжиниринга веб-сайтов через ИИ-агентов. Состоит из двух компонентов:

- **MCP Proxy** — Node.js приложение, выступающее MCP-сервером (Streamable HTTP) для ИИ-агента и WebSocket-сервером для JS-агента в браузере.
- **JS Agent** — внедряемый в браузер скрипт, подключающийся к MCP Proxy через WebSocket и выполняющий команды ИИ-агента в рантайме веб-сайта.

---

## 1. Режимы работы

Проект имеет **два режима**, которые определяют, что ИИ-агент может и не может делать.

### 1.1. Core Development (Разработка ядра)

**Разрешено:** модифицировать файлы в `src/`, `tests/`, `scripts/`, корневые конфиги (package.json, AGENTS.md, .gitignore).

**Цель:** разработка и доработка фреймворка (MCP Proxy + JS Agent).

**Правила:**
- Весь код в `src/` должен быть покрыт тестами в `tests/` (минимум 80%)
- После изменений запускать `npm test`
- После изменений в `src/js-agent/` пересобрать bundle: `npm run build:agent`
- Следовать Code Style (раздел 3)

### 1.2. Study Mode (Режим исследования)

**Разрешено:** создавать и модифицировать файлы только внутри `study/<project-name>/`.

**ЗАПРЕЩЕНО:**
- Модифицировать любые файлы в `src/`, `tests/`, `scripts/`
- Модифицировать корневые конфиги: `package.json`, `AGENTS.md`, `.gitignore`, `kilo.json`, файлы в `.kilo/`

**Исключение:** если в процессе исследования обнаружена необходимость доработки ядра — это оформляется как отдельная задача на Core Development.

---

## 2. Study Mode — полный workflow для ИИ-агента исследования

### 2.1. Начало исследования

Когда пользователь просит исследовать веб-сайт, ИИ-агент должен:

1. **Убедиться что MCP Proxy запущен** — выполнить `GET http://localhost:3100/health` (через webfetch или curl). Ожидаемый ответ: `{ "status": "ok", "wsClients": <number>, "version": "0.1.0" }`. Если сервер не отвечает — попросить пользователя открыть терминал, перейти в папку проекта и выполнить `npm start`.
2. **Убедиться что JS-агент подключен** — проверить что `wsClients > 0` в ответе health. Если `wsClients === 0` — попросить пользователя открыть консоль браузера (F12) на целевом сайте, скопировать код из `dist/js-agent-bundle.js` и вставить в консоль.
3. **Создать папку исследования** — `study/<project-name>/` (имя на основе URL: `study/example-com/` для `https://example.com`).
4. **Начать сбор данных** через MCP-инструменты, следуя шагам 2.3.

### 2.2. MCP-инструменты — детальное описание

#### read-dom (selector?, timeout?)
Читает DOM страницы. Самый частый инструмент.

| Параметр | Тип | Обязательный | По умолчанию | Описание |
|----------|-----|:---:|:---:|----------|
| selector | string | нет | весь документ | CSS-селектор для фильтрации элементов |
| timeout | number | нет | 5000 | Максимальное время ожидания (мс) |

**Примеры запросов (как их делает ИИ-агент):**

```
// Прочитать весь DOM
read-dom

// Прочитать конкретный элемент
read-dom selector="#main-content"

// Прочитать список
read-dom selector="div.product-card"
```

**Возвращает:** HTML-строку выбранных элементов.

**Важно:** DOM может быть очень большим. Начинайте с селекторов для конкретных частей страницы, не читайте весь DOM без необходимости.

#### execute-js (code: string)
Выполняет произвольный JavaScript код в контексте страницы.

| Параметр | Тип | Обязательный | Описание |
|----------|-----|:---:|----------|
| code | string | да | JavaScript код для выполнения |

**Примеры запросов:**

```
// Проверить глобальные переменные
execute-js code="Object.keys(window).filter(k => k.startsWith('__'))"

// Получить данные из React-компонента
execute-js code="document.querySelector('#root').__reactFiber$*"

// Изменить что-то на странице
execute-js code="document.querySelector('.paywall').remove()"

// Прочитать fetch-ответы
execute-js code="performance.getEntriesByType('resource').map(e => e.name)"
```

**Возвращает:** JSON-представление результата выполнения. Если код вернул undefined — вернется null. Ошибки возвращаются с полным stack trace.

**Обработка ошибок:** Любые ошибки JS (синтаксические, runtime, таймаут) возвращаются с сообщением и stack trace. ИИ-агент должен анализировать ошибки и корректировать код.

#### get-context (keys?)
Получает контекстные данные о странице от JS-агента.

| Параметр | Тип | Обязательный | По умолчанию | Описание |
|----------|-----|:---:|:---:|----------|
| keys | string[] | нет | все ключи | Фильтр запрашиваемых данных |

**Доступные ключи:**
- `url` — текущий URL страницы
- `title` — заголовок страницы
- `cookies` — cookies страницы
- `userAgent` — User-Agent браузера
- `localStorage` — содержимое localStorage

**Примеры запросов:**

```
// Получить всё
get-context

// Получить только URL и cookies
get-context keys=["url", "cookies"]
```

#### update-agent (code?)
Обновляет код JS-агента (самообновление) или возвращает версию.

| Параметр | Тип | Обязательный | Описание |
|----------|-----|:---:|----------|
| code | string | нет | Новый код JS-агента |

**Примеры запросов:**

```
// Проверить версию
update-agent

// Обновить агента (code — полный новый bundle)
update-agent code="(function() { /* новый код агента */ })()"
```

### 2.3. Типовой порядок исследования

При исследовании нового сайта ИИ-агент должен следовать этому протоколу:

**Шаг 1: Получить контекст**
```
get-context
```
Узнать URL, заголовок, User-Agent.

**Шаг 2: Изучить структуру страницы**
```
read-dom selector="head"
read-dom selector="body"
```
Начать с общей структуры, затем углубляться селекторами.

**Шаг 3: Исследовать ключевые компоненты**
```
read-dom selector=".main-content, #app, [data-page]"
```
Использовать execute-js для поиска интересных элементов:
```
execute-js code="document.querySelectorAll('[class*=\"price\"], [class*=\"product\"], [data-testid]').length"
```

**Шаг 4: Анализировать JS-окружение**
```
execute-js code="Object.keys(window).filter(k => typeof window[k] === 'function' && k[0] !== k[0]?.toLowerCase())"
```
Проверять глобальные переменные, фреймворки (React, Vue, Angular), API-эндпоинты.

**Шаг 5: Взаимодействовать со страницей**
```
execute-js code="document.querySelector('button.submit').click()"
```
После действий — повторно читать DOM чтобы увидеть изменения.

**Шаг 6: Сохранять артефакты**
Все найденные данные, снимки DOM, скрипты сохранять в `study/<project-name>/`.

### 2.4. Правила работы с execute-js

- **Код должен быть небольшим и целенаправленным** — не пишите большие скрипты, лучше несколько маленьких запросов
- **Используйте самодостаточные IIFE** — оборачивайте сложный код в `(function() { ... })()`
- **Не мутируйте страницу без необходимости** — если нужно только прочитать данные, не меняйте DOM
- **Если нужно изменить страницу** (например, убрать блокировку) — делайте это осознанно, сообщите пользователю
- **Всегда предусматривайте ошибки** — проверяйте существование элементов перед доступом к ним

### 2.5. Правила складирования артефактов

Все артефакты исследования складываются в `study/<project-name>/`:

```
study/<project-name>/
├── README.md              # Описание исследования
├── dom-snapshots/         # Снимки DOM в разные моменты
│   ├── 01-initial.html
│   └── 02-after-click.html
├── scripts/               # Полезные скрипты для сайта
│   └── extract-data.js
├── notes/                 # Заметки и наблюдения
│   └── api-endpoints.md
└── results/               # Итоговые результаты
    └── extracted-data.json
```

---

## 3. Архитектура

```
┌─────────────────┐     Streamable HTTP      ┌─────────────────────┐
│   ИИ-агент       │ ◄──────────────────────► │   MCP Proxy         │
│  (VS Code + Kilo)│                          │  (Node.js)          │
└─────────────────┘                           │  - MCP server       │
                                              │  - WS server        │
                                              └───────┬─────────────┘
                                                      │ WebSocket
                                              ┌───────▼─────────────┐
                                              │   JS Agent          │
                                              │  (в браузере)       │
                                              └─────────────────────┘
```

### 3.1. MCP Proxy (`src/mcp-proxy/`)

MCP-сервер с транспортом Streamable HTTP + встроенный WebSocket-сервер.

**Инструменты MCP:**
| Инструмент | Описание |
|-----------|----------|
| `read-dom` | Прочитать DOM страницы (с опциональным CSS-селектором) |
| `execute-js` | Выполнить произвольный JS в контексте страницы |
| `get-context` | Получить данные от JS-агента (URL, cookies, localStorage и т.д.) |
| `update-agent` | Обновить код JS-агента (самообновление) или получить версию |

### 3.2. JS Agent (`src/js-agent/`, собрано в `dist/js-agent-bundle.js`)

Внедряемый в браузер скрипт. Подключается к MCP Proxy через WebSocket, выполняет команды.

**Возможности:**
- Подключение / переподключение с exponential backoff (1s → 2s → 4s → ... → 60s)
- Безопасное выполнение JS (try/catch + stack trace + таймауты)
- Самообновление через команду UPDATE_AGENT
- Keepalive (ping/pong каждые 30s)

### 3.3. Wire Protocol

Сообщения передаются как JSON-строки через WebSocket.

```json
{ "type": "request", "id": "uuid", "command": "READ_DOM", "params": { "selector": "body" } }
{ "type": "response", "id": "uuid", "result": "<html>...</html>", "error": null }
{ "type": "response", "id": "uuid", "result": null, "error": { "message": "...", "stack": "..." } }
{ "type": "ping" }
{ "type": "pong" }
```

---

## 4. Структура проекта

```
mcp-reverse-engineering-toolkit/
├── AGENTS.md               # Правила для ИИ-агента
├── SETUP.md                # Инструкция для пользователя (не-программиста)
├── package.json
├── .gitignore
├── dist/
│   └── js-agent-bundle.js  # Готовый JS-агент (копировать в консоль)
├── src/
│   ├── mcp-proxy/          # MCP Proxy (Node.js)
│   │   ├── index.js
│   │   ├── websocket-bridge.js
│   │   ├── config.js
│   │   └── tools/
│   │       ├── read-dom.js
│   │       ├── execute-js.js
│   │       ├── get-context.js
│   │       └── update-agent.js
│   └── js-agent/           # JS Agent исходники (ES modules)
│       ├── index.js
│       ├── connection.js
│       ├── command-handler.js
│       ├── executor.js
│       └── self-update.js
├── tests/
│   ├── mcp-proxy/
│   │   └── websocket-bridge.test.js
│   └── js-agent/
│       ├── executor.test.js
│       └── command-handler.test.js
├── scripts/
│   ├── start.js            # Запуск MCP Proxy
│   └── build-agent.js      # Сборка JS-агента в bundle
└── study/                  # Артефакты исследований (.gitignore)
    └── .gitkeep
```

---

## 5. Code Style

- **Язык:** JavaScript (ES modules), без TypeScript
- **Импорты:** ES modules (`import`/`export`), без CommonJS (`require`)
- **Отступы:** 2 пробела
- **Асинхронность:** async/await, без callback-стиля
- **Обработка ошибок:** try/catch на всех границах (сеть, eval, IO)
- **Комментарии:** НЕ писать комментарии в коде. Код должен быть самодокументируемым
- **Наименования:**
  - Файлы: lowerCamelCase.js (кроме точек входа index.js)
  - Директории: kebab-case
  - Функции: lowerCamelCase
  - Константы: UPPER_SNAKE_CASE
  - Классы: UpperCamelCase
- **Длина строки:** не более 100 символов
- **Строгий режим:** "use strict" (автоматически через ESM)

---

## 6. Тестирование

- **Фреймворк:** Vitest
- **Структура:** `tests/<module>/<file>.test.js` — зеркалит `src/<module>/<file>.js`
- **Покрытие:** минимум 80% для ядра (`src/`)
- **Запуск:** `npm test`
- **Watch mode:** `npm run test:watch`

---

## 7. Безопасность

- `.gitignore` включает `study/*` — артефакты исследований не попадают в репозиторий
- `.env` в `.gitignore` — никаких secrets в коде
- JS-агент выполняется в браузере пользователя — нет доступа к файловой системе
- Выполнение произвольного JS в executor.js всегда обернуто в try/catch
- WebSocket соединения ограничены localhost по умолчанию

---

## 8. Зависимости

**Runtime:**
- `@modelcontextprotocol/sdk` — MCP сервер
- `ws` — WebSocket сервер + клиент
- `express` — HTTP сервер для Streamable HTTP транспорта

**Dev:**
- `vitest` — тестирование

---

## 9. Скрипты

```bash
npm start              # Запуск MCP Proxy (порт 3100)
npm test               # Запуск тестов
npm run build:agent    # Сборка JS-агента в dist/js-agent-bundle.js
```