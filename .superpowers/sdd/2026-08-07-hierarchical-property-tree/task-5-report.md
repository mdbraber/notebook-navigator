# Task 5 report: expansion and auto-reveal by placement

Status: DONE. Took over the prior attempt's uncommitted working tree, kept what was correct, and fixed
the three Criticals, both Importants and the Minor from the review, following
`task-5-resolutions-addendum.md` wherever it superseded the earlier resolutions.

## Files touched and why

### `src/utils/propertyHierarchy.ts`

- `PropertyHierarchyIndex` gains a fourth field, `parentIds: ReadonlyMap<string, readonly string[]>`.
  `buildPropertyHierarchyIndex` already computed `parentsById` internally and discarded it; it is now
  exposed, sorted the same way `rootIds` and `childIds` are, so the walk below cannot depend on the order
  notes happened to be scanned in. Every value node of a hierarchical key gets an entry, empty for a
  root, which is what lets the walk distinguish an unknown node from a root.
- `EMPTY_PROPERTY_HIERARCHY_INDEX` carries the new field.
- New `resolvePropertyRevealChain` (Critical 2). Shape:

  ```ts
  export function resolvePropertyRevealChain(index: PropertyHierarchyIndex, nodeId: string): string[] | null {
      if (!index.parentIds.has(nodeId)) {
          return null;
      }
      const chain = [nodeId];
      const seen = new Set([nodeId]);
      for (;;) {
          const parentId = index.parentIds.get(chain[0])?.[0];
          if (parentId === undefined || seen.has(parentId)) {
              return chain;
          }
          chain.unshift(parentId);
          seen.add(parentId);
      }
  }
  ```

  It returns the chain of value node ids from a root down to the target, or null when the node is
  unknown. It takes the first parent at each step and stops on a node already in the chain, so a cycle
  terminates. It is deliberately independent of expansion state, which is the whole point:
  `firstPlacementByNodeId` is populated only for placements the flattener emitted, and the flattener
  recurses into a placement's children only when that placement is expanded, so a node appears in that
  map precisely when its row is already on screen, which is exactly when no ancestor expansion is
  needed.
- `propertyNodeHasChildren` was already added by the prior attempt and is kept unchanged.

### `src/utils/treeFlattener.ts`

- `PROPERTY_PLACEMENT_SEPARATOR` is now exported, so the cleanup predicate uses the one definition
  rather than a second NUL literal.
- `getPropertyPlacementAncestorKeys` changed from `(nodeId, firstPlacementByNodeId)` to
  `(chain: readonly string[])`. It returns every prefix of the chain except the chain itself, in
  root-to-parent order. A single-element chain yields nothing, which is what preserves today's key-only
  expansion for root placements and non-hierarchical values.

### `src/utils/propertyNavigation.ts`

- `PropertyNavigationEnvironment.firstPlacementByNodeId` replaced by
  `propertyHierarchyIndex?: PropertyHierarchyIndex`. Still optional, so callers with no navigation-pane
  render behave exactly as before the index existed.
- Reveal now resolves the chain through `resolvePropertyRevealChain` and expands its prefixes.
- Critical 3: the needs-expansion guard is restored on the tag precedent
  (`tagNavigation.ts:114-125`). The **full** list is always built, including the key node id whenever
  there is one, and the dispatch happens only when something in the list is not already expanded:

  ```ts
  const idsToExpand = [...(hasOwnKeyNode && keyNodeId ? [keyNodeId] : []), ...ancestorPlacementKeys];
  const needsExpansion = idsToExpand.some(id => !env.expandedProperties.has(id));
  if (needsExpansion) { expandNavigationTreeItems({ ... }); }
  ```

  Both halves matter. With `collapseOtherBranchesOnExpand` on, `buildExpandItemsAction` dispatches
  `SET_EXPANDED_PROPERTIES` with a **replacement** set, so omitting the already-expanded key collapsed
  the whole property. And `EXPAND_PROPERTIES` always allocates a new Set, so a redundant dispatch is a
  state change that can re-run the effects `revealProperty` is a dependency of, with a localStorage
  write per pass.

### `src/context/ExpansionContext.tsx`

Critical 1. `filterExpandedSet` now takes a predicate instead of a whitelist Set; the folder and tag
cleanups pass `value => set.has(value)`, so they are byte-for-byte equivalent to before.

The cleanup predicate used:

```ts
function isExpandedPropertyEntryValid(entry: string, existingPropertyNodeIds: Set<string>): boolean {
    if (!entry.includes(PROPERTY_PLACEMENT_SEPARATOR)) {
        return existingPropertyNodeIds.has(entry);
    }
    return entry.split(PROPERTY_PLACEMENT_SEPARATOR).every(segment => existingPropertyNodeIds.has(segment));
}
```

A single-segment entry, meaning a key node, a root placement, or any flat property value, reduces to the
plain membership test the reducer always did, so folders, tags and non-hierarchical properties are
untouched. A multi-segment placement key is valid only when every value in its chain still exists, so a
placement whose ancestor was deleted is still correctly purged. NUL-containing keys are deliberately
**not** exempted from the filter, which would have leaked stale keys forever.

The predicate lives beside the `CLEANUP_DELETED_PROPERTIES` case rather than at the dispatch site so the
action keeps carrying a plain `Set<string>` whitelist, which meant no churn for existing callers or
tests, and no function in a reducer action. `expansionReducer` and `ExpansionState` are now exported for
testing, matching the `uiStateReducer` precedent in `UIStateContext.tsx`.

The action union also gained a comment saying `existingPropertyNodeIds` stays a whitelist of node ids and
that placement keys are validated per chain segment. `TOGGLE_PROPERTY_EXPANDED` and `EXPAND_PROPERTIES`
keep their payload field names and the prior attempt's comments.

### `src/utils/navigationExpansion.ts`

Important 1. `getNavigationExpansionTargetForItem` no longer shares one branch between `PROPERTY_KEY` and
`PROPERTY_VALUE`. The value branch now uses:

- `id: item.key`, the placement key, so the target names the row the user is on rather than every
  placement of the same value. Equal to the node id for a root placement or a flat value.
- `hasChildren: item.hasChildren ?? item.data.children.size > 0`. The old
  `item.data.children.size > 0` was always false for a hierarchical value, which is why the prior
  attempt's keyboard fix changed behaviour in zero cases. The `??` fallback is what keeps a flat value,
  which never carries the flag, on the exact check this site always used.
- `supportsBranchCollapse: item.key === item.data.id`, a new optional field on
  `NavigationExpansionTarget`. `toggleNavigationExpansionTarget` now skips branch replacement when it is
  false. This was necessary rather than optional: with `hasChildren` fixed, a nested placement plus
  `collapseOtherBranchesOnExpand` would have dispatched `SET_EXPANDED_PROPERTIES` with node-id
  ancestors, dropping the intermediate placements and collapsing the row it had just expanded. It is the
  same `placementKey === nodeId` guard `handlePropertyToggle` already uses, so per-placement
  collapse-others stays Task 6.

### `src/hooks/useNavigationPaneKeyboard.ts`

The already-expanded check now tests the placement key rather than the node id, and the comment that
asserted the opposite of what the code did is replaced with one describing the target's placement key and
its branch-collapse guard.

### `src/hooks/navigationPane/useNavigationPaneTreeInteractions.ts`

Important 2. `handlePropertyClick` and `handlePropertyNameClick` take a `placementKey` parameter. Both use
it for their `expandedProperties.has(...)` checks and pass it to `handlePropertyToggle`. Left as they
were, a nested click wrote a bare node id into the persisted set and, for a promoted cycle root, toggled
a different row than the one clicked. The three now-obsolete "only propertyNode is known here" comments
are gone. `handlePropertyToggleAllSiblings` still passes the node id twice, which is correct because
`TOGGLE_DESCENDANT_PROPERTIES` only ever deals in node ids; its comment says so.

### `src/components/navigationPane/NavigationPaneTreeRow.tsx`

`onClick` and `onNameClick` now thread `item.key`, alongside the `onToggle` the prior attempt already
fixed.

### `src/components/NotebookNavigatorComponent.tsx`, `src/hooks/useNavigatorReveal.ts`

The prior attempt's latest-ref plumbing is kept, with the payload swapped from
`firstPlacementByNodeId` to the hierarchy index: `firstPlacementByNodeIdRef` becomes
`propertyHierarchyIndexRef`, seeded with `EMPTY_PROPERTY_HIERARCHY_INDEX`, still written during render so
it is current before any handler could run, and both `revealProperty` and `navigateToProperty` pass
`propertyHierarchyIndex` into the environment.

### `src/hooks/navigationPane/data/useNavigationPaneTreeSections.ts`

No behaviour change. The doc comment on the result's `firstPlacementByNodeId` now records that reveal
does not read it and why, so the next reader does not mistake it for load-bearing. It is left in place
because it describes what was rendered, which is what a scroll or highlight lookup needs; it is Task 4's
interface and removing it was out of scope.

### `src/components/navigationPane/NavigationPaneContent.tsx`

Unchanged from the prior attempt: the `isExpanded` split so `PROPERTY_VALUE` tests `item.key`, and
`propertyHierarchyIndex` threaded into the interactions and keyboard hooks. The cleanup effect itself
needed no change once the reducer predicate was fixed.

## Tests added

All five items from the addendum's "Required tests", plus parity coverage.

`tests/context/ExpansionContext.test.ts` (new, 4 tests): a nested placement key whose whole chain exists
survives `CLEANUP_DELETED_PROPERTIES` and the reducer returns the same state object; a placement whose
ancestor was deleted is purged; a placement whose own target was deleted is purged; a plain node id that
no longer exists is still purged.

`tests/utils/propertyHierarchy.test.ts` (+5): `parentIds` is recorded for every value and empty for a
root; `resolvePropertyRevealChain` resolves a three-deep root-to-target chain with nothing expanded,
returns a single-element chain for a root, returns null for an unknown node and for the empty index, and
terminates on a two-node cycle with a head that the index really does promote to a root.

`tests/utils/propertyNavigation.test.ts` (rewritten hierarchical block, 5 tests): ancestor placements are
expanded alongside the key; only the key for a root placement; only the key when no index is supplied;
with `collapseOtherBranchesOnExpand: true` the replacement set still contains the key node id; no
dispatch at all when every id is already expanded.

`tests/utils/navigationExpansion.test.ts` (+4): the exact two-call sequence the keyboard paths perform,
asserting the resulting dispatch rather than that a guard was reached. A nested placement expands by its
placement key; with branch collapse on it still takes the plain toggle; a root placement still gets
branch replacement; a flat value with no flag and no child nodes reports no children and dispatches
nothing.

`tests/utils/treeFlattener.test.ts`: the `getPropertyPlacementAncestorKeys` block updated for the
chain-based signature; the third test, which only covered the now-removed map fallback, folded into the
single-element case.

`tests/hooks/useNavigationPaneTreeInteractions.test.ts`: the two property-row helpers pass the placement
key.

`tests/hooks/useNavigationPaneTreeSections.test.ts`: Minor fixed. The two real `TS2339` eslint errors at
`:586` and `:684` came from reading `item.level` off a `CombinedNavigationItem`, which `RootSpacerItem`
does not have. Both sites now go through one `describePropertyItems` helper that narrows on `item.type`
first, the way the existing assertion did.

## Commands and output

```
$ npx tsc -noEmit -skipLibCheck
(clean, no output)

$ node node_modules/vitest/vitest.mjs run
 Test Files  179 passed (179)
      Tests  2181 passed (2181)
   Start at  23:04:48
   Duration  5.97s (transform 8.05s, setup 1.20s, import 27.31s, tests 3.78s, environment 13ms)

$ node node_modules/prettier/bin/prettier.cjs --check "src/**/*.ts" "src/**/*.tsx" "tests/**/*.ts"
Checking formatting...
All matched files use Prettier code style!

$ node node_modules/eslint/bin/eslint.js src/hooks src/components src/utils src/settings src/context
/Users/mdbraber/src/notebook-navigator/src/components/calendar/CalendarGrid.tsx
  38:15  error  Unsafe assignment of an `any` value                                     @typescript-eslint/no-unsafe-assignment
  40:38  error  Unsafe argument of type `any` assigned to a parameter of type `string`  @typescript-eslint/no-unsafe-argument

/Users/mdbraber/src/notebook-navigator/src/hooks/useManualSortKeyboard.ts
  117:29  error  Unsafe member access .dataset on an `any` value  @typescript-eslint/no-unsafe-member-access
  118:21  error  Unsafe assignment of an `any` value              @typescript-eslint/no-unsafe-assignment

/Users/mdbraber/src/notebook-navigator/src/utils/dateUtils.ts
  101:19  error  Unsafe assignment of an `any` value                                     @typescript-eslint/no-unsafe-assignment
  103:46  error  Unsafe argument of type `any` assigned to a parameter of type `string`  @typescript-eslint/no-unsafe-argument

✖ 6 problems (6 errors, 0 warnings)

$ node node_modules/eslint/bin/eslint.js tests/hooks tests/context tests/utils
/Users/mdbraber/src/notebook-navigator/tests/utils/propertyNotes.test.ts
  281:15  error  Unsafe assignment of an `any` value     @typescript-eslint/no-unsafe-assignment
  283:13  error  Unsafe return of a value of type `any`  @typescript-eslint/no-unsafe-return
  283:87  error  Unsafe call of an `any` typed value     @typescript-eslint/no-unsafe-call

✖ 3 problems (3 errors, 0 warnings)
```

All nine remaining eslint errors are pre-existing, in four files this task does not touch
(`CalendarGrid.tsx`, `useManualSortKeyboard.ts`, `dateUtils.ts`, `propertyNotes.test.ts`). The two errors
in `useNavigationPaneTreeSections.test.ts` that the review flagged are gone.

Suite count: 2166 in the dirty tree I inherited, 2181 now. Net +15: 18 added, 3 removed (one obsolete
`getPropertyPlacementAncestorKeys` map-fallback test folded into another, and two `firstPlacementByNodeId`
reveal tests replaced by five index-based ones).

## Vault transcript

Built and deployed:

```
$ node scripts/build-styles.mjs && node esbuild.config.mjs production
Built styles.css from 57 files
Validated theming guide against CSS and Style Settings

$ cp main.js styles.css manifest.json ~/2027/.obsidian/plugins/notebook-navigator/
$ obsidian plugin:reload id=notebook-navigator
$ obsidian dev:errors
21:17:55 Error: Disconnected     <- pre-existing Obsidian Sync error from before the reload
```

`dev:errors` reported nothing new at any point in the session. Only that one 21:17:55 Obsidian Sync
"Disconnected" entry, which predates the 22:52 reload. Starting settings: `propertyHierarchicalKeys:
{projects: true}`, `collapseOtherBranchesOnExpand: false`, `autoExpandNavItems: false`,
`scopePropertiesToCurrentContext: false`, `propertyHierarchyMaxDepth: 10`. Persisted expansion:
`["key:projects","key:projects=fiddle","key:projects=work","key:projects=clients","key:status"]`. Note
`key:projects=clients` is a bare node id, which is a root-placement key, and Clients is not a root, so it
rendered nowhere. That is the exact residue the pre-fix code left behind.

Rows were read by DOM query and expansion was driven by clicking real chevrons through
`element.click()`, so every observation went through the React handlers under test.

### 1. Expanding a level-2 row, and it staying visible (Critical 1)

Before, the `projects` subtree with Fiddle and Work already expanded:

```
0 | projects           exp=true
1 | Fiddle             exp=true
2 |   Building software
2 |   Development
2 |   Obsidian
2 |   Tooling
1 | Personal
1 | Systems
1 | Tools
1 | Work               exp=true
2 |   Clients          exp=false   <- has a chevron, collapsed
2 |   Datawerkplaats.net
```

Clicked the chevron on the level-2 `Clients` row:

```
1 | Work                                exp=true
2 |   Clients                           exp=true
3 |     Datawerkplaats Mooi Maasvallei             <- APPEARED at level 3
2 |   Datawerkplaats.net
```

Persisted set gained `key:projects=work key:projects=clients`.

It stayed visible. Re-read immediately, re-read again after the cleanup effect had run (the effect
depends on `expandedProperties.size`, which had just changed, so it did run), and re-read after opening a
file to force further renders. `Datawerkplaats Mooi Maasvallei` was present at level 3 every time, and
the NUL-containing key was still in the persisted set each time. This is the exact failure the review
described and it no longer happens.

Startup half: after a full `plugin:reload`, the persisted
`key:projects=work >> key:projects=clients` was still there and the level-3 row still rendered, so nested
keys are no longer purged on the first cleanup pass.

Exactly which rows appeared: one, `Datawerkplaats Mooi Maasvallei`, at level 3 under
`Work > Clients`. Nothing expected was missing; `Clients` has exactly one child in this vault.

### 2. Multi-parent placements expanding independently

`categories` marked Hierarchical via
`metadataService.setPropertyHierarchicalKey('categories')`. Expanding the key and then `Categories`:

```
0 | categories     exp=true
1 | Categories     exp=true
2 |   Areas        exp=false
2 |   Clients      exp=null    <- no chevron
2 |   Clippings, Companies, Contexts, Guides, Locations, People,
2 |   Projects, References, Roles, Software, Status, TIL, Topics
1 | Notes
```

Expanding `Areas`, then `Topics`:

```
2 |   Areas        exp=true
3 |     Clients                  <- Clients under Areas
2 |   Clients                    <- Clients under Categories, a separate row
...
2 |   Topics       exp=true
3 |     Software               <- Software under Topics
2 |   Software                 <- Software under Categories, a separate row
```

So both multi-parent values do render as two independent placements, matching the addendum's
description of the vault.

I could not demonstrate independent *expansion* with the vault as it stood, and I want to be explicit
about that rather than claim a match I did not see. I enumerated the whole DAG for both keys and no value
had two or more parents **and** one or more children:

```
categories | Clients | p=2 c=0        projects | Clients   | p=1 c=1
categories | Software | p=2 c=0       projects | Fiddle    | p=0 c=4
categories | Areas | p=1 c=1          projects | Work      | p=0 c=2
categories | Categories | p=0 c=15    (full listing in session)
```

`categories | Clients` has two parents but nothing to expand into. So I gave it a child with two
temporary notes, `nn-t5-leaf.md` carrying `categories: [[Clients]]` and `nn-t5-holder.md` carrying
`categories: [[nn-t5-leaf]]`, which made `categories | Clients` `p=2 c=1`. Both placements then showed a
chevron and both were collapsed:

```
2 |   Areas        exp=true
3 |     Clients    exp=false
2 |   Clients      exp=false
```

Clicked the chevron on the level-3 `Clients`, the Areas placement, only:

```
2 |   Areas        exp=true
3 |     Clients    exp=true
4 |       nn-t5-leaf              <- child rendered under the Areas placement
2 |   Clients      exp=false      <- Categories placement STAYED COLLAPSED, no child
```

Then expanded the Categories placement too, and both stayed open with their own child:

```
3 |     Clients    exp=true
4 |       nn-t5-leaf
2 |   Clients      exp=true
3 |     nn-t5-leaf
```

Then collapsed the Areas placement only, and the Categories one stayed open:

```
3 |     Clients    exp=false
2 |   Clients      exp=true
3 |     nn-t5-leaf
```

Independent in both directions. Persisted keys at that point, separator rendered as `>>`:

```
key:categories
key:categories=categories
key:categories=categories >> key:categories=areas
key:categories=categories >> key:categories=topics
key:categories=categories >> key:categories=areas >> key:categories=clients
```

### 3. Reveal expanding ancestors (Critical 2)

Collapsed the whole `projects` branch through the UI so the persisted set held neither
`key:projects=work` nor the `work >> clients` placement, then expanded and selected the `projects` key so
the reveal had a property context to work in. `Work` was collapsed, `Datawerkplaats Mooi Maasvallei` was
not rendered. Then:

```
$ obsidian eval code="app.plugins.plugins['notebook-navigator'].api.navigation
    .navigateToProperty('key:projects=datawerkplaats mooi maasvallei')"
=> result=true

0 | projects                             exp=true
1 | Work                                 exp=true      <- expanded by the reveal
2 |   Clients                            exp=true      <- expanded by the reveal
3 |     Datawerkplaats Mooi Maasvallei   [SELECTED]
```

Persisted set gained both `key:projects=work` and `key:projects=work >> key:projects=clients`. Before
this fix the reveal took the `?? nodeId` fallback and expanded nothing beyond the key.

One thing worth recording, because it looks like a failure and is not. Opening the note from outside the
navigator does **not** walk the chain. That path is `revealFileInNearestFolder`, which deliberately keeps
the currently visible context: `useNavigatorReveal.ts:680` retargets to the key node when the key is
collapsed, and it dispatches `REVEAL_FILE` with a `targetProperty` rather than calling
`navigateToProperty` at all. That is pre-existing auto-reveal behaviour that Task 5 does not touch, so I
exercised the chain through the explicit path the task actually changed. The deferred
`useTagNavigation.ts:94-118` item is related and stays deferred.

### 4. Reveal with collapse-other-branches on (Critical 3)

Collapsed `Work` again, set `collapseOtherBranchesOnExpand: true`, and repeated the reveal:

```
=> result=true

0 | categories                           exp=false
0 | projects                             exp=true      <- key still expanded
1 | Fiddle                               exp=false
1 | Work                                 exp=true
2 |   Clients                            exp=true
3 |     Datawerkplaats Mooi Maasvallei   [SELECTED]
0 | status                               exp=false
```

Persisted set became exactly
`["key:projects", "key:projects=work", "key:projects=work >> key:projects=clients"]`. The key node id
survived the replacement set, so the property did not collapse and the target row is visible. Other
branches collapsed, which is what the setting is for.

### Cleanup

The vault was returned to its starting state: both temporary notes deleted,
`collapseOtherBranchesOnExpand` back to false, `categories` removed from `propertyHierarchicalKeys`
(`{projects: true}` again), and the persisted expansion back to the original five entries with the
level-2 `Clients` row collapsed through the UI so the in-memory state matched. Final row listing matched
the session's opening listing exactly. `dev:errors` still showed only the pre-existing 21:17:55 entry.

## Concerns

- **`firstPlacementByNodeId` now has no consumer.** It is still produced by `flattenPropertyHierarchy`
  and surfaced on the tree sections result, with Task 4 tests covering it, but nothing reads it after
  Correction 2. I left it, documented why, and flag it as a candidate for removal rather than deleting
  Task 4's interface and tests from inside Task 5.
- **Keyboard expansion of a nested placement now works, but not with collapse-other-branches.** Fixing
  `hasChildren` made the keyboard path live for hierarchical values for the first time, which forced a
  decision about branch replacement. `supportsBranchCollapse` sends nested placements down the plain
  toggle. That is the correct Task 6 boundary, but it means the setting silently does not apply to nested
  placements. It is the same compromise `handlePropertyToggle` already makes.
- **Degenerate cycles can still yield an unreachable chain head.** `resolvePropertyRevealChain` takes the
  first parent as the addendum prescribes. In a cycle where the lexicographically first parent is itself
  inside the cycle, the chain can start at a node the index did not promote to a root, and the prefix
  expansion would then name a placement that does not render. The reachability sweep in
  `buildPropertyHierarchyIndex` promotes entire unreached cycles, so the common two-node case is covered
  and is tested; the pathological case is left as prescribed rather than invented around.
- **`handlePropertyToggleAllSiblings` remains node-id only.** `getAllDescendantPropertyNodeIds` walks
  `node.children`, which is always empty for a hierarchical value, so "toggle all siblings" does nothing
  below a hierarchical value. Not in the addendum's scope; recording it.
- **The multi-parent expansion demonstration required two temporary vault notes.** The addendum stated
  `Clients` sits under both `Areas` and `Categories` in `~/2027`, which is true, but that value has no
  children, so there was nothing to expand. Both notes were deleted afterwards and the vault verified
  back to its starting state.

## Fix round 2

The re-review verdicted all six round-1 fixes ADDRESSED. Two new findings, both reproduced by the
reviewer through execution, both now fixed. No vault re-verification: the user's vault has
`collapseOtherBranchesOnExpand: false`, so neither finding is reachable there.

### Critical: a root hierarchical value could not be expanded by mouse with collapse-others on

`useNavigationPaneTreeInteractions.ts`, the collapse-others branch of `handlePropertyToggle`. For a root
placement `placementKey === nodeId`, so the branch is entered and `targetNode` resolves to the value
node, but the target was built with `hasChildren: targetNode.children.size > 0`. That is always false: a
value node is stored as a leaf child of its key. `toggleNavigationExpansionTarget` then computed
`canExpand: false`, dispatched nothing, and the `return` immediately after swallowed the toggle, so the
plain dispatch at the end never ran either. Collapsing still worked because `canCollapse` reads the
expansion set, not `hasChildren`. Net effect: with that setting on, the first level of a hierarchical key
never opened, so the whole tree was unreachable by mouse. The row click path was affected too, since
`handlePropertyClick`'s `onToggleExpand` calls the same function.

Fixed with the one line the reviewer identified,
`hasChildren: propertyNodeHasChildren(targetNode, propertyHierarchyIndex)`, plus
`propertyHierarchyIndex` added to the callback's dependency array. This is precisely the class of bug
`propertyNodeHasChildren` was introduced for in round 1, and this was the site that was missed. A comment
now records why the node's own children map cannot answer the question here.

### Important: Alt+click on a nested placement toggled the wrong row

`handlePropertyToggleAllSiblings` read `expandedProperties.has(propertyNode.id)` and called
`handlePropertyToggle(propertyNode.id, propertyNode.id)`, so Alt+clicking the `Work > Clients` chevron
dispatched `TOGGLE_PROPERTY_EXPANDED { propertyNodeId: 'key:projects=clients' }`. That is the same defect
Important 2 fixed for the other two handlers: a bare node id enters the persisted set, renders nowhere,
and the clicked row does not expand.

The handler now takes a `placementKey` parameter, used for both the `isCurrentlyExpanded` test and the
self-toggle, with `NavigationPaneTreeRow.tsx` threading `item.key` into `onToggleAllSiblings` the same way
it already does for `onToggle`, `onClick` and `onNameClick`. The descendant payload deliberately stays in
node ids, because `TOGGLE_DESCENDANT_PROPERTIES` walks `node.children`, which a hierarchical value never
has. The old comment justified the whole handler with a claim that is only true of the descendant
dispatch; it now says exactly that and no more.

### Tests

`tests/hooks/useNavigationPaneTreeInteractions.test.ts`, 24 to 26 tests.

The mis-titled test the reviewer flagged is split in two. It claimed to cover "a root placement" but
passed `keyNode.id`, a key node, which does have `children` and therefore could never catch this. It is
now honestly titled "still takes the collapse-others branch for a key node", and a new test
"expands a root hierarchical value through the collapse-others branch, where its own children map is
empty" passes the root **value** node with the hierarchy index giving it a child, asserting
`SET_EXPANDED_PROPERTIES` with `{keyNode.id, workNode.id}`.

A second new test asserts the Alt+click dispatched payload, not merely that a dispatch happened: the
self-toggle carries the placement key, explicitly **not** the bare node id, and the descendant dispatch
still carries node ids.

Both new tests were confirmed to fail against the round-1 committed code and pass with the fix, and they
were the only two failures in that state, so they pin these two defects and nothing else:

```
$ git stash push -q src/hooks/navigationPane/useNavigationPaneTreeInteractions.ts \
    src/components/navigationPane/NavigationPaneTreeRow.tsx
$ node node_modules/vitest/vitest.mjs run tests/hooks/useNavigationPaneTreeInteractions.test.ts
 × expands a root hierarchical value through the collapse-others branch, where its own children map is empty
 × toggles the clicked placement, not the bare node id, while keeping descendants in node ids
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
$ git stash pop -q
```

### Round 2 commands and output

```
$ node node_modules/prettier/bin/prettier.cjs --write <the 3 changed files>
src/hooks/navigationPane/useNavigationPaneTreeInteractions.ts 76ms (unchanged)
src/components/navigationPane/NavigationPaneTreeRow.tsx 17ms (unchanged)
tests/hooks/useNavigationPaneTreeInteractions.test.ts 40ms (unchanged)

$ npx tsc -noEmit -skipLibCheck
(clean, no output)

$ node node_modules/eslint/bin/eslint.js <the 3 changed files>
(clean, no output)

$ node node_modules/vitest/vitest.mjs run tests/hooks/useNavigationPaneTreeInteractions.test.ts
 Test Files  1 passed (1)
      Tests  26 passed (26)

$ node node_modules/vitest/vitest.mjs run
 Test Files  179 passed (179)
      Tests  2183 passed (2183)
```

2181 to 2183, no drop.

### Left alone as instructed

The four deferred Minors (reveal chain whose head is not a root, the uncovered keyboard site, left-arrow
jumping to the key row, `firstPlacementByNodeId` being dead) are untouched. `supportsBranchCollapse` is
unchanged, and per-placement collapse-others remains Task 6.

One thing worth noting for Task 6: this Critical is a second instance of the same root cause as
Important 1 in round 1, a `children.size > 0` check on a node whose children map is empty by design. Two
such sites were found by review rather than by construction. When Task 6 reworks
`toggleNavigationExpansionTarget`, having the caller supply children presence at all is the thing worth
removing, since every remaining caller has to remember to ask the index.
