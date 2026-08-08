# Property note creation and auto-open — design

**Date:** 2026-08-05
**Status:** Approved, ready for implementation planning
**Builds on:** [`2026-08-05-property-note-links-design.md`](2026-08-05-property-note-links-design.md)

## Summary

Two additions to property notes:

1. **Create property note** — a context-menu action for a wikilink value whose target does not exist,
   creating the note in a configurable folder. Mirrors folder notes' create flow.
2. **Auto-open on navigation** — an opt-in setting where activating a property value both fills the list
   pane and opens its property note.

Plus one settings-shape change that the second item forces: `autoOpenPropertyNote` returns as a real
setting, which means the migration that deletes it must be removed.

## Motivation

Property notes are currently discoverable only if they already exist. A wikilink value pointing at a
missing note gives no way to create it from the navigator, unlike folders. And the earlier decision to
route all opening through the value's *name* suits people who want the row body to stay a pure selector,
but not people who want navigating to a value to just show them the note.

These are two different questions — "is the name a link?" and "does navigating also open?" — and they are
answered by two independent toggles rather than one mode. With both on the behaviors overlap, which is
redundancy, not ambiguity.

## Settings

Five settings in the existing **Property notes** group, two of them new.

| Key | Type | Default | Status |
|---|---|---|---|
| `enablePropertyNotes` | `boolean` | `false` | unchanged |
| `enablePropertyNoteLinks` | `boolean` | `true` | unchanged |
| `autoOpenPropertyNote` | `boolean` | `false` | **reinstated** |
| `propertyNoteOpenLocation` | `'current-tab' \| 'new-tab' \| 'right-sidebar'` | `'current-tab'` | unchanged |
| `propertyNoteFolder` | `string` | `''` | **new** |

`enablePropertyNoteLinks` governs the underline, the name click, Enter, the context-menu retarget and the
shortcut label. `autoOpenPropertyNote` governs opening on row click and shortcut activation.
`propertyNoteFolder` is a folder picker; empty means Obsidian's own default location for new notes.

### Delete the existing migration block

`src/settings/migrations/syncedSettings.ts` currently ends its property-note block with
`delete mutableSettings.autoOpenPropertyNote`, and `migrateLegacySyncedSettings` runs on **every**
settings load, not once. Leaving it would delete the reinstated setting at every plugin start, so the
toggle would appear to reset itself.

**Delete the whole `autoOpenPropertyNote` migration block.** No replacement migration is needed — this
setting has never been in a release and the only install that ever held it is a development vault. This
is a line removal, not migration work.

## Behavior

A property note exists only for a **value node** whose `assignmentValue` parses as a strict wikilink and
resolves to a file. Key nodes never have one.

| | links off, auto off | links **on**, auto off | links off, auto **on** | both **on** |
|---|---|---|---|---|
| Underline on the value name | no | yes | no | yes |
| Click the **name** | select | select + open | select + open | select + open |
| Click the **row body** | select | select | select + open | select + open |
| Middle-click the name | — | new tab | — | new tab |
| **Enter** | select | open | select | open |
| Arrow keys | select | select | select | select |
| Right-click the name → file menu | no | yes | no | yes |
| Property shortcut label | plain | underlined, opens | plain | underlined, opens |
| Property shortcut row activation | navigate | navigate | navigate + open | navigate + open |
| Recent Files hiding | works | works | works | works |

**Arrow keys never open a note, in any combination.** This is the feature's most important invariant and
is pinned by `shouldOpenPropertyNoteOnEnter`'s test asserting `false` for non-Enter events. Auto-open
attaches to explicit activation only — a row click or a shortcut activation — never to selection changes
driven by `selectItemAtIndex`.

Two consequences of that split are intended rather than oversights, and should not be "fixed" during
implementation:

- In the **"links off, auto on"** column the name click opens — because the *row* click opens and the
  name is part of the row — yet there is no underline, because the underline is the links affordance.
- In that same column **Enter does not open**. `enablePropertyNoteLinks` governs the keyboard;
  `autoOpenPropertyNote` governs mouse-driven navigation. Enter acts on the value that is already
  selected, so it is not navigation. Someone running links-off with auto-open on has deliberately opted
  into a mouse-only interaction.

Every open path, including the one auto-open adds, must route through `openPropertyNoteFile`. It wraps
the open in `commandQueue.executeOpenFolderNote`'s sibling `executeOpenPropertyNote`, which records the
path-keyed reveal suppression. Without it, Obsidian's `file-open` triggers auto-reveal and the navigator
jumps to the note's folder.

## Creating property notes

### Where the action appears

A **Create property note** item on the property value's context menu, mirroring the folder-note create
item at `src/utils/contextMenu/folderMenuBuilder.ts:206`. It appears only when:

- `enablePropertyNotes` is on, and
- the value's `assignmentValue` is a strict wikilink, and
- that wikilink does **not** resolve to an existing file.

When the link does resolve, no create item appears — and the existing context-menu retarget already
gives the file menu for that note, which carries delete. So there are no separate detach or delete
entries; folder notes need them because their menu never becomes a file menu.

### Where the file lands

- **Bare link** (`[[Apple]]`) → `<propertyNoteFolder>/Apple.md`, or Obsidian's default new-note location
  when `propertyNoteFolder` is empty.
- **Pathed link** (`[[Fruits/Apple]]`) → `Fruits/Apple.md`, **bypassing `propertyNoteFolder` entirely**.
  That is the only path the link resolves to; honoring the folder setting would create a note the link
  can never find, leaving the value still showing as having no note.

The basename always comes from the wikilink target, never from a pattern. This is settled from the
2026-08-04 design: lookup is link resolution, so any other name would be unfindable.

### How it creates

Always **markdown**. No file-type choice and no template — which means no generalization of
`FolderNoteTypeModal` is needed, and `propertyNoteType` / `propertyNoteTemplate` do not exist.

Reuses `createMarkdownFileFromTemplatePreferTemplater` with a null template, so Templater's new-file
hooks fire the same way they do for folder notes.

If a file already exists at the computed path, abort with a notice, mirroring
`strings.fileSystem.errors.folderNoteAlreadyExists`.

On success, open the new note through `openPropertyNoteFile`, honoring `propertyNoteOpenLocation` — so
the reveal suppression applies and the navigator does not jump to the new note's folder.

### Module

One new exported function, `createPropertyNote`, alongside `openPropertyNoteFile` in
`src/utils/propertyNotes.ts`:

```ts
export async function createPropertyNote(params: {
    app: App;
    commandQueue: CommandQueueService | null;
    node: PropertyTreeNode;
    propertyNoteFolder: string;
    openContext: 'tab' | 'right-sidebar' | null;
}): Promise<TFile | null>
```

It returns the created file, or `null` when the value is not a wikilink, the link already resolves, or
creation failed.

## Non-goals

- **File type and template settings.** Lookup already finds any file type the wikilink resolves to, so
  you can still *use* a canvas property note — you just cannot have the plugin create one.
- **`pinCreatedPropertyNote`.** Folder notes have it; property notes do not pin on create.
- **Detach and delete menu entries.** Covered by the retargeted file menu.
- **Known gap:** that retarget assumed the two toggles below would move together, and they don't.
  With `enablePropertyNoteLinks` off and `autoOpenPropertyNote` on, a property value can navigate to
  and open an existing note, yet the retarget that would put delete on its context menu is gated on
  `enablePropertyNoteLinks` alone (`src/hooks/useContextMenu.ts:158-160`), and no create item shows
  because the note already exists. The note has no delete path from the navigator in that
  combination. Workaround: turn links on, or delete from the list pane. Not fixed here — closing it
  is a design decision (e.g. gating the retarget on either toggle), not a bug fix.
- **Frontmatter-driven metadata** — display name, icon, colour, write-back. Still deferred to its own
  spec.
- **Changing the macOS Enter behaviour.** `PANE_RENAME` is bound to Enter on macOS and is checked at
  `src/hooks/useNavigationPaneKeyboard.ts:275`, before any note opening, so Enter renames a folder and
  never opens its folder note. Property *value* rows have no inline-rename target, so Enter falls through
  and opens the note. The divergence is deliberate: Enter is otherwise unused on those rows, and matching
  folders would mean removing keyboard opening from macOS entirely. Documented in the README rather than
  changed.

## Known limitation

Carried forward unchanged. A value node's identity comes from the wikilink's **display text**
(`src/utils/propertyUtils.ts:176`) — the alias when present, the raw target otherwise. So plain `Apple`,
`[[Apple]]` and `[[Fruits/Apple|Apple]]` collapse into one node and render identically, while unaliased
`[[Fruits/Apple]]` gets its own. `assignmentValue` is first-writer-wins with one upgrade to link markup
(`src/utils/propertyTree.ts:403`), so when two notes contribute different link targets to the same node,
indexing order decides which note opens — and which note **gets created**, since creation uses the same
target. Deleting the only note that used link markup silently removes the link from a row that survives.

## Testing

- `tests/utils/propertyNotes.test.ts` — `createPropertyNote`: bare link lands in the configured folder;
  bare link with an empty setting lands in Obsidian's default location; pathed link bypasses the folder
  setting; a plain-string value returns `null`; an already-resolving link returns `null`; an existing
  file at the target path aborts without overwriting; the created note is opened through
  `openPropertyNoteFile` so the reveal suppression is recorded.
- `tests/hooks/useNavigationPaneTreeInteractions.test.ts` — with `autoOpenPropertyNote` on, a row-body
  click opens the note **and** still dispatches selection; with it off, the row body only selects; the
  name click behaves per `enablePropertyNoteLinks` independently of the auto-open toggle.
- `tests/utils/propertyNoteLookup.test.ts` — the existing case asserting `shouldOpenPropertyNoteOnEnter`
  returns `false` for non-Enter events must survive untouched. It is the arrow-key guard.
- `tests/settings/propertyNoteSettings.test.ts` — the two new defaults, plus one case asserting a stored
  `autoOpenPropertyNote: true` survives a settings load. One assertion, and it is the only thing standing
  between the deleted migration block and a toggle that silently resets.

## i18n

New keys in `src/i18n/locales/en.ts` and all 20 other locales:

- `settings.items.autoOpenPropertyNote.{name,desc}` — reinstated; the previous English text described
  opening on any row click, which is again accurate.
- `settings.items.propertyNoteFolder.{name,desc}`
- `contextMenu.property.createPropertyNote`
- `fileSystem.errors.propertyNoteAlreadyExists`

## Documentation

`README.md`'s property notes paragraph gains: property notes can be created from the context menu when
the link has no target; where they land; that navigating can optionally open them; and the macOS Enter
divergence.
