# Property notes stacked up in the right sidebar

Date: 2026-08-08
Branch: `property-notes`
Pre-fix HEAD: `4a0de420`
Fix commit: `0a25a295`

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

`src/services/workspace/PropertyNoteSidebarService.ts` (145 lines after the review fixes below),
modelled on the leaf lifecycle of `FolderNoteSidebarService` and nothing else:

- `companionLeaf: WorkspaceLeaf | null` holds the leaf the service itself created or adopted.
- `getUsableCompanionLeaf()` returns the tracked leaf only when it is still in the right sidebar,
  clearing the field otherwise. The test is `getLeafSplitLocation(app, leaf) === 'right-sidebar'`
  from `src/utils/workspaceSplit.ts`, the same helper the folder service uses. That one check
  covers both ways the leaf stops being ours: `leaf.detach()` nulls `leaf.parent`, so a closed leaf
  resolves to `'unknown'`, and a leaf dragged into the editor resolves to `'main'`.
- `findRestoredCompanionLeaf(file)` adopts a right sidebar leaf that is already displaying the very
  file being opened, which is how a leaf Obsidian restored from the saved workspace layout is picked
  up after a restart. Only an exact path match qualifies. Its shape follows the folder service's
  `findRestoredCompanionLeaf` exact-match branch (`FolderNoteSidebarService.ts:240-242`), including
  the document-view-type gate in `getFilePathFromLeaf`, without the placeholder and
  any-folder-note fallbacks.
- `getOrCreateCompanionLeaf(file)` reuses the tracked leaf, then tries the restored leaf, and only
  when there is neither falls back to `getRightLeaf(true) ?? getRightLeaf(false)`, storing what it
  gets.
- `openPropertyNote(file)` does `leaf.openFile(file, { active: false })` then
  `app.workspace.revealLeaf(leaf)`, which is exactly what the inline branch did, so the note
  still appears without stealing focus.

The service reuses a leaf only when it created that leaf or the leaf is already showing the exact
note being opened. The right sidebar in this vault holds five tool panes (backlink, outgoing-link,
all-properties, outline, sidenote-view), and adopting one of those would be a worse bug than the
stacking. That is why `getRightLeaf(false)` is not used as a reuse shortcut: it returns whichever
leaf happens to be there. The view-type gate is what keeps the exact-match rule safe, because tool
panes like backlink and outline record the file they describe in their own view state, so a path
comparison on its own could match one.

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

Most of these exist because folder notes have a "show closest folder note in the sidebar" feature
that follows the navigation selection, and property notes open only on an explicit user action, so
that machinery has no analogue here. The last two entries are omitted for their own reasons, stated
there:

- **Placeholder leaves and `PLACEHOLDER_VIEW_STATE`.** The folder service parks an empty
  placeholder view in the companion slot when the selection has no folder note, to keep the tab
  in the layout. Property notes are never cleared in response to a selection change, so there is
  nothing to park.
- **`clearCompanionLeaf` / `detachCompanionLeaf`.** Both are driven by settings changes and by
  the selection resolving to no folder note. A property note in the sidebar is a note the user
  asked for; leaving it alone when the setting flips is the same as today's behavior.
- **The fuzzy branches of `findRestoredCompanionLeaf`.** The exact-match branch is ported, as
  described above. Its two fallbacks are not: a placeholder leaf, which this service never creates,
  and "any right sidebar leaf holding a folder note", which would mean adopting a leaf showing a
  file the user did not just ask for.
- **`pruneRestoredCompanionLeafDuplicates`.** Its job is to collapse the several right sidebar
  leaves the folder-note feature can otherwise accumulate across reloads. Detaching leaves the
  service did not create is precisely the risk called out above, so this is left out. The
  consequence is documented as a known residual below.
- **Selection following (`syncToSelectedFolder`, `findNearestFolderNoteForFolder`,
  `handleWorkspaceReady`, `syncRequestId`) and open suppression
  (`suppressSidebarOpen` / `isSuppressingSidebarOpen`).** No property-note equivalent of
  `showNearestFolderNoteInSidebar` exists, so there is no background open to sequence or to hide
  from the workspace's file-open handler.
- **`commandQueue.executeBackgroundFileOpen`.** The folder service needs it because its opens are
  triggered by selection changes. Property note opens already run inside
  `commandQueue.executeOpenPropertyNote`, wrapped one level up in `openPropertyNoteFile`; adding a
  second queue wrapper would change today's semantics.
- **`Platform.isMobile` guard around `revealLeaf`.** The folder service needs the guard because its
  opens are background and selection-driven: on mobile `revealLeaf` slides the right drawer open,
  so without the guard every tap in the navigation pane would throw the drawer over the pane the
  user is working in. A property-note open is an explicit tap on that note, where showing it is the
  whole point, so revealing unconditionally is right. It also matches the inline branch this
  replaces, which called `revealLeaf` with no platform test.
- **Restoring the previously active leaf.** The folder service captures the active leaf before
  opening (`FolderNoteSidebarService.ts:141`) and puts focus back afterwards with
  `setActiveLeaf(previousActiveLeaf, { focus: false })` (`:165-167`), again because its opens happen
  behind the user's back. The property service does not, which preserves behavior: the inline
  right-sidebar branch it replaces did not either, and `openFile(note, { active: false })` already
  keeps the open from taking focus.

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

`tests/hooks/useNavigationPaneTreeInteractions.test.ts` gained the new required prop at its eight
harness call sites (`:181, 248, 310, 371, 426, 507, 792, 948`).

## Tests

New: `tests/services/PropertyNoteSidebarService.test.ts`, eight cases against a stubbed workspace
whose `getRightLeaf(true)` splits a fresh leaf on every call, which is the real behavior that
caused the bug. Its leaves report the file they show through `getViewState()`, and `openFile`
updates that, so a restored leaf can be stubbed the way Obsidian hands one back.

- first open creates a leaf and opens with `{ active: false }` plus `revealLeaf`
- three successive opens create exactly one leaf and call `openFile` on it three times
- a tracked leaf whose parent moved to `rootSplit` is not reused
- a tracked leaf the user closed (dropped from the workspace, `parent` nulled) is not reused
- an untracked right sidebar leaf already showing the note being opened is adopted, with no
  `getRightLeaf` call at all
- an untracked right sidebar leaf showing a different note is left alone and a new leaf is created
- a `backlink` leaf whose view state names the same file is left alone, which pins the view-type gate
- no leaf available means no open and no reveal

Added to `tests/utils/propertyNotes.test.ts`: a right-sidebar open routes through
`openInRightSidebar` and never touches `getRightLeaf`; a `'tab'` open ignores the callback;
`createPropertyNote` forwards the callback for the note it creates.

### Each test was checked against the broken behavior

Measured at `0a25a295`, when the service test held five cases. Re-verified after the review fixes,
in the "Review fixes" section below.

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

## Review fixes

Review of `04f31b49` came back Spec OK and Approved with nothing blocking, and confirmed the
only-reuse-what-you-created property held on every path it could construct, including
drag-out-and-back, sidebar collapse, and two rapid opens. Two Important findings were closed.

### 1. The attachment check was redundant, and its test passed for the wrong reason

`isLeafAttached` and its `iterateAllLeaves` walk are deleted. The rationale behind them was simply
false: the reviewer probed a real right-sidebar leaf holding a markdown `FileView` and got
`parentAfterDetachIsNull: true`, `splitLocationAfterDetach: "unknown"`. `leaf.detach()` nulls
`leaf.parent`, so `getLeafSplitLocation` already returns `'unknown'` for a closed leaf and the
split check alone does the whole job.

The old test discriminated only because its `detachLeaf` helper dropped the leaf from
`attachedLeaves` while leaving `parent` pointing at `rightSplit`, a workspace state Obsidian never
produces. The helper now nulls `parent` too, matching the real API. Three comments that stated the
false claim are corrected: the one above the check in `PropertyNoteSidebarService.ts`, the
`detachLeaf` doc comment, and the inline comment in the closed-leaf test.

With the helper faithful, the closed-leaf test still discriminates, now for the real reason.
Removing the split-location check from `getUsableCompanionLeaf`:

```
     × does not reuse a tracked leaf the user moved out of the right sidebar 3ms
     × does not reuse a tracked leaf the user closed 1ms
AssertionError: expected [ Array(1) ] to have a length of 2 but got 1
AssertionError: expected [ { …(2) } ] to have a length of 2 but got 1
      Tests  2 failed | 6 passed (8)
```

### 2. The restart residual, fixed within a bound

The reviewer was right that the residual is real and has nothing to do with selection following.
While a property note is open in the right sidebar, `workspace.getLayout().right` contains that
`markdown` leaf, so Obsidian persists and restores it. After a reload `companionLeaf` is null, the
restored leaf is still sitting there, and the first open split a second one, one more markdown leaf
per restart.

The fix adopts a restored leaf **only when that leaf is already displaying the same note being
opened**, following the exact-match branch of `FolderNoteSidebarService.findRestoredCompanionLeaf`
(`:240-242`). A leaf already showing that exact file cannot be a tool pane or unrelated content, so
reusing it cannot clobber anything, which keeps the only-reuse-what-you-created guarantee intact in
spirit. The broader "adopt any single restored markdown leaf" variant was considered and rejected.

`getFilePathFromLeaf` carries the safety and is ported with the folder service's view-type gate,
because tool panes record the file they describe in their own view state: with the vault's backlink
pane pointed at the note being opened, a bare path comparison would match the backlink leaf and
hand it to `openFile`. A test pins this.

**Known residual, stated plainly.** Opening a *different* property note after a restart still
leaves the restored leaf where it is and creates a new one beside it, so the sidebar can hold two
markdown leaves until the user closes one. That is the accepted cost of not detaching leaves this
service did not create, which is what `pruneRestoredCompanionLeafDuplicates` would do. It is
bounded: at most one leftover, and it disappears as soon as an open matches it or the user closes
it. Not explained away, not fixed.

### Smaller corrections

- The claim that every omission from `FolderNoteSidebarService` follows from selection following
  was wrong for the `Platform.isMobile` guard. The real reason is now stated with the omission:
  the folder service guards `revealLeaf` because its opens are background and selection-driven and
  would throw the mobile drawer open on every tap, while a property-note open is an explicit tap
  where opening the drawer is the point.
- The omission list was missing one entry: capturing the previously active leaf and restoring it
  with `setActiveLeaf(previousActiveLeaf, { focus: false })` (`FolderNoteSidebarService.ts:141`,
  `:165-167`). Added as a deliberate omission, not a behaviour change: the inline branch this
  replaces did not do it either.
- Two counts were wrong. The harness sites in
  `tests/hooks/useNavigationPaneTreeInteractions.test.ts` are **eight**, not nine
  (`:181, 248, 310, 371, 426, 507, 792, 948`). `PropertyNoteSidebarService.ts` was **96** lines at
  `04f31b49`, not 100, and is 145 lines after these fixes.

### Raised and deliberately not changed

- Making `openInRightSidebar` required on `openPropertyNoteFile` and deleting the inline fallback.
  Raised as a Minor; the current shape matches `openFolderNoteFile`, so it stays.
- `FolderNoteSidebarService` is byte-unchanged, as are all folder-note call sites.
- `tsconfig.json` still excludes `tests/` from typechecking. Out of scope here.

### Commands

```
$ npx tsc -noEmit -skipLibCheck
TSC_EXIT=0

$ node node_modules/vitest/vitest.mjs run
 Test Files  181 passed (181)
      Tests  2217 passed (2217)

$ node node_modules/prettier/bin/prettier.cjs --write \
    src/services/workspace/PropertyNoteSidebarService.ts tests/services/PropertyNoteSidebarService.test.ts
(both reported "unchanged")

$ node node_modules/eslint/bin/eslint.js \
    src/services/workspace/PropertyNoteSidebarService.ts tests/services/PropertyNoteSidebarService.test.ts
(clean, exit 0)
```

2214 to 2217 passing, the three new service cases.

### Vault re-check (`~/2027`), light

Build, deploy, `plugin:reload`, then `obsidian dev:errors`: no errors captured. Right sidebar before:
the same five tool panes, no markdown leaf. Two property notes were then opened by dispatching real
click events on `.nn-navitem-name`, `key:projects=fiddle` followed by `key:projects=work`:

```
{"total":6,"rows":[{"type":"backlink"},{"type":"outgoing-link"},{"type":"all-properties"},
  {"type":"outline"},{"type":"sidenote-view"},{"type":"markdown","file":"Work.md"}]}
```

One markdown leaf after both opens, holding the most recent note, five tool panes intact and in
order. The restart path was not exercised in the vault; the unit test covers it.

Left as found: the markdown leaf was detached, the sidebar is back to its five tool panes, and the
selection is back on `key:projects=datawerkplaats mooi maasvallei`. `obsidian dev:errors` clean
afterwards.

Markdown file count was **161** at the start of this check and **161** at the end. The earlier
session recorded 160. The extra file is `_types/task.md`, created 14:41 and edited 15:10, after the
`04f31b49` verification and by the user, not by this work. No note was created or deleted here, and
nothing was deleted to make the number match.
