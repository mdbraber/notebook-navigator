# Caveats report, hierarchical property trees

Branch: `property-notes`. Base at start: `72ab443f`.
Suite: 2196 passing before, **2203 passing** after (7 new tests).

## Files touched

| File | Why |
|---|---|
| `src/utils/propertyTree.ts` | Caveat 2a. Deleted `getTotalPropertyNoteCount`, which had zero `src/` callers and a name describing something it never did. |
| `src/utils/treeFlattener.ts` | Caveat 2b. Added `collectExpandablePropertyPlacementKeys` plus the `MAX_EXPANDABLE_PROPERTY_PLACEMENTS` bound, so the depth cap and the cycle filter keep one expression each. |
| `src/hooks/useNavigationActions.ts` | Caveat 2b, both defects. Takes the hierarchy index; expand all enumerates placements; smart collapse preserves the selected value's ancestor placement chain. |
| `src/components/NotebookNavigatorComponent.tsx` | Passes its existing `propertyHierarchyIndexRef` into the hook. |
| `src/components/navigationPane/NavigationPaneContent.tsx` | Derives a latest-ref from `props.navigationTreeSections.propertyHierarchyIndex` and forwards it to the toolbar and the layout. |
| `src/components/navigationPane/NavigationPaneLayout.tsx` | Forwards the ref to the header. |
| `src/components/NavigationPaneHeader.tsx` | Accepts the ref, passes it to the hook. |
| `src/components/NavigationToolbar.tsx` | Accepts the ref, passes it to the hook. |
| `tests/propertyTreeBuilder.test.ts` | Caveat 2a. Five assertions rewritten off the deleted function. |
| `tests/hooks/useNavigationActions.test.ts` | Caveat 2b. Five new tests, two existing ones updated for the renamed collapse field. |
| `tests/hooks/useListPaneData.test.ts` | Caveat 1. New file, two tests covering the toggle transition in both directions. |
| `.superpowers/design-docs/2026-08-07-hierarchical-property-tree-design.md` | Caveat 3. Three amendments plus two consequential corrections. |
| `.superpowers/sdd/2026-08-07-hierarchical-property-tree/progress.md` | Ledger entries for this pass. |

## Caveat 1: the toggle-transition seam

`tests/hooks/useListPaneData.test.ts` renders `useListPaneData` with a hierarchical property value
selected, and flips `settings.propertyHierarchicalKeys` between renders. Each pass mirrors
`NotebookNavigatorComponent`: the index for the current settings is written onto `propertyTreeService`
during render, and the badge is read from that same index through `createPropertyNoteCountInfo`. The
fixture gives Fiddle 2 own notes and 4 in its subtree, so flat and hierarchical differ.

Both settings objects share every other field **by reference**, so a recompute of `baseFiles` can only
come from the one dependency under test.

### The harness, and why it is unusual

The repo has no jsdom, no `@testing-library/react` and no `react-test-renderer`, so there is no way to
re-render a hook with its memo caches intact: a second `renderToStaticMarkup` call is a new component
instance and rebuilds every memo, which would make the dependency array unobservable.

The test instead uses a **render-phase state update**: the probe component calls its own `setState`
during render, so React re-invokes it on the same fiber and `useMemo` dependency comparison is real.
This was verified empirically against `react-dom/server` before the test was written (a memo on a
stable dep ran once across both passes; a memo on a changing dep recomputed).

### Verification that it fails without the fix

Removed `settings.propertyHierarchicalKeys` from the `baseFiles` dependency array at
`src/hooks/useListPaneData.ts:275`:

```
 FAIL  tests/hooks/useListPaneData.test.ts > ... when a key is marked hierarchical
-     "list": 4,
+     "list": 2,
 FAIL  tests/hooks/useListPaneData.test.ts > ... when a key stops being hierarchical
-     "list": 2,
+     "list": 4,

 Test Files  1 failed (1)
      Tests  2 failed (2)
```

Badge 4 against list 2 marking hierarchical, badge 2 against list 4 unmarking: exactly the
badge-versus-list disagreement the feature exists to remove. The dependency entry was restored and
both tests pass again.

## Caveat 2a: `getTotalPropertyNoteCount` deleted

Deleted from `src/utils/propertyTree.ts`. The five assertions now call a local
`ownNoteCountForValue(keyNode, valuePath)` in `tests/propertyTreeBuilder.test.ts`, which is
`keyNode.children.get(buildPropertyValueNodeId(keyNode.key, valuePath))?.notesWithValue.size ?? 0`.
Every expected value is unchanged:

| Line (new) | Assertion | Checks |
|---|---|---|
| 503 | `ownNoteCountForValue(keyNode, 'work')` is 1 | `Work` carries `notes/c.md` only, so a parent value path does not absorb its children. |
| 504 | `ownNoteCountForValue(keyNode, 'work/done')` is 2 | Two notes carry `Work/Done`, one of them alongside a boolean value. |
| 505 | `ownNoteCountForValue(keyNode, 'true')` is 1 | A boolean literal gets its own value node with its own count. |
| 543 | `ownNoteCountForValue(keyNode, 'work')` is 0 | No `Work` value node exists when only `Work/Done` and `Work/Blocked` do. |
| 557 | same, after inserting a `Work/Started` node by hand | Adding a deeper value node still does not create or credit a `Work` node. |

The design doc's two mentions of the function are annotated ("since deleted", and one present tense
changed to past) rather than deleted, because both describe the code as it was before this feature.

## Caveat 2b: `useNavigationActions` made hierarchy-aware

### How the index was threaded

The brief's route, `props.navigationTreeSections`, works for two of the three call sites but not the
third:

- `NavigationToolbar` and `NavigationPaneHeader` both descend from `NavigationPaneContent`, which has
  `props.navigationTreeSections`.
- `NotebookNavigatorComponent` calls `useNavigationActions()` at line 542 while
  `navigationTreeSections` is computed at line 1482. `handleExpandCollapseAll` is captured into the
  command object earlier still, so the hook call cannot move. That file already carries
  `propertyHierarchyIndexRef` (declared line 289, written during render at line 1495) for exactly this
  ordering, with a comment saying so, because `useNavigatorReveal` has the same problem.

So the hook takes `{ propertyHierarchyIndexRef: { readonly current: PropertyHierarchyIndex } }`, the
same shape `useNavigatorReveal` already accepts. `NotebookNavigatorComponent` passes the ref it
already has; `NavigationPaneContent` derives one from
`props.navigationTreeSections.propertyHierarchyIndex` during render and forwards it to the toolbar and
through `NavigationPaneLayout` to the header. One shape for all three entry points, so the toolbar
button, the header button and the command cannot disagree. The depth cap comes from
`settings.propertyHierarchyMaxDepth` inside the hook, paired with the index by a small
`readPropertyHierarchy()` that both handlers call, so an index can never arrive without its cap.

### Expand all

The inline `collectExpandablePropertyNodeIds` closure became an exported pure helper,
`collectExpandablePropertyExpansionKeys(propertyTree, hierarchy)`. A key with no `rootIds` entry, which
is every non-hierarchical key and every key when the index is empty, takes the original walk verbatim.
A hierarchical key contributes its key node id plus `collectExpandablePropertyPlacementKeys`.

That enumerator lives in `treeFlattener.ts` rather than in the hook. The brief named
`isPropertyPlacementAtDepthCap` and `resolveRenderablePropertyChildIds` as exports of that module; they
are in fact private. Exporting the enumeration instead of widening those two keeps the depth cap and
the cycle filter to one expression each, which is what the Task 6 minor about placement-key knowledge
spreading warns about. A placement is emitted only when its parent chain was, so the returned set is
always self-consistent, and leaf placements are left out, matching what the flat loop always did with
childless value nodes.

**New bound.** Placement enumeration is the one bulk path that walks placements without a user
expanding each row, so the dropped placement cap's "unreachable" argument does not cover it: a dense
DAG has exponentially many simple paths, and an unbounded walk would also write an unbounded set to
localStorage. `MAX_EXPANDABLE_PROPERTY_PLACEMENTS = 1000` bounds both. The measured worst case in the
author's vault is 27 placements. It truncates silently, for the same reason the depth cap does.

### Smart collapse

`getSelectedPropertyKeyNodeId` (one id) became `buildSelectedPropertyParentKeys` (the key node id plus
the selected value's ancestor placement keys), and `buildCollapsedExpansionState`'s
`selectedPropertyKeyNodeId` became `selectedPropertyParentKeys: Iterable<string>`, matching
`selectedFolderParentPaths` and `selectedTagParentPaths`. The chain comes from
`resolvePropertyRevealChain`, the same resolver auto-reveal uses, so both agree on which placement of a
multi-parent value to keep open. No chain, no hierarchy, or a key-node selection all return exactly
today's answer. Two existing tests were updated for the renamed field.

### Verification that the new tests fail against the defects

Reverting both helper bodies to their pre-fix logic, signatures unchanged:

```
 ❯ tests/hooks/useNavigationActions.test.ts (13 tests | 3 failed)
     × expands every nested placement of a hierarchical key
     × stops expanding placements at the hierarchy depth cap
     × keeps a selected nested property value visible through smart collapse
```

Exactly the three behaviour tests fail; the two guard tests asserting that a non-hierarchical key is
unaffected keep passing, which is the point of them.

Separately, removing only the depth-cap check from the enumerator:

```
 ❯ tests/hooks/useNavigationActions.test.ts (13 tests | 1 failed)
     × stops expanding placements at the hierarchy depth cap
```

so the cap test pins the cap rather than only the nesting.

## Caveat 3: spec amendments

1. **The placement cap was dropped, not built.** The Settings section now says so, with the reason:
   the flattener only descends into a placement the user has expanded, and expansion is keyed per
   placement, so exponentially many placements would take exponentially many hand expansions. It then
   records that expand all, added in this pass, is the one bulk path that enumerates placements and
   therefore carries the bound itself as `MAX_EXPANDABLE_PROPERTY_PLACEMENTS`. Re-examined as the
   brief asked: the "unreachable" reasoning still holds for rendering, but it no longer covers bulk
   expansion, which is why the bound sits there.
2. **Depth-cap truncation is silent by design.** The edge-case table row now says so, with the reason:
   the flattener runs during render, so logging every pass would spam the console for as long as the
   data stays deep.
3. **Auto-reveal is a parent walk, not "the first placement".** The decisions table row and the
   Auto-reveal section now describe `resolvePropertyRevealChain` walking `parentIds` breadth first to a
   node in `rootIds` and expanding every prefix, with the reason the original approach could not work:
   the flattener only records a placement it emitted, and only recurses into placements already
   expanded, so a node is in that map exactly when no expansion is needed.

Two consequential corrections, since the amendments made them visibly false: the flattener section no
longer promises a `firstPlacementByNodeId` return value (it was removed), and the test-list bullet
asserting that map is stable across rebuilds was replaced with the reveal-chain property.

## Commands and output

```
$ npx tsc -noEmit -skipLibCheck
(no output)

$ node node_modules/prettier/bin/prettier.cjs --write <touched files>
all files formatted or unchanged

$ node node_modules/eslint/bin/eslint.js <touched files>
(no output)

$ node node_modules/eslint/bin/eslint.js tests/ src/
312 problems (293 errors, 19 warnings)      # identical at HEAD 72ab443f, none in a touched file

$ node node_modules/vitest/vitest.mjs run
 Test Files  180 passed (180)
      Tests  2203 passed (2203)

$ node scripts/build-styles.mjs && node esbuild.config.mjs production
Built styles.css from 57 files
Validated theming guide against CSS and Style Settings

$ cp main.js styles.css manifest.json ~/2027/.obsidian/plugins/notebook-navigator/
$ obsidian plugin:reload id=notebook-navigator
$ obsidian dev:errors
No errors captured.
```

`tsc` still covers only `src/**`, so `tests/` was linted explicitly, as the brief requires.

## Vault verification

```
$ cd ~/2027 && find . -name "*.md" -not -path "./.obsidian/*" -not -path "./.trash/*" | wc -l
     160        # before

... verification below ...

$ cd ~/2027 && find . -name "*.md" -not -path "./.obsidian/*" -not -path "./.trash/*" | wc -l
     160        # after
```

**160 before, 160 after. Nothing created, nothing deleted.** The brief said 159. The extra file is
`Clippings/Taste Is All That's Left.md`, born 2026-08-08 07:08:08, which is before this session's first
command: 16KB of article text from `notashelf.dev`, a `source` URL, an `[[Source]]` author wikilink and
`categories: "[[Clippings]]"`, the same shape as the two genuine Web Clipper captures the ledger
already records. Third such arrival during this feature's work. Not deleted.

Settings confirmed unchanged at the end, matching the brief's stated vault configuration:

```
$ node -e "...data.json..."
{"propertyHierarchicalKeys":{"projects":true},"propertyHierarchyMaxDepth":10,
 "collapseOtherBranchesOnExpand":false,"smartCollapse":true}
```

### Expand all now nests `projects` fully

Starting from an empty property expansion set with a folder selected, so smart collapse leaves nothing
behind, then running the command:

```
$ obsidian command id=notebook-navigator:collapse-expand      # collapse
after collapse: []

$ obsidian command id=notebook-navigator:collapse-expand      # expand all
total=11
projects=["key:projects","key:projects=fiddle","key:projects=work",
          "key:projects=work key:projects=clients"]
nestedCount=1
```

Before this pass the `projects` entry would have been `key:projects` alone. The other seven keys are
the non-hierarchical property keys (`categories`, `contexts`, `locations`, `references`, `roles`,
`status`, `topics`), unchanged.

Those four keys render the whole tree, levels 0 to 3, so none of them names a row that renders
nowhere:

```
0 | projects4 • 30
1 | Fiddle5 • 11
2 | Building software5
2 | Development2
2 | Obsidian3
2 | Tooling1
1 | Personal1
1 | Systems2
1 | Tools2
1 | Work2 • 7
2 | Clients1 • 3
3 | Datawerkplaats Mooi Maasvallei3
2 | Datawerkplaats.net3
```

The navigation pane is virtualised, so a DOM row list is only the viewport. This full listing was
obtained by narrowing the persisted set to the four `projects` keys and reloading, not by reading one
long DOM dump. `categories`, which is not marked Hierarchical, renders its 18 values flat at level 1
when expanded, unchanged.

### Collapsing with a nested value selected keeps it visible

With the depth-3 value `Datawerkplaats Mooi Maasvallei` selected (`nn-selected`, `data-level="3"`):

```
$ obsidian command id=notebook-navigator:collapse-expand
store=["key:projects","key:projects=work","key:projects=work key:projects=clients"]
selectedStillRendered=true @level 3
```

Smart collapse kept exactly the selected value's ancestor placement chain. `Fiddle`'s subtree
collapsed, as it should. Before this pass only `key:projects` would have survived and the selected row
would have disappeared from the pane.

`obsidian dev:errors` was clean across three plugin reloads, and `dev:console level=warn` captured
nothing.

### State restored

The property expansion set was restored to its original value,
`["key:projects","key:projects=work","key:projects=work key:projects=clients","key:projects=fiddle"]`,
and the temporary probe key removed. One honest residual: pressing Collapse / expand all during
verification also changed folder and tag expansion, which was not snapshotted beforehand, so those are
left as two presses of that button left them. No setting in `data.json` was changed.

## Commit

Work commit: **`dcb60dd9`** (`fix: close the four hierarchical property tree caveats`), on branch
`property-notes` over base `72ab443f`. This report is committed on top of it, so that the SHA above can
be accurate rather than pointing at a commit an amend would have replaced.
