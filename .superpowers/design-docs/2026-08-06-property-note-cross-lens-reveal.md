# Property note cross-lens reveal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in `autoRevealPropertyNote` setting so that opening a property note from outside the navigator switches the navigation pane into the properties tree and selects the value node that note defines.

**Architecture:** A pure decision function in `src/utils/propertyNoteLookup.ts` answers "should this reveal jump to the properties tree, and where". `revealFileInNearestFolder` gains one branch that applies the answer by setting `targetProperty` and expanding ancestors, then falls through to the reveal function's existing single `REVEAL_FILE` dispatch and existing scroll call. No new dispatch path, no cache, no readiness handling.

**Tech Stack:** TypeScript, React (hooks + context), Obsidian plugin API, Vitest.

**Spec:** [`docs/superpowers/specs/2026-08-06-property-note-cross-lens-reveal-design.md`](../specs/2026-08-06-property-note-cross-lens-reveal-design.md)

## Global Constraints

- Setting key is `autoRevealPropertyNote`, type `boolean`, default `false`.
- The lens jump fires **only** for reveals whose source is `'auto'` or `'startup'`. Never `'shortcut'`, never `'manual'`.
- The file→value lookup is resolved on demand every time. Do **not** add a cache, index, or memo.
- Do **not** route the jump through `navigateToProperty` — it dispatches `SET_SELECTED_PROPERTY`, which on top of `REVEAL_FILE` records two history entries for one user action.
- All 21 locale files under `src/i18n/locales/` must gain any new string key. `getResolvedStrings` returns a locale object wholesale with no merge against English, and `loadLocaleOverrides` is typed `TranslationStrings | undefined`, so a missing key fails `tsc -noEmit`.
- No settings migration. This is a new key with a default; nothing has ever stored it.
- Verification commands: `npx vitest run <path>` for a single test file, `npm test` for all, `npm run lint`, `npx tsc -noEmit -skipLibCheck`.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/utils/propertyNoteLookup.ts` | Property note lookups and reveal decisions, all pure | Modify: deterministic sort in `findPropertyNoteValueNode`; add `resolvePropertyNoteLensJump` |
| `tests/utils/propertyNoteLookup.test.ts` | Unit tests for the above | Modify: add cases |
| `src/settings/types.ts` | Settings interface | Modify: add key |
| `src/settings/defaultSettings.ts` | Defaults | Modify: add `false` |
| `src/settings/nativeSettingControls.ts` | Registry of native-control setting keys | Modify: add to `BOOLEAN_SETTING_KEYS` |
| `src/settings/tabs/PropertiesTab.ts` | Current Properties settings tab | Modify: add toggle |
| `src/settings/tabs/legacy/PropertiesLegacyTab.ts` | Legacy Properties settings tab | Modify: add toggle |
| `src/i18n/locales/*.ts` (21 files) | Display strings | Modify: add `autoRevealPropertyNote` name + desc |
| `src/hooks/useNavigatorReveal.ts` | Reveal orchestration | Modify: apply the jump in `revealFileInNearestFolder` |
| `README.md` | User documentation | Modify: extend the property notes paragraph |

---

### Task 1: Deterministic tie-break in `findPropertyNoteValueNode`

A note can be the wikilink target of values under several keys — `Clients.md` can be both `categories=clients` and `projects=clients`. The function currently returns the first match in map iteration order, over a map rebuilt wholesale from a fresh database scan, so the same note can land on different nodes across rebuilds. This task makes the answer stable before anything depends on it.

**Files:**
- Modify: `src/utils/propertyNoteLookup.ts` (the `findPropertyNoteValueNode` body, and the stray blank line at line 26)
- Test: `tests/utils/propertyNoteLookup.test.ts` (inside the existing `describe('findPropertyNoteValueNode')` block)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `findPropertyNoteValueNode` keeps its existing exported signature — `({ filePath, propertyTree, app, preferNodeId }: FindPropertyNoteValueNodeParams) => PropertyTreeNode | null`. Only its tie-break behavior changes. Task 2 calls it.

- [ ] **Step 1: Write the failing test**

Add this inside the existing `describe('findPropertyNoteValueNode', ...)` block in `tests/utils/propertyNoteLookup.test.ts`, after the `'prefers the requested node when a note defines values under several keys'` test. It uses the `createTree` and `createLinkingApp` helpers already defined at the top of that block.

```ts
    it('picks the same node regardless of tree iteration order', () => {
        // A note can be the target of values under several keys. The tree is a fresh map rebuilt
        // from a database scan, so iteration order is not a contract - without a sort the answer
        // drifts between equally valid nodes across rebuilds.
        const app = createLinkingApp('Clients.md');
        const forward = createTree(
            createValueNode('categories', 'clients', '[[Clients]]', ['a.md']),
            createValueNode('projects', 'clients', '[[Clients]]', ['a.md'])
        );
        const reversed = createTree(
            createValueNode('projects', 'clients', '[[Clients]]', ['a.md']),
            createValueNode('categories', 'clients', '[[Clients]]', ['a.md'])
        );

        const fromForward = findPropertyNoteValueNode({ filePath: 'Clients.md', propertyTree: forward, app });
        const fromReversed = findPropertyNoteValueNode({ filePath: 'Clients.md', propertyTree: reversed, app });

        expect(fromForward?.id).toBe(buildPropertyValueNodeId('categories', 'clients'));
        expect(fromReversed?.id).toBe(fromForward?.id);
    });

    it('sorts by value path when one key holds several matching values', () => {
        const app = createLinkingApp('Clients.md');
        const tree = createTree(
            createValueNode('categories', 'zulu', '[[Clients]]', ['a.md']),
            createValueNode('categories', 'alpha', '[[Clients]]', ['a.md'])
        );

        expect(findPropertyNoteValueNode({ filePath: 'Clients.md', propertyTree: tree, app })?.id).toBe(
            buildPropertyValueNodeId('categories', 'alpha')
        );
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/utils/propertyNoteLookup.test.ts`

Expected: both new tests FAIL. `'picks the same node regardless of tree iteration order'` fails on the `fromReversed` assertion, receiving the `projects` node id. `'sorts by value path...'` fails receiving the `zulu` node id.

The pre-existing test `'prefers the requested node when a note defines values under several keys'` must still PASS — it asserts `categories` wins with no preference, and sorting by key gives the same answer.

- [ ] **Step 3: Implement the sort**

In `src/utils/propertyNoteLookup.ts`, replace the whole body of `findPropertyNoteValueNode` with:

```ts
export function findPropertyNoteValueNode({
    filePath,
    propertyTree,
    app,
    preferNodeId
}: FindPropertyNoteValueNodeParams): PropertyTreeNode | null {
    if (!propertyTree) {
        return null;
    }

    const matches: PropertyTreeNode[] = [];

    for (const keyNode of propertyTree.values()) {
        for (const valueNode of keyNode.children.values()) {
            const assignmentValue = valueNode.assignmentValue;
            // Cheap pre-filter: a value without link markup can never resolve to a note.
            if (!assignmentValue || !assignmentValue.includes('[[')) {
                continue;
            }

            if (resolvePropertyNote(valueNode, app)?.path !== filePath) {
                continue;
            }

            if (preferNodeId && valueNode.id === preferNodeId) {
                return valueNode;
            }

            matches.push(valueNode);
        }
    }

    if (matches.length === 0) {
        return null;
    }

    // The tree is a fresh map rebuilt from a database scan, so iteration order is not a stable
    // contract. Sorting keeps a note that defines values under several keys landing on the same
    // node every time instead of drifting between equally valid answers across rebuilds.
    matches.sort((a, b) => a.key.localeCompare(b.key) || (a.valuePath ?? '').localeCompare(b.valuePath ?? ''));

    return matches[0];
}
```

- [ ] **Step 4: Remove the stray blank line**

The in-flight work left a double blank line after the imports in `src/utils/propertyNoteLookup.ts`. Around line 25-27 it reads:

```ts
import type { PropertySelectionNodeId } from './propertyTree';


/**
```

Delete one blank line so there is a single blank line before the `/**` comment.

- [ ] **Step 5: Run the tests and lint to verify they pass**

Run: `npx vitest run tests/utils/propertyNoteLookup.test.ts`
Expected: PASS, all tests in the file.

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/utils/propertyNoteLookup.ts tests/utils/propertyNoteLookup.test.ts
git commit -m "fix: make the property note reverse lookup order-independent"
```

---

### Task 2: `resolvePropertyNoteLensJump` decision function

The pure decision: given the reveal's source, the current lens, and the file, should the navigator switch into the properties tree, and onto which node. Kept out of the hook so it is testable and so `revealFileInNearestFolder` gains no branching logic beyond applying the answer.

**Files:**
- Modify: `src/utils/propertyNoteLookup.ts` (add exports after `resolvePropertyRevealTarget`)
- Test: `tests/utils/propertyNoteLookup.test.ts` (new `describe` block after the `resolvePropertyRevealTarget` block)

**Interfaces:**
- Consumes: `findPropertyNoteValueNode` from Task 1, unchanged signature.
- Produces:
  ```ts
  export interface PropertyNoteLensJump {
      targetProperty: PropertySelectionNodeId;
      keyNodeId: string | null;
  }
  export function resolvePropertyNoteLensJump(params: ResolvePropertyNoteLensJumpParams): PropertyNoteLensJump | null;
  ```
  Task 4 calls this and reads both fields.

- [ ] **Step 1: Write the failing tests**

Add this new `describe` block to `tests/utils/propertyNoteLookup.test.ts`, after the closing `});` of `describe('resolvePropertyRevealTarget', ...)`.

Note the imports at the top of the file need `resolvePropertyNoteLensJump` added to the existing named import list from `'../../src/utils/propertyNoteLookup'`.

```ts
describe('resolvePropertyNoteLensJump', () => {
    function createTree(...nodes: PropertyTreeNode[]): Map<string, PropertyTreeNode> {
        const tree = new Map<string, PropertyTreeNode>();
        for (const node of nodes) {
            const keyNode = tree.get(node.key) ?? createKeyNode(node.key);
            keyNode.children.set(node.id, node);
            tree.set(node.key, keyNode);
        }
        return tree;
    }

    function createLinkingApp(...paths: string[]): App {
        const files = new Map(paths.map(path => [path.replace(/\.md$/, ''), createTestTFile(path)]));
        const app = new App();
        app.metadataCache.getFirstLinkpathDest = (target: string) => files.get(target) ?? null;
        return app;
    }

    const tree = createTree(createValueNode('categories', 'clients', '[[Clients]]', ['a.md']));

    function baseParams() {
        return {
            enabled: true,
            revealSource: 'auto' as const,
            selectionType: ItemType.FOLDER as NavigationItemType,
            filePath: 'Clients.md',
            propertyTree: tree,
            app: createLinkingApp('Clients.md')
        };
    }

    it('jumps to the value node the file defines, with its key node to expand', () => {
        expect(resolvePropertyNoteLensJump(baseParams())).toEqual({
            targetProperty: buildPropertyValueNodeId('categories', 'clients'),
            keyNodeId: buildPropertyKeyNodeId('categories')
        });
    });

    it('jumps from a tag selection too - defining a value beats carrying a tag', () => {
        expect(resolvePropertyNoteLensJump({ ...baseParams(), selectionType: ItemType.TAG })?.targetProperty).toBe(
            buildPropertyValueNodeId('categories', 'clients')
        );
    });

    it('does not jump while the setting is off', () => {
        expect(resolvePropertyNoteLensJump({ ...baseParams(), enabled: false })).toBeNull();
    });

    it.each(['shortcut', 'manual'] as const)('does not jump for a %s reveal', revealSource => {
        // Shortcuts and recent notes run through the same reveal function. Those clicks happen
        // inside the navigation pane, where the user can see the tree and did not ask to leave it.
        expect(resolvePropertyNoteLensJump({ ...baseParams(), revealSource })).toBeNull();
    });

    it('does not jump for an undefined reveal source', () => {
        expect(resolvePropertyNoteLensJump({ ...baseParams(), revealSource: undefined })).toBeNull();
    });

    it.each(['auto', 'startup'] as const)('jumps for a %s reveal', revealSource => {
        expect(resolvePropertyNoteLensJump({ ...baseParams(), revealSource })).not.toBeNull();
    });

    it('does not jump when the property lens is already selected', () => {
        // resolvePropertyRevealTarget owns that case and handles a property note without a lens change.
        expect(resolvePropertyNoteLensJump({ ...baseParams(), selectionType: ItemType.PROPERTY })).toBeNull();
    });

    it('does not jump for a file no value points at', () => {
        expect(resolvePropertyNoteLensJump({ ...baseParams(), filePath: 'Unrelated.md' })).toBeNull();
    });

    it('does not jump when the link target does not resolve', () => {
        expect(resolvePropertyNoteLensJump({ ...baseParams(), app: createLinkingApp() })).toBeNull();
    });

    it('does not jump without a property tree', () => {
        expect(resolvePropertyNoteLensJump({ ...baseParams(), propertyTree: null })).toBeNull();
    });
});
```

The file's top-level imports also need `buildPropertyKeyNodeId` (already imported) and the `NavigationItemType` type. Add to the existing `src/types` import line:

```ts
import { ItemType, type NavigationItemType } from '../../src/types';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/utils/propertyNoteLookup.test.ts`
Expected: FAIL — `resolvePropertyNoteLensJump is not a function`, or a TypeScript/import resolution error naming the missing export.

- [ ] **Step 3: Implement the function**

In `src/utils/propertyNoteLookup.ts`, add to the imports. The `./propertyTree` import currently brings in only the `PropertySelectionNodeId` type; it needs three functions as well, and `SelectionRevealSource` comes from the selection context types (there is precedent — `src/utils/propertyNavigation.ts` imports the same type):

```ts
import {
    getPropertyKeyNodeIdFromNodeId,
    isPropertyTreeNodeId,
    normalizePropertyNodeId,
    type PropertySelectionNodeId
} from './propertyTree';
import type { SelectionRevealSource } from '../context/selection/types';
```

Then add this after `resolvePropertyRevealTarget`:

```ts
export interface PropertyNoteLensJump {
    /** The value node the reveal should land on. */
    targetProperty: PropertySelectionNodeId;
    /** The key node to expand so the value node is visible, or null when there is nothing to expand. */
    keyNodeId: string | null;
}

export interface ResolvePropertyNoteLensJumpParams {
    /** showProperties && enablePropertyNotes && autoRevealPropertyNote. */
    enabled: boolean;
    /** How the reveal was triggered. Only auto-reveal and startup may change the lens. */
    revealSource: SelectionRevealSource | undefined;
    /** The navigation pane's current selection type. */
    selectionType: NavigationItemType;
    /** Path of the file being revealed. */
    filePath: string;
    /** Property tree to search. Already filtered to the keys the navigation pane shows. */
    propertyTree: ReadonlyMap<string, PropertyTreeNode> | null;
    app: App;
}

/**
 * Whether a reveal should leave the current lens and land in the properties tree, and where.
 *
 * Reveal everywhere else in the navigator is containment-based: the target holds the revealed file
 * in its list. A property note is not a member of the value it defines, so containment can never
 * find it, and the only way to reveal one as a property note is to switch lens deliberately.
 */
export function resolvePropertyNoteLensJump({
    enabled,
    revealSource,
    selectionType,
    filePath,
    propertyTree,
    app
}: ResolvePropertyNoteLensJumpParams): PropertyNoteLensJump | null {
    if (!enabled) {
        return null;
    }

    // Shortcuts, recent notes, the homepage's manual trigger and the public API all reach the same
    // reveal function. Those act from inside the navigation pane, where the tree is already visible
    // and the user did not ask to leave it, so only auto-reveal and startup may change the lens.
    if (revealSource !== 'auto' && revealSource !== 'startup') {
        return null;
    }

    // Already in the property tree: resolvePropertyRevealTarget owns that case and resolves a
    // property note correctly without a lens change.
    if (selectionType === ItemType.PROPERTY) {
        return null;
    }

    const valueNode = findPropertyNoteValueNode({ filePath, propertyTree, app });
    if (!valueNode) {
        return null;
    }

    const targetProperty = normalizePropertyNodeId(valueNode.id);
    if (!targetProperty) {
        return null;
    }

    const rawKeyNodeId = getPropertyKeyNodeIdFromNodeId(targetProperty);
    const keyNodeId =
        rawKeyNodeId && rawKeyNodeId !== targetProperty && isPropertyTreeNodeId(rawKeyNodeId) ? rawKeyNodeId : null;

    return { targetProperty, keyNodeId };
}
```

`ItemType` and `NavigationItemType` are already imported in this file by `resolvePropertyRevealTarget`. `PropertyTreeNode` and `App` are already imported too. If `tsc` reports any of them missing, add them to the existing import lines rather than creating new ones.

- [ ] **Step 4: Run the tests, types and lint to verify they pass**

Run: `npx vitest run tests/utils/propertyNoteLookup.test.ts`
Expected: PASS, all tests.

Run: `npx tsc -noEmit -skipLibCheck`
Expected: no errors.

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/utils/propertyNoteLookup.ts tests/utils/propertyNoteLookup.test.ts
git commit -m "feat: resolve where a property note reveal lands across lenses"
```

---

### Task 3: The `autoRevealPropertyNote` setting

Settings plumbing plus all 21 locales. No unit test — settings definitions are declarative and are verified by the type checker plus the running app. This is one task because a reviewer accepts or rejects the setting as a single unit; a half-registered setting compiles but is unreachable.

**Files:**
- Modify: `src/settings/types.ts`
- Modify: `src/settings/defaultSettings.ts`
- Modify: `src/settings/nativeSettingControls.ts`
- Modify: `src/settings/tabs/PropertiesTab.ts`
- Modify: `src/settings/tabs/legacy/PropertiesLegacyTab.ts`
- Modify: all 21 files in `src/i18n/locales/`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `settings.autoRevealPropertyNote: boolean` on `NotebookNavigatorSettings`, and `strings.settings.items.autoRevealPropertyNote.{name,desc}`. Task 4 reads the setting.

- [ ] **Step 1: Add the interface member**

In `src/settings/types.ts`, the property note settings are declared together around line 742. Add the new key immediately after `autoOpenPropertyNote`:

```ts
    autoOpenPropertyNote: boolean;
    autoRevealPropertyNote: boolean;
```

- [ ] **Step 2: Add the default**

In `src/settings/defaultSettings.ts`, after the `autoOpenPropertyNote: false,` line (around line 303):

```ts
    autoOpenPropertyNote: false,
    autoRevealPropertyNote: false,
```

- [ ] **Step 3: Register it as a native boolean control**

In `src/settings/nativeSettingControls.ts`, in the `BOOLEAN_SETTING_KEYS` array, after `'autoOpenPropertyNote',`:

```ts
    'autoOpenPropertyNote',
    'autoRevealPropertyNote',
```

Do **not** add it to `NATIVE_SETTING_DOM_STATE_REFRESH_KEYS`. That set exists for settings that change other controls' visibility; this one changes none.

- [ ] **Step 4: Add the English strings**

In `src/i18n/locales/en.ts`, immediately after the `autoOpenPropertyNote` entry (around line 2394):

```ts
            autoRevealPropertyNote: {
                name: 'Reveal property note in tree',
                desc: 'When you open a property note from outside the navigator, select the property value it defines in the navigation tree. Requires auto-reveal to be enabled.'
            },
```

The description intentionally says "auto-reveal" rather than quoting the "Auto-reveal active note" setting name, so 21 translations do not have to track that other setting's wording.

- [ ] **Step 5: Add the toggle to the current settings tab**

In `src/settings/tabs/PropertiesTab.ts`, inside the `createGroupDefinition(strings.settings.sections.propertyNotes, [...])` array, immediately after the `autoOpenPropertyNote` toggle definition:

```ts
            createToggleDefinition('autoRevealPropertyNote', {
                name: strings.settings.items.autoRevealPropertyNote.name,
                desc: strings.settings.items.autoRevealPropertyNote.desc,
                visible: () => plugin.settings.enablePropertyNotes
            }),
```

- [ ] **Step 6: Add the toggle to the legacy settings tab**

In `src/settings/tabs/legacy/PropertiesLegacyTab.ts`, immediately after the `autoOpenPropertyNote` block (which ends around line 159):

```ts
    new Setting(propertyNotesDependentSettingsEl)
        .setName(strings.settings.items.autoRevealPropertyNote.name)
        .setDesc(strings.settings.items.autoRevealPropertyNote.desc)
        .addToggle(toggle =>
            toggle.setValue(plugin.settings.autoRevealPropertyNote).onChange(async value => {
                plugin.settings.autoRevealPropertyNote = value;
                await plugin.saveSettingsAndUpdate();
            })
        );
```

- [ ] **Step 7: Verify the type checker now demands the other 20 locales**

Run: `npx tsc -noEmit -skipLibCheck`

Expected: FAIL, with 20 errors — one per non-English locale file — reported at each `return (require('./locales/xx.ts') ...).STRINGS_XX;` line in `src/i18n/index.ts`, saying the returned object is missing the `autoRevealPropertyNote` property. This confirms the locale requirement before doing the work.

- [ ] **Step 8: Add the translations to all 20 remaining locales**

In each file, insert the entry immediately after that file's `autoOpenPropertyNote` entry, matching the surrounding indentation (12 spaces for the key). Use exactly these strings.

`ar.ts`:
```ts
            autoRevealPropertyNote: {
                name: 'إظهار ملاحظة الخاصية في الشجرة',
                desc: 'عند فتح ملاحظة خاصية من خارج المتصفح، يتم تحديد قيمة الخاصية التي تحددها في شجرة التنقل. يتطلب تمكين الإظهار التلقائي.'
            },
```

`de.ts`:
```ts
            autoRevealPropertyNote: {
                name: 'Eigenschaftsnotiz im Baum anzeigen',
                desc: 'Wenn Sie eine Eigenschaftsnotiz außerhalb des Navigators öffnen, wird der von ihr definierte Eigenschaftswert im Navigationsbaum ausgewählt. Erfordert aktiviertes automatisches Anzeigen.'
            },
```

`es.ts`:
```ts
            autoRevealPropertyNote: {
                name: 'Mostrar la nota de propiedad en el árbol',
                desc: 'Al abrir una nota de propiedad desde fuera del navegador, selecciona en el árbol de navegación el valor de propiedad que define. Requiere que la revelación automática esté activada.'
            },
```

`fa.ts`:
```ts
            autoRevealPropertyNote: {
                name: 'نمایش یادداشت ویژگی در درخت',
                desc: 'وقتی یک یادداشت ویژگی را از بیرون ناوبر باز می‌کنید، مقدار ویژگی‌ای که تعریف می‌کند در درخت ناوبری انتخاب می‌شود. نیازمند فعال بودن نمایش خودکار است.'
            },
```

`fr.ts` (double-quoted because the text contains apostrophes):
```ts
            autoRevealPropertyNote: {
                name: "Révéler la note de propriété dans l'arborescence",
                desc: "Lorsque vous ouvrez une note de propriété depuis l'extérieur du navigateur, sélectionne dans l'arborescence la valeur de propriété qu'elle définit. Nécessite l'activation de la révélation automatique."
            },
```

`id.ts`:
```ts
            autoRevealPropertyNote: {
                name: 'Tampilkan catatan properti di pohon',
                desc: 'Saat Anda membuka catatan properti dari luar navigator, pilih nilai properti yang didefinisikannya di pohon navigasi. Memerlukan tampilkan otomatis diaktifkan.'
            },
```

`it.ts` (double-quoted because the text contains apostrophes):
```ts
            autoRevealPropertyNote: {
                name: "Mostra la nota di proprietà nell'albero",
                desc: "Quando apri una nota di proprietà dall'esterno del navigatore, seleziona nell'albero di navigazione il valore di proprietà che definisce. Richiede che la rivelazione automatica sia attiva."
            },
```

`ja.ts`:
```ts
            autoRevealPropertyNote: {
                name: 'プロパティノートをツリーで表示',
                desc: 'ナビゲーターの外部からプロパティノートを開いたとき、そのノートが定義するプロパティ値をナビゲーションツリーで選択します。自動表示を有効にする必要があります。'
            },
```

`ko.ts`:
```ts
            autoRevealPropertyNote: {
                name: '트리에서 속성 노트 표시',
                desc: '내비게이터 외부에서 속성 노트를 열면 해당 노트가 정의하는 속성 값을 내비게이션 트리에서 선택합니다. 자동 표시가 활성화되어 있어야 합니다.'
            },
```

`nl.ts`:
```ts
            autoRevealPropertyNote: {
                name: 'Eigenschapsnotitie in boomstructuur tonen',
                desc: 'Wanneer u een eigenschapsnotitie buiten de navigator opent, wordt de eigenschapswaarde die deze definieert in de boomstructuur geselecteerd. Vereist dat automatisch tonen is ingeschakeld.'
            },
```

`pl.ts`:
```ts
            autoRevealPropertyNote: {
                name: 'Pokaż notatkę właściwości w drzewie',
                desc: 'Po otwarciu notatki właściwości spoza nawigatora zaznacza w drzewie nawigacji wartość właściwości, którą ta notatka definiuje. Wymaga włączonego automatycznego pokazywania.'
            },
```

`pt.ts`:
```ts
            autoRevealPropertyNote: {
                name: 'Mostrar a nota de propriedade na árvore',
                desc: 'Ao abrir uma nota de propriedade fora do navegador, seleciona na árvore de navegação o valor de propriedade que ela define. Requer que a revelação automática esteja ativada.'
            },
```

`pt_br.ts`:
```ts
            autoRevealPropertyNote: {
                name: 'Mostrar a nota de propriedade na árvore',
                desc: 'Ao abrir uma nota de propriedade fora do navegador, seleciona na árvore de navegação o valor de propriedade que ela define. Requer que a revelação automática esteja ativada.'
            },
```

`ru.ts`:
```ts
            autoRevealPropertyNote: {
                name: 'Показывать заметку свойства в дереве',
                desc: 'При открытии заметки свойства вне навигатора выбирает в дереве навигации значение свойства, которое она определяет. Требуется включённое автоматическое отображение.'
            },
```

`th.ts`:
```ts
            autoRevealPropertyNote: {
                name: 'แสดงโน้ตคุณสมบัติในแผนผัง',
                desc: 'เมื่อคุณเปิดโน้ตคุณสมบัติจากภายนอกตัวนำทาง จะเลือกค่าคุณสมบัติที่โน้ตนั้นกำหนดไว้ในแผนผังการนำทาง ต้องเปิดใช้งานการแสดงอัตโนมัติ'
            },
```

`tr.ts`:
```ts
            autoRevealPropertyNote: {
                name: 'Özellik notunu ağaçta göster',
                desc: 'Bir özellik notunu gezginin dışından açtığınızda, notun tanımladığı özellik değerini gezinme ağacında seçer. Otomatik gösterimin etkin olmasını gerektirir.'
            },
```

`uk.ts`:
```ts
            autoRevealPropertyNote: {
                name: 'Показувати нотатку властивості в дереві',
                desc: 'Коли ви відкриваєте нотатку властивості поза навігатором, у дереві навігації вибирається значення властивості, яке вона визначає. Потрібно ввімкнути автоматичне показування.'
            },
```

`vi.ts`:
```ts
            autoRevealPropertyNote: {
                name: 'Hiện ghi chú thuộc tính trong cây',
                desc: 'Khi bạn mở một ghi chú thuộc tính từ bên ngoài bộ điều hướng, chọn giá trị thuộc tính mà ghi chú đó định nghĩa trong cây điều hướng. Yêu cầu bật tự động hiện.'
            },
```

`zh_cn.ts`:
```ts
            autoRevealPropertyNote: {
                name: '在树中显示属性笔记',
                desc: '从导航器外部打开属性笔记时，在导航树中选中该笔记所定义的属性值。需要启用自动显示。'
            },
```

`zh_tw.ts`:
```ts
            autoRevealPropertyNote: {
                name: '在樹狀結構中顯示屬性筆記',
                desc: '從導覽器外部開啟屬性筆記時，在導覽樹中選取該筆記所定義的屬性值。需要啟用自動顯示。'
            },
```

- [ ] **Step 9: Verify types, formatting and lint pass**

Run: `npx tsc -noEmit -skipLibCheck`
Expected: no errors. If any locale still reports a missing property, that file's entry was placed outside the `settings.items` object — check the nesting.

Run: `npm run format:check`
Expected: no errors. If it fails, run `npm run format` and re-check.

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add src/settings src/i18n/locales
git commit -m "feat: add the reveal property note in tree setting"
```

---

### Task 4: Apply the jump in `revealFileInNearestFolder`

The behavior change. One computed value, one guarded block, and one condition change. Everything downstream — the folder-resolution skip, the single `REVEAL_FILE` dispatch, and the scroll request — already handles a set `targetProperty` and needs no edit.

**Files:**
- Modify: `src/hooks/useNavigatorReveal.ts`

**Interfaces:**
- Consumes: `resolvePropertyNoteLensJump` and `PropertyNoteLensJump` from Task 2; `settings.autoRevealPropertyNote` from Task 3.
- Produces: no new exports.

- [ ] **Step 1: Add the import**

In `src/hooks/useNavigatorReveal.ts`, the file already imports from `'../utils/propertyNoteLookup'`. Add the new function to that existing import:

```ts
import { findPropertyNoteValueNode, resolvePropertyNoteLensJump, resolvePropertyRevealTarget } from '../utils/propertyNoteLookup';
```

- [ ] **Step 2: Compute the jump before the tag branch**

Inside `revealFileInNearestFolder`, find this run of lines (they end just before `if (selectionState.selectionType === 'tag') {`):

```ts
            const shouldCenterNavigation = Boolean(options?.isStartupReveal && settings.startView === 'navigation');
            const navigationAlign: Align = shouldCenterNavigation ? 'center' : 'auto';
```

Immediately after them, insert:

```ts
            // A property note is not a member of the value it defines, so containment-based reveal
            // can never find it and every other branch here is containment-based. Resolved before
            // the tag branch because this deliberately overrides the current lens, and the reducer
            // honors targetTag ahead of targetProperty.
            const propertyNoteJump = resolvePropertyNoteLensJump({
                enabled: settings.showProperties && settings.enablePropertyNotes && settings.autoRevealPropertyNote,
                revealSource,
                selectionType: selectionState.selectionType,
                filePath: file.path,
                propertyTree: getPropertyTree(),
                app
            });

            if (propertyNoteJump) {
                targetProperty = propertyNoteJump.targetProperty;

                // Always expand through to the value node. The shortest-path downgrade below exists
                // to avoid disturbing the view the user is already in, which is moot when the point
                // is to move them to a different tree.
                if (settings.showAllPropertiesFolder && !expansionState.expandedVirtualFolders.has(PROPERTIES_ROOT_VIRTUAL_FOLDER_ID)) {
                    const nextExpandedVirtualFolders = new Set(expansionState.expandedVirtualFolders);
                    nextExpandedVirtualFolders.add(PROPERTIES_ROOT_VIRTUAL_FOLDER_ID);
                    expansionDispatch({ type: 'SET_EXPANDED_VIRTUAL_FOLDERS', folders: nextExpandedVirtualFolders });
                }

                if (propertyNoteJump.keyNodeId && !expansionState.expandedProperties.has(propertyNoteJump.keyNodeId)) {
                    expandPropertyNodeIds([propertyNoteJump.keyNodeId]);
                }
            }
```

- [ ] **Step 3: Skip the tag branch when the jump applies**

Still inside `revealFileInNearestFolder`, change the tag branch's condition from:

```ts
            if (selectionState.selectionType === 'tag') {
```

to:

```ts
            if (!propertyNoteJump && selectionState.selectionType === 'tag') {
```

This is required, not cosmetic. `REVEAL_FILE` checks `targetTag` before `targetProperty` (`src/context/selection/state.ts:393`), so a tag target resolved for the same file would win and the jump would silently do nothing.

The existing property branch (`if (selectionState.selectionType === 'property')`) needs **no** guard: `resolvePropertyNoteLensJump` returns null for a property selection, so the two can never both be active.

- [ ] **Step 4: Verify nothing downstream needs changing**

Read the rest of `revealFileInNearestFolder` and confirm these three things, which the plan relies on:

1. The folder-resolution block is guarded by `(targetProperty === null || targetProperty === undefined)`, so setting `targetProperty` skips it and leaves `resolvedFolder` null.
2. The single `selectionDispatch({ type: 'REVEAL_FILE', ... })` passes `targetProperty` through.
3. The scroll block has an `else if (!targetTag && targetProperty && navigationPaneRef.current)` arm that requests a `ItemType.PROPERTY` scroll with `navigationAlign`.

Make no edits in this step. If any of the three does not hold, stop and report it rather than working around it.

- [ ] **Step 5: Verify types, tests and lint pass**

Run: `npx tsc -noEmit -skipLibCheck`
Expected: no errors. `PROPERTIES_ROOT_VIRTUAL_FOLDER_ID`, `expansionState`, `expansionDispatch`, `expandPropertyNodeIds`, `getPropertyTree` and `app` are all already in scope and already in the callback's dependency array, and `settings` is depended on as a whole object, so no dependency-array edit is needed.

Run: `npm test`
Expected: PASS, whole suite.

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 6: Verify in the running app**

Use the obsidian-cli skill to reload the plugin, then in a vault with property notes enabled:

1. Turn on **Reveal property note in tree** and **Auto-reveal active note**.
2. Select a folder in the navigator so the folder lens is active.
3. Open a property note from a wikilink in the editor, or from the quick switcher.
4. Confirm the navigation pane switches to the properties tree, expands the Properties root and the key node, and selects the value node whose link points at that note.
5. Press the navigator's back navigation once. Confirm it returns to the folder selection — one press, not two.
6. Click that same property note in the shortcuts or recent notes list. Confirm the lens does **not** change.
7. Turn the setting off, repeat step 3, and confirm the reveal lands on the note's parent folder as before.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useNavigatorReveal.ts
git commit -m "feat: reveal a property note in the property tree across lenses"
```

---

### Task 5: Document the setting in the README

The repo's convention for this feature area is a commit per behavior that both translates and documents ("feat: translate property note creation settings and document the feature"). Translation landed in Task 3; this is the documentation half.

**Files:**
- Modify: `README.md` (the property notes paragraph at line 459)

**Interfaces:**
- Consumes: the setting name from Task 3.
- Produces: nothing consumed by other tasks.

- [ ] **Step 1: Extend the property notes paragraph**

In `README.md`, find the paragraph beginning `**Note:** Property notes are found by resolving the property value as a wikilink`. Append this sentence immediately before the final sentence about macOS Enter behavior:

```markdown
Opening a property note from outside the navigator can optionally reveal it in the navigation tree: with **Reveal property note in tree** enabled, the tree switches to the property value that note defines, rather than to the folder the note happens to live in — the property-note equivalent of how revealing a folder note lands on its folder. This requires auto-reveal to be enabled, and it applies to notes opened from links, search or the quick switcher, not to clicks inside the navigator itself.
```

- [ ] **Step 2: Verify formatting passes**

Run: `npm run format:check`
Expected: no errors. If it fails, run `npm run format` and re-check.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document the reveal property note in tree setting"
```

---

## Notes for the implementer

**Why there is no readiness or deferral handling.** `NotebookNavigatorContainer` renders a skeleton while `!isStorageReady` and only mounts `NotebookNavigatorComponent` once storage is ready (`src/components/NotebookNavigatorContainer.tsx:74` vs `:107`), and `useNavigatorReveal` is called only from that component. The hook therefore cannot mount, or arm its startup reveal, before the property tree exists. If you find yourself wanting a pending-target ref or a retry effect, re-read the Startup section of the spec — an earlier draft specified exactly that and it was all dead code.

**Why the lookup is not cached.** Link resolution lives in `app.metadataCache`, which the property tree rebuild does not track, so a cached reverse index goes stale when a link target is created or renamed with no event to correct it. The per-reveal scan is the deliberate trade: slow beats wrong. Do not add a cache as an "optimization".

**Known accepted behavior.** Switching to a tab that already holds a property note jumps the lens, because `active-leaf-change` and `file-open` feed the same detector and cannot be reliably distinguished. Alternating between a property note tab and a regular note tab therefore alternates the lens. This is documented in the spec as accepted, not a bug to fix here.
