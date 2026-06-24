import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import matter from 'gray-matter';
import type {
  AddAgentMemoryInput,
  AddAgentMemoryResult,
  AgentMemoryFile,
  AgentMemoryType,
  AppendToNoteInput,
  AppendToNoteResult,
  ApplyNoteUpdateInput,
  ApplyNoteUpdateResult,
  Backlink,
  CreateNoteInput,
  CreateNoteResult,
  Decision,
  Frontmatter,
  ListNotesOptions,
  ListNotesResult,
  Note,
  NoteLink,
  NoteMetadata,
  NoteSummary,
  NoteType,
  NoteUpdateInput,
  NoteUpdateProposal,
  PathValidationResult,
  ReadAgentMemoryOptions,
  ReadAgentMemoryResult,
  ReadNotesBatchOptions,
  ReadNotesBatchResult,
  Task,
  VaultStats,
  ProjectContext,
} from './types.js';
import { AI_SYSTEM_FOLDER, EXCLUDED_FOLDERS, PARA_FOLDERS } from './types.js';

const DEFAULT_LIST_LIMIT = 50;
const WIKILINK_REGEX = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
const MEMORY_FILE_BY_TYPE: Record<AgentMemoryType, AgentMemoryFile> = {
  role: 'role',
  rule: 'rules',
  style: 'style',
  project: 'projects',
  mistake: 'mistakes',
  example: 'examples',
};
const MEMORY_TITLE_BY_FILE: Record<AgentMemoryFile, string> = {
  role: 'Agent Role',
  rules: 'Agent Rules',
  style: 'Agent Style',
  projects: 'Agent Projects',
  mistakes: 'Agent Mistakes',
  examples: 'Agent Examples',
};

export class Vault {
  constructor(private readonly root: string) {}

  private normalizeRelativePath(input: string): string {
    return input.replace(/\\/g, '/').replace(/^\/+/, '');
  }

  private absolutePath(relativePath: string): string {
    return path.resolve(this.root, this.normalizeRelativePath(relativePath));
  }

  private isInsideRoot(absPath: string): boolean {
    const rootPath = path.resolve(this.root);
    return absPath === rootPath || absPath.startsWith(rootPath + path.sep);
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private hashContent(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  private hashFile(absPath: string): string {
    return this.hashContent(fs.readFileSync(absPath, 'utf-8'));
  }

  private titleFor(note: Note): string {
    const explicitTitle = note.frontmatter.title;
    if (typeof explicitTitle === 'string' && explicitTitle.trim()) {
      return explicitTitle.trim();
    }
    const heading = note.content.match(/^#\s+(.+)$/m);
    return heading?.[1]?.trim() || note.name;
  }

  private noteSummary(note: Note): NoteSummary {
    const absPath = this.absolutePath(note.path);
    const stats = fs.statSync(absPath);
    return {
      path: note.path,
      name: note.name,
      title: this.titleFor(note),
      folder: path.dirname(note.path).replace(/\\/g, '/'),
      frontmatter: note.frontmatter,
      mtime: stats.mtime.toISOString(),
      size: stats.size,
      hash: this.hashFile(absPath),
    };
  }

  private serializeNote(frontmatter: Frontmatter, content: string): string {
    const normalizedContent = content.endsWith('\n') ? content : content + '\n';
    return matter.stringify(normalizedContent, frontmatter);
  }

  private touchFrontmatter(frontmatter: Frontmatter): Frontmatter {
    return {
      ...frontmatter,
      updated: this.today(),
    };
  }

  private ensureCreateFrontmatter(frontmatter: Frontmatter): {
    frontmatter: Frontmatter;
    warnings: string[];
  } {
    const warnings: string[] = [];
    const today = this.today();
    const next: Frontmatter = {
      ...frontmatter,
      created: typeof frontmatter.created === 'string' ? frontmatter.created : today,
      updated: today,
    };

    if (!next.type) warnings.push('Missing frontmatter.type');
    if (!next.status) warnings.push('Missing frontmatter.status');
    if (!Array.isArray(next.related) || next.related.length === 0) {
      warnings.push('Missing frontmatter.related link to a MOC');
    }
    if (!Array.isArray(next.tags)) {
      next.tags = [];
    }
    if (!Array.isArray(next.aliases)) {
      next.aliases = [];
    }

    return { frontmatter: next, warnings };
  }

  private extractWikilinksFromText(text: string): NoteLink[] {
    const links: NoteLink[] = [];
    let match: RegExpExecArray | null;
    WIKILINK_REGEX.lastIndex = 0;
    while ((match = WIKILINK_REGEX.exec(text)) !== null) {
      links.push({
        target: match[1].trim(),
        raw: match[0],
      });
    }
    return links;
  }

  private extractLinks(note: Note, allNotes: Note[]): NoteLink[] {
    const frontmatterLinks = (note.frontmatter.related ?? [])
      .flatMap((value) => this.extractWikilinksFromText(String(value)));
    const contentLinks = this.extractWikilinksFromText(note.content);
    return [...frontmatterLinks, ...contentLinks].map((link) => ({
      ...link,
      path: this.resolveLinkPath(link.target, allNotes),
    }));
  }

  private resolveLinkPath(target: string, allNotes: Note[]): string | undefined {
    const normalized = target.replace(/\.md$/, '').toLowerCase();
    return allNotes.find((note) => {
      const candidates = [
        note.path.replace(/\.md$/, ''),
        path.basename(note.path, '.md'),
        note.name,
        this.titleFor(note),
        ...(note.frontmatter.aliases ?? []),
      ].map((candidate) => candidate.toLowerCase());
      return candidates.includes(normalized);
    })?.path;
  }

  private buildBacklinks(note: Note, allNotes: Note[]): Backlink[] {
    const backlinks: Backlink[] = [];
    for (const other of allNotes) {
      if (other.path === note.path) continue;
      const links = this.extractLinks(other, allNotes);
      for (const link of links) {
        if (link.path === note.path) {
          backlinks.push({
            path: other.path,
            name: other.name,
            type: other.frontmatter.type,
            target: link.target,
          });
        }
      }
    }
    return backlinks;
  }

  private diffLines(oldContent: string, newContent: string): string {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    const max = Math.max(oldLines.length, newLines.length);
    const lines: string[] = [];
    for (let i = 0; i < max; i++) {
      const oldLine = oldLines[i];
      const newLine = newLines[i];
      if (oldLine === newLine) {
        if (oldLine !== undefined) lines.push(` ${oldLine}`);
        continue;
      }
      if (oldLine !== undefined) lines.push(`-${oldLine}`);
      if (newLine !== undefined) lines.push(`+${newLine}`);
    }
    return lines.join('\n');
  }

  private memoryPath(file: AgentMemoryFile): string {
    return `${AI_SYSTEM_FOLDER}/${file}.md`;
  }

  private normalizeSearchText(value: string): string {
    return value
      .toLowerCase()
      .replace(/\[\[|\]\]/g, ' ')
      .replace(/[-_/|#:[\](),.]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private firstSnippet(content: string, terms: string[]): string {
    const normalizedContent = this.normalizeSearchText(content);
    const firstTerm = terms.find((term) => normalizedContent.includes(term));
    if (!firstTerm) return content.slice(0, 200).trim();

    const lowerContent = content.toLowerCase();
    const idx = lowerContent.indexOf(firstTerm);
    const safeIdx = idx === -1 ? normalizedContent.indexOf(firstTerm) : idx;
    const start = Math.max(0, safeIdx - 80);
    const end = Math.min(content.length, safeIdx + firstTerm.length + 120);
    return `${start > 0 ? '...' : ''}${content.slice(start, end).trim()}${end < content.length ? '...' : ''}`;
  }

  // ── Scanning ──────────────────────────────────────────────

  /** Recursively collect all .md files, respecting EXCLUDED_FOLDERS */
  private collectFiles(dir: string = this.root): string[] {
    const results: string[] = [];
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return results;
    }
    for (const entry of entries) {
      if (EXCLUDED_FOLDERS.some((ex) => entry.name === ex)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...this.collectFiles(full));
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(full);
      }
    }
    return results;
  }

  // ── Parsing ───────────────────────────────────────────────

  private parseNote(absPath: string): Note | null {
    try {
      const raw = fs.readFileSync(absPath, 'utf-8');
      const { data, content } = matter(raw);
      const rel = path.relative(this.root, absPath);
      return {
        path: rel,
        name: path.basename(absPath, '.md'),
        frontmatter: data as Frontmatter,
        content,
      };
    } catch {
      return null;
    }
  }

  /** Load all notes (cached per call — stateless between tool invocations) */
  getAllNotes(): Note[] {
    return this.collectFiles()
      .map((f) => this.parseNote(f))
      .filter((n): n is Note => n !== null);
  }

  validateVaultPath(inputPath: string, operation: 'read' | 'write'): PathValidationResult {
    const normalized = this.normalizeRelativePath(inputPath);
    const absPath = this.absolutePath(normalized);
    const segments = normalized.split('/').filter(Boolean);

    if (!inputPath.trim()) {
      return { allowed: false, path: normalized, operation, reason: 'Path is empty' };
    }
    if (path.isAbsolute(inputPath)) {
      return { allowed: false, path: normalized, operation, reason: 'Absolute paths are not allowed' };
    }
    if (!this.isInsideRoot(absPath) || segments.includes('..')) {
      return { allowed: false, path: normalized, operation, reason: 'Path escapes vault root' };
    }
    const excluded = segments.find((segment) => EXCLUDED_FOLDERS.includes(segment as typeof EXCLUDED_FOLDERS[number]));
    if (excluded) {
      return { allowed: false, path: normalized, operation, reason: `Path is inside excluded folder: ${excluded}` };
    }
    if (operation === 'write') {
      if (!normalized.endsWith('.md')) {
        return { allowed: false, path: normalized, operation, reason: 'Only .md files can be written' };
      }
      if (/\s/.test(path.basename(normalized))) {
        return { allowed: false, path: normalized, operation, reason: 'Markdown file names must not contain spaces' };
      }
    }

    return { allowed: true, path: normalized, operation };
  }

  listNotes(options: ListNotesOptions = {}): ListNotesResult {
    const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIST_LIMIT, 1), 200);
    const offset = Math.max(options.offset ?? 0, 0);
    let notes = this.getAllNotes();

    if (options.folder) {
      const validation = this.validateVaultPath(`${options.folder.replace(/\/+$/, '')}/placeholder.md`, 'read');
      if (!validation.allowed) throw new Error(validation.reason);
      const folder = this.normalizeRelativePath(options.folder).replace(/\/+$/, '');
      notes = notes.filter((note) => note.path === folder || note.path.startsWith(folder + '/'));
    }
    if (options.includeArchived === false) {
      notes = notes.filter((note) => !note.path.startsWith(`${PARA_FOLDERS.archives}/`));
    }
    if (options.type) {
      notes = notes.filter((note) => note.frontmatter.type === options.type);
    }
    if (options.status) {
      notes = notes.filter((note) => note.frontmatter.status === options.status);
    }
    if (options.tags?.length) {
      notes = notes.filter((note) => {
        const noteTags = note.frontmatter.tags ?? [];
        return options.tags!.some((tag) => noteTags.includes(tag));
      });
    }

    const summaries = notes.map((note) => this.noteSummary(note));
    const sortBy = options.sortBy ?? 'path';
    summaries.sort((a, b) => {
      if (sortBy === 'mtime') return b.mtime.localeCompare(a.mtime);
      if (sortBy === 'created') {
        return String(b.frontmatter.created ?? '').localeCompare(String(a.frontmatter.created ?? ''));
      }
      if (sortBy === 'updated') {
        return String(b.frontmatter.updated ?? '').localeCompare(String(a.frontmatter.updated ?? ''));
      }
      return String(a[sortBy]).localeCompare(String(b[sortBy]));
    });

    return {
      total: summaries.length,
      limit,
      offset,
      notes: summaries.slice(offset, offset + limit),
    };
  }

  readNotesBatch(options: ReadNotesBatchOptions): ReadNotesBatchResult {
    const notes: ReadNotesBatchResult['notes'] = [];
    const missing: string[] = [];
    const includeFrontmatter = options.includeFrontmatter ?? true;
    const includeContent = options.includeContent ?? true;

    for (const notePath of options.paths) {
      const note = this.getNote(notePath);
      if (!note) {
        missing.push(notePath);
        continue;
      }
      const absPath = this.absolutePath(note.path);
      const result: ReadNotesBatchResult['notes'][number] = {
        path: note.path,
        name: note.name,
        hash: this.hashFile(absPath),
      };
      if (includeFrontmatter) result.frontmatter = note.frontmatter;
      if (includeContent) {
        result.content =
          typeof options.maxCharsPerNote === 'number'
            ? note.content.slice(0, options.maxCharsPerNote)
            : note.content;
      }
      notes.push(result);
    }

    return { total: notes.length, notes, missing };
  }

  getNoteMetadata(identifier: string): NoteMetadata | null {
    const note = this.getNote(identifier);
    if (!note) return null;
    const allNotes = this.getAllNotes();
    const summary = this.noteSummary(note);
    return {
      ...summary,
      links: this.extractLinks(note, allNotes),
      backlinks: this.buildBacklinks(note, allNotes),
      tags: note.frontmatter.tags ?? [],
      lineCount: note.content.split('\n').length,
    };
  }

  createNote(input: CreateNoteInput): CreateNoteResult {
    const validation = this.validateVaultPath(input.path, 'write');
    if (!validation.allowed) throw new Error(validation.reason);
    const notePath = validation.path;
    const absPath = this.absolutePath(notePath);
    const exists = fs.existsSync(absPath);

    if (exists) {
      throw new Error(`Refusing to modify existing note through createNote: ${notePath}. Use appendToNote or applyNoteUpdate.`);
    }

    const { frontmatter, warnings } = this.ensureCreateFrontmatter(input.frontmatter);
    if (warnings.some((warning) => warning.startsWith('Missing'))) {
      throw new Error(`Invalid note frontmatter: ${warnings.join('; ')}`);
    }

    const serialized = this.serializeNote(frontmatter, input.content);
    if (input.dryRun) {
      return {
        path: notePath,
        hash: this.hashContent(serialized),
        wouldWrite: true,
        warnings,
      };
    }

    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, serialized, 'utf-8');

    return {
      path: notePath,
      hash: this.hashFile(absPath),
      wouldWrite: false,
      warnings,
    };
  }

  proposeNoteUpdate(input: NoteUpdateInput): NoteUpdateProposal {
    const validation = this.validateVaultPath(input.path, 'write');
    if (!validation.allowed) throw new Error(validation.reason);
    const note = this.getNote(validation.path);
    if (!note) throw new Error(`Note not found: ${input.path}`);
    const absPath = this.absolutePath(note.path);
    const oldHash = this.hashFile(absPath);
    if (input.expectedHash && input.expectedHash !== oldHash) {
      throw new Error(`Hash mismatch for ${note.path}`);
    }

    const nextFrontmatter = this.touchFrontmatter(note.frontmatter);
    const serialized = this.serializeNote(nextFrontmatter, input.newContent);
    return {
      path: note.path,
      oldHash,
      newHash: this.hashContent(serialized),
      diff: this.diffLines(note.content.trimEnd(), input.newContent.trimEnd()),
      validationWarnings: [],
    };
  }

  applyNoteUpdate(input: ApplyNoteUpdateInput): ApplyNoteUpdateResult {
    if (!input.confirmed) {
      throw new Error('Note update must be confirmed by the user');
    }
    if (!input.expectedHash) {
      throw new Error('expectedHash is required for safe note updates');
    }
    const proposal = this.proposeNoteUpdate(input);
    const note = this.getNote(input.path);
    if (!note) throw new Error(`Note not found: ${input.path}`);

    const absPath = this.absolutePath(note.path);
    let backupPath: string | undefined;
    if (input.backup !== false) {
      const safeName = note.path.replace(/[\/\\]/g, '__');
      backupPath = `${AI_SYSTEM_FOLDER}/backups/${Date.now()}-${safeName}`;
      const backupAbsPath = this.absolutePath(backupPath);
      fs.mkdirSync(path.dirname(backupAbsPath), { recursive: true });
      fs.copyFileSync(absPath, backupAbsPath);
    }

    const serialized = this.serializeNote(this.touchFrontmatter(note.frontmatter), input.newContent);
    fs.writeFileSync(absPath, serialized, 'utf-8');
    return {
      path: note.path,
      oldHash: proposal.oldHash,
      newHash: this.hashFile(absPath),
      backupPath,
    };
  }

  appendToNote(input: AppendToNoteInput): AppendToNoteResult {
    const validation = this.validateVaultPath(input.path, 'write');
    if (!validation.allowed) throw new Error(validation.reason);

    const notePath = validation.path;
    let note = this.getNote(notePath);
    if (!note) {
      if (!input.createIfMissing) {
        throw new Error(`Note not found: ${notePath}`);
      }
      this.createNote({
        path: notePath,
        frontmatter: {
          type: 'resource',
          status: 'active',
          tags: ['ai-system'],
          aliases: [path.basename(notePath, '.md')],
          related: ['[[Home]]'],
        },
        content: `# ${path.basename(notePath, '.md')}\n`,
      });
      note = this.getNote(notePath);
    }
    if (!note) throw new Error(`Note not found: ${notePath}`);

    const absPath = this.absolutePath(note.path);
    const oldHash = this.hashFile(absPath);
    if (input.expectedHash && input.expectedHash !== oldHash) {
      throw new Error(`Hash mismatch for ${note.path}`);
    }

    const addition = input.content.endsWith('\n') ? input.content : input.content + '\n';
    let nextContent = note.content;
    if (input.section) {
      const sectionRegex = new RegExp(`^(#{1,6})\\s+${input.section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm');
      const match = sectionRegex.exec(nextContent);
      if (match) {
        const afterHeading = match.index + match[0].length;
        const rest = nextContent.slice(afterHeading);
        const nextHeading = rest.search(/\n#{1,6}\s+/);
        const insertAt = nextHeading === -1 ? nextContent.length : afterHeading + nextHeading;
        nextContent =
          nextContent.slice(0, insertAt).replace(/\s*$/, '\n\n') +
          addition +
          nextContent.slice(insertAt);
      } else {
        nextContent = `${nextContent.trimEnd()}\n\n## ${input.section}\n\n${addition}`;
      }
    } else {
      nextContent = `${nextContent.trimEnd()}\n\n${addition}`;
    }

    const serialized = this.serializeNote(this.touchFrontmatter(note.frontmatter), nextContent);
    fs.writeFileSync(absPath, serialized, 'utf-8');
    return {
      path: note.path,
      oldHash,
      newHash: this.hashFile(absPath),
    };
  }

  readAgentMemory(options: ReadAgentMemoryOptions = {}): ReadAgentMemoryResult {
    const files = options.files ?? ['role', 'rules', 'style', 'projects', 'mistakes', 'examples'];
    return {
      folder: AI_SYSTEM_FOLDER,
      files: files.map((file) => {
        const notePath = this.memoryPath(file);
        const note = this.getNote(notePath);
        return {
          type: file,
          path: notePath,
          exists: note !== null,
          content: note?.content ?? '',
          frontmatter: note?.frontmatter,
        };
      }),
    };
  }

  addAgentMemory(input: AddAgentMemoryInput): AddAgentMemoryResult {
    const file = MEMORY_FILE_BY_TYPE[input.type];
    const notePath = this.memoryPath(file);
    const absolute = this.absolutePath(notePath);
    if (!fs.existsSync(absolute)) {
      this.createNote({
        path: notePath,
        frontmatter: {
          type: 'resource',
          status: 'active',
          tags: ['ai-system', 'memory'],
          aliases: [MEMORY_TITLE_BY_FILE[file]],
          related: ['[[Home]]'],
        },
        content: `# ${MEMORY_TITLE_BY_FILE[file]}\n`,
      });
    }

    const metadata = this.getNoteMetadata(notePath);
    const entryLines = [
      `- ${input.content}`,
      input.sourcePath ? `  - source: ${input.sourcePath}` : undefined,
      input.tags?.length ? `  - tags: ${input.tags.join(', ')}` : undefined,
    ].filter((line): line is string => Boolean(line));
    const appended = this.appendToNote({
      path: notePath,
      section: this.today(),
      content: entryLines.join('\n'),
      expectedHash: metadata?.hash,
    });

    return {
      type: input.type,
      path: notePath,
      newHash: appended.newHash,
    };
  }

  // ── Tools implementation ──────────────────────────────────

  /** healthcheck — vault stats */
  healthcheck(): VaultStats {
    const notes = this.getAllNotes();
    const byType: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    let decisions = 0;

    for (const n of notes) {
      const t = n.frontmatter.type ?? 'unknown';
      byType[t] = (byType[t] ?? 0) + 1;
      if (n.frontmatter.status) {
        byStatus[n.frontmatter.status] = (byStatus[n.frontmatter.status] ?? 0) + 1;
      }
      if (n.path.includes('/Decisions/') || n.frontmatter.type === 'decision') {
        decisions++;
      }
    }

    return {
      totalNotes: notes.length,
      byType,
      byStatus,
      projects: notes.filter(
        (n) => n.frontmatter.type === 'project' && n.frontmatter.status === 'active',
      ).length,
      areas: notes.filter((n) => n.frontmatter.type === 'area').length,
      resources: notes.filter((n) => n.frontmatter.type === 'resource').length,
      people: notes.filter((n) => n.frontmatter.type === 'person').length,
      dailyNotes: notes.filter((n) => n.frontmatter.type === 'daily').length,
      decisions,
    };
  }

  /** search_knowledge — full-text + frontmatter search */
  searchKnowledge(
    query: string,
    opts: { type?: NoteType; status?: string; tags?: string[]; limit?: number } = {},
  ): Array<{
    path: string;
    name: string;
    frontmatter: Frontmatter;
    snippet: string;
    score: number;
    matches: Array<{ field: string; term: string; weight: number }>;
  }> {
    const limit = opts.limit ?? 20;
    const normalizedQuery = this.normalizeSearchText(query);
    const terms = normalizedQuery.split(' ').filter(Boolean);
    const notes = this.getAllNotes();

    const scored: Array<{
      note: Note;
      score: number;
      snippet: string;
      matches: Array<{ field: string; term: string; weight: number }>;
    }> = [];

    for (const note of notes) {
      // Filter by type/status/tags
      if (opts.type && note.frontmatter.type !== opts.type) continue;
      if (opts.status && note.frontmatter.status !== opts.status) continue;
      if (opts.tags?.length) {
        const noteTags = note.frontmatter.tags ?? [];
        if (!opts.tags.some((t) => noteTags.includes(t))) continue;
      }

      let score = 0;
      const matches: Array<{ field: string; term: string; weight: number }> = [];
      const fieldWeights = [
        { field: 'title', value: this.titleFor(note), exact: 20, token: 5 },
        { field: 'name', value: note.name, exact: 16, token: 4 },
        { field: 'alias', value: (note.frontmatter.aliases ?? []).join(' '), exact: 18, token: 4 },
        { field: 'tag', value: (note.frontmatter.tags ?? []).join(' '), exact: 14, token: 3 },
        { field: 'related', value: (note.frontmatter.related ?? []).join(' '), exact: 10, token: 2 },
        { field: 'content', value: note.content, exact: 6, token: 1 },
      ];

      for (const weightedField of fieldWeights) {
        const fieldText = this.normalizeSearchText(weightedField.value);
        if (!fieldText) continue;
        if (normalizedQuery && fieldText.includes(normalizedQuery)) {
          score += weightedField.exact;
          matches.push({
            field: weightedField.field,
            term: normalizedQuery,
            weight: weightedField.exact,
          });
        }
        for (const term of terms) {
          if (term !== normalizedQuery && fieldText.includes(term)) {
            score += weightedField.token;
            matches.push({
              field: weightedField.field,
              term,
              weight: weightedField.token,
            });
          }
        }
      }

      if (score === 0) continue;

      scored.push({ note, score, snippet: this.firstSnippet(note.content, terms), matches });
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ note, snippet, score, matches }) => ({
        path: note.path,
        name: note.name,
        frontmatter: note.frontmatter,
        snippet,
        score,
        matches,
      }));
  }

  /** get_note — read a single note by path or name */
  getNote(identifier: string): Note | null {
    // Try exact path first
    const looksLikePath = identifier.includes('/') || identifier.endsWith('.md');
    if (looksLikePath) {
      const validation = this.validateVaultPath(identifier, 'read');
      if (!validation.allowed) return null;
      const absExact = this.absolutePath(validation.path);
      if (fs.existsSync(absExact)) {
        return this.parseNote(absExact);
      }
      const absMd = absExact.endsWith('.md') ? absExact : absExact + '.md';
      if (fs.existsSync(absMd)) {
        return this.parseNote(absMd);
      }
      return null;
    }

    const absExact = this.absolutePath(identifier);
    if (this.isInsideRoot(absExact) && fs.existsSync(absExact)) {
      return this.parseNote(absExact);
    }
    // Try with .md
    const absMd = absExact.endsWith('.md') ? absExact : absExact + '.md';
    if (this.isInsideRoot(absMd) && fs.existsSync(absMd)) {
      return this.parseNote(absMd);
    }
    // Search by name/alias
    const q = identifier.toLowerCase();
    const notes = this.getAllNotes();
    return (
      notes.find((n) => n.name.toLowerCase() === q) ??
      notes.find((n) =>
        (n.frontmatter.aliases ?? []).some((a) => a.toLowerCase() === q),
      ) ??
      null
    );
  }

  /** list_projects — all projects with status */
  listProjects(statusFilter?: string): Array<{
    path: string;
    name: string;
    status: string;
    deadline?: string;
    tags: string[];
  }> {
    const notes = this.getAllNotes();
    return notes
      .filter((n) => {
        if (n.frontmatter.type !== 'project') return false;
        if (statusFilter && n.frontmatter.status !== statusFilter) return false;
        return true;
      })
      .map((n) => ({
        path: n.path,
        name: n.name,
        status: n.frontmatter.status ?? 'unknown',
        deadline: n.frontmatter.deadline as string | undefined,
        tags: n.frontmatter.tags ?? [],
      }));
  }

  /** get_project_context — full context for a project */
  getProjectContext(projectIdentifier: string): ProjectContext | null {
    const project = this.getNote(projectIdentifier);
    if (!project) return null;

    const allNotes = this.getAllNotes();

    // Resolve related notes from frontmatter `related:` + inline wikilinks
    const wikilinkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
    const linkedNames = new Set<string>();

    // From frontmatter related
    for (const r of project.frontmatter.related ?? []) {
      const match = r.match(/\[\[([^\]|]+)/);
      if (match) linkedNames.add(path.basename(match[1]));
    }

    // From content wikilinks
    let m: RegExpExecArray | null;
    while ((m = wikilinkRegex.exec(project.content)) !== null) {
      linkedNames.add(path.basename(m[1]));
    }

    const relatedNotes = allNotes
      .filter((n) => linkedNames.has(n.name) && n.path !== project.path)
      .map((n) => ({ path: n.path, name: n.name, type: n.frontmatter.type }));

    // Extract tasks from project folder
    const projectDir = path.dirname(project.path);
    const projectFiles = allNotes.filter((n) => n.path.startsWith(projectDir));
    const tasks = this.extractTasksFromNotes(projectFiles);

    // Find decisions in the related area
    const decisions = this.findDecisionsForProject(project, allNotes);

    return { project, relatedNotes, tasks, decisions };
  }

  /** find_related — notes related to a given note */
  findRelated(
    identifier: string,
    limit: number = 15,
  ): Array<{ path: string; name: string; type?: NoteType; relation: string }> {
    const note = this.getNote(identifier);
    if (!note) return [];

    const allNotes = this.getAllNotes();
    const results: Array<{
      path: string;
      name: string;
      type?: NoteType;
      relation: string;
      score: number;
    }> = [];

    // 1. Explicit `related:` frontmatter links
    for (const r of note.frontmatter.related ?? []) {
      const match = r.match(/\[\[([^\]|]+)/);
      if (!match) continue;
      const target = allNotes.find((n) => n.name === path.basename(match[1]));
      if (target && target.path !== note.path) {
        results.push({
          path: target.path,
          name: target.name,
          type: target.frontmatter.type,
          relation: 'frontmatter-related',
          score: 10,
        });
      }
    }

    // 2. Inline wikilinks
    const wikilinkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
    let m: RegExpExecArray | null;
    while ((m = wikilinkRegex.exec(note.content)) !== null) {
      const basename = path.basename(m[1]);
      const target = allNotes.find((n) => n.name === basename);
      if (target && target.path !== note.path && !results.some((r) => r.path === target.path)) {
        results.push({
          path: target.path,
          name: target.name,
          type: target.frontmatter.type,
          relation: 'wikilink',
          score: 7,
        });
      }
    }

    // 3. Backlinks — other notes linking to this note
    for (const other of allNotes) {
      if (other.path === note.path) continue;
      if (results.some((r) => r.path === other.path)) continue;
      const fullText = other.content + JSON.stringify(other.frontmatter.related ?? []);
      if (fullText.includes(`[[${note.name}`) || fullText.includes(`/${note.name}`)) {
        results.push({
          path: other.path,
          name: other.name,
          type: other.frontmatter.type,
          relation: 'backlink',
          score: 5,
        });
      }
    }

    // 4. Shared tags
    const noteTags = new Set(note.frontmatter.tags ?? []);
    if (noteTags.size > 0) {
      for (const other of allNotes) {
        if (other.path === note.path) continue;
        if (results.some((r) => r.path === other.path)) continue;
        const shared = (other.frontmatter.tags ?? []).filter((t) => noteTags.has(t));
        if (shared.length > 0) {
          results.push({
            path: other.path,
            name: other.name,
            type: other.frontmatter.type,
            relation: `shared-tags: ${shared.join(', ')}`,
            score: shared.length * 2,
          });
        }
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ path: p, name, type, relation }) => ({ path: p, name, type, relation }));
  }

  /** extract_tasks — open tasks across vault or specific folder */
  extractTasks(
    folder?: string,
    includeCompleted: boolean = false,
  ): Task[] {
    let notes = this.getAllNotes();
    if (folder) {
      notes = notes.filter((n) => n.path.startsWith(folder));
    }
    const tasks = this.extractTasksFromNotes(notes);
    if (!includeCompleted) {
      return tasks.filter((t) => !t.completed);
    }
    return tasks;
  }

  /** extract_decisions — decisions from decision log folders */
  extractDecisions(area?: string): Decision[] {
    const notes = this.getAllNotes();
    return notes
      .filter((n) => {
        const isDecision =
          n.path.includes('/Decisions/') || n.frontmatter.type === 'decision';
        if (!isDecision) return false;
        if (area) return n.path.toLowerCase().includes(area.toLowerCase());
        return true;
      })
      .map((n) => {
        // Try to extract date from filename (YYYY-MM-DD-title.md)
        const dateMatch = n.name.match(/^(\d{4}-\d{2}-\d{2})/);
        return {
          path: n.path,
          name: n.name,
          date: dateMatch?.[1] ?? n.frontmatter.created ?? 'unknown',
          frontmatter: n.frontmatter,
          preview: n.content.slice(0, 500).trim(),
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  // ── Private helpers ───────────────────────────────────────

  private extractTasksFromNotes(notes: Note[]): Task[] {
    const tasks: Task[] = [];
    const taskRegex = /^(\s*)-\s+\[([ xX])\]\s+(.+)$/gm;

    for (const note of notes) {
      let match: RegExpExecArray | null;
      while ((match = taskRegex.exec(note.content)) !== null) {
        const lineNum =
          note.content.slice(0, match.index).split('\n').length;
        tasks.push({
          text: match[3].trim(),
          completed: match[2] !== ' ',
          source: note.path,
          line: lineNum,
        });
      }
    }
    return tasks;
  }

  private findDecisionsForProject(project: Note, allNotes: Note[]): Decision[] {
    // Determine which area this project belongs to via tags or path
    const projectTags = project.frontmatter.tags ?? [];
    const areaHints = ['edtech', 'consulting', 'content', 'b2b'];

    let areaFolder = '';
    for (const hint of areaHints) {
      if (projectTags.some((t) => t.toLowerCase().includes(hint))) {
        if (hint === 'edtech') areaFolder = 'EdTech-Company';
        else if (hint === 'consulting' || hint === 'b2b') areaFolder = 'B2B-Consulting';
        else if (hint === 'content') areaFolder = 'Content-Production';
        break;
      }
    }

    if (!areaFolder) return [];

    return allNotes
      .filter(
        (n) =>
          n.path.includes(areaFolder) &&
          (n.path.includes('/Decisions/') || n.frontmatter.type === 'decision'),
      )
      .map((n) => ({
        path: n.path,
        name: n.name,
        date: n.frontmatter.created ?? 'unknown',
        frontmatter: n.frontmatter,
        preview: n.content.slice(0, 500).trim(),
      }));
  }
}
