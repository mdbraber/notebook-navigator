/*
 * Notebook Navigator - Plugin for Obsidian
 * Copyright (c) 2025-2026 Johan Sanneblad
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { describe, expect, it } from 'vitest';
import { getAdjacentFile, orderFilesByReference, resolveAdjacentFileSelection } from '../../src/utils/selectionUtils';
import { createTestTFile } from './createTestTFile';

describe('getAdjacentFile', () => {
    // Per-value property grouping renders a note once per value it carries, so the same path can hold
    // several rows. Resolving the current file by first occurrence made "next note" target the note's own
    // second row whenever two appearances were adjacent, so the command could never leave the note.
    const dune = createTestTFile('Notes/Dune.md');
    const pkm = createTestTFile('Notes/PKM.md');
    const repeatedFiles = [dune, dune, pkm];
    const missingFile = createTestTFile('Notes/Missing.md');

    it('advances from the row the cursor sits on rather than the first appearance', () => {
        expect(getAdjacentFile(repeatedFiles, dune, 'next', 1)?.file.path).toBe(pkm.path);
    });

    it('advances to the second appearance when the cursor sits on the first', () => {
        expect(getAdjacentFile(repeatedFiles, dune, 'next', 0)?.file.path).toBe(dune.path);
    });

    it('steps back from the row the cursor sits on', () => {
        expect(getAdjacentFile(repeatedFiles, dune, 'previous', 1)?.file.path).toBe(dune.path);
        expect(getAdjacentFile(repeatedFiles, dune, 'previous', 0)).toBeNull();
        expect(getAdjacentFile(repeatedFiles, pkm, 'previous', 2)?.file.path).toBe(dune.path);
    });

    it('falls back to the first appearance when the cursor is stale, cleared or out of range', () => {
        // A cursor row holding a different path, or no row at all, must behave exactly as before.
        expect(getAdjacentFile(repeatedFiles, dune, 'next', 2)?.file.path).toBe(dune.path);
        expect(getAdjacentFile(repeatedFiles, dune, 'next', null)?.file.path).toBe(dune.path);
        expect(getAdjacentFile(repeatedFiles, dune, 'next', 99)?.file.path).toBe(dune.path);
    });

    it('returns the first or last file when there is no current file', () => {
        expect(getAdjacentFile(repeatedFiles, null, 'next', null)?.file.path).toBe(dune.path);
        expect(getAdjacentFile(repeatedFiles, null, 'previous', null)?.file.path).toBe(pkm.path);
        // A stored row is irrelevant without a current file to anchor it.
        expect(getAdjacentFile(repeatedFiles, null, 'next', 1)?.file.path).toBe(dune.path);
    });

    it('returns the first or last file when the current file is not in the list', () => {
        expect(getAdjacentFile(repeatedFiles, missingFile, 'next', 1)?.file.path).toBe(dune.path);
        expect(getAdjacentFile(repeatedFiles, missingFile, 'previous', 1)?.file.path).toBe(pkm.path);
    });

    it('returns null past either end of the list and for an empty list', () => {
        expect(getAdjacentFile(repeatedFiles, pkm, 'next', 2)).toBeNull();
        expect(getAdjacentFile([], dune, 'next', null)).toBeNull();
        expect(getAdjacentFile([], null, 'previous', null)).toBeNull();
    });

    describe('with three appearances of the same note', () => {
        // orderedFiles = [Dune, Dune, PKM, Dune]. A cursor on any one row must walk to the very next row,
        // not bounce back to Dune's first appearance, and the returned index must name that exact row —
        // that is the point of returning { file, index } instead of just a TFile.
        const threeAppearanceFiles = [dune, dune, pkm, dune];

        it('from row 1 (second Dune), next returns PKM at index 2', () => {
            const result = getAdjacentFile(threeAppearanceFiles, dune, 'next', 1);
            expect(result).toEqual({ file: pkm, index: 2 });
        });

        it('from row 2 (PKM), next returns the third Dune at index 3', () => {
            const result = getAdjacentFile(threeAppearanceFiles, pkm, 'next', 2);
            expect(result).toEqual({ file: dune, index: 3 });
        });

        it('from row 3 (third Dune), next returns null (end of list)', () => {
            const result = getAdjacentFile(threeAppearanceFiles, dune, 'next', 3);
            expect(result).toBeNull();
        });
    });
});

describe('resolveAdjacentFileSelection', () => {
    // The list-pane applier (selectAdjacentFile) does three things with getAdjacentFile's result: select
    // the file, write the landed row back as the cursor, and scroll to the landed row's virtualized index.
    // This suite tests the decision behind the last two, which code review alone was protecting before.
    //
    // orderedFiles = [Dune, Dune, PKM, Dune], the same repeated-note fixture used above.
    const dune = createTestTFile('Notes/Dune.md');
    const pkm = createTestTFile('Notes/PKM.md');
    const files = [dune, dune, pkm, dune];

    // listIndexByFileIndex mimics the real hook: it is index-aligned with `files` but holds the
    // *virtualized* row for each position, which is offset from the files[] position itself because
    // header/spacer rows precede the files in the real list. filePathToIndex mimics buildFilePathToIndexMap:
    // it only ever remembers a path's first appearance. The two are deliberately different at every row
    // that matters below (row 3, Dune's third appearance) so a test that read from the wrong source would
    // fail rather than pass by coincidence.
    const listIndexByFileIndex = [10, 20, 30, 40];
    const filePathToIndex = new Map([
        [dune.path, 10], // Dune's first appearance (row 0)
        [pkm.path, 30]
    ]);

    it('from row 1 (second Dune), next returns PKM with rowCursor 2', () => {
        const result = resolveAdjacentFileSelection({
            files,
            currentFile: dune,
            direction: 'next',
            rowCursor: 1,
            listIndexByFileIndex,
            filePathToIndex
        });
        expect(result).toEqual({ file: pkm, rowCursor: 2, scrollIndex: 30 });
    });

    it('from row 2 (PKM), next returns the third Dune with rowCursor 3', () => {
        const result = resolveAdjacentFileSelection({
            files,
            currentFile: pkm,
            direction: 'next',
            rowCursor: 2,
            listIndexByFileIndex,
            filePathToIndex
        });
        expect(result).toEqual({ file: dune, rowCursor: 3, scrollIndex: 40 });
    });

    it('from row 3 (third Dune), next returns null', () => {
        const result = resolveAdjacentFileSelection({
            files,
            currentFile: dune,
            direction: 'next',
            rowCursor: 3,
            listIndexByFileIndex,
            filePathToIndex
        });
        expect(result).toBeNull();
    });

    it('returns the landed row as rowCursor, not the incoming cursor — guards the cursor write-back', () => {
        const result = resolveAdjacentFileSelection({
            files,
            currentFile: dune,
            direction: 'next',
            rowCursor: 1,
            listIndexByFileIndex,
            filePathToIndex
        });
        expect(result?.rowCursor).toBe(2);
        expect(result?.rowCursor).not.toBe(1);
    });

    it('reads scrollIndex from listIndexByFileIndex at the landed row, not from filePathToIndex — guards the scroll choice', () => {
        const result = resolveAdjacentFileSelection({
            files,
            currentFile: pkm,
            direction: 'next',
            rowCursor: 2,
            listIndexByFileIndex,
            filePathToIndex
        });
        // Landed on the third Dune (row 3). filePathToIndex only knows Dune's first appearance (row 0,
        // virtual index 10); listIndexByFileIndex knows the row actually landed on (virtual index 40).
        // The two must disagree here, or this assertion would pass even if the scroll choice read from
        // the wrong source.
        expect(filePathToIndex.get(dune.path)).toBe(10);
        expect(result?.scrollIndex).toBe(40);
        expect(result?.scrollIndex).not.toBe(filePathToIndex.get(dune.path));
    });

    it('falls back to filePathToIndex when listIndexByFileIndex has no entry for the landed row', () => {
        const shortListIndex = [10, 20]; // no entry for row 2 (PKM)
        const result = resolveAdjacentFileSelection({
            files,
            currentFile: dune,
            direction: 'next',
            rowCursor: 1,
            listIndexByFileIndex: shortListIndex,
            filePathToIndex
        });
        expect(result).toEqual({ file: pkm, rowCursor: 2, scrollIndex: 30 });
    });

    it('leaves scrollIndex undefined, meaning the caller should not scroll, when neither source has an entry', () => {
        const result = resolveAdjacentFileSelection({
            files,
            currentFile: dune,
            direction: 'next',
            rowCursor: 1,
            listIndexByFileIndex: [],
            filePathToIndex: new Map()
        });
        expect(result).toEqual({ file: pkm, rowCursor: 2, scrollIndex: undefined });
    });

    it('falls back to the first appearance when the cursor is stale, cleared or out of range', () => {
        // Row 2 holds PKM, not Dune: a stale cursor must not be trusted.
        expect(
            resolveAdjacentFileSelection({
                files,
                currentFile: dune,
                direction: 'next',
                rowCursor: 2,
                listIndexByFileIndex,
                filePathToIndex
            })?.file.path
        ).toBe(dune.path);
        expect(
            resolveAdjacentFileSelection({
                files,
                currentFile: dune,
                direction: 'next',
                rowCursor: null,
                listIndexByFileIndex,
                filePathToIndex
            })?.file.path
        ).toBe(dune.path);
        expect(
            resolveAdjacentFileSelection({
                files,
                currentFile: dune,
                direction: 'next',
                rowCursor: 99,
                listIndexByFileIndex,
                filePathToIndex
            })?.file.path
        ).toBe(dune.path);
    });

    it('returns the first or last file when there is no current file', () => {
        expect(
            resolveAdjacentFileSelection({
                files,
                currentFile: null,
                direction: 'next',
                rowCursor: null,
                listIndexByFileIndex,
                filePathToIndex
            })?.file.path
        ).toBe(dune.path);
        expect(
            resolveAdjacentFileSelection({
                files,
                currentFile: null,
                direction: 'previous',
                rowCursor: null,
                listIndexByFileIndex,
                filePathToIndex
            })?.file.path
        ).toBe(dune.path); // last file in [Dune, Dune, PKM, Dune] is Dune
    });

    it('returns null past either end of the list, and for an empty list', () => {
        expect(
            resolveAdjacentFileSelection({
                files,
                currentFile: dune,
                direction: 'next',
                rowCursor: 3,
                listIndexByFileIndex,
                filePathToIndex
            })
        ).toBeNull();
        expect(
            resolveAdjacentFileSelection({
                files: [],
                currentFile: dune,
                direction: 'next',
                rowCursor: null,
                listIndexByFileIndex: [],
                filePathToIndex: new Map()
            })
        ).toBeNull();
    });
});

describe('orderFilesByReference', () => {
    it('orders files by a reference list and appends missing files in original order', () => {
        const first = createTestTFile('Notes/First.md');
        const second = createTestTFile('Notes/Second.md');
        const third = createTestTFile('Notes/Third.md');
        const outsideReference = createTestTFile('Notes/Outside.md');

        const ordered = orderFilesByReference([third, first, second], [outsideReference, second, first]);

        expect(ordered.map(file => file.path)).toEqual([second.path, first.path, third.path]);
    });
});
