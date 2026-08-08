# Per-value property grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a list-pane grouping mode that puts a note under every value of a list-valued property, plus an opt-in setting for group headers to inherit that value's icon and colour.

**Architecture:** Three new grouping-option prefixes carry a `perValue` flag alongside the existing direction. The fan-out happens in the one place the flat virtual item array is built (`buildListItems`), so a file is pushed into one bucket per value instead of one bucket for the joined value list. Duplicate rows force three mechanical fixes: group-scoped item keys and first-occurrence index maps. Header appearance reuses the pattern folder-group headers already use, swapping folder display data for property value icon/colour.

**Tech Stack:** TypeScript, React, Obsidian plugin API, Vitest.

**Spec:** [`2026-08-06-property-value-grouping-design.md`](2026-08-06-property-value-grouping-design.md)

## Global Constraints

- The three existing grouping forms (`property:`, `property-desc:`, `property-follow:`) keep their exact current behavior. This mode is additive.
- Per-value grouping is a **second axis**, orthogonal to direction. Six prefixes total; direction stays selectable in the new mode.
- When parsing, the `-each` prefixes must be tested **before** the others — every prefix starts with `property`.
- A note appears **once per distinct value** it carries. Duplicate values within one note collapse to one appearance.
- Group labels use `resolvePropertyDisplayText`, so `[[Topics]]` reads `Topics`. This applies in the new mode regardless of the appearance setting.
- Selection stays path-based. Every copy of a note highlights together. Do **not** add instance identity to `selectedFile`.
- `orderedFiles` containing duplicates is intended, not a bug to fix.
- Appearance inherits from the **property value node** (`getPropertyIcon` / `getPropertyColorData`), never from the linked note.
- The appearance setting defaults to **off**.
- All 21 locale files in `src/i18n/locales/` must gain every new string. `getResolvedStrings` returns a locale object wholesale with no merge, so a missing key fails `tsc`.
- Verification commands (`node_modules/.bin` is absent in this checkout):
  - tests: `node node_modules/vitest/vitest.mjs run [path]`
  - types: `npx tsc -noEmit -skipLibCheck`
  - format: `node node_modules/prettier/bin/prettier.cjs --check .`
  - lint: `node node_modules/eslint/bin/eslint.js <changed files>` — repo-wide lint is red upstream (286 errors, 261 in `src/main.ts`); never use a whole-repo run as a gate.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/settings/types.ts` | Grouping option encoding | Modify: 3 prefixes, `perValue` through parse/create/normalize |
| `src/hooks/listPaneData/listItems.ts` | Builds the flat virtual item array | Modify: fan-out, labels, item keys, index maps, header node id |
| `src/components/listPane/ListPaneVirtualContent.tsx` | Renders header models | Modify: resolve and pass value icon/colour |
| `src/settings/tabs/ListTab.ts` | Grouping dropdown | Modify: per-value entries |
| `src/hooks/useListActions.ts` | List-pane grouping menu | Modify: per-value entries |
| `src/settings/{types,defaultSettings,nativeSettingControls}.ts` | Appearance setting | Modify: new boolean |
| `src/i18n/locales/*.ts` (21) | Strings | Modify: picker label + setting name/desc |
| `src/styles/sections/*` | Header colour | Modify: CSS custom property |
| `tests/utils/propertyGroupingOption.test.ts` | Option encoding | Create |
| `tests/hooks/listPaneData/listItems.test.ts` | Fan-out, keys, index maps | Modify |

---

### Task 1: Per-value grouping option encoding

**Files:**
- Modify: `src/settings/types.ts:447-556`
- Test: `tests/utils/propertyGroupingOption.test.ts` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `parsePropertyGroupingOption` (private) now returns `{ propertyKey: string; order: PropertyGroupingOrder; perValue: boolean } | null`
  - `export function getPropertyGroupingPerValue(value: unknown): boolean` — false for base modes and the three original forms
  - `export function createPropertyGroupingOption(propertyKey: string, order: PropertyGroupingOrder, perValue?: boolean): ListNoteGroupingOption` — `perValue` defaults to `false`, so all existing call sites keep compiling and behaving identically
  - `ListNoteGroupingOption` gains `` `property-each:${string}` ``, `` `property-each-desc:${string}` ``, `` `property-each-follow:${string}` ``

- [ ] **Step 1: Write the failing test**

Create `tests/utils/propertyGroupingOption.test.ts`. Copy the GPL header block from the top of `tests/utils/listGrouping.test.ts` verbatim, then:

```ts
import { describe, expect, it } from 'vitest';
import {
    createPropertyGroupingOption,
    getPropertyGroupingKey,
    getPropertyGroupingOrder,
    getPropertyGroupingPerValue,
    normalizeListNoteGroupingOption
} from '../../src/settings/types';

describe('per-value property grouping options', () => {
    it('builds the three per-value prefixes', () => {
        expect(createPropertyGroupingOption('topics', 'asc', true)).toBe('property-each:topics');
        expect(createPropertyGroupingOption('topics', 'desc', true)).toBe('property-each-desc:topics');
        expect(createPropertyGroupingOption('topics', 'follow', true)).toBe('property-each-follow:topics');
    });

    it('keeps the original three prefixes when perValue is absent or false', () => {
        expect(createPropertyGroupingOption('topics', 'asc')).toBe('property:topics');
        expect(createPropertyGroupingOption('topics', 'desc', false)).toBe('property-desc:topics');
        expect(createPropertyGroupingOption('topics', 'follow', false)).toBe('property-follow:topics');
    });

    it('parses key, order and perValue back out of every form', () => {
        const cases: [string, string, string, boolean][] = [
            ['property:topics', 'topics', 'asc', false],
            ['property-desc:topics', 'topics', 'desc', false],
            ['property-follow:topics', 'topics', 'follow', false],
            ['property-each:topics', 'topics', 'asc', true],
            ['property-each-desc:topics', 'topics', 'desc', true],
            ['property-each-follow:topics', 'topics', 'follow', true]
        ];
        for (const [option, key, order, perValue] of cases) {
            expect(getPropertyGroupingKey(option)).toBe(key);
            expect(getPropertyGroupingOrder(option)).toBe(order);
            expect(getPropertyGroupingPerValue(option)).toBe(perValue);
        }
    });

    it('does not mistake property-each for the plain or desc form', () => {
        // Every prefix starts with "property", so a naive startsWith order would classify
        // property-each-desc: as the plain ascending form with key "each-desc:topics".
        expect(getPropertyGroupingKey('property-each-desc:topics')).toBe('topics');
        expect(getPropertyGroupingPerValue('property-each-desc:topics')).toBe(true);
        expect(getPropertyGroupingOrder('property-each-desc:topics')).toBe('desc');
    });

    it('keeps keys that contain a colon intact', () => {
        expect(getPropertyGroupingKey('property-each:my:key')).toBe('my:key');
        expect(getPropertyGroupingPerValue('property-each:my:key')).toBe(true);
    });

    it('round-trips per-value options through normalization, trimming the key', () => {
        expect(normalizeListNoteGroupingOption('property-each-follow:  topics  ')).toBe('property-each-follow:topics');
    });

    it('rejects a per-value prefix with no key', () => {
        expect(normalizeListNoteGroupingOption('property-each:')).toBeNull();
        expect(getPropertyGroupingPerValue('property-each:')).toBe(false);
    });

    it('reports perValue false for base grouping modes', () => {
        expect(getPropertyGroupingPerValue('custom')).toBe(false);
        expect(getPropertyGroupingPerValue('folder')).toBe(false);
        expect(getPropertyGroupingPerValue(undefined)).toBe(false);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run tests/utils/propertyGroupingOption.test.ts`

Expected: FAIL. The import of `getPropertyGroupingPerValue` does not resolve, so the whole file errors before any assertion runs.

- [ ] **Step 3: Add the prefixes and the type union**

In `src/settings/types.ts`, extend the type union and add three prefix constants beside the existing three:

```ts
export type ListNoteGroupingOption =
    | ListNoteGroupingBaseOption
    | `property:${string}`
    | `property-desc:${string}`
    | `property-follow:${string}`
    | `property-each:${string}`
    | `property-each-desc:${string}`
    | `property-each-follow:${string}`;

const PROPERTY_GROUPING_PREFIX = 'property:';
const PROPERTY_GROUPING_DESC_PREFIX = 'property-desc:';
const PROPERTY_GROUPING_FOLLOW_PREFIX = 'property-follow:';
const PROPERTY_GROUPING_EACH_PREFIX = 'property-each:';
const PROPERTY_GROUPING_EACH_DESC_PREFIX = 'property-each-desc:';
const PROPERTY_GROUPING_EACH_FOLLOW_PREFIX = 'property-each-follow:';
```

Also update the doc comment above the type so it records the second axis:

```ts
/**
 * Grouping options for list pane notes.
 * Property grouping is stored as `property:<frontmatter key>` (ascending group order),
 * `property-desc:<frontmatter key>` (descending group order), or `property-follow:<frontmatter key>`
 * (group order follows the sort direction) so appearance records keep a single scalar `groupBy`
 * value across settings sync. The order lives in the prefix because keys may themselves contain
 * separator characters such as `:`.
 *
 * The `property-each` variants of all three carry a second, orthogonal axis: one group per value of
 * a list-valued property, so a note appears under each value it holds rather than under a single
 * group for the whole value list.
 */
```

- [ ] **Step 4: Replace the parse and create functions**

Replace `parsePropertyGroupingOption` and `createPropertyGroupingOption` with these. The prefix table is ordered longest-first so `property-each-desc:` cannot be read as `property-desc:` or as the plain form:

```ts
// Ordered longest-prefix-first. Every prefix starts with `property`, so a shorter prefix tested
// first would swallow a longer one and put the remainder into the key.
const PROPERTY_GROUPING_PREFIXES: readonly { prefix: string; order: PropertyGroupingOrder; perValue: boolean }[] = [
    { prefix: PROPERTY_GROUPING_EACH_FOLLOW_PREFIX, order: 'follow', perValue: true },
    { prefix: PROPERTY_GROUPING_EACH_DESC_PREFIX, order: 'desc', perValue: true },
    { prefix: PROPERTY_GROUPING_EACH_PREFIX, order: 'asc', perValue: true },
    { prefix: PROPERTY_GROUPING_FOLLOW_PREFIX, order: 'follow', perValue: false },
    { prefix: PROPERTY_GROUPING_DESC_PREFIX, order: 'desc', perValue: false },
    { prefix: PROPERTY_GROUPING_PREFIX, order: 'asc', perValue: false }
];

function parsePropertyGroupingOption(value: unknown): { propertyKey: string; order: PropertyGroupingOrder; perValue: boolean } | null {
    if (typeof value !== 'string') {
        return null;
    }

    const match = PROPERTY_GROUPING_PREFIXES.find(candidate => value.startsWith(candidate.prefix));
    if (!match) {
        return null;
    }

    const propertyKey = value.slice(match.prefix.length).trim();
    return propertyKey.length > 0 ? { propertyKey, order: match.order, perValue: match.perValue } : null;
}

export function createPropertyGroupingOption(
    propertyKey: string,
    order: PropertyGroupingOrder,
    perValue: boolean = false
): ListNoteGroupingOption {
    const match = PROPERTY_GROUPING_PREFIXES.find(candidate => candidate.order === order && candidate.perValue === perValue);
    // The table covers every order/perValue pair, so this cannot be reached.
    const prefix = match?.prefix ?? PROPERTY_GROUPING_PREFIX;
    return `${prefix}${propertyKey.trim()}` as ListNoteGroupingOption;
}
```

- [ ] **Step 5: Add the accessor and carry perValue through normalization**

Add beside `getPropertyGroupingOrder`:

```ts
/** Whether a property grouping option splits list values into one group each. */
export function getPropertyGroupingPerValue(value: unknown): boolean {
    return parsePropertyGroupingOption(value)?.perValue ?? false;
}
```

And in `normalizeListNoteGroupingOption`, pass the flag through so a stored per-value option survives re-encoding:

```ts
    const parsed = parsePropertyGroupingOption(value);
    return parsed ? createPropertyGroupingOption(parsed.propertyKey, parsed.order, parsed.perValue) : null;
```

- [ ] **Step 6: Verify**

Run: `node node_modules/vitest/vitest.mjs run tests/utils/propertyGroupingOption.test.ts`
Expected: PASS, 8 tests.

Run: `node node_modules/vitest/vitest.mjs run`
Expected: PASS. The whole suite matters here because `createPropertyGroupingOption` has existing callers whose two-argument calls must be unaffected.

Run: `npx tsc -noEmit -skipLibCheck` → no errors.
Run: `node node_modules/eslint/bin/eslint.js src/settings/types.ts tests/utils/propertyGroupingOption.test.ts` → clean.
Run: `node node_modules/prettier/bin/prettier.cjs --check .` → clean. If it fails, run with `--write` and re-check.

- [ ] **Step 7: Commit**

```bash
git add src/settings/types.ts tests/utils/propertyGroupingOption.test.ts
git commit -m "feat: encode per-value property grouping as a second option axis"
```

---

### Task 2: Fan out one group per value

**Files:**
- Modify: `src/hooks/listPaneData/listItems.ts:525-613`
- Test: `tests/hooks/listPaneData/listItems.test.ts`

**Interfaces:**
- Consumes: `getPropertyGroupingPerValue` from Task 1.
- Produces: no new exports. `buildListItems` gains behavior when `listConfig.groupBy` is a `property-each*` option.

- [ ] **Step 1: Write the failing test**

Append to `tests/hooks/listPaneData/listItems.test.ts`. The file already provides `createApp`, `createDb`, `createListConfig`, and imports `buildListItems`, `ListPaneItemType` and `createTestTFile`.

```ts
describe('per-value property grouping', () => {
    // buildListItems reads grouping values straight from the metadata cache, so the stub returns
    // frontmatter per path rather than going through the database records.
    function createFrontmatterApp(frontmatterByPath: Record<string, Record<string, unknown>>): App {
        const app = new App();
        app.metadataCache.getFileCache = (file: TFile) => {
            const frontmatter = frontmatterByPath[file.path];
            return frontmatter ? ({ frontmatter } as ReturnType<App['metadataCache']['getFileCache']>) : null;
        };
        return app;
    }

    function headerLabels(items: ListPaneItem[]): string[] {
        return items.filter(item => item.type === ListPaneItemType.HEADER).map(item => String(item.data));
    }

    function filePathsUnderHeaders(items: ListPaneItem[]): Record<string, string[]> {
        const byHeader: Record<string, string[]> = {};
        let current: string | null = null;
        for (const item of items) {
            if (item.type === ListPaneItemType.HEADER) {
                current = String(item.data);
                byHeader[current] = [];
            } else if (item.type === ListPaneItemType.FILE && item.data instanceof TFile && current !== null) {
                byHeader[current].push(item.data.path);
            }
        }
        return byHeader;
    }

    const multi = createTestTFile('Dune.md');
    const single = createTestTFile('PKM.md');

    function build(groupBy: string, frontmatter: Record<string, Record<string, unknown>>, files: TFile[]) {
        return buildListItems({
            files,
            app: createFrontmatterApp(frontmatter),
            db: createDb({}),
            listConfig: { ...createListConfig({}), groupBy: groupBy as ListPaneConfig['groupBy'] },
            selectionType: ItemType.FOLDER,
            sortOption: 'title-asc',
            settings: DEFAULT_SETTINGS,
            fileVisibility: FILE_VISIBILITY.MARKDOWN
        }).listItems;
    }

    it('puts a note under every value it carries', () => {
        const items = build(
            'property-each:topics',
            { 'Dune.md': { topics: ['[[Topics]]', '[[Projects]]'] } },
            [multi]
        );

        expect(headerLabels(items)).toEqual(['Projects', 'Topics']);
        expect(filePathsUnderHeaders(items)).toEqual({ Projects: ['Dune.md'], Topics: ['Dune.md'] });
    });

    it('keeps the joined bucket for the original option', () => {
        const items = build('property:topics', { 'Dune.md': { topics: ['[[Topics]]', '[[Projects]]'] } }, [multi]);

        expect(headerLabels(items)).toEqual(['[[Topics]], [[Projects]]']);
    });

    it('labels wikilink values with their display text and plain values verbatim', () => {
        const items = build('property-each:status', { 'PKM.md': { status: 'draft' } }, [single]);

        expect(headerLabels(items)).toEqual(['draft']);
    });

    it('shows a note once when it repeats a value', () => {
        const items = build('property-each:topics', { 'Dune.md': { topics: ['[[Topics]]', '[[Topics]]'] } }, [multi]);

        expect(headerLabels(items)).toEqual(['Topics']);
        expect(filePathsUnderHeaders(items).Topics).toEqual(['Dune.md']);
    });

    it('still collects notes without the property into one trailing group', () => {
        const items = build('property-each:topics', { 'Dune.md': { topics: ['[[Topics]]'] } }, [multi, single]);
        const labels = headerLabels(items);

        expect(labels[0]).toBe('Topics');
        expect(labels).toHaveLength(2);
        expect(filePathsUnderHeaders(items)[labels[1]]).toEqual(['PKM.md']);
    });

    it('orders per-value groups descending for the -desc form', () => {
        const items = build('property-each-desc:topics', { 'Dune.md': { topics: ['[[Topics]]', '[[Projects]]'] } }, [multi]);

        expect(headerLabels(items)).toEqual(['Topics', 'Projects']);
    });
});
```

Add `type ListPaneItem` and `App`/`TFile` to the file's existing imports if they are not already there — `App` and `TFile` come from `obsidian`, `ListPaneItem` from `../../../src/types/virtualization`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run tests/hooks/listPaneData/listItems.test.ts`

Expected: FAIL. `'property-each:topics'` parses to key `topics` with `perValue: true`, but the grouping branch still joins the parts, so `headerLabels` returns `['[[Topics]], [[Projects]]']` where the first test expects `['Projects', 'Topics']`. The `keeps the joined bucket` test passes already — it pins existing behavior.

- [ ] **Step 3: Fan out per value**

In `src/hooks/listPaneData/listItems.ts`, add to the imports from `../../settings/types`:

```ts
import { getPropertyGroupingKey, getPropertyGroupingPerValue } from '../../settings/types';
```

and from `../../utils/propertyUtils`:

```ts
import { resolvePropertyDisplayText } from '../../utils/propertyUtils';
```

The joined form currently inlines a NUL separator as a bare string literal. Lift it to a named constant
at module scope so the code below can reference it without retyping a control character, and so the
separator's purpose is documented once:

```ts
// Joins the parts of a multi-value property into one bucket key. A NUL cannot appear in a trimmed
// frontmatter value, so lists with different element boundaries such as ["a b", "c"] and ["a", "b c"]
// cannot collide on the same key.
const JOINED_BUCKET_SEPARATOR = String.fromCharCode(0);
```

`String.fromCharCode(0)` rather than an inline escape, because a raw NUL in a code block does not survive
copy-paste reliably. Before deleting the existing inline literal, confirm it is the same character — the
bucket keys for the three original forms must stay byte-identical.

Replace the existing inline `.join('…')` literal in the grouping branch with this constant as part of the
same edit — the resulting bucket keys must be byte-identical to today's for the three original forms.

Then in the `propertyGroupingKey !== null` branch, replace the `unpinnedFiles.forEach(...)` body with a version that buckets per part. Keep the surrounding comment describing bucket ordering, and add the per-value note:

```ts
        const propertyGroupingDirection = resolvePropertyGroupingDirection(groupingMode, sortOption);
        const propertyGroupingPerValue = getPropertyGroupingPerValue(groupingMode);
        const propertyGroups = new Map<string, { label: string; numericValue: number | null; files: TFile[] }>();
        const ungroupedFiles: TFile[] = [];

        unpinnedFiles.forEach(file => {
            const groupingValue =
                file.extension === 'md'
                    ? getPropertyGroupingValueFromRecord(app.metadataCache.getFileCache(file)?.frontmatter, propertyGroupingKey)
                    : null;
            if (groupingValue === null) {
                ungroupedFiles.push(file);
                return;
            }

            // Per-value grouping emits one bucket per part, so a note carrying several values
            // appears under each of them. The joined form keeps its single bucket, where the
            // separator cannot occur in trimmed parts so lists with different element boundaries
            // such as ["a b", "c"] and ["a", "b c"] stay apart.
            const bucketParts = propertyGroupingPerValue
                ? Array.from(new Set(groupingValue.parts))
                : [groupingValue.parts.join(JOINED_BUCKET_SEPARATOR)];

            bucketParts.forEach(bucketKey => {
                const group = propertyGroups.get(bucketKey);
                if (group) {
                    group.files.push(file);
                    return;
                }

                // The first file to create a bucket decides whether the group carries a numeric key,
                // matching how the first encountered value becomes the group key in Obsidian Bases.
                propertyGroups.set(bucketKey, {
                    label: propertyGroupingPerValue ? resolvePropertyDisplayText(bucketKey) : groupingValue.parts.join(', '),
                    numericValue: groupingValue.numericValue,
                    files: [file]
                });
            });
        });
```

`Array.from(new Set(...))` is what makes a note with a repeated value appear once, and it preserves first-seen order so the numeric-key rule is unchanged.

- [ ] **Step 4: Verify**

Run: `node node_modules/vitest/vitest.mjs run tests/hooks/listPaneData/listItems.test.ts`
Expected: PASS, including the pre-existing folder and date grouping tests in that file.

Run: `node node_modules/vitest/vitest.mjs run` → PASS.
Run: `npx tsc -noEmit -skipLibCheck` → no errors.
Run: `node node_modules/eslint/bin/eslint.js src/hooks/listPaneData/listItems.ts tests/hooks/listPaneData/listItems.test.ts` → clean.

Test output must be pristine. A React duplicate-key warning here is a finding, not noise — it means Task 3 is needed and this task has surfaced it early.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/listPaneData/listItems.ts tests/hooks/listPaneData/listItems.test.ts
git commit -m "feat: group list property values into one group each"
```

---

### Task 3: Make duplicate rows safe

**Files:**
- Modify: `src/hooks/listPaneData/listItems.ts:320-325, 812-845`
- Test: `tests/hooks/listPaneData/listItems.test.ts`

**Interfaces:**
- Consumes: the fan-out from Task 2.
- Produces: `buildFilePathToIndexMap` and `buildOrderedFiles` keep their signatures; both now resolve a duplicated path to its **first** index.

- [ ] **Step 1: Write the failing test**

Append to the `per-value property grouping` describe block in `tests/hooks/listPaneData/listItems.test.ts`. Add `buildFilePathToIndexMap` and `buildOrderedFiles` to the existing import from `listItems`:

```ts
    it('gives every row a unique key when a note repeats', () => {
        const items = build('property-each:topics', { 'Dune.md': { topics: ['[[Topics]]', '[[Projects]]'] } }, [multi]);
        const keys = items.map(item => item.key);

        expect(new Set(keys).size).toBe(keys.length);
    });

    it('resolves a repeated path to its first row', () => {
        const items = build('property-each:topics', { 'Dune.md': { topics: ['[[Topics]]', '[[Projects]]'] } }, [multi]);

        const fileRowIndexes = items
            .map((item, index) => ({ item, index }))
            .filter(entry => entry.item.type === ListPaneItemType.FILE)
            .map(entry => entry.index);
        expect(fileRowIndexes).toHaveLength(2);

        expect(buildFilePathToIndexMap(items).get('Dune.md')).toBe(fileRowIndexes[0]);

        const { orderedFiles, orderedFileIndexMap } = buildOrderedFiles(items);
        // orderedFiles keeps both appearances on purpose - that is what makes arrow keys walk each copy.
        expect(orderedFiles.map(file => file.path)).toEqual(['Dune.md', 'Dune.md']);
        expect(orderedFileIndexMap.get('Dune.md')).toBe(0);
    });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run tests/hooks/listPaneData/listItems.test.ts`

Expected: both new tests FAIL. The key test fails because two file rows share `key: 'Dune.md'`, so the Set is smaller than the array. The index test fails on `orderedFileIndexMap.get('Dune.md')`, which returns `1` — the last appearance — where `0` is expected.

- [ ] **Step 3: Scope the file item key to its group**

Find `pushFileItem` in `listItems.ts` and locate the item it pushes, currently keyed `key: file.path` (around line 323). Give the builder a group-scoped key prefix. Add a mutable variable next to the other grouping locals:

```ts
    // Scopes file row keys so a note rendered under several groups still has unique React keys.
    let activeGroupKeyPrefix: string | null = null;
```

Set it inside `pushHeaderItem`, right after the manual-sort bookkeeping at the top of that function:

```ts
        activeGroupKeyPrefix = collapseKey ?? key;
```

and use it when building the file item:

```ts
            key: activeGroupKeyPrefix ? `${activeGroupKeyPrefix}:${file.path}` : file.path,
```

The prefix stays `null` until the first header, so an ungrouped list keeps `key: file.path` exactly as today.

- [ ] **Step 4: Keep the first index for a repeated path**

Replace both map builders so an already-seen path is not overwritten:

```ts
export function buildFilePathToIndexMap(listItems: ListPaneItem[]): Map<string, number> {
    const filePathToIndex = new Map<string, number>();
    listItems.forEach((item, index) => {
        // A note grouped per value appears more than once. Reveal and scroll-to-file should land on
        // the first appearance, so an already-mapped path keeps its earlier index.
        if (item.type === ListPaneItemType.FILE && item.data instanceof TFile && !filePathToIndex.has(item.data.path)) {
            filePathToIndex.set(item.data.path, index);
        }
    });
    return filePathToIndex;
}

export function buildOrderedFiles(listItems: ListPaneItem[]): {
    orderedFiles: TFile[];
    orderedFileIndexMap: Map<string, number>;
} {
    const orderedFiles: TFile[] = [];
    const orderedFileIndexMap = new Map<string, number>();

    listItems.forEach(item => {
        if (item.type === ListPaneItemType.FILE && item.data instanceof TFile) {
            // orderedFiles keeps every appearance so keyboard navigation walks each copy, while the
            // index map points at the first one.
            if (!orderedFileIndexMap.has(item.data.path)) {
                orderedFileIndexMap.set(item.data.path, orderedFiles.length);
            }
            orderedFiles.push(item.data);
        }
    });

    return { orderedFiles, orderedFileIndexMap };
}
```

- [ ] **Step 5: Verify**

Run: `node node_modules/vitest/vitest.mjs run tests/hooks/listPaneData/listItems.test.ts` → PASS.
Run: `node node_modules/vitest/vitest.mjs run` → PASS, output pristine, no React key warnings.
Run: `npx tsc -noEmit -skipLibCheck` → no errors.
Run: `node node_modules/eslint/bin/eslint.js src/hooks/listPaneData/listItems.ts tests/hooks/listPaneData/listItems.test.ts` → clean.

Then settle the one open question the spec flagged — whether any **displayed total** would double-count a
duplicated note:

```sh
rg -n "orderedFiles\.length|orderedFiles\b" src --type ts | rg -v "listItems.ts"
```

Per-group counts come from `groupItemCountByKey` and are correct by construction. If this search turns up
a user-visible total derived from `orderedFiles`, report it rather than fixing it here — it needs its own
decision about whether a total counts notes or rows.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/listPaneData/listItems.ts tests/hooks/listPaneData/listItems.test.ts
git commit -m "fix: keep list rows unique and reveal the first copy when a note repeats"
```

---

### Task 4: Make the mode selectable

**Files:**
- Modify: `src/settings/tabs/ListTab.ts:470-520`
- Modify: `src/hooks/useListActions.ts:1840-1860`
- Modify: all 21 files in `src/i18n/locales/`

**Interfaces:**
- Consumes: `createPropertyGroupingOption(key, order, perValue)` and `getPropertyGroupingPerValue` from Task 1.
- Produces: `strings.settings.items.groupNotes.perValueSuffix`.

- [ ] **Step 1: Add the English string**

The picker lists one entry per property key. Per-value grouping doubles that list, so each per-value entry reuses the property label with a suffix rather than inventing a second naming scheme.

In `src/i18n/locales/en.ts`, inside `settings.items.groupNotes`, beside the existing `families` key:

```ts
                perValueSuffix: '{key} (each value)',
```

- [ ] **Step 2: Add the entry to the settings dropdown**

In `src/settings/tabs/ListTab.ts`, find `rebuildOptions` and the loop that adds one option per available property group key. After the existing per-key entry, add its per-value sibling in the same optgroup:

```ts
                    propertyGroupEl.createEl('option', {
                        value: createPropertyGroupingOption(propertyKey, 'follow', true),
                        text: strings.settings.items.groupNotes.perValueSuffix.replace('{key}', propertyKey)
                    });
```

Match the surrounding code's element-creation style; if the existing entry is added through a helper rather than `createEl`, call that helper with the same two arguments.

- [ ] **Step 3: Add the entry to the list-pane menu**

In `src/hooks/useListActions.ts`, the loop at ~1848 calls `addGroupOptionItem` once per key. Add a second call for the per-value option, preserving the current order:

```ts
            propertyGroupKeys.forEach(propertyKey => {
                addGroupOptionItem(
                    createPropertyGroupingOption(propertyKey, effectiveGroupOrder),
                    getSortFieldLabel('property', propertyKey),
                    getSortFieldMenuIcon('property', propertyKey),
                    isManualSortActive
                );
                addGroupOptionItem(
                    createPropertyGroupingOption(propertyKey, effectiveGroupOrder, true),
                    strings.settings.items.groupNotes.perValueSuffix.replace(
                        '{key}',
                        getSortFieldLabel('property', propertyKey)
                    ),
                    getSortFieldMenuIcon('property', propertyKey),
                    isManualSortActive
                );
            });
```

- [ ] **Step 4: Confirm the type checker demands the other 20 locales**

Run: `npx tsc -noEmit -skipLibCheck`

Expected: FAIL with 20 errors, one per non-English locale, reported at each `return (require('./locales/xx.ts') ...).STRINGS_XX;` line in `src/i18n/index.ts`. This proves the locale requirement before you do the work.

- [ ] **Step 5: Add the translation to all 20 remaining locales**

Insert beside each file's existing `groupNotes.families` key, keeping `{key}` intact and the 16-space indentation:

```
ar.ts     perValueSuffix: '{key} (كل قيمة)',
de.ts     perValueSuffix: '{key} (jeder Wert)',
es.ts     perValueSuffix: '{key} (cada valor)',
fa.ts     perValueSuffix: '{key} (هر مقدار)',
fr.ts     perValueSuffix: '{key} (chaque valeur)',
id.ts     perValueSuffix: '{key} (setiap nilai)',
it.ts     perValueSuffix: '{key} (ogni valore)',
ja.ts     perValueSuffix: '{key}（値ごと）',
ko.ts     perValueSuffix: '{key}(값별)',
nl.ts     perValueSuffix: '{key} (elke waarde)',
pl.ts     perValueSuffix: '{key} (każda wartość)',
pt.ts     perValueSuffix: '{key} (cada valor)',
pt_br.ts  perValueSuffix: '{key} (cada valor)',
ru.ts     perValueSuffix: '{key} (каждое значение)',
th.ts     perValueSuffix: '{key} (แต่ละค่า)',
tr.ts     perValueSuffix: '{key} (her değer)',
uk.ts     perValueSuffix: '{key} (кожне значення)',
vi.ts     perValueSuffix: '{key} (từng giá trị)',
zh_cn.ts  perValueSuffix: '{key}（每个值）',
zh_tw.ts  perValueSuffix: '{key}（每個值）',
```

- [ ] **Step 6: Verify**

Run: `npx tsc -noEmit -skipLibCheck` → no errors.
Run: `node node_modules/vitest/vitest.mjs run` → PASS.
Run: `node node_modules/prettier/bin/prettier.cjs --check .` → clean.
Run: `node node_modules/eslint/bin/eslint.js src/settings/tabs/ListTab.ts src/hooks/useListActions.ts "src/i18n/locales/*.ts"` → clean.

Then confirm each of the 21 locales has the key:

```sh
rg -l "perValueSuffix" src/i18n/locales/*.ts | wc -l   # expect 21
```

- [ ] **Step 7: Commit**

```bash
git add src/settings/tabs/ListTab.ts src/hooks/useListActions.ts src/i18n/locales
git commit -m "feat: offer per-value grouping in the settings dropdown and list menu"
```

---

### Task 5: Carry the value node id on the header

**Files:**
- Modify: `src/settings/types.ts` (setting), `src/settings/defaultSettings.ts`, `src/settings/nativeSettingControls.ts`, `src/settings/tabs/ListTab.ts`, `src/settings/tabs/legacy/ListLegacyTab.ts`
- Modify: `src/types/virtualization.ts` (header field), `src/hooks/listPaneData/listItems.ts`
- Modify: all 21 files in `src/i18n/locales/`
- Test: `tests/hooks/listPaneData/listItems.test.ts`

**Interfaces:**
- Consumes: the fan-out from Task 2.
- Produces:
  - `settings.inheritPropertyValueHeaderAppearance: boolean`, default `false`
  - `ListPaneItem.headerPropertyNodeId?: string | null` — set only on `headerKind: 'property'` headers in per-value mode
  - `strings.settings.items.inheritPropertyValueHeaderAppearance.{name,desc}`

- [ ] **Step 1: Write the failing test**

Append to the `per-value property grouping` describe block:

```ts
    it('tags per-value headers with the property value node id the tree would use', () => {
        const items = build('property-each:topics', { 'Dune.md': { topics: ['[[Topics]]'] } }, [multi]);
        const header = items.find(item => item.type === ListPaneItemType.HEADER);

        // The tree casefolds value paths (normalizePropertyTreeValuePath), so the id carries
        // `topics`, not the display-cased `Topics`. Building it from the label would never match.
        expect(header?.headerPropertyNodeId).toBe(buildPropertyValueNodeId('topics', 'topics'));
    });

    it('builds the node id from the raw value, not the display label', () => {
        const items = build('property-each:topics', { 'Dune.md': { topics: ['[[Fruits/Apple|Apple]]'] } }, [multi]);
        const header = items.find(item => item.type === ListPaneItemType.HEADER);

        // Display text is the alias `Apple`; the tree's value path is the casefolded display text.
        expect(String(header?.data)).toBe('Apple');
        expect(header?.headerPropertyNodeId).toBe(buildPropertyValueNodeId('topics', 'apple'));
    });

    it('leaves the node id unset for joined groups and for the no-value group', () => {
        const joined = build('property:topics', { 'Dune.md': { topics: ['[[Topics]]'] } }, [multi]);
        expect(joined.find(item => item.type === ListPaneItemType.HEADER)?.headerPropertyNodeId ?? null).toBeNull();

        const withNoValue = build('property-each:topics', {}, [single]);
        expect(withNoValue.find(item => item.type === ListPaneItemType.HEADER)?.headerPropertyNodeId ?? null).toBeNull();
    });
```

Add `buildPropertyValueNodeId` to the test file's imports from `../../../src/utils/propertyTree`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run tests/hooks/listPaneData/listItems.test.ts`

Expected: the first new test FAILS — `headerPropertyNodeId` is `undefined` because no code sets it. The second passes already, since the field is absent everywhere.

- [ ] **Step 3: Add the field and set it**

In `src/types/virtualization.ts`, beside `headerFolderPath` on `ListPaneItem`:

```ts
    // Property value node id for a per-value property group header. Lets the header inherit that
    // value's icon and colour from the navigation tree. Absent for joined groups and the no-value group.
    headerPropertyNodeId?: string | null;
```

In `listItems.ts`, add `headerPropertyNodeId` to the `Pick<...>` in `pushHeaderItem`'s parameter type and pass it onto the pushed item. Then import the builder:

```ts
import { buildPropertyValueNodeId } from '../../utils/propertyTree';
```

Also import the two normalizers the tree itself uses, so the id matches:

```ts
import { normalizePropertyTreeKey } from '../../utils/propertyTree';
import { normalizePropertyTreeValuePath } from '../../utils/propertyUtils';
```

and give `renderPropertyGroup` a node id parameter:

```ts
        const renderPropertyGroup = (label: string, groupFiles: TFile[], groupId: string, propertyNodeId: string | null): void => {
            pushHeaderItem({
                data: label,
                collapseKey: createCollapseKey(groupId),
                key: `header-${groupId}`,
                headerKind: 'property',
                headerPropertyNodeId: propertyNodeId,
                groupFiles
            });
            groupFiles.forEach(file => {
                pushFileItem(file);
            });
        };

        orderedPropertyGroups.forEach(group => {
            // Only a per-value group maps to a single tree node; a joined bucket has no single value.
            // The id must be built the way the tree builds it: the key casefolded, and the value run
            // through normalizePropertyTreeValuePath, which resolves a wikilink to its display text
            // and casefolds it. Using group.label here would produce `…=Topics` against the tree's
            // `…=topics` and the appearance lookup would silently never match.
            const propertyNodeId = propertyGroupingPerValue
                ? buildPropertyValueNodeId(normalizePropertyTreeKey(propertyGroupingKey), normalizePropertyTreeValuePath(group.bucketKey))
                : null;
            renderPropertyGroup(group.label, group.files, `property-value:${group.bucketKey}`, propertyNodeId);
        });

        if (ungroupedFiles.length > 0) {
            renderPropertyGroup(strings.listPane.propertyGroupNoValue, ungroupedFiles, 'property-none', null);
        }
```

In per-value mode `group.bucketKey` is the raw value (`[[Topics]]`), which is exactly the input
`normalizePropertyTreeValuePath` expects; `group.label` is the already-resolved display text and is only
for showing. If `normalizePropertyTreeValuePath(group.bucketKey)` comes back empty, pass `null`.

- [ ] **Step 4: Add the setting**

- `src/settings/types.ts`: add `inheritPropertyValueHeaderAppearance: boolean;` to the settings interface, next to the other list display booleans.
- `src/settings/defaultSettings.ts`: add `inheritPropertyValueHeaderAppearance: false,`.
- `src/settings/nativeSettingControls.ts`: add `'inheritPropertyValueHeaderAppearance',` to `BOOLEAN_SETTING_KEYS`. Do **not** add it to `NATIVE_SETTING_DOM_STATE_REFRESH_KEYS` — it gates no other control's visibility.
- `src/i18n/locales/en.ts`, in `settings.items`:

```ts
            inheritPropertyValueHeaderAppearance: {
                name: 'Colour per-value group headers',
                desc: "When grouping by each value of a property, group headers take that value's icon and colour from the navigation tree."
            },
```

- `src/settings/tabs/ListTab.ts`, in the same group as `showSelectedNavigationPills` (the group returned at the end of that display section):

```ts
        createToggleDefinition('inheritPropertyValueHeaderAppearance', {
            name: strings.settings.items.inheritPropertyValueHeaderAppearance.name,
            desc: strings.settings.items.inheritPropertyValueHeaderAppearance.desc
        })
```

- `src/settings/tabs/legacy/ListLegacyTab.ts`: add the matching `new Setting(...).setName(...).setDesc(...).addToggle(...)` block beside the legacy tab's `showSelectedNavigationPills` entry, following that file's existing shape.

- [ ] **Step 5: Translate the setting into the other 20 locales**

Insert beside each file's existing `showSelectedNavigationPills` entry, at 12-space indentation:

```
ar.ts     name: 'تلوين رؤوس المجموعات لكل قيمة'      desc: 'عند التجميع حسب كل قيمة لخاصية، تأخذ رؤوس المجموعات أيقونة تلك القيمة ولونها من شجرة التنقل.'
de.ts     name: 'Gruppenköpfe pro Wert einfärben'      desc: 'Beim Gruppieren nach jedem Wert einer Eigenschaft übernehmen die Gruppenköpfe Symbol und Farbe dieses Werts aus dem Navigationsbaum.'
es.ts     name: 'Colorear encabezados por valor'      desc: 'Al agrupar por cada valor de una propiedad, los encabezados toman el icono y el color de ese valor del árbol de navegación.'
fa.ts     name: 'رنگ‌آمیزی سرگروه‌ها برای هر مقدار'      desc: 'هنگام گروه‌بندی بر اساس هر مقدار یک ویژگی، سرگروه‌ها نماد و رنگ آن مقدار را از درخت ناوبری می‌گیرند.'
fr.ts     name: "Colorer les en-têtes par valeur"      desc: "Lors du regroupement par chaque valeur d'une propriété, les en-têtes reprennent l'icône et la couleur de cette valeur depuis l'arborescence."
id.ts     name: 'Warnai header per nilai'      desc: 'Saat mengelompokkan per nilai properti, header grup mengambil ikon dan warna nilai tersebut dari pohon navigasi.'
it.ts     name: "Colora le intestazioni per valore"      desc: "Raggruppando per ogni valore di una proprietà, le intestazioni prendono icona e colore di quel valore dall'albero di navigazione."
ja.ts     name: '値ごとのグループヘッダーに色を付ける'      desc: 'プロパティの値ごとにグループ化するとき、グループヘッダーはナビゲーションツリーからその値のアイコンと色を引き継ぎます。'
ko.ts     name: '값별 그룹 헤더에 색상 적용'      desc: '속성의 값별로 그룹화할 때 그룹 헤더가 내비게이션 트리에서 해당 값의 아이콘과 색상을 가져옵니다.'
nl.ts     name: 'Groepskoppen per waarde kleuren'      desc: 'Bij groeperen per waarde van een eigenschap nemen groepskoppen het pictogram en de kleur van die waarde over uit de boomstructuur.'
pl.ts     name: 'Koloruj nagłówki grup dla każdej wartości'      desc: 'Przy grupowaniu według każdej wartości atrybutu nagłówki grup przejmują ikonę i kolor tej wartości z drzewa nawigacji.'
pt.ts     name: 'Colorir cabeçalhos por valor'      desc: 'Ao agrupar por cada valor de uma propriedade, os cabeçalhos assumem o ícone e a cor desse valor da árvore de navegação.'
pt_br.ts  name: 'Colorir cabeçalhos por valor'      desc: 'Ao agrupar por cada valor de uma propriedade, os cabeçalhos assumem o ícone e a cor desse valor da árvore de navegação.'
ru.ts     name: 'Окрашивать заголовки групп по значению'      desc: 'При группировке по каждому значению свойства заголовки групп берут значок и цвет этого значения из дерева навигации.'
th.ts     name: 'ใส่สีหัวข้อกลุ่มตามแต่ละค่า'      desc: 'เมื่อจัดกลุ่มตามแต่ละค่าของคุณสมบัติ หัวข้อกลุ่มจะใช้ไอคอนและสีของค่านั้นจากแผนผังการนำทาง'
tr.ts     name: 'Değer başına grup başlıklarını renklendir'      desc: 'Bir özelliğin her değerine göre gruplarken grup başlıkları o değerin simgesini ve rengini gezinme ağacından alır.'
uk.ts     name: 'Розфарбовувати заголовки груп за значенням'      desc: 'Під час групування за кожним значенням властивості заголовки груп беруть піктограму та колір цього значення з дерева навігації.'
vi.ts     name: 'Tô màu tiêu đề nhóm theo từng giá trị'      desc: 'Khi nhóm theo từng giá trị của thuộc tính, tiêu đề nhóm lấy biểu tượng và màu của giá trị đó từ cây điều hướng.'
zh_cn.ts  name: '为每个值的分组标题着色'      desc: '按属性的每个值分组时，分组标题会从导航树中获取该值的图标和颜色。'
zh_tw.ts  name: '為每個值的分組標題著色'      desc: '依屬性的每個值分組時，分組標題會從導覽樹取得該值的圖示與顏色。'
```

French and Italian use double-quoted literals because their text contains apostrophes.

- [ ] **Step 6: Verify**

Run: `node node_modules/vitest/vitest.mjs run tests/hooks/listPaneData/listItems.test.ts` → PASS.
Run: `node node_modules/vitest/vitest.mjs run` → PASS.
Run: `npx tsc -noEmit -skipLibCheck` → no errors.
Run: `node node_modules/prettier/bin/prettier.cjs --check .` → clean.
Run: `node node_modules/eslint/bin/eslint.js src/settings src/types/virtualization.ts src/hooks/listPaneData/listItems.ts "src/i18n/locales/*.ts"` → clean.
Run: `rg -l "inheritPropertyValueHeaderAppearance" src/i18n/locales/*.ts | wc -l` → expect 21.

- [ ] **Step 7: Commit**

```bash
git add src/settings src/types/virtualization.ts src/hooks/listPaneData/listItems.ts src/i18n/locales tests/hooks/listPaneData/listItems.test.ts
git commit -m "feat: add the per-value header appearance setting and carry its node id"
```

---

### Task 6: Render the inherited icon and colour

**Files:**
- Modify: `src/components/listPane/ListPaneVirtualContent.tsx:755-815`
- Modify: the list header CSS section under `src/styles/sections/`
- Modify: `README.md`

**Interfaces:**
- Consumes: `settings.inheritPropertyValueHeaderAppearance` and `ListPaneItem.headerPropertyNodeId` from Task 5.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Resolve the value's icon, colour and background**

`getPropertyColorData(nodeId)` returns `{ color, background }` — the same pair the navigation tree row
uses — so "inherits the colour and icon" needs no invented styling: `color` tints the icon and label,
`background` tints the header.

In `ListPaneVirtualContent.tsx`, the header loop resolves `folderIconId` and `folderColor` for
folder-group headers around lines 770-795. Add the property-value equivalent immediately after that
block, before the `HeaderRenderModel` literal is built:

```ts
            let propertyValueIconId: string | null = null;
            let propertyValueColor: string | null = null;
            let propertyValueBackground: string | null = null;
            const propertyValueNodeId = item.headerKind === 'property' ? (item.headerPropertyNodeId ?? null) : null;
            if (propertyValueNodeId !== null && settings.inheritPropertyValueHeaderAppearance) {
                propertyValueIconId = metadataService.getPropertyIcon(propertyValueNodeId) ?? null;
                const propertyColorData = metadataService.getPropertyColorData(propertyValueNodeId);
                propertyValueColor = propertyColorData.color ?? null;
                propertyValueBackground = propertyColorData.background ?? null;
            }
```

Add all three to the `HeaderRenderModel` literal alongside `folderIconId` / `folderColor`, and to the
`HeaderRenderModel` interface (near `folderIconId: string | null;` at ~line 85):

```ts
    propertyValueIconId: string | null;
    propertyValueColor: string | null;
    propertyValueBackground: string | null;
```

- [ ] **Step 2: Render the icon and colours**

The header component derives its folder styles at ~lines 269-271:

```ts
    const folderColor = header.folderColor ?? undefined;
    const folderIconStyle = folderColor ? { color: folderColor } : undefined;
    const folderLabelStyle = header.applyFolderColorToLabel && folderColor ? { color: folderColor } : undefined;
```

Add the property equivalents beside them:

```ts
    const propertyValueColor = header.propertyValueColor ?? undefined;
    const propertyValueIconStyle = propertyValueColor ? { color: propertyValueColor } : undefined;
    const propertyValueLabelStyle = propertyValueColor && !settings.colorIconOnly ? { color: propertyValueColor } : undefined;
    const propertyValueShellStyle = header.propertyValueBackground ? { backgroundColor: header.propertyValueBackground } : undefined;
```

`colorIconOnly` is honoured for the label so this matches how the rest of the plugin treats a configured
colour — the folder header does the same via `applyFolderColorToLabel`.

Render the icon next to the existing folder-icon block (~line 382), reusing the shared icon class:

```tsx
                    {!header.isPinnedHeader && header.propertyValueIconId ? (
                        <ServiceIcon
                            iconId={header.propertyValueIconId}
                            className="nn-list-group-header-icon nn-list-group-header-property-icon"
                            aria-hidden={true}
                            data-has-color={propertyValueColor ? 'true' : 'false'}
                            style={propertyValueIconStyle}
                        />
                    ) : null}
```

Apply `propertyValueLabelStyle` to the header's label element the same way `folderLabelStyle` is applied,
and `propertyValueShellStyle` to the outermost header element that already carries
`nn-list-sticky-header`.

- [ ] **Step 3: Add the CSS**

Only one rule is needed, because the colours arrive as inline styles. Add to the list header section
under `src/styles/sections/`, beside the existing `.nn-list-group-header-icon` rules:

```css
.nn-list-group-header-property-icon {
    flex: 0 0 auto;
}
```

Then run `node scripts/build-styles.mjs` so `styles.css` is regenerated.

Do **not** add a background rule: the background comes from `propertyValueShellStyle` and is only set
when the value actually has one configured, so a value with no background keeps the default header
appearance with no CSS involved.

- [ ] **Step 4: Document it**

In `README.md`, find the list-pane grouping description and append:

```markdown
Grouping by a property offers a second form for list-valued properties: **each value** puts a note under every value it holds, so a note with three topics appears under all three. With **Colour per-value group headers** enabled, those headers take the icon and colour you gave that value in the navigation tree.
```

- [ ] **Step 5: Verify**

Run: `npx tsc -noEmit -skipLibCheck` → no errors.
Run: `node node_modules/vitest/vitest.mjs run` → PASS.
Run: `node node_modules/prettier/bin/prettier.cjs --check .` → clean.
Run: `node node_modules/eslint/bin/eslint.js src/components/listPane/ListPaneVirtualContent.tsx` → clean.
Run: `node node_modules/prettier/bin/prettier.cjs --check .` again after the style build, since `styles.css` is regenerated.

Then verify in the running app via the obsidian-cli skill:

1. Build and deploy: `node scripts/build-styles.mjs && node esbuild.config.mjs production`, copy `main.js styles.css manifest.json` into the vault plugin folder, `obsidian plugin:reload id=notebook-navigator`.
2. Group a folder by a list-valued property using the **(each value)** entry. Confirm a note with two values appears under both headers, and the headers read display text rather than `[[...]]`.
3. Confirm arrow keys walk both copies and that clicking one highlights both.
4. Enable **Colour per-value group headers**. Confirm a value with an icon and colour set in the navigation tree renders them on its header, and that a value with neither renders plain.
5. Switch back to the plain property grouping entry and confirm the joined single header returns unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/components/listPane/ListPaneVirtualContent.tsx src/styles styles.css README.md
git commit -m "feat: inherit property value icon and colour on per-value group headers"
```

---

## Notes for the implementer

**Why locales come before code in Task 4 and 5.** Every locale must be structurally complete or `tsc` fails, and code referencing a string `en.ts` lacks also fails. Each task therefore adds the English string, lets `tsc` name the missing locales, then fills them in — the deliberately-failing `tsc` step is a verification, not a problem to route around.

**Do not add instance identity to selection.** Every copy of a note highlighting together is the chosen behavior. If a reviewer flags it, point at the spec's "Why selection stays path-based".

**Do not cache the fan-out.** The grouping is recomputed with the item array, which is already memoised upstream by the list-pane refresh hook.

**`orderedFiles` duplicates are intended.** They are what makes arrow keys visit each copy. Only the index maps deduplicate.
