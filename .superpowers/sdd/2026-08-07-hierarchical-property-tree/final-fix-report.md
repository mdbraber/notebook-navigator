# Final fix wave, hierarchical property tree

Branch: `property-notes`. Base: `9a7e1950`. Four items from the whole-branch review, one dispatch.

## Fix 1: hasChildren now obeys the flattener's depth cap and cycle filter

The chevron and the flattener now share one expression of both limits, and they live where the
flattener lives (`src/utils/treeFlattener.ts`), because both limits are properties of the *placement
chain*, which is that module's format:

- `isPropertyPlacementAtDepthCap(chain, maxDepth)`, `chain.length - 1 >= maxDepth`. The flattener's own
  check became a call to it, so the two cannot drift.
- `resolveRenderablePropertyChildIds(chain, index)`, dropping children already in the chain. The
  flattener's `filter` became a call to it too.
- `propertyPlacementHasRenderableChildren(placementKey, index, maxDepth)`, exported for direct testing.
- `propertyPlacementHasChildren(node, placementKey, index, maxDepth)`, the one function every caller
  uses. `propertyNodeHasChildren` is gone from `src/utils/propertyHierarchy.ts`.

Home chosen deliberately: putting it in `propertyHierarchy.ts` would have needed
`PROPERTY_PLACEMENT_SEPARATOR` imported from `treeFlattener.ts`, which already imports
`PropertyHierarchyIndex` back, i.e. a source-level cycle.

Callers migrated, each of which had the node and the placement key already:

| file | site |
|---|---|
| `src/hooks/navigationPane/data/useNavigationPaneTreeSections.ts` | the emitter, now `item.key` |
| `src/hooks/navigationPane/useNavigationPaneTreeInteractions.ts` | `handlePropertyToggle`, `handlePropertyClick`, `handlePropertyNameClick` |
| `src/hooks/useNavigationPaneKeyboard.ts` | the autoExpandNavItems path |

`settings.propertyHierarchyMaxDepth` was added to the two dependency arrays that did not already carry
`settings` whole.

**Flat and key rows are identical by construction.** The wrapper short-circuits on
`node.children.size > 0` before consulting the placement at all, so a key node (whose placement key is
its node id, which the index never holds children for) and a value of a non-hierarchical key (which has
no index entry) are decided exactly as they were. The depth cap can therefore never suppress a key
node's own children, whatever the setting.

## Fix 2: resolvePropertyRevealChain heads at a real root

Signature chosen:

```ts
resolvePropertyRevealChain({ index, keyNodeId, nodeId, maxDepth }): string[] | null
```

A params object, and both new fields required rather than optional, because the two failure modes the
review found are exactly "did not know the roots" and "did not know the cap". `rootIds` is keyed by key
node id, so the key node id has to be passed; `navigateToProperty` already computes it one block above
the call. It stays pure: no tree, no settings, no `App`.

Algorithm: a root returns `[nodeId]` immediately (checked first, since a promoted cycle member is both a
root and somebody's child), otherwise a breadth-first walk upward through `parentIds` that stops only at
a node in `rootIds` for the key, bounded by `maxDepth` edges. Breadth first gives the shallowest chain,
so it is the one most likely to fit under the cap; `parentIds` lists are already sorted by the index, so
the result is deterministic. A visited set means a chain can never repeat a node, which is the same
condition the flattener's child filter enforces. `null` means reveal expands the key alone, which is
what a non-hierarchical value has always done.

`PropertyNavigationEnvironment.propertyHierarchyIndex` became
`propertyHierarchy?: { index; maxDepth }`, one optional object rather than two independently optional
fields, so it is not possible to supply an index without the cap. Both env construction sites in
`src/hooks/useNavigatorReveal.ts` pass `settings.propertyHierarchyMaxDepth` (added to both dependency
arrays). `src/hooks/useTagNavigation.ts` still omits the whole object, which is the ledger's separate
deferred minor, unchanged.

## Fix 3: hierarchical keys filter on `=== true`

`useNavigationPaneTreeSections.ts` now filters `Object.keys(record)` on `record[key] === true`, matching
the service reader and the context menu checkmark.

## Fix 4: subtree selection, and one count function for all four surfaces

The count and the selection now come from the *same walk*, so they cannot disagree:

- `collectSubtreeNotePaths(nodesById, childIds, rootId)`, module-local in `propertyHierarchy.ts`, an
  iterative walk with a visited set. `subtreeCount` is built from it, replacing the recursive `collect`
  that dedup'd per DFS path (a ledger minor) and its `as PropertyTreeNodeId` cast (another).
- `collectPropertyValueSubtreeNotePaths(keyNode, nodeId, index)` exported for the selection path.
- `collectPropertyValueFilePaths(keyNode, valuePath, options?)` in `src/utils/propertyTree.ts` takes
  `{ includeDescendants, hierarchyIndex }`. Without both it returns the value's own notes, byte for byte
  today's behaviour.

Wiring the index to the selection path, `src/services/PropertyTreeService.ts`:

- `updateHierarchyIndex(index)` stores it and drops the file-path cache when the identity changes. It
  deliberately does **not** notify listeners, because it is called during render.
- `src/components/NotebookNavigatorComponent.tsx` calls it during render, on the line after the existing
  latest-ref write, for the same reason that write is not in an effect: the list pane resolves its
  selection through the service in the same render pass, so an effect would leave a hierarchical parent
  listing its own notes until something else re-rendered.
- The value-node branch of `collectFilePaths` had cached `direct` and `withDescendants` as one shared
  array, on the (previously true) assumption that a value node has no descendants. Both kinds now use
  the same mode-keyed path, so the two modes can differ.

Chosen over building a second index in `usePropertyTreeSync`: the pane's index is the one the badge is
computed from, so using it for the list makes agreement structural rather than something two builders
have to keep in step, and it refreshes the instant Hierarchical is toggled.

The remaining two surfaces, plus the tree's own frequency comparator, now call
`createPropertyNoteCountInfo`:

| file | was |
|---|---|
| `src/hooks/navigationPane/useNavigationPaneShortcutDisplay.ts` | `getTotalPropertyNoteCount`, plus a keyNode lookup only that needed |
| `src/utils/fileItemPillDecoration.ts` | `getTotalPropertyNoteCount` in the frequency comparator |
| `src/hooks/navigationPane/data/useNavigationPaneTreeSections.ts` | an `isHierarchical` branch around `subtreeCount` |

For a value of a non-hierarchical key this is a strict no-op: `getTotalPropertyNoteCount` returns the
node's own count despite its name, and `createPropertyNoteCountInfo` with no index entry returns
`{ current, descendants: 0, total: current }`. The `isHierarchical` branch in the comparator became
unnecessary once both arms were the same function. Plumbing: `propertyHierarchyIndex` threaded through
`useNavigationPaneShortcuts` from `NavigationPaneContent` (which already reads it twice), and
`useFileItemPillDecorationState`'s `treeSections` Pick widened by one key.

Not done, and out of scope: `buildFileItemPropertyRainbowColors` still assigns pill colours from a flat
row list, so for a hierarchical key the colour a pill inherits can differ from its nested tree row. That
is a colour question, not a count question.

## Files touched

| file | why |
|---|---|
| `src/utils/treeFlattener.ts` | new placement helpers, flattener uses them |
| `src/utils/propertyHierarchy.ts` | shared subtree walk, reveal chain rewrite, `propertyNodeHasChildren` removed |
| `src/utils/propertyTree.ts` | `collectPropertyValueFilePaths` descendants option |
| `src/utils/propertyNavigation.ts` | `propertyHierarchy` env field, new reveal call |
| `src/utils/fileItemPillDecoration.ts` | frequency by hierarchy-aware count |
| `src/services/PropertyTreeService.ts` | holds the index, per-mode value caching, subtree selection |
| `src/components/NotebookNavigatorComponent.tsx` | pushes the index into the service |
| `src/components/navigationPane/NavigationPaneContent.tsx` | index into the shortcuts hook |
| `src/hooks/useNavigatorReveal.ts` | both reveal envs carry index plus cap |
| `src/hooks/useNavigationPaneKeyboard.ts` | placement-aware children check |
| `src/hooks/useFileItemPillDecorationState.ts` | index into the pill colour builder |
| `src/hooks/navigationPane/useNavigationPaneTreeInteractions.ts` | three placement-aware children checks |
| `src/hooks/navigationPane/useNavigationPaneShortcuts.ts` | index plumbing |
| `src/hooks/navigationPane/useNavigationPaneShortcutDisplay.ts` | shortcut badge count |
| `src/hooks/navigationPane/data/useNavigationPaneTreeSections.ts` | `=== true` filter, placement-aware chevron, one count function |
| `tests/hooks/useNavigationPaneTreeSections.test.ts` | 3 new tests plus a render helper |
| `tests/utils/propertyHierarchy.test.ts` | reveal invariant, depth cap, subtree walk; signature updates |
| `tests/utils/propertyNavigation.test.ts` | reveal round trip; env and index updates |
| `tests/services/PropertyTreeService.test.ts` | badge versus list agreement, both toggle states |

## Tests

Every new test targets a seam between two components, which is where all four defects lived.

| test | file |
|---|---|
| chevron versus flattened rows at the depth cap, plus the general invariant over every emitted row | `tests/hooks/useNavigationPaneTreeSections.test.ts` |
| chevron versus flattened rows for a cycle placement, same invariant | same |
| a key with `{projects: false}` renders flat, and the index stays empty | same |
| the reveal chain's head is in `rootIds`, on the `Root -> A`, `A <-> B` shape | `tests/utils/propertyHierarchy.test.ts` |
| no chain when the target is deeper than the cap | same |
| the subtree walk is the set `subtreeCount` counts, and terminates on a cycle | same |
| reveal round trip: the dispatched payload fed back into the flattener renders the target | `tests/utils/propertyNavigation.test.ts` |
| badge versus list for a hierarchical parent, descendants on and off, plus per-mode caching | `tests/services/PropertyTreeService.test.ts` |
| a value of a non-hierarchical key lists its own notes in both modes | same |

`expectChevronsMatchFlattenedRows` re-renders the hook once per emitted placement with that placement
added to the expansion set, and asserts rows appear if and only if the chevron said they would.

Each new test was verified to fail against the pre-fix code:

- reverting `propertyPlacementHasRenderableChildren` to raw `childIds.length > 0`: exactly the two
  chevron tests fail (`2 failed | 6 passed`).
- reverting `resolvePropertyRevealChain` to the first-parent walk: 4 fail, including the round trip.
- reverting the `=== true` filter alone: exactly the flat-when-false test fails.

## Commands

```
npx tsc -noEmit -skipLibCheck                       -> clean
node node_modules/vitest/vitest.mjs run             -> 179 files, 2196 passed (from 2186)
node node_modules/prettier/bin/prettier.cjs --check $(git diff --name-only)
                                                    -> All matched files use Prettier code style!
node node_modules/eslint/bin/eslint.js "src/**/*.{ts,tsx}" "tests/**/*.{ts,tsx}"
                                                    -> byte-identical per-file counts to the same
                                                       command on a stashed tree: 286 errors, 0
                                                       warnings, all in 10 files none of which this
                                                       wave touches (261 of them in src/main.ts)
```

`npm run lint` itself cannot run in this environment: it invokes bare `eslint`, `node_modules/.bin` is
empty, and the `eslint` on PATH is a Homebrew 8.16.0 that cannot read this repo's flat config. The
local eslint 9.39.5 was invoked directly with the script's own arguments, and measured before and after
so the comparison is exact rather than against a remembered number.

## Vault verification, ~/2027

Markdown files outside `.obsidian` and `.trash`: **159 before, 159 after.** The ledger recorded 158 at
the end of task 6. The extra file is
`Clippings/What happens if an entire class of workers loses faith in their careers (noemamag.com).md`,
born 2026-08-08 05:49:31, which is 40 minutes before this session's first command and 7 minutes after
the clipping task 6 investigated. It is a genuine Obsidian Web Clipper capture: 291KB of article text, a
Hacker News source URL, `tags: ["clippings"]`. Nothing was created or deleted.

```
node scripts/build-styles.mjs && node esbuild.config.mjs production
  -> Built styles.css from 57 files / Validated theming guide against CSS and Style Settings
cp main.js styles.css manifest.json ~/2027/.obsidian/plugins/notebook-navigator/
obsidian plugin:reload id=notebook-navigator      -> exit 0
obsidian dev:errors  -> one pre-existing sync "Error: Disconnected" stamped 21:17:55, from before this
                        session. No plugin errors.
```

Settings confirmed before and after, unchanged: `includeDescendantNotes: true`,
`collapseOtherBranchesOnExpand: false`, `propertyHierarchicalKeys: {"projects": true}`,
`propertyHierarchyMaxDepth: 10`.

Driven through `obsidian dev:cdp method=Runtime.evaluate`.

**Fiddle, descendants on.** Badge reads `5 • 11`, total 16. The list pane's group headers read
`Yesterday (1)` and `Previous 7 days (15)`, so the list holds 16. The service returns 16 paths:

```
Building software.md, Bulwark - (feat) fastmail-token-auth.md, Bulwark.md, Claude Code.md,
Clippings/mdbase-connect.md, Development.md, How I use Agentic Coding.md,
Notebook Navigator - (feat) property-notes.md, Notebook Navigator.md, Obsidian.md, OwnTube.md,
Pocket Casts Sessions.md, Tasks Navigator.md, Tooling.md, macOS.md, obsidian-sidecar.md
```

Badge 16, list 16, service 16. Before this wave the service returned Fiddle's own 5.

Note on how that was counted: only 13 `.nn-file` rows are ever in the DOM, because the list is
virtualized and keeps a fixed window. Selecting the `projects` key row, an untouched code path, renders
the same 13 rows for a list its headers count as 34 (badge `4 • 30`), which is what established that 13
is the render window and not the list length. The group header counts are the list model's own numbers,
and `showGroupHeaderItemCounts` is on in this vault.

**Fiddle, descendants off** (toggled with `notebook-navigator:toggle-descendants`, toggled straight
back): badge `5`, group header `Previous 7 days (5)`, and all five rows rendered:
`Obsidian.md, Tooling.md, Building software.md, Development.md, Clippings/mdbase-connect.md`. The own
notes half is intact.

**Building software:** badge `5`, group header `Previous 7 days (5)`, all five rows rendered:
`Bulwark.md, Bulwark - (feat) fastmail-token-auth.md, OwnTube.md, Pocket Casts Sessions.md,
Tasks Navigator.md`. Its chevron is `nn-navitem-chevron--no-children`, which matches the index: nothing
in this vault carries `projects: [[Bulwark]]`, so the tree is two levels deep here.

**Reveal, fix 2 end to end.** Selected Fiddle, collapsed it with
`notebook-navigator:collapse-expand-selected-item`, confirmed the `Building software` row was gone, then
called `navigateToProperty('key:projects=building software')`. The row reappeared, was selected, and the
list pane header read `Building software`. Reveal re-expanded the ancestor placement rather than a
placement that renders nowhere.

Restored afterwards: selection back to `key:projects=datawerkplaats mooi maasvallei`,
`Datawerkplaats Mooi Maasvallei.md` reopened as the active file, the descendants toggle back on, and the
one inline style used while probing the pane height cleared.

## Concerns for the ledger

- `getTotalPropertyNoteCount` (`src/utils/propertyTree.ts:107`) now has no callers in `src/`. It is still
  exercised by `tests/propertyTreeBuilder.test.ts` as a tree-builder assertion helper. Left in place
  rather than widening this wave into an untouched test file, but its name has always described
  something it does not do.
- Pill rainbow colours still derive from a flat row list, so for a hierarchical key a pill's inherited
  colour can differ from its nested tree row's. Counts agree; colours may not.
- `PropertyTreeService`'s index comes from the render tree, which is the scoped tree when
  `scopePropertiesToCurrentContext` is on, while the service's own tree is global. In that mode the badge
  and the list already disagreed before this wave, for the same reason and for flat keys too. Not made
  worse, not fixed.
- `useTagNavigation`'s `navigateToProperty` still passes no hierarchy at all, so the property-pill
  reveal path expands only the key. Unchanged deferred minor.
