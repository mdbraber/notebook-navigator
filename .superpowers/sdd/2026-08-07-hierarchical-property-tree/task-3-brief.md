## Task 3: The setting and the context menu toggle

**Files:**
- Modify: `src/settings/types.ts`, `src/settings/defaultSettings.ts`
- Modify: `src/settings/tabs/PropertiesTab.ts`
- Modify: `src/utils/contextMenu/propertyMenuBuilder.ts`
- Modify: all 21 files in `src/i18n/locales/`

**Interfaces:**
- Produces: `settings.propertyHierarchicalKeys: Record<string, boolean>`, `settings.propertyHierarchyMaxDepth: number`, and a checkable Hierarchical menu item.

- [ ] **Step 1: Add the settings fields**

In `src/settings/types.ts`, in the `NotebookNavigatorSettings` interface beside `propertySortOrder` (around line 769):

```ts
    /** Normalized property keys whose values render as a nested hierarchy. */
    propertyHierarchicalKeys: Record<string, boolean>;
    /** Levels of nesting a hierarchical property renders below its roots. A backstop. */
    propertyHierarchyMaxDepth: number;
```

Do **not** add either to `SYNC_MODE_SETTING_IDS`. That list is only for settings the user can switch between synced and local storage, and neither of these needs that.

In `src/settings/defaultSettings.ts`, beside `propertySortOrder` (around line 297):

```ts
    propertyHierarchicalKeys: {},
    propertyHierarchyMaxDepth: 10,
```

- [ ] **Step 2: Add the English strings**

In `src/i18n/locales/en.ts`, add to the `contextMenu.property` object (at line 383, beside `createPropertyNote`):

```ts
            hierarchical: 'Hierarchical',
```

And add a new settings item beside the other property settings:

```ts
            propertyHierarchyMaxDepth: {
                name: 'Maximum hierarchy depth',
                desc: 'How many levels a hierarchical property nests below its top-level values. A safety limit; most vaults never reach it.',
                resetTooltip: 'Reset maximum hierarchy depth to default'
            },
```

- [ ] **Step 3: Add the same two strings to the other 20 locales**

Every locale file must define both keys or the build fails, because `getResolvedStrings` returns a locale object wholesale with no merge. Translate `hierarchical`, and the three fields of `propertyHierarchyMaxDepth`, in each of: `ar, de, es, fa, fr, id, it, ja, ko, nl, pl, pt, pt_br, ru, th, tr, uk, vi, zh_cn, zh_tw`.

- [ ] **Step 4: Verify the locales compile**

Run: `npx tsc -noEmit -skipLibCheck`
Expected: no output. Any missing locale key surfaces here as a type error naming the file.

- [ ] **Step 5: Add the depth slider to the Properties tab**

In `src/settings/tabs/PropertiesTab.ts`, import the slider helper and `DEFAULT_SETTINGS` if not already imported:

```ts
import { renderSliderSetting } from './SliderSetting';
import { DEFAULT_SETTINGS } from '../defaultSettings';
```

Add a `createRenderDefinition` entry to the property group:

```ts
            createRenderDefinition({
                name: strings.settings.items.propertyHierarchyMaxDepth.name,
                desc: strings.settings.items.propertyHierarchyMaxDepth.desc,
                render: setting =>
                    renderSliderSetting(setting, {
                        name: strings.settings.items.propertyHierarchyMaxDepth.name,
                        desc: strings.settings.items.propertyHierarchyMaxDepth.desc,
                        value: plugin.settings.propertyHierarchyMaxDepth,
                        defaultValue: DEFAULT_SETTINGS.propertyHierarchyMaxDepth,
                        min: 1,
                        max: 20,
                        step: 1,
                        resetTooltip: strings.settings.items.propertyHierarchyMaxDepth.resetTooltip,
                        onChange: async value => {
                            plugin.settings.propertyHierarchyMaxDepth = value;
                            await plugin.saveSettingsAndUpdate();
                        }
                    })
            }),
```

- [ ] **Step 6: Add the context menu toggle**

In `src/utils/contextMenu/propertyMenuBuilder.ts`, in the key-node section near the existing `canManagePropertyKey` block (around line 430), where `propertyKey` is already in scope from line 145:

```ts
    if (propertyKey !== null) {
        const isHierarchical = plugin.settings.propertyHierarchicalKeys[propertyKey] === true;
        menu.addItem(item => {
            item.setTitle(strings.contextMenu.property.hierarchical)
                .setIcon('lucide-list-tree')
                .setChecked(isHierarchical)
                .onClick(() => {
                    runAsyncAction(async () => {
                        const next = { ...plugin.settings.propertyHierarchicalKeys };
                        if (isHierarchical) {
                            delete next[propertyKey];
                        } else {
                            next[propertyKey] = true;
                        }
                        plugin.settings.propertyHierarchicalKeys = next;
                        await plugin.saveSettingsAndUpdate();
                    });
                });
        });
    }
```

Deleting rather than writing `false` keeps the record free of dead entries, so `Object.keys` is the hierarchical key set.

- [ ] **Step 7: Verify the icon exists**

`lucide-list-tree` must be in Obsidian's registry or the item renders with no icon and no error. Confirm before relying on it:

```bash
LC_ALL=C grep -c -a -o '"list-tree":\[\[' /Applications/Obsidian.app/Contents/Resources/obsidian.asar
```

Expected: a non-zero count. If it is `0`, pick another and re-check the same way; `git-fork` and `network` are both present in this build.

- [ ] **Step 8: Typecheck, format, lint, test**

```bash
npx tsc -noEmit -skipLibCheck
node node_modules/prettier/bin/prettier.cjs --write "src/**/*.ts"
node node_modules/eslint/bin/eslint.js src/settings src/utils/contextMenu src/i18n
node node_modules/vitest/vitest.mjs run
```

Expected: no output from the first three, all tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/settings src/utils/contextMenu/propertyMenuBuilder.ts src/i18n
git commit -m "feat: add the hierarchical property setting and its menu toggle"
```

---

