# Property Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When navigating a property value that is a wikilink (`references → [[Apple]]`), open the linked note automatically on explicit activation.

**Architecture:** Two settings drive one behavior. A pure lookup module turns a `PropertyTreeNode` into a link target and an optional resolved `TFile` — all the real decision logic lives there, fully unit-tested. A small opener mirrors `openFolderNoteFile` without the folder-specific command-queue wrapper. Auto-open hooks the property row click handler and the Enter key handler, deliberately *not* the arrow-key selection path.

**Scope change during execution:** this plan originally also made the list-pane title clickable. That was cut after Task 3 at the request of the human partner. Task 4 removes the settings and helper that existed only to serve it; Tasks 1-3 are unchanged history. The clickable-title work is simply not built.

**Tech Stack:** TypeScript, React, Obsidian API, Vitest (node environment, `obsidian` aliased to `tests/stubs/obsidian.ts`), esbuild.

## Global Constraints

- Branch: `feature/property-notes`. Spec: `docs/superpowers/specs/2026-08-04-property-notes-design.md`.
- Build must complete with **zero errors and zero warnings**. Verify with `npm run build`; lint with `npm run lint`.
- All new user-facing strings go in `src/i18n/locales/en.ts` first — it is the source of truth whose type drives all 20 other locales, so a missing key elsewhere is a TypeScript error.
- Every new setting key must be registered in `src/settings/nativeSettingControls.ts`; the toggle/dropdown factories reject unregistered keys.
- Settings sync via a denylist (`NON_TRANSFERABLE_SETTING_KEYS` in `src/settings/transfer.ts`). New keys sync by default — **do not** add them there.
- No migration is needed. All keys are new and defaults apply to existing vaults.
- Tests live at `tests/**/*.test.ts` — `.ts`, not `.tsx`, even for hook tests (they render via `renderToStaticMarkup` from `react-dom/server`).
- Every new source file starts with the GPL header block copied verbatim from any existing file in the same directory.
- Do **not** modify `src/utils/fileFinder.ts`, `src/hooks/listPaneData/listItems.ts`, the pin machinery, or note counts. Property notes are not list members in this design.

## Divergence from the spec

The spec (`docs/superpowers/specs/2026-08-04-property-notes-design.md`) describes a clickable
breadcrumb as the feature's first half. That half was cut during execution — see the scope-change
note above. The spec is left as written; this plan is the authority on what gets built. Sections of
the spec now superseded: "Breadcrumb link", "Unresolved links", and the `enablePropertyNoteLinks`
row of its settings table.

Because nothing now touches the title surfaces, `src/hooks/useListPaneTitle.ts`,
`src/components/ListPaneHeader.tsx`, and `src/components/ListPaneTitleArea.tsx` are **not modified
by any task**.

## A note on where the tests live

All decision logic lives in pure functions in `src/utils/propertyNoteLookup.ts` (Task 2) and is
exhaustively tested there. `useNavigationPaneTreeInteractions` (Task 5) takes injected params rather
than reading contexts, so it gets a real test too.

---

### Task 1: Settings foundation

Adds the three settings, their defaults, control registration, English strings, and the settings-tab UI in both the modern and legacy tabs.

**Files:**
- Modify: `src/settings/types.ts` (after `isFolderNoteOpenLocation` at :366; properties block at :726-732)
- Modify: `src/settings/defaultSettings.ts` (properties defaults at :293-299)
- Modify: `src/settings/nativeSettingControls.ts`
- Modify: `src/settings/tabs/PropertiesTab.ts`
- Modify: `src/settings/tabs/legacy/PropertiesLegacyTab.ts`
- Modify: `src/i18n/locales/en.ts`
- Test: `tests/settings/propertyNoteSettings.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `PropertyNoteOpenLocation` (alias of `FolderNoteOpenLocation`), `isPropertyNoteOpenLocation`, and three keys on `NotebookNavigatorSettings`: `enablePropertyNoteLinks: boolean`, `autoOpenPropertyNote: boolean`, `propertyNoteOpenLocation: PropertyNoteOpenLocation`.

- [ ] **Step 1: Write the failing test**

Create `tests/settings/propertyNoteSettings.test.ts` (GPL header first):

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/settings/defaultSettings';
import { isPropertyNoteOpenLocation } from '../../src/settings/types';

describe('property note settings', () => {
    it('defaults both behaviors to off', () => {
        expect(DEFAULT_SETTINGS.enablePropertyNoteLinks).toBe(false);
        expect(DEFAULT_SETTINGS.autoOpenPropertyNote).toBe(false);
    });

    it('defaults the open location to the current tab', () => {
        expect(DEFAULT_SETTINGS.propertyNoteOpenLocation).toBe('current-tab');
    });

    it('accepts the three valid open locations', () => {
        expect(isPropertyNoteOpenLocation('current-tab')).toBe(true);
        expect(isPropertyNoteOpenLocation('new-tab')).toBe(true);
        expect(isPropertyNoteOpenLocation('right-sidebar')).toBe(true);
    });

    it('rejects anything else', () => {
        expect(isPropertyNoteOpenLocation('left-sidebar')).toBe(false);
        expect(isPropertyNoteOpenLocation(null)).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/settings/propertyNoteSettings.test.ts`
Expected: FAIL — `isPropertyNoteOpenLocation` is not exported from `src/settings/types.ts`.

- [ ] **Step 3: Add the type alias and guard**

In `src/settings/types.ts`, immediately after the existing `isFolderNoteOpenLocation` function (ends around :368):

```ts
/**
 * Property notes reuse folder note open-location semantics exactly. Aliasing rather
 * than redeclaring lets resolveFolderNoteClickOpenContext and
 * resolveFolderNoteDefaultOpenContext accept both with no change.
 */
export type PropertyNoteOpenLocation = FolderNoteOpenLocation;

export const isPropertyNoteOpenLocation = isFolderNoteOpenLocation;
```

- [ ] **Step 4: Add the settings keys**

In the properties block of `NotebookNavigatorSettings` (alongside `showProperties`, `showPropertyIcons`, … around :726-732):

```ts
    enablePropertyNoteLinks: boolean;
    autoOpenPropertyNote: boolean;
    propertyNoteOpenLocation: PropertyNoteOpenLocation;
```

- [ ] **Step 5: Add the defaults**

In `src/settings/defaultSettings.ts`, alongside the properties defaults (around :293-299):

```ts
    enablePropertyNoteLinks: false,
    autoOpenPropertyNote: false,
    propertyNoteOpenLocation: 'current-tab',
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/settings/propertyNoteSettings.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Register the native setting controls**

In `src/settings/nativeSettingControls.ts`:
- Add `'enablePropertyNoteLinks'` and `'autoOpenPropertyNote'` to the boolean-keys list (around :85-89, where `'enableFolderNotes'` lives).
- Add `'propertyNoteOpenLocation'` to the string-keys list (around :180-183) and to the allowed dropdown-values map (around :213-214) with `['current-tab', 'new-tab', 'right-sidebar']`, copying the `folderNoteOpenLocation` entry.
- Add `'enablePropertyNoteLinks'` and `'autoOpenPropertyNote'` to `NATIVE_SETTING_DOM_STATE_REFRESH_KEYS` (around :232-238) so the open-location row's visibility re-evaluates when either toggle changes.

- [ ] **Step 8: Add the English strings**

In `src/i18n/locales/en.ts`, add to `settings.sections` (near `folderNotes` at :990):

```ts
        propertyNotes: 'Property notes',
```

Add to `settings.items` (near the `folderNote*` entries at :2314-2366):

```ts
        enablePropertyNoteLinks: {
            name: 'Property note links',
            desc: 'Make the list pane title clickable when the selected property value is a wikilink, opening the note it links to.'
        },
        autoOpenPropertyNote: {
            name: 'Open property note automatically',
            desc: 'Open the linked note when you click a property value or press Enter on it. Moving through the tree with arrow keys does not open notes.'
        },
        propertyNoteOpenLocation: {
            name: 'Open property notes in',
            desc: 'Where property notes open.',
            options: {
                currentTab: 'Current tab',
                newTab: 'New tab',
                rightSidebar: 'Right sidebar'
            }
        },
```

- [ ] **Step 9: Add the settings group to the modern tab**

In `src/settings/tabs/PropertiesTab.ts`, add `createDropdownDefinition` to the existing import from `../nativeSettingControls`, then append a second group to the array returned by `createPropertiesSettingDefinitions` — after the closing `])` of the existing `createGroupDefinition(heading, [...])`:

```ts
        createGroupDefinition(strings.settings.sections.propertyNotes, [
            createToggleDefinition('enablePropertyNoteLinks', {
                name: strings.settings.items.enablePropertyNoteLinks.name,
                desc: strings.settings.items.enablePropertyNoteLinks.desc
            }),
            createToggleDefinition('autoOpenPropertyNote', {
                name: strings.settings.items.autoOpenPropertyNote.name,
                desc: strings.settings.items.autoOpenPropertyNote.desc
            }),
            createDropdownDefinition('propertyNoteOpenLocation', {
                name: strings.settings.items.propertyNoteOpenLocation.name,
                desc: strings.settings.items.propertyNoteOpenLocation.desc,
                aliases: Object.values(strings.settings.items.propertyNoteOpenLocation.options),
                visible: () => plugin.settings.enablePropertyNoteLinks || plugin.settings.autoOpenPropertyNote,
                options: {
                    'current-tab': strings.settings.items.propertyNoteOpenLocation.options.currentTab,
                    'new-tab': strings.settings.items.propertyNoteOpenLocation.options.newTab,
                    'right-sidebar': strings.settings.items.propertyNoteOpenLocation.options.rightSidebar
                }
            })
        ])
```

- [ ] **Step 10: Add the group to the legacy tab**

In `src/settings/tabs/legacy/PropertiesLegacyTab.ts`, at the end of `renderPropertiesTab`, add a group using the `createGroup` factory already in scope. Import `isPropertyNoteOpenLocation` from `'../../types'`. No dependent-section wiring — all three rows are always visible in the legacy tab:

```ts
    const propertyNotesGroup = createGroup(strings.settings.sections.propertyNotes);

    propertyNotesGroup.addSetting(setting => {
        setting
            .setName(strings.settings.items.enablePropertyNoteLinks.name)
            .setDesc(strings.settings.items.enablePropertyNoteLinks.desc)
            .addToggle(toggle =>
                toggle.setValue(plugin.settings.enablePropertyNoteLinks).onChange(async value => {
                    plugin.settings.enablePropertyNoteLinks = value;
                    await plugin.saveSettingsAndUpdate();
                })
            );
    });

    propertyNotesGroup.addSetting(setting => {
        setting
            .setName(strings.settings.items.autoOpenPropertyNote.name)
            .setDesc(strings.settings.items.autoOpenPropertyNote.desc)
            .addToggle(toggle =>
                toggle.setValue(plugin.settings.autoOpenPropertyNote).onChange(async value => {
                    plugin.settings.autoOpenPropertyNote = value;
                    await plugin.saveSettingsAndUpdate();
                })
            );
    });

    propertyNotesGroup.addSetting(setting => {
        setting
            .setName(strings.settings.items.propertyNoteOpenLocation.name)
            .setDesc(strings.settings.items.propertyNoteOpenLocation.desc)
            .addDropdown(dropdown => {
                dropdown
                    .addOption('current-tab', strings.settings.items.propertyNoteOpenLocation.options.currentTab)
                    .addOption('new-tab', strings.settings.items.propertyNoteOpenLocation.options.newTab)
                    .addOption('right-sidebar', strings.settings.items.propertyNoteOpenLocation.options.rightSidebar)
                    .setValue(plugin.settings.propertyNoteOpenLocation)
                    .onChange(async value => {
                        if (!isPropertyNoteOpenLocation(value)) {
                            return;
                        }
                        plugin.settings.propertyNoteOpenLocation = value;
                        await plugin.saveSettingsAndUpdate();
                    });
            });
    });
```

If `createGroup(...)` returns an object whose `addSetting` signature differs from this, match the shape already used earlier in the same file rather than this snippet.

- [ ] **Step 11: Run the existing settings suites**

Run: `npx vitest run tests/settings tests/services/PluginSettingsController.test.ts tests/main.settingsOrchestration.test.ts`
Expected: PASS. If a test enumerates or snapshots the full settings key list, update it to include the three new keys — that is the expected change, not a regression.

- [ ] **Step 12: Verify the build**

Run: `npm run build && npm run lint`
Expected: zero errors, zero warnings. If the build fails on missing keys in non-English locales, add the four keys to every locale now using the English text verbatim; Task 7 replaces it with real translations.

- [ ] **Step 13: Commit**

```bash
git add src/settings src/i18n tests/settings/propertyNoteSettings.test.ts
git commit -m "feat: add property note settings"
```

---

### Task 2: Property note lookup

The pure core. Every decision the feature makes lives here, so it can all be tested without React or Obsidian.

**Files:**
- Create: `src/utils/propertyNoteLookup.ts`
- Test: `tests/utils/propertyNoteLookup.test.ts` (create)

**Interfaces:**
- Consumes: `parsePropertyLinkTarget` from `src/utils/propertyUtils.ts`; `PropertyTreeNode` from `src/types/storage.ts`.
- Produces:
  - `getPropertyNoteLinkTarget(node: PropertyTreeNode | null): string | null`
  - `getPropertyNoteSourcePath(node: PropertyTreeNode): string`
  - `hasPropertyNoteLink(node: PropertyTreeNode | null, enablePropertyNoteLinks: boolean): boolean`
  - `resolvePropertyNote(node: PropertyTreeNode | null, app: App): TFile | null`

- [ ] **Step 1: Write the failing test**

Create `tests/utils/propertyNoteLookup.test.ts` (GPL header first):

```ts
import { App, TFile } from 'obsidian';
import { describe, expect, it } from 'vitest';
import type { PropertyTreeNode } from '../../src/types/storage';
import { buildPropertyKeyNodeId, buildPropertyValueNodeId } from '../../src/utils/propertyTree';
import {
    getPropertyNoteLinkTarget,
    getPropertyNoteSourcePath,
    hasPropertyNoteLink,
    resolvePropertyNote
} from '../../src/utils/propertyNoteLookup';
import { createTestTFile } from './createTestTFile';

function createValueNode(key: string, valuePath: string, assignmentValue: string | undefined, notes: string[] = []): PropertyTreeNode {
    return {
        id: buildPropertyValueNodeId(key, valuePath),
        kind: 'value',
        key,
        valuePath,
        name: valuePath,
        displayPath: valuePath,
        assignmentValue,
        children: new Map(),
        notesWithValue: new Set(notes)
    };
}

function createKeyNode(key: string): PropertyTreeNode {
    return {
        id: buildPropertyKeyNodeId(key),
        kind: 'key',
        key,
        valuePath: null,
        name: key,
        displayPath: key,
        children: new Map(),
        notesWithValue: new Set()
    };
}

function createApp(dest: TFile | null): App {
    const app = new App();
    app.metadataCache.getFirstLinkpathDest = () => dest;
    return app;
}

describe('getPropertyNoteLinkTarget', () => {
    it('returns the target of a bare wikilink', () => {
        expect(getPropertyNoteLinkTarget(createValueNode('references', 'apple', '[[Apple]]'))).toBe('Apple');
    });

    it('returns the target, not the alias, for an aliased wikilink', () => {
        expect(getPropertyNoteLinkTarget(createValueNode('references', 'apple', '[[Fruits/Apple|Apple]]'))).toBe('Fruits/Apple');
    });

    it('returns the full path for a pathed wikilink', () => {
        expect(getPropertyNoteLinkTarget(createValueNode('references', 'fruits/apple', '[[Fruits/Apple]]'))).toBe('Fruits/Apple');
    });

    it('returns null for a plain string value', () => {
        expect(getPropertyNoteLinkTarget(createValueNode('status', 'draft', 'draft'))).toBeNull();
    });

    it('returns null for an external link value', () => {
        expect(getPropertyNoteLinkTarget(createValueNode('source', 'https://example.com', 'https://example.com'))).toBeNull();
    });

    it('returns null when assignmentValue is absent', () => {
        expect(getPropertyNoteLinkTarget(createValueNode('references', 'apple', undefined))).toBeNull();
    });

    it('returns null for a key node', () => {
        expect(getPropertyNoteLinkTarget(createKeyNode('references'))).toBeNull();
    });

    it('returns null for a null node', () => {
        expect(getPropertyNoteLinkTarget(null)).toBeNull();
    });
});

describe('getPropertyNoteSourcePath', () => {
    it('returns the lexicographically first referencing note', () => {
        const node = createValueNode('references', 'apple', '[[Apple]]', ['zeta.md', 'alpha.md', 'mid.md']);
        expect(getPropertyNoteSourcePath(node)).toBe('alpha.md');
    });

    it('is stable regardless of insertion order', () => {
        const a = createValueNode('references', 'apple', '[[Apple]]', ['alpha.md', 'zeta.md']);
        const b = createValueNode('references', 'apple', '[[Apple]]', ['zeta.md', 'alpha.md']);
        expect(getPropertyNoteSourcePath(a)).toBe(getPropertyNoteSourcePath(b));
    });

    it('falls back to the vault root when nothing references the value', () => {
        expect(getPropertyNoteSourcePath(createValueNode('references', 'apple', '[[Apple]]', []))).toBe('');
    });
});

describe('hasPropertyNoteLink', () => {
    it('is true for a wikilink value when the setting is on', () => {
        expect(hasPropertyNoteLink(createValueNode('references', 'apple', '[[Apple]]'), true)).toBe(true);
    });

    it('is true even when the link does not resolve', () => {
        // Resolution is irrelevant here: unresolved links stay clickable and fall
        // through to Obsidian's openLinkText, which creates the note.
        expect(hasPropertyNoteLink(createValueNode('references', 'ghost', '[[Ghost]]'), true)).toBe(true);
    });

    it('is false when the setting is off', () => {
        expect(hasPropertyNoteLink(createValueNode('references', 'apple', '[[Apple]]'), false)).toBe(false);
    });

    it('is false for a plain string value', () => {
        expect(hasPropertyNoteLink(createValueNode('status', 'draft', 'draft'), true)).toBe(false);
    });

    it('is false for a key node', () => {
        expect(hasPropertyNoteLink(createKeyNode('references'), true)).toBe(false);
    });

    it('is false for a null node', () => {
        expect(hasPropertyNoteLink(null, true)).toBe(false);
    });
});

describe('resolvePropertyNote', () => {
    it('returns the resolved file for a wikilink value', () => {
        const file = createTestTFile('Fruits/Apple.md');
        const node = createValueNode('references', 'apple', '[[Apple]]', ['note.md']);
        expect(resolvePropertyNote(node, createApp(file))).toBe(file);
    });

    it('returns null when the link does not resolve', () => {
        const node = createValueNode('references', 'apple', '[[Apple]]', ['note.md']);
        expect(resolvePropertyNote(node, createApp(null))).toBeNull();
    });

    it('returns null for a plain string value even when a file would resolve', () => {
        const node = createValueNode('status', 'draft', 'draft');
        expect(resolvePropertyNote(node, createApp(createTestTFile('Draft.md')))).toBeNull();
    });

    it('returns null for a null node', () => {
        expect(resolvePropertyNote(null, createApp(createTestTFile('Apple.md')))).toBeNull();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/utils/propertyNoteLookup.test.ts`
Expected: FAIL — cannot resolve `../../src/utils/propertyNoteLookup`.

- [ ] **Step 3: Write the implementation**

Create `src/utils/propertyNoteLookup.ts` (GPL header first):

```ts
import type { App, TFile } from 'obsidian';
import type { PropertyTreeNode } from '../types/storage';
import { parsePropertyLinkTarget } from './propertyUtils';

/**
 * Returns the wikilink target a property value points at, or null when the value is
 * not a strict wikilink. Uses the link target rather than the display text:
 * [[Fruits/Apple|Apple]] normalizes to the value node "apple" but points at "Fruits/Apple".
 */
export function getPropertyNoteLinkTarget(node: PropertyTreeNode | null): string | null {
    if (!node || node.kind !== 'value') {
        return null;
    }

    const assignmentValue = node.assignmentValue;
    if (!assignmentValue) {
        return null;
    }

    const linkTarget = parsePropertyLinkTarget(assignmentValue);
    if (!linkTarget || linkTarget.kind !== 'internal') {
        return null;
    }

    return linkTarget.target;
}

/**
 * A value node has no single source file, but link resolution needs one. The
 * lexicographically first referencing note is deterministic across rebuilds and
 * resolves the link exactly as Obsidian would from a note that uses the value.
 */
export function getPropertyNoteSourcePath(node: PropertyTreeNode): string {
    let earliest: string | null = null;

    for (const path of node.notesWithValue) {
        if (earliest === null || path < earliest) {
            earliest = path;
        }
    }

    return earliest ?? '';
}

/**
 * Whether the list pane title should be rendered as a property note link.
 * Deliberately does not require the link to resolve: unresolved links stay
 * clickable and fall through to Obsidian's own create-on-click behavior.
 */
export function hasPropertyNoteLink(node: PropertyTreeNode | null, enablePropertyNoteLinks: boolean): boolean {
    if (!enablePropertyNoteLinks) {
        return false;
    }

    return getPropertyNoteLinkTarget(node) !== null;
}

/**
 * Resolves the note a property value points at, or null when the value is not a
 * wikilink or the link has no target file.
 */
export function resolvePropertyNote(node: PropertyTreeNode | null, app: App): TFile | null {
    if (!node) {
        return null;
    }

    const linkTarget = getPropertyNoteLinkTarget(node);
    if (!linkTarget) {
        return null;
    }

    return app.metadataCache.getFirstLinkpathDest(linkTarget, getPropertyNoteSourcePath(node));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/utils/propertyNoteLookup.test.ts`
Expected: PASS (21 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/propertyNoteLookup.ts tests/utils/propertyNoteLookup.test.ts
git commit -m "feat: add property note lookup"
```

---

### Task 3: Property note opener

Mirrors `openFolderNoteFile` minus the folder-specific command-queue wrapper and the sidebar-service callback.

**Files:**
- Create: `src/utils/propertyNotes.ts`
- Modify: `tests/stubs/obsidian.ts` (only if workspace methods are missing)
- Test: `tests/utils/propertyNotes.test.ts` (create)

**Interfaces:**
- Consumes: `openFileInContext` — read the import line at the top of `src/utils/folderNotes.ts` and import it from the identical source.
- Produces:

```ts
export interface OpenPropertyNoteFileParams {
    app: App;
    commandQueue: CommandQueueService | null;
    propertyNote: TFile;
    context: 'tab' | 'right-sidebar' | null;
    active?: boolean;
}

export async function openPropertyNoteFile(params: OpenPropertyNoteFileParams): Promise<void>
```

Use the same type for `commandQueue` that `OpenFolderNoteFileParams` uses in `src/utils/folderNotes.ts`.

- [ ] **Step 1: Write the failing test**

Create `tests/utils/propertyNotes.test.ts` (GPL header first):

```ts
import { App } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { openPropertyNoteFile } from '../../src/utils/propertyNotes';
import { createTestTFile } from './createTestTFile';

describe('openPropertyNoteFile', () => {
    it('opens in the active leaf when no context is given', async () => {
        const app = new App();
        const openFile = vi.fn().mockResolvedValue(undefined);
        app.workspace.getLeaf = vi.fn().mockReturnValue({ openFile });
        const file = createTestTFile('Apple.md');

        await openPropertyNoteFile({ app, commandQueue: null, propertyNote: file, context: null });

        expect(app.workspace.getLeaf).toHaveBeenCalledWith(false);
        expect(openFile).toHaveBeenCalledWith(file, { active: true });
    });

    it('honors an explicit inactive open', async () => {
        const app = new App();
        const openFile = vi.fn().mockResolvedValue(undefined);
        app.workspace.getLeaf = vi.fn().mockReturnValue({ openFile });
        const file = createTestTFile('Apple.md');

        await openPropertyNoteFile({ app, commandQueue: null, propertyNote: file, context: null, active: false });

        expect(openFile).toHaveBeenCalledWith(file, { active: false });
    });

    it('opens in the right sidebar when asked', async () => {
        const app = new App();
        const openFile = vi.fn().mockResolvedValue(undefined);
        const leaf = { openFile };
        app.workspace.getRightLeaf = vi.fn().mockReturnValue(leaf);
        app.workspace.revealLeaf = vi.fn().mockResolvedValue(undefined);
        const file = createTestTFile('Apple.md');

        await openPropertyNoteFile({ app, commandQueue: null, propertyNote: file, context: 'right-sidebar' });

        expect(openFile).toHaveBeenCalledWith(file, { active: false });
        expect(app.workspace.revealLeaf).toHaveBeenCalledWith(leaf);
    });

    it('does nothing when the right sidebar has no leaf', async () => {
        const app = new App();
        app.workspace.getRightLeaf = vi.fn().mockReturnValue(null);
        app.workspace.revealLeaf = vi.fn();
        const file = createTestTFile('Apple.md');

        await openPropertyNoteFile({ app, commandQueue: null, propertyNote: file, context: 'right-sidebar' });

        expect(app.workspace.revealLeaf).not.toHaveBeenCalled();
    });

    it('does nothing when there is no active leaf', async () => {
        const app = new App();
        app.workspace.getLeaf = vi.fn().mockReturnValue(null);
        const file = createTestTFile('Apple.md');

        await expect(
            openPropertyNoteFile({ app, commandQueue: null, propertyNote: file, context: null })
        ).resolves.toBeUndefined();
    });
});
```

If `App` in `tests/stubs/obsidian.ts` has no `workspace.getLeaf`, `workspace.getRightLeaf`, or `workspace.revealLeaf`, add them returning `null` / resolving `undefined` so tests can override them. Keep the stub minimal.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/utils/propertyNotes.test.ts`
Expected: FAIL — cannot resolve `../../src/utils/propertyNotes`.

- [ ] **Step 3: Write the implementation**

Create `src/utils/propertyNotes.ts` (GPL header first). This mirrors the `openFile` closure in `src/utils/folderNotes.ts:154-181`, dropping the `openInRightSidebar` callback (there is no property note sidebar service) and the `commandQueue.executeOpenFolderNote` wrapper (that specifically tracks folder note opens):

```ts
export async function openPropertyNoteFile({
    app,
    commandQueue,
    propertyNote,
    context,
    active = true
}: OpenPropertyNoteFileParams): Promise<void> {
    if (context === 'right-sidebar') {
        const leaf = app.workspace.getRightLeaf(true) ?? app.workspace.getRightLeaf(false);
        if (!leaf) {
            return;
        }

        await leaf.openFile(propertyNote, { active: false });
        await app.workspace.revealLeaf(leaf);
        return;
    }

    if (context) {
        await openFileInContext({ app, commandQueue, file: propertyNote, context, active });
        return;
    }

    const leaf = app.workspace.getLeaf(false);
    if (!leaf) {
        return;
    }

    await leaf.openFile(propertyNote, { active });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/utils/propertyNotes.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/propertyNotes.ts tests/utils/propertyNotes.test.ts tests/stubs/obsidian.ts
git commit -m "feat: add property note opener"
```

---

### Task 4: Remove the clickable-title settings

**Scope change:** the clickable list-pane title was cut from this feature after Task 3. The
settings and helper that existed only to serve it are now orphaned and must be removed, leaving
auto-open as the feature's only behavior.

**Files:**
- Modify: `src/settings/types.ts` (remove `enablePropertyNoteLinks` from `NotebookNavigatorSettings`)
- Modify: `src/settings/defaultSettings.ts` (remove its default)
- Modify: `src/settings/nativeSettingControls.ts` (remove from the boolean-keys list and from `NATIVE_SETTING_DOM_STATE_REFRESH_KEYS`)
- Modify: `src/settings/tabs/PropertiesTab.ts` (remove its toggle; change the dropdown gate)
- Modify: `src/settings/tabs/legacy/PropertiesLegacyTab.ts` (remove its setting block)
- Modify: `src/utils/propertyNoteLookup.ts` (remove `hasPropertyNoteLink`)
- Modify: `tests/utils/propertyNoteLookup.test.ts` (remove its describe block)
- Modify: `tests/settings/propertyNoteSettings.test.ts` (remove its assertion)
- Modify: `src/i18n/locales/en.ts` and all 20 other locales (remove the `enablePropertyNoteLinks` entry)

**Interfaces:**
- Consumes: everything Tasks 1-3 produced.
- Produces: a settings surface of exactly two keys — `autoOpenPropertyNote` and `propertyNoteOpenLocation`. `propertyNoteOpenLocation` keeps its type alias `PropertyNoteOpenLocation` and guard `isPropertyNoteOpenLocation`; those stay because auto-open uses them.

`getPropertyNoteLinkTarget`, `getPropertyNoteSourcePath`, and `resolvePropertyNote` all STAY — Task 5 uses them.

- [ ] **Step 1: Update the settings test first**

In `tests/settings/propertyNoteSettings.test.ts`, delete the `enablePropertyNoteLinks` assertion so the first test reads:

```ts
    it('defaults auto-open to off', () => {
        expect(DEFAULT_SETTINGS.autoOpenPropertyNote).toBe(false);
    });
```

Leave the open-location tests untouched.

- [ ] **Step 2: Remove the hasPropertyNoteLink tests**

In `tests/utils/propertyNoteLookup.test.ts`, delete the entire `describe('hasPropertyNoteLink', ...)` block and remove `hasPropertyNoteLink` from the import list. Leave the other three describe blocks exactly as they are.

- [ ] **Step 3: Run both tests to verify they fail**

Run: `npx vitest run tests/settings/propertyNoteSettings.test.ts tests/utils/propertyNoteLookup.test.ts`
Expected: they still PASS at this point (removing assertions cannot fail). This step is a checkpoint, not a red bar — confirm the reduced suites are green before touching source.

- [ ] **Step 4: Remove hasPropertyNoteLink from the lookup module**

In `src/utils/propertyNoteLookup.ts`, delete the entire `hasPropertyNoteLink` function and its JSDoc block. Leave the other three exports and their comments untouched.

- [ ] **Step 5: Remove the setting**

Delete `enablePropertyNoteLinks` from:
- `src/settings/types.ts` — the `NotebookNavigatorSettings` interface
- `src/settings/defaultSettings.ts` — the default value
- `src/settings/nativeSettingControls.ts` — the boolean-keys list AND `NATIVE_SETTING_DOM_STATE_REFRESH_KEYS`
- `src/settings/tabs/PropertiesTab.ts` — its `createToggleDefinition` entry
- `src/settings/tabs/legacy/PropertiesLegacyTab.ts` — its setting block

In `src/settings/tabs/PropertiesTab.ts`, change the dropdown's visibility gate from

```ts
                visible: () => plugin.settings.enablePropertyNoteLinks || plugin.settings.autoOpenPropertyNote,
```

to

```ts
                visible: () => plugin.settings.autoOpenPropertyNote,
```

- [ ] **Step 6: Remove the i18n entry**

Delete the `enablePropertyNoteLinks: { name, desc }` entry from `src/i18n/locales/en.ts` and from all 20 other locale files. Leave `settings.sections.propertyNotes`, `autoOpenPropertyNote`, and `propertyNoteOpenLocation` in place in every file.

- [ ] **Step 7: Verify nothing references the removed names**

Run: `grep -rn "enablePropertyNoteLinks\|hasPropertyNoteLink" src/ tests/`
Expected: no output. If anything remains, remove it.

- [ ] **Step 8: Run the full suite and build**

Run: `npx vitest run && npm run build && npm run lint`
Expected: all tests pass, zero errors, zero warnings. `knip` runs as part of the quality checks — if it flags any newly-unused export, remove that too and note it in your report.

- [ ] **Step 9: Commit**

```bash
git add src tests
git commit -m "refactor: drop the clickable title settings"
```

---

### Task 5: Auto-open on explicit activation

Fires on property row click and on Enter. Deliberately **not** on arrow-key movement.

**Files:**
- Modify: `src/hooks/navigationPane/useNavigationPaneTreeInteractions.ts` (property row click handler, around :590-660)
- Modify: `src/hooks/useNavigationPaneKeyboard.ts` (after the folder-note Enter block, which ends at :327)
- Test: `tests/hooks/useNavigationPaneTreeInteractions.test.ts` (extend)

**Interfaces:**
- Consumes: `resolvePropertyNote` (Task 2); `openPropertyNoteFile` (Task 3); `resolveFolderNoteDefaultOpenContext` from `src/utils/keyboardOpenContext.ts`; `resolvePropertyTreeNode` from `src/utils/propertyTree.ts`.
- Produces: nothing consumed later.

**Critical:** `src/hooks/useNavigationPaneKeyboard.ts:224-244` is the **arrow-key** selection path — it dispatches `SET_SELECTED_PROPERTY` as the user moves through the tree. Do **not** hook auto-open there; it would open a note per keystroke. The Enter handler is the separate block at :294-327 guarded by `isEnterKey(e)`.

Auto-open only fires when the link **resolves**. It never creates a file: if `getFirstLinkpathDest` returns null, nothing happens at all.

- [ ] **Step 1: Write the failing test**

First, extend the file's existing `createPropertyValueNode` helper with an optional `assignmentValue` parameter, defaulting to `undefined` so existing tests are unaffected:

```ts
function createPropertyValueNode(
    key: string,
    valuePath: string,
    name: string,
    notes: string[],
    assignmentValue?: string
): PropertyTreeNode {
    // …existing body, plus `assignmentValue,` in the returned object literal
}
```

Then append this describe block. The harness mirrors the one already in the file at :146-173 — the hook takes injected params, so no context providers are needed:

```ts
describe('auto-open property notes', () => {
    function clickPropertyValue(params: {
        assignmentValue?: string;
        autoOpenPropertyNote: boolean;
        resolved: TFile | null;
    }) {
        const valueNode = createPropertyValueNode('references', 'apple', 'Apple', ['notes/a.md'], params.assignmentValue);
        const keyNode = createPropertyKeyNode('references', 'References', ['notes/a.md'], [valueNode]);

        const app = new App();
        app.metadataCache.getFirstLinkpathDest = () => params.resolved;
        const openFile = vi.fn().mockResolvedValue(undefined);
        app.workspace.getLeaf = vi.fn().mockReturnValue({ openFile });

        const propertyTree = new Map<string, PropertyTreeNode>([[keyNode.key, keyNode]]);
        const propertyTreeProvider: IPropertyTreeProvider = {
            hasNodes: () => true,
            addTreeUpdateListener: () => () => {},
            findNode: nodeId => (nodeId === valueNode.id ? valueNode : nodeId === keyNode.id ? keyNode : null),
            getKeyNode: normalizedKey => (normalizedKey === keyNode.key ? keyNode : null),
            resolveSelectionNodeId: nodeId => nodeId,
            collectDescendantNodeIds: () => new Set(),
            collectFilePaths: () => new Set(),
            collectFilesForKeys: () => new Set()
        };

        const selectionDispatch = vi.fn();
        let captured: NavigationPaneTreeInteractionsResult | null = null;

        function Harness() {
            captured = useNavigationPaneTreeInteractions({
                app,
                commandQueue: null,
                settings: { ...DEFAULT_SETTINGS, autoOpenPropertyNote: params.autoOpenPropertyNote },
                uiState: { singlePane: false },
                expansionState: {
                    expandedFolders: new Set(),
                    expandedTags: new Set(),
                    expandedProperties: new Set(),
                    expandedVirtualFolders: new Set()
                },
                expansionDispatch: vi.fn(),
                selectionState: createSelectionState(),
                selectionDispatch,
                uiDispatch: vi.fn(),
                propertyTreeService: propertyTreeProvider,
                tagTree: new Map(),
                propertyTree,
                tagsVirtualFolderHasChildren: false,
                setShortcutsExpanded: vi.fn(),
                setRecentNotesExpanded: vi.fn(),
                clearActiveShortcut: vi.fn(),
                openFolderNoteInRightSidebar: vi.fn(),
                onModifySearchWithTag: vi.fn(),
                onModifySearchWithProperty: vi.fn()
            });
            return null;
        }

        renderToStaticMarkup(React.createElement(Harness));
        if (!captured) {
            throw new Error('Expected hook result');
        }

        (captured as NavigationPaneTreeInteractionsResult).handlePropertyClick(valueNode);

        return { openFile, selectionDispatch, valueNode };
    }

    it('opens the note when clicking a wikilink value with the setting on', async () => {
        const file = createTestTFile('Apple.md');
        const { openFile } = clickPropertyValue({
            assignmentValue: '[[Apple]]',
            autoOpenPropertyNote: true,
            resolved: file
        });

        await Promise.resolve();

        expect(openFile).toHaveBeenCalledWith(file, { active: true });
    });

    it('still selects the property value when auto-open fires', async () => {
        const { selectionDispatch, valueNode } = clickPropertyValue({
            assignmentValue: '[[Apple]]',
            autoOpenPropertyNote: true,
            resolved: createTestTFile('Apple.md')
        });

        await Promise.resolve();

        expect(selectionDispatch).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'SET_SELECTED_PROPERTY', nodeId: valueNode.id })
        );
    });

    it('opens nothing when the setting is off', async () => {
        const { openFile } = clickPropertyValue({
            assignmentValue: '[[Apple]]',
            autoOpenPropertyNote: false,
            resolved: createTestTFile('Apple.md')
        });

        await Promise.resolve();

        expect(openFile).not.toHaveBeenCalled();
    });

    it('opens nothing and creates nothing when the link does not resolve', async () => {
        const { openFile } = clickPropertyValue({
            assignmentValue: '[[Ghost]]',
            autoOpenPropertyNote: true,
            resolved: null
        });

        await Promise.resolve();

        expect(openFile).not.toHaveBeenCalled();
    });

    it('opens nothing for a plain string value', async () => {
        const { openFile } = clickPropertyValue({
            assignmentValue: 'draft',
            autoOpenPropertyNote: true,
            resolved: createTestTFile('Draft.md')
        });

        await Promise.resolve();

        expect(openFile).not.toHaveBeenCalled();
    });
});
```

Add `TFile` to the `obsidian` import at the top of the file if it is not already imported.

If `handlePropertyClick` proves to require the `event` argument at runtime, pass a minimal stub as the second argument — check the handler at `src/hooks/navigationPane/useNavigationPaneTreeInteractions.ts:623` for how `event` is used before assuming.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hooks/useNavigationPaneTreeInteractions.test.ts`
Expected: FAIL — the open spy is never called.

- [ ] **Step 3: Implement auto-open on row click**

In the property row click handler in `useNavigationPaneTreeInteractions.ts`, after the existing `SET_SELECTED_PROPERTY` dispatch:

```ts
            if (settings.autoOpenPropertyNote) {
                const propertyNote = resolvePropertyNote(propertyNode, app);
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
            }
```

Use whatever local variable holds the clicked node (the handler around :645 already has it). Add `app`, `commandQueue`, and `settings` to the callback's dependency array if not already present.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/hooks/useNavigationPaneTreeInteractions.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement auto-open on Enter**

In `src/hooks/useNavigationPaneKeyboard.ts`, directly after the folder-note Enter block ends (:327), add:

```ts
            if (
                isEnterKey(e) &&
                settings.autoOpenPropertyNote &&
                selectionState.selectionType === ItemType.PROPERTY &&
                selectionState.selectedProperty
            ) {
                const resolved = resolvePropertyTreeNode({
                    nodeId: selectionState.selectedProperty,
                    propertyTreeService
                });
                const propertyNote = resolved ? resolvePropertyNote(resolved.node, app) : null;
                if (propertyNote) {
                    e.preventDefault();

                    runAsyncAction(() =>
                        openPropertyNoteFile({
                            app,
                            commandQueue,
                            propertyNote,
                            context: resolveFolderNoteDefaultOpenContext(settings.propertyNoteOpenLocation),
                            active: false
                        })
                    );
                    return;
                }
            }
```

Obtain `propertyTreeService` the way this hook already reaches services — check its existing `useServices()` / parameter destructuring at the top of the file. If the property tree is not reachable there, pass it in as a new hook parameter from the caller rather than importing a singleton.

- [ ] **Step 6: Verify the build and full suite**

Run: `npm run build && npm run lint && npx vitest run`
Expected: zero errors, zero warnings, all tests pass.

- [ ] **Step 7: Manual check in Obsidian**

1. Enable **Open property note automatically**. Click a property value that is a wikilink — the note opens *and* the list pane still fills with everything carrying that value.
2. Use arrow keys to move through several property values — **no notes open**. This is the behavior most likely to regress; check it deliberately.
3. Press Enter on a property value — the note opens.
4. Click a property value whose link has no target — nothing opens and no file is created.

- [ ] **Step 8: Commit**

```bash
git add src/hooks tests/hooks
git commit -m "feat: auto-open property notes on click and Enter"
```

---

### Task 6: Translations and documentation

**Files:**
- Modify: `src/i18n/locales/{ar,de,es,fa,fr,id,it,ja,ko,nl,pl,pt,pt_br,ru,th,tr,uk,vi,zh_cn,zh_tw}.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: the English keys surviving after Task 4.
- Produces: nothing.

**Exactly three keys exist at this point**, all currently holding verbatim English text in the 20
non-English locales (Task 1 added them as placeholders; Task 4 removed a fourth):
`settings.sections.propertyNotes`, `settings.items.autoOpenPropertyNote.{name,desc}`, and
`settings.items.propertyNoteOpenLocation.{name,desc,options.{currentTab,newTab,rightSidebar}}`.
There must be NO `enablePropertyNoteLinks` entry in any locale — if you find one, Task 4 missed it;
remove it and say so in your report.

- [ ] **Step 1: Confirm the current locale state**

Run: `grep -rln "enablePropertyNoteLinks" src/i18n/locales/`
Expected: no output.

Run: `npm run build`
Expected: zero errors — the placeholders from Task 1 satisfy the type. This step establishes the
baseline, not a red bar.

- [ ] **Step 2: Translate the strings**

For each of the 20 locales, replace the placeholder English text of the three keys above with real
translations. Keep the option keys (`currentTab`, `newTab`, `rightSidebar`) and all key names
unchanged — only the human-readable values change. Read each file's neighboring `folderNote*`
entries first and match their terminology and tone; every locale has settled conventions for "tab",
"sidebar", and "note".

- [ ] **Step 3: Verify the build**

Run: `npm run build && npm run lint`
Expected: zero errors, zero warnings.

- [ ] **Step 4: Update the README**

In the features list, next to the "Folder notes" bullet at :449, add:

```markdown
- **Property notes** - Open the note a property value links to when you navigate to that value
```

Then add a short paragraph to the settings documentation covering: property notes are found by
resolving the wikilink, so only wikilink values have one and plain-string values such as
`status: draft` do not; the note opens on click or Enter but never on arrow-key movement; and the
note is never created — if the link has no target, nothing opens.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run && npm run build && npm run lint`
Expected: all tests pass, zero errors, zero warnings.

- [ ] **Step 6: Commit**

```bash
git add src/i18n README.md
git commit -m "feat: translate property note settings and document the feature"
```

---

## Known limitation — do not try to fix

`PropertyTreeNode.assignmentValue` is an aggregation artifact, first-writer-wins with one upgrade to link markup (`src/utils/propertyTree.ts:403`). If some notes write `[[Apple]]` and others `[[Fruits/Apple|Apple]]`, they collapse into one value node (both normalize on the alias/display text) and indexing order decides which note the title links to. Note that `[[Apple]]` and an *unaliased* `[[Fruits/Apple]]` do NOT collapse — they normalize to different nodes. This is inherent to resolving wikilinks rather than using a name convention, and is documented in the spec. Do not add caching, tie-breaking, or normalization to work around it — that is a separate design decision.
