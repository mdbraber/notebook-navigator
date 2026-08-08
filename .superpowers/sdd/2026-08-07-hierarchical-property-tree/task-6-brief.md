# Task 6: collapse other branches, per placement

This task did not exist in the original plan. It is a split of Task 5, made because the user chose to
make `collapseOtherBranchesOnExpand` work for hierarchical property placements rather than skip it, and
because that rework touches `toggleNavigationExpansionTarget`, which folders and tags also use. It is the
riskiest diff in the plan, which is why it gets its own review gate.

## Background

A property key marked Hierarchical renders its values as a nested DAG. Each row is a *placement*,
identified by the chain of value node ids from the root joined with `PROPERTY_PLACEMENT_SEPARATOR`
(`String.fromCharCode(0)`, exported from `src/utils/treeFlattener.ts`). A root placement's chain is
`[nodeId]`, so its key equals the node id; deeper keys contain a NUL.

`collapseOtherBranchesOnExpand` works by replacing the expanded set with the target plus its ancestors.
For properties, `buildBranchExpandAction` (`src/utils/navigationExpansion.ts:127-133`) emits
`SET_EXPANDED_PROPERTIES(new Set([...ancestorIds, id]))`, where `ancestorIds` comes from
`getPropertyAncestorNodeIds(item.data.id)` and is just `[keyNodeId]`. For a nested placement that
replacement set drops the intermediate placement keys the row depends on, so the row that was just
expanded stops rendering.

Task 5 suppressed that rather than fixing it, in two places, and the two suppressions diverged and
produced a Critical bug. This task replaces both with the real thing.

## What exists now

- `supportsBranchCollapse?: boolean` on `NavigationExpansionTarget`, set at exactly one site
  (`navigationExpansion.ts:269`) and consumed at exactly one (`:167`, as `!== false`). It makes a nested
  placement take the plain toggle instead of branch replacement.
- A separate `placementKey === nodeId` guard in `handlePropertyToggle`
  (`src/hooks/navigationPane/useNavigationPaneTreeInteractions.ts`), doing the same job differently.
- `getPropertyPlacementAncestorKeys(chain)` in `src/utils/treeFlattener.ts:471`, which returns every
  prefix of a chain except the target itself. Already used by reveal.

## Requirements

### 1. Make branch replacement correct for a placement

The reviewer identified the fix, and it needs no new state. The ancestors of a placement are derivable
from the placement key itself:

```ts
[keyNodeId, ...getPropertyPlacementAncestorKeys(item.key.split(PROPERTY_PLACEMENT_SEPARATOR))]
```

So a nested placement's replacement set becomes the key node id, every ancestor placement key, and the
target placement key. That is exactly the set required for the row to keep rendering.

Implement that in the property branch of the expansion-target machinery, so branch replacement works for
nested placements instead of being suppressed.

### 2. Remove both suppressions, and unify the guard

Once requirement 1 is in place, `supportsBranchCollapse` has no reason to exist. Remove the field, its
single producer and its single consumer, restoring `NavigationExpansionTarget` to a type folders and tags
share without a property-specific escape hatch.

Then remove the `placementKey === nodeId` guard in `handlePropertyToggle` too, along with its
"Task 6" comment, so there is one code path rather than two predicates that can drift. Their drift is
what produced the Critical in Task 5: keyboard expansion of a root placement branch-replaced correctly
while mouse expansion of the same row dispatched nothing.

If after requirement 1 you find a case that still genuinely needs a guard, do not reintroduce a boolean
on the shared type. Say so in your report and explain what the case is.

### 3. Delete the dead `firstPlacementByNodeId`

It has no consumer. It is produced in `treeFlattener.ts`, aggregated in
`useNavigationPaneTreeSections.ts`, exposed on that hook's result type, and read only by its own tests.
Its retained comment argues it is what a scroll or highlight lookup would need, but the reviewer checked:
property rows are indexed for scroll by node id (`src/utils/navigationIndex.ts:79-81`), so that is false.

Remove the field, its production, its aggregation, its exposure and its tests. Reveal already uses
`resolvePropertyRevealChain` instead.

## Global constraints

- **Folders, tags, virtual folders and shortcuts must behave exactly as they do today.** You are editing a
  type and a function they share. Verify every construction site and every consumer of
  `NavigationExpansionTarget`, and say in your report how you established that.
- A property key not marked hierarchical must also behave exactly as today. A flat value's placement key
  equals its node id, so its ancestor list must come out as `[keyNodeId]`, matching
  `getPropertyAncestorNodeIds` today.
- Never mutate the property tree.
- Do not use em dashes or en dashes anywhere.
- `node_modules/.bin` is empty. Use `node node_modules/vitest/vitest.mjs run`,
  `npx tsc -noEmit -skipLibCheck`, `node node_modules/prettier/bin/prettier.cjs --write <files>`,
  `node node_modules/eslint/bin/eslint.js <files>`. `tsconfig.json` includes only `src/**`, so `tsc`
  cannot see test files: lint `tests/` explicitly.
- Repo-wide eslint is red upstream (9 pre-existing errors in 4 untouched files). Files you touch must be
  clean.
- The suite is 2183 passing and must not drop.

## Required tests

- Expanding a nested placement with `collapseOtherBranchesOnExpand` on keeps the row rendering: assert the
  replacement set contains the key node id, every ancestor placement key, and the target.
- Expanding a **root** placement with the setting on still works by mouse. This is the case Task 5's test
  claimed to cover while passing a key node, so assert it with the root **value** node.
- Expanding a sibling branch collapses the previously expanded one.
- A flat, non-hierarchical value's replacement set is unchanged from today.
- A folder and a tag branch expansion are unchanged, to pin the shared-type edit.

## Verify in the vault

`~/2027` has `collapseOtherBranchesOnExpand: false` and `propertyHierarchicalKeys: {"projects": true}`.
Turn the setting on temporarily, confirm that expanding `Work` then `Clients` reveals
`Datawerkplaats Mooi Maasvallei` and that expanding a sibling collapses the `Work` branch, then **restore
the setting to false**. Report exactly what you observed. Do not create or delete notes; the vault has 157
markdown files and must still have 157 when you finish.

## Explicitly out of scope

- **The children-presence contract.** Two Criticals in Task 5 came from callers of
  `toggleNavigationExpansionTarget` passing `children.size > 0` for a node whose children map is empty by
  design. Removing the need for callers to supply children presence at all is the real cure, and it is a
  refactor of a function folders and tags depend on. Deferred deliberately to keep this task's risk
  bounded. Do not attempt it.
- The reveal chain that can return a non-root head when a cycle member is reachable from a real root.
- The uncovered keyboard site, and left-arrow jumping to the key row rather than the parent placement.
