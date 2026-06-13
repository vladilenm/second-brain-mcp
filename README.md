# SecondBrain MCP

Read-only MCP-сервер для Obsidian vault. Даёт AI-ассистентам (Claude, ChatGPT и др.) семантический доступ к заметкам, проектам, решениям и задачам.

## Что умеет

Вместо сырого доступа к файлам предоставляет структурированные инструменты:

| Tool | Описание |
|------|----------|
| `healthcheck` | Статус vault и статистика |
| `search_knowledge` | Полнотекстовый поиск + фильтры по frontmatter |
| `get_note` | Чтение заметки по пути или имени |
| `list_projects` | Список проектов с фильтром по статусу |
| `get_project_context` | Полный контекст проекта: содержимое + связи + задачи + решения |
| `find_related` | Связанные заметки через wikilinks, backlinks, общие теги |
| `extract_tasks` | Открытые/завершённые задачи из vault или папки |
| `extract_decisions` | Записи из журнала решений |

## Установка

```bash
git clone <repo-url> && cd sb-mcp
npm install
npm run build
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
