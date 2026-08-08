# Hierarchical Property Trees Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a property key be marked Hierarchical from its context menu, so its value nodes render as a nested DAG in the navigation pane, with a value's parent derived from the note that value points at.

**Architecture:** The flat property tree is never mutated. A new pure module computes an additive index (roots, children, deduped subtree counts) keyed by existing node ids, and a new flattener in the shared `treeFlattener.ts` walks that index to emit nested navigation items. Placement identity is an accumulated chain of node ids, mirroring how tags key identity by `node.path`.

**Tech Stack:** TypeScript, React, Obsidian plugin API, vitest (`environment: 'node'`, no DOM).

## Global Constraints

- **Never mutate the property tree.** Value nodes stay direct children of their key node. Twenty sites across twelve files depend on this, including `resolvePropertyTreeNode` (`src/utils/propertyTree.ts:699`), which property notes resolve through.
- **Flag off means byte-identical behaviour.** With no hierarchical keys the index is empty and the existing flat emitter path runs unchanged.
- **Counts mirror tags.** `createPropertyNoteCountInfo` returns the same `NoteCountInfo` shape as `createTagNoteCountInfo` (`src/utils/tagTree.ts:430`), and subtree counting dedups by note path with a cycle guard exactly as `getTotalNoteCount` (`src/utils/tagTree.ts:394`) does.
- **Placement separator is `String.fromCharCode(0)`.** Node ids can contain both `:` and `/`; a NUL cannot occur in one. Precedent: `src/hooks/listPaneData/listItems.ts:127`.
- **The depth cap lives in the flattener, never the index.** Depth depends on which chain reaches a node, so it is a rendering property. This keeps `subtreeCount` honest: changing a display cap must never change a count.
- **Auto-reveal targets the first placement**, matching the first-occurrence rule of `buildFilePathToIndexMap`.
- **Selection, icons and colours stay keyed by node id.** A value looks identical wherever it appears.
- **List pane grouping is out of scope.** It stays flat.
- **Every new user-facing string needs all 21 locales** in `src/i18n/locales/`, because `getResolvedStrings` returns a locale object wholesale with no merge, so a missing key is a compile error.
- **Do not use em dashes** in comments, commit messages, or strings.
- **Test commands must be invoked through node.** `node_modules/.bin` is empty in this checkout, so `npm test` and `npx vitest` both fail. Use `node node_modules/vitest/vitest.mjs run <path>`.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `src/utils/propertyHierarchy.ts` | Pure. Builds the additive hierarchy index from a flat tree plus a resolver. Also derives note counts from it. |
| `tests/utils/propertyHierarchy.test.ts` | Unit tests for the index and the count helper. |

**Modified:**

| File | Change |
|---|---|
| `src/utils/treeFlattener.ts` | Add `flattenPropertyHierarchy` beside `flattenTagTree`. |
| `tests/utils/treeFlattener.test.ts` | Tests for the new flattener. |
| `src/settings/types.ts` | Two new settings fields. |
| `src/settings/defaultSettings.ts` | Their defaults. |
| `src/settings/tabs/PropertiesTab.ts` | The depth slider. |
| `src/utils/contextMenu/propertyMenuBuilder.ts` | Checkable Hierarchical item on property key rows. |
| `src/i18n/locales/*.ts` (21 files) | New strings. |
| `src/hooks/navigationPane/data/useNavigationPaneTreeSections.ts` | Build the index, branch the emitter, fix the frequency comparator. |
| `src/components/PropertyTreeItem.tsx` | Chevron consults the index for hierarchical keys. |
| `src/hooks/navigationPane/useNavigationPaneTreeInteractions.ts` | Expand and reveal by placement key. |

---

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

## Task 2: The flattener

**Files:**
- Modify: `src/utils/treeFlattener.ts` (add at end, beside `flattenTagTree`)
- Test: `tests/utils/treeFlattener.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `PropertyHierarchyIndex` from Task 1, `PropertyTreeNode`, `PropertyValueTreeItem` from `src/types/virtualization.ts` (fields: `type`, `data`, `level`, `key`).
- Produces:
  ```ts
  const PROPERTY_PLACEMENT_SEPARATOR: string;                 // String.fromCharCode(0)
  function buildPropertyPlacementKey(chain: readonly string[]): string;
  interface FlattenPropertyHierarchyResult {
      items: PropertyValueTreeItem[];
      firstPlacementByNodeId: Map<string, string>;
  }
  function flattenPropertyHierarchy(params: {
      keyNode: PropertyTreeNode;
      index: PropertyHierarchyIndex;
      expandedPlacements: ReadonlySet<string>;
      level: number;
      maxDepth: number;
      comparator: (a: PropertyTreeNode, b: PropertyTreeNode) => number;
      getChildComparator?: (parentNodeId: string) => ((a: PropertyTreeNode, b: PropertyTreeNode) => number) | undefined;
  }): FlattenPropertyHierarchyResult;
  ```

- [ ] **Step 1: Write the failing tests**

Append to `tests/utils/treeFlattener.test.ts`. Add these imports to the existing import block at the top of the file:

```ts
import { buildPropertyPlacementKey, flattenPropertyHierarchy } from '../../src/utils/treeFlattener';
import { buildPropertyHierarchyIndex } from '../../src/utils/propertyHierarchy';
import type { PropertyTreeNode } from '../../src/types/storage';
```

Then append:

```ts
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

    function flatten(
        tree: Map<string, PropertyTreeNode>,
        key: string,
        expanded: string[],
        maxDepth = 10
    ) {
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

        expect(result.items.map(item => item.data.name)).toEqual(['Fiddle', 'Work']);
        expect(result.items.every(item => item.level === 1)).toBe(true);
    });

    it('keys a root placement by the node id alone so flat expansion keeps working', () => {
        const tree = createTree('projects', [{ value: 'Fiddle', notes: [] }]);

        const result = flatten(tree, 'projects', []);

        expect(result.items[0].key).toBe(id('projects', 'Fiddle'));
    });

    it('emits children with a chained key and an incremented level when expanded', () => {
        const tree = createTree('projects', [
            { value: 'Fiddle', notes: ['Building software.md'] },
            { value: 'Building software', notes: [] }
        ]);
        const fiddleKey = id('projects', 'Fiddle');

        const result = flatten(tree, 'projects', [fiddleKey]);

        expect(result.items.map(item => [item.data.name, item.level])).toEqual([
            ['Fiddle', 1],
            ['Building software', 2]
        ]);
        expect(result.items[1].key).toBe(buildPropertyPlacementKey([fiddleKey, id('projects', 'Building software')]));
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
        expect(result.items.map(item => [item.data.name, item.level])).toEqual([
            ['Areas', 1],
            ['Clients', 2],
            ['Acme', 3],
            ['Categories', 1],
            ['Clients', 2]
        ]);
    });

    it('records the first placement of each node id', () => {
        const tree = createTree('categories', [
            { value: 'Areas', notes: ['Clients.md'] },
            { value: 'Categories', notes: ['Clients.md'] },
            { value: 'Clients', notes: [] }
        ]);

        const result = flatten(tree, 'categories', [id('categories', 'Areas'), id('categories', 'Categories')]);

        expect(result.firstPlacementByNodeId.get(id('categories', 'Clients'))).toBe(
            buildPropertyPlacementKey([id('categories', 'Areas'), id('categories', 'Clients')])
        );
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
        expect(deep.items.map(item => item.data.name)).toEqual(['Work', 'Clients', 'Acme']);

        const capped = flatten(tree, 'projects', [workKey, clientsKey], 1);
        expect(capped.items.map(item => item.data.name)).toEqual(['Work', 'Clients']);
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
        expect(result.items.map(item => [item.data.name, item.level])).toEqual([
            ['A', 1],
            ['B', 2],
            ['B', 1],
            ['A', 2]
        ]);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node node_modules/vitest/vitest.mjs run tests/utils/treeFlattener.test.ts`
Expected: FAIL, `flattenPropertyHierarchy` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/utils/treeFlattener.ts`. Add these imports to the existing import block:

```ts
import type { PropertyHierarchyIndex } from './propertyHierarchy';
import type { PropertyValueTreeItem } from '../types/virtualization';
```

Then append:

```ts
/**
 * Joins the value node ids of a placement's chain. A node id can contain both `:` and `/`, so the
 * separator is a NUL, which cannot occur in one. Same reason listItems.ts uses it for bucket keys.
 */
const PROPERTY_PLACEMENT_SEPARATOR = String.fromCharCode(0);

/**
 * Identity of one placement of a value node in a hierarchical property tree. Tags key identity by
 * node.path; a DAG node has no single path, so the chain is accumulated while walking. A root's
 * chain is just its own node id, which is why turning Hierarchical on preserves persisted expansion
 * for root values.
 */
export function buildPropertyPlacementKey(chain: readonly string[]): string {
    return chain.join(PROPERTY_PLACEMENT_SEPARATOR);
}

export interface FlattenPropertyHierarchyResult {
    items: PropertyValueTreeItem[];
    /** First placement key emitted for each node id. Auto-reveal targets this one. */
    firstPlacementByNodeId: Map<string, string>;
}

interface FlattenPropertyHierarchyParams {
    keyNode: PropertyTreeNode;
    index: PropertyHierarchyIndex;
    /** Placement keys, not node ids. */
    expandedPlacements: ReadonlySet<string>;
    /** Level of the emitted root values. */
    level: number;
    /** Levels of nesting below the roots. A backstop against pathological data, not a style choice. */
    maxDepth: number;
    comparator: PropertyNodeComparator;
    getChildComparator?: (parentNodeId: string) => PropertyNodeComparator | undefined;
}

/**
 * Flattens a hierarchical property key into navigation items, one per placement. Mirrors
 * flattenTagTree, differing only in taking children from the hierarchy index rather than from
 * node.children, and in accumulating the placement key rather than reading a path off the node.
 */
export function flattenPropertyHierarchy({
    keyNode,
    index,
    expandedPlacements,
    level,
    maxDepth,
    comparator,
    getChildComparator
}: FlattenPropertyHierarchyParams): FlattenPropertyHierarchyResult {
    const items: PropertyValueTreeItem[] = [];
    const firstPlacementByNodeId = new Map<string, string>();

    const nodeById = new Map<string, PropertyTreeNode>();
    keyNode.children.forEach(node => {
        if (node.kind === 'value') {
            nodeById.set(node.id, node);
        }
    });

    const resolveNodes = (ids: readonly string[]): PropertyTreeNode[] =>
        ids.map(id => nodeById.get(id)).filter((node): node is PropertyTreeNode => node !== undefined);

    /**
     * Emits one placement and, when it is expanded, its children. chain carries the ancestor node
     * ids, which both forms the placement key and guards against cycles: the index may contain a
     * cycle edge, so a node already in this chain is not descended into again.
     */
    const addNode = (node: PropertyTreeNode, currentLevel: number, chain: readonly string[]): void => {
        const nextChain = [...chain, node.id];
        const placementKey = buildPropertyPlacementKey(nextChain);

        items.push({
            type: NavigationPaneItemType.PROPERTY_VALUE,
            data: node,
            level: currentLevel,
            key: placementKey
        });

        if (!firstPlacementByNodeId.has(node.id)) {
            firstPlacementByNodeId.set(node.id, placementKey);
        }

        if (currentLevel - level >= maxDepth || !expandedPlacements.has(placementKey)) {
            return;
        }

        const childIds = index.childIds.get(node.id) ?? [];
        const children = resolveNodes(childIds).filter(child => !nextChain.includes(child.id));
        if (children.length === 0) {
            return;
        }

        const childComparator = getChildComparator?.(node.id) ?? comparator;
        children.sort(childComparator).forEach(child => addNode(child, currentLevel + 1, nextChain));
    };

    const roots = resolveNodes(index.rootIds.get(keyNode.id) ?? []);
    roots.sort(comparator).forEach(root => addNode(root, level, []));

    return { items, firstPlacementByNodeId };
}
```

If `PropertyNodeComparator` is not already imported in `treeFlattener.ts`, add it from wherever `comparePropertyOrderWithFallback` takes it; otherwise inline the type as `(a: PropertyTreeNode, b: PropertyTreeNode) => number`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node node_modules/vitest/vitest.mjs run tests/utils/treeFlattener.test.ts`
Expected: PASS, including the 7 new tests.

- [ ] **Step 5: Run the full suite, typecheck, format**

```bash
node node_modules/vitest/vitest.mjs run
npx tsc -noEmit -skipLibCheck
node node_modules/prettier/bin/prettier.cjs --write src/utils/treeFlattener.ts tests/utils/treeFlattener.test.ts
node node_modules/eslint/bin/eslint.js src/utils/treeFlattener.ts tests/utils/treeFlattener.test.ts
```

Expected: all tests pass, no other output.

- [ ] **Step 6: Commit**

```bash
git add src/utils/treeFlattener.ts tests/utils/treeFlattener.test.ts
git commit -m "feat: flatten a hierarchical property key into placement scoped items"
```

---

## Task 3: The setting and the context menu toggle

**Files:**
- Modify: `src/settings/types.ts`, `src/settings/defaultSettings.ts`
- Modify: `src/settings/tabs/PropertiesTab.ts`
- Modify: `src/utils/contextMenu/propertyMenuBuilder.ts`
- Modify: all 21 files in `src/i18n/locales/`

**Interfaces:**
- Produces: `settings.propertyHierarchicalKeys: Record<string, boolean>`, `settings.propertyHierarchyMaxDepth: number`, and a checkable Hierarchical menu item.

- [ ] **Step 1: Add the settings fields**

In `src/settings/types.ts`, in the `NotebookNavigatorSettings` interface beside `propertySortOrder` (around line 769):

```ts
    /** Normalized property keys whose values render as a nested hierarchy. */
    propertyHierarchicalKeys: Record<string, boolean>;
    /** Levels of nesting a hierarchical property renders below its roots. A backstop. */
    propertyHierarchyMaxDepth: number;
```

Do **not** add either to `SYNC_MODE_SETTING_IDS`. That list is only for settings the user can switch between synced and local storage, and neither of these needs that.

In `src/settings/defaultSettings.ts`, beside `propertySortOrder` (around line 297):

```ts
    propertyHierarchicalKeys: {},
    propertyHierarchyMaxDepth: 10,
```

- [ ] **Step 2: Add the English strings**

In `src/i18n/locales/en.ts`, add to the `contextMenu.property` object (at line 383, beside `createPropertyNote`):

```ts
            hierarchical: 'Hierarchical',
```

And add a new settings item beside the other property settings:

```ts
            propertyHierarchyMaxDepth: {
                name: 'Maximum hierarchy depth',
                desc: 'How many levels a hierarchical property nests below its top-level values. A safety limit; most vaults never reach it.',
                resetTooltip: 'Reset maximum hierarchy depth to default'
            },
```

- [ ] **Step 3: Add the same two strings to the other 20 locales**

Every locale file must define both keys or the build fails, because `getResolvedStrings` returns a locale object wholesale with no merge. Translate `hierarchical`, and the three fields of `propertyHierarchyMaxDepth`, in each of: `ar, de, es, fa, fr, id, it, ja, ko, nl, pl, pt, pt_br, ru, th, tr, uk, vi, zh_cn, zh_tw`.

- [ ] **Step 4: Verify the locales compile**

Run: `npx tsc -noEmit -skipLibCheck`
Expected: no output. Any missing locale key surfaces here as a type error naming the file.

- [ ] **Step 5: Add the depth slider to the Properties tab**

In `src/settings/tabs/PropertiesTab.ts`, import the slider helper and `DEFAULT_SETTINGS` if not already imported:

```ts
import { renderSliderSetting } from './SliderSetting';
import { DEFAULT_SETTINGS } from '../defaultSettings';
```

Add a `createRenderDefinition` entry to the property group:

```ts
            createRenderDefinition({
                name: strings.settings.items.propertyHierarchyMaxDepth.name,
                desc: strings.settings.items.propertyHierarchyMaxDepth.desc,
                render: setting =>
                    renderSliderSetting(setting, {
                        name: strings.settings.items.propertyHierarchyMaxDepth.name,
                        desc: strings.settings.items.propertyHierarchyMaxDepth.desc,
                        value: plugin.settings.propertyHierarchyMaxDepth,
                        defaultValue: DEFAULT_SETTINGS.propertyHierarchyMaxDepth,
                        min: 1,
                        max: 20,
                        step: 1,
                        resetTooltip: strings.settings.items.propertyHierarchyMaxDepth.resetTooltip,
                        onChange: async value => {
                            plugin.settings.propertyHierarchyMaxDepth = value;
                            await plugin.saveSettingsAndUpdate();
                        }
                    })
            }),
```

- [ ] **Step 6: Add the context menu toggle**

In `src/utils/contextMenu/propertyMenuBuilder.ts`, in the key-node section near the existing `canManagePropertyKey` block (around line 430), where `propertyKey` is already in scope from line 145:

```ts
    if (propertyKey !== null) {
        const isHierarchical = plugin.settings.propertyHierarchicalKeys[propertyKey] === true;
        menu.addItem(item => {
            item.setTitle(strings.contextMenu.property.hierarchical)
                .setIcon('lucide-list-tree')
                .setChecked(isHierarchical)
                .onClick(() => {
                    runAsyncAction(async () => {
                        const next = { ...plugin.settings.propertyHierarchicalKeys };
                        if (isHierarchical) {
                            delete next[propertyKey];
                        } else {
                            next[propertyKey] = true;
                        }
                        plugin.settings.propertyHierarchicalKeys = next;
                        await plugin.saveSettingsAndUpdate();
                    });
                });
        });
    }
```

Deleting rather than writing `false` keeps the record free of dead entries, so `Object.keys` is the hierarchical key set.

- [ ] **Step 7: Verify the icon exists**

`lucide-list-tree` must be in Obsidian's registry or the item renders with no icon and no error. Confirm before relying on it:

```bash
LC_ALL=C grep -c -a -o '"list-tree":\[\[' /Applications/Obsidian.app/Contents/Resources/obsidian.asar
```

Expected: a non-zero count. If it is `0`, pick another and re-check the same way; `git-fork` and `network` are both present in this build.

- [ ] **Step 8: Typecheck, format, lint, test**

```bash
npx tsc -noEmit -skipLibCheck
node node_modules/prettier/bin/prettier.cjs --write "src/**/*.ts"
node node_modules/eslint/bin/eslint.js src/settings src/utils/contextMenu src/i18n
node node_modules/vitest/vitest.mjs run
```

Expected: no output from the first three, all tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/settings src/utils/contextMenu/propertyMenuBuilder.ts src/i18n
git commit -m "feat: add the hierarchical property setting and its menu toggle"
```

---

## Task 4: Render the hierarchy in the navigation pane

**Files:**
- Modify: `src/hooks/navigationPane/data/useNavigationPaneTreeSections.ts:889-907`
- Modify: `src/components/PropertyTreeItem.tsx:122`

**Interfaces:**
- Consumes: `buildPropertyHierarchyIndex`, `createPropertyNoteCountInfo`, `EMPTY_PROPERTY_HIERARCHY_INDEX` (Task 1); `flattenPropertyHierarchy` (Task 2); `resolvePropertyNote` from `src/utils/propertyNoteLookup.ts`.
- Produces: nested `PROPERTY_VALUE` items whose `key` is a placement key, and the index made available to `PropertyTreeItem` for chevron decisions.

- [ ] **Step 1: Build the index in its own memo**

In `useNavigationPaneTreeSections.ts`, above the memo that emits property items. It must be its own memo so it does not recompute when unrelated settings change:

```ts
    const hierarchicalPropertyKeys = useMemo(
        () => new Set(Object.keys(settings.propertyHierarchicalKeys ?? {})),
        [settings.propertyHierarchicalKeys]
    );

    const propertyHierarchyIndex = useMemo(() => {
        if (hierarchicalPropertyKeys.size === 0) {
            return EMPTY_PROPERTY_HIERARCHY_INDEX;
        }
        return buildPropertyHierarchyIndex({
            tree: propertySectionBase.propertyTree,
            hierarchicalKeys: hierarchicalPropertyKeys,
            resolveValueNotePath: node => resolvePropertyNote(node, app)?.path ?? null
        });
    }, [app, hierarchicalPropertyKeys, propertySectionBase.propertyTree]);
```

Use whatever field on `propertySectionBase` holds the tree these items are built from; it is the same object `keyNodes` comes from. The depth setting is deliberately **not** a dependency: the cap is applied by the flattener, so the index stays depth independent and counts do not shift when the cap changes.

- [ ] **Step 2: Branch the emitter**

Replace the body of the `keyNodes.forEach` block at lines 889 to 907 with:

```ts
        keyNodes.forEach(keyNode => {
            items.push({
                type: NavigationPaneItemType.PROPERTY_KEY,
                data: keyNode,
                level: rootLevel,
                key: keyNode.id
            });

            if (!expansionState.expandedProperties.has(keyNode.id) || keyNode.children.size === 0) {
                return;
            }

            // A hierarchical key nests its values; every other key keeps the original flat emit.
            if (hierarchicalPropertyKeys.has(keyNode.key)) {
                const flattened = flattenPropertyHierarchy({
                    keyNode,
                    index: propertyHierarchyIndex,
                    expandedPlacements: expansionState.expandedProperties,
                    level: childLevel,
                    maxDepth: settings.propertyHierarchyMaxDepth,
                    comparator: createChildComparator(keyNode)
                });
                items.push(...flattened.items);
                flattened.firstPlacementByNodeId.forEach((placementKey, nodeId) => {
                    firstPlacementByNodeId.set(nodeId, placementKey);
                });
                return;
            }

            sortChildren(keyNode, keyNode.children.values()).forEach(child => {
                items.push({
                    type: NavigationPaneItemType.PROPERTY_VALUE,
                    data: child,
                    level: childLevel,
                    key: child.id
                });
            });
        });
```

Declare `const firstPlacementByNodeId = new Map<string, string>();` beside `const items` at the top of the same memo, and return it from the memo alongside `propertyItems` so Task 5 can consume it.

- [ ] **Step 3: Extract the comparator so both branches share it**

The existing `sortChildren` closure builds a comparator inline. Extract the comparator construction so the flattener can use it, and correct its frequency source for hierarchical keys:

```ts
        const createChildComparator = (keyNode: PropertyTreeNode) => {
            const propertyTreeSortOverrides = settings.propertyTreeSortOverrides;
            const hasChildSortOverride = Boolean(
                propertyTreeSortOverrides && Object.prototype.hasOwnProperty.call(propertyTreeSortOverrides, keyNode.id)
            );
            const childSortOverride = hasChildSortOverride ? propertyTreeSortOverrides?.[keyNode.id] : undefined;
            const isHierarchical = hierarchicalPropertyKeys.has(keyNode.key);
            return createPropertyComparator({
                order: childSortOverride ?? settings.propertySortOrder,
                compareAlphabetically: comparePropertyValueNodesAlphabetically,
                // Frequency sort must agree with the badge beside it. For a hierarchical key with
                // descendants shown, the badge is the subtree count, so sorting uses it too.
                getFrequency: node => {
                    if (isHierarchical && includeDescendantNotes) {
                        return propertyHierarchyIndex.subtreeCount.get(node.id) ?? node.notesWithValue.size;
                    }
                    return includeDescendantNotes && node.valuePath
                        ? getTotalPropertyNoteCount(keyNode, node.valuePath)
                        : node.notesWithValue.size;
                }
            });
        };
```

Rewrite the existing `sortChildren` to call `createChildComparator(keyNode)` so there is one comparator definition.

- [ ] **Step 4: Make the chevron consult the index**

`PropertyTreeItem.tsx:122` currently reads `propertyNode.children.size > 0`, which is always false for a value node. Pass `propertyHierarchyIndex` down to the item (following however `settings` reaches it) and change to:

```ts
        const hasChildren = useMemo(() => {
            if (propertyNode.children.size > 0) {
                return true;
            }
            return (propertyHierarchyIndex.childIds.get(propertyNode.id)?.length ?? 0) > 0;
        }, [propertyHierarchyIndex, propertyNode.children.size, propertyNode.id]);
```

- [ ] **Step 5: Use the shared count helper for the badge**

Wherever the property value badge count is produced, replace the own-count call with:

```ts
createPropertyNoteCountInfo(node, propertyHierarchyIndex, includeDescendantNotes)
```

This yields `{ current, descendants: 0, total: current }` for a non-hierarchical key, which is what it produces today.

- [ ] **Step 6: Verify**

```bash
npx tsc -noEmit -skipLibCheck
node node_modules/vitest/vitest.mjs run
node node_modules/prettier/bin/prettier.cjs --check "src/**/*.ts" "src/**/*.tsx"
node node_modules/eslint/bin/eslint.js src/hooks/navigationPane src/components/PropertyTreeItem.tsx
```

Expected: clean, all tests pass. The full suite passing here is the regression gate for the untouched flat path.

- [ ] **Step 7: Verify in the vault**

```bash
node scripts/build-styles.mjs && node esbuild.config.mjs production
cp main.js styles.css manifest.json ~/2027/.obsidian/plugins/notebook-navigator/
obsidian plugin:reload id=notebook-navigator
obsidian dev:errors
```

Expected: no errors. Then mark `projects` Hierarchical from its context menu and confirm the tree matches this, which is the measured shape of that vault:

```
projects
  Fiddle
    Building software
    Development
    Obsidian
    Tooling
  Personal
  Systems
  Tools
  Work
    Clients
      Datawerkplaats Mooi Maasvallei
    Datawerkplaats.net
```

With descendant notes on, `Fiddle` should show a total of 16 against its own 5.

- [ ] **Step 8: Commit**

```bash
git add src/hooks/navigationPane src/components/PropertyTreeItem.tsx
git commit -m "feat: render hierarchical property keys as a nested tree"
```

---

## Task 5: Expansion and auto-reveal by placement

**Files:**
- Modify: `src/hooks/navigationPane/useNavigationPaneTreeInteractions.ts` (around lines 336, 338, 640, 722)
- Modify: `src/context/ExpansionContext.tsx` if `EXPAND_PROPERTIES` needs a comment change

**Interfaces:**
- Consumes: `firstPlacementByNodeId` from Task 4's memo, `buildPropertyPlacementKey` from Task 2.
- Produces: expansion and reveal that operate on placement keys.

- [ ] **Step 1: Toggle expansion by placement key**

The chevron handler currently toggles `propertyNode.id`. It must toggle the clicked item's `key`, which is the placement key. Where the handler receives the node, thread the item's key through instead so a value expanded under one parent does not expand under another. The `EXPAND_PROPERTIES` action payload (`propertyNodeIds: string[]`, `ExpansionContext.tsx:48`) now carries placement keys; update its comment to say so, since the field name no longer describes the contents for hierarchical keys.

- [ ] **Step 2: Reveal the first placement**

Auto-reveal resolves a value node id. Map it through `firstPlacementByNodeId`, then expand every ancestor prefix of that chain:

```ts
    const expandToPlacement = (placementKey: string): string[] => {
        const chain = placementKey.split(String.fromCharCode(0));
        // Every ancestor prefix must be expanded for the target row to exist.
        return chain.slice(0, -1).map((_, index) => buildPropertyPlacementKey(chain.slice(0, index + 1)));
    };
```

Dispatch `EXPAND_PROPERTIES` with those keys. When the node id has no entry in `firstPlacementByNodeId`, fall back to the node id itself, which is correct for a non-hierarchical key.

- [ ] **Step 3: Verify in the vault**

Rebuild and reload as in Task 4 step 7, then with `projects` hierarchical:

- open `Datawerkplaats Mooi Maasvallei` from outside the navigator and confirm the tree expands `Work`, then `Clients`, and selects the value
- expand `Clients` under `Areas` for `categories` and confirm the `Categories` placement of `Clients` stays collapsed
- collapse and reopen the pane and confirm expansion persisted
- turn the property's Hierarchical toggle off and confirm the flat list returns with its previous expansion intact

- [ ] **Step 4: Run everything**

```bash
npx tsc -noEmit -skipLibCheck
node node_modules/vitest/vitest.mjs run
node node_modules/prettier/bin/prettier.cjs --check "src/**/*.ts" "src/**/*.tsx"
node node_modules/eslint/bin/eslint.js src/hooks src/components src/utils src/settings
```

Expected: clean, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/navigationPane src/context/ExpansionContext.tsx
git commit -m "fix: expand and reveal hierarchical property values by placement"
```

---

## Self-review

**Spec coverage.** Every section of the design maps to a task: the additive index and counts to Task 1; the flattener, placement keys, depth cap and first-placement map to Task 2; both settings, the menu toggle and the 21 locales to Task 3; the index memo, emitter branch, chevron, badge and the frequency-comparator correction to Task 4; expansion and auto-reveal to Task 5. The "never mutate the tree" and "flag off is identical" constraints are enforced by construction plus the full-suite gate in Tasks 2, 4 and 5.

**Two places the plan is deliberately less prescriptive**, because the exact surrounding code must be read at implementation time rather than guessed:

- Task 4 step 1 says to use "whatever field on `propertySectionBase` holds the tree". Naming it from memory risked being wrong, and it is unambiguous once the file is open.
- Task 4 steps 4 and 5, and Task 5 step 1, describe threading the index and the item key through existing prop chains without reproducing those chains. The change is mechanical; inventing the intermediate signatures here would more likely mislead than help.

**One refinement over the spec.** The spec said promoted cycle roots are sorted by the level comparator. The index has no comparator, so it sorts them by node id for deterministic output and the flattener applies the user's comparator on top. Same visible result, cleaner boundary.

**One risk the plan adds a guard for that the spec did not call out.** `index.childIds` can contain cycle edges, so the flattener needs a per-chain visited check, not just the index-level sweep. Without it, a promoted cycle root walks forever. Task 2 covers it in code and in the "does not loop forever" test.
