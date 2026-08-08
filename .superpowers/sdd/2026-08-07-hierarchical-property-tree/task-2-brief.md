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

