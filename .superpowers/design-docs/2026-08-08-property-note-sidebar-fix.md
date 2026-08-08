# Property notes stacked up in the right sidebar

Date: 2026-08-08
Branch: `property-notes`
Pre-fix HEAD: `4a0de420`
Fix commit: `9cc5ac06`

## Root cause

With `propertyNoteOpenLocation: 'right-sidebar'`, `openPropertyNoteFile` opened the note by
calling `app.workspace.getRightLeaf(true) ?? app.workspace.getRightLeaf(false)` inline
(`src/utils/propertyNotes.ts:47` before this change). The `true` argument means "split", so every
open produced a brand new right sidebar leaf, and nothing remembered the leaf from the previous
open, so nothing could reuse it. Three property note opens left three markdown leaves stacked in
the sidebar. Folder notes never hit this because they do not call the primitive at the feature
level: their seven call sites pass `openInRightSidebar: plugin.openFolderNoteInRightSidebar`,
which routes into `FolderNoteSidebarService`, and that service tracks the leaf it created and
reuses it.

## What was built

`src/services/workspace/PropertyNoteSidebarService.ts` (100 lines), modelled on the leaf
lifecycle of `FolderNoteSidebarService` and nothing else:

- `companionLeaf: WorkspaceLeaf | null` holds the leaf the service itself created.
- `getUsableCompanionLeaf()` returns the tracked leaf only when it is still attached to the
  workspace and still in the right sidebar, clearing the field otherwise. The sidebar test is
  `getLeafSplitLocation(app, leaf) === 'right-sidebar'` from `src/utils/workspaceSplit.ts`, the
  same helper the folder service uses. The attachment test walks `iterateAllLeaves` looking for
  the leaf: a detached leaf keeps both its object identity and its `parent` reference, so the
  split check alone cannot tell a closed leaf from a live one.
- `getOrCreateCompanionLeaf()` reuses that leaf, and only when there is none falls back to
  `getRightLeaf(true) ?? getRightLeaf(false)`, storing what it gets.
- `openPropertyNote(file)` does `leaf.openFile(file, { active: false })` then
  `app.workspace.revealLeaf(leaf)`, which is exactly what the inline branch did, so the note
  still appears without stealing focus.

The service only ever reuses a leaf it created. The right sidebar in this vault holds five tool
panes (backlink, outgoing-link, all-properties, outline, sidenote-view), and adopting one of those
would be a worse bug than the stacking. That is why `getRightLeaf(false)` is not used as a reuse
shortcut: it returns whichever leaf happens to be there.

Wiring in `src/main.ts`: a private `propertyNoteSidebarService` field beside
`folderNoteSidebarService`, constructed in the same block, nulled in `onunload`, and a public
`openPropertyNoteInRightSidebar(propertyNote: TFile)` beside `openFolderNoteInRightSidebar`.
There is no `start()` and no `dispose()`: the service registers no listeners and owns no timers,
so both would have been empty.

`openPropertyNoteFile` gained an optional `openInRightSidebar?: (propertyNote: TFile) =>
Promise<void>`, used when `context === 'right-sidebar'` and falling back to the old inline branch
when absent. That is the shape `openFolderNoteFile` already had, so a caller that does not pass it
keeps working. `createPropertyNote` accepts and forwards the same callback.

## Deliberately not ported from FolderNoteSidebarService

All of these exist because folder notes have a "show closest folder note in the sidebar" feature
that follows the navigation selection. Property notes open only on an explicit user action, so
none of it has an analogue here:

- **Placeholder leaves and `PLACEHOLDER_VIEW_STATE`.** The folder service parks an empty
  placeholder view in the companion slot when the selection has no folder note, to keep the tab
  in the layout. Property notes are never cleared in response to a selection change, so there is
  nothing to park.
- **`clearCompanionLeaf` / `detachCompanionLeaf`.** Both are driven by settings changes and by
  the selection resolving to no folder note. A property note in the sidebar is a note the user
  asked for; leaving it alone when the setting flips is the same as today's behavior.
- **`findRestoredCompanionLeaf`.** This recovers a leaf that Obsidian restored from the saved
  workspace layout, which matters because the folder service wants to keep following the
  selection from the first moment after a reload. Property notes only need a leaf when the user
  next clicks something, and creating one then is correct.
- **`pruneRestoredCompanionLeafDuplicates`.** Its job is to collapse the several right sidebar
  leaves the folder-note feature can otherwise accumulate across reloads. Detaching leaves the
  service did not create is precisely the risk called out above, so this is left out.
- **Selection following (`syncToSelectedFolder`, `findNearestFolderNoteForFolder`,
  `handleWorkspaceReady`, `syncRequestId`) and open suppression
  (`suppressSidebarOpen` / `isSuppressingSidebarOpen`).** No property-note equivalent of
  `showNearestFolderNoteInSidebar` exists, so there is no background open to sequence or to hide
  from the workspace's file-open handler.
- **`commandQueue.executeBackgroundFileOpen`.** The folder service needs it because its opens are
  triggered by selection changes. Property note opens already run inside
  `commandQueue.executeOpenPropertyNote`, wrapped one level up in `openPropertyNoteFile`; adding a
  second queue wrapper would change today's semantics.
- **`Platform.isMobile` guard around `revealLeaf`.** The inline branch this replaces called
  `revealLeaf` unconditionally, and preserving current behavior was a requirement.

Nothing in `FolderNoteSidebarService` or any folder-note call site was modified.

## Call sites threaded

Ten `openPropertyNoteFile` call sites exist across the UI, plus the one inside
`createPropertyNote`. Line numbers below are post-change. The seven whose context can be
`'right-sidebar'` (those deriving it from `settings.propertyNoteOpenLocation` through
`resolveFolderNoteClickOpenContext` or `resolveFolderNoteDefaultOpenContext`) now pass the
callback. The three hardcoding `context: 'tab'` are middle-click handlers and were left alone.

| Call site | How it reaches the plugin |
| --- | --- |
| `src/hooks/usePropertyNoteLink.ts:86` (click) | `useServices()` now also destructures `plugin` |
| `src/hooks/useNavigationPaneKeyboard.ts:366` (Enter) | `plugin` already destructured from `useServices()` at `:122` |
| `src/hooks/navigationPane/useNavigationPaneShortcutActions.ts:416` (shortcut activate) | new required prop `openPropertyNoteInRightSidebar`, supplied by `useNavigationPaneShortcuts.ts:233` from its `plugin` |
| `src/hooks/navigationPane/useNavigationPaneShortcutActions.ts:481` (shortcut name click) | same prop |
| `src/components/listPane/ListPaneVirtualContent.tsx:1079` (group header click) | `plugin` from `useServices()` at `:695` |
| `src/hooks/navigationPane/useNavigationPaneTreeInteractions.ts:724` (row click auto-open) | new required prop `openPropertyNoteInRightSidebar`, supplied by `NavigationPaneContent.tsx:494` from its `plugin` |
| `src/hooks/navigationPane/useNavigationPaneTreeInteractions.ts:796` (name click) | same prop |
| `src/utils/contextMenu/propertyMenuBuilder.ts:217` (`createPropertyNote`) | `services.plugin`, already in scope |

Middle-click sites left untouched: `usePropertyNoteLink.ts:107`,
`ListPaneVirtualContent.tsx:1099`, `useNavigationPaneTreeInteractions.ts:840`.

`tests/hooks/useNavigationPaneTreeInteractions.test.ts` gained the new required prop at its nine
harness call sites.

## Tests

New: `tests/services/PropertyNoteSidebarService.test.ts`, five cases against a stubbed workspace
whose `getRightLeaf(true)` splits a fresh leaf on every call, which is the real behavior that
caused the bug.

- first open creates a leaf and opens with `{ active: false }` plus `revealLeaf`
- three successive opens create exactly one leaf and call `openFile` on it three times
- a tracked leaf whose parent moved to `rootSplit` is not reused
- a tracked leaf removed from the workspace (detached) is not reused
- no leaf available means no open and no reveal

Added to `tests/utils/propertyNotes.test.ts`: a right-sidebar open routes through
`openInRightSidebar` and never touches `getRightLeaf`; a `'tab'` open ignores the callback;
`createPropertyNote` forwards the callback for the note it creates.

### Each test was checked against the broken behavior

Pre-fix behavior, `getOrCreateCompanionLeaf` always creating (no tracking):

```
     × reuses the tracked leaf on later opens instead of stacking new ones 4ms
AssertionError: expected [ { …(2) }, { …(2) }, …(1) ] to have a length of 1 but got 3
 Tests  1 failed | 4 passed (5)
```

Naive fix, reuse with no validity check (the `if (...)` in `getUsableCompanionLeaf` forced false):

```
     × does not reuse a tracked leaf the user moved out of the right sidebar 3ms
     × does not reuse a tracked leaf the user closed 0ms
AssertionError: expected [ Array(1) ] to have a length of 2 but got 1
AssertionError: expected [ Array(1) ] to have a length of 2 but got 1
 Tests  2 failed | 3 passed (5)
```

Pre-fix `openPropertyNoteFile`, with the `openInRightSidebar` branch removed:

```
     × routes a right sidebar open through the reusable sidebar leaf when one is offered 2ms
     × opens a note it creates through the reusable sidebar leaf 1ms
 Tests  2 failed | 26 passed (28)
```

The remaining two service cases (first open creates a leaf; no leaf available does nothing) hold
in both directions by design: they pin the semantics the inline branch already had.

## Commands

```
$ npx tsc -noEmit -skipLibCheck
TSC_EXIT=0

$ node node_modules/vitest/vitest.mjs run
 Test Files  181 passed (181)
      Tests  2214 passed (2214)

$ node node_modules/prettier/bin/prettier.cjs --write <14 files>
(all 14 reported "unchanged")

$ node node_modules/eslint/bin/eslint.js <14 files>
src/main.ts 261
tests/utils/propertyNotes.test.ts 3
```

The two eslint counts are pre-existing. Verified by `git stash push -u`, re-running eslint on
those two files, and getting the identical 261 and 3; `PropertyNoteSidebarService.ts` and its test
lint clean. The suite went from 2206 to 2214 passing, the 8 new cases.

## Vault verification (`~/2027`)

Settings in place: `propertyNoteOpenLocation: 'right-sidebar'`, `enablePropertyNoteLinks: true`,
`propertyHierarchicalKeys: {"projects": true}`.

```
$ node scripts/build-styles.mjs && node esbuild.config.mjs production
Built styles.css from 57 files
Validated theming guide against CSS and Style Settings

$ cp main.js styles.css manifest.json ~/2027/.obsidian/plugins/notebook-navigator/
$ obsidian plugin:reload id=notebook-navigator
$ obsidian dev:errors
No errors captured.
```

Markdown files outside `.obsidian` and `.trash`, before: **160**.

Right sidebar before, counted with `iterateAllLeaves` and `l.getRoot() === app.workspace.rightSplit`:

```
{"total":5,"markdown":0,"rows":[
  {"type":"backlink"},{"type":"outgoing-link"},{"type":"all-properties"},
  {"type":"outline"},{"type":"sidenote-view"}]}
```

Then three property notes were opened in succession by dispatching real click events on the
property value names in the navigation pane (`.nn-navitem-name`), which is the
`handlePropertyNameClick` path:

```
=> {"clicked":true,"node":"key:projects=fiddle","text":"Fiddle"}
=> {"clicked":true,"node":"key:projects=work","text":"Work"}
=> {"clicked":true,"node":"key:projects=personal","text":"Personal"}
```

Right sidebar after three opens:

```
{"type":"backlink"},{"type":"outgoing-link"},{"type":"all-properties"},
{"type":"outline"},{"type":"sidenote-view"},
{"type":"markdown","file":"Personal.md"}
```

**One** markdown leaf, holding the most recent note, and all five tool panes still present and
still in their original order. A fourth open (restoring the property value that had been selected
before the test, `Datawerkplaats Mooi Maasvallei`) reused the same leaf: the sidebar still showed
five tool panes plus one markdown leaf, now `Datawerkplaats Mooi Maasvallei.md`.

Vault left as found: the one markdown leaf created during the test was detached, restoring the
sidebar to the same five tool panes; the previously selected property value was reselected; no
notes were created or deleted.

```
$ obsidian eval (detach right-sidebar markdown leaves)
=> {"detached":1,"rightNow":["backlink","outgoing-link","all-properties","outline","sidenote-view"]}

$ obsidian dev:errors
No errors captured.
```

Markdown files after: **160**, unchanged.
