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

    it('keeps the original three prefixes when perValue is false', () => {
        expect(createPropertyGroupingOption('topics', 'asc', false)).toBe('property:topics');
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

    it('correctly parses the three per-value forms (property-each, property-each-desc, property-each-follow)', () => {
        expect(getPropertyGroupingKey('property-each:topics')).toBe('topics');
        expect(getPropertyGroupingPerValue('property-each:topics')).toBe(true);
        expect(getPropertyGroupingOrder('property-each:topics')).toBe('asc');

        expect(getPropertyGroupingKey('property-each-desc:topics')).toBe('topics');
        expect(getPropertyGroupingPerValue('property-each-desc:topics')).toBe(true);
        expect(getPropertyGroupingOrder('property-each-desc:topics')).toBe('desc');

        expect(getPropertyGroupingKey('property-each-follow:topics')).toBe('topics');
        expect(getPropertyGroupingPerValue('property-each-follow:topics')).toBe(true);
        expect(getPropertyGroupingOrder('property-each-follow:topics')).toBe('follow');
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
