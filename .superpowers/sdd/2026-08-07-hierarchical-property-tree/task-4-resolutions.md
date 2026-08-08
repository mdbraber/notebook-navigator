# Task 4 resolutions: the two spots the plan left non-prescriptive

I verified all of this by reading the files. Where it contradicts the brief, this file wins.

## 1. The tree to pass to `buildPropertyHierarchyIndex`

The brief says "use whatever field on `propertySectionBase` holds the tree". **There is no such field.**
`propertySectionBase` (`useNavigationPaneTreeSections.ts:778-782`) returns exactly:

```ts
{ propertiesSectionActive: boolean; keyNodes: PropertyTreeNode[]; collectionCount: NoteCountInfo | undefined }
```

Use **`renderPropertyTree`** instead. It is declared at `useNavigationPaneTreeSections.ts:731`, is a
`Map<string, PropertyTreeNode>` keyed by normalized property key, and is already the tree feeding the
root ordering at `:767` (`propertyTree: renderPropertyTree`). That keying is what
`buildPropertyHierarchyIndex` expects, because it does `tree.forEach((keyNode, normalizedKey) => ...)`
and tests `hierarchicalKeys.has(normalizedKey)`.

So the index memo is:

```ts
const propertyHierarchyIndex = useMemo(() => {
    if (hierarchicalPropertyKeys.size === 0) {
        return EMPTY_PROPERTY_HIERARCHY_INDEX;
    }
    return buildPropertyHierarchyIndex({
        tree: renderPropertyTree,
        hierarchicalKeys: hierarchicalPropertyKeys,
        resolveValueNotePath: node => resolvePropertyNote(node, app)?.path ?? null
    });
}, [app, hierarchicalPropertyKeys, renderPropertyTree]);
```

`propertyHierarchyMaxDepth` is deliberately **not** a dependency here. The cap is applied by the
flattener, so the index stays depth independent and subtree counts do not shift when the cap changes.

## 2. The chevron, and how the index reaches `PropertyTreeItem`

The brief says to "pass `propertyHierarchyIndex` down to the item". **Do not do that.** The established
pattern in this codebase is caller-computes, item-renders: `PropertyTreeItemProps`
(`src/components/PropertyTreeItem.tsx:37-59`) already receives `isExpanded`, `countInfo` and `onToggle`
as props rather than deriving them. Follow that.

Do this instead, three small edits:

1. **`src/types/virtualization.ts`**, on `PropertyValueTreeItem` (line 138), add:
   ```ts
   /** True when the hierarchy index gives this value children. Absent for non-hierarchical keys. */
   hasChildren?: boolean;
   ```
2. **The emitter** in `useNavigationPaneTreeSections.ts` sets it on each item the flattener returned,
   from `propertyHierarchyIndex.childIds`. Set it in the emitter, not inside
   `flattenPropertyHierarchy`, so Task 2's reviewed code stays untouched.
3. **`src/components/navigationPane/NavigationPaneTreeRow.tsx`**, in the `PROPERTY_VALUE` branch at
   line 242, pass it through: `hasChildren={item.hasChildren}`. `item` is already in scope there.
4. **`src/components/PropertyTreeItem.tsx`** takes `hasChildren?: boolean` and computes:
   ```ts
   const hasChildren = useMemo(
       () => hasChildrenProp ?? propertyNode.children.size > 0,
       [hasChildrenProp, propertyNode.children.size]
   );
   ```
   The fallback preserves today's behaviour exactly for non-hierarchical keys and for key nodes.

## 3. Where the count badge is produced

The brief says "wherever the property value badge count is produced". It is
**`src/hooks/navigationPane/data/useNavigationNoteCounts.ts:225`**, in the `propertyCounts` memo. That
memo collects `visiblePropertyNodes` from the rendered items (`:172-178`), then branches on
`node.kind`. The value-node branch follows the key-node branch that begins at `:186`.

Replace the value-node count computation with `createPropertyNoteCountInfo(node, index, includeDescendantNotes)`
from `src/utils/propertyHierarchy.ts`. That helper returns `{ current, descendants: 0, total: current }`
whenever the node has no entry in the index, which is every node for a non-hierarchical key, so the
existing behaviour is preserved without a conditional.

This hook needs the index. Thread it in the same way the hook already receives
`propertyCollectionCount` and `includeDescendantNotes`. Note `propertyCounts` is keyed by node id, which
is correct and must not change: two placements of one value legitimately share one count.

## 4. Do not touch, this is Task 5

`NavigationPaneTreeRow.tsx:256` reads `onToggle={() => tree.handlePropertyToggle(propertyNode.id)}`,
passing the node id. Changing that to the placement key is Task 5's job, along with `isExpanded`.
Leave both alone in Task 4 even though you will be editing the surrounding lines. Task 4's visible
result is a nested tree whose expansion still keys off node ids; Task 5 makes expansion per placement.
