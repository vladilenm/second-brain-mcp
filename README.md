# SecondBrain MCP v0.2

Read-only semantic layer поверх Obsidian vault.

Отвечает не на «какие файлы есть?», а на:
- какие активные проекты?
- какой контекст у проекта?
- какие решения уже были?
- какие задачи открыты?
- какие заметки связаны?
- что известно по теме?

## Tools

| Tool | Описание |
|------|----------|
| `healthcheck` | Статус vault + статистика по типам/статусам |
| `search_knowledge` | Семантический поиск: имя, алиасы, теги, контент + фильтры |
| `get_note` | Чтение заметки по пути или имени (frontmatter + body) |
| `list_projects` | Список проектов с фильтром по статусу |
| `get_project_context` | Полный контекст проекта: README + связи + задачи + решения |
| `find_related` | Связанные заметки через wikilinks, backlinks, shared tags |
| `extract_tasks` | Открытые задачи (чекбоксы) из vault или папки |
| `extract_decisions` | Decision log из `02_Areas/*/Decisions/` |

## Data Contract

- **Excluded folders:** `.git`, `.obsidian`, `node_modules`, `99_Private`, `_attachments`, `mcp`
- **Note types:** `project`, `area`, `resource`, `person`, `daily`, `moc`, `decision`, `inbox`, `about`
- **Statuses:** `active`, `paused`, `done`, `someday`
- **Frontmatter:** YAML с полями `type`, `status`, `created`, `updated`, `tags`, `aliases`, `related`
- **Связи:** `[[wikilinks]]` + `related:` в frontmatter + backlinks + shared tags

## Setup

```bash
cd mcp
npm install
npm run build
```

## Конфиги клиентов

### Claude Code (`.claude/settings.json` или `.mcp.json`)

```json
{
  "mcpServers": {
    "secondbrain": {
      "command": "node",
      "args": ["/path/to/second-brain/mcp/dist/index.js"],
      "env": {
        "OBSIDIAN_VAULT_PATH": "/path/to/second-brain"
      }
    }
  }
}
```

### Hermes / Codex / Custom agents

```json
{
  "mcpServers": {
    "secondbrain": {
      "command": "node",
      "args": ["/root/vaults/second-brain/mcp/dist/index.js"],
      "env": {
        "OBSIDIAN_VAULT_PATH": "/root/vaults/second-brain"
      }
    }
  }
}
```

### Server (systemd)

```ini
# /etc/systemd/system/secondbrain-mcp.service
[Unit]
Description=SecondBrain MCP Server
After=obsidian-sync.service

[Service]
Type=simple
ExecStart=/usr/bin/node /root/vaults/second-brain/mcp/dist/index.js
Environment=OBSIDIAN_VAULT_PATH=/root/vaults/second-brain
Restart=on-failure
User=root

[Install]
WantedBy=multi-user.target
```

> **Note:** MCP stdio transport — каждый клиент запускает свой процесс.
> Для HTTP transport (multi-client) нужна v0.3.
