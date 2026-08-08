# Property Note Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give property values the folder-note interaction model — underlined name, name click opens the note, row body selects, Enter opens — replacing the `autoOpenPropertyNote` setting that opens on any row click.

**Architecture:** Two new settings (`enablePropertyNotes`, `enablePropertyNoteLinks`) replace `autoOpenPropertyNote` and gate every surface. The existing lookup (`propertyNoteLookup.ts`) and opener (`propertyNotes.ts`) carry over untouched — this plan adds entry points, it does not change how a property note is found or opened. Each surface is a direct port of its folder-note counterpart: the nav row mirrors `FolderItem` + `handleFolderNameClick`, the title surfaces mirror the folder-note header treatment via one shared hook, and the context menu, shortcut rows and Recent Notes filter each mirror a specific existing block.

**Tech Stack:** TypeScript, React, Obsidian API, Vitest (node environment, `obsidian` aliased to `tests/stubs/obsidian.ts`), esbuild.

## Global Constraints

- Branch from `main`. Spec: `docs/superpowers/specs/2026-08-05-property-note-links-design.md`.
- Build must complete with **zero errors and zero warnings**: `npm run build`, `npm run lint`, and `npm run format:check` must all pass. **`format:check` is CI's first step and is not covered by build or lint** — run it before every commit.
- All new user-facing strings go in `src/i18n/locales/en.ts` first; its type drives the other 20 locales, so a missing key elsewhere is a TypeScript error.
- Every settings key must be registered in `src/settings/nativeSettingControls.ts`; the toggle/dropdown factories reject unregistered keys.
- Settings sync via a denylist (`NON_TRANSFERABLE_SETTING_KEYS` in `src/settings/transfer.ts`). New keys sync by default — **do not** add them there.
- Tests live at `tests/**/*.test.ts` — `.ts`, not `.tsx`, even for hook tests (they render via `renderToStaticMarkup` from `react-dom/server`).
- Every new source file starts with the GPL header block copied verbatim from a file in the same directory.
- **Never open a property note directly.** Every open path must route through `openPropertyNoteFile`, which wraps the open in `commandQueue.executeOpenPropertyNote`. Without that wrapper Obsidian's `file-open` triggers auto-reveal and the navigator jumps to the note's folder, destroying the property selection.
- **Never hook auto-open into arrow-key navigation.** `selectItemAtIndex` in `src/hooks/useNavigationPaneKeyboard.ts` (~`:184-258`) dispatches `SET_SELECTED_PROPERTY` as the highlight moves. Opening there fires a note per keystroke.
- Do not modify `src/utils/fileFinder.ts`, `src/hooks/listPaneData/listItems.ts`, the pin machinery, or note counts.
- Do not modify `src/hooks/useListPaneTitle.ts` or the `BreadcrumbSegment` type.

## Out of scope

Frontmatter-driven metadata (name, icon, colour, write-back) is deferred to its own spec. Do not add a `propertyMetadata/` directory, a display cache, or any frontmatter reads. `enablePropertyNoteLinks: false` is deliberately thin for now — it leaves only Recent Notes hiding active.

---

### Task 1: Settings foundation, helper regate and migration

**Files:**
- Modify: `src/settings/types.ts` (properties block at `:742-743`)
- Modify: `src/settings/defaultSettings.ts` (`:300-301`)
- Modify: `src/settings/nativeSettingControls.ts`
- Modify: `src/settings/migrations/syncedSettings.ts`
- Modify: `src/settings/tabs/PropertiesTab.ts`
- Modify: `src/settings/tabs/legacy/PropertiesLegacyTab.ts`
- Modify: `src/i18n/locales/en.ts`
- Modify: `src/utils/propertyNoteLookup.ts`
- Modify: `src/hooks/useNavigationPaneKeyboard.ts`
- Modify: `src/hooks/navigationPane/useNavigationPaneTreeInteractions.ts`
- Test: `tests/settings/propertyNoteSettings.test.ts` (exists — extend)
- Test: `tests/utils/propertyNoteLookup.test.ts` (exists — rename references)

**Interfaces:**
- Consumes: nothing.
- Produces: `enablePropertyNotes: boolean` (default `false`) and `enablePropertyNoteLinks: boolean` (default `true`) on `NotebookNavigatorSettings`. `autoOpenPropertyNote` no longer exists. `propertyNoteOpenLocation` and its `PropertyNoteOpenLocation` type are unchanged. Also:

```ts
export interface ShouldOpenPropertyNoteOnEnterParams {
    isEnterKey: boolean;
    propertyNoteLinksEnabled: boolean;
    selectionType: NavigationItemType;
    selectedProperty: PropertySelectionNodeId | null;
}

export function shouldOpenPropertyNoteOnEnter(params: ShouldOpenPropertyNoteOnEnterParams): boolean
```

`shouldAutoOpenPropertyNote` and `ShouldAutoOpenPropertyNoteParams` no longer exist. Callers compute `propertyNoteLinksEnabled` as `settings.enablePropertyNotes && settings.enablePropertyNoteLinks`.

**This task must end with a green build.** Removing `autoOpenPropertyNote` breaks two call sites; both are repaired here so the commit builds.

- [ ] **Step 1: Write the failing test**

Replace the first `it` block in `tests/settings/propertyNoteSettings.test.ts` and add a migration test. The existing open-location tests stay untouched:

```ts
describe('property note settings', () => {
    it('defaults the feature off and links on', () => {
        expect(DEFAULT_SETTINGS.enablePropertyNotes).toBe(false);
        expect(DEFAULT_SETTINGS.enablePropertyNoteLinks).toBe(true);
    });

    it('no longer carries the auto-open setting', () => {
        expect('autoOpenPropertyNote' in DEFAULT_SETTINGS).toBe(false);
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/settings/propertyNoteSettings.test.ts`
Expected: FAIL — `enablePropertyNotes` does not exist on `DEFAULT_SETTINGS`.

- [ ] **Step 3: Swap the settings keys**

In `src/settings/types.ts`, replace `autoOpenPropertyNote: boolean;` (`:742`) with:

```ts
    enablePropertyNotes: boolean;
    enablePropertyNoteLinks: boolean;
```

In `src/settings/defaultSettings.ts`, replace `autoOpenPropertyNote: false,` (`:300`) with:

```ts
    enablePropertyNotes: false,
    enablePropertyNoteLinks: true,
```

- [ ] **Step 4: Rename the helper's test references**

In `tests/utils/propertyNoteLookup.test.ts`, rename the import and every call from `shouldAutoOpenPropertyNote` to `shouldOpenPropertyNoteOnEnter`, and the `autoOpenPropertyNote` argument to `propertyNoteLinksEnabled`. **The case asserting `false` for a non-Enter event must survive verbatim** — it is the regression guard that stops arrow-key movement opening a note. Its body becomes:

```ts
    it('returns false for a non-Enter (e.g. arrow-key) event, even with everything else satisfied', () => {
        // This is the regression this helper exists to pin: arrow-key movement through the
        // tree must never open a note. Any non-Enter keyboard event, including ArrowUp/ArrowDown,
        // must return false.
        expect(
            shouldOpenPropertyNoteOnEnter({
                isEnterKey: false,
                propertyNoteLinksEnabled: true,
                selectionType: ItemType.PROPERTY,
                selectedProperty: buildPropertyValueNodeId('references', 'apple')
            })
        ).toBe(false);
    });
```

- [ ] **Step 5: Rename and regate the helper**

In `src/utils/propertyNoteLookup.ts`, rename the interface and function and change the parameter name. Keep the existing doc comment about arrow keys — it explains why the function exists:

```ts
export function shouldOpenPropertyNoteOnEnter({
    isEnterKey,
    propertyNoteLinksEnabled,
    selectionType,
    selectedProperty
}: ShouldOpenPropertyNoteOnEnterParams): boolean {
    return isEnterKey && propertyNoteLinksEnabled && selectionType === ItemType.PROPERTY && Boolean(selectedProperty);
}
```

- [ ] **Step 6: Update the keyboard call site**

In `src/hooks/useNavigationPaneKeyboard.ts`, update the import and the Enter block's call:

```ts
                shouldOpenPropertyNoteOnEnter({
                    isEnterKey: isEnterKey(e),
                    propertyNoteLinksEnabled: settings.enablePropertyNotes && settings.enablePropertyNoteLinks,
                    selectionType: selectionState.selectionType,
                    selectedProperty: selectionState.selectedProperty
                })
```

Leave everything else in that block unchanged, including `e.preventDefault()`, `active: false`, and the `openPropertyNoteFile` call. **Do not touch `selectItemAtIndex`.**

- [ ] **Step 7: Repoint the tree interactions call site**

`src/hooks/navigationPane/useNavigationPaneTreeInteractions.ts` reads `settings.autoOpenPropertyNote` inside `handlePropertyClick` (~`:641`). Change only that reference so the file compiles:

```ts
            const propertyNote =
                settings.enablePropertyNotes && settings.enablePropertyNoteLinks ? resolvePropertyNote(propertyNode, app) : null;
```

Update the dependency array entry from `settings.autoOpenPropertyNote` to `settings.enablePropertyNotes` and `settings.enablePropertyNoteLinks`. Task 2 removes this block entirely — the goal here is only a building tree.

- [ ] **Step 8: Run both test files to verify they pass**

Run: `npx vitest run tests/settings/propertyNoteSettings.test.ts tests/utils/propertyNoteLookup.test.ts`
Expected: PASS.

- [ ] **Step 9: Update the control registration**

In `src/settings/nativeSettingControls.ts`: remove `'autoOpenPropertyNote'` from the boolean-keys list and from `NATIVE_SETTING_DOM_STATE_REFRESH_KEYS`; add `'enablePropertyNotes'` and `'enablePropertyNoteLinks'` to both. `'propertyNoteOpenLocation'` stays exactly as it is.

- [ ] **Step 10: Write the migration test**

Add to `tests/settings/propertyNoteSettings.test.ts`. Import `migrateLegacySyncedSettings` from `../../src/settings/migrations/syncedSettings` and match the call signature used by the existing tests in `tests/settings/` — read one first:

```ts
describe('autoOpenPropertyNote migration', () => {
    it('turns on both new toggles when auto-open was enabled', () => {
        const stored: Record<string, unknown> = { ...DEFAULT_SETTINGS, autoOpenPropertyNote: true };
        const migrated = runMigration(stored);
        expect(migrated.enablePropertyNotes).toBe(true);
        expect(migrated.enablePropertyNoteLinks).toBe(true);
        expect('autoOpenPropertyNote' in migrated).toBe(false);
    });

    it('leaves the feature off when auto-open was disabled', () => {
        const stored: Record<string, unknown> = { ...DEFAULT_SETTINGS, autoOpenPropertyNote: false };
        const migrated = runMigration(stored);
        expect(migrated.enablePropertyNotes).toBe(false);
        expect('autoOpenPropertyNote' in migrated).toBe(false);
    });

    it('leaves settings untouched when the key was never present', () => {
        const stored: Record<string, unknown> = { ...DEFAULT_SETTINGS };
        delete stored.autoOpenPropertyNote;
        const migrated = runMigration(stored);
        expect(migrated.enablePropertyNotes).toBe(false);
        expect(migrated.enablePropertyNoteLinks).toBe(true);
    });
});
```

Define `runMigration` as a local helper wrapping `migrateLegacySyncedSettings` with whatever params it requires.

- [ ] **Step 11: Run the migration test to verify it fails**

Run: `npx vitest run tests/settings/propertyNoteSettings.test.ts`
Expected: FAIL — `enablePropertyNotes` stays `false` when auto-open was `true`.

- [ ] **Step 12: Implement the migration**

In `src/settings/migrations/syncedSettings.ts`, inside `migrateLegacySyncedSettings` (`:100`), alongside the existing `delete mutableSettings.X` block:

```ts
    // autoOpenPropertyNote opened the property note on any row click. It is replaced by the
    // folder-note interaction model: enablePropertyNoteLinks underlines the value name and opens
    // on name-click or Enter. Anyone who had auto-open on gets both new toggles on.
    if (mutableSettings.autoOpenPropertyNote === true) {
        mutableSettings.enablePropertyNotes = true;
        mutableSettings.enablePropertyNoteLinks = true;
    }
    delete mutableSettings.autoOpenPropertyNote;
```

- [ ] **Step 13: Run the migration test to verify it passes**

Run: `npx vitest run tests/settings/propertyNoteSettings.test.ts`
Expected: PASS.

- [ ] **Step 14: Update the native settings tab**

In `src/settings/tabs/PropertiesTab.ts`, replace the `autoOpenPropertyNote` toggle in the `propertyNotes` group with two toggles, and regate the dropdown:

```ts
        createGroupDefinition(strings.settings.sections.propertyNotes, [
            createToggleDefinition('enablePropertyNotes', {
                name: strings.settings.items.enablePropertyNotes.name,
                desc: strings.settings.items.enablePropertyNotes.desc
            }),
            createToggleDefinition('enablePropertyNoteLinks', {
                name: strings.settings.items.enablePropertyNoteLinks.name,
                desc: strings.settings.items.enablePropertyNoteLinks.desc,
                visible: () => plugin.settings.enablePropertyNotes
            }),
            createDropdownDefinition('propertyNoteOpenLocation', {
                name: strings.settings.items.propertyNoteOpenLocation.name,
                desc: strings.settings.items.propertyNoteOpenLocation.desc,
                aliases: Object.values(strings.settings.items.propertyNoteOpenLocation.options),
                visible: () => plugin.settings.enablePropertyNotes,
                options: {
                    'current-tab': strings.settings.items.propertyNoteOpenLocation.options.currentTab,
                    'new-tab': strings.settings.items.propertyNoteOpenLocation.options.newTab,
                    'right-sidebar': strings.settings.items.propertyNoteOpenLocation.options.rightSidebar
                }
            })
        ])
```

- [ ] **Step 15: Update the legacy settings tab**

In `src/settings/tabs/legacy/PropertiesLegacyTab.ts:117-149`, `enablePropertyNotes` becomes the parent toggle and both `enablePropertyNoteLinks` and the dropdown move into its dependent section. Replace lines 119-131 with:

```ts
    const enablePropertyNotesSetting = propertyNotesGroup.addSetting(setting => {
        setting.setName(strings.settings.items.enablePropertyNotes.name).setDesc(strings.settings.items.enablePropertyNotes.desc);
    });

    // Both the links toggle and the open location only apply when property notes are on,
    // matching the native tab's visibility gates.
    const propertyNotesDependentSettingsEl = wireToggleSettingWithDependentSection(
        enablePropertyNotesSetting,
        () => plugin.settings.enablePropertyNotes,
        async value => {
            plugin.settings.enablePropertyNotes = value;
            await plugin.saveSettingsAndUpdate();
        }
    );

    new Setting(propertyNotesDependentSettingsEl)
        .setName(strings.settings.items.enablePropertyNoteLinks.name)
        .setDesc(strings.settings.items.enablePropertyNoteLinks.desc)
        .addToggle(toggle =>
            toggle.setValue(plugin.settings.enablePropertyNoteLinks).onChange(async value => {
                plugin.settings.enablePropertyNoteLinks = value;
                await plugin.saveSettingsAndUpdate();
            })
        );
```

Leave the dropdown block at `:133-149` exactly as it is — it already renders into `propertyNotesDependentSettingsEl`.

- [ ] **Step 16: Add the English strings**

In `src/i18n/locales/en.ts`, remove the `autoOpenPropertyNote` entry (`:2368-2371`) and add in its place:

```ts
            enablePropertyNotes: {
                name: 'Enable property notes',
                desc: 'Treat a property value that is a wikilink as a link to the note it points at, the way folder notes work for folders.'
            },
            enablePropertyNoteLinks: {
                name: 'Property names open property notes',
                desc: 'Underline property values that link to a note, and open that note when you click the name or press Enter. Clicking elsewhere on the row only selects the value.'
            },
```

- [ ] **Step 17: Verify the whole gate**

Run: `npm run build`
Expected: errors only about missing i18n keys in the 20 non-English locales. Fix them by adding the two new keys to every locale using the English text verbatim and removing `autoOpenPropertyNote` from each — Task 7 replaces the placeholder text with real translations.

Then confirm nothing references the old key:

Run: `grep -rn "autoOpenPropertyNote" src/`
Expected: no output.

Run: `npx vitest run && npm run build && npm run lint && npm run format:check`
Expected: **all clean.** This task must end with a green tree — no compile errors are carried into the next task.

- [ ] **Step 18: Commit**

```bash
git add src/settings src/i18n src/utils/propertyNoteLookup.ts src/hooks tests
git commit -m "feat: replace autoOpenPropertyNote with property note link settings"
```

---

### Task 2: Navigation row name click and underline

**Files:**
- Modify: `src/components/PropertyTreeItem.tsx`
- Modify: `src/components/navigationPane/NavigationPaneTreeRow.tsx:250-258`
- Modify: `src/hooks/navigationPane/useNavigationPaneTreeInteractions.ts:625-690`
- Modify: `src/styles/sections/navigation-tree.css`
- Test: `tests/hooks/useNavigationPaneTreeInteractions.test.ts` (exists — replace the auto-open block)

**Interfaces:**
- Consumes: settings from Task 1; `resolvePropertyNote` and `openPropertyNoteFile` (already shipped).
- Produces: `handlePropertyNameClick(propertyNode: PropertyTreeNode, event?: React.MouseEvent): void` and `handlePropertyNameMouseDown(propertyNode: PropertyTreeNode, event: React.MouseEvent): void` on `NavigationPaneTreeInteractionsResult`. `PropertyTreeItem` gains props `onNameClick?: (event: React.MouseEvent<HTMLSpanElement>) => void`, `onNameMouseDown?: (event: React.MouseEvent<HTMLSpanElement>) => void`, and `vaultChangeVersion: number`.

- [ ] **Step 1: Replace the auto-open tests**

In `tests/hooks/useNavigationPaneTreeInteractions.test.ts`, the `describe('auto-open property notes', ...)` block tests the old behavior and must go. Keep its `clickPropertyValue` harness — it already builds the hook with the full param list — but rename it and let it invoke either handler. Change its settings to `{ ...DEFAULT_SETTINGS, enablePropertyNotes: true, enablePropertyNoteLinks: true }`, and have it return both handlers plus `openFile` and `selectionDispatch`.

Replace the five cases with:

```ts
describe('property note name clicks', () => {
    it('opens the note when the name is clicked', async () => {
        const file = createTestTFile('Apple.md');
        const { nameClick, openFile } = renderPropertyRow({
            assignmentValue: '[[Apple]]',
            enabled: true,
            resolved: file
        });
        nameClick();
        await Promise.resolve();
        expect(openFile).toHaveBeenCalledWith(file, { active: true });
    });

    it('selects without opening when the row body is clicked', async () => {
        const { rowClick, openFile, selectionDispatch, valueNode } = renderPropertyRow({
            assignmentValue: '[[Apple]]',
            enabled: true,
            resolved: createTestTFile('Apple.md')
        });
        rowClick();
        await Promise.resolve();
        expect(openFile).not.toHaveBeenCalled();
        expect(selectionDispatch).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'SET_SELECTED_PROPERTY', nodeId: valueNode.id })
        );
    });

    it('also selects the value when the name is clicked', async () => {
        const { nameClick, selectionDispatch, valueNode } = renderPropertyRow({
            assignmentValue: '[[Apple]]',
            enabled: true,
            resolved: createTestTFile('Apple.md')
        });
        nameClick();
        await Promise.resolve();
        expect(selectionDispatch).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'SET_SELECTED_PROPERTY', nodeId: valueNode.id })
        );
    });

    it('opens nothing when the links setting is off', async () => {
        const { nameClick, openFile } = renderPropertyRow({
            assignmentValue: '[[Apple]]',
            enabled: false,
            resolved: createTestTFile('Apple.md')
        });
        nameClick();
        await Promise.resolve();
        expect(openFile).not.toHaveBeenCalled();
    });

    it('opens nothing and creates nothing when the link does not resolve', async () => {
        const { nameClick, openFile } = renderPropertyRow({
            assignmentValue: '[[Ghost]]',
            enabled: true,
            resolved: null
        });
        nameClick();
        await Promise.resolve();
        expect(openFile).not.toHaveBeenCalled();
    });

    it('opens nothing for a plain string value', async () => {
        const { nameClick, openFile } = renderPropertyRow({
            assignmentValue: 'draft',
            enabled: true,
            resolved: createTestTFile('Draft.md')
        });
        nameClick();
        await Promise.resolve();
        expect(openFile).not.toHaveBeenCalled();
    });
});
```

`renderPropertyRow` returns `{ nameClick, rowClick, openFile, selectionDispatch, valueNode }`, where `nameClick` calls `handlePropertyNameClick(valueNode)` and `rowClick` calls `handlePropertyClick(valueNode)`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hooks/useNavigationPaneTreeInteractions.test.ts`
Expected: FAIL — `handlePropertyNameClick` is not on the hook result.

- [ ] **Step 3: Revert the row click handler to select-only**

In `useNavigationPaneTreeInteractions.ts`, in `handlePropertyClick` (`:625`), delete the `propertyNote` resolution, the `...(propertyNote ? { autoSelectedFile: null } : {})` spread, and the trailing `if (propertyNote) { ... }` open block. The handler returns to plain selection. Remove now-unused dependencies from its array.

- [ ] **Step 4: Add the name click handler**

Add after `handlePropertyClick`, mirroring `handleFolderNameClick` (`:221-278`):

```ts
    const handlePropertyNameClick = useCallback(
        (propertyNode: PropertyTreeNode, event?: React.MouseEvent) => {
            if (!settings.enablePropertyNotes || !settings.enablePropertyNoteLinks) {
                handlePropertyClick(propertyNode, event);
                return;
            }

            const propertyNote = resolvePropertyNote(propertyNode, app);
            if (!propertyNote) {
                handlePropertyClick(propertyNode, event);
                return;
            }

            // Name clicks stop before the row click handler, so selection and expansion run here.
            selectionDispatch({
                type: 'SET_SELECTED_PROPERTY',
                nodeId: propertyNode.id,
                autoSelectedFile: null
            });

            if (settings.autoExpandNavItems && propertyNode.children.size > 0 && !expansionState.expandedProperties.has(propertyNode.id)) {
                handlePropertyToggle(propertyNode.id);
            }

            const openContext = event
                ? resolveFolderNoteClickOpenContext(event, settings.propertyNoteOpenLocation, settings.multiSelectModifier)
                : resolveFolderNoteDefaultOpenContext(settings.propertyNoteOpenLocation);

            runAsyncAction(() => openPropertyNoteFile({ app, commandQueue, propertyNote, context: openContext }));
        },
        [
            app,
            commandQueue,
            expansionState.expandedProperties,
            handlePropertyClick,
            handlePropertyToggle,
            selectionDispatch,
            settings
        ]
    );

    const handlePropertyNameMouseDown = useCallback(
        (propertyNode: PropertyTreeNode, event: React.MouseEvent) => {
            if (event.button !== 1 || !settings.enablePropertyNotes || !settings.enablePropertyNoteLinks) {
                return;
            }

            const propertyNote = resolvePropertyNote(propertyNode, app);
            if (!propertyNote) {
                return;
            }

            // Middle-click always opens in a new tab.
            event.preventDefault();
            event.stopPropagation();
            runAsyncAction(() => openPropertyNoteFile({ app, commandQueue, propertyNote, context: 'tab' }));
        },
        [app, commandQueue, settings]
    );
```

Add both to the hook's returned object and to the exported name list at the bottom of the file (there is an array of handler names around `:755-766` — add them there too, or the result shape assertion will fail).

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/hooks/useNavigationPaneTreeInteractions.test.ts`
Expected: PASS.

- [ ] **Step 6: Add the underline to the row**

In `src/components/PropertyTreeItem.tsx`:

Add to `PropertyTreeItemProps`:

```ts
    onNameClick?: (event: React.MouseEvent<HTMLSpanElement>) => void;
    onNameMouseDown?: (event: React.MouseEvent<HTMLSpanElement>) => void;
    vaultChangeVersion: number;
```

Destructure them, then compute the flag mirroring `FolderItem.tsx:192-199`:

```ts
    const propertyNoteLinksEnabled = settings.enablePropertyNotes && settings.enablePropertyNoteLinks;

    const hasPropertyNote = useMemo(() => {
        if (!propertyNoteLinksEnabled) return false;
        return resolvePropertyNote(propertyNode, app) !== null;
        // eslint-disable-next-line react-hooks/exhaustive-deps -- vaultChangeVersion refreshes property-note detection.
    }, [propertyNode, app, propertyNoteLinksEnabled, vaultChangeVersion]);
```

`app` comes from `useServices()` — add the import and hook call if the component does not already have it.

Extend the class memo at `:140-146`:

```ts
        const propertyNameClassName = useMemo(() => {
            const classes = ['nn-navitem-name'];
            if (applyColorToName) {
                classes.push('nn-has-custom-color');
            }
            if (hasPropertyNote) {
                classes.push('nn-has-property-note');
            }
            return classes.join(' ');
        }, [applyColorToName, hasPropertyNote]);
```

And wire the handlers on the name span at `:269`:

```tsx
                        <span
                            className={propertyNameClassName}
                            style={applyColorToName ? { color } : undefined}
                            onClick={hasPropertyNote ? onNameClick : undefined}
                            onMouseDown={hasPropertyNote ? onNameMouseDown : undefined}
                        >
                            {propertyNode.name}
                        </span>
```

- [ ] **Step 7: Wire the row**

In `src/components/navigationPane/NavigationPaneTreeRow.tsx`, at the `PropertyTreeItem` usage (`:250-258`), add alongside the existing `onClick`:

```tsx
                    onNameClick={event => tree.handlePropertyNameClick(propertyNode, event)}
                    onNameMouseDown={event => tree.handlePropertyNameMouseDown(propertyNode, event)}
                    vaultChangeVersion={vaultChangeVersion}
```

`vaultChangeVersion` is already in scope in that component — it is passed to `FolderItem` at the folder branch (`:86-90`).

- [ ] **Step 8: Add the style**

In `src/styles/sections/navigation-tree.css`, add `.nn-has-property-note` as an additional selector on the existing `.nn-has-folder-note` rule at `:260` (and on the shortcut-row variant at `:449`). Do not duplicate the declarations.

- [ ] **Step 9: Verify**

Run: `npm run format:check && npm run lint && npm run build && npx vitest run`
Expected: all clean.

- [ ] **Step 10: Commit**

```bash
git add src/components src/hooks src/styles tests/hooks
git commit -m "feat: open property notes from the value name"
```

---

### Task 3: List-pane title and header links

**Files:**
- Create: `src/hooks/usePropertyNoteLink.ts`
- Modify: `src/components/ListPaneTitleArea.tsx`
- Modify: `src/components/ListPaneHeader.tsx` (the `breadcrumbContent` memo, ~`:221-300`)
- Modify: `src/styles/sections/ui-headers.css`, `src/styles/sections/list-files.css`

**Interfaces:**
- Consumes: settings from Task 1; `resolvePropertyNote`, `openPropertyNoteFile`; `resolvePropertyTreeNode` from `src/utils/propertyTree.ts:669`.
- Produces:

```ts
export interface PropertyNoteLink {
    hasPropertyNote: boolean;
    handleClick: (event: React.MouseEvent<HTMLElement>) => void;
    handleMouseDown: (event: React.MouseEvent<HTMLElement>) => void;
}

export function usePropertyNoteLink(): PropertyNoteLink
```

No unit test: the hook reads four React contexts, and its decision logic is `resolvePropertyNote`, already covered in `tests/utils/propertyNoteLookup.test.ts`. It is verified by the manual check in Step 5.

- [ ] **Step 1: Write the hook**

Create `src/hooks/usePropertyNoteLink.ts` (GPL header first). Match the context idiom of `ListPaneTitleArea.tsx:34-40` for `useServices`, `useCommandQueue`, `useSettingsState`, `useSelectionState`, and take the property tree from `useFileCache()`:

```ts
export function usePropertyNoteLink(): PropertyNoteLink {
    const { app } = useServices();
    const commandQueue = useCommandQueue();
    const settings = useSettingsState();
    const selectionState = useSelectionState();
    const { getPropertyTree } = useFileCache();

    // Property note links only apply when a property value is the active selection.
    const propertyNote = useMemo(() => {
        if (!settings.enablePropertyNotes || !settings.enablePropertyNoteLinks) {
            return null;
        }
        if (selectionState.selectionType !== ItemType.PROPERTY || !selectionState.selectedProperty) {
            return null;
        }

        const resolved = resolvePropertyTreeNode({
            nodeId: selectionState.selectedProperty,
            propertyTree: getPropertyTree()
        });

        return resolved ? resolvePropertyNote(resolved.node, app) : null;
    }, [
        settings.enablePropertyNotes,
        settings.enablePropertyNoteLinks,
        selectionState.selectionType,
        selectionState.selectedProperty,
        getPropertyTree,
        app
    ]);

    const handleClick = useCallback(
        (event: React.MouseEvent<HTMLElement>) => {
            if (!propertyNote) {
                return;
            }

            // Prevents title/header click handlers from also running.
            event.stopPropagation();

            const context = resolveFolderNoteClickOpenContext(
                event,
                settings.propertyNoteOpenLocation,
                settings.multiSelectModifier
            );
            runAsyncAction(() => openPropertyNoteFile({ app, commandQueue, propertyNote, context }));
        },
        [propertyNote, app, commandQueue, settings.propertyNoteOpenLocation, settings.multiSelectModifier]
    );

    const handleMouseDown = useCallback(
        (event: React.MouseEvent<HTMLElement>) => {
            if (event.button !== 1 || !propertyNote) {
                return;
            }

            // Middle-click always opens in a new tab.
            event.preventDefault();
            event.stopPropagation();
            runAsyncAction(() => openPropertyNoteFile({ app, commandQueue, propertyNote, context: 'tab' }));
        },
        [propertyNote, app, commandQueue]
    );

    return { hasPropertyNote: propertyNote !== null, handleClick, handleMouseDown };
}
```

- [ ] **Step 2: Wire ListPaneTitleArea**

Add `const propertyNoteLink = usePropertyNoteLink();` beside the existing hooks, then replace the returned span. A selection is either a folder or a property, never both, so the folder branch takes precedence:

```tsx
                    <span
                        className={`nn-list-title-label${selectedFolderNote ? ' nn-list-title-label--folder-note' : ''}${
                            !selectedFolderNote && propertyNoteLink.hasPropertyNote ? ' nn-list-title-label--property-note' : ''
                        }`}
                        onClick={
                            selectedFolderNote
                                ? handleFolderNoteClick
                                : propertyNoteLink.hasPropertyNote
                                  ? propertyNoteLink.handleClick
                                  : undefined
                        }
                        onMouseDown={
                            selectedFolderNote
                                ? handleFolderNoteMouseDown
                                : propertyNoteLink.hasPropertyNote
                                  ? propertyNoteLink.handleMouseDown
                                  : undefined
                        }
                    >
                        {desktopTitle}
                    </span>
```

- [ ] **Step 3: Wire the desktop title path in ListPaneHeader**

Add `const propertyNoteLink = usePropertyNoteLink();` beside the existing hooks. In `breadcrumbContent`, replace the `!shouldRenderBreadcrumbSegments` branch:

```tsx
        if (!shouldRenderBreadcrumbSegments) {
            if (selectedFolderNote) {
                return (
                    <span
                        className="nn-pane-header-folder-note"
                        onClick={handleSelectedFolderNoteClick}
                        onMouseDown={handleSelectedFolderNoteMouseDown}
                    >
                        {desktopTitle}
                    </span>
                );
            }

            if (propertyNoteLink.hasPropertyNote) {
                return (
                    <span
                        className="nn-pane-header-property-note"
                        onClick={propertyNoteLink.handleClick}
                        onMouseDown={propertyNoteLink.handleMouseDown}
                    >
                        {desktopTitle}
                    </span>
                );
            }

            return desktopTitle;
        }
```

- [ ] **Step 4: Wire the mobile breadcrumb path**

In the same memo's `forEach`, alongside `isCurrentFolderNoteSegment`:

```tsx
            const isCurrentFolderNoteSegment = segment.isLast && Boolean(selectedFolderNote);
            const isCurrentPropertyNoteSegment = segment.isLast && !selectedFolderNote && propertyNoteLink.hasPropertyNote;

            if (segment.isLast || segment.targetType === 'none' || !segment.targetPath) {
                const noteClassName = isCurrentFolderNoteSegment
                    ? ' nn-pane-header-folder-note'
                    : isCurrentPropertyNoteSegment
                      ? ' nn-pane-header-property-note'
                      : '';

                parts.push(
                    <span
                        key={key}
                        className={`nn-path-current${noteClassName}`}
                        onClick={
                            isCurrentFolderNoteSegment
                                ? handleSelectedFolderNoteClick
                                : isCurrentPropertyNoteSegment
                                  ? propertyNoteLink.handleClick
                                  : undefined
                        }
                        onMouseDown={
                            isCurrentFolderNoteSegment
                                ? handleSelectedFolderNoteMouseDown
                                : isCurrentPropertyNoteSegment
                                  ? propertyNoteLink.handleMouseDown
                                  : undefined
                        }
                    >
                        {segment.label}
                    </span>
                );
            } else {
```

Add `propertyNoteLink` to the memo's dependency array.

- [ ] **Step 5: Add the styles and verify manually**

Add `.nn-pane-header-property-note` as a second selector on the `.nn-pane-header-folder-note` rule in `src/styles/sections/ui-headers.css:136`, and `.nn-list-title-label--property-note` on `.nn-list-title-label--folder-note` in `src/styles/sections/list-files.css:59`.

Run: `npm run format:check && npm run lint && npm run build && npx vitest run`

Then in Obsidian: enable property notes, select a property value that is a wikilink to an existing note, and confirm the list-pane title is underlined and opens that note. Select a plain-string value and confirm it is plain text.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/usePropertyNoteLink.ts src/components src/styles
git commit -m "feat: open property notes from the list pane title"
```

---

### Task 4: Context menu retarget

**Files:**
- Modify: `src/hooks/useContextMenu.ts:147-152`

**Interfaces:**
- Consumes: settings from Task 1; `resolvePropertyNote`.
- Produces: nothing.

- [ ] **Step 1: Read the folder block**

Read `src/hooks/useContextMenu.ts:147-152`. It retargets a folder right-click to the file menu when the click landed inside `.nn-navitem-name` and the folder has a folder note.

- [ ] **Step 2: Add the property equivalent**

Directly after that block, add:

```ts
            if (
                settings.enablePropertyNotes &&
                settings.enablePropertyNoteLinks &&
                menuConfig.type === ItemType.PROPERTY &&
                targetElement?.closest('.nn-navitem-name')
            ) {
                const propertyNote = resolvePropertyNote(menuConfig.item, app);
                if (propertyNote) {
                    menuConfig = { type: ItemType.FILE, item: propertyNote };
                }
            }
```

Check the actual shape of `menuConfig` for property rows before writing this — if the property variant carries something other than a `PropertyTreeNode` in `item`, resolve the node first via `resolvePropertyTreeNode` and adapt. **If the property menu config does not carry enough to resolve the node, stop and report it rather than restructuring the menu system.**

- [ ] **Step 3: Verify**

Run: `npm run format:check && npm run lint && npm run build && npx vitest run`

Then in Obsidian: right-click a property value's name and confirm the file menu for the property note appears; right-click elsewhere on the row and confirm the property menu appears.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useContextMenu.ts
git commit -m "feat: retarget the context menu on property note names"
```

---

### Task 5: Shortcut row parity

**Files:**
- Modify: `src/hooks/navigationPane/useNavigationPaneShortcutActions.ts`
- Modify: `src/components/navigationPane/NavigationPaneShortcutRow.tsx` (property branch at `:349-380`)

**Interfaces:**
- Consumes: settings from Task 1; `resolvePropertyNote`, `openPropertyNoteFile`.
- Produces: two additions to the shortcut actions result:
  - `handleShortcutPropertyNoteClick(propertyNodeId: string, shortcutKey: string, event: React.MouseEvent<HTMLSpanElement>): void` — falls back to `handleShortcutPropertyActivate` itself when the feature is off or the value has no note, so callers never branch.
  - `resolveShortcutPropertyNote(propertyNodeId: string): TFile | null` — used by the row purely to decide whether to underline.

**Note the id, not the node.** The shortcut row carries `propertyNodeId: string` (`NavigationPaneShortcutRow.tsx:351`), not a `PropertyTreeNode` — matching `handleShortcutPropertyActivate(propertyNodeId, item.key)` at `:377`. Both new functions therefore take the id and resolve the node internally via `resolvePropertyTreeNode`, using whatever tree route the hook already uses to service `handleShortcutPropertyActivate`.

- [ ] **Step 1: Read the folder shortcut path**

Read `useNavigationPaneShortcutActions.ts:157-215` (`handleShortcutFolderNoteClick`, gated on `enableFolderNotes && enableFolderNoteLinks`) and the folder-note label class applied in `NavigationPaneShortcutRow.tsx:92-96`.

- [ ] **Step 2: Add the property shortcut handler**

Add alongside `handleShortcutFolderNoteClick`. It drops the sidebar-service branch and the `openInRightSidebar` callback — property notes have no sidebar service, and `openPropertyNoteFile` handles right-sidebar directly:

```ts
    const resolveShortcutPropertyNote = useCallback(
        (propertyNodeId: string): TFile | null => {
            if (!settings.enablePropertyNotes || !settings.enablePropertyNoteLinks) {
                return null;
            }

            const resolved = resolvePropertyTreeNode({ nodeId: propertyNodeId, propertyTreeService });
            return resolved ? resolvePropertyNote(resolved.node, app) : null;
        },
        [app, propertyTreeService, settings.enablePropertyNotes, settings.enablePropertyNoteLinks]
    );

    const handleShortcutPropertyNoteClick = useCallback(
        (propertyNodeId: string, shortcutKey: string, event: React.MouseEvent<HTMLSpanElement>) => {
            setActiveShortcut(shortcutKey);

            const propertyNote = resolveShortcutPropertyNote(propertyNodeId);
            if (!propertyNote) {
                handleShortcutPropertyActivate(propertyNodeId, shortcutKey);
                return;
            }

            selectionDispatch({
                type: 'SET_SELECTED_PROPERTY',
                nodeId: propertyNodeId,
                source: 'shortcut',
                autoSelectedFile: null
            });

            const openContext = resolveFolderNoteClickOpenContext(
                event,
                settings.propertyNoteOpenLocation,
                settings.multiSelectModifier
            );

            runAsyncAction(() => openPropertyNoteFile({ app, commandQueue, propertyNote, context: openContext }));
            scheduleShortcutRelease();
        },
        [
            app,
            commandQueue,
            handleShortcutPropertyActivate,
            resolveShortcutPropertyNote,
            scheduleShortcutRelease,
            selectionDispatch,
            setActiveShortcut,
            settings.propertyNoteOpenLocation,
            settings.multiSelectModifier
        ]
    );
```

Check `handleShortcutPropertyActivate`'s real signature at `:366` before wiring it — the snippet assumes `(nodeId, key)`, matching the call at `:441`. Obtain `propertyTreeService` however the hook already does. Add both new functions to the hook's returned object.

- [ ] **Step 3: Underline and wire the shortcut row**

In `NavigationPaneShortcutRow.tsx`, in the `SHORTCUT_PROPERTY` branch (`:349-380`), compute the note next to the existing `propertyCountInfo`:

```ts
            const propertyNote = isMissing ? null : shortcuts.resolveShortcutPropertyNote(propertyNodeId);
```

Then in the `shortcutProps` object, add the label class and route the label click through the new handler, leaving the existing `onClick` untouched so a click on the row body still activates normally:

```ts
                labelClassName: propertyNote ? 'nn-has-property-note' : undefined,
                onLabelClick: propertyNote
                    ? (event: React.MouseEvent<HTMLSpanElement>) =>
                          shortcuts.handleShortcutPropertyNoteClick(propertyNodeId, item.key, event)
                    : undefined,
```

**Match the folder branch's real prop names before writing this.** Read how the folder branch (around `:92-96` and its own `shortcutProps`) passes its `folderNote` through to `ShortcutItem` — `labelClassName` and `onLabelClick` are the names used at `ShortcutItem.tsx:57,97,230`, but confirm rather than assume, and use whatever the folder branch actually uses.

- [ ] **Step 4: Verify**

Run: `npm run format:check && npm run lint && npm run build && npx vitest run`

Then in Obsidian: add a property value shortcut whose value links to a note, confirm the shortcut label is underlined and clicking it opens the note; confirm a shortcut to a plain-string value still just navigates.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/navigationPane src/components/navigationPane
git commit -m "feat: open property notes from shortcut rows"
```

---

### Task 6: Hide property notes from Recent Notes

**Files:**
- Modify: `src/settings/types.ts:355-360`
- Modify: `src/services/RecentNotesService.ts` (`shouldSkipFile` at `:58-73`, and the constructor at `:27`)
- Modify: `src/main.ts:701` (the single `new RecentNotesService(...)` call site)
- Modify: `src/i18n/locales/en.ts` (`hideRecentNotes.options`, `:1485-1492`)
- Modify: the settings tab rendering the `hideRecentNotes` dropdown (find it with `grep -rn "hideRecentNotes" src/settings/`)
- Test: `tests/settings/recentNotesHideMode.test.ts` (create)

**Interfaces:**
- Consumes: `enablePropertyNotes` (Task 1); `resolvePropertyNote`.
- Produces: `RecentNotesHideMode = 'none' | 'folder-notes' | 'property-notes' | 'all-notes'`. `RecentNotesService`'s constructor gains `app: App` and `getPropertyTree: () => ReadonlyMap<string, PropertyTreeNode> | null`.

- [ ] **Step 1: Write the failing test**

Create `tests/settings/recentNotesHideMode.test.ts` (GPL header first):

```ts
import { describe, expect, it } from 'vitest';
import { isRecentNotesHideMode } from '../../src/settings/types';

describe('isRecentNotesHideMode', () => {
    it('accepts every mode', () => {
        expect(isRecentNotesHideMode('none')).toBe(true);
        expect(isRecentNotesHideMode('folder-notes')).toBe(true);
        expect(isRecentNotesHideMode('property-notes')).toBe(true);
        expect(isRecentNotesHideMode('all-notes')).toBe(true);
    });

    it('rejects unknown values', () => {
        expect(isRecentNotesHideMode('tag-notes')).toBe(false);
        expect(isRecentNotesHideMode('')).toBe(false);
        expect(isRecentNotesHideMode(null)).toBe(false);
        expect(isRecentNotesHideMode(undefined)).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/settings/recentNotesHideMode.test.ts`
Expected: FAIL — `'property-notes'` returns `false`.

- [ ] **Step 3: Widen the union and guard**

In `src/settings/types.ts:355-360`:

```ts
/** Filter options for hidden items in the recent notes section */
export type RecentNotesHideMode = 'none' | 'folder-notes' | 'property-notes' | 'all-notes';

export function isRecentNotesHideMode(value: unknown): value is RecentNotesHideMode {
    return value === 'none' || value === 'folder-notes' || value === 'property-notes' || value === 'all-notes';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/settings/recentNotesHideMode.test.ts`
Expected: PASS.

- [ ] **Step 5: Update the filter**

In `src/services/RecentNotesService.ts`, `shouldSkipFile` currently returns early unless the mode is exactly `'folder-notes'`. Rewrite so each kind is tested independently:

```ts
    private shouldSkipFile(file: TFile): boolean {
        const settings = this.settingsProvider.settings;
        const mode = settings.hideRecentNotes;

        if (mode === 'folder-notes' || mode === 'all-notes') {
            const parent = file.parent;
            if (parent instanceof TFolder) {
                const isFolder = isFolderNote(file, parent, {
                    enableFolderNotes: true,
                    folderNoteName: settings.folderNoteName,
                    folderNoteNamePattern: settings.folderNoteNamePattern
                });
                if (isFolder) {
                    return true;
                }
            }
        }

        if ((mode === 'property-notes' || mode === 'all-notes') && settings.enablePropertyNotes) {
            if (this.isPropertyNote(file)) {
                return true;
            }
        }

        return false;
    }
```

Note the deliberate asymmetry: folder-note detection passes `enableFolderNotes: true` unconditionally because `isFolderNote` self-gates elsewhere, while property-note detection must check `settings.enablePropertyNotes` itself, since `resolvePropertyNote` takes no settings.

- [ ] **Step 6: Add the reverse lookup**

`resolvePropertyNote` goes node → file; here you have a file and need the reverse, and no index exists. Resolve on demand. This is acceptable because `shouldSkipFile` is reached from `recordFileOpen` — once per file open, at human speed — and because `hideRecentNotes` defaults to `'none'`, so the scan only runs for someone who explicitly opted in.

Two guards keep the worst case cheap: a substring pre-filter (a value with no `[[` can never resolve to a note) and an early return on the first match.

```ts
    /**
     * Reverse of resolvePropertyNote: given a file, is it the target of any property value's
     * wikilink? There is no index for this direction, so it resolves on demand. Only reached
     * when the user has opted into hiding property notes, and only once per file open.
     */
    private isPropertyNote(file: TFile): boolean {
        const propertyTree = this.getPropertyTree();
        if (!propertyTree) {
            return false;
        }

        for (const keyNode of propertyTree.values()) {
            for (const valueNode of keyNode.children.values()) {
                const assignmentValue = valueNode.assignmentValue;
                // Cheap pre-filter: a value without link markup can never resolve to a note.
                if (!assignmentValue || !assignmentValue.includes('[[')) {
                    continue;
                }

                if (resolvePropertyNote(valueNode, this.app)?.path === file.path) {
                    return true;
                }
            }
        }

        return false;
    }
```

The service currently takes only `settingsProvider` (`:27`) and has neither `app` nor the property tree. Widen the constructor:

```ts
    constructor(
        private readonly settingsProvider: ISettingsProvider,
        private readonly app: App,
        private readonly getPropertyTree: () => ReadonlyMap<string, PropertyTreeNode> | null
    ) {}
```

Update the single construction site, `src/main.ts:701` (`new RecentNotesService(this)`), to pass `this.app` and a getter returning the plugin's property tree. Read how `main.ts` reaches `propertyTreeService` and use the same route.

- [ ] **Step 7: Test the filter behavior**

Add to `tests/settings/recentNotesHideMode.test.ts` — or a new `tests/services/recentNotesService.test.ts` if that fits the repo's layout better. Construct the service with a stub settings provider, a stub `App` whose `metadataCache.getFirstLinkpathDest` returns a chosen file, and a getter returning a one-key property tree built with `buildPropertyKeyNodeId` / `buildPropertyValueNodeId` (copy the node builders from `tests/utils/propertyNoteLookup.test.ts`).

Assert, for a file that IS the target of a `[[Apple]]` value:

- mode `'property-notes'` with `enablePropertyNotes: true` → skipped
- mode `'all-notes'` with `enablePropertyNotes: true` → skipped
- mode `'none'` → not skipped
- mode `'folder-notes'` → not skipped
- mode `'property-notes'` with `enablePropertyNotes: false` → not skipped

And for a value whose `assignmentValue` is the plain string `Apple`, assert it is not skipped under `'property-notes'` even when `getFirstLinkpathDest` would return that file — proving the `[[` pre-filter holds.

- [ ] **Step 8: Add the option strings and dropdown entries**

In `src/i18n/locales/en.ts` (`:1489-1491`):

```ts
                options: {
                    none: 'None',
                    folderNotes: 'Folder notes',
                    propertyNotes: 'Property notes',
                    allNotes: 'Folder and property notes'
                }
```

Add the matching `addOption` / options-map entries wherever the dropdown is built.

- [ ] **Step 9: Verify**

Run: `npm run format:check && npm run lint && npm run build && npx vitest run`

- [ ] **Step 10: Commit**

```bash
git add src/settings src/services/RecentNotesService.ts src/main.ts src/i18n/locales/en.ts tests/settings
git commit -m "feat: hide property notes from recent files"
```

---

### Task 7: Translations and documentation

**Files:**
- Modify: `src/i18n/locales/{ar,de,es,fa,fr,id,it,ja,ko,nl,pl,pt,pt_br,ru,th,tr,uk,vi,zh_cn,zh_tw}.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: the English keys from Tasks 1 and 7.
- Produces: nothing.

- [ ] **Step 1: Confirm the state**

Run: `grep -rln "autoOpenPropertyNote" src/`
Expected: no output. If any locale still has it, remove it.

Run: `npm run build`
Expected: clean — Task 1 added English placeholders to every locale.

- [ ] **Step 2: Translate**

For each of the 20 locales, replace the placeholder English text of `settings.items.enablePropertyNotes.{name,desc}` and `settings.items.enablePropertyNoteLinks.{name,desc}` with real translations, and add real translations for the two new `hideRecentNotes.options` members (`propertyNotes`, `allNotes`).

Read each file's neighbouring `enableFolderNotes` / `enableFolderNoteLinks` / `hideRecentNotes.options.folderNotes` entries first and match their terminology — every locale has settled wording for "note", "property", and "folder note". Key names and option keys never change; only the human-readable values.

- [ ] **Step 3: Verify**

Run: `npm run format:check && npm run lint && npm run build`

- [ ] **Step 4: Rewrite the README section**

The property notes bullet (near the "Folder notes" bullet at `:449`) and its settings paragraph both describe auto-open on navigation and are now wrong. Replace the bullet with:

```markdown
- **Property notes** - Open the note a property value links to by clicking its name, like folder notes
```

Rewrite the paragraph to state: only wikilink values have a property note; clicking the value's name opens it while clicking the rest of the row selects; Enter opens it and arrow keys do not; and the note is never created — if the link has no target, nothing opens.

- [ ] **Step 5: Full verification**

Run: `npx vitest run && npm run format:check && npm run lint && npm run build`
Expected: all tests pass, zero errors, zero warnings.

- [ ] **Step 6: Commit**

```bash
git add src/i18n README.md
git commit -m "feat: translate property note link settings and document the feature"
```

---

## Known limitation — do not try to fix

A value node's identity comes from the wikilink's **display text** (`src/utils/propertyUtils.ts:176`), which is the alias when present and the raw target otherwise. So plain `Apple`, `[[Apple]]`, and `[[Fruits/Apple|Apple]]` all collapse into node `apple` and render identically, while unaliased `[[Fruits/Apple]]` gets its own node. `assignmentValue` is first-writer-wins with one upgrade to link markup (`src/utils/propertyTree.ts:403`), so when two notes contribute different link targets to the same node, indexing order decides which note opens — and deleting the only note that used link markup silently removes the link from a row that survives.

This is inherent to resolving wikilinks rather than using a name convention, and is documented in the spec. Do not add caching, tie-breaking, or normalization to work around it.
