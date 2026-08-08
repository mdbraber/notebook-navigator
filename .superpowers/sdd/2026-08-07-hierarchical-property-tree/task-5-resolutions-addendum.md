# Task 5 resolutions, addendum after review

The review found three Critical defects. Two of them exist because my original
`task-5-resolutions.md` prescribed the wrong approach. **This addendum supersedes that file wherever
they conflict.** Read it after the original.

## Correction 1: placement keys must survive expansion cleanup (Critical 1)

My original file reasoned about persistence only for root placements, whose key equals their node id,
and concluded no migration was needed. That is true for roots and wrong for everything deeper.

`src/components/navigationPane/NavigationPaneContent.tsx:513-520` builds `existingPropertyNodeIds` from
key node ids plus value node ids, and `CLEANUP_DELETED_PROPERTIES` runs it through `filterExpandedSet`
(`src/context/ExpansionContext.tsx:64-84`), which is a **whitelist**. A nested placement key contains a
NUL and is in no whitelist, so it is deleted. Because that effect's dependency array includes
`expansionState.expandedProperties.size`, expanding a level-2 row changes the size, the cleanup runs, and
the row's own expansion is erased before its children can render. Persisted nested keys are purged on the
first pass at startup.

**Do not fix this by exempting NUL-containing keys from the filter.** That leaks stale keys forever and
defeats the cleanup's purpose, which is to drop expansion state for properties that no longer exist.

**Fix it by treating a placement key as valid when every segment of its chain is a known value node id.**
Split the candidate on the separator and require each segment to be present in the existing-ids set. A
single-segment key then behaves exactly as today, so folders, tags and flat properties are untouched, and
a placement whose ancestor was deleted is still correctly purged. Put the predicate where the property
cleanup is built, and use the exported separator rather than a second literal.

## Correction 2: reveal needs a parent walk, not `firstPlacementByNodeId` (Critical 2)

My original file said to map a node id through `firstPlacementByNodeId` and expand the chain's prefixes.
That cannot work. The flattener populates that map only for placements it actually emitted
(`src/utils/treeFlattener.ts:544`), and it recurses into a placement's children only when that placement
is already expanded (`:548`). So a node id appears in the map precisely when its row is already on
screen, which is exactly when no ancestor expansion is required. Revealing a collapsed value falls
through to the node-id fallback and expands nothing.

**Fix it with a deterministic parent walk over the index, independent of expansion state.**

`buildPropertyHierarchyIndex` already computes a `parentsById` map internally and then discards it.
Expose it on `PropertyHierarchyIndex` as a fourth field:

```ts
/** Value node id -> its parent value node ids. Empty for a root. May participate in cycles. */
parentIds: ReadonlyMap<string, readonly string[]>;
```

Then add a function that resolves the chain to reveal, in `propertyHierarchy.ts` beside it:

```ts
/**
 * Chain of value node ids from a root down to the target, or null when the node is unknown.
 * Walks parents deterministically, taking the first parent id, and stops on a node already in the
 * chain so a cycle terminates rather than looping. The user's rule is that auto-reveal targets the
 * first placement, and taking the first parent at each step is what makes that deterministic.
 */
export function resolvePropertyRevealChain(index: PropertyHierarchyIndex, nodeId: string): string[] | null;
```

Keep `EMPTY_PROPERTY_HIERARCHY_INDEX` in sync with the new field, and note that the chain this returns
need not equal the flattener's first emitted placement. That is fine: once the prefixes are expanded the
row exists, and selection and highlighting are keyed by node id regardless of placement.

Reveal then expands every prefix of that chain except the target itself, exactly as before, using
`getPropertyPlacementAncestorKeys`. When `resolvePropertyRevealChain` returns null, fall back to the node
id, which is correct for a non-hierarchical key.

## Correction 3: restore the needs-expansion guard (Critical 3)

`src/utils/propertyNavigation.ts:170-171` omits `keyNodeId` from `idsToExpand` when the key is already
expanded, and then dispatches unconditionally. Because `buildExpandItemsAction`
(`src/utils/navigationExpansion.ts:112`) dispatches `SET_EXPANDED_PROPERTIES` with a **replacement** set
when collapse-other-branches is on, omitting the key collapses the whole property.

Follow the tag precedent at `src/utils/tagNavigation.ts:115-124`: build the **full** list, always
including the key node id when there is one, then dispatch only when something in it is not already
expanded. That fixes the collapse and removes the redundant-dispatch loop in one change.

## Also fix

**Important 1.** `src/utils/navigationExpansion.ts:244` returns `hasChildren: item.data.children.size > 0`,
always false for a value node, so the keyboard fix at `src/hooks/useNavigationPaneKeyboard.ts:237`
changes nothing. Make that site use the item's own flag for `PROPERTY_VALUE`, the way the
`VIRTUAL_FOLDER` branch already does with `item.hasChildren ?? false`. Then correct the comment at
`useNavigationPaneKeyboard.ts:239-244`, which currently asserts the opposite and would mislead the next
reader.

**Important 2.** Thread `item.key` into `handlePropertyClick` and `handlePropertyNameClick` so the click
paths stop toggling by node id. `item` is already in scope in the same case block that threads `item.key`
into `onToggle` (`src/components/navigationPane/NavigationPaneTreeRow.tsx:259-262`). Left as is, a nested
click writes a bare node id into the persisted set, and for a promoted cycle root it toggles a different
row than the one clicked.

**Minor.** The two eslint errors at `tests/hooks/useNavigationPaneTreeSections.test.ts:586` and `:684` are
real `TS2339`: `item.level` does not exist on every `CombinedNavigationItem` member, since
`RootSpacerItem` has none. Narrow on `item.type` first, the way the existing assertion at `:491-493`
already does. Note `tsconfig.json` includes only `src/**`, so `npx tsc -noEmit` cannot see test files;
lint `tests/` explicitly.

## Out of scope, leave alone

- Per-placement `collapseOtherBranchesOnExpand`. Still Task 6.
- Item `hasChildren` ignoring the flattener's depth cap and cycle filter. Recorded as deferred.
- `src/hooks/useTagNavigation.ts:94-118` calling `navigateToProperty` without the placement data. Recorded
  as deferred.

## Required tests

The review noted that every Critical maps to a missing test. Add, at minimum:

- a placement key survives `CLEANUP_DELETED_PROPERTIES` while a placement whose ancestor was deleted does not
- `resolvePropertyRevealChain` returns a root-to-target chain for a three-deep hierarchy with nothing
  expanded, and terminates on a cycle
- revealing a nested value with `collapseOtherBranchesOnExpand: true` leaves its key expanded
- no dispatch occurs when every id to expand is already expanded
- the keyboard path actually expands a hierarchical placement, asserting the outcome rather than that the
  guard was reached
