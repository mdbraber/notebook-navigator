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

import React from 'react';
import { App } from 'obsidian';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    services: {
        app: null as App | null,
        isMobile: false,
        plugin: {
            setSearchProvider: vi.fn()
        },
        propertyTreeService: null
    }
}));

vi.mock('../../src/context/SelectionContext', () => ({
    useSelectionState: () => ({
        selectionType: 'folder',
        selectedFolder: null,
        selectedTag: null,
        selectedProperty: null
    })
}));

vi.mock('../../src/context/ExpansionContext', () => ({
    useExpansionState: () => ({
        expandedFolders: new Set<string>(),
        expandedTags: new Set<string>(),
        expandedVirtualFolders: new Set<string>(),
        expandedProperties: new Set<string>()
    })
}));

vi.mock('../../src/context/ServicesContext', () => ({
    useServices: () => mocks.services
}));

vi.mock('../../src/context/SettingsContext', () => ({
    useSettingsState: () => ({
        paneTransitionDuration: 0,
        searchProvider: 'internal',
        skipAutoScroll: false,
        propertyHierarchyMaxDepth: 10
    })
}));

vi.mock('../../src/context/ShortcutsContext', () => ({
    useShortcuts: () => ({
        addSearchShortcut: vi.fn(),
        removeSearchShortcut: vi.fn(),
        searchShortcutsByName: new Map()
    })
}));

vi.mock('../../src/context/UIStateContext', () => ({
    useUIDispatch: () => vi.fn()
}));

vi.mock('../../src/context/UXPreferencesContext', () => ({
    useUXPreferences: () => ({ searchActive: true }),
    useUXPreferenceActions: () => ({ setSearchActive: vi.fn() })
}));

import { useListPaneSearch, type UseListPaneSearchResult } from '../../src/hooks/useListPaneSearch';

const FIDDLE_ID = 'key:projects=fiddle';
const TEST_ID = 'key:projects=test';

describe('useListPaneSearch shortcut execution', () => {
    beforeEach(() => {
        mocks.services.app = new App();
        // Executing a shortcut waits for frames before it settles the selection; the node environment
        // has no rendering loop, so one that runs the callback immediately stands in for it.
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            callback(0);
            return 0;
        });
        // The same run ends by looking for the list scroller to focus. Nothing in this environment can
        // be one, so a stand-in class is enough for that check to answer no.
        vi.stubGlobal('HTMLElement', class {});
    });

    it('reveals a saved search at the placement its start target recorded', async () => {
        const onRevealProperty = vi.fn(() => true);
        let captured: UseListPaneSearchResult | null = null;

        function Harness() {
            captured = useListPaneSearch({
                rootContainerRef: { current: null },
                onNavigateToFolder: vi.fn(),
                onRevealTag: vi.fn(),
                onRevealProperty,
                ensureSelectionForCurrentFilterRef: { current: null }
            });
            return null;
        }

        renderToStaticMarkup(React.createElement(Harness));

        const result = captured as UseListPaneSearchResult | null;
        if (!result) {
            throw new Error('Expected hook result');
        }

        await result.executeSearchShortcut({
            searchShortcut: {
                type: 'search',
                name: 'Fiddle work',
                query: '#work',
                provider: 'internal',
                startTarget: {
                    type: 'property',
                    nodeId: FIDDLE_ID,
                    placementChain: [TEST_ID, FIDDLE_ID]
                }
            }
        });

        expect(onRevealProperty).toHaveBeenCalledWith(FIDDLE_ID, expect.objectContaining({ placementChain: [TEST_ID, FIDDLE_ID] }));
    });
});
