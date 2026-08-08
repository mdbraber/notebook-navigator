# Property Note Creation and Auto-Open Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a wikilink property value whose target does not exist create that note from the context menu, and let activating a property value optionally open its note.

**Architecture:** One new function, `createPropertyNote`, alongside the existing `openPropertyNoteFile`; it derives the note's folder and basename from the wikilink target, reuses the markdown-creation helper folder notes use, and opens through `openPropertyNoteFile` so the reveal suppression applies. Auto-open is a boolean re-added to the two explicit-activation paths — the property row click and the shortcut activation — deliberately not to the arrow-key path. A stale migration that deletes the reinstated setting on every load is removed.

**Tech Stack:** TypeScript, React, Obsidian API, Vitest (node environment, `obsidian` aliased to `tests/stubs/obsidian.ts`), esbuild.

## Global Constraints

- Branch `feature/property-note-creation`, which sits on top of the unmerged reveal-suppression fix. Spec: `docs/superpowers/specs/2026-08-05-property-note-creation-design.md`.
- Build must complete with **zero errors and zero warnings**: `npm run build`, `npm run lint`, and `npm run format:check` must all pass. **`format:check` is CI's first step and is not covered by build or lint** — run it before every commit.
- All new user-facing strings go in `src/i18n/locales/en.ts` first; its type drives the other 20 locales, so a missing key elsewhere is a TypeScript error.
- Every settings key must be registered in `src/settings/nativeSettingControls.ts`; the toggle/dropdown factories reject unregistered keys.
- **Never open a property note directly.** Every open — including the one creation performs — must route through `openPropertyNoteFile`, which records the path-keyed reveal suppression via `commandQueue.executeOpenPropertyNote`. Without it, Obsidian's `file-open` triggers auto-reveal and the navigator jumps to the note's folder.
- **Never attach opening to arrow-key navigation.** `selectItemAtIndex` in `src/hooks/useNavigationPaneKeyboard.ts` (~`:184-258`) dispatches `SET_SELECTED_PROPERTY` as the highlight moves. Auto-open attaches to explicit activation only: the property row click handler and the shortcut activation handler. No task in this plan edits `useNavigationPaneKeyboard.ts`, and the existing test asserting `shouldOpenPropertyNoteOnEnter` returns `false` for non-Enter events must remain untouched — it is the guard for this invariant.
- Do not modify `src/utils/fileFinder.ts`, `src/hooks/listPaneData/listItems.ts`, the pin machinery, or note counts.
- Do not modify `src/hooks/useListPaneTitle.ts` or the `BreadcrumbSegment` type.

## Two behaviours that look like bugs and are not

From the spec, both deliberate — do not "fix" either:

1. With `enablePropertyNoteLinks` **off** and `autoOpenPropertyNote` **on**, clicking the value's *name* opens the note (the name is part of the row) but there is **no underline**, because the underline is the links affordance.
2. In that same combination, **Enter does not open**. `enablePropertyNoteLinks` governs the keyboard; `autoOpenPropertyNote` governs mouse-driven navigation.

---

### Task 1: Settings and migration removal

**Files:**
- Modify: `src/settings/types.ts` (properties block, near `enablePropertyNotes` / `enablePropertyNoteLinks`)
- Modify: `src/settings/defaultSettings.ts` (same block)
- Modify: `src/settings/migrations/syncedSettings.ts` (delete the `autoOpenPropertyNote` block)
- Modify: `src/settings/nativeSettingControls.ts`
- Modify: `src/settings/tabs/PropertiesTab.ts`
- Modify: `src/settings/tabs/legacy/PropertiesLegacyTab.ts`
- Modify: `src/i18n/locales/en.ts`
- Test: `tests/settings/propertyNoteSettings.test.ts` (exists — extend)

**Interfaces:**
- Consumes: nothing.
- Produces: `autoOpenPropertyNote: boolean` (default `false`) and `propertyNoteFolder: string` (default `''`) on `NotebookNavigatorSettings`.

- [ ] **Step 1: Write the failing test**

Add to `tests/settings/propertyNoteSettings.test.ts`:

```ts
describe('property note creation settings', () => {
    it('defaults auto-open off and the folder empty', () => {
        expect(DEFAULT_SETTINGS.autoOpenPropertyNote).toBe(false);
        expect(DEFAULT_SETTINGS.propertyNoteFolder).toBe('');
    });

    it('keeps a stored autoOpenPropertyNote instead of deleting it', () => {
        // migrateLegacySyncedSettings runs on EVERY settings load, not once. A leftover
        // delete for this key would wipe the reinstated setting at every plugin start.
        const stored: Record<string, unknown> = { ...DEFAULT_SETTINGS, autoOpenPropertyNote: true };
        const migrated = runMigration(stored);
        expect(migrated.autoOpenPropertyNote).toBe(true);
    });
});
```

`runMigration` is the local helper the existing migration tests in this file already use — reuse it rather than writing a second one.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/settings/propertyNoteSettings.test.ts`
Expected: FAIL — `autoOpenPropertyNote` does not exist on `DEFAULT_SETTINGS`.

- [ ] **Step 3: Add the settings keys**

In `src/settings/types.ts`, in the properties block beside `enablePropertyNoteLinks`:

```ts
    autoOpenPropertyNote: boolean;
    propertyNoteFolder: string;
```

In `src/settings/defaultSettings.ts`, in the matching block:

```ts
    autoOpenPropertyNote: false,
    propertyNoteFolder: '',
```

- [ ] **Step 4: Delete the migration block**

In `src/settings/migrations/syncedSettings.ts`, remove the entire `autoOpenPropertyNote` block — the comment, the `if (mutableSettings.autoOpenPropertyNote === true) { ... }`, and the `delete mutableSettings.autoOpenPropertyNote;` line. Nothing replaces it.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/settings/propertyNoteSettings.test.ts`
Expected: PASS. The earlier migration tests in this file assert the old delete behaviour and will now fail — delete those cases too; they test a migration that no longer exists.

- [ ] **Step 6: Register the controls**

In `src/settings/nativeSettingControls.ts`: add `'autoOpenPropertyNote'` to the boolean-keys list and to `NATIVE_SETTING_DOM_STATE_REFRESH_KEYS`; add `'propertyNoteFolder'` to the string-keys list. It is a free-text folder path, so it does **not** go in the dropdown allowed-values map.

- [ ] **Step 7: Add the English strings**

In `src/i18n/locales/en.ts`, beside the existing property-note entries:

```ts
            autoOpenPropertyNote: {
                name: 'Open property note when navigating',
                desc: 'Open the linked note when you click a property value or activate a property shortcut. Moving through the tree with arrow keys never opens notes.'
            },
            propertyNoteFolder: {
                name: 'Property note folder',
                desc: 'Where new property notes are created. Leave empty to use Obsidian\\'s default location for new notes. Values that link to a path, like [[Fruits/Apple]], are always created at that path.'
            },
```

And in `contextMenu.property`:

```ts
            createPropertyNote: 'Create property note',
```

And in `fileSystem.errors`:

```ts
        propertyNoteAlreadyExists: 'A property note already exists for this value',
```

- [ ] **Step 8: Add both settings to the native tab**

In `src/settings/tabs/PropertiesTab.ts`, in the `propertyNotes` group after the existing `enablePropertyNoteLinks` toggle:

```ts
            createToggleDefinition('autoOpenPropertyNote', {
                name: strings.settings.items.autoOpenPropertyNote.name,
                desc: strings.settings.items.autoOpenPropertyNote.desc,
                visible: () => plugin.settings.enablePropertyNotes
            }),
            createFolderDefinition('propertyNoteFolder', {
                name: strings.settings.items.propertyNoteFolder.name,
                desc: strings.settings.items.propertyNoteFolder.desc,
                visible: () => plugin.settings.enablePropertyNotes,
                includeRoot: true
            }),
```

`createFolderDefinition` (`src/settings/nativeSettingControls.ts:366`) is the purpose-built folder-path control — use it rather than `createTextDefinition`, so the setting gets folder autocompletion. Add both factories to the import from `../nativeSettingControls`.

- [ ] **Step 9: Add both settings to the legacy tab**

In `src/settings/tabs/legacy/PropertiesLegacyTab.ts`, add both into the same dependent section the links toggle lives in, following that file's existing `new Setting(propertyNotesDependentSettingsEl)` idiom — `addToggle` for the boolean and `addText` for the folder. Read the neighbouring settings in that file and match them.

- [ ] **Step 10: Verify**

Run: `npm run format:check && npm run lint && npm run build && npx vitest run`
Expected: all clean. If the build fails on missing keys in the 20 non-English locales, add the four new keys to each using the English text verbatim — Task 5 replaces it with real translations.

- [ ] **Step 11: Commit**

```bash
git add src/settings src/i18n tests/settings
git commit -m "feat: add property note folder and auto-open settings"
```

---

### Task 2: createPropertyNote

**Files:**
- Modify: `src/utils/propertyNotes.ts`
- Test: `tests/utils/propertyNotes.test.ts` (exists — extend)

**Interfaces:**
- Consumes: `getPropertyNoteLinkTarget`, `getPropertyNoteSourcePath`, `resolvePropertyNote` from `src/utils/propertyNoteLookup.ts`; `openPropertyNoteFile` from this same file; `buildPathInFolder` from `src/utils/fileCreationUtils.ts`; `createMarkdownFileFromTemplatePreferTemplater` from `src/utils/fileCreationUtils.ts`.
- Produces:

```ts
export interface CreatePropertyNoteParams {
    app: App;
    commandQueue: CommandQueueService | null;
    node: PropertyTreeNode;
    propertyNoteFolder: string;
    openContext: 'tab' | 'right-sidebar' | null;
}

export async function createPropertyNote(params: CreatePropertyNoteParams): Promise<TFile | null>
```

Returns the created file, or `null` when the value is not a wikilink, the link already resolves, or creation failed.

- [ ] **Step 1: Write the failing tests**

Add to `tests/utils/propertyNotes.test.ts`. Reuse the `createValueNode` helper pattern from `tests/utils/propertyNoteLookup.test.ts` — copy it in rather than importing across test files:

```ts
describe('createPropertyNote', () => {
    it('creates a bare link in the configured folder', async () => {
        const app = createAppWithFolder('References');
        const node = createValueNode('references', 'apple', '[[Apple]]', ['note.md']);

        const file = await createPropertyNote({
            app,
            commandQueue: null,
            node,
            propertyNoteFolder: 'References',
            openContext: null
        });

        expect(file?.path).toBe('References/Apple.md');
    });

    it('creates a pathed link at its own path, ignoring the folder setting', async () => {
        const app = createAppWithFolder('Fruits');
        const node = createValueNode('references', 'fruits/apple', '[[Fruits/Apple]]', ['note.md']);

        const file = await createPropertyNote({
            app,
            commandQueue: null,
            node,
            propertyNoteFolder: 'References',
            openContext: null
        });

        // The folder setting cannot apply: [[Fruits/Apple]] resolves only to Fruits/Apple.md,
        // so creating it anywhere else would leave the value still showing as having no note.
        expect(file?.path).toBe('Fruits/Apple.md');
    });

    it('returns null for a plain string value', async () => {
        const app = createAppWithFolder('References');
        const node = createValueNode('status', 'draft', 'draft', ['note.md']);

        expect(
            await createPropertyNote({ app, commandQueue: null, node, propertyNoteFolder: 'References', openContext: null })
        ).toBeNull();
    });

    it('returns null when the link already resolves', async () => {
        const app = createAppWithFolder('References');
        app.metadataCache.getFirstLinkpathDest = () => createTestTFile('Apple.md');
        const node = createValueNode('references', 'apple', '[[Apple]]', ['note.md']);

        expect(
            await createPropertyNote({ app, commandQueue: null, node, propertyNoteFolder: 'References', openContext: null })
        ).toBeNull();
    });

    it('does not overwrite an existing file at the target path', async () => {
        const app = createAppWithFolder('References');
        // The link does not resolve, but something else already occupies the path.
        app.vault.getAbstractFileByPath = (path: string) =>
            path === 'References/Apple.md' ? createTestTFile('References/Apple.md') : null;
        const node = createValueNode('references', 'apple', '[[Apple]]', ['note.md']);

        expect(
            await createPropertyNote({ app, commandQueue: null, node, propertyNoteFolder: 'References', openContext: null })
        ).toBeNull();
    });

    it('opens the created note through the command queue so auto-reveal is suppressed', async () => {
        const app = createAppWithFolder('References');
        const commandQueue = new CommandQueueService();
        const node = createValueNode('references', 'apple', '[[Apple]]', ['note.md']);

        const file = await createPropertyNote({ app, commandQueue, node, propertyNoteFolder: 'References', openContext: null });

        expect(file).not.toBeNull();
        expect(commandQueue.shouldSuppressNoteOpenReveal(file!.path)).toBe(true);
    });
});
```

`createAppWithFolder(name)` is a local helper you write: an `App` stub whose `vault.getAbstractFileByPath` returns a `TFolder` for that name and `null` otherwise, whose `metadataCache.getFirstLinkpathDest` returns `null` by default, whose `vault.create` returns a `createTestTFile` at the requested path, and whose `workspace.getLeaf` returns an object with an `openFile` spy. Check what the existing tests in this file already build and extend that rather than duplicating it.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/utils/propertyNotes.test.ts`
Expected: FAIL — `createPropertyNote` is not exported.

- [ ] **Step 3: Write the implementation**

Add to `src/utils/propertyNotes.ts`:

```ts
/**
 * Resolves the folder a new property note should be created in, creating it when missing.
 * An empty setting defers to Obsidian's own default location for new notes.
 */
async function resolvePropertyNoteTargetFolder(app: App, folderPath: string, sourcePath: string): Promise<TFolder | null> {
    const trimmed = folderPath.trim();
    if (!trimmed) {
        return app.fileManager.getNewFileParent(sourcePath);
    }

    const existing = app.vault.getAbstractFileByPath(trimmed);
    if (existing instanceof TFolder) {
        return existing;
    }
    if (existing) {
        // A file already occupies the configured path.
        return null;
    }

    try {
        await app.vault.createFolder(trimmed);
    } catch {
        // Another process may have created it between the check and the call.
    }

    const created = app.vault.getAbstractFileByPath(trimmed);
    return created instanceof TFolder ? created : null;
}

export async function createPropertyNote({
    app,
    commandQueue,
    node,
    propertyNoteFolder,
    openContext
}: CreatePropertyNoteParams): Promise<TFile | null> {
    const linkTarget = getPropertyNoteLinkTarget(node);
    if (!linkTarget) {
        return null;
    }

    if (resolvePropertyNote(node, app)) {
        showNotice(strings.fileSystem.errors.propertyNoteAlreadyExists, { variant: 'warning' });
        return null;
    }

    // A pathed link resolves only to its own path, so the folder setting cannot apply to it.
    const separatorIndex = linkTarget.lastIndexOf('/');
    const baseName = separatorIndex >= 0 ? linkTarget.slice(separatorIndex + 1) : linkTarget;
    const folderPath = separatorIndex >= 0 ? linkTarget.slice(0, separatorIndex) : propertyNoteFolder;

    const targetFolder = await resolvePropertyNoteTargetFolder(app, folderPath, getPropertyNoteSourcePath(node));
    if (!targetFolder || !baseName) {
        return null;
    }

    const notePath = buildPathInFolder(targetFolder.path, `${baseName}.md`);
    if (app.vault.getAbstractFileByPath(notePath)) {
        showNotice(strings.fileSystem.errors.propertyNoteAlreadyExists, { variant: 'warning' });
        return null;
    }

    try {
        const file = await createMarkdownFileFromTemplatePreferTemplater({
            app,
            folder: targetFolder,
            baseName,
            templatePath: null,
            templateErrorContext: 'property note'
        });

        await openPropertyNoteFile({ app, commandQueue, propertyNote: file, context: openContext, active: true });
        return file;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        showNotice(strings.fileSystem.errors.createFile.replace('{error}', message), { variant: 'warning' });
        return null;
    }
}
```

Import `showNotice` and `strings` the way `src/utils/folderNotes.ts` does.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/utils/propertyNotes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run format:check && npm run lint
git add src/utils/propertyNotes.ts tests/utils/propertyNotes.test.ts
git commit -m "feat: add property note creation"
```

---

### Task 3: Create property note menu item

**Files:**
- Modify: `src/utils/contextMenu/propertyMenuBuilder.ts`

**Interfaces:**
- Consumes: `createPropertyNote` (Task 2); `getPropertyNoteLinkTarget`, `resolvePropertyNote`; `resolvePropertyTreeNode` from `src/utils/propertyTree.ts:669`; `resolveFolderNoteDefaultOpenContext` from `src/utils/keyboardOpenContext.ts`.
- Produces: nothing.

- [ ] **Step 1: Read the folder equivalent**

Read `src/utils/contextMenu/folderMenuBuilder.ts:178-241`. Note its shape: a separator, then create-when-absent, or detach+delete-when-present. **Property notes only need the create branch** — when the note exists the context-menu retarget already turns this into a file menu, which carries delete.

- [ ] **Step 2: Add the menu item**

In `buildPropertyMenu`, in the branch handling a property **value** node (not the properties root, not a key node), add:

```ts
    if (settings.enablePropertyNotes) {
        const resolved = resolvePropertyTreeNode({ nodeId: propertyNodeId, propertyTreeService });
        const valueNode = resolved?.node.kind === 'value' ? resolved.node : null;
        const canCreate = valueNode !== null && getPropertyNoteLinkTarget(valueNode) !== null && resolvePropertyNote(valueNode, app) === null;

        if (canCreate && valueNode) {
            menu.addSeparator();
            menu.addItem((item: MenuItem) => {
                setAsyncOnClick(item.setTitle(strings.contextMenu.property.createPropertyNote).setIcon('lucide-pen-box'), async () => {
                    await createPropertyNote({
                        app,
                        commandQueue: services.commandQueue,
                        node: valueNode,
                        propertyNoteFolder: settings.propertyNoteFolder,
                        openContext: resolveFolderNoteDefaultOpenContext(settings.propertyNoteOpenLocation)
                    });
                });
            });
        }
    }
```

`setAsyncOnClick` is the helper `folderMenuBuilder.ts` uses — import it from the same place. Check whether `services` exposes `commandQueue` in this builder; if it does not, read how the builder reaches other services and use the same route.

- [ ] **Step 3: Verify**

Run: `npm run format:check && npm run lint && npm run build && npx vitest run`
Expected: all clean.

Then in Obsidian: right-click a property value whose wikilink has no target — **Create property note** appears and creates the note in the configured folder. Right-click one whose link resolves — no create item, and right-clicking the name gives the file menu. Right-click a plain-string value — no create item.

- [ ] **Step 4: Commit**

```bash
git add src/utils/contextMenu/propertyMenuBuilder.ts
git commit -m "feat: add a create property note menu item"
```

---

### Task 4: Auto-open on activation

**Files:**
- Modify: `src/hooks/navigationPane/useNavigationPaneTreeInteractions.ts` (`handlePropertyClick`)
- Modify: `src/hooks/navigationPane/useNavigationPaneShortcutActions.ts` (`handleShortcutPropertyActivate`)
- Test: `tests/hooks/useNavigationPaneTreeInteractions.test.ts` (exists — extend)

**Interfaces:**
- Consumes: `autoOpenPropertyNote` (Task 1); `resolvePropertyNote`, `openPropertyNoteFile`, `resolveFolderNoteDefaultOpenContext`.
- Produces: nothing.

**Do not touch `selectItemAtIndex`** in `src/hooks/useNavigationPaneKeyboard.ts`. Arrow keys must never open.

- [ ] **Step 1: Write the failing tests**

Extend the existing `describe('property note name clicks', ...)` block in `tests/hooks/useNavigationPaneTreeInteractions.test.ts` — its `renderPropertyRow` harness already returns `nameClick`, `rowClick`, `openFile` and `selectionDispatch`. Add an `autoOpen` flag to that harness's params, defaulting to `false`, which sets `autoOpenPropertyNote` in the settings it builds. Then:

```ts
    it('opens on a row body click when auto-open is on', async () => {
        const file = createTestTFile('Apple.md');
        const { rowClick, openFile } = renderPropertyRow({
            assignmentValue: '[[Apple]]',
            enabled: true,
            autoOpen: true,
            resolved: file
        });
        rowClick();
        await Promise.resolve();
        expect(openFile).toHaveBeenCalledWith(file, { active: true });
    });

    it('still dispatches selection when auto-open fires', async () => {
        const { rowClick, selectionDispatch, valueNode } = renderPropertyRow({
            assignmentValue: '[[Apple]]',
            enabled: true,
            autoOpen: true,
            resolved: createTestTFile('Apple.md')
        });
        rowClick();
        await Promise.resolve();
        expect(selectionDispatch).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'SET_SELECTED_PROPERTY', nodeId: valueNode.id })
        );
    });

    it('does not open on a row body click when auto-open is off', async () => {
        const { rowClick, openFile } = renderPropertyRow({
            assignmentValue: '[[Apple]]',
            enabled: true,
            autoOpen: false,
            resolved: createTestTFile('Apple.md')
        });
        rowClick();
        await Promise.resolve();
        expect(openFile).not.toHaveBeenCalled();
    });

    it('opens on a row body click even with links off', async () => {
        // autoOpenPropertyNote is independent of enablePropertyNoteLinks: it governs
        // mouse-driven navigation, links governs the name affordance and the keyboard.
        const file = createTestTFile('Apple.md');
        const { rowClick, openFile } = renderPropertyRow({
            assignmentValue: '[[Apple]]',
            enabled: false,
            autoOpen: true,
            resolved: file
        });
        rowClick();
        await Promise.resolve();
        expect(openFile).toHaveBeenCalledWith(file, { active: true });
    });

    it('does not open on a row body click for an unresolvable link', async () => {
        const { rowClick, openFile } = renderPropertyRow({
            assignmentValue: '[[Ghost]]',
            enabled: true,
            autoOpen: true,
            resolved: null
        });
        rowClick();
        await Promise.resolve();
        expect(openFile).not.toHaveBeenCalled();
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/hooks/useNavigationPaneTreeInteractions.test.ts`
Expected: FAIL — the row click does not open.

- [ ] **Step 3: Add auto-open to the row click**

In `handlePropertyClick`, resolve the note **before** `applyTreeSelection` so the selection can suppress the list pane's auto-selected first file, then open after. This mirrors what `handlePropertyNameClick` already does:

```ts
            const propertyNote =
                settings.enablePropertyNotes && settings.autoOpenPropertyNote ? resolvePropertyNote(propertyNode, app) : null;
```

Pass `...(propertyNote ? { autoSelectedFile: null } : {})` in the `SET_SELECTED_PROPERTY` dispatch inside `onSelect`, and after `applyTreeSelection`:

```ts
            if (propertyNote) {
                runAsyncAction(() =>
                    openPropertyNoteFile({
                        app,
                        commandQueue,
                        propertyNote,
                        context: resolveFolderNoteDefaultOpenContext(settings.propertyNoteOpenLocation)
                    })
                );
            }
```

Add `app`, `commandQueue`, `settings.enablePropertyNotes`, `settings.autoOpenPropertyNote` and `settings.propertyNoteOpenLocation` to the callback's dependency array. The master toggle gates this exactly as it gates every other property-note behaviour.

**Leave the search-modifier check at the top of the handler exactly where it is.** Cmd/Alt+click must still add the value to the search filter rather than opening — that was a regression fixed in the previous branch.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/hooks/useNavigationPaneTreeInteractions.test.ts`
Expected: PASS.

- [ ] **Step 5: Add auto-open to shortcut activation**

In `src/hooks/navigationPane/useNavigationPaneShortcutActions.ts`, `handleShortcutPropertyActivate` (~`:366`) currently only selects the property node.

**Do not reuse `resolveShortcutPropertyNote` here.** That helper already exists in this file, but it gates on `enablePropertyNotes && enablePropertyNoteLinks` — and auto-open must work with links *off*. Resolve directly instead:

```ts
            const resolved = resolvePropertyTreeNode({ nodeId: propertyNodeId, propertyTreeService });
            const propertyNote =
                settings.enablePropertyNotes && settings.autoOpenPropertyNote && resolved
                    ? resolvePropertyNote(resolved.node, app)
                    : null;
```

then open through `openPropertyNoteFile` with `resolveFolderNoteDefaultOpenContext(settings.propertyNoteOpenLocation)`, after the selection dispatch. Update the dependency array.

- [ ] **Step 6: Verify**

Run: `npm run format:check && npm run lint && npm run build && npx vitest run`
Expected: all clean.

Then in Obsidian, with auto-open on: click a property value row — the list fills **and** the note opens. **Arrow-key down through several such values — nothing opens.** Press Enter with links on — it opens; with links off — it does not. Cmd/Alt+click the row — the search filter updates and nothing opens.

- [ ] **Step 7: Commit**

```bash
git add src/hooks tests/hooks
git commit -m "feat: open property notes when navigating, when enabled"
```

---

### Task 5: Translations and documentation

**Files:**
- Modify: `src/i18n/locales/{ar,de,es,fa,fr,id,it,ja,ko,nl,pl,pt,pt_br,ru,th,tr,uk,vi,zh_cn,zh_tw}.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: the English keys from Task 1.
- Produces: nothing.

- [ ] **Step 1: Confirm the state**

Run: `npm run build`
Expected: clean — Task 1 added English placeholders to every locale.

- [ ] **Step 2: Translate**

For each of the 20 locales, replace the placeholder English text of these four entries with real translations:

- `settings.items.autoOpenPropertyNote.{name,desc}`
- `settings.items.propertyNoteFolder.{name,desc}`
- `contextMenu.property.createPropertyNote`
- `fileSystem.errors.propertyNoteAlreadyExists`

Read each file's neighbouring `enablePropertyNotes`, `enablePropertyNoteLinks`, `contextMenu.folder.createFolderNote` and `fileSystem.errors.folderNoteAlreadyExists` entries first and match their terminology. Key names never change; only the human-readable values.

- [ ] **Step 3: Verify**

Run: `npm run format:check && npm run lint && npm run build`
Expected: all clean.

- [ ] **Step 4: Update the README**

Extend the property notes paragraph with: property notes can be created from a property value's context menu when its link has no target; where they land (the configured folder, or the link's own path for a pathed link); that navigating to a value can optionally open its note while arrow keys never do; and that on macOS Enter renames a folder but opens a property note, because property rows have no inline rename.

- [ ] **Step 5: Full verification**

Run: `npx vitest run && npm run format:check && npm run lint && npm run build`
Expected: all tests pass, zero errors, zero warnings.

- [ ] **Step 6: Commit**

```bash
git add src/i18n README.md
git commit -m "feat: translate property note creation settings and document the feature"
```

---

## Known limitation — do not try to fix

A value node's identity comes from the wikilink's display text (`src/utils/propertyUtils.ts:176`), and `assignmentValue` is first-writer-wins with one upgrade to link markup (`src/utils/propertyTree.ts:403`). So when two notes contribute different link targets to the same value node, indexing order decides which target is used — for opening **and now for creating**, since creation derives its path from the same value. Documented in the spec. Do not add caching, tie-breaking, or normalization to work around it.
