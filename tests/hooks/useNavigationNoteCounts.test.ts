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
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_SETTINGS } from '../../src/settings/defaultSettings';
import { NavigationPaneItemType } from '../../src/types';
import type { PropertyTreeNode } from '../../src/types/storage';
import type { NavigationNoteCounts } from '../../src/hooks/navigationPane/data/useNavigationNoteCounts';
import { useNavigationNoteCounts } from '../../src/hooks/navigationPane/data/useNavigationNoteCounts';
import { buildPropertyValueNodeId } from '../../src/utils/propertyTree';
import { EMPTY_PROPERTY_HIERARCHY_INDEX, type PropertyHierarchyIndex } from '../../src/utils/propertyHierarchy';

function createPropertyValueNode(key: string, valuePath: string, name: string, notes: string[]): PropertyTreeNode {
    return {
        id: buildPropertyValueNodeId(key, valuePath),
        kind: 'value',
        key,
        valuePath,
        name,
        displayPath: name,
        children: new Map(),
        notesWithValue: new Set(notes)
    };
}

function captureNoteCounts(params: { valueNode: PropertyTreeNode; propertyHierarchyIndex: PropertyHierarchyIndex }): NavigationNoteCounts {
    const app = new App();
    let captured: NavigationNoteCounts | null = null;

    function Harness() {
        captured = useNavigationNoteCounts({
            app,
            isVisible: true,
            settings: {
                ...DEFAULT_SETTINGS,
                showNoteCount: true
            },
            propertiesSectionActive: true,
            itemsWithMetadata: [
                {
                    type: NavigationPaneItemType.PROPERTY_VALUE,
                    data: params.valueNode,
                    level: 1,
                    key: params.valueNode.id
                }
            ],
            includeDescendantNotes: true,
            visibleTaggedCount: 0,
            untaggedCount: 0,
            propertyCollectionCount: undefined,
            propertyHierarchyIndex: params.propertyHierarchyIndex,
            effectiveFrontmatterExclusions: [],
            hiddenFolders: [],
            descendantExcludedFolders: [],
            hiddenFileTags: [],
            showHiddenItems: false,
            folderCountFileNameMatcher: null,
            fileVisibility: DEFAULT_SETTINGS.vaultProfiles[0].fileVisibility,
            folderChangeVersion: 0,
            vaultChangeVersion: 0,
            metadataVisibilityVersion: 0,
            tagDataVersion: 0
        });
        return null;
    }

    renderToStaticMarkup(React.createElement(Harness));

    expect(captured).not.toBeNull();
    if (!captured) {
        throw new Error('Expected hook result');
    }
    return captured;
}

describe('useNavigationNoteCounts', () => {
    it('falls back to the value node own note count when its key is not hierarchical', () => {
        const valueNode = createPropertyValueNode('status', 'open', 'Open', ['notes/a.md']);

        const result = captureNoteCounts({ valueNode, propertyHierarchyIndex: EMPTY_PROPERTY_HIERARCHY_INDEX });

        expect(result.propertyCounts.get(valueNode.id)).toEqual({ current: 1, descendants: 0, total: 1 });
    });

    it('uses the hierarchy index subtree count for a hierarchical property value', () => {
        const valueNode = createPropertyValueNode('projects', 'fiddle', 'Fiddle', ['notes/a.md']);
        const propertyHierarchyIndex: PropertyHierarchyIndex = {
            ...EMPTY_PROPERTY_HIERARCHY_INDEX,
            subtreeCount: new Map([[valueNode.id, 3]])
        };

        const result = captureNoteCounts({ valueNode, propertyHierarchyIndex });

        expect(result.propertyCounts.get(valueNode.id)).toEqual({ current: 1, descendants: 2, total: 3 });
    });
});
