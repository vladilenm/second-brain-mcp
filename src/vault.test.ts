import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Vault } from './vault.js';

function makeTempVault(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'secondbrain-vault-'));
  writeNote(
    root,
    '00_Meta/_Index.md',
    `---
type: moc
status: active
created: 2026-06-01
updated: 2026-06-01
tags: [meta, index]
aliases: [Home]
related: []
---

# Index

- [[AI Sprint]]
- [[MOC-AI-Prompts]]
`,
  );
  writeNote(
    root,
    '00_Meta/MOC-AI-Prompts.md',
    `---
type: moc
status: active
created: 2026-06-01
updated: 2026-06-01
tags: [meta, ai]
aliases: [AI Prompts]
related: []
---

# MOC AI Prompts

Links to [[AI Sprint]].
`,
  );
  writeNote(
    root,
    '01_Projects/AI-Sprint.md',
    `---
type: project
status: active
created: 2026-06-02
updated: 2026-06-02
tags: [ai/sprint, product]
aliases: [AI Sprint]
related: ["[[MOC-AI-Prompts]]"]
---

# AI Sprint

Project body with [[Research Note]] and sprint details.
- [ ] Ship MVP
`,
  );
  writeNote(
    root,
    '03_Resources/Research-Note.md',
    `---
type: resource
status: active
created: 2026-06-03
updated: 2026-06-03
tags: [ai/sprint]
aliases: [Research Note]
related: ["[[AI Sprint]]"]
---

# Research Note

Research content.
`,
  );
  writeNote(
    root,
    '00_Meta/Inbox.md',
    `---
type: inbox
status: active
created: 2026-06-01
updated: 2026-06-01
tags: [meta, inbox]
aliases: [Inbox]
related: ["[[Home]]"]
---

# Inbox

## Ideas

- Existing idea
`,
  );
  writeNote(root, '99_Private/Secret.md', '# Secret\n\nDo not read.\n');
  return root;
}

function writeNote(root: string, relativePath: string, content: string): void {
  const absolutePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content, 'utf-8');
}

test('lists notes with metadata while excluding private folders', () => {
  const vault = new Vault(makeTempVault()) as any;

  const result = vault.listNotes({
    folder: '01_Projects',
    type: 'project',
    status: 'active',
    limit: 10,
  });

  assert.equal(result.total, 1);
  assert.equal(result.notes[0].path, '01_Projects/AI-Sprint.md');
  assert.equal(result.notes[0].title, 'AI Sprint');
  assert.equal(result.notes[0].folder, '01_Projects');
  assert.equal(typeof result.notes[0].hash, 'string');
  assert.equal(result.notes.some((note: any) => note.path.includes('99_Private')), false);
});

test('returns note metadata with links, backlinks, and hash', () => {
  const vault = new Vault(makeTempVault()) as any;

  const metadata = vault.getNoteMetadata('01_Projects/AI-Sprint.md');

  assert.equal(metadata.path, '01_Projects/AI-Sprint.md');
  assert.deepEqual(metadata.tags, ['ai/sprint', 'product']);
  assert.equal(metadata.links.some((link: any) => link.target === 'Research Note'), true);
  assert.equal(metadata.backlinks.some((link: any) => link.path === '00_Meta/_Index.md'), true);
  assert.equal(metadata.lineCount > 1, true);
  assert.equal(typeof metadata.hash, 'string');
});

test('reads notes in batches with optional content limits', () => {
  const vault = new Vault(makeTempVault()) as any;

  const result = vault.readNotesBatch({
    paths: ['01_Projects/AI-Sprint.md', '03_Resources/Research-Note.md'],
    includeFrontmatter: true,
    includeContent: true,
    maxCharsPerNote: 20,
  });

  assert.equal(result.total, 2);
  assert.equal(result.notes[0].content.length <= 20, true);
  assert.equal(result.notes[0].frontmatter.type, 'project');
});

test('search ranks multi-token matches across aliases, tags, related links, and content', () => {
  const vault = new Vault(makeTempVault()) as any;

  const results = vault.searchKnowledge('AI Sprint', { limit: 5 });

  assert.equal(results[0].path, '01_Projects/AI-Sprint.md');
  assert.equal(results.some((result: any) => result.path === '03_Resources/Research-Note.md'), true);
  assert.equal(typeof results[0].score, 'number');
  assert.equal(results[0].matches.some((match: any) => match.field === 'alias'), true);
});

test('creates notes with frontmatter and refuses unsafe paths', () => {
  const root = makeTempVault();
  const vault = new Vault(root) as any;

  const dryRun = vault.createNote({
    path: '01_Projects/New-Idea.md',
    frontmatter: {
      type: 'project',
      status: 'active',
      tags: ['product'],
      aliases: ['New Idea'],
      related: ['[[MOC-AI-Prompts]]'],
    },
    content: '# New Idea\n\nDraft.',
    dryRun: true,
  });

  assert.equal(dryRun.wouldWrite, true);
  assert.equal(fs.existsSync(path.join(root, '01_Projects/New-Idea.md')), false);

  const created = vault.createNote({
    path: '01_Projects/New-Idea.md',
    frontmatter: {
      type: 'project',
      status: 'active',
      tags: ['product'],
      aliases: ['New Idea'],
      related: ['[[MOC-AI-Prompts]]'],
    },
    content: '# New Idea\n\nDraft.',
    ifExists: 'error',
  });

  assert.equal(created.path, '01_Projects/New-Idea.md');
  assert.equal(typeof created.hash, 'string');
  assert.equal(fs.readFileSync(path.join(root, '01_Projects/New-Idea.md'), 'utf-8').includes('type: project'), true);
  assert.throws(
    () =>
      vault.createNote({
        path: '99_Private/New-Secret.md',
        frontmatter: { type: 'resource', status: 'active', related: ['[[Home]]'] },
        content: 'Secret',
      }),
    /excluded/i,
  );
  assert.throws(
    () =>
      vault.createNote({
        path: '01_Projects/New-Idea.md',
        frontmatter: {
          type: 'project',
          status: 'active',
          tags: ['product'],
          aliases: ['New Idea'],
          related: ['[[MOC-AI-Prompts]]'],
        },
        content: '# New Idea\n\nOverwrite attempt.',
        ifExists: 'overwrite',
      }),
    /existing note/i,
  );
});

test('proposes and applies note updates only with confirmation and matching hash', () => {
  const root = makeTempVault();
  const vault = new Vault(root) as any;
  const before = vault.getNoteMetadata('01_Projects/AI-Sprint.md');

  const proposal = vault.proposeNoteUpdate({
    path: '01_Projects/AI-Sprint.md',
    expectedHash: before.hash,
    newContent: '# AI Sprint\n\nUpdated body.',
    updateReason: 'test update',
  });

  assert.equal(proposal.path, '01_Projects/AI-Sprint.md');
  assert.equal(proposal.oldHash, before.hash);
  assert.match(proposal.diff, /-Project body/);
  assert.match(proposal.diff, /\+Updated body/);
  assert.equal(vault.getNote('01_Projects/AI-Sprint.md')?.content.includes('Updated body'), false);

  assert.throws(
    () =>
      vault.applyNoteUpdate({
        path: '01_Projects/AI-Sprint.md',
        expectedHash: before.hash,
        newContent: '# AI Sprint\n\nUpdated body.',
        confirmed: false,
      }),
    /confirmed/i,
  );
  assert.throws(
    () =>
      vault.applyNoteUpdate({
        path: '01_Projects/AI-Sprint.md',
        expectedHash: 'wrong-hash',
        newContent: '# AI Sprint\n\nUpdated body.',
        confirmed: true,
      }),
    /hash/i,
  );

  const applied = vault.applyNoteUpdate({
    path: '01_Projects/AI-Sprint.md',
    expectedHash: before.hash,
    newContent: '# AI Sprint\n\nUpdated body.',
    confirmed: true,
  });

  assert.notEqual(applied.newHash, before.hash);
  assert.equal(vault.getNote('01_Projects/AI-Sprint.md')?.content.includes('Updated body'), true);
  assert.equal(
    vault.getNote('01_Projects/AI-Sprint.md')?.frontmatter.updated,
    new Date().toISOString().slice(0, 10),
  );
});

test('appends to notes and stores agent memory in 00_Meta/AI-System', () => {
  const root = makeTempVault();
  const vault = new Vault(root) as any;

  const appended = vault.appendToNote({
    path: '00_Meta/Inbox.md',
    section: 'Ideas',
    content: '- Captured from chat',
  });

  assert.equal(appended.path, '00_Meta/Inbox.md');
  assert.equal(vault.getNote('00_Meta/Inbox.md')?.content.includes('- Captured from chat'), true);

  vault.addAgentMemory({
    type: 'rule',
    content: 'Always cite vault sources.',
    sourcePath: '01_Projects/AI-Sprint.md',
    tags: ['mvp'],
  });

  const memory = vault.readAgentMemory({ files: ['rules'] });
  assert.equal(memory.files[0].path, '00_Meta/AI-System/rules.md');
  assert.equal(memory.files[0].content.includes('Always cite vault sources.'), true);
  assert.equal(memory.files[0].content.includes('source: 01_Projects/AI-Sprint.md'), true);
});

test('validates vault paths for read and write operations', () => {
  const vault = new Vault(makeTempVault()) as any;

  assert.equal(vault.validateVaultPath('01_Projects/AI-Sprint.md', 'read').allowed, true);
  assert.equal(vault.validateVaultPath('99_Private/Secret.md', 'read').allowed, false);
  assert.equal(vault.validateVaultPath('../outside.md', 'write').allowed, false);
  assert.equal(vault.validateVaultPath('01_Projects/Bad Name.md', 'write').allowed, false);
});

test('write operations enforce write-path validation', () => {
  const root = makeTempVault();
  writeNote(
    root,
    '01_Projects/Bad Name.md',
    `---
type: project
status: active
created: 2026-06-01
updated: 2026-06-01
tags: [product]
aliases: [Bad Name]
related: ["[[MOC-AI-Prompts]]"]
---

# Bad Name

Body.
`,
  );
  const vault = new Vault(root) as any;
  const metadata = vault.getNoteMetadata('01_Projects/Bad Name.md');

  assert.throws(
    () =>
      vault.applyNoteUpdate({
        path: '01_Projects/Bad Name.md',
        expectedHash: metadata.hash,
        newContent: '# Bad Name\n\nUpdated.',
        confirmed: true,
      }),
    /spaces/i,
  );
});
