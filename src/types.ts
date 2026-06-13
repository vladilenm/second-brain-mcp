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
