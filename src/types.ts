// Data contract for SecondBrain Obsidian vault

export type NoteType =
  | 'project'
  | 'area'
  | 'resource'
  | 'person'
  | 'daily'
  | 'moc'
  | 'decision'
  | 'inbox'
  | 'about';

export type NoteStatus = 'active' | 'paused' | 'done' | 'someday';

export type VaultOperation = 'read' | 'write';

export type AgentMemoryType =
  | 'role'
  | 'rule'
  | 'style'
  | 'project'
  | 'mistake'
  | 'example';

export type AgentMemoryFile =
  | 'role'
  | 'rules'
  | 'style'
  | 'projects'
  | 'mistakes'
  | 'examples';

export interface Frontmatter {
  type?: NoteType;
  status?: NoteStatus;
  created?: string;
  updated?: string;
  deadline?: string;
  tags?: string[];
  aliases?: string[];
  related?: string[];
  [key: string]: unknown;
}

export interface Note {
  /** Relative path from vault root */
  path: string;
  /** File name without extension */
  name: string;
  /** Parsed YAML frontmatter */
  frontmatter: Frontmatter;
  /** Markdown body (without frontmatter) */
  content: string;
}

export interface NoteLink {
  target: string;
  raw: string;
  path?: string;
}

export interface Backlink {
  path: string;
  name: string;
  type?: NoteType;
  target: string;
}

export interface NoteSummary {
  path: string;
  name: string;
  title: string;
  folder: string;
  frontmatter: Frontmatter;
  mtime: string;
  size: number;
  hash: string;
}

export interface NoteMetadata extends NoteSummary {
  links: NoteLink[];
  backlinks: Backlink[];
  tags: string[];
  lineCount: number;
}

export interface ListNotesOptions {
  folder?: string;
  type?: NoteType;
  status?: NoteStatus;
  tags?: string[];
  limit?: number;
  offset?: number;
  sortBy?: 'path' | 'name' | 'created' | 'updated' | 'mtime';
  includeArchived?: boolean;
}

export interface ListNotesResult {
  total: number;
  limit: number;
  offset: number;
  notes: NoteSummary[];
}

export interface ReadNotesBatchOptions {
  paths: string[];
  includeFrontmatter?: boolean;
  includeContent?: boolean;
  maxCharsPerNote?: number;
}

export interface ReadNotesBatchResult {
  total: number;
  notes: Array<{
    path: string;
    name: string;
    hash: string;
    frontmatter?: Frontmatter;
    content?: string;
  }>;
  missing: string[];
}

export interface PathValidationResult {
  allowed: boolean;
  path: string;
  operation: VaultOperation;
  reason?: string;
}

export interface CreateNoteInput {
  path: string;
  frontmatter: Frontmatter;
  content: string;
  ifExists?: 'error';
  dryRun?: boolean;
}

export interface CreateNoteResult {
  path: string;
  hash: string;
  wouldWrite: boolean;
  warnings: string[];
}

export interface NoteUpdateInput {
  path: string;
  expectedHash?: string;
  newContent: string;
  updateReason?: string;
}

export interface NoteUpdateProposal {
  path: string;
  oldHash: string;
  newHash: string;
  diff: string;
  validationWarnings: string[];
}

export interface ApplyNoteUpdateInput extends NoteUpdateInput {
  confirmed: boolean;
  backup?: boolean;
}

export interface ApplyNoteUpdateResult {
  path: string;
  oldHash: string;
  newHash: string;
  backupPath?: string;
}

export interface AppendToNoteInput {
  path: string;
  content: string;
  section?: string;
  createIfMissing?: boolean;
  expectedHash?: string;
}

export interface AppendToNoteResult {
  path: string;
  oldHash?: string;
  newHash: string;
}

export interface ReadAgentMemoryOptions {
  files?: AgentMemoryFile[];
}

export interface ReadAgentMemoryResult {
  folder: string;
  files: Array<{
    type: AgentMemoryFile;
    path: string;
    exists: boolean;
    content: string;
    frontmatter?: Frontmatter;
  }>;
}

export interface AddAgentMemoryInput {
  type: AgentMemoryType;
  content: string;
  sourcePath?: string;
  tags?: string[];
}

export interface AddAgentMemoryResult {
  type: AgentMemoryType;
  path: string;
  newHash: string;
}

export interface Task {
  text: string;
  completed: boolean;
  /** File where task was found */
  source: string;
  /** Line number in file */
  line: number;
}

export interface Decision {
  path: string;
  name: string;
  date: string;
  frontmatter: Frontmatter;
  /** First ~500 chars of content as preview */
  preview: string;
}

export interface ProjectContext {
  project: Note;
  /** Related notes resolved via wikilinks and `related:` frontmatter */
  relatedNotes: Array<{ path: string; name: string; type?: NoteType }>;
  /** Open tasks from project files */
  tasks: Task[];
  /** Decisions linked to this project's area */
  decisions: Decision[];
}

export interface VaultStats {
  totalNotes: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
  projects: number;
  areas: number;
  resources: number;
  people: number;
  dailyNotes: number;
  decisions: number;
}

/** Folders excluded from all reads */
export const EXCLUDED_FOLDERS = [
  '.git',
  '.obsidian',
  'node_modules',
  '99_Private',
  '_attachments',
  'mcp',
] as const;

/** PARA folder mapping */
export const PARA_FOLDERS = {
  projects: '01_Projects',
  areas: '02_Areas',
  resources: '03_Resources',
  archives: '04_Archives',
  daily: '05_Daily',
  people: '06_People',
  meta: '00_Meta',
} as const;

export const AI_SYSTEM_FOLDER = '00_Meta/AI-System' as const;
