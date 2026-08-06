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
import { App, TFile, TFolder } from 'obsidian';
import type { ISettingsProvider } from '../../src/interfaces/ISettingsProvider';
import { RecentNotesService } from '../../src/services/RecentNotesService';
import { DEFAULT_SETTINGS } from '../../src/settings/defaultSettings';
import type { NotebookNavigatorSettings, RecentNotesHideMode } from '../../src/settings/types';
import type { CollapsedPinnedContexts } from '../../src/types';
import type { PropertyTreeNode } from '../../src/types/storage';
import { buildPropertyKeyNodeId, buildPropertyValueNodeId } from '../../src/utils/propertyTree';
import { createTestTFile } from '../utils/createTestTFile';

/** Minimal ISettingsProvider stub. Only getRecentNotes/setRecentNotes are exercised by RecentNotesService. */
class TestSettingsProvider implements ISettingsProvider {
    private recentNotes: string[] = [];

    constructor(public settings: NotebookNavigatorSettings) {}

    saveSettingsAndUpdate = vi.fn().mockResolvedValue(undefined);

    notifySettingsUpdate(): void {}

    getRecentNotes(): string[] {
        return this.recentNotes;
    }

    setRecentNotes = vi.fn((recentNotes: string[]) => {
        this.recentNotes = recentNotes;
    });

    getRecentIcons(): Record<string, string[]> {
        return {};
    }

    setRecentIcons(): void {}

    getRecentColors(): string[] {
        return [];
    }

    setRecentColors(): void {}

    getCollapsedPinnedContexts(): CollapsedPinnedContexts {
        return {};
    }

    updateCollapsedPinnedContexts(mutator: (record: CollapsedPinnedContexts) => boolean): boolean {
        return mutator({});
    }
}

function createValueNode(key: string, valuePath: string, assignmentValue: string | undefined): PropertyTreeNode {
    return {
        id: buildPropertyValueNodeId(key, valuePath),
        kind: 'value',
        key,
        valuePath,
        name: valuePath,
        displayPath: valuePath,
        assignmentValue,
        children: new Map(),
        notesWithValue: new Set()
    };
}

function createKeyNode(key: string, children: PropertyTreeNode[]): PropertyTreeNode {
    const node: PropertyTreeNode = {
        id: buildPropertyKeyNodeId(key),
        kind: 'key',
        key,
        valuePath: null,
        name: key,
        displayPath: key,
        children: new Map(),
        notesWithValue: new Set()
    };

    for (const child of children) {
        node.children.set(child.valuePath as string, child);
    }

    return node;
}

function createApp(dest: TFile | null): { app: App; getFirstLinkpathDest: ReturnType<typeof vi.fn> } {
    const app = new App();
    const getFirstLinkpathDest = vi.fn(() => dest);
    app.metadataCache.getFirstLinkpathDest = getFirstLinkpathDest;
    return { app, getFirstLinkpathDest };
}

describe('RecentNotesService — hideRecentNotes property-note filtering', () => {
    const targetFile = createTestTFile('Fruits/Apple.md');

    function buildPropertyTree(assignmentValue: string | undefined): ReadonlyMap<string, PropertyTreeNode> {
        const valueNode = createValueNode('references', 'apple', assignmentValue);
        const keyNode = createKeyNode('references', [valueNode]);
        return new Map([[keyNode.id, keyNode]]);
    }

    function createService(mode: RecentNotesHideMode, enablePropertyNotes: boolean, assignmentValue: string | undefined) {
        const settingsProvider = new TestSettingsProvider({
            ...DEFAULT_SETTINGS,
            hideRecentNotes: mode,
            enablePropertyNotes
        });
        const { app, getFirstLinkpathDest } = createApp(targetFile);
        const propertyTree = buildPropertyTree(assignmentValue);
        const service = new RecentNotesService(settingsProvider, app, () => propertyTree);
        return { service, settingsProvider, getFirstLinkpathDest };
    }

    it('skips a file that is the target of a [[Apple]] value when mode is property-notes and the feature is enabled', () => {
        const { service, settingsProvider } = createService('property-notes', true, '[[Apple]]');
        expect(service.recordFileOpen(targetFile)).toBe(false);
        expect(settingsProvider.setRecentNotes).not.toHaveBeenCalled();
    });

    it('skips the same file when mode is all-notes and the feature is enabled', () => {
        const { service } = createService('all-notes', true, '[[Apple]]');
        expect(service.recordFileOpen(targetFile)).toBe(false);
    });

    it('does not skip when mode is none', () => {
        const { service } = createService('none', true, '[[Apple]]');
        expect(service.recordFileOpen(targetFile)).toBe(true);
    });

    it('does not skip a property-note target when mode is folder-notes', () => {
        const { service } = createService('folder-notes', true, '[[Apple]]');
        expect(service.recordFileOpen(targetFile)).toBe(true);
    });

    it('does not skip when mode is property-notes but enablePropertyNotes is false', () => {
        const { service } = createService('property-notes', false, '[[Apple]]');
        expect(service.recordFileOpen(targetFile)).toBe(true);
    });

    // A non-wikilink value is never treated as a property note: resolution never even reaches
    // getFirstLinkpathDest, so the outcome does not depend on that lookup resolving the plain
    // string the same way it would resolve a wikilink target.
    it('does not skip a plain string value, and never calls getFirstLinkpathDest to decide that', () => {
        const { service, getFirstLinkpathDest } = createService('property-notes', true, 'Apple');
        expect(service.recordFileOpen(targetFile)).toBe(true);
        expect(getFirstLinkpathDest).toHaveBeenCalledTimes(0);
    });
});

// shouldSkipFile owns the shipped hideRecentNotes: 'folder-notes' behaviour. The suite above only
// exercises the property-note branch added on this branch; without these, a real folder note being
// hidden (or not) is protected only by code review.
describe('RecentNotesService — hideRecentNotes folder-note filtering', () => {
    /** A folder note: basename matches its parent folder's name, with folderNoteName: '' so the default rule applies. */
    function createFolderNoteFixture(): { folder: TFolder; folderNote: TFile } {
        const folder = new TFolder('Fruits') as TFolder & { name: string; parent: TFolder | null };
        folder.name = 'Fruits';
        folder.parent = null;

        const folderNote = createTestTFile('Fruits/Fruits.md') as TFile & { parent: TFolder };
        folderNote.parent = folder;

        return { folder, folderNote };
    }

    function createService(mode: RecentNotesHideMode) {
        const settingsProvider = new TestSettingsProvider({
            ...DEFAULT_SETTINGS,
            hideRecentNotes: mode,
            folderNoteName: ''
        });
        const app = new App();
        const service = new RecentNotesService(settingsProvider, app, () => null);
        return { service, settingsProvider };
    }

    it('hides a real folder note when mode is folder-notes', () => {
        const { folderNote } = createFolderNoteFixture();
        const { service } = createService('folder-notes');
        expect(service.recordFileOpen(folderNote)).toBe(false);
    });

    it('hides a real folder note when mode is all-notes', () => {
        const { folderNote } = createFolderNoteFixture();
        const { service } = createService('all-notes');
        expect(service.recordFileOpen(folderNote)).toBe(false);
    });

    it('does not hide a real folder note when mode is none', () => {
        const { folderNote } = createFolderNoteFixture();
        const { service } = createService('none');
        expect(service.recordFileOpen(folderNote)).toBe(true);
    });

    it('does not hide a real folder note when mode is property-notes', () => {
        const { folderNote } = createFolderNoteFixture();
        const { service } = createService('property-notes');
        expect(service.recordFileOpen(folderNote)).toBe(true);
    });
});
