# SecondBrain MCP

Safe MCP-сервер для Obsidian vault. Даёт AI-ассистентам (Claude, ChatGPT и др.) семантический доступ к заметкам, проектам, решениям и задачам, а также безопасные операции создания и подтверждённого редактирования.

## Что умеет

Вместо сырого доступа к файлам предоставляет структурированные инструменты:

| Tool | Описание |
|------|----------|
| `healthcheck` | Статус vault и статистика |
| `search_knowledge` | Полнотекстовый поиск + фильтры по frontmatter |
| `get_note` | Чтение заметки по пути или имени |
| `list_notes` | Список заметок с метаданными, `mtime`, `size`, `hash`, фильтрами и пагинацией |
| `read_notes_batch` | Batch-чтение нескольких заметок для сборки LLM-контекста |
| `get_note_metadata` | Метаданные заметки: frontmatter, hash, links, backlinks, tags, line count |
| `validate_vault_path` | Проверка безопасности пути для чтения или записи |
| `create_note` | Создание новой markdown-заметки с YAML-frontmatter |
| `propose_note_update` | Подготовка diff без записи файла |
| `apply_note_update` | Применение подтверждённой правки с `expected_hash` |
| `append_to_note` | Добавление блока в заметку или секцию |
| `read_agent_memory` | Чтение памяти агента из `00_Meta/AI-System` |
| `add_agent_memory` | Добавление правила, ошибки, примера, проекта, роли или стиля в память агента |
| `list_projects` | Список проектов с фильтром по статусу |
| `get_project_context` | Полный контекст проекта: содержимое + связи + задачи + решения |
| `find_related` | Связанные заметки через wikilinks, backlinks, общие теги |
| `extract_tasks` | Открытые/завершённые задачи из vault или папки |
| `extract_decisions` | Записи из журнала решений |

## Safe-write контракт

MCP v0.3 поддерживает запись, но не даёт агенту тихо перезаписывать vault.

1. Клиент получает `hash` через `list_notes` или `get_note_metadata`.
2. Клиент вызывает `propose_note_update` и показывает пользователю diff.
3. Пользователь подтверждает изменение в UI.
4. Клиент вызывает `apply_note_update` с `confirmed: true` и тем же `expected_hash`.
5. Если файл изменился между шагами, MCP вернёт ошибку hash mismatch.

Все операции записи проходят `validate_vault_path`. Запрещены абсолютные пути, выход за пределы vault, запись не-`.md` файлов и доступ к исключённым папкам.

Память агента хранится в:

```txt
00_Meta/AI-System/
  role.md
  rules.md
  style.md
  projects.md
  mistakes.md
  examples.md
```

Для `second-brain-vault` действует соглашение: новые заметки должны иметь YAML-frontmatter, поля `type`, `status`, `created`, `updated`, `tags`, `aliases`, `related`, а `related` должен ссылаться хотя бы на один MOC.

## Поиск v0.3

`search_knowledge` теперь использует ранжирование по нескольким полям:

- `title` и имя файла;
- `aliases`;
- `tags`;
- `related`;
- markdown content.

Запрос нормализуется по пробелам, дефисам, `/`, `_` и wikilink-синтаксису, поэтому `AI Sprint` может находить `AI-Sprint`, `ai/sprint` и `[[AI Sprint]]`. В ответе есть `score`, `matches` и `snippet`, чтобы UI мог показать, почему заметка попала в выдачу.

Рекомендуемый flow для приложения:

```txt
search_knowledge
→ read_notes_batch top-K
→ find_related / get_note_metadata при необходимости
→ LLM context builder
```

## Установка

```bash
git clone <repo-url> && cd sb-mcp
npm install
npm run build
npm test
```

## Запуск

### Stdio (локально, один клиент)

```bash
OBSIDIAN_VAULT_PATH=/path/to/vault node dist/index.js
```

### HTTP (удалённо, несколько клиентов)

```bash
OBSIDIAN_VAULT_PATH=/path/to/vault \
MCP_AUTH_TOKEN=your-secret-token \
MCP_PORT=3100 \
node dist/index.js --http
```

## Аутентификация

В HTTP-режиме задайте переменную `MCP_AUTH_TOKEN` для защиты доступа. Токен можно передать двумя способами:

**1. Заголовок Authorization** — для клиентов с поддержкой кастомных заголовков (Claude Code, API-клиенты):
```
Authorization: Bearer your-secret-token
```

**2. Query-параметр** — для клиентов без поддержки заголовков (Claude.ai, ChatGPT):
```
https://your-server/mcp?token=your-secret-token
```

Если `MCP_AUTH_TOKEN` не задан, сервер работает без аутентификации (не рекомендуется для публичных сетей).

Сгенерировать токен:
```bash
openssl rand -hex 32
```

## Переменные окружения

| Переменная | По умолчанию | Описание |
|------------|-------------|----------|
| `OBSIDIAN_VAULT_PATH` | текущая директория | Путь к Obsidian vault |
| `MCP_TRANSPORT` | `stdio` | Режим транспорта: `stdio` или `http` |
| `MCP_PORT` | `3100` | Порт HTTP-сервера |
| `MCP_AUTH_TOKEN` | — | Токен для аутентификации в HTTP-режиме |

## Настройка клиентов

### Claude Code (`.mcp.json`)

**Stdio (локально):**
```json
{
  "mcpServers": {
    "secondbrain": {
      "command": "node",
      "args": ["/path/to/sb-mcp/dist/index.js"],
      "env": {
        "OBSIDIAN_VAULT_PATH": "/path/to/vault"
      }
    }
  }
}
```

**HTTP (удалённо):**
```json
{
  "mcpServers": {
    "secondbrain": {
      "type": "url",
      "url": "https://your-server/mcp",
      "headers": {
        "Authorization": "Bearer your-secret-token"
      }
    }
  }
}
```

### Claude.ai / ChatGPT

Используйте URL с токеном в query-параметре:
```
https://your-server/mcp?token=your-secret-token
```

### systemd (деплой на сервер)

```ini
# /etc/systemd/system/secondbrain-mcp.service
[Unit]
Description=SecondBrain MCP Server
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/node /path/to/sb-mcp/dist/index.js --http
Environment=OBSIDIAN_VAULT_PATH=/path/to/vault
Environment=MCP_AUTH_TOKEN=your-secret-token
Environment=MCP_PORT=3100
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

## Контракт данных

- **Исключённые папки:** `.git`, `.obsidian`, `node_modules`, `99_Private`, `_attachments`, `mcp`
- **Типы заметок:** `project`, `area`, `resource`, `person`, `daily`, `moc`, `decision`, `inbox`, `about`
- **Статусы:** `active`, `paused`, `done`, `someday`
- **Frontmatter:** YAML с полями `type`, `status`, `created`, `updated`, `tags`, `aliases`, `related`
- **Связи:** `[[wikilinks]]` + `related:` в frontmatter + backlinks + общие теги
- **Оптимистическая блокировка:** write-операции используют `hash`, чтобы UI применял только просмотренную пользователем версию файла
