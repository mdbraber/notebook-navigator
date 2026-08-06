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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPropertyMenu } from '../../src/utils/contextMenu/propertyMenuBuilder';
import { INTERNAL_NOTEBOOK_NAVIGATOR_API } from '../../src/api/NotebookNavigatorAPI';
import { DEFAULT_SETTINGS } from '../../src/settings/defaultSettings';
import { buildPropertyKeyNodeId, buildPropertyValueNodeId } from '../../src/utils/propertyTree';
import type { PropertyTreeNode } from '../../src/types/storage';
import { strings } from '../../src/i18n';

vi.mock('../../src/utils/propertyNotes', () => ({
    createPropertyNote: vi.fn(async () => null)
}));

import { createPropertyNote } from '../../src/utils/propertyNotes';

const VALUE_NODE_ID = buildPropertyValueNodeId('references', 'ipad');
const KEY_NODE_ID = buildPropertyKeyNodeId('references');

interface RecordedItem {
    title?: string;
    handler?: () => void | Promise<void>;
}

// Records each menu item's title and click handler so a specific item can be invoked.
function createMenu() {
    const items: RecordedItem[] = [];
    const menu = {
        addItem: (configure: (item: unknown) => void) => {
            const recorded: RecordedItem = {};
            const item: Record<string, unknown> = {};
            Object.assign(item, {
                setTitle: (title: string) => {
                    recorded.title = title;
                    return item;
                },
                setIcon: () => item,
                setIsLabel: () => item,
                setDisabled: () => item,
                setChecked: () => item,
                setSection: () => item,
                onClick: (handler: () => void | Promise<void>) => {
                    recorded.handler = handler;
                    return item;
                }
            });
            items.push(recorded);
            configure(item);
            return menu;
        },
        addSeparator: () => menu
    };
    return { menu, items };
}

function createValueNode(): PropertyTreeNode {
    return {
        id: VALUE_NODE_ID,
        kind: 'value',
        key: 'references',
        valuePath: 'ipad',
        name: 'iPad',
        displayPath: 'iPad',
        // A strict wikilink whose target does not exist, which is what makes the note creatable.
        assignmentValue: '[[iPad]]',
        children: new Map(),
        notesWithValue: new Set(['Tooling.md'])
    };
}

function createKeyNode(): PropertyTreeNode {
    return {
        id: KEY_NODE_ID,
        kind: 'key',
        key: 'references',
        valuePath: null,
        name: 'references',
        displayPath: 'references',
        children: new Map(),
        notesWithValue: new Set()
    };
}

function buildMenuForCreatableValue() {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.enablePropertyNotes = true;
    settings.showPropertyIcons = false;

    const selectionDispatch = vi.fn();
    const valueNode = createValueNode();

    const { menu, items } = createMenu();

    buildPropertyMenu({
        propertyNodeId: VALUE_NODE_ID,
        menu: menu as never,
        settings,
        state: {
            // The user right-clicked the references=ipad row while a different value was selected.
            selectionState: {
                selectionType: 'property',
                selectedTag: null,
                selectedProperty: buildPropertyValueNodeId('categories', 'companies'),
                selectedFile: null
            },
            expandedFolders: new Set<string>(),
            expandedTags: new Set<string>(),
            expandedProperties: new Set<string>()
        } as never,
        dispatchers: {
            selectionDispatch,
            expansionDispatch: vi.fn(),
            uiDispatch: vi.fn()
        },
        services: {
            app: {
                workspace: { getActiveFile: () => null, requestSaveLayout: vi.fn() },
                // The link target does not resolve, so the value has no property note yet.
                metadataCache: { getFirstLinkpathDest: () => null }
            } as never,
            plugin: {
                api: {
                    [INTERNAL_NOTEBOOK_NAVIGATOR_API]: {
                        menus: { applyPropertyMenuExtensions: vi.fn(() => 0) }
                    }
                }
            } as never,
            isMobile: false,
            fileSystemOps: {} as never,
            metadataService: {
                getPropertyColor: vi.fn(() => undefined),
                getPropertyBackgroundColor: vi.fn(() => undefined),
                getPropertyIcon: vi.fn(() => undefined),
                getPropertyColorData: vi.fn(() => ({ color: undefined, background: undefined })),
                getSettingsProvider: vi.fn(() => null),
                hasNavigationSeparator: vi.fn(() => false)
            } as never,
            propertyOperations: {} as never,
            tagOperations: {} as never,
            tagTreeService: null,
            propertyTreeService: {
                findNode: (nodeId: string) => (nodeId === VALUE_NODE_ID ? valueNode : null),
                getKeyNode: () => createKeyNode()
            } as never,
            commandQueue: null,
            shortcuts: null,
            visibility: { includeDescendantNotes: false, showHiddenItems: false }
        }
    });

    const createItem = items.find(item => item.title === strings.contextMenu.property.createPropertyNote);
    return { createItem, selectionDispatch };
}

describe('create property note selects the value it was invoked on', () => {
    beforeEach(() => {
        vi.mocked(createPropertyNote).mockClear();
    });

    it('offers the action for a wikilink value whose target does not exist', () => {
        const { createItem } = buildMenuForCreatableValue();
        expect(createItem).toBeDefined();
        expect(createItem?.handler).toBeTypeOf('function');
    });

    it('selects the right-clicked value before creating the note', async () => {
        // Regression: creating a property note revealed the newly created file, and because its
        // metadata is not indexed yet the reveal falls back to the *current* selection. With a
        // different value still selected, the navigation pane jumped to that unrelated value
        // instead of the one the note was created for.
        const { createItem, selectionDispatch } = buildMenuForCreatableValue();

        void createItem?.handler?.();
        await Promise.resolve();

        expect(selectionDispatch).toHaveBeenCalledWith({
            type: 'SET_SELECTED_PROPERTY',
            nodeId: VALUE_NODE_ID
        });
    });

    it('selects the value before the note is created, not after', async () => {
        const { createItem, selectionDispatch } = buildMenuForCreatableValue();

        void createItem?.handler?.();
        await Promise.resolve();

        expect(createPropertyNote).toHaveBeenCalledTimes(1);
        expect(selectionDispatch.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(createPropertyNote).mock.invocationCallOrder[0]);
    });
});
