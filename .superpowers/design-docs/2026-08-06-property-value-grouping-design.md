# Per-value property grouping, with value appearance on headers — design

**Date:** 2026-08-06
**Status:** Approved, ready for implementation planning
**Related:** [`2026-08-06-property-note-cross-lens-reveal-design.md`](2026-08-06-property-note-cross-lens-reveal-design.md)

## Summary

Two additions to list-pane property grouping, shipping together:

1. **A new grouping option** that splits a list-valued property into one group per value, so a note
   carrying `topics: [[Topics]], [[Projects]]` appears under **both** headers instead of under a single
   combined `[[Topics]], [[Projects]]` header.
2. **An opt-in setting** so a group header whose value maps to a property value node takes that node's
   icon and colour, matching the navigation tree.

## Motivation

In a vault organised the way [stephango.com/vault](https://stephango.com/vault) describes — few folders,
notes classified by link-valued properties — a note legitimately belongs to several values of the same
key. Today grouping treats the whole value list as one bucket: the bucket key is
`groupingValue.parts.join(NUL)` and each file is pushed into exactly one bucket
(`src/hooks/listPaneData/listItems.ts:533-559`).

The result is a group per *combination* rather than per value. A note with three topics forms its own
one-note group, and browsing by topic shows neither of the topics it actually has. The current behavior
is deliberate — the code comment says it matches how Obsidian Bases groups by property — so this is an
additional mode, not a correction.

Separately, headers show the raw frontmatter text, because `extractPropertySortParts`
(`src/utils/sortUtils.ts:154`) returns trimmed strings without touching link markup. So the header reads
`[[Topics]]` where the navigation tree reads `Topics`.

## Decisions

| Question | Decision |
|---|---|
| Replace or add | Add per-value grouping as a second axis; the existing three forms keep their behavior. |
| Option encoding | Three new prefixes (`property-each:`, `-desc`, `-follow`), so direction stays selectable. |
| Duplicate notes | Intended. A note appears once per value it carries. |
| Selection | Stays path-based, so every copy of a note highlights together. |
| Appearance source | The property **value node** in the tree, via its node id — not the linked note. |
| Header label | Display text always (`Topics`), independent of the appearance toggle. |
| Scope | One feature, two settings. |

### Why the value node rather than the linked note

Notes carry their own appearance (`getFileIcon` / `getFileColor`, `src/services/MetadataService.ts:445`
and `:481`) and so do property values (`getPropertyIcon` / `getPropertyColorData`, `:360` and `:348`).
Taking the value node's appearance keeps the list header and the navigation tree row for the same value
visually identical, which is the point of inheriting at all. It also needs no link resolution: the group
already knows its key and value.

The cost, accepted: appearance is per key+value, so the same `[[Topics]]` under a different key can be
styled differently.

### Why selection stays path-based

Giving selection instance identity would turn `selectedFile` into file+group everywhere it is read —
reveal, scroll-to-file, multi-select ranges, the public API. That is a far larger change than the
grouping itself, for a mode where duplicates are the requested behavior. Highlighting every copy is also
honest: it shows the note belongs to several values.

## Architecture

### Setting 1 — the grouping option

The existing three forms (`src/settings/types.ts:447-494`) encode **direction**, not mode: `property:` is
ascending, `property-desc:` descending, `property-follow:` borrows the direction from the sort option. So
per-value grouping is a second, orthogonal axis — a single new prefix would silently lose direction
control for the new mode.

Three new prefixes, mirroring the existing three:

- `property-each:<key>` — per value, ascending
- `property-each-desc:<key>` — per value, descending
- `property-each-follow:<key>` — per value, direction follows the sort option

`parsePropertyGroupingOption` returns `{ propertyKey, order }` today; it gains a third field,
`perValue: boolean`. `createPropertyGroupingOption(propertyKey, order)` gains a `perValue` argument and
picks one of six prefixes. Longest-prefix matching matters when parsing, since `property-each-desc:`
starts with neither `property-desc:` nor `property-each:` cleanly — parse the `-each` forms first.

Nothing further downstream changes: `resolvePropertyGroupingDirection` (`src/utils/listGrouping.ts:52`),
collapse keys, and the per-folder/tag/property appearance overrides all operate on the parsed key and
order, so they keep working once `perValue` is carried alongside.

### Grouping behavior

In the `propertyGroupingKey` branch of `listItems.ts`, iterate `groupingValue.parts` and push the file
into one bucket per part, keyed by that single normalised part rather than the joined list. Group labels
come from `resolvePropertyDisplayText(part)` (`src/utils/propertyUtils.ts:303`) — the same helper the
navigation tree uses, so `[[Topics]]` becomes `Topics`.

Unchanged: notes with no value for the key still collect in the existing "No value" group; the
first-file-wins rule for a bucket's numeric key still applies per bucket; files inside a group keep the
active sort order.

### Three consequences that must be handled

These are the actual work, and each is a concrete edit rather than a judgement call:

1. **Item keys collide.** File items use `key: file.path` (`listItems.ts:323`). A note in three groups
   yields three identical sibling keys. The key becomes group-scoped, e.g. `${bucketKey}:${file.path}`.
2. **Index maps keep the last copy.** `buildFilePathToIndexMap` (`listItems.ts:812-820`) and
   `buildOrderedFiles` (`:830-845`) both `set(path, …)` unconditionally, so with duplicates the *last*
   occurrence wins. Both change to only set when the path is absent, so reveal and scroll-to-file land on
   the **first** appearance.
3. **`orderedFiles` gains duplicates.** This is intended: it is what makes arrow keys walk each copy.
   Selection remains path-based (`src/hooks/useListPaneSelectionCoordinator.ts:520`), so all copies
   highlight together.

### Setting 2 — appearance inheritance

A boolean, default off. When on, a group header resolves its value to a node id via
`buildPropertyValueNodeId(groupingKey, normalisedValuePath)` and, if that node exists, renders with
`getPropertyIcon(nodeId)` and `getPropertyColorData(nodeId)` from `metadataService` — the same data the
navigation tree row uses.

When the toggle is off, or the value maps to no node, the header renders exactly as it does today apart
from the label.

## Error handling and edge cases

| Case | Behavior |
|---|---|
| Property absent from a note | Falls into the existing "No value" group, as today. |
| Scalar (non-list) value | One part, so one group — identical to today's behavior for that note. |
| Empty or whitespace-only entries | Already dropped by `extractPropertySortParts`; no empty group appears. |
| Duplicate values within one note | Deduplicate per note, so a note cannot appear twice under one header. |
| Plain-string values | Grouped and labelled verbatim; `resolvePropertyDisplayText` returns the trimmed input when it is not a link. |
| Value maps to no tree node | Header renders plain even with the appearance toggle on. |
| Appearance toggle on, old grouping modes | No effect — a joined header has no single value to inherit from. |
| Per-group counts | `groupItemCountByKey` counts each group's own members, so it stays correct by construction. Verify during implementation that no displayed total reads the item array. |

## Testing

The fan-out and the appearance mapping are both pure, so they carry the coverage:

- a note with two values appears in both buckets, once each
- a note with duplicate values appears once
- bucket labels are display text for wikilink values and verbatim for plain strings
- notes with no value still group separately
- `buildOrderedFiles` and `buildFilePathToIndexMap` return the **first** index for a duplicated path
- the node id built for a header matches the navigation tree's node id for the same key and value
- the appearance lookup returns nothing when the toggle is off or no node exists

Item keys are structural rather than behavioral; a React duplicate-key warning in the test output is a
finding, so test output must stay pristine.

## Known gaps after implementation

Found during execution and review, verified, and deliberately left. Recorded so they are not
rediscovered from scratch.

### A note appearing 3+ times makes next/previous-note a two-row loop

`src/utils/selectionUtils.ts` — `getAdjacentFile` now takes the row cursor, so advancing from the copy
you are on works. But `selectAdjacentFile` (`src/hooks/useListPaneSelectionCoordinator.ts`) reads the
cursor without writing the landed row back. Verified against the real function with
`orderedFiles = [Dune, Dune, PKM, Dune]`: the commands yield `PKM, Dune, PKM, Dune, …` instead of walking
to the third Dune. Before the cursor work they yielded `Dune, Dune, Dune` — fully dead — so this is a
strict improvement, and the two-appearance case is fully correct.

Closing it needs `getAdjacentFile` to return the index it landed on so the caller can store it, which is
more than a cursor thread-through.

### Selection writes that bypass the list pane leave the cursor stale

Reveal now clears the cursor, but `ensureSelectionForCurrentFilter`, the active-file sync and
`selectAdjacentFile` do not. The cursor only wins while its row still holds the selected path, so none of
these can select or highlight the wrong note — the worst outcome is one surprising arrow jump. Related:
list-rebuild scrolls still resolve by path (`useListPaneScroll.ts:1098`, `:1508`), so a rebuild while the
cursor sits on a later copy pulls the view back to the first appearance.

### Two identically-labelled headers can map to one tree node

Per-value buckets are keyed by the raw value while node ids are normalized, so `[[Apple]]` and
`[[Fruits/Apple|Apple]]` form two groups, both labelled `Apple`, both resolving to `key:topics=apple`,
where the navigation tree shows one row. Case variants collide the same way — `Array.from(new Set(parts))`
does not fold `[[Apple]]` and `[[apple]]`. Not a regression (joined mode showed two headers too, just with
different labels), but it undercuts the "match the navigation tree" premise. Fix would be to key buckets on
`normalizePropertyTreeValuePath(part)` and keep the first-seen raw part for the label and node id.

### Smaller residuals

- The sticky header's `::before` gutter fill keeps default theming under a custom background. Unfixable
  without a CSS custom property, which the design excluded. Narrow trigger, cosmetic.
- `activeGroupKeyPrefix` changes row keys for **every** grouped list, not just per-value ones, so pinning
  the first note in an ungrouped list introduces a section header and remounts the list.
- The header-model memo recomputes on any settings save, because `SettingsContext` re-clones the property
  appearance records on every version bump. Bounded and precedented by `useFileItemPills`.
- `EXTEND_SELECTION` and `anchorIndex` in selection state are dead — written, never dispatched or read. A
  second unused index notion a future reader may mistake for the row cursor.
- One British spelling remains in a code comment at `src/types/virtualization.ts:49`.

### Process note for whoever picks this up

Dropping the `perValue` flag was a **six-site pattern**; the first pass through the plan fixed four. The
lasting fix was making the third parameter of `createPropertyGroupingOption` required, so the compiler
enumerates every writer. If you add a seventh axis, do the same rather than relying on review diligence —
three of the six sites lived in code no task touched.

## Out of scope

- **Instance-level selection.** Rejected above; every copy highlights.
- **Changing the existing three grouping modes**, including their labels.
- **Inheriting appearance from the linked note.** Considered and rejected in favour of the value node.
- **Grouping by more than one property at once.**
