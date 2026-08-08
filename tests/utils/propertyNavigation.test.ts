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
import { navigateToProperty, type PropertyNavigationEnvironment } from '../../src/utils/propertyNavigation';
import { buildPropertyKeyNodeId, buildPropertyValueNodeId } from '../../src/utils/propertyTree';
import { buildPropertyPlacementKey, flattenPropertyHierarchy } from '../../src/utils/treeFlattener';
import {
    buildPropertyHierarchyIndex,
    EMPTY_PROPERTY_HIERARCHY_INDEX,
    type PropertyHierarchyIndex
} from '../../src/utils/propertyHierarchy';
import type { PropertyTreeNode } from '../../src/types/storage';

function createKeyNode(key: string, name: string): PropertyTreeNode {
    return {
        id: buildPropertyKeyNodeId(key),
        kind: 'key',
        key,
        valuePath: null,
        name,
        displayPath: name,
        children: new Map(),
        notesWithValue: new Set(['notes/a.md'])
    };
}

function createEnv(overrides: Partial<PropertyNavigationEnvironment> = {}): PropertyNavigationEnvironment {
    return {
        showProperties: false,
        showAllPropertiesFolder: false,
        propertyTree: new Map(),
        expandedProperties: new Set(),
        expandedVirtualFolders: new Set(),
        expansionDispatch: vi.fn(),
        selectionDispatch: vi.fn(),
        activatePane: vi.fn(),
        ...overrides
    };
}

describe('navigateToProperty - suppressAutoSelect', () => {
    // Regression coverage for the shortcut-activation auto-open race: SET_SELECTED_PROPERTY with
    // autoSelectedFile left undefined lets useSelectionProvider's enhancedDispatch resolve a first
    // file for the property, which (with autoSelectFirstFileOnFocusChange on) opens in a post-render
    // effect one render after the reveal's SET_KEYBOARD_NAVIGATION flag resets - replacing whatever
    // note was just opened by the auto-open feature. Callers about to open a note themselves must
    // pass suppressAutoSelect so the dispatch carries autoSelectedFile: null instead.

    it('leaves autoSelectedFile undefined by default, preserving every existing caller', () => {
        const keyNode = createKeyNode('status', 'Status');
        const propertyTree = new Map<string, PropertyTreeNode>([[keyNode.key, keyNode]]);
        const selectionDispatch = vi.fn();
        const env = createEnv({ propertyTree, selectionDispatch });

        const resolvedNodeId = navigateToProperty(env, keyNode.id);

        expect(resolvedNodeId).toBe(keyNode.id);
        expect(selectionDispatch).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'SET_SELECTED_PROPERTY',
                nodeId: keyNode.id,
                autoSelectedFile: undefined
            })
        );
    });

    it('sets autoSelectedFile to null when suppressAutoSelect is requested', () => {
        const keyNode = createKeyNode('status', 'Status');
        const propertyTree = new Map<string, PropertyTreeNode>([[keyNode.key, keyNode]]);
        const selectionDispatch = vi.fn();
        const env = createEnv({ propertyTree, selectionDispatch });

        const resolvedNodeId = navigateToProperty(env, keyNode.id, { suppressAutoSelect: true });

        expect(resolvedNodeId).toBe(keyNode.id);
        expect(selectionDispatch).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'SET_SELECTED_PROPERTY',
                nodeId: keyNode.id,
                autoSelectedFile: null
            })
        );
    });
});

/** Value node ids of a `projects` chain: Work -> Clients -> Datawerkplaats Mooi Maasvallei. */
const WORK_ID = buildPropertyValueNodeId('projects', 'work');
const CLIENTS_ID = buildPropertyValueNodeId('projects', 'clients');
const TARGET_ID = buildPropertyValueNodeId('projects', 'datawerkplaats mooi maasvallei');
const FIDDLE_ID = buildPropertyValueNodeId('projects', 'fiddle');

function createValueNode(key: string, valuePath: string, name: string): PropertyTreeNode {
    return {
        id: buildPropertyValueNodeId(key, valuePath),
        kind: 'value',
        key,
        valuePath,
        name,
        displayPath: name,
        children: new Map(),
        notesWithValue: new Set(['notes/a.md'])
    };
}

/** Value node carrying the wikilink its parent is derived from, which is what the real index reads. */
function createHierarchyValueNode(
    key: string,
    valuePath: string,
    name: string,
    assignmentValue: string,
    notes: string[]
): PropertyTreeNode {
    return {
        ...createValueNode(key, valuePath, name),
        assignmentValue,
        notesWithValue: new Set(notes)
    };
}

/** Property tree holding the value nodes as direct children of their key, as the real tree does. */
function createTreeWithValues(keyNode: PropertyTreeNode, valueNodes: PropertyTreeNode[]): Map<string, PropertyTreeNode> {
    valueNodes.forEach(node => keyNode.children.set(node.id, node));
    return new Map<string, PropertyTreeNode>([[keyNode.key, keyNode]]);
}

/**
 * Index with only the fields reveal reads. parentIds is what resolvePropertyRevealChain walks, and
 * membership in it is also how it tells a hierarchical value from a flat one; rootIds is what decides
 * where the walk is allowed to stop, so a chain always starts at a row the key actually renders.
 */
function createHierarchyIndex(keyNodeId: string, parents: Record<string, string[]>): PropertyHierarchyIndex {
    const rootValueIds = Object.entries(parents)
        .filter(([, parentIds]) => parentIds.length === 0)
        .map(([nodeId]) => nodeId);
    return {
        ...EMPTY_PROPERTY_HIERARCHY_INDEX,
        parentIds: new Map(Object.entries(parents)),
        rootIds: new Map([[keyNodeId, rootValueIds]])
    };
}

/** Reveal reads the index and the depth cap together, so the tests pass them the way the pane does. */
function createHierarchyEnvironment(index: PropertyHierarchyIndex): { index: PropertyHierarchyIndex; maxDepth: number } {
    return { index, maxDepth: 10 };
}

describe('navigateToProperty - hierarchical ancestor expansion', () => {
    it('expands every ancestor placement of a hierarchical value in addition to its key', () => {
        const keyNode = createKeyNode('projects', 'Projects');
        const propertyTree = createTreeWithValues(keyNode, [
            createValueNode('projects', 'work', 'Work'),
            createValueNode('projects', 'clients', 'Clients'),
            createValueNode('projects', 'datawerkplaats mooi maasvallei', 'Datawerkplaats Mooi Maasvallei')
        ]);
        // Nothing is expanded, which is exactly the state the flattener's output cannot describe: the
        // target's row does not exist yet, so only a parent walk over the index can find its chain.
        const propertyHierarchyIndex = createHierarchyIndex(keyNode.id, {
            [WORK_ID]: [],
            [CLIENTS_ID]: [WORK_ID],
            [TARGET_ID]: [CLIENTS_ID]
        });

        const expansionDispatch = vi.fn();
        const env = createEnv({ propertyTree, expansionDispatch, propertyHierarchy: createHierarchyEnvironment(propertyHierarchyIndex) });

        const resolvedNodeId = navigateToProperty(env, TARGET_ID);

        expect(resolvedNodeId).toBe(TARGET_ID);
        expect(expansionDispatch).toHaveBeenCalledWith({
            type: 'EXPAND_PROPERTIES',
            propertyNodeIds: [keyNode.id, buildPropertyPlacementKey([WORK_ID]), buildPropertyPlacementKey([WORK_ID, CLIENTS_ID])]
        });
    });

    it('expands only the key for a root placement, matching pre-hierarchy behavior', () => {
        const keyNode = createKeyNode('projects', 'Projects');
        const propertyTree = createTreeWithValues(keyNode, [createValueNode('projects', 'fiddle', 'Fiddle')]);
        const propertyHierarchyIndex = createHierarchyIndex(keyNode.id, { [FIDDLE_ID]: [] });

        const expansionDispatch = vi.fn();
        const env = createEnv({ propertyTree, expansionDispatch, propertyHierarchy: createHierarchyEnvironment(propertyHierarchyIndex) });

        navigateToProperty(env, FIDDLE_ID);

        expect(expansionDispatch).toHaveBeenCalledWith({
            type: 'EXPAND_PROPERTIES',
            propertyNodeIds: [keyNode.id]
        });
    });

    it('expands only the key when no hierarchy index is supplied, as a non-hierarchical key does', () => {
        const keyNode = createKeyNode('status', 'Status');
        const openNode = createValueNode('status', 'open', 'Open');
        const propertyTree = createTreeWithValues(keyNode, [openNode]);

        const expansionDispatch = vi.fn();
        const env = createEnv({ propertyTree, expansionDispatch });

        navigateToProperty(env, openNode.id);

        expect(expansionDispatch).toHaveBeenCalledWith({
            type: 'EXPAND_PROPERTIES',
            propertyNodeIds: [keyNode.id]
        });
    });

    it('keeps the key expanded when collapseOtherBranchesOnExpand replaces the whole expanded set', () => {
        // With collapse-other-branches on, expandNavigationTreeItems dispatches
        // SET_EXPANDED_PROPERTIES, which replaces rather than merges. Omitting the already-expanded key
        // from the list would therefore collapse the entire property key and hide the row being
        // revealed, so the full list is always built and the guard decides only whether to dispatch.
        const keyNode = createKeyNode('projects', 'Projects');
        const propertyTree = createTreeWithValues(keyNode, [
            createValueNode('projects', 'work', 'Work'),
            createValueNode('projects', 'clients', 'Clients'),
            createValueNode('projects', 'datawerkplaats mooi maasvallei', 'Datawerkplaats Mooi Maasvallei')
        ]);
        const propertyHierarchyIndex = createHierarchyIndex(keyNode.id, {
            [WORK_ID]: [],
            [CLIENTS_ID]: [WORK_ID],
            [TARGET_ID]: [CLIENTS_ID]
        });

        const expansionDispatch = vi.fn();
        const env = createEnv({
            propertyTree,
            expansionDispatch,
            propertyHierarchy: createHierarchyEnvironment(propertyHierarchyIndex),
            collapseOtherBranchesOnExpand: true,
            expandedProperties: new Set([keyNode.id])
        });

        navigateToProperty(env, TARGET_ID);

        expect(expansionDispatch).toHaveBeenCalledWith({
            type: 'SET_EXPANDED_PROPERTIES',
            properties: new Set([keyNode.id, buildPropertyPlacementKey([WORK_ID]), buildPropertyPlacementKey([WORK_ID, CLIENTS_ID])])
        });
    });

    it('dispatches an expansion the flattener can actually render the target from', () => {
        // The round trip, because every defect in this feature lived between two components that each
        // passed their own tests. Root -> A with A <-> B: A's first parent is B, which renders only
        // under A, so a chain headed at B expands a placement that appears nowhere and the target's row
        // never appears. Feeding the dispatched payload straight back into the flattener is the only
        // shape that catches it.
        const keyNode = createKeyNode('projects', 'Projects');
        const rootNode = createHierarchyValueNode('projects', 'root', 'Root', '[[Root]]', ['A.md']);
        const aNode = createHierarchyValueNode('projects', 'a', 'A', '[[A]]', ['B.md']);
        const bNode = createHierarchyValueNode('projects', 'b', 'B', '[[B]]', ['A.md']);
        const propertyTree = createTreeWithValues(keyNode, [rootNode, aNode, bNode]);
        const index = buildPropertyHierarchyIndex({
            tree: propertyTree,
            hierarchicalKeys: new Set(['projects']),
            resolveValueNotePath: node => {
                const match = /^\[\[([^\]|]+)\]\]$/.exec(node.assignmentValue ?? '');
                return match ? `${match[1]}.md` : null;
            }
        });

        // The shape that produced the defect: A's parent list starts with a non-root.
        expect(index.parentIds.get(aNode.id)).toEqual([bNode.id, rootNode.id]);
        expect(index.rootIds.get(keyNode.id)).toEqual([rootNode.id]);

        const expansionDispatch = vi.fn();
        const env = createEnv({
            propertyTree,
            expansionDispatch,
            propertyHierarchy: createHierarchyEnvironment(index)
        });

        navigateToProperty(env, aNode.id);

        expect(expansionDispatch).toHaveBeenCalledTimes(1);
        const payload = expansionDispatch.mock.calls[0][0] as { type: string; propertyNodeIds: string[] };
        expect(payload.type).toBe('EXPAND_PROPERTIES');

        // Everything the reveal asked for, handed to the flattener exactly as the pane would hold it.
        const placements = flattenPropertyHierarchy({
            keyNode,
            index,
            expandedPlacements: new Set(payload.propertyNodeIds),
            level: 1,
            maxDepth: 10,
            comparator: (first, second) => first.name.localeCompare(second.name)
        });

        expect(placements.map(item => item.key)).toEqual([
            buildPropertyPlacementKey([rootNode.id]),
            buildPropertyPlacementKey([rootNode.id, aNode.id])
        ]);
        expect(placements.some(item => item.data.id === aNode.id)).toBe(true);
    });

    it('does not dispatch when every id to expand is already expanded', () => {
        // EXPAND_PROPERTIES always allocates a new Set, so a redundant dispatch is a state change.
        // revealProperty is a dependency of the startup-reveal effect, which would then re-run and
        // write localStorage on every pass.
        const keyNode = createKeyNode('projects', 'Projects');
        const propertyTree = createTreeWithValues(keyNode, [
            createValueNode('projects', 'work', 'Work'),
            createValueNode('projects', 'clients', 'Clients'),
            createValueNode('projects', 'datawerkplaats mooi maasvallei', 'Datawerkplaats Mooi Maasvallei')
        ]);
        const propertyHierarchyIndex = createHierarchyIndex(keyNode.id, {
            [WORK_ID]: [],
            [CLIENTS_ID]: [WORK_ID],
            [TARGET_ID]: [CLIENTS_ID]
        });

        const expansionDispatch = vi.fn();
        const env = createEnv({
            propertyTree,
            expansionDispatch,
            propertyHierarchy: createHierarchyEnvironment(propertyHierarchyIndex),
            expandedProperties: new Set([
                keyNode.id,
                buildPropertyPlacementKey([WORK_ID]),
                buildPropertyPlacementKey([WORK_ID, CLIENTS_ID])
            ])
        });

        navigateToProperty(env, TARGET_ID);

        expect(expansionDispatch).not.toHaveBeenCalled();
    });
});
