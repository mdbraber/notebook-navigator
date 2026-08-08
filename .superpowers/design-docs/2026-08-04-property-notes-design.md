# Property notes — design

> **Superseded in part — implemented with changes.** Two things described below were cut during
> execution and never shipped: the **clickable list-pane breadcrumb segment** (referred to here as the
> feature's first half) and the **`enablePropertyNoteLinks` setting** listed in the settings table.
> What shipped is auto-open only, gated on `autoOpenPropertyNote` with `propertyNoteOpenLocation`.
> The record of what was actually built is
> [`docs/superpowers/plans/2026-08-04-property-notes.md`](../plans/2026-08-04-property-notes.md).
> The body below is kept unedited as the original design.

**Date:** 2026-08-04
**Status:** Implemented with changes (see banner above)

## Summary

When navigating a property value that is a wikilink — `references → [[Apple]]` — give access to the note
the link points at:

1. The value segment of the list-pane breadcrumb becomes **clickable**.
2. Optionally, the note **opens automatically** when you navigate to that value.

Nothing else changes. The list pane contents, sorting, pinning, and note counts are untouched.

## Motivation

Selecting a property value in the navigation pane shows every note carrying that value. When the value is
a wikilink, the note it points at is conceptually the hub for that group — but there is currently no way
to reach it from the property view, because it does not normally carry the property itself.

The list-pane breadcrumb already renders that value as its last segment. Making it a link is the smallest
change that closes the gap.

## What a property note is

A property note exists only for a **value node** (`key:references=apple`) whose `assignmentValue` parses
as a strict wikilink. Key nodes (`key:references`) and the properties root never have one. Plain-string
values (`status: draft`) never have one.

```
PropertyTreeNode.assignmentValue   "[[Fruits/Apple|Apple]]"
  -> parsePropertyLinkTarget()      { kind: 'internal', target: 'Fruits/Apple' }
```

Resolution uses the link **target**, not the display text: `[[Fruits/Apple|Apple]]` normalizes to the
value node `apple` but points at `Fruits/Apple`.

Because this is ordinary link resolution, any file type Obsidian resolves to works — markdown, canvas,
base, Excalidraw — with no setting involved.

## Non-goals

Explicitly out of scope:

- **List pane membership.** The property note does not join the result set, is not pinned, and does not
  affect note counts.
- **Creation settings.** No note type, template, or target folder. Clicking an unresolved link falls
  through to Obsidian's own behavior (see [Unresolved links](#unresolved-links)).
- **Navigation pane row link.** The property row name does not become a link affordance the way a folder
  name does — no underline decoration, no separate click target. The row selects the value exactly as it
  does today. (Auto-open, when enabled, hooks that same selection; it is a setting, not a link.)
- **Sidebar follow-service.** No companion leaf that tracks the selection. `'right-sidebar'` is available
  as an open target only.
- **Frontmatter-driven appearance.** The property note does not drive the value's icon, color, or display
  name.
- **New commands or public API.** No command-palette entries; `PropertyNodesAPI` is unchanged.

## Settings

One group, **Property notes**, in the existing Tags & properties pane (`tags-properties`), added by
`src/settings/tabs/PropertiesTab.ts` and mirrored in `src/settings/tabs/legacy/PropertiesLegacyTab.ts`.

| Key | Type | Default | Notes |
|---|---|---|---|
| `enablePropertyNoteLinks` | `boolean` | `false` | Breadcrumb value segment becomes a link |
| `autoOpenPropertyNote` | `boolean` | `false` | Opens the note on explicit activation |
| `propertyNoteOpenLocation` | `'current-tab' \| 'new-tab' \| 'right-sidebar'` | `'current-tab'` | Visible when either boolean is on |

There is no master toggle. The two booleans are independent — either can be used without the other.

There is no "Property note files" group. With creation out of scope, nothing about the file itself is
configurable.

### Registration

- Interface in `src/settings/types.ts`, with a `PropertyNoteOpenLocation` union and an
  `isPropertyNoteOpenLocation` guard mirroring `FolderNoteOpenLocation` (`:364`).
- Defaults in `src/settings/defaultSettings.ts`.
- All three keys registered in `src/settings/nativeSettingControls.ts` — the toggle and dropdown
  factories reject unregistered keys. Both booleans belong in `NATIVE_SETTING_DOM_STATE_REFRESH_KEYS` so
  the visibility of `propertyNoteOpenLocation` re-evaluates.
- `src/settings/transfer.ts` uses a denylist, so the new keys sync by default. No change needed.
- No migration required: all keys are new and defaults apply to existing vaults.

## Behavior

### Breadcrumb link

`useListPaneTitle.ts:451` currently builds two segments for a property value selection:

```ts
[
  { label: displayKey, targetType: 'property', targetPath: keyNodeId, isLast: false },
  { label: valueNode?.displayPath ?? parsed.valuePath, targetType: 'none', isLast: true }
]
```

The second segment gains a link target when `enablePropertyNoteLinks` is on and the value node's
`assignmentValue` parses as a wikilink. `valueNode` is already in scope at `:446`, so no extra lookup is
needed.

`ListPaneHeader.tsx` renders the segment as a link and handles activation:

- **Click** opens the note, honoring `propertyNoteOpenLocation`.
- **Middle click** opens in a new tab, matching the folder-note breadcrumb behavior at
  `ListPaneHeader.tsx:144-231`.
- Modifier handling mirrors `resolveFolderNoteClickOpenContext` (`src/utils/keyboardOpenContext.ts:75`).

Styling reuses the folder-note treatment — a class alongside `nn-pane-header-folder-note` in
`src/styles/sections/ui-headers.css:136`.

When `enablePropertyNoteLinks` is off, or the value is not a wikilink, the segment stays
`targetType: 'none'` exactly as today.

### Auto-open

When `autoOpenPropertyNote` is on, navigating to a property value whose wikilink **resolves to an
existing file** opens that file, honoring `propertyNoteOpenLocation`.

**Fires on explicit activation only** — clicking a property value row, or pressing Enter on it. It does
*not* fire on arrow-key movement through the tree, which would otherwise open a note per keystroke.

Auto-open never creates a file. If the link does not resolve, nothing happens.

Selection behavior is unchanged: the list pane still populates with everything carrying that value. The
note opening is additional, matching `handleFolderNameClick`
(`src/hooks/navigationPane/useNavigationPaneTreeInteractions.ts:221`), which dispatches selection at
`:236` and opens at `:254`.

### Unresolved links

The breadcrumb link is shown whenever the value is a **valid wikilink**, whether or not it resolves.
Clicking uses `app.workspace.openLinkText(target, sourcePath)`, which follows Obsidian's own semantics:
open the note if it exists, create it if it does not, in the location Obsidian is configured to use.

This is deliberate — it matches what clicking a wikilink does everywhere else in Obsidian, and it gives
note creation for free without a single setting. The unresolved segment should carry a distinct class so
it can be styled the way Obsidian styles unresolved links.

Auto-open is the exception: it requires the link to resolve, so navigating never silently creates files.

### Source path for resolution

`openLinkText` and any resolution check need a `sourcePath`, and a value node has no single source file.
Use the **lexicographically first path in `node.notesWithValue`** — deterministic across rebuilds, and it
resolves the link exactly as Obsidian would from a note that actually references the value.

## Architecture

### New module

**`src/utils/propertyNoteLookup.ts`** — small and pure apart from the vault lookup:

- `getPropertyNoteLinkTarget(valueNode)` — returns the wikilink target, or `null` when the value is not a
  wikilink. Drives whether the breadcrumb is a link.
- `resolvePropertyNote(valueNode, app)` — returns `TFile | null`. Drives auto-open.
- `getPropertySourcePath(valueNode)` — the deterministic source path above.

No other new modules. Opening reuses the existing open-in-context helpers rather than a
`propertyNotes.ts` mirror of `folderNotes.ts`.

### Touch points

| Concern | File | Change |
|---|---|---|
| Breadcrumb segment target | `src/hooks/useListPaneTitle.ts:451` | Last segment gains a link target |
| Breadcrumb rendering + activation | `src/components/ListPaneHeader.tsx` | Click / middle-click handling |
| Auto-open on click | `src/hooks/navigationPane/useNavigationPaneTreeInteractions.ts:645` | Open after selection dispatch |
| Auto-open on Enter | `src/hooks/useNavigationPaneKeyboard.ts:227` | Same, for keyboard activation |
| Open context resolution | `src/utils/keyboardOpenContext.ts` | Property equivalent of `resolveFolderNoteClickOpenContext` |
| Settings | `src/settings/types.ts`, `defaultSettings.ts`, `nativeSettingControls.ts`, `tabs/PropertiesTab.ts`, `tabs/legacy/PropertiesLegacyTab.ts` | Three keys, one group |
| Styling | `src/styles/sections/ui-headers.css:136` | Link + unresolved classes |
| i18n | `src/i18n/locales/en.ts` + 20 locales | See below |

`fileFinder.ts`, `listItems.ts`, the pin machinery, and note counts are **untouched**.

## Known limitation

`PropertyTreeNode.assignmentValue` is an aggregation artifact, not an identity. It answers "what string
should I write when assigning this value," and `shouldReplaceAssignmentValue`
(`src/utils/propertyTree.ts:403`) is first-writer-wins, upgraded once if link markup appears. So:

- If one note writes `[[Apple]]` and another writes `[[Fruits/Apple|Apple]]`, they collapse into the same value
  node and **indexing order decides which note the breadcrumb links to.**
- If the only note using `[[Apple]]` is deleted and the remaining notes wrote plain `Apple`, the value
  node survives but the breadcrumb link **disappears**.

In short: **the property note is a function of the corpus, not of the value.** A folder note depends only
on the folder. This is inherent to resolving wikilinks rather than using a name convention, and is
invisible in a vault that writes link values consistently. Documented here rather than left to be
discovered as a bug.

The `sourcePath` choice is a smaller instance of the same thing: deterministic, but arbitrary when a bare
link is ambiguous across folders.

## Testing

New:

- `tests/utils/propertyNoteLookup.test.ts` — bare, aliased, and pathed wikilinks; plain-string values,
  key nodes, and the properties root all returning `null`; resolved versus unresolved links;
  `sourcePath` determinism across rebuilds.

Extended:

- `tests/hooks/useListPaneTitle.test.ts` (or a new file if none exists) — the value segment gains a
  target only when the setting is on and the value is a wikilink; stays `targetType: 'none'` otherwise.
- `tests/hooks/useNavigationPaneTreeInteractions.test.ts` — auto-open fires on click and Enter, does not
  fire on arrow-key movement, does not fire for unresolved links, and does not disturb list selection.
- `tests/services/PluginSettingsController.test.ts`, `tests/settings/transfer.test.ts` — new keys.

## i18n

Following the folder-notes structure in `src/i18n/locales/en.ts` (the source of truth whose type drives
all other locales via `src/i18n/index.ts:24`):

- `settings.sections.propertyNotes`
- `settings.items.enablePropertyNoteLinks.{name,desc}`
- `settings.items.autoOpenPropertyNote.{name,desc}`
- `settings.items.propertyNoteOpenLocation.{name,desc,options.{currentTab,newTab,rightSidebar}}`

All 20 non-English locales need the same keys: ar, de, es, fa, fr, id, it, ja, ko, nl, pl, pt, pt_br, ru,
th, tr, uk, vi, zh_cn, zh_tw.

## Documentation

`README.md` gains the three settings in the features list and a short note that property notes are found
by link resolution, so only wikilink values have one.
