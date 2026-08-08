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

import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceLeaf } from 'obsidian';
import type NotebookNavigatorPlugin from '../../src/main';
import { PropertyNoteSidebarService } from '../../src/services/workspace/PropertyNoteSidebarService';
import { createTestTFile } from '../utils/createTestTFile';

interface TestLeaf {
    leaf: WorkspaceLeaf;
    openFile: ReturnType<typeof vi.fn>;
}

interface TestWorkspace {
    rootSplit: object;
    leftSplit: object;
    rightSplit: object;
    /** Leaves the stub workspace still owns, which is what iterateAllLeaves walks */
    attachedLeaves: WorkspaceLeaf[];
    getRightLeaf: ReturnType<typeof vi.fn>;
    iterateAllLeaves: ReturnType<typeof vi.fn>;
    revealLeaf: ReturnType<typeof vi.fn>;
    /** Every leaf getRightLeaf(true) handed out, oldest first */
    createdLeaves: TestLeaf[];
}

/**
 * A workspace whose getRightLeaf(true) splits, creating a fresh right sidebar leaf on every
 * call. That is the real behavior that made property notes stack up before the service.
 */
function createTestWorkspace(): TestWorkspace {
    const rightSplit = {};
    const createdLeaves: TestLeaf[] = [];
    const attachedLeaves: WorkspaceLeaf[] = [];

    const workspace: TestWorkspace = {
        rootSplit: {},
        leftSplit: {},
        rightSplit,
        attachedLeaves,
        createdLeaves,
        getRightLeaf: vi.fn((split: boolean) => {
            if (!split) {
                return null;
            }

            const openFile = vi.fn().mockResolvedValue(undefined);
            const leaf = {
                parent: rightSplit,
                openFile
            } as unknown as WorkspaceLeaf;
            createdLeaves.push({ leaf, openFile });
            attachedLeaves.push(leaf);
            return leaf;
        }),
        iterateAllLeaves: vi.fn((callback: (leaf: WorkspaceLeaf) => void) => {
            attachedLeaves.slice().forEach(callback);
        }),
        revealLeaf: vi.fn().mockResolvedValue(undefined)
    };

    return workspace;
}

function createTestPlugin(workspace: TestWorkspace): NotebookNavigatorPlugin {
    return {
        app: { workspace }
    } as unknown as NotebookNavigatorPlugin;
}

/** Removes a leaf from the workspace, the way leaf.detach() does */
function detachLeaf(workspace: TestWorkspace, leaf: WorkspaceLeaf): void {
    workspace.attachedLeaves.splice(workspace.attachedLeaves.indexOf(leaf), 1);
}

describe('PropertyNoteSidebarService', () => {
    it('creates a right sidebar leaf on the first open and opens the note without focus', async () => {
        const workspace = createTestWorkspace();
        const service = new PropertyNoteSidebarService(createTestPlugin(workspace));
        const propertyNote = createTestTFile('References/Apple.md');

        await service.openPropertyNote(propertyNote);

        expect(workspace.getRightLeaf).toHaveBeenCalledTimes(1);
        expect(workspace.getRightLeaf).toHaveBeenCalledWith(true);
        expect(workspace.createdLeaves).toHaveLength(1);
        expect(workspace.createdLeaves[0].openFile).toHaveBeenCalledWith(propertyNote, { active: false });
        expect(workspace.revealLeaf).toHaveBeenCalledWith(workspace.createdLeaves[0].leaf);
    });

    it('reuses the tracked leaf on later opens instead of stacking new ones', async () => {
        const workspace = createTestWorkspace();
        const service = new PropertyNoteSidebarService(createTestPlugin(workspace));
        const firstNote = createTestTFile('References/Apple.md');
        const secondNote = createTestTFile('References/Banana.md');
        const thirdNote = createTestTFile('References/Cherry.md');

        await service.openPropertyNote(firstNote);
        await service.openPropertyNote(secondNote);
        await service.openPropertyNote(thirdNote);

        expect(workspace.createdLeaves).toHaveLength(1);
        expect(workspace.attachedLeaves).toHaveLength(1);
        const companion = workspace.createdLeaves[0];
        expect(companion.openFile).toHaveBeenCalledTimes(3);
        expect(companion.openFile).toHaveBeenNthCalledWith(2, secondNote, { active: false });
        expect(companion.openFile).toHaveBeenNthCalledWith(3, thirdNote, { active: false });
    });

    it('does not reuse a tracked leaf the user moved out of the right sidebar', async () => {
        const workspace = createTestWorkspace();
        const service = new PropertyNoteSidebarService(createTestPlugin(workspace));

        await service.openPropertyNote(createTestTFile('References/Apple.md'));
        const movedLeaf = workspace.createdLeaves[0];
        (movedLeaf.leaf as unknown as { parent: object }).parent = workspace.rootSplit;

        const secondNote = createTestTFile('References/Banana.md');
        await service.openPropertyNote(secondNote);

        expect(workspace.createdLeaves).toHaveLength(2);
        expect(movedLeaf.openFile).toHaveBeenCalledTimes(1);
        expect(workspace.createdLeaves[1].openFile).toHaveBeenCalledWith(secondNote, { active: false });
    });

    it('does not reuse a tracked leaf the user closed', async () => {
        const workspace = createTestWorkspace();
        const service = new PropertyNoteSidebarService(createTestPlugin(workspace));

        await service.openPropertyNote(createTestTFile('References/Apple.md'));
        const closedLeaf = workspace.createdLeaves[0];
        // A detached leaf keeps its parent reference, so only the workspace knows it is gone.
        detachLeaf(workspace, closedLeaf.leaf);

        const secondNote = createTestTFile('References/Banana.md');
        await service.openPropertyNote(secondNote);

        expect(workspace.createdLeaves).toHaveLength(2);
        expect(closedLeaf.openFile).toHaveBeenCalledTimes(1);
        expect(workspace.createdLeaves[1].openFile).toHaveBeenCalledWith(secondNote, { active: false });
    });

    it('does nothing when the workspace cannot provide a right sidebar leaf', async () => {
        const workspace = createTestWorkspace();
        workspace.getRightLeaf.mockReturnValue(null);
        const service = new PropertyNoteSidebarService(createTestPlugin(workspace));

        await service.openPropertyNote(createTestTFile('References/Apple.md'));

        expect(workspace.getRightLeaf).toHaveBeenCalledTimes(2);
        expect(workspace.revealLeaf).not.toHaveBeenCalled();
    });
});
