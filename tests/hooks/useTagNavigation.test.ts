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
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ExpansionAction } from '../../src/context/ExpansionContext';
import { DEFAULT_SETTINGS } from '../../src/settings/defaultSettings';
import type { PropertyTreeNode } from '../../src/types/storage';
import { buildPropertyHierarchyIndex, type PropertyHierarchyIndex } from '../../src/utils/propertyHierarchy';
import { buildPropertyKeyNodeId, buildPropertyValueNodeId } from '../../src/utils/propertyTree';
import { buildPropertyPlacementKey } from '../../src/utils/treeFlattener';
import { useTagNavigation } from '../../src/hooks/useTagNavigation';

/**
 * useTagNavigation is the navigation path a list pane property pill takes, and it reads everything
 * through context hooks, so mocking those modules is what lets the real hook run here. The point of the
 * exercise is the hierarchy data it hands to navigateToProperty: without it, revealing a nested value
 * expands the value's key and stops, so the row the reveal selects never renders.
 */
interface NavigationTestMocks {
    expansionDispatch: ReturnType<typeof vi.fn<(action: ExpansionAction) => void>>;
    propertyTree: Map<string, PropertyTreeNode>;
    hierarchyIndex: PropertyHierarchyIndex;
    propertyTreeServicePresent: boolean;
}

const navigationMocks = vi.hoisted<NavigationTestMocks>(() => ({
    expansionDispatch: vi.fn<(action: ExpansionAction) => void>(),
    // Hoisted state cannot reference an imported value, so the empty index is spelled out here rather
    // than taken from EMPTY_PROPERTY_HIERARCHY_INDEX. Every test assigns both fields.
    propertyTree: new Map<string, PropertyTreeNode>(),
    hierarchyIndex: {
        rootIds: new Map<string, readonly string[]>(),
        childIds: new Map<string, readonly string[]>(),
        parentIds: new Map<string, readonly string[]>(),
        subtreeCount: new Map<string, number>()
    },
    propertyTreeServicePresent: true
}));

vi.mock('../../src/context/ExpansionContext', () => ({
    useExpansionState: () => ({
        expandedFolders: new Set<string>(),
        expandedTags: new Set<string>(),
        expandedProperties: new Set<string>(),
        expandedVirtualFolders: new Set<string>()
    }),
    useExpansionDispatch: () => navigationMocks.expansionDispatch
}));

vi.mock('../../src/context/SelectionContext', () => ({
    useSelectionDispatch: () => vi.fn()
}));

vi.mock('../../src/context/ServicesContext', () => ({
    useServices: () => ({
        propertyTreeService: navigationMocks.propertyTreeServicePresent ? { getHierarchyIndex: () => navigationMocks.hierarchyIndex } : null
    })
}));

vi.mock('../../src/context/SettingsContext', () => ({
    useSettingsState: () => ({
        ...DEFAULT_SETTINGS,
        showProperties: true,
        showAllPropertiesFolder: false,
        collapseOtherBranchesOnExpand: false,
        propertyHierarchyMaxDepth: 10
    })
}));

vi.mock('../../src/context/UIStateContext', () => ({
    useUIDispatch: () => vi.fn()
}));

vi.mock('../../src/context/StorageContext', () => ({
    useFileCache: () => ({
        findTagInTree: () => null,
        getPropertyTree: () => navigationMocks.propertyTree
    })
}));

const PROJECTS_KEY_NODE_ID = buildPropertyKeyNodeId('projects');
const valueNodeId = (value: string) => buildPropertyValueNodeId('projects', value.toLowerCase());

function createValueNode(value: string, notes: string[]): PropertyTreeNode {
    return {
        id: valueNodeId(value),
        kind: 'value',
        key: 'projects',
        valuePath: value.toLowerCase(),
        name: value,
        displayPath: value,
        assignmentValue: `[[${value}]]`,
        children: new Map(),
        notesWithValue: new Set(notes)
    };
}

/**
 * Work > Clients > Acme, built the way the real index derives it: Clients.md carries projects: [[Work]]
 * and Acme.md carries projects: [[Clients]].
 */
function createProjectsTree(hierarchical: boolean): { hierarchyIndex: PropertyHierarchyIndex; tree: Map<string, PropertyTreeNode> } {
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

    [createValueNode('Work', ['Clients.md']), createValueNode('Clients', ['Acme.md']), createValueNode('Acme', ['notes/a.md'])].forEach(
        node => {
            keyNode.children.set(node.id, node);
            node.notesWithValue.forEach(notePath => keyNode.notesWithValue.add(notePath));
        }
    );

    const tree = new Map<string, PropertyTreeNode>([['projects', keyNode]]);
    const hierarchyIndex = buildPropertyHierarchyIndex({
        tree,
        hierarchicalKeys: hierarchical ? new Set(['projects']) : new Set(),
        resolveValueNotePath: node => {
            const match = /^\[\[([^\]|]+)\]\]$/.exec(node.assignmentValue ?? '');
            return match ? `${match[1]}.md` : null;
        }
    });

    return { hierarchyIndex, tree };
}

/** Renders the real hook and reveals one property node id, returning what it asked expansion to do. */
function revealProperty(nodeId: string): ExpansionAction[] {
    navigationMocks.expansionDispatch.mockClear();

    function Harness() {
        const { navigateToProperty } = useTagNavigation();
        navigateToProperty(nodeId);
        return null;
    }

    renderToStaticMarkup(React.createElement(Harness));
    return navigationMocks.expansionDispatch.mock.calls.map(call => call[0]);
}

describe('useTagNavigation property reveal', () => {
    it('expands every ancestor placement of a nested value, not just its key', () => {
        const { hierarchyIndex, tree } = createProjectsTree(true);
        navigationMocks.propertyTree = tree;
        navigationMocks.hierarchyIndex = hierarchyIndex;
        navigationMocks.propertyTreeServicePresent = true;

        expect(revealProperty(valueNodeId('Acme'))).toEqual([
            {
                type: 'EXPAND_PROPERTIES',
                propertyNodeIds: [
                    PROJECTS_KEY_NODE_ID,
                    buildPropertyPlacementKey([valueNodeId('Work')]),
                    buildPropertyPlacementKey([valueNodeId('Work'), valueNodeId('Clients')])
                ]
            }
        ]);
    });

    it('expands the key alone for a value of a key that is not hierarchical', () => {
        const { hierarchyIndex, tree } = createProjectsTree(false);
        navigationMocks.propertyTree = tree;
        navigationMocks.hierarchyIndex = hierarchyIndex;
        navigationMocks.propertyTreeServicePresent = true;

        expect(revealProperty(valueNodeId('Acme'))).toEqual([{ type: 'EXPAND_PROPERTIES', propertyNodeIds: [PROJECTS_KEY_NODE_ID] }]);
    });

    it('expands the key alone when no property tree service is available', () => {
        const { hierarchyIndex, tree } = createProjectsTree(true);
        navigationMocks.propertyTree = tree;
        navigationMocks.hierarchyIndex = hierarchyIndex;
        navigationMocks.propertyTreeServicePresent = false;

        expect(revealProperty(valueNodeId('Acme'))).toEqual([{ type: 'EXPAND_PROPERTIES', propertyNodeIds: [PROJECTS_KEY_NODE_ID] }]);
    });
});
