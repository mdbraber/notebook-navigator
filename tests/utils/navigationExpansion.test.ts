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
import { TFolder } from 'obsidian';
import type { ExpansionAction } from '../../src/context/ExpansionContext';
import {
    getFolderAncestorPaths,
    getNavigationExpansionTargetForItem,
    getPropertyAncestorNodeIds,
    getPropertyPlacementAncestorIds,
    isFolderEffectivelyExpanded,
    isFolderExpansionLocked,
    toggleNavigationExpansionTarget
} from '../../src/utils/navigationExpansion';
import { NavigationPaneItemType } from '../../src/types';
import type { CombinedNavigationItem } from '../../src/types/virtualization';
import type { PropertyTreeNode } from '../../src/types/storage';
import { buildPropertyKeyNodeId, buildPropertyValueNodeId } from '../../src/utils/propertyTree';
import { buildPropertyPlacementKey } from '../../src/utils/treeFlattener';

describe('navigationExpansion', () => {
    it('locks a hidden root open without relying on persisted expansion', () => {
        expect(isFolderExpansionLocked('/', false)).toBe(true);
        expect(isFolderEffectivelyExpanded('/', new Set(), false)).toBe(true);
        expect(isFolderExpansionLocked('/', true)).toBe(false);
        expect(isFolderEffectivelyExpanded('/', new Set(), true)).toBe(false);
        expect(isFolderEffectivelyExpanded('/', new Set(['/']), true)).toBe(true);
    });

    it('omits the locked root from persisted ancestor expansion paths', () => {
        const rootFolder = new TFolder('/');
        const parentFolder = new TFolder('Projects');
        const childFolder = new TFolder('Projects/Active');
        Object.assign(parentFolder, { parent: rootFolder });
        Object.assign(childFolder, { parent: parentFolder });

        expect(getFolderAncestorPaths(childFolder)).toEqual(['/', 'Projects']);
        expect(getFolderAncestorPaths(childFolder, { includeRootFolder: false })).toEqual(['Projects']);
    });

    it('replaces unrelated folder branches when branch collapse is enabled', () => {
        // Folders share NavigationExpansionTarget and toggleNavigationExpansionTarget with properties.
        // This pins their behavior across the removal of the property-specific escape hatch on the type.
        const dispatch = vi.fn<(action: ExpansionAction) => void>();

        const didExpand = toggleNavigationExpansionTarget(
            {
                type: 'folder',
                id: 'Projects/Active',
                hasChildren: true,
                ancestorIds: ['/', 'Projects']
            },
            {
                expandedFolders: new Set(['Archive', 'Archive/2024']),
                expandedTags: new Set(),
                expandedProperties: new Set(),
                expandedVirtualFolders: new Set()
            },
            dispatch,
            'expand',
            { collapseOtherBranches: true }
        );

        expect(didExpand).toBe(true);
        expect(dispatch).toHaveBeenCalledWith({
            type: 'SET_EXPANDED_FOLDERS',
            folders: new Set(['/', 'Projects', 'Projects/Active'])
        });
    });

    it('replaces unrelated tag branches when branch collapse is enabled', () => {
        const dispatch = vi.fn<(action: ExpansionAction) => void>();

        const didExpand = toggleNavigationExpansionTarget(
            {
                type: 'tag',
                id: 'projects/active',
                hasChildren: true,
                ancestorIds: ['projects']
            },
            {
                expandedFolders: new Set(),
                expandedTags: new Set(['areas', 'archive']),
                expandedProperties: new Set(),
                expandedVirtualFolders: new Set()
            },
            dispatch,
            'expand',
            { collapseOtherBranches: true }
        );

        expect(didExpand).toBe(true);
        expect(dispatch).toHaveBeenCalledWith({
            type: 'SET_EXPANDED_TAGS',
            tags: new Set(['projects', 'projects/active'])
        });
    });

    it('uses the normal collapse action when the target is already expanded', () => {
        const dispatch = vi.fn<(action: ExpansionAction) => void>();

        const didCollapse = toggleNavigationExpansionTarget(
            {
                type: 'property',
                id: 'key:status',
                hasChildren: true
            },
            {
                expandedFolders: new Set(),
                expandedTags: new Set(),
                expandedProperties: new Set(['key:status', 'key:priority']),
                expandedVirtualFolders: new Set()
            },
            dispatch,
            'toggle',
            { collapseOtherBranches: true }
        );

        expect(didCollapse).toBe(true);
        expect(dispatch).toHaveBeenCalledWith({ type: 'TOGGLE_PROPERTY_EXPANDED', propertyNodeId: 'key:status' });
    });
});

/**
 * The two calls below are exactly what the keyboard paths in useNavigationPaneKeyboard perform when
 * autoExpandNavItems moves the selection onto a property row, or when the expand key is pressed on one.
 * These assert the resulting dispatch rather than that the children-presence guard was reached, because
 * the guard used to pass and then dispatch nothing at all: a hierarchical value node's own children map
 * is always empty, so the old `item.data.children.size > 0` reported no children for every placement.
 */
describe('navigationExpansion keyboard expansion of property placements', () => {
    const KEY_ID = buildPropertyKeyNodeId('projects');
    const WORK_ID = buildPropertyValueNodeId('projects', 'work');
    const CLIENTS_ID = buildPropertyValueNodeId('projects', 'clients');
    const CLIENTS_UNDER_WORK = buildPropertyPlacementKey([WORK_ID, CLIENTS_ID]);

    function createValueNode(valuePath: string, name: string): PropertyTreeNode {
        return {
            id: buildPropertyValueNodeId('projects', valuePath),
            kind: 'value',
            key: 'projects',
            valuePath,
            name,
            displayPath: name,
            children: new Map(),
            notesWithValue: new Set(['notes/a.md'])
        };
    }

    /** Shaped as the flattener emits it: key is the placement key, hasChildren comes from the index. */
    function createValueItem(node: PropertyTreeNode, placementKey: string, hasChildren?: boolean): CombinedNavigationItem {
        return {
            type: NavigationPaneItemType.PROPERTY_VALUE,
            data: node,
            level: 2,
            key: placementKey,
            ...(hasChildren === undefined ? {} : { hasChildren })
        };
    }

    const expandItem = (item: CombinedNavigationItem, expandedProperties: Set<string>, collapseOtherBranches: boolean) => {
        const dispatch = vi.fn<(action: ExpansionAction) => void>();
        const target = getNavigationExpansionTargetForItem(item, { showHiddenItems: false, showRootFolder: true });
        const didExpand = target
            ? toggleNavigationExpansionTarget(
                  target,
                  {
                      expandedFolders: new Set(),
                      expandedTags: new Set(),
                      expandedProperties,
                      expandedVirtualFolders: new Set()
                  },
                  dispatch,
                  'expand',
                  { collapseOtherBranches }
              )
            : false;
        return { didExpand, dispatch };
    };

    it('expands a nested placement by its placement key', () => {
        const item = createValueItem(createValueNode('clients', 'Clients'), CLIENTS_UNDER_WORK, true);

        const { didExpand, dispatch } = expandItem(item, new Set([KEY_ID, WORK_ID]), false);

        expect(didExpand).toBe(true);
        expect(dispatch).toHaveBeenCalledWith({ type: 'TOGGLE_PROPERTY_EXPANDED', propertyNodeId: CLIENTS_UNDER_WORK });
    });

    it('replaces the expanded set with the whole placement chain for a nested placement', () => {
        // Was: a nested placement skipped branch replacement, because ancestorIds held node ids that
        // could not name the intermediate placements the row renders under, so replacement would have
        // collapsed the row it just expanded. Ancestors now come from the placement key itself.
        const item = createValueItem(createValueNode('clients', 'Clients'), CLIENTS_UNDER_WORK, true);

        const { didExpand, dispatch } = expandItem(item, new Set([KEY_ID, WORK_ID]), true);

        expect(didExpand).toBe(true);
        expect(dispatch).toHaveBeenCalledWith({
            type: 'SET_EXPANDED_PROPERTIES',
            properties: new Set([KEY_ID, WORK_ID, CLIENTS_UNDER_WORK])
        });
    });

    it('keeps a three deep placement rendering by naming every intermediate placement key', () => {
        // The load-bearing case: the middle entry of the replacement set is a placement key that
        // equals no node id, so only key-derived ancestors can produce it. Without it the flattener
        // never recurses deep enough to emit the row that was just expanded.
        const targetNode = createValueNode('datawerkplaats mooi maasvallei', 'Datawerkplaats Mooi Maasvallei');
        const placementKey = buildPropertyPlacementKey([WORK_ID, CLIENTS_ID, targetNode.id]);
        const item = createValueItem(targetNode, placementKey, true);

        const { didExpand, dispatch } = expandItem(item, new Set([KEY_ID, WORK_ID, CLIENTS_UNDER_WORK]), true);

        expect(didExpand).toBe(true);
        expect(dispatch).toHaveBeenCalledWith({
            type: 'SET_EXPANDED_PROPERTIES',
            properties: new Set([KEY_ID, WORK_ID, CLIENTS_UNDER_WORK, placementKey])
        });
    });

    it('drops a previously expanded sibling branch when another root placement expands', () => {
        const areasNode = createValueNode('areas', 'Areas');
        const item = createValueItem(areasNode, areasNode.id, true);

        const { didExpand, dispatch } = expandItem(item, new Set([KEY_ID, WORK_ID, CLIENTS_UNDER_WORK]), true);

        expect(didExpand).toBe(true);
        // The Work branch and its nested placement are both gone from the replacement set.
        expect(dispatch).toHaveBeenCalledWith({
            type: 'SET_EXPANDED_PROPERTIES',
            properties: new Set([KEY_ID, areasNode.id])
        });
    });

    it('leaves a flat non-hierarchical value replacing with the key node id alone, as before', () => {
        // A flat value's placement key is its node id, so the key-derived ancestor list must reduce to
        // exactly what getPropertyAncestorNodeIds returns. That equivalence is the regression guarantee
        // for every existing user whose keys are not hierarchical.
        const openNode = createValueNode('open', 'Open');
        const childNode = createValueNode('open/blocked', 'Blocked');
        openNode.children.set(childNode.id, childNode);
        const item = createValueItem(openNode, openNode.id);

        const { didExpand, dispatch } = expandItem(item, new Set([KEY_ID]), true);

        expect(getPropertyPlacementAncestorIds(openNode.id)).toEqual(getPropertyAncestorNodeIds(openNode.id));
        expect(getPropertyPlacementAncestorIds(openNode.id)).toEqual([KEY_ID]);
        expect(didExpand).toBe(true);
        expect(dispatch).toHaveBeenCalledWith({ type: 'SET_EXPANDED_PROPERTIES', properties: new Set([KEY_ID, openNode.id]) });
    });

    it('still replaces the expanded set for a root placement, whose key is its node id', () => {
        const workNode = createValueNode('work', 'Work');
        const item = createValueItem(workNode, workNode.id, true);

        const { didExpand, dispatch } = expandItem(item, new Set([KEY_ID]), true);

        expect(didExpand).toBe(true);
        expect(dispatch).toHaveBeenCalledWith({ type: 'SET_EXPANDED_PROPERTIES', properties: new Set([KEY_ID, workNode.id]) });
    });

    it('reports no children for a flat value with no hasChildren flag and no child nodes', () => {
        // A non-hierarchical key never sets the flag, so this falls back to the node's own children,
        // which is the check this site always used.
        const openNode = createValueNode('open', 'Open');
        const item = createValueItem(openNode, openNode.id);

        const { didExpand, dispatch } = expandItem(item, new Set([KEY_ID]), false);

        expect(didExpand).toBe(false);
        expect(dispatch).not.toHaveBeenCalled();
    });
});
