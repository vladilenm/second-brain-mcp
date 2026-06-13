import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { EXCLUDED_FOLDERS } from './types.js';
export class Vault {
    root;
    constructor(root) {
        this.root = root;
    }
    // ── Scanning ──────────────────────────────────────────────
    /** Recursively collect all .md files, respecting EXCLUDED_FOLDERS */
    collectFiles(dir = this.root) {
        const results = [];
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        }
        catch {
            return results;
        }
        for (const entry of entries) {
            if (EXCLUDED_FOLDERS.some((ex) => entry.name === ex))
                continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                results.push(...this.collectFiles(full));
            }
            else if (entry.isFile() && entry.name.endsWith('.md')) {
                results.push(full);
            }
        }
        return results;
    }
    // ── Parsing ───────────────────────────────────────────────
    parseNote(absPath) {
        try {
            const raw = fs.readFileSync(absPath, 'utf-8');
            const { data, content } = matter(raw);
            const rel = path.relative(this.root, absPath);
            return {
                path: rel,
                name: path.basename(absPath, '.md'),
                frontmatter: data,
                content,
            };
        }
        catch {
            return null;
        }
    }
    /** Load all notes (cached per call — stateless between tool invocations) */
    getAllNotes() {
        return this.collectFiles()
            .map((f) => this.parseNote(f))
            .filter((n) => n !== null);
    }
    // ── Tools implementation ──────────────────────────────────
    /** healthcheck — vault stats */
    healthcheck() {
        const notes = this.getAllNotes();
        const byType = {};
        const byStatus = {};
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
            projects: notes.filter((n) => n.frontmatter.type === 'project' && n.frontmatter.status === 'active').length,
            areas: notes.filter((n) => n.frontmatter.type === 'area').length,
            resources: notes.filter((n) => n.frontmatter.type === 'resource').length,
            people: notes.filter((n) => n.frontmatter.type === 'person').length,
            dailyNotes: notes.filter((n) => n.frontmatter.type === 'daily').length,
            decisions,
        };
    }
    /** search_knowledge — full-text + frontmatter search */
    searchKnowledge(query, opts = {}) {
        const limit = opts.limit ?? 20;
        const q = query.toLowerCase();
        const notes = this.getAllNotes();
        const scored = [];
        for (const note of notes) {
            // Filter by type/status/tags
            if (opts.type && note.frontmatter.type !== opts.type)
                continue;
            if (opts.status && note.frontmatter.status !== opts.status)
                continue;
            if (opts.tags?.length) {
                const noteTags = note.frontmatter.tags ?? [];
                if (!opts.tags.some((t) => noteTags.includes(t)))
                    continue;
            }
            let score = 0;
            const lowerContent = note.content.toLowerCase();
            const lowerName = note.name.toLowerCase();
            // Name match (highest weight)
            if (lowerName.includes(q))
                score += 10;
            // Alias match
            const aliases = note.frontmatter.aliases ?? [];
            if (aliases.some((a) => a.toLowerCase().includes(q)))
                score += 8;
            // Tag match
            const tags = note.frontmatter.tags ?? [];
            if (tags.some((t) => t.toLowerCase().includes(q)))
                score += 5;
            // Content match
            const contentIdx = lowerContent.indexOf(q);
            if (contentIdx !== -1)
                score += 3;
            if (score === 0)
                continue;
            // Extract snippet around first match
            let snippet = '';
            if (contentIdx !== -1) {
                const start = Math.max(0, contentIdx - 80);
                const end = Math.min(note.content.length, contentIdx + query.length + 120);
                snippet = (start > 0 ? '...' : '') + note.content.slice(start, end).trim() + (end < note.content.length ? '...' : '');
            }
            else {
                snippet = note.content.slice(0, 200).trim();
            }
            scored.push({ note, score, snippet });
        }
        return scored
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map(({ note, snippet }) => ({
            path: note.path,
            name: note.name,
            frontmatter: note.frontmatter,
            snippet,
        }));
    }
    /** get_note — read a single note by path or name */
    getNote(identifier) {
        // Try exact path first
        const absExact = path.join(this.root, identifier);
        if (fs.existsSync(absExact)) {
            return this.parseNote(absExact);
        }
        // Try with .md
        const absMd = absExact.endsWith('.md') ? absExact : absExact + '.md';
        if (fs.existsSync(absMd)) {
            return this.parseNote(absMd);
        }
        // Search by name/alias
        const q = identifier.toLowerCase();
        const notes = this.getAllNotes();
        return (notes.find((n) => n.name.toLowerCase() === q) ??
            notes.find((n) => (n.frontmatter.aliases ?? []).some((a) => a.toLowerCase() === q)) ??
            null);
    }
    /** list_projects — all projects with status */
    listProjects(statusFilter) {
        const notes = this.getAllNotes();
        return notes
            .filter((n) => {
            if (n.frontmatter.type !== 'project')
                return false;
            if (statusFilter && n.frontmatter.status !== statusFilter)
                return false;
            return true;
        })
            .map((n) => ({
            path: n.path,
            name: n.name,
            status: n.frontmatter.status ?? 'unknown',
            deadline: n.frontmatter.deadline,
            tags: n.frontmatter.tags ?? [],
        }));
    }
    /** get_project_context — full context for a project */
    getProjectContext(projectIdentifier) {
        const project = this.getNote(projectIdentifier);
        if (!project)
            return null;
        const allNotes = this.getAllNotes();
        // Resolve related notes from frontmatter `related:` + inline wikilinks
        const wikilinkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
        const linkedNames = new Set();
        // From frontmatter related
        for (const r of project.frontmatter.related ?? []) {
            const match = r.match(/\[\[([^\]|]+)/);
            if (match)
                linkedNames.add(path.basename(match[1]));
        }
        // From content wikilinks
        let m;
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
    findRelated(identifier, limit = 15) {
        const note = this.getNote(identifier);
        if (!note)
            return [];
        const allNotes = this.getAllNotes();
        const results = [];
        // 1. Explicit `related:` frontmatter links
        for (const r of note.frontmatter.related ?? []) {
            const match = r.match(/\[\[([^\]|]+)/);
            if (!match)
                continue;
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
        let m;
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
            if (other.path === note.path)
                continue;
            if (results.some((r) => r.path === other.path))
                continue;
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
                if (other.path === note.path)
                    continue;
                if (results.some((r) => r.path === other.path))
                    continue;
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
    extractTasks(folder, includeCompleted = false) {
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
    extractDecisions(area) {
        const notes = this.getAllNotes();
        return notes
            .filter((n) => {
            const isDecision = n.path.includes('/Decisions/') || n.frontmatter.type === 'decision';
            if (!isDecision)
                return false;
            if (area)
                return n.path.toLowerCase().includes(area.toLowerCase());
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
    extractTasksFromNotes(notes) {
        const tasks = [];
        const taskRegex = /^(\s*)-\s+\[([ xX])\]\s+(.+)$/gm;
        for (const note of notes) {
            let match;
            while ((match = taskRegex.exec(note.content)) !== null) {
                const lineNum = note.content.slice(0, match.index).split('\n').length;
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
    findDecisionsForProject(project, allNotes) {
        // Determine which area this project belongs to via tags or path
        const projectTags = project.frontmatter.tags ?? [];
        const areaHints = ['edtech', 'consulting', 'content', 'b2b'];
        let areaFolder = '';
        for (const hint of areaHints) {
            if (projectTags.some((t) => t.toLowerCase().includes(hint))) {
                if (hint === 'edtech')
                    areaFolder = 'EdTech-Company';
                else if (hint === 'consulting' || hint === 'b2b')
                    areaFolder = 'B2B-Consulting';
                else if (hint === 'content')
                    areaFolder = 'Content-Production';
                break;
            }
        }
        if (!areaFolder)
            return [];
        return allNotes
            .filter((n) => n.path.includes(areaFolder) &&
            (n.path.includes('/Decisions/') || n.frontmatter.type === 'decision'))
            .map((n) => ({
            path: n.path,
            name: n.name,
            date: n.frontmatter.created ?? 'unknown',
            frontmatter: n.frontmatter,
            preview: n.content.slice(0, 500).trim(),
        }));
    }
}
//# sourceMappingURL=vault.js.map