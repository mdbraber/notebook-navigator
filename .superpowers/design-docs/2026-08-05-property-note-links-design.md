# Property note links — design

**Date:** 2026-08-05
**Status:** Approved, ready for implementation planning
**Supersedes:** the auto-open behavior shipped by
[`2026-08-04-property-notes-design.md`](2026-08-04-property-notes-design.md)

## Summary

Give property values the same note-linking UX that folders already have. When a property value is a
wikilink — `references: [[Apple]]` — the note it points at becomes reachable the way a folder note is:
the value's name is underlined, clicking it opens the note, clicking elsewhere on the row just selects,
and Enter opens it.

This replaces the `autoOpenPropertyNote` setting shipped on 2026-08-04, which opened the note on any row
click. Folder notes have no such behavior, and having both made row clicks ambiguous.

## Motivation

Selecting a property value in the navigation pane shows every note carrying that value. When the value is
a wikilink, the note it points at is the hub for that group. Folder notes solved this exact problem for
folders years ago, with an interaction model users already know: underlined name, click to open, click
elsewhere to select.

The 2026-08-04 spec reached for a different model — open on any row click — because it was designed
before the folder-note interaction surface had been mapped in full. Matching folders is both more
familiar and less ambiguous.

## What a property note is

Unchanged from the previous spec. A property note exists only for a **value node**
(`key:references=apple`) whose `assignmentValue` parses as a strict wikilink **and resolves to a file**.
Key nodes (`key:references`) and the properties root never have one. Plain-string values (`status: draft`)
never have one.

```
PropertyTreeNode.assignmentValue   "[[Fruits/Apple|Apple]]"
  -> parsePropertyLinkTarget()      { kind: 'internal', target: 'Fruits/Apple' }
  -> metadataCache.getFirstLinkpathDest(target, sourcePath)
  -> TFile | null
```

Resolution uses the link **target**, not the display text, and `sourcePath` is the lexicographically
first path in `node.notesWithValue` — deterministic across rebuilds. Because this is ordinary link
resolution, any file type Obsidian resolves to works with no setting involved.

## Settings

Three new keys in the existing **Property notes** group (Tags & properties pane), plus one existing key
gaining options.

| Key | Type | Default | Folder equivalent |
|---|---|---|---|
| `enablePropertyNotes` | `boolean` | `false` | `enableFolderNotes` |
| `enablePropertyNoteLinks` | `boolean` | `true` | `enableFolderNoteLinks` |
| `propertyNoteOpenLocation` | `'current-tab' \| 'new-tab' \| 'right-sidebar'` | `'current-tab'` | `folderNoteOpenLocation` |
| `hideRecentNotes` | `'none' \| 'folder-notes' \| 'property-notes' \| 'all-notes'` | `'none'` | same key, widened |

`propertyNoteOpenLocation` already exists; its visibility changes from "when `autoOpenPropertyNote` is
on" to "when `enablePropertyNotes` is on", in both the native and legacy settings tabs.

### Removing `autoOpenPropertyNote`

The key is deleted, along with its i18n entries in all 21 locales and its registration in
`nativeSettingControls.ts`.

**Migration is required.** Unlike the 2026-08-04 keys, this one has shipped to real installs. In
`src/settings/migrations/syncedSettings.ts`, when the stored settings contain `autoOpenPropertyNote:
true`, set both `enablePropertyNotes` and `enablePropertyNoteLinks` to `true` and drop the old key. A
stored `false` needs no action beyond dropping the key, since `enablePropertyNotes` defaults to `false`.

The visible change for a migrated user: clicking a property row body no longer opens the note; clicking
its (now underlined) name does.

### Widening `hideRecentNotes`

`RecentNotesHideMode` is currently `'none' | 'folder-notes'` with a type guard
(`src/settings/types.ts:355-360`) and a dropdown. It becomes:

```ts
export type RecentNotesHideMode = 'none' | 'folder-notes' | 'property-notes' | 'all-notes';
```

`'all-notes'` hides both kinds. Existing stored values (`'none'`, `'folder-notes'`) stay valid, so no
migration is needed — only the union, the guard `isRecentNotesHideMode`, the dropdown options, and the
i18n option strings change.

The mode is read in `src/services/RecentNotesService.ts:59`, which currently compares against
`'folder-notes'` exactly and must become membership tests for each kind.

Property-note hiding applies when `enablePropertyNotes` is on. It does **not** require
`enablePropertyNoteLinks` — see [The links toggle](#the-links-toggle). Note that unlike `getFolderNote`,
which returns `null` when `enableFolderNotes` is off, `resolvePropertyNote(node, app)` takes no settings
and is not self-gating; the caller in `RecentNotesService` must check `enablePropertyNotes` itself.

## Behavior

With `enablePropertyNotes` and `enablePropertyNoteLinks` both on, for a value node whose link resolves:

| Action | Result |
|---|---|
| Click the **name** | select the value **and** open the note |
| Middle-click the name | select and open in a new tab |
| Click the **row body** | select only |
| **Enter** on the selected value | select and open |
| Arrow keys | select only — never open |
| Right-click the **name** | file menu for the property note |
| Property **shortcut** row | underlined; click opens the note |
| List-pane **title / header** | underlined; click opens the note |

### Navigation pane row

`PropertyTreeItem.tsx:140-146` already builds a `['nn-navitem-name']` class array and renders the name
span at `:269`. It gains `nn-has-property-note` and an `onNameClick` prop, mirroring `FolderItem.tsx:243-244`
and `:281-286`.

The name-click handler mirrors `handleFolderNameClick`
(`src/hooks/navigationPane/useNavigationPaneTreeInteractions.ts:221-278`): it dispatches selection first,
auto-expands when `autoExpandNavItems` is on and the node has children, resolves the open context, then
opens. It calls `stopPropagation` so the row handler does not also run. Middle-click uses a `mouseDown`
handler with `event.button === 1`, matching `:280-296`.

The existing property row click handler reverts to selection only — the auto-open block added on
2026-08-04 is removed from it.

### Keyboard

The Enter path in `src/hooks/useNavigationPaneKeyboard.ts` stays where it is, immediately after the
folder-note Enter block. Two changes: it gates on `enablePropertyNotes && enablePropertyNoteLinks`
instead of `autoOpenPropertyNote`, and the pure helper `shouldAutoOpenPropertyNote` is renamed to
`shouldOpenPropertyNoteOnEnter` to match.

**The arrow-key path must remain untouched.** `selectItemAtIndex` (around `:184-258`) dispatches
`SET_SELECTED_PROPERTY` as the highlight moves; hooking any open there would open a note per keystroke.
The existing regression test asserting the helper returns `false` for non-Enter events carries over
unchanged and remains the guard.

### List-pane title and header

Three render paths, all of which the folder-note treatment already covers:

- `ListPaneTitleArea.tsx` — the `nn-list-title-label` span.
- `ListPaneHeader.tsx` — the desktop title branch of `breadcrumbContent`.
- `ListPaneHeader.tsx` — the mobile breadcrumb's last segment, which decides its folder-note styling from
  `Boolean(selectedFolderNote)` rather than from `segment.targetType` (`:229`).

`useListPaneTitle.ts` and the `BreadcrumbSegment` type are **not** modified; the property version mirrors
the `Boolean(...)` flag approach.

Because folder-note and property-note links are mutually exclusive — a selection is either a folder or a
property, never both — the folder-note branch takes precedence in every conditional.

To avoid a third and fourth copy of the folder-note click logic, which is already duplicated across
`ListPaneTitleArea.tsx` and `ListPaneHeader.tsx`, the property version lives in one shared hook
(`usePropertyNoteLink`) consumed by both components.

### Context menu

`src/hooks/useContextMenu.ts:147-152` retargets a folder right-click to the file menu when the click
landed on `.nn-navitem-name` and the folder has a folder note. The property equivalent sits alongside it,
gated on `enablePropertyNotes && enablePropertyNoteLinks`.

### Shortcuts

`SHORTCUT_PROPERTY` rows currently neither underline nor open. Both are added, mirroring
`useNavigationPaneShortcutActions.ts:157-215` (`handleShortcutFolderNoteClick`, gated on
`enableFolderNotes && enableFolderNoteLinks`) and the label class applied in
`NavigationPaneShortcutRow.tsx:92-96` and `ShortcutItem.tsx`.

### The links toggle

`enablePropertyNoteLinks: false` — with `enablePropertyNotes` on — disables the underline, the name
click, Enter-to-open, the context-menu retarget, the shortcut behavior, and the title/header link. What
survives is hiding property notes from Recent Notes.

That is deliberately thin today. For folder notes, links-off still leaves frontmatter-driven metadata,
list hiding, and note-count behavior. The property equivalent of the metadata half is deferred (see
[Non-goals](#non-goals)), and `enablePropertyNoteLinks: false` is the seam it will occupy: when metadata
lands, it slots in behind this toggle with no settings change and no further migration.

## Styling

Three classes, each added as an additional selector on its existing folder-note rule rather than
duplicating declarations:

| Class | Alongside | File |
|---|---|---|
| `nn-has-property-note` | `nn-has-folder-note` | `src/styles/sections/navigation-tree.css:260` (and `:449` for shortcut rows) |
| `nn-pane-header-property-note` | `nn-pane-header-folder-note` | `src/styles/sections/ui-headers.css:136` |
| `nn-list-title-label--property-note` | `nn-list-title-label--folder-note` | `src/styles/sections/list-files.css:59` |

## Reuse

These ship already and are used unchanged:

- `src/utils/propertyNoteLookup.ts` — `getPropertyNoteLinkTarget`, `getPropertyNoteSourcePath`,
  `resolvePropertyNote`, and `shouldAutoOpenPropertyNote` (renamed).
- `src/utils/propertyNotes.ts` — `openPropertyNoteFile`, including its `executeOpenPropertyNote` wrapper.
- `CommandQueueService.executeOpenPropertyNote` / `isOpeningPropertyNote`, and the auto-reveal guard in
  `useNavigatorReveal.ts`.

The auto-reveal suppression matters for every new entry point added here. Without it, opening a property
note lets Obsidian's `file-open` trigger auto-reveal, which jumps the navigator to the note's folder and
destroys the property selection. Every open path — name click, middle click, Enter, shortcut, title,
header — must route through `openPropertyNoteFile` rather than opening a leaf directly.

`resolveFolderNoteClickOpenContext` and `resolveFolderNoteDefaultOpenContext`
(`src/utils/keyboardOpenContext.ts`) accept `propertyNoteOpenLocation` unchanged, because
`PropertyNoteOpenLocation` is a type alias of `FolderNoteOpenLocation`.

## Non-goals

- **Frontmatter-driven metadata.** Display name, icon, colour, background, and write-back to the note's
  frontmatter are deferred to their own spec. That work is a port of the four-file `folderMetadata/`
  directory (~900 lines) plus a semantic decision folders never faced: one property note can serve many
  value nodes, so writing its icon changes every node resolving to it.
- **Everything creation-related.** No note type, name, name pattern, template, pin-on-create, or
  convert/detach/set-as commands. Property notes are found by link resolution, so there is no name
  convention to create *to*.
- **Sidebar follow-service.** No companion leaf tracking the selection. `'right-sidebar'` remains an open
  target. Folders resolve "nearest" by walking up the folder tree; property values have no equivalent
  ancestor chain.
- **`hidePropertyNoteInList`.** A note that carries its own value (`Apple.md` with `references: [[Apple]]`)
  appears in that value's list. Folders hide the folder note from its folder; the property trigger is rare
  enough not to warrant the setting.
- **New commands or public API.** No command-palette entries; `PropertyNodesAPI` is unchanged.

## Known limitation

A value node's identity comes from `normalizePropertyTreeValuePath` (`src/utils/propertyUtils.ts:176`),
which casefolds the wikilink's **display text** — the alias when present, otherwise the raw target
verbatim. So these three frontmatter values all land on the *same* node `apple`, and all display as
"Apple":

| Written in frontmatter | Value node |
|---|---|
| `Apple` (plain string) | `apple` |
| `[[Apple]]` | `apple` |
| `[[Fruits/Apple\|Apple]]` | `apple` |
| `[[Fruits/Apple]]` | `fruits/apple` — a separate node |

Each node stores one `assignmentValue`, the raw string used to resolve the note.
`shouldReplaceAssignmentValue` (`src/utils/propertyTree.ts:403`) keeps the first value seen, upgrading
once if the stored value is not link markup and a candidate is. Two consequences follow.

**Ambiguity.** If `a.md` writes `references: [[Apple]]` and `b.md` writes
`references: [[Fruits/Apple|Apple]]`, both target the same node but resolve to different files. Both are
link markup, so no upgrade applies and the first indexed wins — the row opens `Apple.md` or
`Fruits/Apple.md` depending on indexing order.

**Disappearance.** If `a.md`, `b.md` and `c.md` write plain `references: Apple` while only `d.md` writes
`references: [[Apple]]`, the node upgrades to `[[Apple]]` and the row is linkable. Delete `d.md` and the
tree rebuilds from plain strings only: `assignmentValue` reverts to `Apple`, `parsePropertyLinkTarget`
returns null, and the row silently loses its underline and its link while the row itself remains.

**A property note is a function of the corpus, not of the value.** A folder note depends only on the
folder. This is inherent to resolving wikilinks rather than using a name convention, and is invisible in
a vault that writes link values consistently — but note that the tree gives no visual clue which form a
value was written in, since all three render as "Apple".

## Testing

Extend:

- `tests/utils/propertyNoteLookup.test.ts` — rename `shouldAutoOpenPropertyNote` to
  `shouldOpenPropertyNoteOnEnter` throughout. **The case asserting `false` for arrow-key events must
  survive the rename** — it is the regression guard for the feature's most important invariant.
- `tests/hooks/useNavigationPaneTreeInteractions.test.ts` — replace the auto-open-on-row-click tests with:
  name click opens and selects; row body click selects without opening; middle click opens in a new tab;
  neither fires when the link does not resolve, when the value is a plain string, or when either toggle is
  off.
- `tests/settings/propertyNoteSettings.test.ts` — the three keys and their defaults.
- `tests/services/PluginSettingsController.test.ts` — the `autoOpenPropertyNote` migration: `true`
  produces both new keys `true`; `false` produces neither; the old key is dropped in both cases.

New:

- A test for the widened `isRecentNotesHideMode` guard: accepts all four members, rejects unknown values,
  and still accepts the two pre-existing ones so stored settings keep loading.
- A test for `RecentNotesService` hiding property notes under `'property-notes'` and `'all-notes'`, and
  not hiding them under `'none'` or `'folder-notes'`.

## i18n

In `src/i18n/locales/en.ts` (source of truth, whose type drives the other 20 locales):

- Add `settings.items.enablePropertyNotes.{name,desc}` and
  `settings.items.enablePropertyNoteLinks.{name,desc}`.
- Remove `settings.items.autoOpenPropertyNote`.
- Add the new `settings.items.hideRecentNotes.options.*` members.
- `settings.sections.propertyNotes` and `settings.items.propertyNoteOpenLocation` already exist.

All 20 non-English locales need the same changes: ar, de, es, fa, fr, id, it, ja, ko, nl, pl, pt, pt_br,
ru, th, tr, uk, vi, zh_cn, zh_tw.

## Documentation

`README.md`'s property notes bullet and settings paragraph both describe auto-open on navigation and must
be rewritten for the click/Enter model. The paragraph should state that only wikilink values have a
property note, that the name opens it while the row body selects, and that the note is never created.
