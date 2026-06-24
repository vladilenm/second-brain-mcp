#!/usr/bin/env node

/**
 * SecondBrain MCP v0.3
 *
 * Safe semantic layer over Obsidian vault.
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
  version: '0.3.0',
});

const noteTypeSchema = z.enum([
  'project',
  'area',
  'resource',
  'person',
  'daily',
  'moc',
  'decision',
  'inbox',
  'about',
]);
const noteStatusSchema = z.enum(['active', 'paused', 'done', 'someday']);
const memoryFileSchema = z.enum(['role', 'rules', 'style', 'projects', 'mistakes', 'examples']);
const memoryTypeSchema = z.enum(['role', 'rule', 'style', 'project', 'mistake', 'example']);

function jsonText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function jsonResponse(value: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: jsonText(value),
      },
    ],
  };
}

function errorResponse(err: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      },
    ],
    isError: true,
  };
}

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
  'Ranked lexical search across vault: title/name/aliases/tags/related/content matching. Filter by type, status, tags. Returns score, matches, and snippets.',
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

// ── Tool: list_notes ────────────────────────────────────────

server.tool(
  'list_notes',
  'List notes with metadata for browsing UI: path, title, frontmatter, mtime, size, hash. Supports folder/type/status/tag filters and pagination.',
  {
    folder: z.string().optional().describe('Folder scope, e.g. "01_Projects"'),
    type: noteTypeSchema.optional().describe('Filter by note type'),
    status: noteStatusSchema.optional().describe('Filter by note status'),
    tags: z.array(z.string()).optional().describe('Filter by tags (OR logic)'),
    limit: z.number().int().min(1).max(200).optional().describe('Max results (default 50)'),
    offset: z.number().int().min(0).optional().describe('Pagination offset (default 0)'),
    sort_by: z.enum(['path', 'name', 'created', 'updated', 'mtime']).optional().describe('Sort field'),
    include_archived: z.boolean().optional().describe('Include 04_Archives notes (default true)'),
  },
  async ({ folder, type, status, tags, limit, offset, sort_by, include_archived }) => {
    try {
      return jsonResponse(
        vault.listNotes({
          folder,
          type,
          status,
          tags,
          limit,
          offset,
          sortBy: sort_by,
          includeArchived: include_archived,
        }),
      );
    } catch (err) {
      return errorResponse(err);
    }
  },
);

// ── Tool: read_notes_batch ──────────────────────────────────

server.tool(
  'read_notes_batch',
  'Read multiple notes in one call for context building. Returns missing paths separately.',
  {
    paths: z.array(z.string()).min(1).max(50).describe('Note paths, names, or aliases'),
    include_frontmatter: z.boolean().optional().describe('Include parsed frontmatter (default true)'),
    include_content: z.boolean().optional().describe('Include markdown body (default true)'),
    max_chars_per_note: z.number().int().min(1).max(50000).optional().describe('Optional content truncation per note'),
  },
  async ({ paths, include_frontmatter, include_content, max_chars_per_note }) => {
    try {
      return jsonResponse(
        vault.readNotesBatch({
          paths,
          includeFrontmatter: include_frontmatter,
          includeContent: include_content,
          maxCharsPerNote: max_chars_per_note,
        }),
      );
    } catch (err) {
      return errorResponse(err);
    }
  },
);

// ── Tool: get_note_metadata ─────────────────────────────────

server.tool(
  'get_note_metadata',
  'Get one note metadata: frontmatter, tags, mtime, hash, wikilinks, backlinks, line count.',
  {
    identifier: z.string().describe('Note path, name, or alias'),
  },
  async ({ identifier }) => {
    try {
      const metadata = vault.getNoteMetadata(identifier);
      if (!metadata) return errorResponse(`Note not found: ${identifier}`);
      return jsonResponse(metadata);
    } catch (err) {
      return errorResponse(err);
    }
  },
);

// ── Tool: validate_vault_path ───────────────────────────────

server.tool(
  'validate_vault_path',
  'Validate whether a relative vault path is safe for read or write. Rejects traversal and excluded folders such as 99_Private.',
  {
    path: z.string().describe('Relative path inside the Obsidian vault'),
    operation: z.enum(['read', 'write']).describe('Operation to validate'),
  },
  async ({ path: notePath, operation }) => {
    return jsonResponse(vault.validateVaultPath(notePath, operation));
  },
);

// ── Tool: create_note ───────────────────────────────────────

server.tool(
  'create_note',
  'Create a new markdown note safely. Requires frontmatter with type/status/related and refuses to modify existing files.',
  {
    path: z.string().describe('Relative .md path inside the vault'),
    frontmatter: z.record(z.unknown()).describe('YAML frontmatter object'),
    content: z.string().describe('Markdown body without YAML frontmatter'),
    if_exists: z.enum(['error']).optional().describe('Existing-file behavior; create_note refuses existing files'),
    dry_run: z.boolean().optional().describe('Return serialized hash without writing'),
  },
  async ({ path: notePath, frontmatter, content, if_exists, dry_run }) => {
    try {
      return jsonResponse(
        vault.createNote({
          path: notePath,
          frontmatter,
          content,
          ifExists: if_exists,
          dryRun: dry_run,
        }),
      );
    } catch (err) {
      return errorResponse(err);
    }
  },
);

// ── Tool: propose_note_update ───────────────────────────────

server.tool(
  'propose_note_update',
  'Prepare a note update without writing. Returns old/new hashes and a line diff for user confirmation.',
  {
    path: z.string().describe('Relative .md path inside the vault'),
    expected_hash: z.string().optional().describe('Optional optimistic-lock hash from get_note_metadata/list_notes'),
    new_content: z.string().describe('New markdown body without YAML frontmatter'),
    update_reason: z.string().optional().describe('Why this update is proposed'),
  },
  async ({ path: notePath, expected_hash, new_content, update_reason }) => {
    try {
      return jsonResponse(
        vault.proposeNoteUpdate({
          path: notePath,
          expectedHash: expected_hash,
          newContent: new_content,
          updateReason: update_reason,
        }),
      );
    } catch (err) {
      return errorResponse(err);
    }
  },
);

// ── Tool: apply_note_update ─────────────────────────────────

server.tool(
  'apply_note_update',
  'Apply a confirmed note update. Requires confirmed=true and expected_hash to prevent accidental overwrites.',
  {
    path: z.string().describe('Relative .md path inside the vault'),
    expected_hash: z.string().describe('Hash of the version the user reviewed'),
    new_content: z.string().describe('New markdown body without YAML frontmatter'),
    confirmed: z.boolean().describe('Must be true after user confirmation'),
    backup: z.boolean().optional().describe('Create a backup under 00_Meta/AI-System/backups (default true)'),
  },
  async ({ path: notePath, expected_hash, new_content, confirmed, backup }) => {
    try {
      return jsonResponse(
        vault.applyNoteUpdate({
          path: notePath,
          expectedHash: expected_hash,
          newContent: new_content,
          confirmed,
          backup,
        }),
      );
    } catch (err) {
      return errorResponse(err);
    }
  },
);

// ── Tool: append_to_note ────────────────────────────────────

server.tool(
  'append_to_note',
  'Append markdown to a note or section. Useful for Inbox, logs, and incremental memory entries.',
  {
    path: z.string().describe('Relative .md path inside the vault'),
    content: z.string().describe('Markdown content to append'),
    section: z.string().optional().describe('Heading text to append under or create'),
    create_if_missing: z.boolean().optional().describe('Create the note if it does not exist'),
    expected_hash: z.string().optional().describe('Optional optimistic-lock hash'),
  },
  async ({ path: notePath, content, section, create_if_missing, expected_hash }) => {
    try {
      return jsonResponse(
        vault.appendToNote({
          path: notePath,
          content,
          section,
          createIfMissing: create_if_missing,
          expectedHash: expected_hash,
        }),
      );
    } catch (err) {
      return errorResponse(err);
    }
  },
);

// ── Tool: read_agent_memory ─────────────────────────────────

server.tool(
  'read_agent_memory',
  'Read agent memory files from 00_Meta/AI-System.',
  {
    files: z.array(memoryFileSchema).optional().describe('Memory files to read; defaults to all files'),
  },
  async ({ files }) => {
    try {
      return jsonResponse(vault.readAgentMemory({ files }));
    } catch (err) {
      return errorResponse(err);
    }
  },
);

// ── Tool: add_agent_memory ──────────────────────────────────

server.tool(
  'add_agent_memory',
  'Append a rule, mistake, example, project, style, or role memory entry under 00_Meta/AI-System.',
  {
    type: memoryTypeSchema.describe('Memory entry type'),
    content: z.string().describe('Memory entry content'),
    source_path: z.string().optional().describe('Optional source note path'),
    tags: z.array(z.string()).optional().describe('Optional memory tags'),
  },
  async ({ type, content, source_path, tags }) => {
    try {
      return jsonResponse(
        vault.addAgentMemory({
          type,
          content,
          sourcePath: source_path,
          tags,
        }),
      );
    } catch (err) {
      return errorResponse(err);
    }
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
