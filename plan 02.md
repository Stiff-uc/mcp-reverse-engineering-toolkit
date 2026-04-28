# Plan: Reverse-Engineering Platform (MCP Proxy + JS Agent)

## 1. Project Overview

Исследовательская платформа для реверс-инжиниринга веб-сайтов через ИИ-агента. Состоит из двух компонентов:

- **MCP Proxy** — Node.js приложение, выступающее MCP-сервером (транспорт: Streamable HTTP) для ИИ-агента и WebSocket-сервером для JS-агента в браузере.
- **JS Agent** — внедряемый в браузер код, подключающийся к MCP Proxy через WebSocket и выполняющий команды ИИ-агента в рантайме веб-сайта.

## 2. Technology Choices (согласовано с пользователем)

| Компонент | Выбор | Причина |
|-----------|-------|---------|
| Язык | JavaScript (ES modules) | Быстрый старт, без шага сборки |
| MCP транспорт | Streamable HTTP | Удаленное использование, гибкость |
| WebSocket | `ws` библиотека | Легковесная, без лишних зависимостей |
| MCP SDK | `@modelcontextprotocol/sdk` v1 | Стабильный, документированный |
| Связь с браузером | WebSocket напрямую | Простота прототипирования |
| Тестирование | Vitest | Быстрый, совместим с ESM |
| Формат агента | `AGENTS.md` (uppercase) | Требование Kilo CLI |

## 3. Project Structure

```
mcp-reverse-engineering/
├── package.json
├── AGENTS.md                          # Правила для ИИ-агента
├── docs/
│   └── architecture.md                # Документация архитектуры
├── src/
│   ├── mcp-proxy/
│   │   ├── index.js                   # Точка входа MCP-сервера
│   │   ├── server.js                  # MCP сервер (инструменты)
│   │   ├── websocket-bridge.js        # WebSocket сервер + мост к MCP
│   │   ├── tools/
│   │   │   ├── read-dom.js            # Инструмент: чтение DOM
│   │   │   ├── execute-js.js          # Инструмент: выполнение JS
│   │   │   ├── get-context.js         # Инструмент: получение данных JS-агента
│   │   │   └── update-agent.js        # Инструмент: самообновление JS-агента
│   │   └── config.js                  # Конфигурация (порты, настройки)
│   └── js-agent/
│       ├── index.js                   # Точка входа JS-агента (внедряемый скрипт)
│       ├── connection.js              # WebSocket клиент для связи с MCP Proxy
│       ├── command-handler.js         # Обработка команд от MCP Proxy
│       ├── executor.js                # Безопасное выполнение JS с обработкой ошибок
│       └── self-update.js             # Механизм самообновления кода агента
├── tests/
│   ├── mcp-proxy/
│   │   ├── server.test.js
│   │   └── websocket-bridge.test.js
│   └── js-agent/
│       ├── executor.test.js
│       └── command-handler.test.js
└── scripts/
    └── start.js                       # Скрипт запуска MCP Proxy
```

## 4. Agent Definitions (субагенты для разработки)

### 4.1. Sub-agent: "mcp-proxy" — Разработка MCP Proxy

**Назначение:** Разработать первый компонент — MCP Proxy (Node.js приложение), которое является одновременно MCP-сервером (Streamable HTTP) и WebSocket-сервером для JS-агента.

**Артефакты для субагента:**
- `package.json` — зависимости: `@modelcontextprotocol/sdk`, `ws`, настройки ESM
- `src/mcp-proxy/index.js` — точка входа: запуск HTTP-сервера, инициализация MCP и WebSocket
- `src/mcp-proxy/server.js` — MCP-сервер с регистрацией инструментов (read-dom, execute-js, get-context, update-agent)
- `src/mcp-proxy/websocket-bridge.js` — WebSocket-сервер: прием подключений от JS-агента, ретрансляция сообщений между MCP инструментами и JS-агентом
- `src/mcp-proxy/tools/*.js` — 4 инструмента MCP. Каждый инструмент при вызове отправляет запрос через WebSocket JS-агенту, ждет ответа (или таймаута) и возвращает результат ИИ-агенту
- `scripts/start.js` — скрипт запуска

**MCP Tools Specification:**

1. **read-dom** (selector?, timeout?)
   - Отправляет JS-агенту команду `READ_DOM` с селектором
   - JS-агент возвращает outerHTML выбранных элементов
   - Параметры: selector (string, optional — если пусто, весь document.body), timeout (number, default 5000)

2. **execute-js** (code: string)
   - Отправляет JS-агенту команду `EXECUTE_JS` с кодом
   - JS-агент выполняет код в try/catch, возвращает результат или ошибку с трассировкой (stack trace)
   - Параметры: code (string, обязательный)

3. **get-context** (keys?: string[])
   - Отправляет JS-агенту команду `GET_CONTEXT`
   - JS-агент возвращает заранее собранные данные: URL, заголовки, cookies, localStorage keys, глобальные переменные
   - Параметры: keys (array of strings, optional — фильтр запрашиваемых данных)

4. **update-agent** (code?: string)
   - Если code передан — заменяет текущий код JS-агента на новый (самообновление)
   - Если code пуст — возвращает текущую версию агента (semver)
   - После обновления JS-агент перезапускает WebSocket-соединение

**Wire Protocol (MCP Proxy ↔ JS Agent):**
```json
// Запрос от MCP Proxy к JS-агенту
{
  "type": "request",
  "id": "uuid",
  "command": "READ_DOM | EXECUTE_JS | GET_CONTEXT | UPDATE_AGENT",
  "params": {}
}

// Ответ от JS-агента
{
  "type": "response",
  "id": "uuid",
  "result": {},
  "error": {
    "message": "",
    "stack": ""
  }
}

// Ping/Pong для keepalive
{ "type": "ping" }
{ "type": "pong" }
```

### 4.2. Sub-agent: "js-agent" — Разработка JS-агента

**Назначение:** Разработать JS-агент — внедряемый в браузер скрипт, который подключается к MCP Proxy через WebSocket и выполняет команды.

**Артефакты для субагента:**
- `src/js-agent/index.js` — точка входа: авто-подключение к WebSocket, регистрация обработчиков, pong на ping
- `src/js-agent/connection.js` — WebSocket клиент: коннект, реконнект (с exponential backoff), обработка разрыва, отправка/получение
- `src/js-agent/command-handler.js` — диспетчер команд: READ_DOM, EXECUTE_JS, GET_CONTEXT, UPDATE_AGENT — маршрутизация к соответствующим обработчикам
- `src/js-agent/executor.js` — безопасное выполнение JS: try/catch + async error handling, таймауты, сбор stack trace
- `src/js-agent/self-update.js` — самообновление: замена текущего кода на новый, перезапуск WebSocket, проверка версии

**Key requirements:**
- Абсолютная устойчивость к ошибкам: любой JS выполняется внутри try/catch, ошибки с полным stack trace возвращаются через WebSocket
- Самообновление: после получения UPDATE_AGENT с новым кодом, агент eval'ит новый код и переподключается
- Keepalive: ping/pong каждые 30 секунд, reconnect при разрыве (exponential backoff: 1s, 2s, 4s... до 60s)
- Минимальный размер: агент должен быть компактным (встраивается в страницу)

## 5. AGENTS.md Content (для корня проекта)

Файл `AGENTS.md` будет содержать:
- Общее описание проекта
- Правила разработки (ES modules, JavaScript, Vitest, no TypeScript)
- Соглашения по коду (наименования, стиль, обработка ошибок)
- Архитектура проекта (описание двух компонентов и wire protocol)
- Процесс разработки: Task -> Lint -> Test -> Verify

## 6. Implementation Order

1. **MCP Proxy** — первым делом, так как он центральный компонент
   1.1. package.json + project scaffolding
   1.2. MCP server (server.js) — создание MCP-сервера с пустыми инструментами
   1.3. WebSocket bridge — сервер, прием подключений, wire protocol
   1.4. MCP Tools — реализация 4 инструментов с коммуникацией через WS
   1.5. Config, start script, error handling
   1.6. Тесты базового функционала

2. **JS Agent** — после MCP Proxy, либо параллельно
   2.1. WebSocket client + connection management
   2.2. Command handler + request/response protocol
   2.3. Executor (безопасный eval)
   2.4. Self-update mechanism
   2.5. Тесты

3. **Integration** — проверка связки
   3.1. E2E тест: MCP Proxy + Mock JS Agent
   3.2. E2E тест: MCP Proxy + реальный браузер (playwright или puppeteer) с внедренным JS-агентом

## 7. Вопросы к пользователю

*(вопросы заданы ранее, получены ответы)*

## 8. Критерии приемки

- [ ] MCP Proxy запускается и регистрирует 4 инструмента
- [ ] JS-агент подключается к MCP Proxy через WebSocket
- [ ] Инструмент read-dom возвращает DOM страницы из браузера
- [ ] Инструмент execute-js выполняет JS в браузере и возвращает результат
- [ ] Ошибки выполнения JS возвращаются с полным stack trace
- [ ] Инструмент get-context возвращает данные из браузера
- [ ] Инструмент update-agent обновляет код JS-агента
- [ ] Все компоненты покрыты тестами (Vitest)
- [ ] JS-агент устойчив к разрыву соединения (reconnect)