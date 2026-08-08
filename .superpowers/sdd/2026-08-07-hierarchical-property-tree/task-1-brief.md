## Task 1: The hierarchy index

**Files:**
- Create: `src/utils/propertyHierarchy.ts`
- Test: `tests/utils/propertyHierarchy.test.ts`

**Interfaces:**
- Consumes: `PropertyTreeNode` from `src/types/storage.ts`, `NoteCountInfo` from `src/types/noteCounts.ts`.
- Produces:
  ```ts
  interface PropertyHierarchyIndex {
      rootIds: ReadonlyMap<string, readonly string[]>;   // key node id -> root value node ids
      childIds: ReadonlyMap<string, readonly string[]>;  // value node id -> child value node ids
      subtreeCount: ReadonlyMap<string, number>;         // value node id -> deduped note count
  }
  const EMPTY_PROPERTY_HIERARCHY_INDEX: PropertyHierarchyIndex;
  function buildPropertyHierarchyIndex(params: {
      tree: ReadonlyMap<string, PropertyTreeNode>;
      hierarchicalKeys: ReadonlySet<string>;
      resolveValueNotePath: (node: PropertyTreeNode) => string | null;
  }): PropertyHierarchyIndex;
  function createPropertyNoteCountInfo(
      node: PropertyTreeNode,
      index: PropertyHierarchyIndex,
      includeDescendantNotes: boolean
  ): NoteCountInfo;
  ```

- [ ] **Step 1: Write the failing tests**

Create `tests/utils/propertyHierarchy.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { PropertyTreeNode } from '../../src/types/storage';
import {
    buildPropertyHierarchyIndex,
    createPropertyNoteCountInfo,
    EMPTY_PROPERTY_HIERARCHY_INDEX
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node node_modules/vitest/vitest.mjs run tests/utils/propertyHierarchy.test.ts`
Expected: FAIL, cannot resolve `../../src/utils/propertyHierarchy`.

- [ ] **Step 3: Write the implementation**

Create `src/utils/propertyHierarchy.ts`:

```ts
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

import type { PropertyTreeNode } from '../types/storage';
import type { NoteCountInfo } from '../types/noteCounts';

/**
 * Additive hierarchy over a property key's value nodes. The property tree itself is never
 * reparented: twenty sites assume a value node is a direct child of its key, including the lookup
 * property notes resolve through, so the nesting lives here instead and is keyed by existing node ids.
 */
export interface PropertyHierarchyIndex {
    /** Key node id to the value node ids rendered at that key's root. */
    rootIds: ReadonlyMap<string, readonly string[]>;
    /** Value node id to its child value node ids. May contain cycles; walkers must guard. */
    childIds: ReadonlyMap<string, readonly string[]>;
    /** Value node id to the deduped note count for that node and its whole subtree. */
    subtreeCount: ReadonlyMap<string, number>;
}

export const EMPTY_PROPERTY_HIERARCHY_INDEX: PropertyHierarchyIndex = {
    rootIds: new Map<string, readonly string[]>(),
    childIds: new Map<string, readonly string[]>(),
    subtreeCount: new Map<string, number>()
};

interface BuildPropertyHierarchyIndexParams {
    tree: ReadonlyMap<string, PropertyTreeNode>;
    /** Normalized property keys the user marked hierarchical. */
    hierarchicalKeys: ReadonlySet<string>;
    /**
     * Path of the note a value points at, or null when the value is not a wikilink or resolves to
     * nothing. Wire this to resolvePropertyNote so the hierarchy and property notes can never
     * disagree about which note a value means.
     */
    resolveValueNotePath: (node: PropertyTreeNode) => string | null;
}

export function buildPropertyHierarchyIndex({
    tree,
    hierarchicalKeys,
    resolveValueNotePath
}: BuildPropertyHierarchyIndexParams): PropertyHierarchyIndex {
    if (hierarchicalKeys.size === 0) {
        return EMPTY_PROPERTY_HIERARCHY_INDEX;
    }

    const rootIds = new Map<string, readonly string[]>();
    const childIds = new Map<string, readonly string[]>();
    const subtreeCount = new Map<string, number>();

    tree.forEach((keyNode, normalizedKey) => {
        if (!hierarchicalKeys.has(normalizedKey)) {
            return;
        }

        const valueNodes = Array.from(keyNode.children.values()).filter(node => node.kind === 'value');
        if (valueNodes.length === 0) {
            return;
        }

        // Which value nodes of this key each note carries. A value's parents are the values carried
        // by the note that value points at.
        const valuesByNotePath = new Map<string, string[]>();
        valueNodes.forEach(node => {
            node.notesWithValue.forEach(notePath => {
                const existing = valuesByNotePath.get(notePath);
                if (existing) {
                    existing.push(node.id);
                } else {
                    valuesByNotePath.set(notePath, [node.id]);
                }
            });
        });

        const parentsById = new Map<string, string[]>();
        valueNodes.forEach(node => {
            const notePath = resolveValueNotePath(node);
            // A value cannot parent itself. Dropping the self edge is what turns a hub note filed
            // under its own key, such as Categories, into a root rather than an unreachable island.
            const parents = notePath === null ? [] : (valuesByNotePath.get(notePath) ?? []).filter(id => id !== node.id);
            parentsById.set(node.id, parents);
        });

        const childrenById = new Map<string, string[]>();
        parentsById.forEach((parents, nodeId) => {
            parents.forEach(parentId => {
                const existing = childrenById.get(parentId);
                if (existing) {
                    existing.push(nodeId);
                } else {
                    childrenById.set(parentId, [nodeId]);
                }
            });
        });

        const roots = valueNodes.filter(node => (parentsById.get(node.id) ?? []).length === 0).map(node => node.id);

        // Reachability sweep. A cycle with no entry point, such as A parented by B and B parented by
        // A, is placed only under itself and would vanish from the tree. Promote whatever the walk
        // from the roots never reaches.
        const reached = new Set<string>();
        const visit = (nodeId: string): void => {
            if (reached.has(nodeId)) {
                return;
            }
            reached.add(nodeId);
            (childrenById.get(nodeId) ?? []).forEach(visit);
        };
        roots.forEach(visit);
        const promoted = valueNodes.filter(node => !reached.has(node.id)).map(node => node.id);
        promoted.forEach(visit);

        // Sorted for deterministic output; the flattener applies the user's comparator on top.
        rootIds.set(keyNode.id, [...roots, ...promoted].sort());
        childrenById.forEach((children, parentId) => {
            childIds.set(parentId, children.slice().sort());
        });

        // Deduped subtree counts, post-order with a cycle guard, matching getTotalNoteCount for tags.
        const nodesById = new Map(valueNodes.map(node => [node.id, node]));
        const collect = (nodeId: string, visiting: ReadonlySet<string>): ReadonlySet<string> => {
            const node = nodesById.get(nodeId);
            if (!node || visiting.has(nodeId)) {
                return new Set<string>();
            }
            const nextVisiting = new Set(visiting).add(nodeId);
            const notes = new Set<string>(node.notesWithValue);
            (childIds.get(nodeId) ?? []).forEach(childId => {
                collect(childId, nextVisiting).forEach(path => notes.add(path));
            });
            return notes;
        };
        valueNodes.forEach(node => {
            subtreeCount.set(node.id, collect(node.id, new Set<string>()).size);
        });
    });

    return { rootIds, childIds, subtreeCount };
}

/**
 * Note counts for a property value node, mirroring createTagNoteCountInfo so hierarchical properties
 * and tags present counts identically. Falls back to the node's own count when the node has no entry
 * in the index, which is every node while the key is not hierarchical.
 */
export function createPropertyNoteCountInfo(
    node: PropertyTreeNode,
    index: PropertyHierarchyIndex,
    includeDescendantNotes: boolean
): NoteCountInfo {
    const current = node.notesWithValue.size;
    if (!includeDescendantNotes) {
        return { current, descendants: 0, total: current };
    }

    const total = index.subtreeCount.get(node.id) ?? current;
    return { current, descendants: Math.max(total - current, 0), total };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node node_modules/vitest/vitest.mjs run tests/utils/propertyHierarchy.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Typecheck and format**

```bash
npx tsc -noEmit -skipLibCheck
node node_modules/prettier/bin/prettier.cjs --write src/utils/propertyHierarchy.ts tests/utils/propertyHierarchy.test.ts
node node_modules/eslint/bin/eslint.js src/utils/propertyHierarchy.ts tests/utils/propertyHierarchy.test.ts
```

Expected: no output from any of the three.

- [ ] **Step 6: Commit**

```bash
git add src/utils/propertyHierarchy.ts tests/utils/propertyHierarchy.test.ts
git commit -m "feat: add a property hierarchy index over the flat property tree"
```

---

