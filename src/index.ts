#!/usr/bin/env node

/**
 * SecondBrain MCP v0.2
 *
 * Read-only semantic layer over Obsidian vault.
 * Отвечает не на «какие файлы есть?», а на:
 *   - какие активные проекты?
 *   - какой контекст у проекта?
 *   - какие решения уже были?
 *   - какие задачи открыты?
 *   - какие заметки связаны?
 *   - что известно по теме?
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { createServer } from 'node:http';
import { z } from 'zod';
import { Vault } from './vault.js';

// ── Config ──────────────────────────────────────────────────

const VAULT_PATH = process.env.OBSIDIAN_VAULT_PATH ?? process.cwd();
const PORT = parseInt(process.env.MCP_PORT ?? '3100', 10);
const USE_HTTP =
  process.argv.includes('--http') ||
  process.env.MCP_TRANSPORT === 'http';
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;

const vault = new Vault(VAULT_PATH);

const server = new McpServer({
  name: 'secondbrain-mcp',
  version: '0.2.0',
});

// ── Tool: healthcheck ───────────────────────────────────────

server.tool(
  'healthcheck',
  'Check vault accessibility and return statistics: note counts by type/status, active projects, areas, decisions',
  {},
  async () => {
    try {
      const stats = vault.healthcheck();
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              { status: 'ok', vaultPath: VAULT_PATH, ...stats },
              null,
              2,
            ),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              status: 'error',
              vaultPath: VAULT_PATH,
              error: String(err),
            }),
          },
        ],
        isError: true,
      };
    }
  },
);

// ── Tool: search_knowledge ──────────────────────────────────

server.tool(
  'search_knowledge',
  'Semantic search across vault: full-text + frontmatter matching. Filter by type, status, tags. Returns ranked results with snippets.',
  {
    query: z.string().describe('Search query — matches name, aliases, tags, and content'),
    type: z
      .enum(['project', 'area', 'resource', 'person', 'daily', 'moc', 'decision', 'inbox', 'about'])
      .optional()
      .describe('Filter by note type'),
    status: z
      .enum(['active', 'paused', 'done', 'someday'])
      .optional()
      .describe('Filter by note status'),
    tags: z
      .array(z.string())
      .optional()
      .describe('Filter by tags (OR logic — matches any)'),
    limit: z.number().int().min(1).max(50).optional().describe('Max results (default 20)'),
  },
  async ({ query, type, status, tags, limit }) => {
    const results = vault.searchKnowledge(query, { type, status, tags, limit });
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ total: results.length, results }, null, 2),
        },
      ],
    };
  },
);

// ── Tool: get_note ──────────────────────────────────────────

server.tool(
  'get_note',
  'Read a single note by path or name. Returns full content with parsed YAML frontmatter.',
  {
    identifier: z
      .string()
      .describe('Note path (relative to vault root) or note name/alias'),
  },
  async ({ identifier }) => {
    const note = vault.getNote(identifier);
    if (!note) {
      return {
        content: [{ type: 'text' as const, text: `Note not found: ${identifier}` }],
        isError: true,
      };
    }
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            { path: note.path, name: note.name, frontmatter: note.frontmatter, content: note.content },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// ── Tool: list_projects ─────────────────────────────────────

server.tool(
  'list_projects',
  'List all projects with status, deadline, and tags. Optionally filter by status (active/paused/done/someday).',
  {
    status: z
      .enum(['active', 'paused', 'done', 'someday'])
      .optional()
      .describe('Filter by project status'),
  },
  async ({ status }) => {
    const projects = vault.listProjects(status);
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ total: projects.length, projects }, null, 2),
        },
      ],
    };
  },
);

// ── Tool: get_project_context ───────────────────────────────

server.tool(
  'get_project_context',
  'Full context for a project: README content + related notes (via wikilinks) + open tasks + linked decisions. The key tool for understanding what a project is about.',
  {
    project: z
      .string()
      .describe('Project path, name, or alias'),
  },
  async ({ project }) => {
    const ctx = vault.getProjectContext(project);
    if (!ctx) {
      return {
        content: [{ type: 'text' as const, text: `Project not found: ${project}` }],
        isError: true,
      };
    }
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              project: {
                path: ctx.project.path,
                name: ctx.project.name,
                frontmatter: ctx.project.frontmatter,
                content: ctx.project.content,
              },
              relatedNotes: ctx.relatedNotes,
              openTasks: ctx.tasks,
              decisions: ctx.decisions,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// ── Tool: find_related ──────────────────────────────────────

server.tool(
  'find_related',
  'Find notes related to a given note via: frontmatter `related:`, wikilinks, backlinks, shared tags. Ranked by connection strength.',
  {
    identifier: z.string().describe('Note path, name, or alias'),
    limit: z.number().int().min(1).max(50).optional().describe('Max results (default 15)'),
  },
  async ({ identifier, limit }) => {
    const related = vault.findRelated(identifier, limit);
    if (related.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `No related notes found for: ${identifier}`,
          },
        ],
      };
    }
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ total: related.length, related }, null, 2),
        },
      ],
    };
  },
);

// ── Tool: extract_tasks ─────────────────────────────────────

server.tool(
  'extract_tasks',
  'Extract checkbox tasks (- [ ] / - [x]) from vault notes. Optionally scope to a folder. By default returns only open tasks.',
  {
    folder: z
      .string()
      .optional()
      .describe('Scope to folder (e.g. "01_Projects" or "01_Projects/SimpleClaw")'),
    include_completed: z
      .boolean()
      .optional()
      .describe('Include completed tasks (default: false)'),
  },
  async ({ folder, include_completed }) => {
    const tasks = vault.extractTasks(folder, include_completed ?? false);
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ total: tasks.length, tasks }, null, 2),
        },
      ],
    };
  },
);

// ── Tool: extract_decisions ─────────────────────────────────

server.tool(
  'extract_decisions',
  'Extract decisions from decision log folders (02_Areas/*/Decisions/). Optionally filter by area name. Sorted newest first.',
  {
    area: z
      .string()
      .optional()
      .describe('Filter by area name (e.g. "EdTech", "B2B", "Content")'),
  },
  async ({ area }) => {
    const decisions = vault.extractDecisions(area);
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ total: decisions.length, decisions }, null, 2),
        },
      ],
    };
  },
);

// ── Start ───────────────────────────────────────────────────

async function main() {
  if (USE_HTTP) {
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);

    const httpServer = createServer(async (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id, Authorization');
      res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (AUTH_TOKEN) {
        const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
        const tokenFromQuery = url.searchParams.get('token');
        const tokenFromHeader = req.headers['authorization']?.replace('Bearer ', '');
        if (tokenFromQuery !== AUTH_TOKEN && tokenFromHeader !== AUTH_TOKEN) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized' }));
          return;
        }
      }

      await transport.handleRequest(req, res);
    });

    httpServer.listen(PORT, () => {
      console.error(`SecondBrain MCP (HTTP) listening on port ${PORT}`);
      console.error(`Vault: ${VAULT_PATH}`);
      console.error(`Endpoint: http://0.0.0.0:${PORT}/mcp`);
      if (AUTH_TOKEN) {
        console.error('Auth: Bearer token enabled');
      } else {
        console.error('⚠ Auth: DISABLED — set MCP_AUTH_TOKEN to protect access');
      }
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

main().catch((err) => {
  console.error('SecondBrain MCP failed to start:', err);
  process.exit(1);
});
