import type { Note, Frontmatter, Task, Decision, ProjectContext, VaultStats, NoteType } from './types.js';
export declare class Vault {
    private readonly root;
    constructor(root: string);
    /** Recursively collect all .md files, respecting EXCLUDED_FOLDERS */
    private collectFiles;
    private parseNote;
    /** Load all notes (cached per call — stateless between tool invocations) */
    getAllNotes(): Note[];
    /** healthcheck — vault stats */
    healthcheck(): VaultStats;
    /** search_knowledge — full-text + frontmatter search */
    searchKnowledge(query: string, opts?: {
        type?: NoteType;
        status?: string;
        tags?: string[];
        limit?: number;
    }): Array<{
        path: string;
        name: string;
        frontmatter: Frontmatter;
        snippet: string;
    }>;
    /** get_note — read a single note by path or name */
    getNote(identifier: string): Note | null;
    /** list_projects — all projects with status */
    listProjects(statusFilter?: string): Array<{
        path: string;
        name: string;
        status: string;
        deadline?: string;
        tags: string[];
    }>;
    /** get_project_context — full context for a project */
    getProjectContext(projectIdentifier: string): ProjectContext | null;
    /** find_related — notes related to a given note */
    findRelated(identifier: string, limit?: number): Array<{
        path: string;
        name: string;
        type?: NoteType;
        relation: string;
    }>;
    /** extract_tasks — open tasks across vault or specific folder */
    extractTasks(folder?: string, includeCompleted?: boolean): Task[];
    /** extract_decisions — decisions from decision log folders */
    extractDecisions(area?: string): Decision[];
    private extractTasksFromNotes;
    private findDecisionsForProject;
}
//# sourceMappingURL=vault.d.ts.map