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
import { DEFAULT_SETTINGS } from '../../src/settings/defaultSettings';
import { migrateLegacySyncedSettings } from '../../src/settings/migrations/syncedSettings';
import { isPropertyNoteOpenLocation, type NotebookNavigatorSettings } from '../../src/settings/types';
import { STORAGE_KEYS } from '../../src/types';

// Wraps migrateLegacySyncedSettings, which mutates its `settings` argument in place, so tests can
// pass a plain stored-data object and read the migrated result back out.
function runMigration(stored: Record<string, unknown>): Record<string, unknown> {
    const settings = stored as unknown as NotebookNavigatorSettings;
    migrateLegacySyncedSettings({
        settings,
        storedData: null,
        keys: STORAGE_KEYS,
        defaultSettings: DEFAULT_SETTINGS
    });
    return settings as unknown as Record<string, unknown>;
}

describe('property note settings', () => {
    it('defaults the feature off and links on', () => {
        expect(DEFAULT_SETTINGS.enablePropertyNotes).toBe(false);
        expect(DEFAULT_SETTINGS.enablePropertyNoteLinks).toBe(true);
    });

    it('defaults the open location to the current tab', () => {
        expect(DEFAULT_SETTINGS.propertyNoteOpenLocation).toBe('current-tab');
    });

    it('accepts the three valid open locations', () => {
        expect(isPropertyNoteOpenLocation('current-tab')).toBe(true);
        expect(isPropertyNoteOpenLocation('new-tab')).toBe(true);
        expect(isPropertyNoteOpenLocation('right-sidebar')).toBe(true);
    });

    it('rejects anything else', () => {
        expect(isPropertyNoteOpenLocation('left-sidebar')).toBe(false);
        expect(isPropertyNoteOpenLocation(null)).toBe(false);
    });
});

describe('property note creation settings', () => {
    it('defaults auto-open off and the folder empty', () => {
        expect(DEFAULT_SETTINGS.autoOpenPropertyNote).toBe(false);
        expect(DEFAULT_SETTINGS.propertyNoteFolder).toBe('');
    });

    it('keeps a stored autoOpenPropertyNote instead of deleting it', () => {
        // migrateLegacySyncedSettings runs on EVERY settings load, not once. A leftover
        // delete for this key would wipe the reinstated setting at every plugin start.
        const stored: Record<string, unknown> = { ...DEFAULT_SETTINGS, autoOpenPropertyNote: true };
        const migrated = runMigration(stored);
        expect(migrated.autoOpenPropertyNote).toBe(true);
    });
});
