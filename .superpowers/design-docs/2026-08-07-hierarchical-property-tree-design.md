# Hierarchical property trees, design

**Date:** 2026-08-07
**Status:** Approved, ready for implementation planning
**Related:** [`2026-08-04-property-notes-design.md`](2026-08-04-property-notes-design.md), [`2026-08-06-property-value-grouping-design.md`](2026-08-06-property-value-grouping-design.md)

## Summary

A property key can be marked **Hierarchical** from its context menu. Its value nodes then render
as a nested tree in the navigation pane instead of a flat list, with the parent of a value derived
from the note that value points at: if `[[Building software]]` resolves to a note whose own
`projects` is `[[Fiddle]]`, then `Building software` nests under `Fiddle`. A value whose property is
empty, or that does not resolve to a note, sits at the key's root.

The relation is a DAG, not a tree: a value can carry several values for the same key and so have
several parents, and it is then rendered once under each. Cycles occur in real data and are handled
rather than assumed away.

## Motivation

In a vault organised the way [stephango.com/vault](https://stephango.com/vault) describes, link-valued
properties already form a hierarchy that the navigation pane flattens away. Measured in the author's
vault:

Measured with the rules this design specifies (self-edges dropped, unreachable values promoted to
roots). Depth counts edges, so depth 2 means three visible levels.

| property | value nodes | roots | multi-parent values | max depth | placements | notes with key |
|---|---|---|---|---|---|---|
| `topics` | 24 | 12 | 2 | 3 | 27 | 40 |
| `categories` | 19 | 2 | 2 | 2 | 21 | 137 |
| `projects` | 12 | 5 | 0 | 2 | 12 | 34 |
| `roles` | 3 | 3 | 0 | 0 | 3 | 11 |
| `status` | 1 | 1 | 0 | 0 | 1 | 29 |

Three facts from that data shape the design:

- **Fan-out is negligible.** The worst case is `topics` at 24 nodes to 27 placements, about 1.1x. The
  combinatorial blow-up a DAG permits does not occur here, so no approximation is needed to stay fast.
- **Multi-parent is rare but real.** Four values across the vault have two parents, two under
  `categories` (`Clients` under `Areas` and `Categories`, `Software` under `Categories` and `Topics`)
  and two under `topics`. The machinery serves few rows today but is the part that would fail silently
  if omitted.
- **Trees are shallow.** Maximum depth is 3 edges, so the configurable depth cap is a backstop rather
  than a working constraint.
- **Cycles exist.** `Categories`, `Notes` and `Dutch Healthcare` are each filed under themselves.
  These are deliberate hub notes, not corrupt data.

## Decisions

| Question | Decision |
|---|---|
| What becomes a tree row | Property values, nested. Notes stay in the list pane. |
| Tree mutation | None. The hierarchy is an additive index; the flat tree is untouched. |
| Multiple parents | Rendered once under each parent. |
| Placement identity | Accumulated chain path, matching how tags key by `node.path`. |
| Expansion | Independent per placement. |
| Selection, icons, colours | Keyed by node id, unchanged. A value looks the same everywhere. |
| Counts and selection contents | Reuse the existing descendant-notes toggle, mirroring tags. |
| Self-referencing values | Self-edge dropped, value becomes a root, no marker. |
| Values unreachable from a root | Emitted as roots, so nothing disappears. |
| Auto-reveal | Targets the first placement. |
| List pane grouping | Unchanged. Stays flat. |
| Scope | One feature, not staged. |

## Architecture

### Why the tree is not reparented

The obvious implementation moves value nodes out of `keyNode.children` into their parent value node's
`children`, which already exists on `PropertyTreeNode` and is always empty today
(`src/utils/propertyTree.ts:913`). This is rejected.

At least twenty sites across twelve files assume a value node is a **direct** child of its key.
Reparenting breaks them silently:

- `src/utils/propertyTree.ts:699` `resolvePropertyTreeNode` does `keyNode.children.get(nodeId)`. This
  is the lookup `usePropertyNoteLink` and the list-pane group header links use, so property notes would
  stop resolving for every nested value.
- `src/utils/propertyNoteLookup.ts:121` iterates `keyNode.children.values()`, so the file-to-value
  reverse lookup would miss nested values.
- `src/utils/propertyTree.ts:112` and `:128` (`getTotalPropertyNoteCount`,
  `collectPropertyValueFilePaths`), `:608`.
- `src/hooks/useListPaneTitle.ts:446`, `src/modals/PropertyNodeSuggestModal.ts:47`,
  `src/utils/propertyMenuActions.ts:128` would each see only roots.

The documented invariant ("value nodes are stored as direct children of keys") is load-bearing.

### The additive index

`src/utils/propertyHierarchy.ts`, a new pure module:

```ts
export interface PropertyHierarchyIndex {
    /** Key node id -> value node ids rendered at the key's root. */
    rootIds: ReadonlyMap<string, readonly string[]>;
    /** Value node id -> child value node ids. */
    childIds: ReadonlyMap<string, readonly string[]>;
    /** Value node id -> deduped note count for the node and its whole subtree. */
    subtreeCount: ReadonlyMap<string, number>;
}

export function buildPropertyHierarchyIndex(params: {
    tree: ReadonlyMap<string, PropertyTreeNode>;
    hierarchicalKeys: ReadonlySet<string>;
    resolveValueNotePath: (node: PropertyTreeNode) => string | null;
}): PropertyHierarchyIndex;
```

Pure given `resolveValueNotePath`, so it tests against a plain object graph with no vault and no `App`.
When `hierarchicalKeys` is empty every map is empty and every consumer falls back to today's behaviour,
which makes the feature bit-for-bit reversible.

### Where it runs

Two places build property trees: `src/context/storage/usePropertyTreeSync.ts:159` from the database, and
`src/hooks/navigationPane/data/useNavigationPaneTreeSections.ts:710` a scoped tree from file paths. The
index is built in `useNavigationPaneTreeSections`, where both converge and where `app` is already a memo
dependency. The three builders in `propertyTree.ts` keep their current dependency-free shape.

Memoise the index on tree identity and the hierarchical key set alone, **not** inside the existing large
memo, which recomputes on every settings save.

### The resolver is the property-note resolver

```ts
resolveValueNotePath: node => resolvePropertyNote(node, app)?.path ?? null
```

`resolvePropertyNote` (`src/utils/propertyNoteLookup.ts:76`) reads `node.assignmentValue`, requires a
strict internal wikilink, and resolves from `getPropertyNoteSourcePath` (`:60`), the lexicographically
first note carrying the value, which is stable across rebuilds. Reusing it makes disagreement between
the hierarchy and property notes structurally impossible rather than something to keep in sync. A value
that is not a wikilink, or whose link resolves to nothing, yields `null` and becomes a root. The
author's `projects` value `Tools` is exactly this case.

## The hierarchy pass

Per hierarchical key:

1. **Invert.** Build `valuesByNotePath: Map<notePath, valueNodeId[]>` from each value node's
   `notesWithValue`. One pass over the key's value nodes.
2. **Parents.** For each value node V, `notePath = resolveValueNotePath(V)`. If `null`, V is a root.
   Otherwise `parentIds = valuesByNotePath.get(notePath) ?? []` with V's own id removed. Removing V is
   what drops the self-edge and makes `Categories`, `Notes` and `Dutch Healthcare` roots. Empty parents
   means root.
3. **Invert again** into `childIds`.
4. **Reachability sweep.** Walk from the roots marking reached ids. Append any unreached value node to
   the roots, sorted by the level comparator for determinism. Steps 2 and 4 are both required: step 2
   only handles self-loops, and step 4 only handles longer cycles. Without step 4 an `A -> B -> A` pair
   is placed only under each other and vanishes from the tree.
5. **Subtree counts.** Post-order with a `visiting` guard. Each node's set is its own `notesWithValue`
   unioned with its children's sets; store the size and discard the set. This mirrors
   `getTotalNoteCount` (`src/utils/tagTree.ts:394`), which dedups with a `Set<string>`, guards cycles
   with a `visited` set, and memoises per node.

Cost: O(assignments) for the inversions, O(values) resolver calls, O(values + edges) for the sweep, and
at most nodes times notes for the counts, which is 19 x 137 for `categories`.

## Rendering

### The flattener

`flattenPropertyHierarchy` is added to `src/utils/treeFlattener.ts` beside `flattenTagTree`, taking the
same signature shape `(roots, expanded, level, options)` and using the same inner
`addNode(node, currentLevel)` recursion and per-parent child comparator override. That module already
exports `comparePropertyOrderWithFallback`, so properties are not new to it. It differs from
`flattenTagTree` in exactly two ways: children come from `index.childIds` rather than `node.children`,
and the emitted key is an accumulated chain rather than `node.path`.

It returns the flattened items plus `firstPlacementByNodeId: Map<string, string>`, recording the first
chain key each node id was emitted under.

The emitter at `useNavigationPaneTreeSections.ts:889` branches: hierarchical keys delegate to the new
flattener, non-hierarchical keys keep today's flat loop unchanged. The new path is opt-in per key.

### Placement identity

A placement key is the chain of value node ids from the root, joined with `String.fromCharCode(0)`,
matching the separator precedent in `src/hooks/listPaneData/listItems.ts:127`. A NUL cannot occur in a
node id, whereas both `:` and `/` can.

This is the same idea tags already use: `flattenTagTree` emits `key: node.path`, keying identity and
expansion by path rather than by node. A DAG node has no single path, so the path is accumulated during
traversal instead of read off the node.

A root value's chain is just its own node id, so flat and hierarchical keys agree at the root. Turning
Hierarchical on therefore preserves existing persisted expansion for root values, and only nested values
receive new-format keys. No migration is needed.

### Expansion

`expandedProperties` (`src/context/ExpansionContext.tsx`, loaded at `:263`, saved at `:290`) holds
placement keys. Keys for values that no longer exist accumulate harmlessly, which the codebase already
tolerates for collapse keys from other selections.

`PropertyTreeItem.tsx:122` computes `hasChildren` from `propertyNode.children.size > 0`, always false for
values. For hierarchical keys it consults `index.childIds` instead.

### Counts

Add `createPropertyNoteCountInfo(nodeId, index, includeDescendantNotes): NoteCountInfo`, mirroring
`createTagNoteCountInfo` (`src/utils/tagTree.ts:430`): `{ current, descendants: 0, total: current }` when
the toggle is off, and `{ current, descendants: total - current, total }` when on, with `total` from
`index.subtreeCount`. `getPropertyShortcutCount` already returns `NoteCountInfo` for a property node id,
so the badge plumbing exists and only its `descendants` term stops being zero.

Selecting a parent value lists its subtree's notes when the toggle is on, and its own notes when off,
which is how folders and tags already behave.

**One correction this forces.** The level comparator's frequency function currently calls
`getTotalPropertyNoteCount`, which returns own count. For a hierarchical key with descendant notes on it
must use `subtreeCount`, or frequency sort will contradict the badge next to it.

### Auto-reveal

Reveal resolves a node id to `firstPlacementByNodeId`, then expands that chain's ancestors. This is the
first-occurrence rule already used by `buildFilePathToIndexMap`.

## Settings

**`propertyHierarchicalKeys: Record<string, boolean>`**, keyed by normalized property key, written
through `MetadataService` the way `propertyTreeSortOverrides` is, and pruned by the same reconciliation
that drops unavailable property keys. A checkable **Hierarchical** item on the property key row's context
menu (`src/utils/contextMenu/propertyMenuBuilder.ts`) toggles it.

**`propertyHierarchyMaxDepth: number`**, a global backstop in Settings under Properties
(`src/settings/tabs/PropertiesTab.ts`), default **10**. Levels deeper than this are not emitted. The
deepest chain measured in a real vault is 3 edges, so the default leaves ample headroom while bounding
pathological or accidental data; it is a safety valve, not a styling choice, which is why it is global
rather than per key. Minimum 1.

The cap is applied by the **flattener**, not by the index. A node's depth depends on which chain reaches
it, so depth is a rendering property, and the index stays structural and depth-independent. This also
keeps `subtreeCount` honest: a parent's count includes notes under values hidden by the cap, so changing
a display cap never changes a count.

Both need new i18n strings in all 21 locales.

The **placement cap** stays internal and is deliberately not exposed: unlike depth, it has no meaning a
user could reason about, and the measured fan-out is 1.1x. It exists only so a pathological DAG cannot
hang the pane, and it logs when it truncates.

## Error handling and edge cases

| Case | Behaviour |
|---|---|
| Value is not a wikilink | Root. Cannot have a parent. |
| Wikilink resolves to no note | Root. The author's `Tools` value. |
| Value filed under itself | Self-edge dropped, root, no marker. |
| Longer cycle | Each member placed under the other, and the unreachable members also emitted as roots by step 4. |
| Value with two parents | Two placements, independent expansion, one shared icon and colour. |
| Note carries both a parent and a child value | Counted once in the parent's subtree count, because the count unions path sets. |
| Property key not marked hierarchical | Empty index, existing flat loop, behaviour identical to today. |
| Deeper than `propertyHierarchyMaxDepth` | Levels beyond the cap are not emitted, and the truncation is logged. Never silent. |
| Placement cap exceeded | Truncate and log. Internal cap, no setting. |
| Scoped navigation | Same index built over the scoped tree, so behaviour matches unscoped. |

## Testing

The pass and the flattener are both pure, so they carry the coverage. Fixtures use the author's real
shapes:

- `Categories` filed under itself becomes a root, and its children still nest beneath it
- an `A -> B -> A` island emits both members as roots rather than disappearing
- `Clients` emits two placements, under `Areas` and under `Categories`
- expanding one placement of `Clients` leaves the other collapsed
- `Tools`, resolving to no note, becomes a root
- a note carrying both `Fiddle` and `Building software` is counted once in `Fiddle`'s subtree count
- `subtreeCount` for `Fiddle` is 16 while its own count is 5
- `firstPlacementByNodeId` is stable across rebuilds
- flag off yields an index whose maps are all empty
- a chain deeper than `propertyHierarchyMaxDepth` stops at the cap and logs, and lowering the setting
  re-emits a shallower tree rather than leaving a stale one
- the internal placement cap truncates and logs

## Out of scope

- **Nested group headers in the list pane.** Grouping stays flat; only navigation nests.
- **Rolling descendant notes into flat group headers.**
- **Notes as navigation rows.** Considered and rejected: 137 rows for `categories` against 19, and it
  duplicates the list pane.
- **Marking cyclic values in the UI.** All current instances are deliberate hub notes.
- **Deriving hierarchy from anything but the same property key.** A value's parent always comes from
  the same key on the note it points at.
