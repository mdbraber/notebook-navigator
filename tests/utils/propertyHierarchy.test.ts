import { describe, expect, it } from 'vitest';
import type { PropertyTreeNode } from '../../src/types/storage';
import {
    buildPropertyHierarchyIndex,
    collectPropertyValueSubtreeNotePaths,
    createPropertyNoteCountInfo,
    EMPTY_PROPERTY_HIERARCHY_INDEX,
    resolvePropertyRevealChain,
    type PropertyHierarchyIndex
} from '../../src/utils/propertyHierarchy';

/**
 * Builds a flat property tree the way buildPropertyTreeFromDatabase does: one key node whose
 * children are value nodes, each value node listing the notes that carry it.
 */
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
        entry.notes.forEach(note => keyNode.notesWithValue.add(note));
    }
    return new Map([[key, keyNode]]);
}

/** Resolves [[Name]] to Name.md, which is how the vault's link targets look. */
const resolveByName = (node: PropertyTreeNode): string | null => {
    const match = /^\[\[([^\]|]+)\]\]$/.exec(node.assignmentValue ?? '');
    return match ? `${match[1]}.md` : null;
};

const id = (key: string, value: string) => `key:${key}=${value.toLowerCase()}`;

describe('buildPropertyHierarchyIndex', () => {
    it('returns empty maps when no key is hierarchical', () => {
        const tree = createTree('projects', [{ value: 'Fiddle', notes: ['Fiddle.md'] }]);
        const index = buildPropertyHierarchyIndex({
            tree,
            hierarchicalKeys: new Set(),
            resolveValueNotePath: resolveByName
        });

        expect(index.rootIds.size).toBe(0);
        expect(index.childIds.size).toBe(0);
        expect(index.subtreeCount.size).toBe(0);
    });

    it('nests a value under the value its note carries', () => {
        // Building software.md carries projects: [[Fiddle]], so Building software nests under Fiddle.
        const tree = createTree('projects', [
            { value: 'Fiddle', notes: ['Building software.md'] },
            { value: 'Building software', notes: ['Bulwark.md'] }
        ]);
        const index = buildPropertyHierarchyIndex({
            tree,
            hierarchicalKeys: new Set(['projects']),
            resolveValueNotePath: resolveByName
        });

        expect(index.rootIds.get('key:projects')).toEqual([id('projects', 'Fiddle')]);
        expect(index.childIds.get(id('projects', 'Fiddle'))).toEqual([id('projects', 'Building software')]);
    });

    it('treats a value whose link resolves to nothing as a root', () => {
        // The vault has a projects value `Tools` that is not a note at all.
        const tree = createTree('projects', [{ value: 'Tools', notes: ['macOS.md'] }]);
        const index = buildPropertyHierarchyIndex({
            tree,
            hierarchicalKeys: new Set(['projects']),
            resolveValueNotePath: () => null
        });

        expect(index.rootIds.get('key:projects')).toEqual([id('projects', 'Tools')]);
    });

    it('drops a self edge so a value filed under itself is a root', () => {
        // Categories.md carries categories: [[Categories]] in the real vault.
        const tree = createTree('categories', [
            { value: 'Categories', notes: ['Categories.md', 'Software.md'] },
            { value: 'Software', notes: ['Bulwark.md'] }
        ]);
        const index = buildPropertyHierarchyIndex({
            tree,
            hierarchicalKeys: new Set(['categories']),
            resolveValueNotePath: resolveByName
        });

        expect(index.rootIds.get('key:categories')).toEqual([id('categories', 'Categories')]);
        expect(index.childIds.get(id('categories', 'Categories'))).toEqual([id('categories', 'Software')]);
    });

    it('emits both members of a two node cycle as roots so neither disappears', () => {
        // A.md carries [[B]] and B.md carries [[A]]. Each is only under the other, so without the
        // reachability sweep the pair would be unreachable from the tree root.
        const tree = createTree('topics', [
            { value: 'A', notes: ['B.md'] },
            { value: 'B', notes: ['A.md'] }
        ]);
        const index = buildPropertyHierarchyIndex({
            tree,
            hierarchicalKeys: new Set(['topics']),
            resolveValueNotePath: resolveByName
        });

        expect(index.rootIds.get('key:topics')).toEqual([id('topics', 'A'), id('topics', 'B')]);
        expect(index.childIds.get(id('topics', 'A'))).toEqual([id('topics', 'B')]);
        expect(index.childIds.get(id('topics', 'B'))).toEqual([id('topics', 'A')]);
    });

    it('gives a value two parents when its note carries two values', () => {
        // Clients.md carries categories: [[Areas]], [[Categories]] in the real vault.
        const tree = createTree('categories', [
            { value: 'Areas', notes: ['Clients.md'] },
            { value: 'Categories', notes: ['Clients.md'] },
            { value: 'Clients', notes: ['Acme.md'] }
        ]);
        const index = buildPropertyHierarchyIndex({
            tree,
            hierarchicalKeys: new Set(['categories']),
            resolveValueNotePath: resolveByName
        });

        expect(index.childIds.get(id('categories', 'Areas'))).toEqual([id('categories', 'Clients')]);
        expect(index.childIds.get(id('categories', 'Categories'))).toEqual([id('categories', 'Clients')]);
        expect(index.rootIds.get('key:categories')).toEqual([id('categories', 'Areas'), id('categories', 'Categories')]);
    });

    it('dedups a note that carries both a parent and a child value', () => {
        // Bulwark.md carries both [[Fiddle]] and [[Building software]], so Fiddle's subtree counts it once.
        const tree = createTree('projects', [
            { value: 'Fiddle', notes: ['Building software.md', 'Bulwark.md'] },
            { value: 'Building software', notes: ['Bulwark.md'] }
        ]);
        const index = buildPropertyHierarchyIndex({
            tree,
            hierarchicalKeys: new Set(['projects']),
            resolveValueNotePath: resolveByName
        });

        expect(index.subtreeCount.get(id('projects', 'Fiddle'))).toBe(2);
        expect(index.subtreeCount.get(id('projects', 'Building software'))).toBe(1);
    });

    it('terminates subtree counting on a cycle', () => {
        const tree = createTree('topics', [
            { value: 'A', notes: ['B.md', 'x.md'] },
            { value: 'B', notes: ['A.md', 'y.md'] }
        ]);
        const index = buildPropertyHierarchyIndex({
            tree,
            hierarchicalKeys: new Set(['topics']),
            resolveValueNotePath: resolveByName
        });

        expect(index.subtreeCount.get(id('topics', 'A'))).toBe(4);
    });

    it('records the parents of every value, empty for a root', () => {
        const tree = createTree('categories', [
            { value: 'Areas', notes: ['Clients.md'] },
            { value: 'Categories', notes: ['Clients.md'] },
            { value: 'Clients', notes: ['Acme.md'] }
        ]);
        const index = buildPropertyHierarchyIndex({
            tree,
            hierarchicalKeys: new Set(['categories']),
            resolveValueNotePath: resolveByName
        });

        expect(index.parentIds.get(id('categories', 'Areas'))).toEqual([]);
        expect(index.parentIds.get(id('categories', 'Clients'))).toEqual([id('categories', 'Areas'), id('categories', 'Categories')]);
    });
});

/**
 * Calls resolvePropertyRevealChain the way navigateToProperty does: the key node id decides which
 * rootIds list the walk may stop at, and the depth cap is the one the flattener renders with.
 */
function resolveChain(index: PropertyHierarchyIndex, key: string, nodeId: string, maxDepth = 10): string[] | null {
    return resolvePropertyRevealChain({ index, keyNodeId: `key:${key}`, nodeId, maxDepth });
}

describe('resolvePropertyRevealChain', () => {
    it('resolves a root-to-target chain with nothing expanded', () => {
        // Work <- Clients <- Datawerkplaats. No expansion state is involved at all, which is the whole
        // point: what the flattener emitted covers only rows that are already visible, so it can never
        // tell reveal which ancestors to expand.
        const tree = createTree('projects', [
            { value: 'Work', notes: ['Clients.md'] },
            { value: 'Clients', notes: ['Datawerkplaats.md'] },
            { value: 'Datawerkplaats', notes: ['note.md'] }
        ]);
        const index = buildPropertyHierarchyIndex({
            tree,
            hierarchicalKeys: new Set(['projects']),
            resolveValueNotePath: resolveByName
        });

        expect(resolveChain(index, 'projects', id('projects', 'Datawerkplaats'))).toEqual([
            id('projects', 'Work'),
            id('projects', 'Clients'),
            id('projects', 'Datawerkplaats')
        ]);
    });

    it('returns a single element chain for a root, which needs no ancestor expanded', () => {
        const tree = createTree('projects', [{ value: 'Fiddle', notes: ['note.md'] }]);
        const index = buildPropertyHierarchyIndex({
            tree,
            hierarchicalKeys: new Set(['projects']),
            resolveValueNotePath: resolveByName
        });

        expect(resolveChain(index, 'projects', id('projects', 'Fiddle'))).toEqual([id('projects', 'Fiddle')]);
    });

    it('returns null for a node the index does not know, such as a non-hierarchical value', () => {
        const tree = createTree('status', [{ value: 'Open', notes: ['note.md'] }]);
        const index = buildPropertyHierarchyIndex({
            tree,
            hierarchicalKeys: new Set(),
            resolveValueNotePath: resolveByName
        });

        expect(resolveChain(index, 'status', id('status', 'Open'))).toBeNull();
        expect(resolveChain(EMPTY_PROPERTY_HIERARCHY_INDEX, 'status', id('status', 'Open'))).toBeNull();
    });

    it('heads the chain at a node the key actually renders, never at a cycle member', () => {
        // Root -> A, plus A <-> B. A's sorted parents are [B, Root], so taking the first parent heads
        // the chain at B - which is not in rootIds and renders only under A. Expanding a placement key
        // naming no rendered row is not a harmless no-op: with collapseOtherBranchesOnExpand on the
        // replacement set drops Root, so revealing A collapses the only branch A was visible in.
        const tree = createTree('projects', [
            { value: 'Root', notes: ['A.md'] },
            { value: 'B', notes: ['A.md'] },
            { value: 'A', notes: ['B.md'] }
        ]);
        const index = buildPropertyHierarchyIndex({
            tree,
            hierarchicalKeys: new Set(['projects']),
            resolveValueNotePath: resolveByName
        });

        expect(index.parentIds.get(id('projects', 'A'))).toEqual([id('projects', 'B'), id('projects', 'Root')]);
        expect(index.rootIds.get('key:projects')).toEqual([id('projects', 'Root')]);

        const chain = resolveChain(index, 'projects', id('projects', 'A'));
        expect(chain).toEqual([id('projects', 'Root'), id('projects', 'A')]);
        // The invariant, stated on its own so it holds for every chain and not just this shape.
        expect(index.rootIds.get('key:projects')).toContain(chain?.[0]);
    });

    it('returns no chain when the target is deeper than the flattener would render', () => {
        // Work <- Clients <- Datawerkplaats is two edges deep. At a cap of one, the target's row can
        // never be emitted, so expanding its prefixes would only replace the user's open branches.
        const tree = createTree('projects', [
            { value: 'Work', notes: ['Clients.md'] },
            { value: 'Clients', notes: ['Datawerkplaats.md'] },
            { value: 'Datawerkplaats', notes: ['note.md'] }
        ]);
        const index = buildPropertyHierarchyIndex({
            tree,
            hierarchicalKeys: new Set(['projects']),
            resolveValueNotePath: resolveByName
        });

        expect(resolveChain(index, 'projects', id('projects', 'Datawerkplaats'), 1)).toBeNull();
        expect(resolveChain(index, 'projects', id('projects', 'Clients'), 1)).toEqual([id('projects', 'Work'), id('projects', 'Clients')]);
    });

    it('terminates on a cycle instead of looping', () => {
        // A.md carries [[B]] and B.md carries [[A]], so each is the other's parent. Both are promoted
        // to roots by the index, so stopping at the node already in the chain leaves a chain whose head
        // is a row that actually exists.
        const tree = createTree('topics', [
            { value: 'A', notes: ['B.md'] },
            { value: 'B', notes: ['A.md'] }
        ]);
        const index = buildPropertyHierarchyIndex({
            tree,
            hierarchicalKeys: new Set(['topics']),
            resolveValueNotePath: resolveByName
        });

        expect(resolveChain(index, 'topics', id('topics', 'A'))).toEqual([id('topics', 'A')]);
        expect(index.rootIds.get('key:topics')).toContain(id('topics', 'A'));
    });
});

describe('collectPropertyValueSubtreeNotePaths', () => {
    it('is the set subtreeCount counts, so a badge and a selection cannot disagree', () => {
        // Bulwark.md carries both Fiddle and Building software, so it is one path in the union.
        const tree = createTree('projects', [
            { value: 'Fiddle', notes: ['Building software.md', 'Bulwark.md'] },
            { value: 'Building software', notes: ['Bulwark.md', 'other.md'] }
        ]);
        const index = buildPropertyHierarchyIndex({
            tree,
            hierarchicalKeys: new Set(['projects']),
            resolveValueNotePath: resolveByName
        });
        const keyNode = tree.get('projects') as PropertyTreeNode;

        const paths = collectPropertyValueSubtreeNotePaths(keyNode, id('projects', 'Fiddle'), index);
        expect(paths).toEqual(new Set(['Building software.md', 'Bulwark.md', 'other.md']));
        expect(paths.size).toBe(index.subtreeCount.get(id('projects', 'Fiddle')));
    });

    it('terminates on a cycle and returns own notes when the key is not hierarchical', () => {
        const cyclicTree = createTree('topics', [
            { value: 'A', notes: ['B.md', 'x.md'] },
            { value: 'B', notes: ['A.md', 'y.md'] }
        ]);
        const cyclicIndex = buildPropertyHierarchyIndex({
            tree: cyclicTree,
            hierarchicalKeys: new Set(['topics']),
            resolveValueNotePath: resolveByName
        });
        const topicsKeyNode = cyclicTree.get('topics') as PropertyTreeNode;

        expect(collectPropertyValueSubtreeNotePaths(topicsKeyNode, id('topics', 'A'), cyclicIndex)).toEqual(
            new Set(['A.md', 'B.md', 'x.md', 'y.md'])
        );
        // No index entry, which is every value while its key is flat: own notes only.
        expect(collectPropertyValueSubtreeNotePaths(topicsKeyNode, id('topics', 'A'), EMPTY_PROPERTY_HIERARCHY_INDEX)).toEqual(
            new Set(['B.md', 'x.md'])
        );
    });
});

describe('createPropertyNoteCountInfo', () => {
    const tree = createTree('projects', [
        { value: 'Fiddle', notes: ['Building software.md', 'a.md'] },
        { value: 'Building software', notes: ['b.md', 'c.md'] }
    ]);
    const index = buildPropertyHierarchyIndex({
        tree,
        hierarchicalKeys: new Set(['projects']),
        resolveValueNotePath: resolveByName
    });
    const fiddle = tree.get('projects')?.children.get(id('projects', 'Fiddle')) as PropertyTreeNode;

    it('reports own count only when descendants are excluded', () => {
        expect(createPropertyNoteCountInfo(fiddle, index, false)).toEqual({ current: 2, descendants: 0, total: 2 });
    });

    it('splits current and descendants when descendants are included', () => {
        expect(createPropertyNoteCountInfo(fiddle, index, true)).toEqual({ current: 2, descendants: 2, total: 4 });
    });

    it('falls back to own count when the node is not in the index', () => {
        expect(createPropertyNoteCountInfo(fiddle, EMPTY_PROPERTY_HIERARCHY_INDEX, true)).toEqual({
            current: 2,
            descendants: 0,
            total: 2
        });
    });
});
