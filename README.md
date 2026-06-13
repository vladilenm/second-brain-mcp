# SecondBrain MCP

Read-only MCP server for Obsidian vaults. Gives AI assistants (Claude, ChatGPT, etc.) semantic access to your notes, projects, decisions, and tasks.

## What it does

Instead of raw file access, it provides structured tools:

| Tool | Description |
|------|-------------|
| `healthcheck` | Vault status and statistics |
| `search_knowledge` | Full-text + frontmatter search with filters |
| `get_note` | Read a note by path or name |
| `list_projects` | List projects, filter by status |
| `get_project_context` | Full project context: content + related notes + tasks + decisions |
| `find_related` | Find connected notes via wikilinks, backlinks, shared tags |
| `extract_tasks` | Open/completed tasks from vault or folder |
| `extract_decisions` | Decision log entries |

## Install

```bash
git clone <repo-url> && cd sb-mcp
npm install
npm run build
```

## Usage

### Stdio (local, single client)

```bash
OBSIDIAN_VAULT_PATH=/path/to/vault node dist/index.js
```

### HTTP (remote, multi-client)

```bash
OBSIDIAN_VAULT_PATH=/path/to/vault \
MCP_AUTH_TOKEN=your-secret-token \
MCP_PORT=3100 \
node dist/index.js --http
```

## Authentication

In HTTP mode, set `MCP_AUTH_TOKEN` to require Bearer token auth on every request.

Clients must send the header:
```
Authorization: Bearer your-secret-token
```

If `MCP_AUTH_TOKEN` is not set, the server runs without auth (not recommended for public networks).

Generate a token:
```bash
openssl rand -hex 32
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OBSIDIAN_VAULT_PATH` | current directory | Path to Obsidian vault |
| `MCP_TRANSPORT` | `stdio` | Transport mode: `stdio` or `http` |
| `MCP_PORT` | `3100` | HTTP server port |
| `MCP_AUTH_TOKEN` | — | Bearer token for HTTP auth (recommended) |

## Client configuration

### Claude Code (`.mcp.json`)

**Stdio (local):**
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

**HTTP (remote):**
```json
{
  "mcpServers": {
    "secondbrain": {
      "type": "url",
      "url": "http://your-server:3100/mcp",
      "headers": {
        "Authorization": "Bearer your-secret-token"
      }
    }
  }
}
```

### ChatGPT / other clients

Use the HTTP endpoint `http://your-server:3100/mcp` with the `Authorization: Bearer <token>` header.

### systemd (server deployment)

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

## Data contract

- **Excluded folders:** `.git`, `.obsidian`, `node_modules`, `99_Private`, `_attachments`, `mcp`
- **Note types:** `project`, `area`, `resource`, `person`, `daily`, `moc`, `decision`, `inbox`, `about`
- **Statuses:** `active`, `paused`, `done`, `someday`
- **Frontmatter:** YAML with `type`, `status`, `created`, `updated`, `tags`, `aliases`, `related`
- **Relations:** `[[wikilinks]]` + `related:` in frontmatter + backlinks + shared tags
