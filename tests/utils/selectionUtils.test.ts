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
import { getAdjacentFile, orderFilesByReference } from '../../src/utils/selectionUtils';
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
        expect(getAdjacentFile(repeatedFiles, dune, 'next', 1)?.path).toBe(pkm.path);
    });

    it('advances to the second appearance when the cursor sits on the first', () => {
        expect(getAdjacentFile(repeatedFiles, dune, 'next', 0)?.path).toBe(dune.path);
    });

    it('steps back from the row the cursor sits on', () => {
        expect(getAdjacentFile(repeatedFiles, dune, 'previous', 1)?.path).toBe(dune.path);
        expect(getAdjacentFile(repeatedFiles, dune, 'previous', 0)).toBeNull();
        expect(getAdjacentFile(repeatedFiles, pkm, 'previous', 2)?.path).toBe(dune.path);
    });

    it('falls back to the first appearance when the cursor is stale, cleared or out of range', () => {
        // A cursor row holding a different path, or no row at all, must behave exactly as before.
        expect(getAdjacentFile(repeatedFiles, dune, 'next', 2)?.path).toBe(dune.path);
        expect(getAdjacentFile(repeatedFiles, dune, 'next', null)?.path).toBe(dune.path);
        expect(getAdjacentFile(repeatedFiles, dune, 'next', 99)?.path).toBe(dune.path);
    });

    it('returns the first or last file when there is no current file', () => {
        expect(getAdjacentFile(repeatedFiles, null, 'next', null)?.path).toBe(dune.path);
        expect(getAdjacentFile(repeatedFiles, null, 'previous', null)?.path).toBe(pkm.path);
        // A stored row is irrelevant without a current file to anchor it.
        expect(getAdjacentFile(repeatedFiles, null, 'next', 1)?.path).toBe(dune.path);
    });

    it('returns the first or last file when the current file is not in the list', () => {
        expect(getAdjacentFile(repeatedFiles, missingFile, 'next', 1)?.path).toBe(dune.path);
        expect(getAdjacentFile(repeatedFiles, missingFile, 'previous', 1)?.path).toBe(pkm.path);
    });

    it('returns null past either end of the list and for an empty list', () => {
        expect(getAdjacentFile(repeatedFiles, pkm, 'next', 2)).toBeNull();
        expect(getAdjacentFile([], dune, 'next', null)).toBeNull();
        expect(getAdjacentFile([], null, 'previous', null)).toBeNull();
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
