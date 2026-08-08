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
import { describe, expect, it, vi } from 'vitest';
import type { Virtualizer } from '@tanstack/react-virtual';
import type { ExpansionAction } from '../../src/context/ExpansionContext';
import type { SelectionAction } from '../../src/context/SelectionContext';
import { DEFAULT_SETTINGS } from '../../src/settings/defaultSettings';
import { ItemType, NavigationPaneItemType } from '../../src/types';
import type { CombinedNavigationItem } from '../../src/types/virtualization';
import type { PropertyTreeNode } from '../../src/types/storage';
import { useNavigationPaneKeyboard } from '../../src/hooks/useNavigationPaneKeyboard';
import type { KeyboardNavigationHelpers } from '../../src/hooks/useKeyboardNavigation';
import { buildNavigationPathIndexMap } from '../../src/utils/navigationIndex';
import { buildPropertyKeyNodeId, buildPropertyValueNodeId } from '../../src/utils/propertyTree';
import { buildPropertyPlacementKey } from '../../src/utils/treeFlattener';
import { EMPTY_PROPERTY_HIERARCHY_INDEX } from '../../src/utils/propertyHierarchy';

/**
 * useNavigationPaneKeyboard reads app/settings/expansion/selection state through context hooks, and
 * wires its handler into useKeyboardNavigation, which attaches a real DOM keydown listener via
 * useEffect. This repo has no jsdom, testing-library or react-test-renderer, so that listener cannot be
 * driven directly. useKeyboardNavigation itself does nothing but capture the caller's onKeyDown and
 * attach it: mocking the module captures that closure, and calling it with a synthetic event plus a
 * hand-built helpers object exercises the exact same code the listener would have called, without any
 * DOM in the loop.
 */
const hoisted = vi.hoisted(() => ({
    capturedOnKeyDown: null as ((event: KeyboardEvent, helpers: unknown) => void) | null,
    selectionDispatch: vi.fn<(action: SelectionAction) => void>(),
    selectedProperty: null as string | null
}));

vi.mock('../../src/hooks/useKeyboardNavigation', async importOriginal => {
    const actual = await importOriginal<typeof import('../../src/hooks/useKeyboardNavigation')>();
    return {
        ...actual,
        useKeyboardNavigation: (params: { onKeyDown: (event: KeyboardEvent, helpers: unknown) => void }) => {
            hoisted.capturedOnKeyDown = params.onKeyDown;
        }
    };
});

vi.mock('../../src/context/ExpansionContext', () => ({
    useExpansionState: () => ({
        expandedFolders: new Set<string>(),
        expandedTags: new Set<string>(),
        expandedProperties: new Set<string>(),
        expandedVirtualFolders: new Set<string>()
    }),
    useExpansionDispatch: () => vi.fn<(action: ExpansionAction) => void>()
}));

vi.mock('../../src/context/SelectionContext', () => ({
    useSelectionState: () => ({
        selectionType: ItemType.PROPERTY,
        selectedFolder: null,
        selectedTag: null,
        selectedProperty: hoisted.selectedProperty
    }),
    useSelectionDispatch: () => hoisted.selectionDispatch
}));

vi.mock('../../src/context/ServicesContext', () => ({
    useServices: () => ({ app: new App(), commandQueue: null, plugin: {}, propertyTreeService: null }),
    useFileSystemOps: () => null
}));

vi.mock('../../src/context/SettingsContext', () => ({
    useSettingsState: () => ({ ...DEFAULT_SETTINGS })
}));

vi.mock('../../src/context/UXPreferencesContext', () => ({
    useUXPreferences: () => ({ showHiddenItems: false, includeDescendantNotes: true })
}));

vi.mock('../../src/context/UIStateContext', () => ({
    useUIState: () => ({ singlePane: false }),
    useUIDispatch: () => vi.fn()
}));

const PROJECTS_KEY_NODE_ID = buildPropertyKeyNodeId('projects');
const valueNodeId = (value: string) => buildPropertyValueNodeId('projects', value.toLowerCase());

function createPropertyKeyNode(children: PropertyTreeNode[]): PropertyTreeNode {
    const node: PropertyTreeNode = {
        id: PROJECTS_KEY_NODE_ID,
        kind: 'key',
        key: 'projects',
        valuePath: null,
        name: 'projects',
        displayPath: 'projects',
        children: new Map(),
        notesWithValue: new Set()
    };
    children.forEach(child => node.children.set(child.id, child));
    return node;
}

function createPropertyValueNode(value: string): PropertyTreeNode {
    return {
        id: valueNodeId(value),
        kind: 'value',
        key: 'projects',
        valuePath: value.toLowerCase(),
        name: value,
        displayPath: value,
        children: new Map(),
        notesWithValue: new Set()
    };
}

/**
 * Work > Clients: a depth-2 placement rendered under the root Work placement. Same vault shape the
 * design doc's vault verification used (Work > Clients under the "projects" key).
 */
function createNestedPlacementFixture(): {
    items: CombinedNavigationItem[];
    keyNode: PropertyTreeNode;
    workNode: PropertyTreeNode;
    clientsNode: PropertyTreeNode;
    clientsUnderWork: string;
} {
    const workNode = createPropertyValueNode('Work');
    const clientsNode = createPropertyValueNode('Clients');
    const keyNode = createPropertyKeyNode([workNode, clientsNode]);
    const clientsUnderWork = buildPropertyPlacementKey([workNode.id, clientsNode.id]);

    const items: CombinedNavigationItem[] = [
        { type: NavigationPaneItemType.PROPERTY_KEY, data: keyNode, level: 0, key: keyNode.id },
        { type: NavigationPaneItemType.PROPERTY_VALUE, data: workNode, level: 1, key: workNode.id },
        { type: NavigationPaneItemType.PROPERTY_VALUE, data: clientsNode, level: 2, key: clientsUnderWork }
    ];

    return { items, keyNode, workNode, clientsNode, clientsUnderWork };
}

function createHelpers(items: CombinedNavigationItem[]): KeyboardNavigationHelpers<CombinedNavigationItem> {
    return {
        findNextIndex: () => -1,
        findPreviousIndex: () => -1,
        getPageSize: () => 10,
        scrollToIndex: vi.fn(),
        getItemAt: (index: number) => items[index],
        isRTL: () => false
    };
}

function createLeftArrowEvent(): KeyboardEvent {
    return {
        key: 'ArrowLeft',
        altKey: false,
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        preventDefault: vi.fn()
    } as unknown as KeyboardEvent;
}

/**
 * Renders the real hook so handleKeyDown closes over the given items/pathToIndex, then returns the
 * captured onKeyDown so a test can drive it directly, per the harness comment above.
 */
function renderAndCaptureOnKeyDown(
    items: CombinedNavigationItem[]
): (event: KeyboardEvent, helpers: KeyboardNavigationHelpers<CombinedNavigationItem>) => void {
    hoisted.capturedOnKeyDown = null;
    const pathToIndex = buildNavigationPathIndexMap(items);

    function Harness() {
        useNavigationPaneKeyboard({
            items,
            virtualizer: { scrollToIndex: vi.fn() } as unknown as Virtualizer<HTMLDivElement, Element>,
            containerRef: { current: null },
            pathToIndex,
            propertyHierarchyIndex: EMPTY_PROPERTY_HIERARCHY_INDEX
        });
        return null;
    }

    renderToStaticMarkup(React.createElement(Harness));

    if (!hoisted.capturedOnKeyDown) {
        throw new Error('Expected useKeyboardNavigation to receive an onKeyDown handler');
    }
    return hoisted.capturedOnKeyDown;
}

describe('useNavigationPaneKeyboard left-arrow glue', () => {
    it('selects the parent placement, not the key row, from a depth-2 placement', () => {
        const { items, workNode, clientsNode, clientsUnderWork } = createNestedPlacementFixture();
        // Selection is a node id end to end; the nested Clients placement is the only row that node id
        // names, so it resolves to index 2 (see navigationIndex.ts's fallback pass).
        hoisted.selectedProperty = clientsNode.id;
        hoisted.selectionDispatch.mockClear();

        const onKeyDown = renderAndCaptureOnKeyDown(items);
        const helpers = createHelpers(items);

        onKeyDown(createLeftArrowEvent(), helpers);

        // Sanity check the fixture actually pins a depth-2 row, not a root one.
        expect(clientsUnderWork).not.toBe(clientsNode.id);
        expect(hoisted.selectionDispatch).toHaveBeenCalledWith({ type: 'SET_SELECTED_PROPERTY', nodeId: workNode.id });
    });

    it('still selects the key row from a root placement, the flat-value behaviour that must not regress', () => {
        const { items, keyNode, workNode } = createNestedPlacementFixture();
        // A root placement's chain is just its own node id, so selection by node id is unambiguous here.
        hoisted.selectedProperty = workNode.id;
        hoisted.selectionDispatch.mockClear();

        const onKeyDown = renderAndCaptureOnKeyDown(items);
        const helpers = createHelpers(items);

        onKeyDown(createLeftArrowEvent(), helpers);

        expect(hoisted.selectionDispatch).toHaveBeenCalledWith({ type: 'SET_SELECTED_PROPERTY', nodeId: keyNode.id });
    });
});
