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
import {
    buildVisibleFolderTraversalState,
    flattenFolderTree,
    buildPropertyPlacementKey,
    flattenPropertyHierarchy,
    getPropertyPlacementAncestorKeys
} from '../../src/utils/treeFlattener';
import { buildPropertyHierarchyIndex } from '../../src/utils/propertyHierarchy';
import type { PropertyTreeNode } from '../../src/types/storage';

function getFolderName(path: string): string {
    if (path === '/') {
        return '/';
    }
    const parts = path.split('/');
    return parts[parts.length - 1] || path;
}

function createFolder(path: string, children: TFolder[] = []): TFolder {
    const folder = new TFolder();
    Reflect.set(folder, 'path', path);
    Reflect.set(folder, 'name', getFolderName(path));
    Reflect.set(folder, 'children', children);
    return folder;
}

describe('treeFlattener flattenFolderTree', () => {
    it('sorts folders by folder name when no custom sort name resolver is provided', () => {
        const alpha = createFolder('alpha');
        const zeta = createFolder('zeta');
        const root = createFolder('/', [zeta, alpha]);
        const expandedFolders = new Set<string>(['/']);

        const items = flattenFolderTree([root], expandedFolders, [], 0, new Set(), {
            defaultSortOrder: 'alpha-asc'
        });

        const childPaths = items.filter(item => item.level === 1).map(item => item.data.path);
        expect(childPaths).toEqual(['alpha', 'zeta']);
    });

    it('sorts folders by provided sort names when a custom resolver is provided', () => {
        const alpha = createFolder('alpha');
        const zeta = createFolder('zeta');
        const root = createFolder('/', [zeta, alpha]);
        const expandedFolders = new Set<string>(['/']);

        const sortNames = new Map<string, string>([
            ['alpha', 'Zulu'],
            ['zeta', 'Alpha']
        ]);

        const items = flattenFolderTree([root], expandedFolders, [], 0, new Set(), {
            defaultSortOrder: 'alpha-asc',
            getFolderSortName: folder => sortNames.get(folder.path) ?? folder.name
        });

        const childPaths = items.filter(item => item.level === 1).map(item => item.data.path);
        expect(childPaths).toEqual(['zeta', 'alpha']);
    });

    it('marks folders as excluded when custom exclusion resolver returns true', () => {
        const visible = createFolder('visible');
        const archived = createFolder('archived');
        const root = createFolder('/', [visible, archived]);
        const expandedFolders = new Set<string>(['/']);

        const items = flattenFolderTree([root], expandedFolders, [], 0, new Set(), {
            defaultSortOrder: 'alpha-asc',
            isFolderExcluded: folder => folder.path === 'archived'
        });

        const archivedItem = items.find(item => item.data.path === 'archived');
        const visibleItem = items.find(item => item.data.path === 'visible');
        expect(archivedItem?.isExcluded).toBe(true);
        expect(visibleItem?.isExcluded).toBeUndefined();
    });

    it('builds sibling groups without excluded folders', () => {
        const childA = createFolder('Projects/A');
        const childB = createFolder('Projects/B');
        const archived = createFolder('Projects/Archived');
        const projects = createFolder('Projects', [childB, archived, childA]);
        const root = createFolder('/', [projects]);

        const traversalState = buildVisibleFolderTraversalState({
            rootFolders: [root],
            excludePatterns: [],
            defaultSortOrder: 'alpha-asc',
            isFolderExcluded: folder => folder.path === 'Projects/Archived'
        });

        expect(traversalState.siblingPathsByParent.get('Projects')).toEqual(['Projects/A', 'Projects/B']);
    });

    it('builds sibling groups using custom folder sort names', () => {
        const bravo = createFolder('Projects/bravo');
        const alpha = createFolder('Projects/alpha');
        const projects = createFolder('Projects', [alpha, bravo]);
        const root = createFolder('/', [projects]);

        const sortNames = new Map<string, string>([
            ['Projects/alpha', 'Zulu'],
            ['Projects/bravo', 'Alpha']
        ]);

        const traversalState = buildVisibleFolderTraversalState({
            rootFolders: [root],
            excludePatterns: [],
            defaultSortOrder: 'alpha-asc',
            getFolderSortName: folder => sortNames.get(folder.path) ?? folder.name
        });

        expect(traversalState.siblingPathsByParent.get('Projects')).toEqual(['Projects/bravo', 'Projects/alpha']);
    });

    it('does not mutate caller-owned root folder arrays when sorting root siblings', () => {
        const bravo = createFolder('bravo');
        const alpha = createFolder('alpha');
        const rootFolders = [bravo, alpha];

        const traversalState = buildVisibleFolderTraversalState({
            rootFolders,
            excludePatterns: [],
            defaultSortOrder: 'alpha-asc'
        });

        expect(traversalState.siblingPathsByParent.get('/')).toEqual(['alpha', 'bravo']);
        expect(rootFolders.map(folder => folder.path)).toEqual(['bravo', 'alpha']);
    });

    it('continues traversing children when a parent folder is excluded from sibling coloring', () => {
        const visibleChild = createFolder('Projects/VisibleChild');
        const hiddenParent = createFolder('Projects', [visibleChild]);
        const root = createFolder('/', [hiddenParent]);

        const traversalState = buildVisibleFolderTraversalState({
            rootFolders: [root],
            excludePatterns: [],
            defaultSortOrder: 'alpha-asc',
            isFolderExcluded: folder => folder.path === 'Projects'
        });

        expect(traversalState.siblingPathsByParent.get('/')).toEqual([]);
        expect(traversalState.siblingPathsByParent.get('Projects')).toEqual(['Projects/VisibleChild']);
    });

    it('stops after root sibling groups when descendant traversal is disabled', () => {
        const childA = createFolder('Projects/A');
        const childB = createFolder('Projects/B');
        const projects = createFolder('Projects', [childA, childB]);
        const root = createFolder('/', [projects]);

        const traversalState = buildVisibleFolderTraversalState({
            rootFolders: [root],
            excludePatterns: [],
            defaultSortOrder: 'alpha-asc',
            includeDescendantSiblingGroups: false
        });

        expect(traversalState.siblingPathsByParent.get('/')).toEqual(['Projects']);
        expect(traversalState.siblingPathsByParent.has('Projects')).toBe(false);
    });
});

describe('flattenPropertyHierarchy', () => {
    function createTree(key: string, values: { value: string; notes: string[] }[]): Map<string, PropertyTreeNode> {
        const keyNode: PropertyTreeNode = {
            id: `key:${key}`,
            kind: 'key',
            key,
            valuePath: null,
            name: key,
            displayPath: key,
            children: new Map(),
            notesWithValue: new Set()
        };
        for (const entry of values) {
            const id = `key:${key}=${entry.value.toLowerCase()}`;
            keyNode.children.set(id, {
                id,
                kind: 'value',
                key,
                valuePath: entry.value.toLowerCase(),
                name: entry.value,
                displayPath: entry.value,
                assignmentValue: `[[${entry.value}]]`,
                children: new Map(),
                notesWithValue: new Set(entry.notes)
            });
        }
        return new Map([[key, keyNode]]);
    }

    const resolveByName = (node: PropertyTreeNode): string | null => {
        const match = /^\[\[([^\]|]+)\]\]$/.exec(node.assignmentValue ?? '');
        return match ? `${match[1]}.md` : null;
    };
    const byName = (a: PropertyTreeNode, b: PropertyTreeNode) => a.name.localeCompare(b.name);
    const id = (key: string, value: string) => `key:${key}=${value.toLowerCase()}`;

    function flatten(tree: Map<string, PropertyTreeNode>, key: string, expanded: string[], maxDepth = 10) {
        const index = buildPropertyHierarchyIndex({
            tree,
            hierarchicalKeys: new Set([key]),
            resolveValueNotePath: resolveByName
        });
        return flattenPropertyHierarchy({
            keyNode: tree.get(key) as PropertyTreeNode,
            index,
            expandedPlacements: new Set(expanded),
            level: 1,
            maxDepth,
            comparator: byName
        });
    }

    it('emits only roots while nothing is expanded', () => {
        const tree = createTree('projects', [
            { value: 'Fiddle', notes: ['Building software.md'] },
            { value: 'Building software', notes: ['Bulwark.md'] },
            { value: 'Work', notes: [] }
        ]);

        const result = flatten(tree, 'projects', []);

        expect(result.map(item => item.data.name)).toEqual(['Fiddle', 'Work']);
        expect(result.every(item => item.level === 1)).toBe(true);
    });

    it('keys a root placement by the node id alone so flat expansion keeps working', () => {
        const tree = createTree('projects', [{ value: 'Fiddle', notes: [] }]);

        const result = flatten(tree, 'projects', []);

        expect(result[0].key).toBe(id('projects', 'Fiddle'));
    });

    it('emits children with a chained key and an incremented level when expanded', () => {
        const tree = createTree('projects', [
            { value: 'Fiddle', notes: ['Building software.md'] },
            { value: 'Building software', notes: [] }
        ]);
        const fiddleKey = id('projects', 'Fiddle');

        const result = flatten(tree, 'projects', [fiddleKey]);

        expect(result.map(item => [item.data.name, item.level])).toEqual([
            ['Fiddle', 1],
            ['Building software', 2]
        ]);
        expect(result[1].key).toBe(buildPropertyPlacementKey([fiddleKey, id('projects', 'Building software')]));
    });

    it('expands one placement of a two parent value without expanding the other', () => {
        const tree = createTree('categories', [
            { value: 'Areas', notes: ['Clients.md'] },
            { value: 'Categories', notes: ['Clients.md'] },
            { value: 'Clients', notes: ['Acme.md'] },
            { value: 'Acme', notes: [] }
        ]);
        const underAreas = buildPropertyPlacementKey([id('categories', 'Areas'), id('categories', 'Clients')]);

        const result = flatten(tree, 'categories', [id('categories', 'Areas'), id('categories', 'Categories'), underAreas]);

        // Clients appears under both parents, but only the Areas placement shows Acme.
        expect(result.map(item => [item.data.name, item.level])).toEqual([
            ['Areas', 1],
            ['Clients', 2],
            ['Acme', 3],
            ['Categories', 1],
            ['Clients', 2]
        ]);
    });

    it('stops at maxDepth without emitting deeper levels', () => {
        const tree = createTree('projects', [
            { value: 'Work', notes: ['Clients.md'] },
            { value: 'Clients', notes: ['Acme.md'] },
            { value: 'Acme', notes: [] }
        ]);
        const workKey = id('projects', 'Work');
        const clientsKey = buildPropertyPlacementKey([workKey, id('projects', 'Clients')]);

        const deep = flatten(tree, 'projects', [workKey, clientsKey], 10);
        expect(deep.map(item => item.data.name)).toEqual(['Work', 'Clients', 'Acme']);

        const capped = flatten(tree, 'projects', [workKey, clientsKey], 1);
        expect(capped.map(item => item.data.name)).toEqual(['Work', 'Clients']);
    });

    it('does not loop forever on a cycle in the index', () => {
        const tree = createTree('topics', [
            { value: 'A', notes: ['B.md'] },
            { value: 'B', notes: ['A.md'] }
        ]);
        const aKey = id('topics', 'A');
        const bUnderA = buildPropertyPlacementKey([aKey, id('topics', 'B')]);

        const result = flatten(tree, 'topics', [aKey, bUnderA, id('topics', 'B')]);

        // B is expanded under A, and its only child is A, which is already in this chain, so the
        // walk stops there rather than recursing.
        expect(result.map(item => [item.data.name, item.level])).toEqual([
            ['A', 1],
            ['B', 2],
            ['B', 1],
            ['A', 2]
        ]);
    });
});

describe('getPropertyPlacementAncestorKeys', () => {
    const id = (key: string, value: string) => `key:${key}=${value.toLowerCase()}`;

    it('produces every prefix of a three-deep chain, in root-to-parent order', () => {
        const workId = id('projects', 'work');
        const clientsId = id('projects', 'clients');
        const targetId = id('projects', 'datawerkplaats mooi maasvallei');

        const ancestorKeys = getPropertyPlacementAncestorKeys([workId, clientsId, targetId]);

        expect(ancestorKeys).toEqual([buildPropertyPlacementKey([workId]), buildPropertyPlacementKey([workId, clientsId])]);
    });

    it('returns no ancestors for a single-element chain, which is a root placement or a flat value', () => {
        expect(getPropertyPlacementAncestorKeys([id('projects', 'fiddle')])).toEqual([]);
        expect(getPropertyPlacementAncestorKeys([id('status', 'open')])).toEqual([]);
    });
});
