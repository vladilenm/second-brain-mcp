# SecondBrain MCP v0.3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe write, batch read, metadata, memory, and richer search operations needed by the Second Brain MVP.

**Architecture:** Keep `Vault` as the vault-safe domain layer and expose thin MCP wrappers in `src/index.ts`. All write operations validate paths, preserve Obsidian conventions, use content hashes for optimistic locking, and support dry-run/proposal flows before applying changes.

**Tech Stack:** Node.js, TypeScript, MCP SDK, `gray-matter`, `node:test`.

---

### Task 1: Test Harness

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`
- Create: `src/vault.test.ts`

- [x] Add a `test` script that builds the project and runs compiled `*.test.js` files with Node's built-in test runner.
- [x] Include test files in TypeScript compilation.
- [x] Write tests against real temporary vault folders.

### Task 2: Vault Read and Metadata Methods

**Files:**
- Modify: `src/types.ts`
- Modify: `src/vault.ts`
- Test: `src/vault.test.ts`

- [x] Add `listNotes`, `readNotesBatch`, `getNoteMetadata`, and `validateVaultPath`.
- [x] Return stable metadata: `path`, `name`, `title`, `folder`, `frontmatter`, `mtime`, `size`, `hash`, `links`, `backlinks`, `tags`, `lineCount`.
- [x] Reject reads and writes under excluded folders, especially `99_Private`.

### Task 3: Safe Write Methods

**Files:**
- Modify: `src/types.ts`
- Modify: `src/vault.ts`
- Test: `src/vault.test.ts`

- [x] Add `createNote` with frontmatter/content serialization, `dryRun`, and existing-file refusal.
- [x] Add `proposeNoteUpdate` that returns a diff and hashes without writing.
- [x] Add `applyNoteUpdate` that requires `confirmed: true` and a matching `expectedHash`.
- [x] Add `appendToNote` for Inbox, logs, and memory files.

### Task 4: Agent Memory

**Files:**
- Modify: `src/types.ts`
- Modify: `src/vault.ts`
- Test: `src/vault.test.ts`

- [x] Store memory under `00_Meta/AI-System`.
- [x] Add `readAgentMemory` for selected memory files.
- [x] Add `addAgentMemory` that appends dated entries to the correct memory file.

### Task 5: MCP Tools

**Files:**
- Modify: `src/index.ts`

- [x] Register MCP tools for every new Vault method.
- [x] Keep MCP tool handlers thin: validate schema, call `Vault`, return JSON.
- [x] Return `isError: true` for path validation, hash mismatch, and confirmation errors.

### Task 6: Documentation and Verification

**Files:**
- Modify: `README.md`

- [x] Document v0.3 tool table and safe-write contract.
- [x] Run `npm test`.
- [x] Run `npm run build`.
- [x] Review `git diff` for unrelated changes.
