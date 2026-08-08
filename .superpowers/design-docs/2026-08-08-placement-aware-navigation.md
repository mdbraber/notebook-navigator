# Placement-aware navigation: four behaviour gaps in the hierarchical property tree

Branch `property-notes`, starting from HEAD `1e6c1f83` (suite 2219 passing).

A property key marked "Show hierarchy" renders its values as a nested DAG. Each row is a *placement*,
identified by the chain of value node ids joined with `PROPERTY_PLACEMENT_SEPARATOR` (a NUL). A root
placement's chain is `[nodeId]`, so its key equals the node id; deeper keys contain a NUL. A value
node's own `children` map is always empty, because the property tree is never reparented, so any
`children.size > 0` test on a value node is wrong.

Four gaps were approved for closing. All four are closed. The out-of-scope item (pill rainbow colours
in `buildFileItemPropertyRainbowColors`) was not touched.

---

## Item 1: the navigation row index keyed property rows by node id

### The defect

`src/utils/navigationIndex.ts:81` stored `item.data.id` for both `PROPERTY_KEY` and `PROPERTY_VALUE`
rows. With a multi-placement value (`Clients` under both `Areas` and `Categories`) the last placement
overwrote every earlier one, so a lookup resolved to a row the caller was not asking about. That is
what let the collapse-or-expand-selected-item command act on the wrong placement, and with
`collapseOtherBranchesOnExpand` on it could discard the branch the user was in.

### What changed

`buildNavigationPathIndexMap` now stores `item.key` for both property row types. Verified that
`item.key` equals `item.data.id` for every row a non-hierarchical key emits:

- key rows: `useNavigationPaneTreeSections.ts:934` emits `key: keyNode.id`
- non-hierarchical value rows: `useNavigationPaneTreeSections.ts:971` emits `key: child.id`
- hierarchical value rows: `flattenPropertyHierarchy` emits `key: placementKey`, which for a root
  placement is the node id (`treeFlattener.ts:650`, chain of one)

So for folders, tags, virtual folders, shortcuts, key rows and every value of a key without "Show
hierarchy", the map is byte for byte what it was.

A second pass then adds a **node id fallback** entry for any value row whose placement key differs
from its node id, applied after every row is in the map and skipping keys that already exist. Two
reasons:

1. Selection is stored as a node id, not a placement. `SelectionState.selectedProperty` is a
   `PropertySelectionNodeId`, it is persisted to localStorage that way, the row highlight compares
   `selectedProperty === item.data.id`, and shortcuts and the public API address properties by node
   id. Every existing property lookup therefore has only a node id to offer. Without a fallback those
   lookups would silently return -1 and scrolling to the selected property, the collapse-selected-item
   command and keyboard navigation from a nested row would all stop working - the exact "quietly stops
   working" failure the brief warned about. **This is the item-1 finding the brief asked for: there is
   no property lookup anywhere that has a placement to pass, other than the new item-2 lookup.** No
   node-id-to-placement conversion was invented; the fallback simply preserves the entry the map
   already held.
2. Fallbacks never overwrite, and are applied last, so a real placement key always wins. That matters
   for a cycle member promoted to a root (`propertyHierarchy.ts:169`, "a promoted cycle member is both
   a root and somebody's child"): its node id is a genuine placement key on its root row and a
   fallback on its nested row, and the root row must win regardless of emit order.

The behaviour change for a bare node id is first-wins instead of last-wins: a node id now resolves to
the **topmost** rendered placement rather than the bottom-most. That is deterministic rather than
arbitrary, and it only affects values that render more than once, which requires "Show hierarchy" on.

Fully removing the ambiguity would need selection to carry a placement, which is a much larger change
(persistence format, highlight comparison, shortcuts, public API) and was not in scope.

### Call sites audited

Every caller of `getNavigationIndex` and `setNavigationIndex`, and every caller of the map:

| Site | What it passes for `ItemType.PROPERTY` | Effect |
| --- | --- | --- |
| `src/utils/navigationIndex.ts:73` `setNavigationIndex` FOLDER | n/a, `item.data.path` | unchanged |
| `src/utils/navigationIndex.ts:75` `setNavigationIndex` TAG | n/a, `item.data.path` | unchanged |
| `src/utils/navigationIndex.ts:77` `setNavigationIndex` TAG (virtual tag collection) | n/a, `item.tagCollectionId` | unchanged |
| `src/utils/navigationIndex.ts:79` `setNavigationIndex` PROPERTY (virtual property collection) | already `item.key` | unchanged |
| `src/utils/navigationIndex.ts:81` `setNavigationIndex` PROPERTY (key and value rows) | now `item.key` | **changed** |
| `src/hooks/useNavigationPaneKeyboard.ts:141` `resolveIndex` exact-type branch | node id from `selectionState.selectedProperty`, plus `PROPERTIES_ROOT_VIRTUAL_FOLDER_ID`, `buildPropertyKeyNodeId(...)`, `TAGGED_TAG_ID`, and now a placement key for item 2 | resolves via placement key when given one, via fallback for a node id |
| `src/hooks/useNavigationPaneKeyboard.ts:147,152` untyped FOLDER then TAG probes | folder path / tag path | unchanged |
| `src/hooks/useNavigationPaneKeyboard.ts:157` untyped PROPERTY probe | whatever the caller had | same as above |
| `src/hooks/useNavigationPaneScroll.ts:233` `resolveIndex` typed | node id, from `selectedPath` (`:450-451`) or a `requestScroll` request | fallback keeps it resolving |
| `src/hooks/useNavigationPaneScroll.ts:237,242,247` untyped probes | folder path, tag path, then property node id | unchanged for folders and tags |
| `src/components/navigationPane/NavigationPaneContent.tsx:779` `getSelectedRenderedItem` | node id (`selectionState.selectedProperty`) | fallback keeps it resolving; feeds `triggerSelectedItemCollapse` and inline rename |
| `src/components/navigationPane/NavigationPaneContent.tsx:836` `handleStartFolderInlineRename` | FOLDER only | unchanged |
| `src/components/navigationPane/NavigationPaneContent.tsx:941` `getIndexOfPath` imperative handle | caller-supplied; no in-repo caller passes PROPERTY | unchanged |
| `src/hooks/navigationPane/data/useNavigationPaneItemPipeline.ts:614` builds the map | n/a | n/a |
| `normalizeNavigationPath` callers (`NotebookNavigatorComponent.tsx:825`, `NavigationPaneContent.tsx:733`, `useNavigationPaneScroll.ts:424,447,449`) | pass-through for FOLDER and PROPERTY, lowercase for TAG | unchanged |

How folders and tags are shown unaffected: their two `setNavigationIndex` calls are untouched, they
never enter the property branch (the `else if` chain is disjoint on `item.type`), `normalizeNavigationPath`
is unchanged, and the new fallback pass only ever writes keys under `ItemType.PROPERTY`. Pinned by test
("resolves folder and tag rows exactly as before, since property rows share this map"), including that
tag lookups still normalize case and folder lookups still do not.

Files: `src/utils/navigationIndex.ts`.

---

## Item 2: left-arrow on a nested placement jumped to the key row

`src/hooks/useNavigationPaneKeyboard.ts:548` resolved a value's parent as
`buildPropertyKeyNodeId(propertyNode.key)`, which is right for a flat value but skips levels for a
nested one: pressing left inside `Work > Clients` selected the `projects` key row.

New pure helper `getPropertyPlacementParentKey(placementKey)` in `src/utils/treeFlattener.ts` returns
the chain minus its last segment, or `null` when the chain has one element. The keyboard hook now uses
`getPropertyPlacementParentKey(item.key) ?? buildPropertyKeyNodeId(propertyNode.key)`, so a root
placement and every value of a non-hierarchical key still fall back to the key row exactly as before.
Depends on item 1, since the lookup is by placement key.

Files: `src/utils/treeFlattener.ts`, `src/hooks/useNavigationPaneKeyboard.ts`.

---

## Item 3: Alt+click could not expand a hierarchical subtree

`handlePropertyToggleAllSiblings` fed `getAllDescendantPropertyNodeIds`, whose walk reads
`node.children`, always empty for a value node, so Alt+click on a hierarchical value was only a plain
toggle while the same gesture opened a whole tag subtree.

New `collectPropertySubtreeExpansionKeys` in
`src/hooks/navigationPane/useNavigationPaneTreeInteractions.ts` reuses
`collectExpandablePropertyPlacementKeys` (added for expand-all), so the depth cap, the cycle filter and
`MAX_EXPANDABLE_PROPERTY_PLACEMENTS` all apply and no placement the flattener would refuse to render is
ever emitted. No second walk was written:

- key not marked hierarchical (`!index.rootIds.has(keyNodeId)`): unchanged, still
  `getAllDescendantPropertyNodeIds`
- hierarchical value row: the enumeration filtered to keys prefixed with
  `placementKey + PROPERTY_PLACEMENT_SEPARATOR`, so only placements strictly below the clicked one
- hierarchical key row: the whole enumeration. This was also broken, in the other direction: the old
  path emitted the key's value node ids, and a non-root value's node id names no row at all, which is
  a junk entry persisted forever. Same defect class the brief flags, so it is fixed here too.

`TOGGLE_DESCENDANT_PROPERTIES` only adds to or removes from `expandedProperties`, which is keyed by
placement, so placement keys travel through it unchanged; the action field keeps its name, matching the
existing convention documented on `TOGGLE_PROPERTY_EXPANDED`.

Files: `src/hooks/navigationPane/useNavigationPaneTreeInteractions.ts`.

---

## Item 4: property pill reveal did not nest

`src/hooks/useTagNavigation.ts` called `navigateToProperty` with no `propertyHierarchy`, so revealing
from a list-pane property pill expanded the value's key and stopped, and a nested value's row never
rendered.

The index is owned by the navigation pane's render, which this hook (used by
`src/components/fileItem/useFileItemPills.tsx`) has no access to. It is already published to
`PropertyTreeService` every render (`NotebookNavigatorComponent.tsx:1500` calls
`updateHierarchyIndex`), so the plumbing exists and only lacked a reader: added
`PropertyTreeService.getHierarchyIndex()`. `useTagNavigation` now takes `propertyTreeService` from
`useServices()` and passes `{ index: propertyTreeService?.getHierarchyIndex() ?? EMPTY_PROPERTY_HIERARCHY_INDEX, maxDepth: settings.propertyHierarchyMaxDepth }`,
the same shape `useNavigatorReveal.ts:966` passes. With no service, or before any render has published
an index, the empty index means reveal expands the key alone, exactly as before.

Files: `src/services/PropertyTreeService.ts`, `src/hooks/useTagNavigation.ts`.

---

## Tests that fail against pre-fix code

Verified by `git stash push -- src/` and re-running: **9 of the 17 new assertions fail** against the
unmodified source (4 files failed, 9 tests failed, 53 passed):

Item 1, `tests/utils/navigationIndex.test.ts` (new file):

- `resolves each placement of a multi-parent value to its own row` - the core defect
- `resolves the parent placement of a nested row, which is what collapsing left needs`
- `falls back to the topmost placement for a node id that names no row of its own`
- `never lets a node id fallback shadow the row that owns that key`

Item 2, `tests/utils/treeFlattener.test.ts`:

- `drops the last segment of a nested chain, which is the placement the row renders under`
- `reports no parent placement for a root placement or a flat value`

Item 3, `tests/hooks/useNavigationPaneTreeInteractions.test.ts`:

- `expands the placements below a hierarchical value, where its own children map is empty`
- `expands every placement of a hierarchical key from its key row`

Item 4, `tests/hooks/useTagNavigation.test.ts` (new file):

- `expands every ancestor placement of a nested value, not just its key`

Also added, passing both before and after, as pins rather than reproductions:

- `keeps a root placement addressable by its node id, since the two are the same string`
- `resolves a value of a key that is not hierarchical by its node id, unchanged`
- `resolves folder and tag rows exactly as before, since property rows share this map` (the item-1
  regression guard the brief asked for)
- `keys a virtual property collection row by its own key`
- `stops at the hierarchy depth cap rather than expanding a row that cannot render` and
  `takes only the placements below the clicked one, not the whole key` (both hold pre-fix only because
  pre-fix dispatches no descendants at all)
- `expands the key alone for a value of a key that is not hierarchical` and
  `expands the key alone when no property tree service is available`

Item 2's coverage is the pure helper plus the index lookup it feeds, not the hook itself.
`useNavigationPaneKeyboard` cannot be driven in this repo: `useKeyboardNavigation` attaches its
listener in a `useEffect` on a real DOM node, and there is no jsdom, testing-library or
react-test-renderer available (the same gap Residual 9 recorded in the ledger). The three lines of glue
in the hook are covered by tsc only; the derivation and the lookup are covered by tests.

## Verification commands

```
$ npx tsc -noEmit -skipLibCheck
(no output)

$ node node_modules/vitest/vitest.mjs run
 Test Files  183 passed (183)
      Tests  2236 passed (2236)

$ node node_modules/prettier/bin/prettier.cjs --write <the 10 touched files>
src/utils/navigationIndex.ts 52ms (unchanged)
src/utils/treeFlattener.ts 36ms (unchanged)
src/hooks/useNavigationPaneKeyboard.ts 27ms
src/hooks/useTagNavigation.ts 4ms (unchanged)
src/hooks/navigationPane/useNavigationPaneTreeInteractions.ts 32ms (unchanged)
src/services/PropertyTreeService.ts 8ms (unchanged)
tests/utils/navigationIndex.test.ts 10ms
tests/utils/treeFlattener.test.ts 23ms (unchanged)
tests/hooks/useTagNavigation.test.ts 7ms
tests/hooks/useNavigationPaneTreeInteractions.test.ts 39ms

$ node node_modules/eslint/bin/eslint.js <the same 10 files>
(no output, exit 0)
```

Baseline: 2219 -> 2236 (17 new tests). `eslint` over all of `src` and `tests` reports 312 pre-existing
problems in files this pass did not touch; the ten touched files are clean. Two lint errors introduced
during this pass were fixed rather than suppressed: an `expect.objectContaining` producing `any` in the
tree-interactions test (the surrounding `toHaveBeenCalledTimes(1)` already asserted it, so the
redundant assertion was deleted) and an unnecessary type assertion in the new `useTagNavigation` test
(replaced with an explicit return type on the `vi.hoisted` factory, since hoisted state cannot
reference an imported value).

`.superpowers/sdd/.gitignore` was checked before and after and still holds its documented content, not
a bare `*`.

---

## Vault verification transcript

Vault `~/2027`: `propertyHierarchicalKeys: {"projects": true}` (note: `categories` is **not** marked
hierarchical in the live vault, so the multi-parent `Clients`/`Software` values under `categories` do
not nest there; the `projects` key does, and `Clients` nests under `Work` via
`Clients.md` -> `projects: [[Work]]`), `includeDescendantNotes: true`,
`collapseOtherBranchesOnExpand: false`, `propertyHierarchyMaxDepth: 10`.

**Markdown files outside `.obsidian` and `.trash`: 163 before, 163 after.** Last recorded count was
161. Investigated rather than assumed: `find -newermt` shows the extra files are the user's own
activity from before this session, all created 2026-08-08 - four Web Clipper captures under
`Clippings/` (07:08, 06:13, 05:49, 05:43) plus one at 16:12, and `Test Power Bases.md`, `Test.md`,
`_types/task.md`. Nothing was created or deleted by this pass.

### Build and deploy

```
$ node scripts/build-styles.mjs && node esbuild.config.mjs production
Built styles.css from 57 files
Validated theming guide against CSS and Style Settings

$ cp main.js styles.css manifest.json ~/2027/.obsidian/plugins/notebook-navigator/
copied

$ obsidian dev:errors clear
Cleared 4 errors.

$ obsidian plugin:reload id=notebook-navigator
$ obsidian dev:errors
No errors captured.
```

### State snapshot taken before touching anything

```
appId a5e2bf00d69535a2, vault 2027
expanded-properties       ["key:projects=work key:projects=clients","key:projects=work"]
expanded-virtual-folders  []
expanded-folders          ["Templates"]
expanded-tags             []
selected-property         null
selected-folder           "/"
selected-file             "Test.md"
enablePropertyInternalLinks  true
```

### Item 2: left-arrow from `Work > Clients` selects the `Work` placement

Expanded the `projects` key row, giving the rendered rows (node id @ level):

```
key:projects@0, key:projects=fiddle@1, key:projects=personal@1, key:projects=systems@1,
key:projects=tools@1, key:projects=work@1, key:projects=clients@2,
key:projects=datawerkplaats mooi maasvallei@3, key:projects=datawerkplaats.net@2
```

Real CDP click on the `Clients` row (x=320 to avoid the name, which would open its property note):

```
selected: ["key:projects=clients"], data-navigator-focused: "true"
expandedProperties: ["key:projects=work\0key:projects=clients","key:projects=work","key:projects"]
Clients aria-expanded: "true"
```

First `ArrowLeft` (the row is expanded, so it collapses first, as tags do):

```
selected: ["key:projects=clients"]
expandedProperties: ["key:projects=work","key:projects"]     <- the placement key was removed
```

Second `ArrowLeft`:

```
selected: [{node: "key:projects=work", level: "1"}]
selectedProperty localStorage: "key:projects=work"
```

The `Work` placement, at level 1. Pre-fix this selected the `key:projects` key row at level 0.

### Item 3: Alt+click on `Work` expands its subtree

Plain chevron click first, to collapse `Work`:

```
expandedProperties: ["key:projects"]
rows: ... key:projects=work@1 ...   (no level-2 rows)
```

Alt+click (`modifiers: 1`) on the same chevron:

```
expandedProperties: ["key:projects","key:projects=work","key:projects=work key:projects=clients"]
rows: key:projects=work@1, key:projects=clients@2,
      key:projects=datawerkplaats mooi maasvallei@3, key:projects=datawerkplaats.net@2
```

The whole subtree opened, and the only placement added below `Work` is the one that has children to
reveal. Pre-fix this was a plain toggle: `Work` alone, no level-3 row.

### Item 4: pill reveal expands the full chain

`enablePropertyInternalLinks` is on in this vault, and a wikilink property pill with that setting opens
the link instead of navigating, so the reveal path is unreachable while it is on. Toggled it off for
this check and restored it afterwards (recorded below). Reset `expanded-properties` to `[]` and
reloaded, then clicked the `Building software` pill (a `projects` value nested under `Fiddle`, via
`Building software.md` -> `projects: [[Fiddle]]`) on `Bulwark.md`:

```
expandedProperties: ["key:projects","key:projects=fiddle"]
selectedProperty:   "key:projects=building software"
rows: key:projects@0, key:projects=fiddle@1,
      key:projects=building software@2 SELECTED, key:projects=development@2,
      key:projects=obsidian@2, key:projects=tooling@2, key:projects=personal@1, ...
```

The ancestor placement `key:projects=fiddle` was expanded, not just the key, and the nested row renders
and is selected. Pre-fix only `key:projects` would have been expanded and the row would not exist.

### Folders still behave as today (item 1 touches shared code)

Expanded the vault root, clicked `Templates/Bases`, then `ArrowLeft` twice:

```
click:      selected ["Templates/Bases"]
ArrowLeft:  selected ["Templates"]        (leaf, so it moves to the parent)
ArrowLeft:  selected ["Templates"]        (parent was expanded, so it collapses and stays)
```

Unchanged folder behaviour. Tags could not be smoke-tested in this vault: no tag rows render at all
(`expanded-tags` is `[]` and the tag section produced no `.nn-navitem.nn-tag` elements), so the tag
side rests on the unit test in `tests/utils/navigationIndex.test.ts`.

### Restore

Restored `enablePropertyInternalLinks` to `true` via `plugin.saveSettingsAndUpdate()`, wrote every
snapshotted localStorage value back, removed `selected-property`, re-opened `Test.md` as the active
file (a reload with a different active file auto-reveals that file's property and would have left a
different selection), and reloaded the plugin. Final state, identical to the snapshot:

```
active: Test.md
expanded-properties       ["key:projects=work key:projects=clients","key:projects=work"]
expanded-virtual-folders  []
expanded-folders          ["Templates"]
expanded-tags             []
selected-property         null
selected-folder           "/"
selected-file             "Test.md"
enablePropertyInternalLinks  true (in data.json)
propertyHierarchicalKeys {"projects": true}, collapseOtherBranchesOnExpand false,
propertyHierarchyMaxDepth 10  (all unchanged in data.json)

$ obsidian dev:errors
No errors captured.
```

Markdown count re-checked after the restore: 163, matching the count taken before any of this.

---

## Commit

Work commit: `f8935062`, parent `1e6c1f83`. Recorded here by the follow-up commit that adds this line,
since a commit cannot contain its own SHA.
