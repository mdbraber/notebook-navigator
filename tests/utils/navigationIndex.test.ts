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

import { describe, expect, it } from 'vitest';
import { TFolder } from 'obsidian';
import { ItemType, NavigationPaneItemType, PROPERTIES_ROOT_VIRTUAL_FOLDER_ID } from '../../src/types';
import type { PropertyTreeNode, TagTreeNode } from '../../src/types/storage';
import type { CombinedNavigationItem } from '../../src/types/virtualization';
import { buildNavigationPathIndexMap, getNavigationIndex } from '../../src/utils/navigationIndex';
import { buildPropertyKeyNodeId, buildPropertyValueNodeId } from '../../src/utils/propertyTree';
import { buildPropertyPlacementKey, getPropertyPlacementParentKey } from '../../src/utils/treeFlattener';

const CATEGORIES_KEY_NODE_ID = buildPropertyKeyNodeId('categories');
const valueNodeId = (value: string) => buildPropertyValueNodeId('categories', value.toLowerCase());

function createFolderItem(path: string): CombinedNavigationItem {
    const folder = new TFolder();
    Reflect.set(folder, 'path', path);
    Reflect.set(folder, 'name', path.split('/').pop() ?? path);
    Reflect.set(folder, 'children', []);

    return { type: NavigationPaneItemType.FOLDER, data: folder, level: 0, path, key: `folder-${path}` };
}

function createTagItem(path: string): CombinedNavigationItem {
    const tagNode: TagTreeNode = {
        name: path.split('/').pop() ?? path,
        path,
        displayPath: path,
        children: new Map(),
        notesWithTag: new Set()
    };

    return { type: NavigationPaneItemType.TAG, data: tagNode, level: 1, key: `tag-${path}` };
}

function createPropertyKeyNode(): PropertyTreeNode {
    return {
        id: CATEGORIES_KEY_NODE_ID,
        kind: 'key',
        key: 'categories',
        valuePath: null,
        name: 'categories',
        displayPath: 'categories',
        children: new Map(),
        notesWithValue: new Set()
    };
}

function createPropertyValueNode(value: string): PropertyTreeNode {
    return {
        id: valueNodeId(value),
        kind: 'value',
        key: 'categories',
        valuePath: value.toLowerCase(),
        name: value,
        displayPath: value,
        children: new Map(),
        notesWithValue: new Set()
    };
}

function createPropertyKeyItem(node: PropertyTreeNode): CombinedNavigationItem {
    return { type: NavigationPaneItemType.PROPERTY_KEY, data: node, level: 1, key: node.id };
}

/** A property value row. `placementKey` is the row's own key, which equals the node id for a flat value. */
function createPropertyValueItem(node: PropertyTreeNode, placementKey: string, level: number): CombinedNavigationItem {
    return { type: NavigationPaneItemType.PROPERTY_VALUE, data: node, level, key: placementKey };
}

/**
 * The author's vault shape: Clients is filed under both Areas and Categories, so it renders twice, and
 * Acme renders under the Areas placement of Clients.
 *
 *   categories
 *     Areas
 *       Clients
 *         Acme
 *     Categories
 *       Clients
 */
function createMultiPlacementItems(): {
    items: CombinedNavigationItem[];
    clientsUnderAreas: string;
    clientsUnderCategories: string;
    acmeUnderAreasClients: string;
} {
    const keyNode = createPropertyKeyNode();
    const areas = createPropertyValueNode('Areas');
    const categories = createPropertyValueNode('Categories');
    const clients = createPropertyValueNode('Clients');
    const acme = createPropertyValueNode('Acme');

    const clientsUnderAreas = buildPropertyPlacementKey([areas.id, clients.id]);
    const clientsUnderCategories = buildPropertyPlacementKey([categories.id, clients.id]);
    const acmeUnderAreasClients = buildPropertyPlacementKey([areas.id, clients.id, acme.id]);

    return {
        items: [
            createFolderItem('Projects'),
            createTagItem('work/clients'),
            createPropertyKeyItem(keyNode),
            createPropertyValueItem(areas, areas.id, 2),
            createPropertyValueItem(clients, clientsUnderAreas, 3),
            createPropertyValueItem(acme, acmeUnderAreasClients, 4),
            createPropertyValueItem(categories, categories.id, 2),
            createPropertyValueItem(clients, clientsUnderCategories, 3)
        ],
        clientsUnderAreas,
        clientsUnderCategories,
        acmeUnderAreasClients
    };
}

describe('buildNavigationPathIndexMap', () => {
    it('resolves each placement of a multi-parent value to its own row', () => {
        const { items, clientsUnderAreas, clientsUnderCategories } = createMultiPlacementItems();

        const indexMap = buildNavigationPathIndexMap(items);

        // Keyed by node id, both Clients rows collapsed onto one entry and the later one won, so a
        // lookup answered with a row in a branch the caller never asked about.
        expect(getNavigationIndex(indexMap, ItemType.PROPERTY, clientsUnderAreas)).toBe(4);
        expect(getNavigationIndex(indexMap, ItemType.PROPERTY, clientsUnderCategories)).toBe(7);
    });

    it('resolves the parent placement of a nested row, which is what collapsing left needs', () => {
        const { items, acmeUnderAreasClients, clientsUnderAreas } = createMultiPlacementItems();

        const indexMap = buildNavigationPathIndexMap(items);
        const parentKey = getPropertyPlacementParentKey(acmeUnderAreasClients);

        expect(parentKey).toBe(clientsUnderAreas);
        expect(getNavigationIndex(indexMap, ItemType.PROPERTY, parentKey ?? '')).toBe(4);
    });

    it('falls back to the topmost placement for a node id that names no row of its own', () => {
        const { items } = createMultiPlacementItems();

        const indexMap = buildNavigationPathIndexMap(items);

        // Selection is stored as a node id and carries no placement, so a bare node id has to keep
        // resolving. The first rendered placement wins, not whichever happened to be emitted last.
        expect(getNavigationIndex(indexMap, ItemType.PROPERTY, valueNodeId('Clients'))).toBe(4);
    });

    it('keeps a root placement addressable by its node id, since the two are the same string', () => {
        const { items } = createMultiPlacementItems();

        const indexMap = buildNavigationPathIndexMap(items);

        expect(getNavigationIndex(indexMap, ItemType.PROPERTY, valueNodeId('Areas'))).toBe(3);
        expect(getNavigationIndex(indexMap, ItemType.PROPERTY, valueNodeId('Categories'))).toBe(6);
        expect(getNavigationIndex(indexMap, ItemType.PROPERTY, CATEGORIES_KEY_NODE_ID)).toBe(2);
    });

    it('never lets a node id fallback shadow the row that owns that key', () => {
        // A cycle member promoted to a root is both somebody's child and a root in its own right, so
        // its node id is a real placement key on one row and a fallback on another.
        const keyNode = createPropertyKeyNode();
        const parent = createPropertyValueNode('Parent');
        const promoted = createPropertyValueNode('Promoted');
        const promotedUnderParent = buildPropertyPlacementKey([parent.id, promoted.id]);

        const indexMap = buildNavigationPathIndexMap([
            createPropertyKeyItem(keyNode),
            createPropertyValueItem(parent, parent.id, 2),
            createPropertyValueItem(promoted, promotedUnderParent, 3),
            createPropertyValueItem(promoted, promoted.id, 2)
        ]);

        expect(getNavigationIndex(indexMap, ItemType.PROPERTY, promoted.id)).toBe(3);
        expect(getNavigationIndex(indexMap, ItemType.PROPERTY, promotedUnderParent)).toBe(2);
    });

    it('resolves a value of a key that is not hierarchical by its node id, unchanged', () => {
        const keyNode = createPropertyKeyNode();
        const flatValue = createPropertyValueNode('Areas');

        const indexMap = buildNavigationPathIndexMap([createPropertyKeyItem(keyNode), createPropertyValueItem(flatValue, flatValue.id, 2)]);

        expect(getNavigationIndex(indexMap, ItemType.PROPERTY, flatValue.id)).toBe(1);
        expect(indexMap.size).toBe(2);
    });

    it('resolves folder and tag rows exactly as before, since property rows share this map', () => {
        const { items } = createMultiPlacementItems();

        const indexMap = buildNavigationPathIndexMap(items);

        expect(getNavigationIndex(indexMap, ItemType.FOLDER, 'Projects')).toBe(0);
        expect(getNavigationIndex(indexMap, ItemType.TAG, 'work/clients')).toBe(1);
        // Tag lookups normalize case; folders do not.
        expect(getNavigationIndex(indexMap, ItemType.TAG, 'Work/Clients')).toBe(1);
        expect(getNavigationIndex(indexMap, ItemType.FOLDER, 'projects')).toBeUndefined();
    });

    it('keys a virtual property collection row by its own key', () => {
        const indexMap = buildNavigationPathIndexMap([
            {
                type: NavigationPaneItemType.VIRTUAL_FOLDER,
                data: { id: PROPERTIES_ROOT_VIRTUAL_FOLDER_ID, name: 'Properties', icon: 'tags' },
                level: 0,
                key: PROPERTIES_ROOT_VIRTUAL_FOLDER_ID,
                propertyCollectionId: PROPERTIES_ROOT_VIRTUAL_FOLDER_ID
            }
        ]);

        expect(getNavigationIndex(indexMap, ItemType.PROPERTY, PROPERTIES_ROOT_VIRTUAL_FOLDER_ID)).toBe(0);
    });
});
