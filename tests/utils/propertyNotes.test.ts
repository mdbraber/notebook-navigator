/*
 * Notebook Navigator - Plugin for Obsidian
 * Copyright (c) 2025-2026 Johan Sanneblad
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
import { App, TFolder } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { strings } from '../../src/i18n';
import { CommandQueueService } from '../../src/services/CommandQueueService';
import type { PropertyTreeNode } from '../../src/types/storage';
import { showNotice } from '../../src/utils/noticeUtils';
import { buildPropertyValueNodeId } from '../../src/utils/propertyTree';
import { createPropertyNote, openPropertyNoteFile } from '../../src/utils/propertyNotes';
import { createTestTFile } from './createTestTFile';

// createPropertyNote's failure paths surface via Notice; spying on the real stub would touch the
// DOM for no benefit, so the module is mocked and each notice call is asserted directly instead.
vi.mock('../../src/utils/noticeUtils', () => ({
    showNotice: vi.fn()
}));

// Copied from tests/utils/propertyNoteLookup.test.ts per task instructions (copy the helper
// pattern in rather than importing across test files).
function createValueNode(key: string, valuePath: string, assignmentValue: string | undefined, notes: string[] = []): PropertyTreeNode {
    return {
        id: buildPropertyValueNodeId(key, valuePath),
        kind: 'value',
        key,
        valuePath,
        name: valuePath,
        displayPath: valuePath,
        assignmentValue,
        children: new Map(),
        notesWithValue: new Set(notes)
    };
}

/**
 * An App stub for createPropertyNote tests: `folderName` already exists as a TFolder,
 * links never resolve by default, `fileManager.createNewMarkdownFile` creates and "registers"
 * a markdown file at the requested path (this is the real creation path
 * `createMarkdownFileFromTemplatePreferTemplater` takes when `templatePath` is null - it is
 * NOT `vault.create`), and the active leaf's `openFile` is a spy.
 */
function createAppWithFolder(folderName: string): App {
    const app = new App();
    const folder = new TFolder(folderName);

    app.vault.getAbstractFileByPath = (path: string) => (path === folderName ? folder : null);
    app.metadataCache.getFirstLinkpathDest = () => null;
    app.fileManager.createNewMarkdownFile = async (parent: TFolder, baseName: string) => createTestTFile(`${parent.path}/${baseName}.md`);
    app.workspace.getLeaf = vi.fn().mockReturnValue({ openFile: vi.fn().mockResolvedValue(undefined) });

    return app;
}

function createDeferredVoid(): { promise: Promise<void>; resolve: () => void } {
    let resolveFn: (() => void) | null = null;
    const promise = new Promise<void>(resolve => {
        resolveFn = () => resolve(undefined);
    });
    if (!resolveFn) {
        throw new Error('Deferred promise resolver not initialized');
    }
    return { promise, resolve: resolveFn };
}

describe('openPropertyNoteFile', () => {
    it('opens in the active leaf when no context is given', async () => {
        const app = new App();
        const openFile = vi.fn().mockResolvedValue(undefined);
        const getLeaf = vi.fn().mockReturnValue({ openFile });
        app.workspace.getLeaf = getLeaf;
        const file = createTestTFile('Apple.md');

        await openPropertyNoteFile({ app, commandQueue: null, propertyNote: file, context: null });

        expect(getLeaf).toHaveBeenCalledWith(false);
        expect(openFile).toHaveBeenCalledWith(file, { active: true });
    });

    it('honors an explicit inactive open', async () => {
        const app = new App();
        const openFile = vi.fn().mockResolvedValue(undefined);
        app.workspace.getLeaf = vi.fn().mockReturnValue({ openFile });
        const file = createTestTFile('Apple.md');

        await openPropertyNoteFile({ app, commandQueue: null, propertyNote: file, context: null, active: false });

        expect(openFile).toHaveBeenCalledWith(file, { active: false });
    });

    it('opens in the right sidebar when asked', async () => {
        const app = new App();
        const openFile = vi.fn().mockResolvedValue(undefined);
        const leaf = { openFile };
        const revealLeaf = vi.fn().mockResolvedValue(undefined);
        app.workspace.getRightLeaf = vi.fn().mockReturnValue(leaf);
        app.workspace.revealLeaf = revealLeaf;
        const file = createTestTFile('Apple.md');

        await openPropertyNoteFile({ app, commandQueue: null, propertyNote: file, context: 'right-sidebar' });

        expect(openFile).toHaveBeenCalledWith(file, { active: false });
        expect(revealLeaf).toHaveBeenCalledWith(leaf);
    });

    it('does nothing when the right sidebar has no leaf', async () => {
        const app = new App();
        const revealLeaf = vi.fn();
        app.workspace.getRightLeaf = vi.fn().mockReturnValue(null);
        app.workspace.revealLeaf = revealLeaf;
        const file = createTestTFile('Apple.md');

        await openPropertyNoteFile({ app, commandQueue: null, propertyNote: file, context: 'right-sidebar' });

        expect(revealLeaf).not.toHaveBeenCalled();
    });

    it('does nothing when there is no active leaf', async () => {
        const app = new App();
        app.workspace.getLeaf = vi.fn().mockReturnValue(null);
        const file = createTestTFile('Apple.md');

        await expect(openPropertyNoteFile({ app, commandQueue: null, propertyNote: file, context: null })).resolves.toBeUndefined();
    });

    it('opens directly, without touching the command queue, when none is supplied', async () => {
        const app = new App();
        const openFile = vi.fn().mockResolvedValue(undefined);
        app.workspace.getLeaf = vi.fn().mockReturnValue({ openFile });
        const file = createTestTFile('Apple.md');

        await openPropertyNoteFile({ app, commandQueue: null, propertyNote: file, context: null });

        expect(openFile).toHaveBeenCalledWith(file, { active: true });
    });

    it('routes the open through the command queue when one is supplied', async () => {
        const app = new App();
        const openFile = vi.fn().mockResolvedValue(undefined);
        app.workspace.getLeaf = vi.fn().mockReturnValue({ openFile });
        const file = createTestTFile('Apple.md');
        const commandQueue = new CommandQueueService();
        const executeSpy = vi.spyOn(commandQueue, 'executeOpenPropertyNote');

        await openPropertyNoteFile({ app, commandQueue, propertyNote: file, context: null });

        expect(executeSpy).toHaveBeenCalledWith(file.path, expect.any(Function));
        expect(openFile).toHaveBeenCalledWith(file, { active: true });
    });

    it('marks the command queue as opening a property note for the duration of the open', async () => {
        const app = new App();
        const gate = createDeferredVoid();
        const openFile = vi.fn(async () => gate.promise);
        app.workspace.getLeaf = vi.fn().mockReturnValue({ openFile });
        const file = createTestTFile('Apple.md');
        const commandQueue = new CommandQueueService();

        expect(commandQueue.isOpeningPropertyNote()).toBe(false);

        const task = openPropertyNoteFile({ app, commandQueue, propertyNote: file, context: null });
        await Promise.resolve();

        expect(commandQueue.isOpeningPropertyNote()).toBe(true);

        gate.resolve();
        await task;

        // The operation ends with the open; outliving it is the path-keyed suppression's job.
        expect(commandQueue.isOpeningPropertyNote()).toBe(false);
        expect(commandQueue.shouldSuppressNoteOpenReveal(file.path)).toBe(true);
    });

    // Auto-reveal observes this from a macrotask: workspaceActiveFileEvents coalesces file-open /
    // active-leaf-change through a re-armed window.setTimeout(cb, 0), and Obsidian may not fire
    // file-open until after openFile() resolves. Whenever that observation lands, the suppression
    // must still be there, or the navigator jumps to the note's folder and destroys the selection.
    it('suppresses the reveal for an observation scheduled during the open', async () => {
        const app = new App();
        const file = createTestTFile('Apple.md');
        const commandQueue = new CommandQueueService();

        let observedFlag: boolean | null = null;
        const observed = new Promise<void>(resolve => {
            const openFile = vi.fn().mockImplementation(() => {
                // Mirrors how the reveal handler observes the flag: a setTimeout(0) macrotask
                // scheduled while the open is in flight.
                window.setTimeout(() => {
                    observedFlag = commandQueue.shouldSuppressNoteOpenReveal(file.path);
                    resolve();
                }, 0);
                return Promise.resolve();
            });
            app.workspace.getLeaf = vi.fn().mockReturnValue({ openFile });
        });

        await openPropertyNoteFile({ app, commandQueue, propertyNote: file, context: null });
        await observed;

        expect(observedFlag).toBe(true);
    });
});

describe('createPropertyNote', () => {
    it('creates a bare link in the configured folder', async () => {
        const app = createAppWithFolder('References');
        const node = createValueNode('references', 'apple', '[[Apple]]', ['note.md']);

        const file = await createPropertyNote({
            app,
            commandQueue: null,
            node,
            propertyNoteFolder: 'References',
            openContext: null
        });

        expect(file?.path).toBe('References/Apple.md');
    });

    it('creates a pathed link at its own path, ignoring the folder setting', async () => {
        const app = createAppWithFolder('Fruits');
        const node = createValueNode('references', 'fruits/apple', '[[Fruits/Apple]]', ['note.md']);

        const file = await createPropertyNote({
            app,
            commandQueue: null,
            node,
            propertyNoteFolder: 'References',
            openContext: null
        });

        // The folder setting cannot apply: [[Fruits/Apple]] resolves only to Fruits/Apple.md,
        // so creating it anywhere else would leave the value still showing as having no note.
        expect(file?.path).toBe('Fruits/Apple.md');
    });

    it('returns null for a plain string value', async () => {
        const app = createAppWithFolder('References');
        const node = createValueNode('status', 'draft', 'draft', ['note.md']);

        expect(await createPropertyNote({ app, commandQueue: null, node, propertyNoteFolder: 'References', openContext: null })).toBeNull();
    });

    it('returns null when the link already resolves', async () => {
        const app = createAppWithFolder('References');
        app.metadataCache.getFirstLinkpathDest = () => createTestTFile('Apple.md');
        const node = createValueNode('references', 'apple', '[[Apple]]', ['note.md']);

        expect(await createPropertyNote({ app, commandQueue: null, node, propertyNoteFolder: 'References', openContext: null })).toBeNull();
    });

    it('does not overwrite an existing file at the target path', async () => {
        const app = createAppWithFolder('References');
        // The link does not resolve, but something else already occupies the path.
        app.vault.getAbstractFileByPath = (path: string) =>
            path === 'References/Apple.md' ? createTestTFile('References/Apple.md') : null;
        const node = createValueNode('references', 'apple', '[[Apple]]', ['note.md']);

        expect(await createPropertyNote({ app, commandQueue: null, node, propertyNoteFolder: 'References', openContext: null })).toBeNull();
    });

    // Same scenario as above, but layered on top of createAppWithFolder's lookup instead of
    // replacing it outright, so the configured folder still resolves normally and the collision
    // check at the note's own path is what actually returns null.
    it('does not overwrite an existing file at the target path, with folder resolution intact', async () => {
        const app = createAppWithFolder('References');
        const baseLookup = app.vault.getAbstractFileByPath.bind(app.vault);
        app.vault.getAbstractFileByPath = (path: string) =>
            path === 'References/Apple.md' ? createTestTFile('References/Apple.md') : baseLookup(path);
        const node = createValueNode('references', 'apple', '[[Apple]]', ['note.md']);

        const createNewMarkdownFile = vi.fn();
        app.fileManager.createNewMarkdownFile = createNewMarkdownFile;

        expect(await createPropertyNote({ app, commandQueue: null, node, propertyNoteFolder: 'References', openContext: null })).toBeNull();
        expect(createNewMarkdownFile).not.toHaveBeenCalled();
    });

    it('opens the created note through the command queue so auto-reveal is suppressed', async () => {
        const app = createAppWithFolder('References');
        const commandQueue = new CommandQueueService();
        const node = createValueNode('references', 'apple', '[[Apple]]', ['note.md']);

        const file = await createPropertyNote({ app, commandQueue, node, propertyNoteFolder: 'References', openContext: null });

        expect(file).not.toBeNull();
        expect(commandQueue.shouldSuppressNoteOpenReveal(file!.path)).toBe(true);
    });

    it('defers to Obsidian’s default new-file location when the folder setting is empty', async () => {
        const app = createAppWithFolder('References');
        const defaultFolder = new TFolder('Inbox');
        const getNewFileParent = vi.fn().mockReturnValue(defaultFolder);
        app.fileManager.getNewFileParent = getNewFileParent;
        const node = createValueNode('references', 'apple', '[[Apple]]', ['note.md']);

        const file = await createPropertyNote({ app, commandQueue: null, node, propertyNoteFolder: '', openContext: null });

        expect(getNewFileParent).toHaveBeenCalledWith('note.md');
        expect(file?.path).toBe('Inbox/Apple.md');
    });

    it('creates the configured folder when it does not exist yet', async () => {
        const app = new App();
        let folderCreated = false;
        app.vault.getAbstractFileByPath = (path: string) => {
            if (path === 'References') {
                return folderCreated ? new TFolder('References') : null;
            }
            return null;
        };
        const createFolder = vi.fn().mockImplementation(async () => {
            folderCreated = true;
            return new TFolder('References');
        });
        app.vault.createFolder = createFolder;
        app.fileManager.createNewMarkdownFile = async (parent: TFolder, baseName: string) =>
            createTestTFile(`${parent.path}/${baseName}.md`);
        app.workspace.getLeaf = vi.fn().mockReturnValue({ openFile: vi.fn().mockResolvedValue(undefined) });
        const node = createValueNode('references', 'apple', '[[Apple]]', ['note.md']);

        const file = await createPropertyNote({ app, commandQueue: null, node, propertyNoteFolder: 'References', openContext: null });

        expect(createFolder).toHaveBeenCalledWith('References');
        expect(file?.path).toBe('References/Apple.md');
    });

    // Regression test for a bug where the pre-check and the post-createFolder check both looked
    // up the raw, un-normalized "References/" while vault.createFolder normalizes internally, so
    // an otherwise-valid, existing folder path silently resolved to null.
    it('resolves a trailing-slash folder path and creates the note', async () => {
        const app = createAppWithFolder('References');
        const node = createValueNode('references', 'apple', '[[Apple]]', ['note.md']);

        const file = await createPropertyNote({
            app,
            commandQueue: null,
            node,
            propertyNoteFolder: 'References/',
            openContext: null
        });

        expect(file?.path).toBe('References/Apple.md');
    });

    it('returns null and shows a notice when a file occupies the configured folder path', async () => {
        const app = new App();
        app.vault.getAbstractFileByPath = (path: string) => (path === 'References' ? createTestTFile('References') : null);
        const createNewMarkdownFile = vi.fn();
        app.fileManager.createNewMarkdownFile = createNewMarkdownFile;
        const node = createValueNode('references', 'apple', '[[Apple]]', ['note.md']);

        expect(await createPropertyNote({ app, commandQueue: null, node, propertyNoteFolder: 'References', openContext: null })).toBeNull();
        expect(createNewMarkdownFile).not.toHaveBeenCalled();
        expect(showNotice).toHaveBeenCalledWith(strings.fileSystem.errors.propertyNoteFolderUnavailable, { variant: 'warning' });
    });
});

describe('createPropertyNote refuses a basename that would not be the file the link points at', () => {
    // Each of these currently-buggy inputs previously created a junk file: a heading/block anchor
    // or an explicit extension leaking into the created filename, or a Windows-forbidden character
    // reaching createNewMarkdownFile unfiltered. Refusing is correct here because "{baseName}.md"
    // would not be the file the wikilink actually points at.
    it.each<[string, string]>([
        ['[[Book#Chapter 3]]', 'a heading anchor'],
        ['[[Apple#^abc123]]', 'a block anchor'],
        ['[[Apple.md]]', 'an explicit .md extension'],
        ['[[Board.canvas]]', 'an explicit non-md extension'],
        ['[[A?B]]', 'a Windows-forbidden character']
    ])('returns null and creates nothing for %s (%s)', async assignmentValue => {
        const app = createAppWithFolder('References');
        const createNewMarkdownFile = vi.fn();
        app.fileManager.createNewMarkdownFile = createNewMarkdownFile;
        const node = createValueNode('references', 'value', assignmentValue, ['note.md']);

        const file = await createPropertyNote({ app, commandQueue: null, node, propertyNoteFolder: 'References', openContext: null });

        expect(file).toBeNull();
        expect(createNewMarkdownFile).not.toHaveBeenCalled();
        expect(showNotice).toHaveBeenCalledWith(strings.fileSystem.errors.propertyNoteInvalidTarget, { variant: 'warning' });
    });
});
