# Property note cross-lens reveal — design

**Date:** 2026-08-06
**Status:** Approved, ready for implementation planning
**Builds on:** [`2026-08-05-property-note-creation-design.md`](2026-08-05-property-note-creation-design.md)
**Depends on:** the uncommitted in-lens reveal fix (`resolvePropertyRevealTarget` in
`src/utils/propertyNoteLookup.ts`) landing first

## Summary

One new opt-in setting, `autoRevealPropertyNote`. When it is on and auto-reveal is on, opening a property
note from outside the navigator — a wikilink, the quick switcher, search, the graph, or switching to its
tab — switches the navigation pane into the properties tree, expands through to the value node the note
defines, and selects it.

This is the first behavior in Notebook Navigator that changes the navigation pane's **lens** — its
selection type — in response to a file being opened. Everything in this design follows from that being new.

## Motivation

Reveal in Notebook Navigator is containment-based and lens-preserving. In folder view it targets the
file's parent; in tag view `determineTagToReveal` picks a tag the file carries; in property view
`determinePropertyToReveal` picks a value the file carries. The target always contains the opened file in
its list, and the current selection type never changes.

Folder notes get "the tree navigates to the thing this note represents" for free, with no folder-note code
in the reveal path at all: a folder note is *required* to live inside the folder it represents
(`src/utils/folderNoteLookup.ts:98` rejects any candidate whose parent is not that folder), so plain
containment already lands on the right tree item.

Property notes cannot inherit that. Their path is arbitrary — the link target, or `propertyNoteFolder` —
and a property note is not a member of the value it defines. Containment can never find it. The only way
to reveal a property note *as* a property note is to look up the value whose wikilink points at it and
switch lens deliberately.

Note that both cases end up at the same place with respect to the list pane: `hideFolderNoteInList`
defaults to `true`, so revealing a folder note today already lands on a tree item whose list does not
contain the opened file. Property notes never appear in their value's list either. So this design needs no
list-pane work — the end state is the one users already get from folder notes.

## Decisions

| Question | Decision |
|---|---|
| Trigger | Auto-reveal only. No new command, no new menu item. |
| Reveal source | Only `'auto'` and `'startup'`. Shortcuts, recent notes and manual reveals never jump. |
| Expansion | Always expand to the value node, ignoring `autoRevealShortestPath`. |
| Lens scope | Fires from any lens. Property-note identity beats tag membership. |
| Toggle scope | Gates only the lens jump. The in-lens fix stays unconditional. |
| Index | Resolve on demand, never cache. |
| Startup | Nothing to do. The navigator does not mount until storage is ready. |
| Tab activation | Treated the same as a fresh open. |

### Why the toggle does not gate the in-lens fix

`resolvePropertyRevealTarget` corrects a genuine defect: while already in property view, revealing a
property note used to land on a value the note merely *references* in its own frontmatter — the note for
`[[Meetings]]` carrying `categories: [[Contexts]]` dragged the pane onto Contexts. That is wrong
regardless of preference. The toggle governs exactly one thing: may the navigator switch the user into the
properties tree.

### Why the reverse mapping is not cached

The mapping "file ← property value" has two inputs: property values, which live in the property tree, and
link resolution, which lives in `app.metadataCache`. The property tree is rebuilt wholesale on property
changes, visibility changes, markdown delete/rename, and profile/settings changes
(`src/context/storage/usePropertyTreeSync.ts:207-378`). It is **not** rebuilt on
`metadataCache.on('resolved')`.

So creating `Clients.md` makes `[[Clients]]` resolve where it previously did not, and an index built at
tree-rebuild time is then wrong with no event to correct it. Making a cache correct would require
invalidating on `resolved` plus vault-create for every file type — a broad, chatty surface whose failure
mode is *silently navigating to the wrong node*. On-demand resolution asks the metadata cache at the
moment of the reveal, so it can be slow but cannot be stale. Slow is the better failure.

The accepted cost: `findPropertyNoteValueNode` walks every property value and calls
`getFirstLinkpathDest` for each link-shaped one. Today that runs only in property lens; with this setting
on it runs on every file open in any lens. `RecentNotesService.isPropertyNote` already does the same scan
per file open when hiding property notes, so there is precedent. If it becomes a measured problem, a
reverse index maintained in the property tree rebuild *plus* `resolved` invalidation is the escape hatch —
deliberately not built now.

## Setting

One new key in the existing **Property notes** group.

| Key | Type | Default |
|---|---|---|
| `autoRevealPropertyNote` | `boolean` | `false` |

Named to pair with `autoOpenPropertyNote`, which sits directly above it and governs the opposite
direction (tree item → note).

Placed in `src/settings/tabs/PropertiesTab.ts` after `autoOpenPropertyNote`, with
`visible: () => plugin.settings.enablePropertyNotes` like its neighbours.

The description must state that it requires auto-reveal to be enabled. The jump runs only for reveals
sourced `'auto'` or `'startup'`, so with `autoRevealActiveFile` off the setting is a silent no-op. The
setting stays visible in that case rather than disappearing — hiding a Properties-tab control based on a
Navigation-tab setting is more confusing than a description that explains the dependency.

Touch list:

- `src/settings/types.ts` — interface member
- `src/settings/defaultSettings.ts` — `false`
- `src/settings/nativeSettingControls.ts` — `BOOLEAN_SETTING_KEYS` only. It gates no other control's
  visibility, so it does **not** belong in `NATIVE_SETTING_DOM_STATE_REFRESH_KEYS`.
- `src/settings/tabs/PropertiesTab.ts` and `src/settings/tabs/legacy/PropertiesLegacyTab.ts`
- `src/i18n/locales/*.ts` — all 21 locales

No migration. This is a new key with a default; nothing has ever stored it.

## Architecture

### Decision function — pure, in `src/utils/propertyNoteLookup.ts`

Beside `resolvePropertyRevealTarget`, which already establishes the pattern of reveal decisions as pure
functions in this module:

```ts
export interface PropertyNoteLensJump {
    targetProperty: PropertySelectionNodeId;
    keyNodeId: string | null;
}

export function resolvePropertyNoteLensJump(params: {
    /** showProperties && enablePropertyNotes && autoRevealPropertyNote */
    enabled: boolean;
    revealSource: SelectionRevealSource | undefined;
    selectionType: NavigationItemType;
    filePath: string;
    propertyTree: ReadonlyMap<string, PropertyTreeNode> | null;
    app: App;
}): PropertyNoteLensJump | null;
```

Evaluated strictly in this order:

1. `!enabled` → `null`.
2. `revealSource` is not `'auto'` or `'startup'` → `null`. See below.
3. `selectionType === 'property'` → `null`. The in-lens `resolvePropertyRevealTarget` path owns that case,
   and it already handles a property note correctly.
4. Otherwise scan → a jump with the value node id and its key node id, or `null`.

`keyNodeId` is returned rather than recomputed by the caller so the caller does no property-id parsing.

There is deliberately **no** "index not ready" state. See Startup below.

### Why the reveal source must be gated

`revealFileInNearestFolder` is **not** auto-reveal-only, despite being the auto-reveal path. Its own
docstring says "auto-reveal, shortcuts, recent notes", and it is additionally reached from:

- note shortcuts and recent notes — `source: 'shortcut'` (`src/components/NotebookNavigatorComponent.tsx:802`)
- `HomepageController` — `source: 'startup'` at startup, `'manual'` otherwise
- the public plugin API — `main.ts:1825` → `WorkspaceCoordinator` → the view

Without the gate, clicking a property note in the shortcuts or recent-notes list would jump the lens too.
That contradicts the auto-reveal-only decision, and it is the wrong behavior on its own terms: those clicks
happen *inside* the navigation pane, where the user can already see the tree and did not ask to leave it.
It would also make the setting description's "requires auto-reveal to be enabled" false.

Gating on `'auto' | 'startup'` covers exactly the intended cases and lets a homepage that happens to be a
property note jump on startup.

### Deterministic tie-break in `findPropertyNoteValueNode`

A note can be the target of values under several keys — `Clients.md` can be both `categories=clients` and
`projects=clients`. The function currently returns the first match in map iteration order, over a map
rebuilt wholesale from a fresh database scan, so iteration order is not a stable contract and the same note
could land on different nodes across rebuilds.

Change it to collect all matches, sort by (key, valuePath), and return the first. `preferNodeId` keeps its
short-circuit, so the existing in-lens caller behaves exactly as it does today.

### Application in `revealFileInNearestFolder`

One new branch, placed **before** the tag branch.

On a jump:

- set `targetProperty` to the value node id
- leave `targetTag` `undefined` — the reducer checks `targetTag` first
  (`src/context/selection/state.ts:393`) and would otherwise ignore the property target
- expand `PROPERTIES_ROOT_VIRTUAL_FOLDER_ID` when `showAllPropertiesFolder` is on and it is collapsed
- expand `keyNodeId` via the existing `expandPropertyNodeIds`
- fall through to the existing single `REVEAL_FILE` dispatch and the existing scroll block at `:751`

The shortest-path downgrade at `:617-651` is bypassed entirely. That logic exists to avoid disturbing the
view the user is already in, which is moot when the whole point is to move them to a different tree.

Deliberately **not** routed through `navigateToProperty` (`src/utils/propertyNavigation.ts:117`), even
though it performs exactly the right expansions: it also dispatches `SET_SELECTED_PROPERTY`, which on top
of `REVEAL_FILE` would record **two** history entries for one user action and make the back button need two
presses. Only the expansion behavior is reused, by calling the same helpers directly.

On `null`: existing code paths are untouched.

### Startup

**No deferral, no readiness check, no pending state.** The property tree is always built by the time this
code can run, and that is guaranteed structurally rather than by anything in the reveal path:

- `NotebookNavigatorView.tsx:207` renders `NotebookNavigatorContainer`
- the container returns `SkeletonView` while `!isStorageReady` and only mounts
  `NotebookNavigatorComponent` once it is ready (`NotebookNavigatorContainer.tsx:74` vs `:107`)
- `useNavigatorReveal` is called only from that component (`NotebookNavigatorComponent.tsx:570`)

So the hook cannot mount before storage is ready, and the startup reveal it arms via `hasInitializedRef`
cannot fire earlier either. Combined with `usePropertyTreeSync.ts:215` — the initial cache build creates
the property tree *before* storage is marked ready — the tree is present on the first reveal the hook ever
performs.

Obsidian's own link resolution is not a concern either: `getFirstLinkpathDest` resolves against the vault's
file index rather than the link graph, so it does not wait on `metadataCache.on('resolved')`. The codebase
already relies on this — `resolvePropertyNote` is called during `PropertyTreeItem` render, immediately
after mount.

An earlier draft of this design specified a pending-target ref, a `not-ready` status, a retry effect on
`[isStorageReady]`, and a 10-second timeout fallback. All of it would have been dead code. Recorded here so
the idea is not reinvented.

### Tab activation

Switching to a tab that already holds a property note jumps the lens, exactly as opening that note fresh
does. This is inherited, not added: `active-leaf-change` and `file-open` feed the same detector, coalesced
through one callback (`src/utils/workspaceActiveFileEvents.ts:105-123`), and `activeFileRef` compares only
against the last revealed file, so activating a tab is indistinguishable from opening its file. Every tab
switch already moves the tree to that file's folder today.

The two events cannot be reliably separated — Obsidian fires `file-open` on tab activation as well, and the
pipeline coalesces both, so the `candidateFile !== undefined` signal does not distinguish them. The
navigator's own suppression is no help either: `NOTE_OPEN_SUPPRESSION_TTL_MS` is 250ms
(`src/services/CommandQueueService.ts:29`), which covers NN's own open and nothing later.

**Known consequence — lens ping-pong.** With a property note in one tab and a regular note in another,
alternating tabs alternates the tree between the properties lens and the folder lens. Today's folder reveal
moves within one tree; this swaps trees, which is more disruptive. Accepted deliberately, because the
alternatives are worse: skipping a repeat jump for the same path makes identical actions behave differently
based on hidden state, and vetoing the jump after manual navigation would kill the primary use case —
browsing folders by hand, then clicking a link to a property note. If it proves annoying in practice, that
is evidence for a damper designed against real usage rather than guessed at here.

No extra guard is needed for "the selection is already the target node": that state means the lens is
already `property`, so step 3 of the decision function returns `null` and the in-lens
`resolvePropertyRevealTarget` path handles it.

## Error handling and edge cases

| Case | Behavior |
|---|---|
| Value's link target does not exist | `getFirstLinkpathDest` returns null → no jump → ordinary folder reveal. |
| Property key filtered out of the tree | `getPropertyTree()` is already filtered to shown keys, so no match is found → no jump. Nothing extra to implement. |
| `showProperties` off | Folded into `enabled` → no jump. |
| Shortcut or recent-note click on a property note | `source: 'shortcut'` → no jump. The lens is left alone. |
| Homepage is a property note | Jumps at startup (`source: 'startup'`), not on a manual homepage trigger. |
| Public API `revealFileInNearestFolder` | Jumps only if the caller passes `'auto'` or `'startup'`. |
| Note defines values under several keys | Deterministic sort picks one; in property lens the current selection still wins via `preferNodeId`. |
| Selection is already the target node | Implies the property lens, so step 3 returns `null`. |
| Tab switched to an already-open property note | Jumps, same as a fresh open. See Tab activation. |
| Hidden file | Existing `handleHiddenFileReveal` guard runs first and returns before any of this. |

## Testing

`tests/utils/propertyNoteLookup.test.ts` already exists and carries the coverage:

- each of the four `resolvePropertyNoteLensJump` branches in order
- feature off yields `null`
- `source: 'shortcut'` and `source: 'manual'` yield `null`; `'auto'` and `'startup'` do not
- `selectionType === 'property'` yields `null`
- multi-key note produces the same node across differently-ordered input maps
- `preferNodeId` still wins over the sort
- unresolvable link target yields `null`

`useNavigatorReveal` has no existing test file, and with the deferral gone the hook-side change is a single
branch that sets `targetProperty` and calls two existing expansion helpers. Mocking six contexts to test
that is not worth the cost; verify in the running app via the obsidian-cli skill: open a property note from
a wikilink while in folder view, confirm the tree switches and expands to the value node, and confirm one
back-navigation returns to the previous selection.

## Known gaps after implementation

Found by the final whole-branch review, verified, and deliberately deferred by the human rather than
fixed in this work. Recorded here so they are not rediscovered from scratch.

### Startup shortcuts bypass both property-note resolvers

`src/hooks/useNavigatorReveal.ts:1110-1131` — the startup-reveal effect has two pre-existing
early-return shortcuts that call `revealTag` / `revealProperty` directly and return, so
`revealFileInNearestFolder` never runs on that path. Both resolvers live inside that function, so
neither `resolvePropertyRevealTarget` nor `resolvePropertyNoteLensJump` is consulted:

- **Tag shortcut (`:1110`).** Fires on startup when `autoRevealShortestPath` is on (the default), the
  lens is `tag`, and the persisted `selectedFile.path` equals the file being revealed. The cross-lens
  jump does not happen for that startup.
- **Property shortcut (`:1121`).** Re-affirms the already-selected node through `navigateToProperty`,
  which only re-validates and expands the node id it is given and never consults the reverse lookup. A
  wrong node persisted from before the in-lens fix therefore survives one restart.

Neither is a regression introduced by this feature — both are paths that were already short-circuiting
— and both self-heal on the next non-startup reveal of the same file. Closing them properly means
deciding what those shortcuts are for (they exist to avoid redundant startup work), which is a design
question rather than a patch, on the highest-blast-radius path in the hook.

Note for anyone reading the review that raised this: it also claimed the "Homepage is a property note"
row above is contradicted. It is not. `HomepageController` calls `revealFileInNearestFolder` directly
and bypasses this effect entirely.

### `revealFileInNearestFolder` is misnamed

The function drives all three lenses — its own docstring says it "switches tag views when needed" —
and after this feature it can also switch the pane *into* the property lens, which its name denies.
The real distinction from its sibling `revealFileInActualFolder` is implicit versus manual reveal, not
one kind of folder versus another. It is not part of the public API (`notebook-navigator.d.ts` does not
expose it), so a rename is safe: 21 internal references across 6 files. Deliberately left alone to keep
this feature's diff scoped.

### Deferred code notes

Both are unreachable guards in `src/utils/propertyNoteLookup.ts`, kept because removing them buys
nothing and the reasoning for why they cannot fire is non-obvious:

- the `?? ''` fallback on `valuePath` in the `findPropertyNoteValueNode` sort comparator — every
  candidate is a `kind: 'value'` node, and `propertyTree.ts:899-916` builds those with a non-null
  `valuePath`
- `rawKeyNodeId !== targetProperty` in `resolvePropertyNoteLensJump` — `targetProperty` is always a
  value node id, which always contains the delimiter, so `getPropertyKeyNodeIdFromNodeId` can never
  return its input unchanged

## Out of scope

- **Folder notes.** They already get this from the path invariant; nothing to add.
- **The explicit reveal command.** `revealFileInActualFolder` stays folder-only.
- **A cached reverse index.** Rejected above; noted as the escape hatch if the per-open scan is measured to
  be a problem.
- **Showing property notes as rows in their value's list.** Folder notes are hidden from their own folder's
  list by default, so this design matches existing behavior rather than diverging from it.
