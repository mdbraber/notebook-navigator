# Task 6 report: collapse other branches, per placement

Commit: `9a7e1950` on branch `property-notes`, parent `bbb27a8a`.

Status: DONE_WITH_CONCERNS. The code work is complete and verified. The one concern is a vault note count
that changed from 157 to 158 during the session because of an unrelated Obsidian Web Clipper capture, which
I did not create and did not delete. Full detail in "Vault verification" below.

## Files touched, and why

### `src/utils/navigationExpansion.ts`

Three changes.

1. Removed `supportsBranchCollapse?: boolean` from `NavigationExpansionTarget`, and its single consumer, the
   `target.supportsBranchCollapse !== false` term in `toggleNavigationExpansionTarget`. The `ancestorIds`
   field kept the doc comment that the removed field had accumulated, restated to say what `ancestorIds`
   means for every tree type: ids that must stay expanded for the row to keep rendering, in root-to-parent
   order, in the same namespace as `id`.
2. Added `getPropertyPlacementAncestorIds(placementKey)`, requirement 1's fix.
3. The `PROPERTY_VALUE` branch of `getNavigationExpansionTargetForItem` now sets
   `ancestorIds: getPropertyPlacementAncestorIds(item.key)` instead of
   `getPropertyAncestorNodeIds(item.data.id)`, and no longer sets `supportsBranchCollapse`.

This file now imports `getPropertyPlacementAncestorKeys` and `PROPERTY_PLACEMENT_SEPARATOR` from
`treeFlattener.ts`. I checked that this creates no cycle: `treeFlattener.ts` imports `sortUtils`,
`../types`, `../types/storage`, `../types/virtualization`, `fileFilters`, `tagPrefixMatcher`,
`../settings/types` and `propertyHierarchy`, and none of those import `navigationExpansion`. The complete
set of `navigationExpansion` importers is `propertyNavigation.ts`, `contextMenu/folderMenuBuilder.ts`,
`tagNavigation.ts`, `useNavigatorReveal.ts`, `useListPaneTitle.ts`, `NavigationPaneContent.tsx`,
`useNavigationPaneKeyboard.ts` and `useNavigationPaneTreeInteractions.ts`, none of which
`treeFlattener.ts` reaches.

### `src/hooks/navigationPane/useNavigationPaneTreeInteractions.ts`

`handlePropertyToggle` lost the `placementKey === nodeId` guard and the Task 6 comment explaining it. Its
target now carries `id: placementKey` rather than `id: targetNode.id`, and
`ancestorIds: getPropertyPlacementAncestorIds(placementKey)`. The import switched from
`getPropertyAncestorNodeIds` to `getPropertyPlacementAncestorIds`.

`id: placementKey` is load-bearing and was not optional. With the guard gone this callback now runs for
nested placements, and `expandedProperties` stores placement keys, so a node id there would both test the
wrong membership in `getTargetExpandedState` and persist a key that renders nowhere. For a key row, a root
placement or a flat value the two are equal, so nothing changed for them.

### `src/hooks/useNavigationPaneKeyboard.ts`

Comment only. The comment at the property auto-expand site claimed the target "marks itself ineligible for
branch replacement when that key is not also a node id", which is no longer true. Restated to say the
ancestors are derived from the placement key.

### `src/utils/treeFlattener.ts`

Requirement 3. Deleted `firstPlacementByNodeId`: its declaration in `FlattenPropertyHierarchyResult`, its
`Map` allocation, the `if (!firstPlacementByNodeId.has(node.id))` write inside `addNode`, and its place in
the return. `FlattenPropertyHierarchyResult` then wrapped a single field, so I deleted the interface and
made `flattenPropertyHierarchy` return `PropertyValueTreeItem[]` directly, which is also what its sibling
`flattenTagTree` does.

### `src/hooks/navigationPane/data/useNavigationPaneTreeSections.ts`

Removed the field from `NavigationPaneTreeSectionsResult` and its doc comment, from the property memo's
return type, the memo's local `Map`, the aggregation loop over `flattened.firstPlacementByNodeId`, all three
memo return statements and the hook result. Renamed the local `flattened` to `placements` to match the new
array return.

### `src/utils/propertyHierarchy.ts`

Comment only. The `resolvePropertyRevealChain` doc contrasted itself with `firstPlacementByNodeId` by name.
Restated to make the same point without naming a deleted symbol: anything read back out of the flattener
describes only rows that are already visible, because the flattener recurses into a placement's children
only when that placement is expanded.

### Tests

- `tests/utils/navigationExpansion.test.ts`: rewrote one test, added four.
- `tests/hooks/useNavigationPaneTreeInteractions.test.ts`: rewrote one test.
- `tests/utils/treeFlattener.test.ts`: dropped the deleted field's own test, and `result.items` became
  `result` for the new return shape.
- `tests/hooks/useNavigationPaneTreeSections.test.ts`: dropped the one assertion on the deleted field.
- `tests/utils/propertyHierarchy.test.ts`, `tests/utils/propertyNavigation.test.ts`: comments only, same
  deleted-symbol rewording as `propertyHierarchy.ts`.

Note on provenance: the `treeFlattener.ts`/`useNavigationPaneTreeSections.ts` deletions and the mechanical
test updates in the last two bullets were completed by the coordinator while this session was interrupted by
an API limit. I reviewed that diff in full before continuing and agree with all of it. Its accompanying
message said two tests were deleted; the diff shows one deleted test plus one deleted assertion, which is
the correct treatment and matches the suite arithmetic below.

## How a placement's ancestors are derived

```ts
export function getPropertyPlacementAncestorIds(placementKey: string): string[] {
    const chain = placementKey.split(PROPERTY_PLACEMENT_SEPARATOR);
    const targetNodeId = chain[chain.length - 1];
    return [...getPropertyAncestorNodeIds(targetNodeId), ...getPropertyPlacementAncestorKeys(chain)];
}
```

The placement key is the chain of value node ids joined with NUL, so splitting it recovers the chain with no
new state and no tree access. The last element is the target value node; `getPropertyAncestorNodeIds` maps it
to its key node id by string prefix. `getPropertyPlacementAncestorKeys` returns every proper prefix of the
chain rejoined, in root-to-parent order. `buildBranchExpandAction` then appends the target itself, so the
replacement set is exactly: key node id, every ancestor placement key, target placement key. That is the set
the flattener needs in `expandedPlacements` to recurse from the key down to the row that was just expanded.

I wrote it as a composition of `getPropertyAncestorNodeIds` rather than re-deriving the key node id, because
that makes the flat-key equivalence hold by construction rather than by coincidence. For a single-element
chain, `getPropertyPlacementAncestorKeys` returns `[]` and the whole function reduces to
`getPropertyAncestorNodeIds(nodeId)`, the exact call this site made before. A root placement's key equals its
node id and a non-hierarchical value's does too, so both take that path. A test asserts the two functions
return equal arrays for a flat value rather than only asserting the expected literal.

Key rows do not go through this function; `PROPERTY_KEY` still uses `getPropertyAncestorNodeIds(item.data.id)`,
which returns `[]` for a key node. `handlePropertyToggle` does call it for a key row, since the row passes
`item.key`, which for a key row is the key node id: the chain is one element with no NUL, the target node id
is the key node id, `getPropertyKeyNodeIdFromNodeId` returns it unchanged, and the guard
`keyNodeId !== propertyNodeId` yields `[]`. So a key row still replaces with `{keyNodeId}`, unchanged. The
pre-existing test `still takes the collapse-others branch for a key node` pins that and still passes.

## How I established folders, tags, virtual folders and shortcuts are unaffected

The argument has three parts: the field had one producer, the removed condition was a no-op for everything
else, and the code paths those types take are textually unchanged. I checked each by enumeration, not by
inspection of the sites I happened to remember.

### Every construction site of `NavigationExpansionTarget`

A target only reaches `toggleNavigationExpansionTarget`, so I enumerated its nine call sites
(`grep -rn "toggleNavigationExpansionTarget("`) and traced what each passes. That gives eight construction
sites in total:

| Site | Type | Changed? |
| --- | --- | --- |
| `navigationExpansion.ts:250` `getNavigationExpansionTargetForItem` FOLDER | folder | No |
| `navigationExpansion.ts:257` same, TAG | tag | No |
| `navigationExpansion.ts:264` same, PROPERTY_KEY | property | No |
| `navigationExpansion.ts:271` same, PROPERTY_VALUE | property | Yes, `ancestorIds` source, and the removed field |
| `navigationExpansion.ts:291` same, VIRTUAL_FOLDER | virtual-folder | No |
| `useNavigationPaneTreeInteractions.ts:181` `handleFolderToggle` | folder | No |
| `useNavigationPaneTreeInteractions.ts:337` `handleTagToggle` | tag | No |
| `useNavigationPaneTreeInteractions.ts:367` `handlePropertyToggle` | property | Yes, `id` and `ancestorIds` |

The five callers that do not build a literal all pass the result of `getNavigationExpansionTargetForItem`:
`NavigationPaneContent.tsx:915` (`triggerSelectedItemCollapse`), and `useNavigationPaneKeyboard.ts:204`,
`:224`, `:252` (auto-expand on selection for folder, tag, property rows), `:451` (expand key) and `:485`
(collapse key). So the table above is complete.

To be sure I was not missing a target built elsewhere, I also grepped every `type: 'folder'`,
`type: 'tag'`, `type: 'property'` and `type: 'virtual-folder'` literal in `src`. That returns roughly 50
hits, and all of them outside the table belong to unrelated discriminated unions: selection state
(`context/selection/state.ts`), navigation separators (`navigationSeparators.ts`), rename targets
(`navigationRenameTarget.ts`, `NavigationPaneItemRenderer.types.ts`), shortcut descriptors
(`navigationPaneShortcutTypes.ts`, `NavigationPaneShortcutRow.tsx`, `ShortcutItem.tsx`), context-menu
separator targets, `useDragAndDrop.ts`'s own `AutoExpandTarget`, the public API union in `api/types.ts` and
`api/public/notebook-navigator.d.ts`, `nativeSettingControls.ts` and `NavigationRootReorderPanel.tsx`. None
of these is ever passed to `toggleNavigationExpansionTarget`, and none referenced the removed field.

### Why removing the condition cannot change folder, tag or virtual-folder behavior

`supportsBranchCollapse` was optional and had exactly one producer, the `PROPERTY_VALUE` branch. Every other
target left it `undefined`, and the consumer tested `!== false`, which is true for `undefined`. So for
folders, tags, virtual folders and property key rows the term was constantly true and deleting it removes a
tautology. `grep -rn supportsBranchCollapse src tests` now returns nothing, and it never appeared in `tests`
at all, so no test encoded the old behavior for those types.

### Every consumer of the type

`getTargetExpandedState`, `buildToggleAction`, `buildBranchExpandAction`, `getNavigationExpansionTargetState`
and `toggleNavigationExpansionTarget` itself. I read all five: only `toggleNavigationExpansionTarget` ever
mentioned the removed field, at one line. `buildExpandItemsAction` is shared with
`expandNavigationTreeItems`, whose ten call sites (`tagNavigation.ts`, `propertyNavigation.ts`,
`folderMenuBuilder.ts`, `useNavigationActions.ts`, three in `useNavigatorReveal.ts`, two in
`useDragAndDrop.ts`) take `{type, ids}` and never a target, so they are untouched by the type edit. That
function's signature and body are unchanged.

Virtual folders specifically: `buildBranchExpandAction` returns `buildToggleAction(target)` for
`type === 'virtual-folder'`, so collapse-others has always been a plain toggle for them, and it still is.
That line is unchanged.

Shortcuts specifically: `getNavigationExpansionTargetForItem` handles FOLDER, TAG, PROPERTY_KEY,
PROPERTY_VALUE and VIRTUAL_FOLDER and returns `null` in `default`, so every shortcut row type returns
`null` and never reaches the toggle. Shortcut section expansion runs through `setShortcutsExpanded` and
`setRecentNotesExpanded`, which do not touch this machinery. A folder or tag shortcut row that does expand a
real folder goes through `handleFolderClick` to `handleFolderToggle`, which is the unchanged folder site at
`:181`.

### Evidence beyond the argument

- Added `replaces unrelated folder branches when branch collapse is enabled`, asserting
  `SET_EXPANDED_FOLDERS` with `{/, Projects, Projects/Active}` and that unrelated `Archive` branches are
  dropped. The pre-existing tag equivalent, `replaces unrelated tag branches when branch collapse is
  enabled`, is untouched and still passes. Those two pin the shared-type edit at unit level.
- The full suite passes, including the files that exercise these paths end to end:
  `tests/hooks/useNavigationPaneKeyboard*.test.ts`, `tests/hooks/useNavigatorReveal*.test.ts`,
  `tests/hooks/useDragAndDrop*.test.ts`, `tests/utils/tagNavigation.test.ts`,
  `tests/utils/propertyNavigation.test.ts`, `tests/utils/contextMenu/folderMenuBuilder*.test.ts`.
- In the live vault I expanded a nested folder branch with the setting on and confirmed both ancestors stayed
  open and the property section was untouched. Transcript below.

## Did any case still need a guard?

No. Both suppressions are gone and nothing replaced them. I worked through the cases:

- Key row: replacement set `{keyNodeId}`, unchanged.
- Root placement: `{keyNodeId, nodeId}`, unchanged from before Task 5.
- Nested placement: `{keyNodeId, ...ancestor placement keys, placementKey}`, which is what requirement 1
  adds and what the row needs.
- Flat value: reduces to the root-placement case by construction.
- Property virtual folder root: plain toggle, unchanged.
- Cross-key collapse: `SET_EXPANDED_PROPERTIES` replaces the whole set, so expanding under one key drops
  other keys' expansion. That is what collapse-others means, it matches folders and tags, and it already
  happened for root placements before this task.

Two adjacent defects survive, both pre-existing and both explicitly out of scope, and neither is a case where
a guard would help:

- `propertyNodeHasChildren` reports children from raw `childIds`, ignoring the flattener's depth cap and its
  cycle filter, so a placement at `propertyHierarchyMaxDepth` can offer a chevron that expands into nothing.
  Documented in that function. Independent of whether expansion is a toggle or a replacement.
- `resolvePropertyRevealChain` can return a non-root head for a cycle member reachable from a real root. That
  affects reveal's chain, not interactive expansion: every placement key that reaches
  `getNavigationExpansionTargetForItem` or `handlePropertyToggle` came from a rendered row, and the flattener
  only ever builds chains from `index.rootIds`.

The children-presence contract stays as the brief directed. `handlePropertyToggle` still passes
`propertyNodeHasChildren(targetNode, propertyHierarchyIndex)` and the `PROPERTY_VALUE` target still uses
`item.hasChildren ?? item.data.children.size > 0`. I did not touch either.

## Required tests

All in `tests/utils/navigationExpansion.test.ts` unless noted.

| Brief requirement | Test |
| --- | --- |
| Nested placement keeps rendering; set contains key node id, every ancestor placement key, target | `replaces the expanded set with the whole placement chain for a nested placement` (rewrite of the old suppression test) and `keeps a three deep placement rendering by naming every intermediate placement key` |
| Root placement still works by mouse, asserted with the root value node | `expands a root hierarchical value through the collapse-others branch, where its own children map is empty` in `tests/hooks/useNavigationPaneTreeInteractions.test.ts`, pre-existing and passing unchanged. It builds `workNode` via `createPropertyValueNode`, whose `children` map is empty, and drives `handlePropertyToggle(workNode.id, workNode.id)`, the mouse path |
| Sibling branch expansion collapses the previous one | `drops a previously expanded sibling branch when another root placement expands` |
| Flat non-hierarchical value unchanged | `leaves a flat non-hierarchical value replacing with the key node id alone, as before` |
| Folder and tag branch expansion unchanged | `replaces unrelated folder branches when branch collapse is enabled` (new) and `replaces unrelated tag branches when branch collapse is enabled` (pre-existing) |

The two rewritten tests, which the brief singled out as the only things pinning the difference:

- `tests/utils/navigationExpansion.test.ts`, was `does not replace the expanded set for a nested placement
  when branch collapse is on`, now asserts `SET_EXPANDED_PROPERTIES` with
  `{KEY_ID, WORK_ID, WORK_ID\0CLIENTS_ID}`.
- `tests/hooks/useNavigationPaneTreeInteractions.test.ts`, was `falls through to the plain dispatch when
  collapseOtherBranchesOnExpand is on but the placement key differs from the node id`, now
  `branch replaces a nested placement by mouse, keeping the row it just expanded rendering`, asserting the
  same three-element set through `handlePropertyToggle`. Both carry a comment saying what they used to
  assert and why that changed.

On the earlier process failure the brief warned about: the three-deep test is the one that genuinely proves
"every ancestor placement key", because its middle set member `WORK_ID\0CLIENTS_ID` equals no node id, so
only key-derived ancestors can produce it. The two-level test alone could be satisfied by a node-id list,
since `WORK_ID` is both a node id and a root placement key.

## Commands and output

Constraint tools used as directed, `tests/` linted explicitly.

```
$ npx tsc -noEmit -skipLibCheck
TSC_OK
```

```
$ node node_modules/vitest/vitest.mjs run
 Test Files  179 passed (179)
      Tests  2186 passed (2186)
   Start at  05:48:01
   Duration  6.06s (transform 8.54s, setup 1.17s, import 27.98s, tests 3.79s, environment 13ms)
```

Suite arithmetic against the 2183 baseline: minus 1 for the deleted `records the first placement of each
node id` test, plus 4 new tests (folder branch, three-deep placement, sibling collapse, flat value) equals
2186. The two rewritten tests and the one deleted assertion do not change the count. The suite did not drop.

```
$ node node_modules/prettier/bin/prettier.cjs --write <12 touched files>
src/utils/navigationExpansion.ts 69ms (unchanged)
src/utils/treeFlattener.ts 28ms (unchanged)
src/utils/propertyHierarchy.ts 15ms (unchanged)
src/hooks/navigationPane/useNavigationPaneTreeInteractions.ts 28ms (unchanged)
src/hooks/navigationPane/data/useNavigationPaneTreeSections.ts 27ms (unchanged)
src/hooks/useNavigationPaneKeyboard.ts 18ms (unchanged)
tests/utils/navigationExpansion.test.ts 10ms (unchanged)
tests/utils/treeFlattener.test.ts 17ms (unchanged)
tests/utils/propertyHierarchy.test.ts 11ms (unchanged)
tests/utils/propertyNavigation.test.ts 8ms (unchanged)
tests/hooks/useNavigationPaneTreeInteractions.test.ts 29ms (unchanged)
tests/hooks/useNavigationPaneTreeSections.test.ts 22ms (unchanged)
```

```
$ node node_modules/eslint/bin/eslint.js <same 12 files>; echo "ESLINT_EXIT=$?"
ESLINT_EXIT=0
```

All twelve touched files are clean. The nine pre-existing repo-wide errors are in four files I did not touch.

```
$ git diff -U0 | grep -n "[emdash/endash]" || echo "NO_EM_OR_EN_DASHES_IN_DIFF"
NO_EM_OR_EN_DASHES_IN_DIFF
```

```
$ node scripts/build-styles.mjs && node esbuild.config.mjs production
Built styles.css from 57 files
Validated theming guide against CSS and Style Settings

$ cp main.js styles.css manifest.json ~/2027/.obsidian/plugins/notebook-navigator/
$ obsidian plugin:reload id=notebook-navigator
$ obsidian dev:errors
21:17:55 Error: Disconnected
Error: Disconnected
    at e.disconnect (app://obsidian.md/app.js:1:3633332)
    ...
```

That is the only entry `dev:errors` reports, before and after all vault interaction. Its timestamp 21:17:55
predates this session, and the stack is entirely in Obsidian's own sync client (`asyncGetServer`,
`getServer`), not in plugin code. No new errors appeared at any point.

## Vault verification

`~/2027`, settings confirmed before starting: `collapseOtherBranchesOnExpand: false`,
`propertyHierarchicalKeys: {"projects": true}`, `showProperties: true`.

Markdown count outside `.obsidian` and `.trash`:

```
$ find ~/2027 -name "*.md" -not -path "*/.obsidian/*" -not -path "*/.trash/*" | wc -l
     157        # before
     158        # after
```

The extra file is `~/2027/Clippings/Why Is Everyone In Tech So Sad.md`, birth time 05:42:46, modified
05:43:04, which falls inside my click sequence. It is a 27 KB capture of a Noema article
(`source: https://www.noemamag.com/why-is-everyone-in-tech-so-sad/`, `published: 2026-08-06`,
`created: 2026-08-08`, `tags: [clippings]`) whose frontmatter matches this vault's
`Templates/Capture/Clipping Template.md` and the other 40-odd files already in `Clippings/`. It arrived via
the Obsidian Web Clipper or vault sync. My interaction with the vault was limited to dispatching `click`
events on `.nn-navitem-chevron` elements and reading DOM attributes, which cannot produce a file with an
article body and a source URL, and the property-note creation feature on this branch names files after
property values, not article titles. I did not delete it, because the brief forbids deleting notes and it is
a real user note. `.trash` is empty, and no other markdown file in the vault was created or modified today,
so nothing was lost.

I did not create or delete anything.

### Transcript

Verification drove the real mouse path: every step dispatched a `MouseEvent('click', {bubbles: true})` on a
row's `.nn-navitem-chevron`, which is the same event React's `onToggle` receives from a user click. Rows were
read back as `[name, data-level, aria-expanded]` from `.nn-navigation-pane .nn-navitem`.

Baseline, setting still `false`:

```
projects 0 true
  Fiddle 1 true
    Building software 2, Development 2, Obsidian 2, Tooling 2
  Personal 1, Systems 1, Tools 1
  Work 1 true
    Clients 2 true
      Datawerkplaats Mooi Maasvallei 3
    Datawerkplaats.net 2
categories/contexts/locations/references/roles/status/topics 0 false
2027 (root folder) 0 false
```

Turned the setting on through the plugin's own path, `p.settings.collapseOtherBranchesOnExpand = true;
await p.saveSettingsAndUpdate()`, and confirmed it reached disk:

```
=> collapseOtherBranchesOnExpand=true
=> persisted=true
```

1. Clicked `Work`'s chevron to collapse it, so the next click would be a real expand. Result: `Work 1 false`,
   its subtree gone, `Fiddle 1 true` untouched. Correct: collapse is a plain toggle and must not disturb
   other branches.
2. Clicked `Work`'s chevron to expand it. This is the case Task 5's drift broke, where mouse expansion of a
   root placement dispatched nothing at all. Observed:

   ```
   projects 0 true
     Fiddle 1 false          <- sibling branch collapsed by the replacement
     Personal 1, Systems 1, Tools 1
     Work 1 true             <- expanded
       Clients 2 false
       Datawerkplaats.net 2
   ```

   Work expanded and Fiddle's four children disappeared, so branch replacement ran, by mouse, on a root
   placement.
3. Clicked `Clients`, a nested placement at level 2. This is requirement 1's case: before this task the
   replacement set would have been `{key:projects, key:projects=clients}`, dropping `key:projects=work` and
   collapsing the row being expanded, which is why Task 5 suppressed it. Observed:

   ```
   projects 0 true
     Fiddle 1 false
     Personal 1, Systems 1, Tools 1
     Work 1 true                                  <- still rendered
       Clients 2 true                             <- expanded, still rendered
         Datawerkplaats Mooi Maasvallei 3         <- the target row
       Datawerkplaats.net 2
   ```

   `Datawerkplaats Mooi Maasvallei` is present at level 3 under `Clients` under `Work`. This is the exact tree
   the brief asked for, read off the DOM rather than inferred.
4. Clicked `Fiddle`, the sibling root placement. Observed:

   ```
   projects 0 true
     Fiddle 1 true
       Building software 2, Development 2, Obsidian 2, Tooling 2
     Personal 1, Systems 1, Tools 1
     Work 1 false
   ```

   The whole `Work` branch collapsed: `Work 1 false`, and both `Clients` and
   `Datawerkplaats Mooi Maasvallei` are gone from the row list.
5. Flat key check. Clicked the non-hierarchical `status` key. It expanded to its five values, all at level 1
   with no chevrons, and `projects 0 false` collapsed. Cross-key collapse-others behaves exactly as before.
6. Folder check, shared-type edit. Expanded the root folder `2027`, then `Templates`, then
   `Templates/Templater`. Observed after the third click:

   ```
   2027 0 true            <- ancestor preserved
     Attachments 1, Clippings 1, Daily 1, Journal 1
     Templates 1 true     <- ancestor preserved
       Bases 2, Capture 2
       Templater 2 true
         Scripts 3        <- deepest row rendered
       Virtual Content 2
   status 0 true + its 5 values
   ```

   Folder branch replacement still keeps its ancestors, and the expanded `status` property branch was
   untouched, so the two expansion namespaces stay separate.

Then restored: set `collapseOtherBranchesOnExpand` back to `false` through `saveSettingsAndUpdate` and
confirmed both in memory and on disk:

```
=> inMemory=false persisted=false
```

With the setting off again I clicked the tree back to the baseline shape (collapsed `status`, `Templater`,
`Templates`, `2027`; expanded `projects`, `Fiddle`, `Work`, `Clients`) and read it back:

```
projects 0 true
  Fiddle 1 true
    Building software 2, Development 2, Obsidian 2, Tooling 2
  Personal 1, Systems 1, Tools 1
  Work 1 true
    Clients 2 true
      Datawerkplaats Mooi Maasvallei 3
    Datawerkplaats.net 2
categories/contexts/locations/references/roles/status/topics 0 false
2027 0 false
```

Same rows, same levels, same expansion flags as the baseline block above. I also removed the five
`window.__nn*` inspection helpers I had installed.

### Not verified in the vault

Two of the five test cases could not be observed in `~/2027`, and I did not change further settings to force
them:

- **Tag branch expansion.** `showTags` is `false` in this vault, so no tag rows render. Turning it on would
  not have helped much: `app.metadataCache.getTags()` returns 13 tags and none contains a `/`, so every tag
  is a childless root and a tag branch with ancestors does not exist here. Tags are covered by the untouched
  unit test plus the code argument above.
- **A flat value with children.** No non-hierarchical value in this vault has nested value paths; all five
  `status` values are leaves. Covered by
  `leaves a flat non-hierarchical value replacing with the key node id alone, as before`, which asserts the
  equivalence with `getPropertyAncestorNodeIds` directly.

## Concerns

1. The vault note count is 158 rather than 157. Cause identified above and unrelated to this change: an
   Obsidian Web Clipper capture landed in `Clippings/` at 05:42:46. I left it in place rather than delete a
   user note. Nothing else in the vault changed, and `.trash` is empty.
2. Tag branch behavior and flat-value-with-children behavior are pinned by unit tests only, not by vault
   observation, for the structural reasons listed just above.
3. `handlePropertyToggleAllSiblings` (Alt+click) calls `handlePropertyToggle`, so with the setting on its
   self-toggle now branch-replaces for nested placements too, where before it fell through to a plain
   toggle. I traced the consequence and it is benign: the follow-up `TOGGLE_DESCENDANT_PROPERTIES` walks
   `node.children`, which is always empty for a hierarchical value, so no second dispatch occurs for the
   hierarchical case, and for a flat value the placement key equals the node id, making the sequence
   identical to today's. Worth a reviewer's eye since it is a behavior change I did not add a test for.
