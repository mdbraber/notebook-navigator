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

import React from 'react';
import { App, TFolder } from 'obsidian';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
    buildCollapsedExpansionState,
    buildSelectedPropertyParentKeys,
    collectExpandableFolderPaths,
    collectExpandablePropertyExpansionKeys,
    getCollapseBehaviorScope,
    hasCollapsibleFolderExpansion,
    useNavigationActions,
    type PropertyHierarchySnapshot
} from '../../src/hooks/useNavigationActions';
import type { ExpansionAction } from '../../src/context/ExpansionContext';
import { DEFAULT_SETTINGS } from '../../src/settings/defaultSettings';
import { PROPERTIES_ROOT_VIRTUAL_FOLDER_ID, SHORTCUTS_VIRTUAL_FOLDER_ID, TAGS_ROOT_VIRTUAL_FOLDER_ID } from '../../src/types';
import type { PropertyTreeNode } from '../../src/types/storage';
import {
    buildPropertyHierarchyIndex,
    EMPTY_PROPERTY_HIERARCHY_INDEX,
    type PropertyHierarchyIndex
} from '../../src/utils/propertyHierarchy';
import { buildPropertyKeyNodeId, buildPropertyValueNodeId } from '../../src/utils/propertyTree';
import { buildPropertyPlacementKey } from '../../src/utils/treeFlattener';

/**
 * useNavigationActions reads app, settings and expansion/selection state through context hooks rather
 * than as plain parameters, unlike useNavigationPaneTreeInteractions. Mocking those context modules is
 * what lets the hook itself be rendered directly below, so a future caller that stops forwarding
 * propertyHierarchyIndexRef.current to the property-expansion helpers can be caught here rather than
 * only by tsc.
 */
const actionMocks = vi.hoisted(() => ({
    expansionDispatch: vi.fn<(action: ExpansionAction) => void>(),
    fileData: {
        propertyTree: new Map<string, PropertyTreeNode>(),
        tagTree: new Map<string, unknown>()
    }
}));

vi.mock('../../src/context/ExpansionContext', () => ({
    useExpansionState: () => ({
        expandedFolders: new Set<string>(),
        expandedTags: new Set<string>(),
        expandedProperties: new Set<string>(),
        expandedVirtualFolders: new Set<string>()
    }),
    useExpansionDispatch: () => actionMocks.expansionDispatch
}));

vi.mock('../../src/context/SelectionContext', () => ({
    useSelectionState: () => ({
        selectionType: 'folder',
        selectedFolder: null,
        selectedTag: null,
        selectedProperty: null
    })
}));

vi.mock('../../src/context/ServicesContext', () => ({
    useServices: () => ({ app: new App() }),
    useFileSystemOps: () => null
}));

vi.mock('../../src/context/SettingsContext', () => ({
    useSettingsState: () => ({
        ...DEFAULT_SETTINGS,
        collapseBehavior: 'properties-only',
        propertyHierarchyMaxDepth: 10
    })
}));

vi.mock('../../src/context/UXPreferencesContext', () => ({
    useUXPreferences: () => ({ showHiddenItems: false, includeDescendantNotes: true }),
    useUXPreferenceActions: () => ({ setShowHiddenItems: vi.fn() })
}));

vi.mock('../../src/context/StorageContext', () => ({
    useFileCache: () => ({ fileData: actionMocks.fileData })
}));

const PROJECTS_KEY_NODE_ID = buildPropertyKeyNodeId('projects');
const valueNodeId = (value: string) => buildPropertyValueNodeId('projects', value.toLowerCase());

/**
 * A three level chain of the shape the author's vault produces: Building software.md carries
 * projects: [[Fiddle]], so Building software nests under Fiddle, and Bulwark.md carries
 * projects: [[Building software]], so Bulwark nests one level deeper again.
 */
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

    const values: { value: string; notes: string[] }[] = [
        { value: 'Fiddle', notes: ['Building software.md'] },
        { value: 'Building software', notes: ['Bulwark.md'] },
        { value: 'Bulwark', notes: ['Bulwark note.md'] }
    ];

    values.forEach(entry => {
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

function createProjectsHierarchy(params: { hierarchical: boolean; maxDepth: number }): {
    tree: Map<string, PropertyTreeNode>;
    hierarchy: PropertyHierarchySnapshot;
} {
    const tree = createProjectsTree();
    const index = buildPropertyHierarchyIndex({
        tree,
        hierarchicalKeys: params.hierarchical ? new Set(['projects']) : new Set(),
        resolveValueNotePath: node => {
            const match = /^\[\[([^\]|]+)\]\]$/.exec(node.assignmentValue ?? '');
            return match ? `${match[1]}.md` : null;
        }
    });

    return { tree, hierarchy: { index, maxDepth: params.maxDepth } };
}

describe('useNavigationActions helpers', () => {
    function createFolder(path: string, children: TFolder[] = []): TFolder {
        const folder = new TFolder(path);
        Object.assign(folder, { children });
        return folder;
    }

    it('supports a properties-only collapse scope', () => {
        expect(getCollapseBehaviorScope('properties-only')).toEqual({
            affectFolders: false,
            affectTags: false,
            affectProperties: true
        });
    });

    it('ignores the vault root when deciding whether folders can collapse', () => {
        expect(hasCollapsibleFolderExpansion(new Set(['/']), true)).toBe(false);
        expect(hasCollapsibleFolderExpansion(new Set(['/', 'Projects']), true)).toBe(true);
        expect(hasCollapsibleFolderExpansion(new Set(['/']), false)).toBe(true);
    });

    it('includes the vault root when expanding all folders', () => {
        const activeFolder = createFolder('Projects/Active');
        const projectsFolder = createFolder('Projects', [activeFolder]);
        const rootFolder = createFolder('/', [projectsFolder]);

        expect(collectExpandableFolderPaths(rootFolder, true)).toEqual(new Set(['/', 'Projects', 'Projects/Active']));
        expect(collectExpandableFolderPaths(rootFolder, false)).toEqual(new Set(['Projects', 'Projects/Active']));
    });

    it('collapses visible root containers to the root rows only', () => {
        const collapsedState = buildCollapsedExpansionState({
            behavior: 'all',
            currentExpandedVirtualFolders: new Set([SHORTCUTS_VIRTUAL_FOLDER_ID])
        });

        expect(collapsedState.folders).toEqual(new Set());
        expect(collapsedState.tags).toEqual(new Set());
        expect(collapsedState.properties).toEqual(new Set());
        expect(collapsedState.virtualFolders).toEqual(new Set([SHORTCUTS_VIRTUAL_FOLDER_ID]));
    });

    it('preserves unrelated virtual folders when collapsing properties only', () => {
        const collapsedState = buildCollapsedExpansionState({
            behavior: 'properties-only',
            currentExpandedVirtualFolders: new Set([SHORTCUTS_VIRTUAL_FOLDER_ID, TAGS_ROOT_VIRTUAL_FOLDER_ID]),
            selectedPropertyParentKeys: ['property:key:priority']
        });

        expect(collapsedState.folders).toEqual(new Set());
        expect(collapsedState.tags).toEqual(new Set());
        expect(collapsedState.properties).toEqual(new Set(['property:key:priority']));
        expect(collapsedState.virtualFolders).toEqual(new Set([SHORTCUTS_VIRTUAL_FOLDER_ID, TAGS_ROOT_VIRTUAL_FOLDER_ID]));
    });

    it('reopens visible roots during smart collapse when a selected descendant needs them', () => {
        const collapsedState = buildCollapsedExpansionState({
            behavior: 'all',
            currentExpandedVirtualFolders: new Set([SHORTCUTS_VIRTUAL_FOLDER_ID]),
            selectedFolderParentPaths: ['/'],
            selectedTagParentPaths: ['work'],
            selectedPropertyParentKeys: ['property:key:status'],
            revealTagsRoot: true,
            revealPropertiesRoot: true
        });

        expect(collapsedState.folders).toEqual(new Set(['/']));
        expect(collapsedState.tags).toEqual(new Set(['work']));
        expect(collapsedState.properties).toEqual(new Set(['property:key:status']));
        expect(collapsedState.virtualFolders).toEqual(
            new Set([SHORTCUTS_VIRTUAL_FOLDER_ID, TAGS_ROOT_VIRTUAL_FOLDER_ID, PROPERTIES_ROOT_VIRTUAL_FOLDER_ID])
        );
    });

    it('preserves the expanded vault root when root skipping is enabled', () => {
        const collapsedState = buildCollapsedExpansionState({
            behavior: 'all',
            currentExpandedVirtualFolders: new Set(),
            selectedFolderParentPaths: ['Projects', '/'],
            preserveRootFolder: true,
            rootFolderExpanded: true
        });

        expect(collapsedState.folders).toEqual(new Set(['Projects', '/']));
    });

    it('preserves the collapsed vault root when root skipping is enabled', () => {
        const collapsedState = buildCollapsedExpansionState({
            behavior: 'all',
            currentExpandedVirtualFolders: new Set(),
            selectedFolderParentPaths: ['Projects', '/'],
            preserveRootFolder: true,
            rootFolderExpanded: false
        });

        expect(collapsedState.folders).toEqual(new Set(['Projects']));
    });

    it('expands every nested placement of a hierarchical key', () => {
        const { tree, hierarchy } = createProjectsHierarchy({ hierarchical: true, maxDepth: 10 });

        // The key, the root value's placement, and the placement one level down. Expanding the key
        // alone shows the root values flat, which is what the same command used to do here while it
        // expanded a whole tag tree.
        expect(collectExpandablePropertyExpansionKeys(tree, hierarchy)).toEqual(
            new Set([
                PROJECTS_KEY_NODE_ID,
                valueNodeId('Fiddle'),
                buildPropertyPlacementKey([valueNodeId('Fiddle'), valueNodeId('Building software')])
            ])
        );
    });

    it('stops expanding placements at the hierarchy depth cap', () => {
        const { tree, hierarchy } = createProjectsHierarchy({ hierarchical: true, maxDepth: 1 });

        // The flattener never recurses past the cap, so the deeper placement key would name a row
        // that renders nowhere and would sit in the persisted expansion set forever.
        expect(collectExpandablePropertyExpansionKeys(tree, hierarchy)).toEqual(new Set([PROJECTS_KEY_NODE_ID, valueNodeId('Fiddle')]));
    });

    it('expands a key that is not hierarchical exactly as before', () => {
        const { tree, hierarchy } = createProjectsHierarchy({ hierarchical: false, maxDepth: 10 });

        expect(collectExpandablePropertyExpansionKeys(tree, hierarchy)).toEqual(new Set([PROJECTS_KEY_NODE_ID]));
        expect(collectExpandablePropertyExpansionKeys(tree, null)).toEqual(new Set([PROJECTS_KEY_NODE_ID]));
    });

    it('keeps a selected nested property value visible through smart collapse', () => {
        const { hierarchy } = createProjectsHierarchy({ hierarchical: true, maxDepth: 10 });
        const fiddlePlacement = valueNodeId('Fiddle');
        const buildingSoftwarePlacement = buildPropertyPlacementKey([fiddlePlacement, valueNodeId('Building software')]);

        const parentKeys = buildSelectedPropertyParentKeys(valueNodeId('Bulwark'), hierarchy);
        expect(parentKeys).toEqual([PROJECTS_KEY_NODE_ID, fiddlePlacement, buildingSoftwarePlacement]);

        const collapsedState = buildCollapsedExpansionState({
            behavior: 'properties-only',
            currentExpandedVirtualFolders: new Set([PROPERTIES_ROOT_VIRTUAL_FOLDER_ID]),
            selectedPropertyParentKeys: parentKeys,
            revealPropertiesRoot: true
        });

        expect(collapsedState.properties).toEqual(new Set([PROJECTS_KEY_NODE_ID, fiddlePlacement, buildingSoftwarePlacement]));
    });

    it('keeps preserving the key alone for a value with no hierarchy', () => {
        const { hierarchy } = createProjectsHierarchy({ hierarchical: false, maxDepth: 10 });

        expect(buildSelectedPropertyParentKeys(valueNodeId('Bulwark'), hierarchy)).toEqual([PROJECTS_KEY_NODE_ID]);
        expect(buildSelectedPropertyParentKeys(valueNodeId('Bulwark'), null)).toEqual([PROJECTS_KEY_NODE_ID]);
        expect(buildSelectedPropertyParentKeys(PROJECTS_KEY_NODE_ID, hierarchy)).toEqual([]);
        expect(buildSelectedPropertyParentKeys(null, hierarchy)).toEqual([]);
    });
});

describe('useNavigationActions hook', () => {
    /**
     * Renders the real hook with the given hierarchy ref and returns the properties it dispatched for
     * "expand all", the only observable trace of what propertyHierarchyIndexRef.current actually was.
     */
    function collectExpandAllProperties(propertyHierarchyIndexRef: { current: PropertyHierarchyIndex }): Set<string> {
        actionMocks.expansionDispatch.mockClear();

        function Harness() {
            const { handleExpandCollapseAll } = useNavigationActions({ propertyHierarchyIndexRef });
            handleExpandCollapseAll();
            return null;
        }
        renderToStaticMarkup(React.createElement(Harness));

        const dispatchedAction = actionMocks.expansionDispatch.mock.calls
            .map(([action]) => action)
            .find(
                (action): action is Extract<ExpansionAction, { type: 'SET_EXPANDED_PROPERTIES' }> =>
                    action.type === 'SET_EXPANDED_PROPERTIES'
            );
        if (!dispatchedAction) {
            throw new Error('Expected a SET_EXPANDED_PROPERTIES dispatch');
        }
        return dispatchedAction.properties;
    }

    it('consults the property hierarchy index it is given, rather than a fixed empty one', () => {
        // Same fixture as "expands every nested placement of a hierarchical key" above, but driven
        // through the hook itself: a future useNavigationActions that stopped forwarding
        // propertyHierarchyIndexRef.current to the property-expansion helpers, for example by reading
        // EMPTY_PROPERTY_HIERARCHY_INDEX directly, would keep every other test in this file green
        // because they all call the helpers with a hand-built PropertyHierarchySnapshot and never touch
        // the ref. Only rendering the hook and inspecting what it actually dispatched can catch that.
        actionMocks.fileData = { propertyTree: createProjectsTree(), tagTree: new Map() };
        const { hierarchy } = createProjectsHierarchy({ hierarchical: true, maxDepth: 10 });

        const withRealIndex = collectExpandAllProperties({ current: hierarchy.index });
        const withEmptyIndex = collectExpandAllProperties({ current: EMPTY_PROPERTY_HIERARCHY_INDEX });

        expect(withRealIndex).toEqual(
            new Set([
                PROJECTS_KEY_NODE_ID,
                valueNodeId('Fiddle'),
                buildPropertyPlacementKey([valueNodeId('Fiddle'), valueNodeId('Building software')])
            ])
        );
        // An index the hook never consulted would fall back to the flat walk, which stops at the key:
        // every value node's own children map is always empty, since nesting lives only in the index.
        expect(withEmptyIndex).toEqual(new Set([PROJECTS_KEY_NODE_ID]));
    });
});
