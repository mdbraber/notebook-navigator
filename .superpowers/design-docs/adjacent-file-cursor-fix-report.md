# Fix report: `getAdjacentFile` row cursor omission

Branch: `main`, starting at clean `84c7bb59`.

## What changed

### `src/utils/selectionUtils.ts:313-344` — `getAdjacentFile`

Changed the return type from `TFile | null` to `{ file: TFile; index: number } | null`. Internals are
unchanged (same `resolveRowCursorFileIndex` call, same `targetIndex` arithmetic, same bounds check); the
only behavioral difference is that the resolved file is now returned alongside the row index it came from,
so a caller can no longer take the file without also seeing the index. Docstring extended to explain why
(mirrors the `createPropertyGroupingOption` required-third-parameter precedent named in the brief).

```ts
export function getAdjacentFile(
    files: TFile[],
    targetFile: TFile | null,
    direction: 'next' | 'previous',
    rowCursor: number | null
): { file: TFile; index: number } | null
```

### `src/hooks/useListPaneSelectionCoordinator.ts:374-409` — `selectAdjacentFile`

- Destructures `{ file: targetFile, index: targetFileIndex }` from the result.
- **New:** `rowCursorRef.current = targetFileIndex;` after `selectFileFromList` — this is the missing
  write-back. `selectAdjacentFile` is now consistent with the other six movers (arrows, page, home/end,
  shift-ranges, clicks), all of which already call `setRowCursor`/assign `rowCursorRef.current` after
  moving.
- Scroll target: **left as the existing `filePathToIndex.get(targetFile.path)` lookup**, now with a comment
  documenting why (see "Scroll translation" below) instead of silently keeping the old behavior.

### `src/services/commands/navigatorCommandHandlers.ts:315-318` — `selectAdjacentFileWithoutNavigatorView`

```ts
const adjacentFile = getAdjacentFile(files, currentFile, direction, null);
if (!adjacentFile) {
    return false;
}
const targetFile = adjacentFile.file;
```

The index is deliberately discarded — this caller has no list-pane cursor to update (no navigator view is
mounted) and its file list is already deduplicated by the file finder, so first-appearance resolution is
exact, exactly as the pre-existing comment says. Comment left unchanged since it was already accurate; only
the two lines that consume the return value changed.

## Scroll translation — could not fully close consequence 2, reporting per the escape-hatch instruction

I looked at how `useListPaneKeyboard.ts` does this translation before deciding:

- `useListPaneKeyboard.ts:138`: `const listIndexByFileIndex = useMemo(() => buildFileIndexToListIndexMap(items), [items]);`
- `buildFileIndexToListIndexMap` (`src/hooks/listPaneData/listItems.ts:904-912`) maps a **file-row index**
  (position in `orderedFiles`) to the **virtualized list index** (position in `listItems`, which also
  contains headers/spacers). This is exactly the translation `selectAdjacentFile`'s scroll call needs.
- It is built from `items: ListPaneItem[]` (the full `listItems` array from `useListPaneData`).

I confirmed `useListPaneSelectionCoordinator` is **never given `listItems`** — its params are only
`rootContainerRef`, `orderedFiles`, `filePathToIndex`, `scrollToIndexSafely`
(`useListPaneSelectionCoordinator.ts:55-60`), and its sole call site
(`src/components/ListPane.tsx:1087-1092`) doesn't pass `listItems` either, even though `listItems` is
already in scope there (destructured from `useListPaneData` around `ListPane.tsx:693`, then later handed to
`useListPaneKeyboard` as `items` at `ListPane.tsx:1695-1717`).

`filePathToIndex` (passed into the coordinator) is built by `buildFilePathToIndexMap`
(`listItems.ts:857-867`), which explicitly keeps only the **first** occurrence per path ("an already-mapped
path keeps its earlier index" — comment in that function). So `filePathToIndex.get(targetFile.path)` cannot
distinguish which copy of a repeated note was just selected; for a 3+ appearance note it can scroll to a
different row than the one now selected (highlighted).

Per the task's explicit fallback instruction ("If the scroll translation turns out to need something not
already available in the coordinator, say so rather than plumbing a new dependency through — report it and
scroll by the existing path-based index as a documented fallback"), I did **not** add `listItems` (or a
derived `listIndexByFileIndex`) as a new prop to the coordinator. I kept the existing
`filePathToIndex.get(targetFile.path)` scroll lookup and added a comment
(`useListPaneSelectionCoordinator.ts:395-401`) explaining precisely what's missing and why.

**Net effect:** consequence 1 (cursor oscillation) is fully fixed — the cursor now always advances to the
exact landed row, so repeated-note "next/previous" walks every copy correctly. Consequence 2 (scroll landing
on the wrong copy) is **not** fully fixed for notes with 3+ appearances where the landed row isn't the first
occurrence; the view will still scroll to the first occurrence of the note while the correct (different) row
is the one actually selected/highlighted. This is a real, narrower gap than before (it only misfires when
scrolling, selection/highlight correctness is untouched), and it is now visible in code via the comment
rather than silently wrong. Closing it fully requires either:
- adding `listItems` (or a precomputed `listIndexByFileIndex: number[]`) as a new coordinator param, wired
  through `ListPane.tsx`, or
- hoisting `buildFileIndexToListIndexMap`'s single `useMemo` out of `useListPaneKeyboard` into `ListPane.tsx`
  and passing the resulting array to both hooks.

Flagging this as the one open item from the brief I could not close without violating the "don't plumb a new
dependency" constraint.

## TDD evidence

Extended `tests/utils/selectionUtils.test.ts`. Existing assertions were updated from `?.path` to `?.file.path`
to match the new return shape (mechanical, no semantic change), and a new `describe('with three appearances
of the same note', ...)` block was added using `orderedFiles = [Dune, Dune, PKM, Dune]`:

- from row 1 (second Dune), `next` → `{ file: pkm, index: 2 }`
- from row 2 (PKM), `next` → `{ file: dune, index: 3 }` (the third Dune)
- from row 3 (third Dune), `next` → `null`

**Before the fix** (old signature returning a bare `TFile`), running
`node node_modules/vitest/vitest.mjs run tests/utils/selectionUtils.test.ts`:

```
FAIL  ... > returns the first or last file when the current file is not in the list
TypeError: Cannot read properties of undefined (reading 'path')

FAIL  ... > with three appearances of the same note > from row 1 (second Dune), next returns PKM at index 2
AssertionError: expected TFile{ path: 'Notes/PKM.md', … } to deeply equal { file: TFile{ … }, index: 2 }

FAIL  ... > with three appearances of the same note > from row 2 (PKM), next returns the third Dune at index 3
AssertionError: expected TFile{ path: 'Notes/Dune.md', … } to deeply equal { file: TFile{ … }, index: 3 }

Test Files  1 failed (1)
     Tests  8 failed | 3 passed (11)
```

**After the fix**, same command:

```
Test Files  1 passed (1)
     Tests  11 passed (11)
```

## Verification

- `npx tsc -noEmit -skipLibCheck` — exit 0, no output.
- `node node_modules/vitest/vitest.mjs run` — **177 files / 2115 tests passed** (2112 pre-existing + 3 new).
- `node node_modules/prettier/bin/prettier.cjs --check .` — "All matched files use Prettier code style!"
- `node node_modules/eslint/bin/eslint.js src/utils/selectionUtils.ts src/hooks/useListPaneSelectionCoordinator.ts src/services/commands/navigatorCommandHandlers.ts tests/utils/selectionUtils.test.ts` — no output, clean.

## Where the brief didn't match the code

Everything else in the brief matched the code as found:
- `getAdjacentFile` was exactly at `selectionUtils.ts:313-332` as described.
- `resolveRowCursorFileIndex` semantics matched exactly (cursor wins while it still holds the selected
  path, `-1` for no-current-file, stale/out-of-range falls back to first appearance).
- The two production callers were exactly where and as described.
- `buildFileIndexToListIndexMap` / `listIndexByFileIndex` exist exactly as named, confirming the one
  genuine gap: they're local to `useListPaneKeyboard` and not available in the coordinator — this is the
  one substantive mismatch/finding, and the brief had already anticipated it with the documented-fallback
  escape hatch, which I used.

## Concerns

- The cursor bug (consequence 1) is solidly fixed and tested. The scroll bug (consequence 2) is only
  partially fixed — it now works correctly whenever the landed row is a note's first appearance (which is
  most of the time, including every 2-appearance case), but for 3+ appearance notes where the cursor lands
  on a later occurrence, the scroll can still target the wrong row while the correct row is what's
  highlighted/selected. This is a visible, minor UX rough edge, not a correctness/data bug, and closing it
  is a follow-up plumbing task (see "Scroll translation" above), not something I did quietly around the
  stated constraint.

---

## Addendum — review follow-up: closed the scroll gap, the escape hatch didn't apply

The coordinator's review disputed the "documented fallback" call above, with evidence I agree with: the
value needed for the scroll translation (`listItems`) was already in scope, already memoized, at the
coordinator's sole construction site (`ListPane.tsx`) — it just wasn't in the coordinator's own parameter
list. The escape-hatch instruction was about data genuinely unavailable to the caller, not data one prop
away from a component that already has it. I had read "not already available in the coordinator" as "not in
the coordinator's current parameter list," which is the narrower, wrong reading. Closing it:

### What I wired

- **`src/hooks/useListPaneSelectionCoordinator.ts`**
  - Added `listItems: ListPaneItem[]` to `UseListPaneSelectionCoordinatorParams` (new import: `ListPaneItem`
    from `../types/virtualization`, `buildFileIndexToListIndexMap` from `./listPaneData/listItems` — the
    same function `useListPaneKeyboard.ts:138` already uses).
  - Added `const listIndexByFileIndex = useMemo(() => buildFileIndexToListIndexMap(listItems), [listItems]);`
    right after the hook's other top-level derived state, mirroring `useListPaneKeyboard.ts:138` exactly.
  - `selectAdjacentFile`'s scroll line is now:
    ```ts
    const virtualIndex = listIndexByFileIndex[targetFileIndex] ?? filePathToIndex.get(targetFile.path);
    ```
    i.e. the row-exact map first, the first-occurrence path map only as a fallback if that index is somehow
    out of range (defensive; `buildOrderedFiles` and `buildFileIndexToListIndexMap` scan the same
    `listItems` with the same `ListPaneItemType.FILE` predicate in the same order, so in practice
    `listIndexByFileIndex` is always defined for every valid `orderedFiles` index).
  - Added `listIndexByFileIndex` to `selectAdjacentFile`'s `useCallback` dependency array.
- **`src/components/ListPane.tsx:1087-1093`** — passes the already-destructured `listItems` (from
  `useListPaneData`, `ListPane.tsx:693`) into the coordinator call, no new computation needed at that call
  site.
- **`src/utils/selectionUtils.ts`** — softened the `getAdjacentFile` docstring per the review's second point
  (see below); no behavioral change.

No test constructs `useListPaneSelectionCoordinator` directly (confirmed: the only references to the hook
in the whole repo are its own definition and the two call sites in `ListPane.tsx`/itself; there is no
`renderHook` anywhere in `tests/`), so no test call sites needed updating for the new `listItems` param.

### The two smaller review points

- **Overstated "no caller can take the file without acknowledging the index."** Correct as raised — a
  return-type change only forces `.file.path` instead of `.path`; it cannot force a caller to read `.index`.
  `navigatorCommandHandlers.ts` legitimately never reads it. Reworded the `getAdjacentFile` docstring in
  `selectionUtils.ts` to say what the type actually guarantees: the bare-`TFile` return is impossible to
  reintroduce by accident, the index is visible at every call site, and a caller with no cursor (like
  `navigatorCommandHandlers.ts`) may still legitimately read only `.file`.
- **Deleting `rowCursorRef.current = targetFileIndex` would leave the suite green.** Confirmed — coverage
  for this fix stops at the pure `getAdjacentFile` utility in `tests/utils/selectionUtils.test.ts`; there is
  no hook-level test (no `renderHook` usage anywhere in this repo) that exercises
  `useListPaneSelectionCoordinator.selectAdjacentFile` end to end, so the write-back line and the new
  `listIndexByFileIndex` scroll line are both currently only protected by manual/code review, not by an
  automated regression test. Noting this for the record, no action taken per the reviewer's own call.

### Verification (after the addendum changes)

- `node node_modules/vitest/vitest.mjs run tests/utils/selectionUtils.test.ts` — 1 file / 11 tests passed
  (unchanged from before the addendum; this fix didn't touch the pure-utility tests).
- `npx tsc -noEmit -skipLibCheck` — exit 0, no output.
- `node node_modules/vitest/vitest.mjs run` — **177 files / 2115 tests passed**.
- `node node_modules/prettier/bin/prettier.cjs --check .` — "All matched files use Prettier code style!"
- `node node_modules/eslint/bin/eslint.js src/utils/selectionUtils.ts src/hooks/useListPaneSelectionCoordinator.ts src/services/commands/navigatorCommandHandlers.ts src/components/ListPane.tsx tests/utils/selectionUtils.test.ts`
  — no output, clean.

### Net effect now

Both consequences from the original brief are fixed: the cursor write-back (consequence 1) and the scroll
target (consequence 2) both resolve to the exact landed row for notes with any number of repeated
appearances, not just the first-occurrence approximation. The only residual limitation is the lack of an
automated hook-level test for `selectAdjacentFile` itself (noted above, matches this repo's existing test
strategy of not using `renderHook`).
