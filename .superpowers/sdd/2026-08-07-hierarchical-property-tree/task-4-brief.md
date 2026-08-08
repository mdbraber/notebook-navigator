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

