## Task 5: Expansion and auto-reveal by placement

**Files:**
- Modify: `src/hooks/navigationPane/useNavigationPaneTreeInteractions.ts` (around lines 336, 338, 640, 722)
- Modify: `src/context/ExpansionContext.tsx` if `EXPAND_PROPERTIES` needs a comment change

**Interfaces:**
- Consumes: `firstPlacementByNodeId` from Task 4's memo, `buildPropertyPlacementKey` from Task 2.
- Produces: expansion and reveal that operate on placement keys.

- [ ] **Step 1: Toggle expansion by placement key**

The chevron handler currently toggles `propertyNode.id`. It must toggle the clicked item's `key`, which is the placement key. Where the handler receives the node, thread the item's key through instead so a value expanded under one parent does not expand under another. The `EXPAND_PROPERTIES` action payload (`propertyNodeIds: string[]`, `ExpansionContext.tsx:48`) now carries placement keys; update its comment to say so, since the field name no longer describes the contents for hierarchical keys.

- [ ] **Step 2: Reveal the first placement**

Auto-reveal resolves a value node id. Map it through `firstPlacementByNodeId`, then expand every ancestor prefix of that chain:

```ts
    const expandToPlacement = (placementKey: string): string[] => {
        const chain = placementKey.split(String.fromCharCode(0));
        // Every ancestor prefix must be expanded for the target row to exist.
        return chain.slice(0, -1).map((_, index) => buildPropertyPlacementKey(chain.slice(0, index + 1)));
    };
```

Dispatch `EXPAND_PROPERTIES` with those keys. When the node id has no entry in `firstPlacementByNodeId`, fall back to the node id itself, which is correct for a non-hierarchical key.

- [ ] **Step 3: Verify in the vault**

Rebuild and reload as in Task 4 step 7, then with `projects` hierarchical:

- open `Datawerkplaats Mooi Maasvallei` from outside the navigator and confirm the tree expands `Work`, then `Clients`, and selects the value
- expand `Clients` under `Areas` for `categories` and confirm the `Categories` placement of `Clients` stays collapsed
- collapse and reopen the pane and confirm expansion persisted
- turn the property's Hierarchical toggle off and confirm the flat list returns with its previous expansion intact

- [ ] **Step 4: Run everything**

```bash
npx tsc -noEmit -skipLibCheck
node node_modules/vitest/vitest.mjs run
node node_modules/prettier/bin/prettier.cjs --check "src/**/*.ts" "src/**/*.tsx"
node node_modules/eslint/bin/eslint.js src/hooks src/components src/utils src/settings
```

Expected: clean, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/navigationPane src/context/ExpansionContext.tsx
git commit -m "fix: expand and reveal hierarchical property values by placement"
```

---

## Self-review

**Spec coverage.** Every section of the design maps to a task: the additive index and counts to Task 1; the flattener, placement keys, depth cap and first-placement map to Task 2; both settings, the menu toggle and the 21 locales to Task 3; the index memo, emitter branch, chevron, badge and the frequency-comparator correction to Task 4; expansion and auto-reveal to Task 5. The "never mutate the tree" and "flag off is identical" constraints are enforced by construction plus the full-suite gate in Tasks 2, 4 and 5.

**Two places the plan is deliberately less prescriptive**, because the exact surrounding code must be read at implementation time rather than guessed:

- Task 4 step 1 says to use "whatever field on `propertySectionBase` holds the tree". Naming it from memory risked being wrong, and it is unambiguous once the file is open.
- Task 4 steps 4 and 5, and Task 5 step 1, describe threading the index and the item key through existing prop chains without reproducing those chains. The change is mechanical; inventing the intermediate signatures here would more likely mislead than help.

**One refinement over the spec.** The spec said promoted cycle roots are sorted by the level comparator. The index has no comparator, so it sorts them by node id for deterministic output and the flattener applies the user's comparator on top. Same visible result, cleaner boundary.

**One risk the plan adds a guard for that the spec did not call out.** `index.childIds` can contain cycle edges, so the flattener needs a per-chain visited check, not just the index-level sweep. Without it, a promoted cycle root walks forever. Task 2 covers it in code and in the "does not loop forever" test.
