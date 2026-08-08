# Minors report: hierarchical property tree caveat-review

Closes the five Minor findings from the caveat-review of commits `72ab443f..1c89cff7`
(0 Critical, 0 Important, 5 Minor). Documentation and one test, no behaviour change apart
from a debug log added under Minor 2.

## Minor 1: false comment in useNavigationActions.ts

**Claim:** `src/hooks/useNavigationActions.ts:389` said the hierarchy ref is "Read when a
handler runs, not when this hook renders". That is false: `shouldCollapseItems()` calls
`readPropertyHierarchy()` and is itself invoked from render bodies, to compute the
expand/collapse icon and its aria-label.

**Verified before writing:**
- `shouldCollapseItems` is called at render time in `src/components/NavigationPaneHeader.tsx:182`
  (aria-label) and `:197` (icon), and in `src/components/NavigationToolbar.tsx:82` (aria-label)
  and `:94` (icon).
- The ref is written at `src/components/navigationPane/NavigationPaneContent.tsx:192-193`, at the
  top of that component's render, right after the `useRef` declaration that seeds it.
- `NavigationPaneContent` is wrapped in `React.memo` (`export const NavigationPane = React.memo(`),
  so a memoized child that skips a render on an index-only change can read a value one cycle stale.

**Fix:** rewrote the comment in place. It now states the ref is read during render by the
toolbar icon and aria-label as well as by the handler, that the write happens at the top of the
owning component's render so children see the current value, and names the one-cycle
`React.memo` residual so the next reader isn't surprised. No code changed.

## Minor 2: non-transferable "silent for the same reason" justification

**Claim:** `src/utils/treeFlattener.ts:534` and the design doc at `:253` justified
`MAX_EXPANDABLE_PROPERTY_PLACEMENTS` truncating silently as being "silent for the same reason
the depth cap is." That reasoning does not transfer: the depth cap is hit inside the flattener,
which runs during render, where logging every pass would spam. `collectExpandablePropertyPlacementKeys`,
the only caller of the placement cap, is invoked once from `useNavigationActions.ts:557`, inside
the expand-all/collapse-all command handler, which runs once per click.

**Decision: log it.** Chose to log rather than rewrite the justification, because the underlying
reason to stay silent (render-time spam) genuinely does not apply here, and a log line in a
once-per-click handler costs nothing.

**What was checked before choosing `console.debug`:** searched for an existing logger the
codebase already uses instead of raw `console.*`. Found `src/services/diagnostics/DebugLoggingService.ts`,
which exposes `recordDebugReport(title, details)` (used by `pdfCoverThumbnail.ts` for a PDF
thumbnail trace) and `isDebugLoggingEnabled()`. That mechanism is a heavier, opt-in diagnostics
system: it requires a user-enabled "debug logging" setting, an `App` instance wired through a
plugin-lifecycle singleton, and it writes structured reports to a markdown file in the vault.
`treeFlattener.ts` is a small, dependency-light pure-utils module with no existing dependency on
`services/diagnostics`, and the event being logged (an internal enumeration cap, never hit in any
measured real vault, worst case 27 placements against a bound of 1000) does not warrant a
vault-write diagnostics report. Everywhere else in `src/` that logs an ad hoc runtime event
(`main.ts`, `SearchTagInputSuggest.ts`, `StorageContext.tsx`, etc.) calls `console.*` directly,
several with a `[ComponentName]` prefix, so `console.debug('[Notebook Navigator] ...', details)`
matches the codebase's existing habit rather than introducing a new one.

**Fix:**
- `src/utils/treeFlattener.ts`: `MAX_EXPANDABLE_PROPERTY_PLACEMENTS` is now `export`ed (also
  needed by Minor 3's test) and its comment states the real, non-transferable reason. The `visit`
  closure in `collectExpandablePropertyPlacementKeys` now distinguishes the placement-limit branch
  from the depth-cap branch (previously combined with `||`) so it can set a `truncatedByPlacementLimit`
  flag; after the walk, if that flag is set, one `console.debug('[Notebook Navigator] expand all
  truncated hierarchical property placements', { keyNodeId, limit })` is emitted. This logs at most
  once per call, not once per recursive step.
- `.superpowers/design-docs/2026-08-07-hierarchical-property-tree-design.md:253`: rewritten to
  state the depth cap is silent because it runs during render, and that this cap does not share
  that reason because it is only reached from expand all, a once-per-click handler, so it logs.

## Minor 3: no test for the new bound

**Claim:** `MAX_EXPANDABLE_PROPERTY_PLACEMENTS` was the only new production behaviour in the
previous pass, and deleting the check kept all 2203 tests green.

**Fix:** added `describe('collectExpandablePropertyPlacementKeys', ...)` to
`tests/utils/treeFlattener.test.ts` with a layered fixture: 5 layers of 6 values each, every
value in layer L+1 parented by all 6 values in layer L (full bipartite fan-out between
consecutive layers), built by wiring each layer-L node's `notesWithValue` to contain all 6
layer-(L+1) node names. This yields exactly 6 + 6^2 + 6^3 + 6^4 = 1554 candidate placements
(one per non-leaf chain across layers 1-4; layer 5 is childless so its chains are never
pushed), comfortably past the 1000 bound.

Three assertions, matching the brief:
1. **Capped at exactly the bound:** `collectExpandablePropertyPlacementKeys(...).length` equals
   `MAX_EXPANDABLE_PROPERTY_PLACEMENTS` (imported from source, not a copied literal).
2. **Deterministic across two runs:** calling the function twice against the same index yields
   `toEqual` arrays. (The underlying index is already built with sorted `rootIds`/`childIds`, so
   this mainly locks in that the walk itself introduces no nondeterminism.)
3. **Prefix closure survives truncation:** for every emitted placement key, every proper prefix
   produced by `getPropertyPlacementAncestorKeys` is also present in the emitted set. This is the
   one that would catch a child key outliving its parent, which would persist a placement that
   renders nowhere.

**Verified the test fails without the bound check**, as requested. Temporarily removed the
`placementKeys.length >= MAX_EXPANDABLE_PROPERTY_PLACEMENTS` branch from `visit` (leaving only the
depth-cap check) and reran the file:

```
$ node node_modules/vitest/vitest.mjs run tests/utils/treeFlattener.test.ts
 FAIL  tests/utils/treeFlattener.test.ts > collectExpandablePropertyPlacementKeys > truncates a large hierarchical key to exactly MAX_EXPANDABLE_PROPERTY_PLACEMENTS
AssertionError: expected 1554 to be 1000 // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 18 passed (19)
```

The candidate count of 1554 landed exactly on the value predicted from the fixture's shape,
confirming the fixture is built as intended. Restored the bound check immediately afterward and
reran; all 19 tests in the file pass again (see Commands below).

## Minor 4: spec omits parentIds

**Claim:** `.superpowers/design-docs/2026-08-07-hierarchical-property-tree-design.md:94-101`
declared `PropertyHierarchyIndex` with `rootIds`, `childIds` and `subtreeCount` only, while `:62`
and `:217` say reveal walks `index.parentIds`, and the code (`src/utils/propertyHierarchy.ts:33`)
has the field.

**Fix:** added `parentIds: ReadonlyMap<string, readonly string[]>;` to the interface block in the
design doc, with the doc comment `/** Value node id -> its parent value node ids. Empty for a
root. */`, matching `propertyHierarchy.ts:32-33`'s comment (`/** Value node id -> its parent value
node ids. Empty for a root. May participate in cycles. */`, shortened to fit the spec's terser
style, same as `rootIds`/`childIds`/`subtreeCount` in that block). No other lines in that section
needed changes; `:62` and `:217` already correctly referenced `parentIds`.

## Minor 5: residual recorded, not built for

**Claim:** the hierarchy ref is plumbed through four components (`useNavigationActions`,
`NavigationPaneContent`, `NavigationPaneHeader`, `NavigationToolbar`) and pinned by nothing but
`tsc`; a future caller passing `EMPTY_PROPERTY_HIERARCHY_INDEX` would keep every test green,
because there is no DOM test environment (no jsdom, testing-library, or react-test-renderer) in
this repo to assert on rendered icon or aria-label output.

**Fix:** appended two paragraphs to
`.superpowers/sdd/2026-08-07-hierarchical-property-tree/progress.md`, in the style of the
existing `CAVEATS review minor` entries:
- One paragraph closing minors 1-4, summarizing what changed and why.
- One paragraph recording the Minor 5 residual verbatim as a known, not-closed gap, plus the
  related observation that `shouldCollapseItems()` now runs `resolvePropertyRevealChain` (a
  breadth-first walk of `index.parentIds`, confirmed by its own doc comment: "Walks parents
  breadth first...") on every invocation, and that it is invoked twice per render in each of
  `NavigationPaneHeader` and `NavigationToolbar` (once for the icon, once for the aria-label),
  where the pre-hierarchy code was O(1) string comparison. Noted as bounded by one key's value
  count and fine today, not a defect.

No code change for this finding, as instructed.

## Incidental: reverted an unrelated stray change

`.superpowers/sdd/.gitignore` had an uncommitted change (from `review-*.diff` to a bare `*`)
present before this pass started, unrelated to any of the five minors. A bare `*` would have
gitignored this report file, which the task requires committing into a tracked directory.
Reverted it to the committed version (`git checkout -- .superpowers/sdd/.gitignore`) since it was
not part of the assignment and would have blocked the deliverable.

## Commands and output

TypeScript:
```
$ npx tsc -noEmit -skipLibCheck
(no output, clean)
```

ESLint, touched files (including the test file explicitly, since `tsc` does not cover `tests/`):
```
$ node node_modules/eslint/bin/eslint.js src/hooks/useNavigationActions.ts src/utils/treeFlattener.ts tests/utils/treeFlattener.test.ts
(no output, clean)
```

Prettier, touched files (`.superpowers/` is excluded by `.prettierignore`, not formatted):
```
$ node node_modules/prettier/bin/prettier.cjs --check src/hooks/useNavigationActions.ts src/utils/treeFlattener.ts tests/utils/treeFlattener.test.ts
Checking formatting...
All matched files use Prettier code style!
```

Targeted test file, with the fix in place:
```
$ node node_modules/vitest/vitest.mjs run tests/utils/treeFlattener.test.ts
 Test Files  1 passed (1)
      Tests  19 passed (19)
```

Full suite:
```
$ node node_modules/vitest/vitest.mjs run
 Test Files  180 passed (180)
      Tests  2206 passed (2206)
```

2206 = the prior 2203 plus the 3 new `it` blocks under Minor 3. No test dropped, folders and tags
untouched by this pass (only `useNavigationActions.ts`, `treeFlattener.ts`, one test file, and two
docs files changed).

## Commit

Work commit: **`c989f222`** (`fix: close the five caveat-review minors on hierarchical property
trees`), on branch `property-notes` over base `1c89cff7`. This report is committed on top of it,
so the SHA above points at the commit it describes rather than one an amend would have replaced.
