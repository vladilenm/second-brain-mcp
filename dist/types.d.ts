export type NoteType = 'project' | 'area' | 'resource' | 'person' | 'daily' | 'moc' | 'decision' | 'inbox' | 'about';
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
    relatedNotes: Array<{
        path: string;
        name: string;
        type?: NoteType;
    }>;
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
export declare const EXCLUDED_FOLDERS: readonly [".git", ".obsidian", "node_modules", "99_Private", "_attachments", "mcp"];
/** PARA folder mapping */
export declare const PARA_FOLDERS: {
    readonly projects: "01_Projects";
    readonly areas: "02_Areas";
    readonly resources: "03_Resources";
    readonly archives: "04_Archives";
    readonly daily: "05_Daily";
    readonly people: "06_People";
    readonly meta: "00_Meta";
};
//# sourceMappingURL=types.d.ts.map