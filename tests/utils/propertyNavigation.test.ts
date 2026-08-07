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
import { buildPropertyPlacementKey } from '../../src/utils/treeFlattener';
import { EMPTY_PROPERTY_HIERARCHY_INDEX, type PropertyHierarchyIndex } from '../../src/utils/propertyHierarchy';
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

/** Property tree holding the value nodes as direct children of their key, as the real tree does. */
function createTreeWithValues(keyNode: PropertyTreeNode, valueNodes: PropertyTreeNode[]): Map<string, PropertyTreeNode> {
    valueNodes.forEach(node => keyNode.children.set(node.id, node));
    return new Map<string, PropertyTreeNode>([[keyNode.key, keyNode]]);
}

/**
 * Index with only the fields reveal reads. parentIds is what resolvePropertyRevealChain walks, and
 * membership in it is also how it tells a hierarchical value from a flat one.
 */
function createHierarchyIndex(parents: Record<string, string[]>): PropertyHierarchyIndex {
    return {
        ...EMPTY_PROPERTY_HIERARCHY_INDEX,
        parentIds: new Map(Object.entries(parents))
    };
}

describe('navigateToProperty - hierarchical ancestor expansion', () => {
    it('expands every ancestor placement of a hierarchical value in addition to its key', () => {
        const keyNode = createKeyNode('projects', 'Projects');
        const propertyTree = createTreeWithValues(keyNode, [
            createValueNode('projects', 'work', 'Work'),
            createValueNode('projects', 'clients', 'Clients'),
            createValueNode('projects', 'datawerkplaats mooi maasvallei', 'Datawerkplaats Mooi Maasvallei')
        ]);
        // Nothing is expanded, which is exactly the state firstPlacementByNodeId cannot describe: the
        // target's row does not exist yet, so only a parent walk over the index can find its chain.
        const propertyHierarchyIndex = createHierarchyIndex({
            [WORK_ID]: [],
            [CLIENTS_ID]: [WORK_ID],
            [TARGET_ID]: [CLIENTS_ID]
        });

        const expansionDispatch = vi.fn();
        const env = createEnv({ propertyTree, expansionDispatch, propertyHierarchyIndex });

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
        const propertyHierarchyIndex = createHierarchyIndex({ [FIDDLE_ID]: [] });

        const expansionDispatch = vi.fn();
        const env = createEnv({ propertyTree, expansionDispatch, propertyHierarchyIndex });

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
        const propertyHierarchyIndex = createHierarchyIndex({
            [WORK_ID]: [],
            [CLIENTS_ID]: [WORK_ID],
            [TARGET_ID]: [CLIENTS_ID]
        });

        const expansionDispatch = vi.fn();
        const env = createEnv({
            propertyTree,
            expansionDispatch,
            propertyHierarchyIndex,
            collapseOtherBranchesOnExpand: true,
            expandedProperties: new Set([keyNode.id])
        });

        navigateToProperty(env, TARGET_ID);

        expect(expansionDispatch).toHaveBeenCalledWith({
            type: 'SET_EXPANDED_PROPERTIES',
            properties: new Set([keyNode.id, buildPropertyPlacementKey([WORK_ID]), buildPropertyPlacementKey([WORK_ID, CLIENTS_ID])])
        });
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
        const propertyHierarchyIndex = createHierarchyIndex({
            [WORK_ID]: [],
            [CLIENTS_ID]: [WORK_ID],
            [TARGET_ID]: [CLIENTS_ID]
        });

        const expansionDispatch = vi.fn();
        const env = createEnv({
            propertyTree,
            expansionDispatch,
            propertyHierarchyIndex,
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
