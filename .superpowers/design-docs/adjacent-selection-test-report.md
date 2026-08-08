# Adjacent-selection test coverage: extraction report

## Extracted function

`resolveAdjacentFileSelection`, in `src/utils/selectionUtils.ts` (immediately after `getAdjacentFile`).

```ts
export function resolveAdjacentFileSelection(params: {
    files: TFile[];
    currentFile: TFile | null;
    direction: 'next' | 'previous';
    rowCursor: number | null;
    listIndexByFileIndex: readonly number[];
    filePathToIndex: ReadonlyMap<string, number>;
}): { file: TFile; rowCursor: number; scrollIndex: number | undefined } | null
```

It calls `getAdjacentFile(files, currentFile, direction, rowCursor)` for the landing file/row (no
duplicated arithmetic), then computes `scrollIndex = listIndexByFileIndex[index] ?? filePathToIndex.get(file.path)`
and returns `{ file, rowCursor: index, scrollIndex }`, or `null` when `getAdjacentFile` returns `null`.

`getAdjacentFile` is unchanged and still exported; its existing tests in
`tests/utils/selectionUtils.test.ts` were left untouched and still pass.

## Hook change

`selectAdjacentFile` in `src/hooks/useListPaneSelectionCoordinator.ts` (lines ~388-421) is now a thin
applier:

1. Reads `currentFile` via `resolvePrimarySelectedFile` (context read, not a decision).
2. Calls `resolveAdjacentFileSelection` with `orderedFiles`, `currentFile`, `direction`,
   `rowCursorRef.current`, `listIndexByFileIndex`, `filePathToIndex`.
3. Returns `false` if the result is `null`.
4. Applies three effects on a non-null result:
   - `selectFileFromList(resolved.file, { markKeyboardNavigation: true, markUserSelection: true, suppressOpen: settings.enterToOpenFiles })`
   - `rowCursorRef.current = resolved.rowCursor`
   - `scrollToIndexSafely(resolved.scrollIndex, 'auto')` when `resolved.scrollIndex !== undefined`
5. Returns `true`.

No other behavior in the hook changed. The `useCallback` dependency array is unchanged (same
identifiers: `app`, `filePathToIndex`, `listIndexByFileIndex`, `orderedFiles`, `scrollToIndexSafely`,
`selectFileFromList`, `selectionState`, `settings.enterToOpenFiles`).

## What remains untested in the hook

Precisely the three effect applications listed above, applied only when `resolveAdjacentFileSelection`
returns non-null:

- The `selectFileFromList` call (dispatches `SET_SELECTED_FILE`/`SET_KEYBOARD_NAVIGATION`, and the
  keyboard-open suppression/debounce path inside `selectFileFromList` itself).
- The `rowCursorRef.current = resolved.rowCursor` ref write.
- The `scrollToIndexSafely(resolved.scrollIndex, 'auto')` call and its `undefined`-skips-scroll guard.

These are unreachable without a hook harness (no `renderHook`, no DOM environment in this repo, and this
task was explicitly scoped to not add one). Everything upstream of them — cursor resolution, landing file,
landing row, and scroll-index choice/fallback — is now covered by `resolveAdjacentFileSelection`'s tests
plus the pre-existing `getAdjacentFile` tests.

## TDD evidence for the two guard assertions

Both were proven by reverting the extracted function's logic in `src/utils/selectionUtils.ts`, rerunning
`node node_modules/vitest/vitest.mjs run tests/utils/selectionUtils.test.ts`, confirming the targeted test
failed (plus expected knock-on failures in tests exercising the same code path), then restoring the
correct line and confirming green again.

### Guard 1: cursor write-back (`rowCursor: index` → landed row, not incoming cursor)

Reverted `return { file, rowCursor: index, scrollIndex };` to
`return { file, rowCursor: rowCursor ?? index, scrollIndex };` (uses the incoming cursor when present,
mimicking "forgot to write back the landed row").

**Before restore (reverted code) — failing output:**

```
 FAIL  tests/utils/selectionUtils.test.ts > resolveAdjacentFileSelection > from row 1 (second Dune), next returns PKM with rowCursor 2
 FAIL  tests/utils/selectionUtils.test.ts > resolveAdjacentFileSelection > from row 2 (PKM), next returns the third Dune with rowCursor 3
 FAIL  tests/utils/selectionUtils.test.ts > resolveAdjacentFileSelection > returns the landed row as rowCursor, not the incoming cursor — guards the cursor write-back
 FAIL  tests/utils/selectionUtils.test.ts > resolveAdjacentFileSelection > falls back to filePathToIndex when listIndexByFileIndex has no entry for the landed row
 FAIL  tests/utils/selectionUtils.test.ts > resolveAdjacentFileSelection > leaves scrollIndex undefined, meaning the caller should not scroll, when neither source has an entry
 Tests  5 failed | 16 passed (21)
```

The dedicated guard test (`returns the landed row as rowCursor, not the incoming cursor`) failed, as
intended — that assertion is `expect(result?.rowCursor).toBe(2); expect(result?.rowCursor).not.toBe(1)`.

**After restoring `rowCursor: index`:**

```
 Test Files  1 passed (1)
      Tests  21 passed (21)
```

### Guard 2: scroll preference (`listIndexByFileIndex` before `filePathToIndex`)

Reverted `const scrollIndex = listIndexByFileIndex[index] ?? filePathToIndex.get(file.path);` to
`const scrollIndex = filePathToIndex.get(file.path) ?? listIndexByFileIndex[index];` (swapped the
preference order, mimicking "scroll to the wrong copy of a repeated note").

**Before restore (reverted code) — failing output:**

```
 FAIL  tests/utils/selectionUtils.test.ts > resolveAdjacentFileSelection > from row 2 (PKM), next returns the third Dune with rowCursor 3
 FAIL  tests/utils/selectionUtils.test.ts > resolveAdjacentFileSelection > reads scrollIndex from listIndexByFileIndex at the landed row, not from filePathToIndex — guards the scroll choice
      Tests  2 failed | 19 passed (21)
```

The dedicated guard test failed, as intended — it lands on the third Dune (row 3), where
`filePathToIndex.get('Notes/Dune.md')` (Dune's first appearance) is `10` and
`listIndexByFileIndex[3]` (the actual landed row) is `40`; the assertion
`expect(result?.scrollIndex).not.toBe(filePathToIndex.get(dune.path))` catches the swap.

**After restoring `listIndexByFileIndex[index] ?? filePathToIndex.get(file.path)`:**

```
 Test Files  1 passed (1)
      Tests  21 passed (21)
```

## Verification

- `npx tsc -noEmit -skipLibCheck` — exit 0, no output.
- `node node_modules/vitest/vitest.mjs run` — 177 test files passed, 2125 tests passed (baseline 177
  files / 2115 tests; +10 tests, all new, 0 files added since only existing files were edited).
- `node node_modules/prettier/bin/prettier.cjs --check .` — "All matched files use Prettier code style!"
  (one run needed `--write` on the new test file for line-wrapping; re-checked clean afterward).
- `node node_modules/eslint/bin/eslint.js src/utils/selectionUtils.ts src/hooks/useListPaneSelectionCoordinator.ts tests/utils/selectionUtils.test.ts`
  — no output, no errors.

## Deviations from the brief

None found. The signature and behavior matched what the brief sketched:

- `resolveAdjacentFileSelection`'s shape matches the suggested one almost exactly (field names identical).
- `resolveRowCursorFileIndex` and `getAdjacentFile` semantics were exactly as described and needed no
  changes.
- `buildFileIndexToListIndexMap` returns a plain `number[]`, index-aligned with `orderedFiles` (confirmed
  by reading `src/hooks/listPaneData/listItems.ts:904-912`), matching the brief's description of
  `listIndexByFileIndex`.
- No hidden state or context dependency turned up — `resolveAdjacentFileSelection` needed only plain
  arguments, exactly as hoped, so no BLOCKED situation arose.

## Concerns

None. The refactor is behavior-preserving (confirmed by diff review: same three effects, same order, same
conditions, same `useCallback` deps) and the two previously code-review-only invariants (cursor write-back
using the landed row, scroll preferring the virtualized index over the path-based one) now have tests that
fail under direct reversion of either behavior.
