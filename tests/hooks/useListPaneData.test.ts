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

import React, { useState } from 'react';
import { App, TFile } from 'obsidian';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/settings/defaultSettings';
import type { NotebookNavigatorSettings } from '../../src/settings/types';
import { PropertyTreeService } from '../../src/services/PropertyTreeService';
import { ItemType } from '../../src/types';
import type { PropertyTreeNode } from '../../src/types/storage';
import { buildPropertyHierarchyIndex, createPropertyNoteCountInfo, type PropertyHierarchyIndex } from '../../src/utils/propertyHierarchy';
import { buildPropertyKeyNodeId, buildPropertyValueNodeId } from '../../src/utils/propertyTree';
import { useListPaneData } from '../../src/hooks/useListPaneData';
import { createTestTFile } from '../utils/createTestTFile';

const app = new App();
const propertyTreeService = new PropertyTreeService();

/** Only reached for tag and search lookups, which these fixtures never trigger. */
const stubDb = {
    getFile: () => null,
    getFiles: () => []
};

vi.mock('../../src/context/ServicesContext', () => ({
    useServices: () => ({
        app,
        tagTreeService: null,
        propertyTreeService,
        commandQueue: null,
        omnisearchService: null
    }),
    useFileSystemOps: () => null
}));

vi.mock('../../src/context/StorageContext', () => ({
    useFileCache: () => ({
        getFileTimestamps: (path: string) => ({ ctime: 0, mtime: 0, path }),
        getDB: () => stubDb,
        getFileDisplayName: (file: TFile) => file.basename
    })
}));

const PROJECTS_KEY_NODE_ID = buildPropertyKeyNodeId('projects');
const valueNodeId = (value: string) => buildPropertyValueNodeId('projects', value.toLowerCase());

/**
 * Fiddle with Building software nested under it, the shape the author's vault produces: the note
 * Building software.md carries projects: [[Fiddle]], so resolving that link makes Fiddle its parent.
 * Fiddle's own notes are 2 and its subtree's are 4, so the flat and hierarchical answers differ.
 */
const VALUE_FIXTURES: { value: string; notes: string[] }[] = [
    { value: 'Fiddle', notes: ['Building software.md', 'fiddle-note.md'] },
    { value: 'Building software', notes: ['bulwark.md', 'shipwright.md'] }
];

function createProjectsTree(): Map<string, PropertyTreeNode> {
    const keyNode: PropertyTreeNode = {
        id: PROJECTS_KEY_NODE_ID,
        kind: 'key',
        key: 'projects',
        valuePath: null,
        name: 'projects',
        displayPath: 'projects',
        children: new Map(),
        notesWithValue: new Set()
    };

    VALUE_FIXTURES.forEach(entry => {
        keyNode.children.set(valueNodeId(entry.value), {
            id: valueNodeId(entry.value),
            kind: 'value',
            key: 'projects',
            valuePath: entry.value.toLowerCase(),
            name: entry.value,
            displayPath: entry.value,
            assignmentValue: `[[${entry.value}]]`,
            children: new Map(),
            notesWithValue: new Set(entry.notes)
        });
        entry.notes.forEach(note => keyNode.notesWithValue.add(note));
    });

    return new Map([['projects', keyNode]]);
}

const propertyTree = createProjectsTree();
propertyTreeService.updatePropertyTree(propertyTree);

interface TestVaultMethods {
    registerFile(file: TFile): void;
}

VALUE_FIXTURES.flatMap(entry => entry.notes).forEach(path => {
    (app.vault as App['vault'] & TestVaultMethods).registerFile(createTestTFile(path));
});

const profile = {
    ...DEFAULT_SETTINGS.vaultProfiles[0],
    propertyKeys: [{ key: 'projects', showInNavigation: true, showInList: true, showInFileMenu: true }]
};

/**
 * Both settings objects share every field but propertyHierarchicalKeys, by reference, so a recompute of
 * the base file set can only come from that one dependency changing.
 */
const FLAT_SETTINGS: NotebookNavigatorSettings = {
    ...DEFAULT_SETTINGS,
    vaultProfiles: [profile],
    showTags: false,
    showFileTags: false,
    showProperties: true,
    propertyHierarchicalKeys: {}
};
const HIERARCHICAL_SETTINGS: NotebookNavigatorSettings = {
    ...FLAT_SETTINGS,
    propertyHierarchicalKeys: { projects: true }
};

const activeProfile = {
    profile,
    hiddenFolders: [],
    descendantExcludedFolders: [],
    hiddenFileProperties: [],
    hiddenFileNames: [],
    hiddenTags: [],
    hiddenFileTags: [],
    fileVisibility: profile.fileVisibility,
    propertyKeys: profile.propertyKeys,
    navigationBanner: null
};
const visibility = { includeDescendantNotes: true, showHiddenItems: false };
const collapsedListGroups: ReadonlySet<string> = new Set();

const indexBySettings = new Map<NotebookNavigatorSettings, PropertyHierarchyIndex>();

/** The index the navigation pane would build for these settings, memoised so its identity is stable. */
function indexForSettings(settings: NotebookNavigatorSettings): PropertyHierarchyIndex {
    const cached = indexBySettings.get(settings);
    if (cached) {
        return cached;
    }

    const index = buildPropertyHierarchyIndex({
        tree: propertyTree,
        hierarchicalKeys: new Set(
            Object.entries(settings.propertyHierarchicalKeys ?? {})
                .filter(([, enabled]) => enabled === true)
                .map(([key]) => key)
        ),
        resolveValueNotePath: node => {
            const match = /^\[\[([^\]|]+)\]\]$/.exec(node.assignmentValue ?? '');
            return match ? `${match[1]}.md` : null;
        }
    });
    indexBySettings.set(settings, index);
    return index;
}

interface Observation {
    badge: number;
    list: number;
}

/**
 * Renders useListPaneData once per settings object in a single component instance, using a render phase
 * state update so React keeps the hook's memo caches between passes. That is what makes the base file
 * memo's dependency list observable: a fresh render would rebuild every memo regardless.
 *
 * Each pass mirrors NotebookNavigatorComponent, which writes the index onto the property tree service
 * during render, and reads the badge from the same index the list resolves through.
 */
function observeTransition(settingsByPhase: NotebookNavigatorSettings[]): Observation[] {
    const observations: Observation[] = [];

    function Probe() {
        const [phase, setPhase] = useState(0);
        const settings = settingsByPhase[phase];
        const index = indexForSettings(settings);
        propertyTreeService.updateHierarchyIndex(index);

        const result = useListPaneData({
            selectionType: ItemType.PROPERTY,
            selectedFolder: null,
            selectedTag: null,
            selectedProperty: valueNodeId('Fiddle'),
            settings,
            activeProfile,
            groupBy: 'none',
            pinnedGroupExpanded: true,
            collapsedListGroups,
            searchProvider: 'internal',
            visibility
        });

        const fiddleNode = propertyTree.get('projects')?.children.get(valueNodeId('Fiddle'));
        if (!fiddleNode) {
            throw new Error('Expected the Fiddle value node');
        }

        observations.push({
            badge: createPropertyNoteCountInfo(fiddleNode, index, visibility.includeDescendantNotes).total,
            list: result.files.length
        });

        if (phase < settingsByPhase.length - 1) {
            setPhase(phase + 1);
        }
        return null;
    }

    renderToStaticMarkup(React.createElement(Probe));
    return observations;
}

describe('useListPaneData property hierarchy transitions', () => {
    it('keeps the badge and the list in agreement when a key is marked hierarchical', () => {
        expect(observeTransition([FLAT_SETTINGS, HIERARCHICAL_SETTINGS])).toEqual([
            { badge: 2, list: 2 },
            { badge: 4, list: 4 }
        ]);
    });

    it('keeps the badge and the list in agreement when a key stops being hierarchical', () => {
        expect(observeTransition([HIERARCHICAL_SETTINGS, FLAT_SETTINGS])).toEqual([
            { badge: 4, list: 4 },
            { badge: 2, list: 2 }
        ]);
    });
});
