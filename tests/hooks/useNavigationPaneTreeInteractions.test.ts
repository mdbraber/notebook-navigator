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
import { App, TFile, TFolder } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_SETTINGS } from '../../src/settings/defaultSettings';
import { ItemType } from '../../src/types';
import type { IPropertyTreeProvider } from '../../src/interfaces/IPropertyTreeProvider';
import type { PropertyTreeNode } from '../../src/types/storage';
import type { SelectionState } from '../../src/context/SelectionContext';
import {
    useNavigationPaneTreeInteractions,
    type NavigationPaneTreeInteractionsResult
} from '../../src/hooks/navigationPane/useNavigationPaneTreeInteractions';
import { buildPropertyKeyNodeId, buildPropertyValueNodeId } from '../../src/utils/propertyTree';
import { buildPropertyPlacementKey } from '../../src/utils/treeFlattener';
import { EMPTY_PROPERTY_HIERARCHY_INDEX, type PropertyHierarchyIndex } from '../../src/utils/propertyHierarchy';
import { createTestTFile } from '../utils/createTestTFile';

function createPropertyValueNode(
    key: string,
    valuePath: string,
    name: string,
    notes: string[],
    assignmentValue?: string
): PropertyTreeNode {
    return {
        id: buildPropertyValueNodeId(key, valuePath),
        kind: 'value',
        key,
        valuePath,
        name,
        displayPath: name,
        children: new Map(),
        notesWithValue: new Set(notes),
        assignmentValue
    };
}

function createPropertyKeyNode(key: string, name: string, notes: string[], values: PropertyTreeNode[] = []): PropertyTreeNode {
    const node: PropertyTreeNode = {
        id: buildPropertyKeyNodeId(key),
        kind: 'key',
        key,
        valuePath: null,
        name,
        displayPath: name,
        children: new Map(),
        notesWithValue: new Set(notes)
    };

    values.forEach(valueNode => {
        node.children.set(valueNode.id, valueNode);
    });

    return node;
}

function createSelectionState(): SelectionState {
    return {
        selectionType: ItemType.FOLDER,
        selectedFolder: null,
        selectedTag: null,
        selectedProperty: null,
        selectedFiles: new Set(),
        anchorIndex: null,
        lastMovementDirection: null,
        isRevealOperation: false,
        isFolderChangeWithAutoSelect: false,
        isKeyboardNavigation: false,
        isFolderNavigation: false,
        selectedFile: null,
        revealSource: null,
        navigationHistory: [],
        navigationHistoryIndex: -1
    };
}

interface TestVaultMethods {
    registerFile(file: ReturnType<typeof createTestTFile>): void;
    registerFolder(folder: TFolder): void;
}

function getTestVault(app: App): App['vault'] & TestVaultMethods {
    return app.vault as App['vault'] & TestVaultMethods;
}

function createTestFolder(app: App, path: string): TFolder {
    const folder = new TFolder(path) as TFolder & {
        children: ReturnType<typeof createTestTFile>[];
        name: string;
        parent: TFolder | null;
        vault: App['vault'];
    };
    folder.children = [];
    folder.name = path.split('/').pop() ?? path;
    folder.parent = null;
    folder.vault = app.vault;
    getTestVault(app).registerFolder(folder);
    return folder;
}

function addFolderNote(app: App, folder: TFolder, path: string): void {
    const file = createTestTFile(path) as ReturnType<typeof createTestTFile> & { parent: TFolder; vault: App['vault'] };
    file.parent = folder;
    file.vault = app.vault;
    (folder as TFolder & { children: ReturnType<typeof createTestTFile>[] }).children.push(file);
    getTestVault(app).registerFile(file);
}

function addChildFolder(app: App, folder: TFolder, path: string): TFolder {
    const childFolder = createTestFolder(app, path) as TFolder & { parent: TFolder };
    childFolder.parent = folder;
    folder.children.push(childFolder);
    return childFolder;
}

describe('useNavigationPaneTreeInteractions', () => {
    it('uses the property tree provider cache for global descendant expansion', () => {
        const childNode = createPropertyValueNode('status', 'open', 'Open', ['notes/a.md']);
        const keyNode = createPropertyKeyNode('status', 'Status', ['notes/a.md'], []);
        const propertyTree = new Map<string, PropertyTreeNode>([[keyNode.key, keyNode]]);
        const collectDescendantNodeIds = vi.fn(() => new Set([childNode.id]));
        const expansionDispatch = vi.fn();

        const propertyTreeProvider: IPropertyTreeProvider = {
            hasNodes: () => true,
            addTreeUpdateListener: () => () => {},
            findNode: nodeId => (nodeId === keyNode.id ? keyNode : null),
            getKeyNode: normalizedKey => (normalizedKey === keyNode.key ? keyNode : null),
            resolveSelectionNodeId: nodeId => nodeId,
            collectDescendantNodeIds,
            collectFilePaths: () => new Set(),
            collectFilesForKeys: () => new Set()
        };

        let captured: NavigationPaneTreeInteractionsResult | null = null;

        function Harness() {
            captured = useNavigationPaneTreeInteractions({
                app: new App(),
                commandQueue: null,
                settings: DEFAULT_SETTINGS,
                uiState: { singlePane: false },
                expansionState: {
                    expandedFolders: new Set(),
                    expandedTags: new Set(),
                    expandedProperties: new Set(),
                    expandedVirtualFolders: new Set()
                },
                expansionDispatch,
                selectionState: createSelectionState(),
                selectionDispatch: vi.fn(),
                uiDispatch: vi.fn(),
                propertyTreeService: propertyTreeProvider,
                tagTree: new Map(),
                propertyTree,
                propertyHierarchyIndex: EMPTY_PROPERTY_HIERARCHY_INDEX,
                tagsVirtualFolderHasChildren: false,
                setShortcutsExpanded: vi.fn(),
                setRecentNotesExpanded: vi.fn(),
                clearActiveShortcut: vi.fn(),
                openFolderNoteInRightSidebar: vi.fn(),
                openPropertyNoteInRightSidebar: vi.fn(),
                onModifySearchWithTag: vi.fn(),
                onModifySearchWithProperty: vi.fn()
            });
            return null;
        }

        renderToStaticMarkup(React.createElement(Harness));

        expect(captured).not.toBeNull();
        if (!captured) {
            throw new Error('Expected hook result');
        }
        const result = captured as NavigationPaneTreeInteractionsResult;

        // A key node's placement key is its own node id, which is what the row passes here.
        result.handlePropertyToggleAllSiblings(keyNode, keyNode.id);

        expect(collectDescendantNodeIds).toHaveBeenCalledWith(keyNode.id);
        expect(expansionDispatch).toHaveBeenCalledWith({
            type: 'TOGGLE_DESCENDANT_PROPERTIES',
            descendantNodeIds: [childNode.id],
            expand: true
        });
    });

    it('expands a folder when its folder note link is selected', () => {
        const app = new App();
        const folder = createTestFolder(app, 'Projects');
        addFolderNote(app, folder, 'Projects/index.md');
        addChildFolder(app, folder, 'Projects/Child');
        const expansionDispatch = vi.fn();
        const openFolderNoteInRightSidebar = vi.fn();
        let captured: NavigationPaneTreeInteractionsResult | null = null;

        function Harness() {
            captured = useNavigationPaneTreeInteractions({
                app,
                commandQueue: null,
                settings: {
                    ...DEFAULT_SETTINGS,
                    autoExpandNavItems: true,
                    enableFolderNotes: true,
                    folderNoteName: 'index',
                    folderNoteOpenLocation: 'right-sidebar',
                    showNearestFolderNoteInSidebar: false
                },
                uiState: { singlePane: false },
                expansionState: {
                    expandedFolders: new Set(),
                    expandedTags: new Set(),
                    expandedProperties: new Set(),
                    expandedVirtualFolders: new Set()
                },
                expansionDispatch,
                selectionState: createSelectionState(),
                selectionDispatch: vi.fn(),
                uiDispatch: vi.fn(),
                propertyTreeService: null,
                tagTree: new Map(),
                propertyTree: new Map(),
                propertyHierarchyIndex: EMPTY_PROPERTY_HIERARCHY_INDEX,
                tagsVirtualFolderHasChildren: false,
                setShortcutsExpanded: vi.fn(),
                setRecentNotesExpanded: vi.fn(),
                clearActiveShortcut: vi.fn(),
                openFolderNoteInRightSidebar,
                openPropertyNoteInRightSidebar: vi.fn(),
                onModifySearchWithTag: vi.fn(),
                onModifySearchWithProperty: vi.fn()
            });
            return null;
        }

        renderToStaticMarkup(React.createElement(Harness));

        expect(captured).not.toBeNull();
        if (!captured) {
            throw new Error('Expected hook result');
        }
        const result = captured as NavigationPaneTreeInteractionsResult;

        result.handleFolderNameClick(folder);

        expect(expansionDispatch).toHaveBeenCalledWith({
            type: 'TOGGLE_FOLDER_EXPANDED',
            folderPath: folder.path
        });
        expect(openFolderNoteInRightSidebar).toHaveBeenCalledTimes(1);
    });

    it('switches to the list pane when a right-sidebar folder note is clicked in single-pane mode', () => {
        const app = new App();
        const folder = createTestFolder(app, 'Projects');
        addFolderNote(app, folder, 'Projects/index.md');
        const uiDispatch = vi.fn();
        let captured: NavigationPaneTreeInteractionsResult | null = null;

        function Harness() {
            captured = useNavigationPaneTreeInteractions({
                app,
                commandQueue: null,
                settings: {
                    ...DEFAULT_SETTINGS,
                    enableFolderNotes: true,
                    folderNoteName: 'index',
                    folderNoteOpenLocation: 'right-sidebar',
                    showNearestFolderNoteInSidebar: true
                },
                uiState: { singlePane: true },
                expansionState: {
                    expandedFolders: new Set(),
                    expandedTags: new Set(),
                    expandedProperties: new Set(),
                    expandedVirtualFolders: new Set()
                },
                expansionDispatch: vi.fn(),
                selectionState: createSelectionState(),
                selectionDispatch: vi.fn(),
                uiDispatch,
                propertyTreeService: null,
                tagTree: new Map(),
                propertyTree: new Map(),
                propertyHierarchyIndex: EMPTY_PROPERTY_HIERARCHY_INDEX,
                tagsVirtualFolderHasChildren: false,
                setShortcutsExpanded: vi.fn(),
                setRecentNotesExpanded: vi.fn(),
                clearActiveShortcut: vi.fn(),
                openFolderNoteInRightSidebar: vi.fn(),
                openPropertyNoteInRightSidebar: vi.fn(),
                onModifySearchWithTag: vi.fn(),
                onModifySearchWithProperty: vi.fn()
            });
            return null;
        }

        renderToStaticMarkup(React.createElement(Harness));

        expect(captured).not.toBeNull();
        if (!captured) {
            throw new Error('Expected hook result');
        }
        const result = captured as NavigationPaneTreeInteractionsResult;

        result.handleFolderNameClick(folder);

        expect(uiDispatch).toHaveBeenCalledWith({ type: 'ACTIVATE_PANE', target: 'files' });
    });

    it('keeps the current pane when a non-sidebar folder note is clicked in single-pane mode', () => {
        const app = new App();
        app.workspace = {
            getLeaf: vi.fn(() => null)
        } as unknown as App['workspace'];
        const folder = createTestFolder(app, 'Projects');
        addFolderNote(app, folder, 'Projects/index.md');
        const uiDispatch = vi.fn();
        let captured: NavigationPaneTreeInteractionsResult | null = null;

        function Harness() {
            captured = useNavigationPaneTreeInteractions({
                app,
                commandQueue: null,
                settings: {
                    ...DEFAULT_SETTINGS,
                    enableFolderNotes: true,
                    folderNoteName: 'index',
                    folderNoteOpenLocation: 'current-tab',
                    showNearestFolderNoteInSidebar: true
                },
                uiState: { singlePane: true },
                expansionState: {
                    expandedFolders: new Set(),
                    expandedTags: new Set(),
                    expandedProperties: new Set(),
                    expandedVirtualFolders: new Set()
                },
                expansionDispatch: vi.fn(),
                selectionState: createSelectionState(),
                selectionDispatch: vi.fn(),
                uiDispatch,
                propertyTreeService: null,
                tagTree: new Map(),
                propertyTree: new Map(),
                propertyHierarchyIndex: EMPTY_PROPERTY_HIERARCHY_INDEX,
                tagsVirtualFolderHasChildren: false,
                setShortcutsExpanded: vi.fn(),
                setRecentNotesExpanded: vi.fn(),
                clearActiveShortcut: vi.fn(),
                openFolderNoteInRightSidebar: vi.fn(),
                openPropertyNoteInRightSidebar: vi.fn(),
                onModifySearchWithTag: vi.fn(),
                onModifySearchWithProperty: vi.fn()
            });
            return null;
        }

        renderToStaticMarkup(React.createElement(Harness));

        expect(captured).not.toBeNull();
        if (!captured) {
            throw new Error('Expected hook result');
        }
        const result = captured as NavigationPaneTreeInteractionsResult;

        result.handleFolderNameClick(folder);

        expect(uiDispatch).not.toHaveBeenCalledWith({ type: 'ACTIVATE_PANE', target: 'files' });
    });

    it('ignores recursive expansion toggles for a root locked open by hidden-item visibility', () => {
        const app = new App();
        const rootFolder = createTestFolder(app, '/');
        addChildFolder(app, rootFolder, 'Projects');
        const expansionDispatch = vi.fn();
        let captured: NavigationPaneTreeInteractionsResult | null = null;

        function Harness() {
            captured = useNavigationPaneTreeInteractions({
                app,
                commandQueue: null,
                settings: {
                    ...DEFAULT_SETTINGS,
                    showRootFolder: false
                },
                uiState: { singlePane: false },
                expansionState: {
                    expandedFolders: new Set(['/']),
                    expandedTags: new Set(),
                    expandedProperties: new Set(),
                    expandedVirtualFolders: new Set()
                },
                expansionDispatch,
                selectionState: createSelectionState(),
                selectionDispatch: vi.fn(),
                uiDispatch: vi.fn(),
                propertyTreeService: null,
                tagTree: new Map(),
                propertyTree: new Map(),
                propertyHierarchyIndex: EMPTY_PROPERTY_HIERARCHY_INDEX,
                tagsVirtualFolderHasChildren: false,
                setShortcutsExpanded: vi.fn(),
                setRecentNotesExpanded: vi.fn(),
                clearActiveShortcut: vi.fn(),
                openFolderNoteInRightSidebar: vi.fn(),
                openPropertyNoteInRightSidebar: vi.fn(),
                onModifySearchWithTag: vi.fn(),
                onModifySearchWithProperty: vi.fn()
            });
            return null;
        }

        renderToStaticMarkup(React.createElement(Harness));

        expect(captured).not.toBeNull();
        if (!captured) {
            throw new Error('Expected hook result');
        }
        const result = captured as NavigationPaneTreeInteractionsResult;

        result.handleFolderToggleAllSiblings(rootFolder);

        expect(expansionDispatch).not.toHaveBeenCalled();
    });
});

describe('property note name clicks', () => {
    function renderPropertyRow(params: { assignmentValue?: string; enabled: boolean; autoOpen?: boolean; resolved: TFile | null }) {
        const valueNode = createPropertyValueNode('references', 'apple', 'Apple', ['notes/a.md'], params.assignmentValue);
        const keyNode = createPropertyKeyNode('references', 'References', ['notes/a.md'], [valueNode]);

        const app = new App();
        app.metadataCache.getFirstLinkpathDest = () => params.resolved;
        const openFile = vi.fn().mockResolvedValue(undefined);
        app.workspace.getLeaf = vi.fn().mockReturnValue({ openFile });

        const propertyTree = new Map<string, PropertyTreeNode>([[keyNode.key, keyNode]]);
        const propertyTreeProvider: IPropertyTreeProvider = {
            hasNodes: () => true,
            addTreeUpdateListener: () => () => {},
            findNode: nodeId => (nodeId === valueNode.id ? valueNode : nodeId === keyNode.id ? keyNode : null),
            getKeyNode: normalizedKey => (normalizedKey === keyNode.key ? keyNode : null),
            resolveSelectionNodeId: nodeId => nodeId,
            collectDescendantNodeIds: () => new Set(),
            collectFilePaths: () => new Set(),
            collectFilesForKeys: () => new Set()
        };

        const selectionDispatch = vi.fn();
        const onModifySearchWithProperty = vi.fn();
        let captured: NavigationPaneTreeInteractionsResult | null = null;

        function Harness() {
            captured = useNavigationPaneTreeInteractions({
                app,
                commandQueue: null,
                settings: {
                    ...DEFAULT_SETTINGS,
                    // enablePropertyNotes is the master toggle and stays on for every case in this
                    // harness; `enabled` here only varies enablePropertyNoteLinks, which governs the
                    // name affordance and Enter-to-open, independently of autoOpenPropertyNote (which
                    // governs mouse-driven row clicks and shortcut activation).
                    enablePropertyNotes: true,
                    enablePropertyNoteLinks: params.enabled,
                    autoOpenPropertyNote: params.autoOpen ?? false
                },
                uiState: { singlePane: false },
                expansionState: {
                    expandedFolders: new Set(),
                    expandedTags: new Set(),
                    expandedProperties: new Set(),
                    expandedVirtualFolders: new Set()
                },
                expansionDispatch: vi.fn(),
                selectionState: createSelectionState(),
                selectionDispatch,
                uiDispatch: vi.fn(),
                propertyTreeService: propertyTreeProvider,
                tagTree: new Map(),
                propertyTree,
                propertyHierarchyIndex: EMPTY_PROPERTY_HIERARCHY_INDEX,
                tagsVirtualFolderHasChildren: false,
                setShortcutsExpanded: vi.fn(),
                setRecentNotesExpanded: vi.fn(),
                clearActiveShortcut: vi.fn(),
                openFolderNoteInRightSidebar: vi.fn(),
                openPropertyNoteInRightSidebar: vi.fn(),
                onModifySearchWithTag: vi.fn(),
                onModifySearchWithProperty
            });
            return null;
        }

        renderToStaticMarkup(React.createElement(Harness));
        if (!captured) {
            throw new Error('Expected hook result');
        }
        const result = captured as NavigationPaneTreeInteractionsResult;

        return {
            // A flat value's placement key is its node id, which is what the row passes here.
            nameClick: (event?: React.MouseEvent) => result.handlePropertyNameClick(valueNode, valueNode.id, event),
            rowClick: () => result.handlePropertyClick(valueNode, valueNode.id),
            nameMouseDown: (button = 1) =>
                result.handlePropertyNameMouseDown(valueNode, {
                    button,
                    preventDefault: vi.fn(),
                    stopPropagation: vi.fn()
                } as unknown as React.MouseEvent),
            openFile,
            selectionDispatch,
            onModifySearchWithProperty,
            valueNode
        };
    }

    it('opens the note when the name is clicked', async () => {
        const file = createTestTFile('Apple.md');
        const { nameClick, openFile } = renderPropertyRow({
            assignmentValue: '[[Apple]]',
            enabled: true,
            resolved: file
        });
        nameClick();
        await Promise.resolve();
        expect(openFile).toHaveBeenCalledWith(file, { active: true });
    });

    // Regression test: PropertyTreeItem's handleNameClick calls stopPropagation() before
    // delegating here, so the row click handler never sees a modifier-held name click. The
    // search-filter modifier (Cmd/Alt+click, per multiSelectModifier) must be honored here too,
    // matching handlePropertyClick, or Cmd+click on the name silently opens the note instead of
    // filtering - the one place users are most likely to click.
    it('filters instead of opening when the name is clicked with the search modifier held', async () => {
        const file = createTestTFile('Apple.md');
        const { nameClick, openFile, onModifySearchWithProperty, valueNode } = renderPropertyRow({
            assignmentValue: '[[Apple]]',
            enabled: true,
            resolved: file
        });
        nameClick({
            metaKey: true,
            ctrlKey: true,
            shiftKey: false,
            preventDefault: vi.fn(),
            stopPropagation: vi.fn()
        } as unknown as React.MouseEvent);
        await Promise.resolve();
        expect(onModifySearchWithProperty).toHaveBeenCalledWith(valueNode.key, valueNode.valuePath, 'AND');
        expect(openFile).not.toHaveBeenCalled();
    });

    it('selects without opening when the row body is clicked', async () => {
        const { rowClick, openFile, selectionDispatch, valueNode } = renderPropertyRow({
            assignmentValue: '[[Apple]]',
            enabled: true,
            resolved: createTestTFile('Apple.md')
        });
        rowClick();
        await Promise.resolve();
        expect(openFile).not.toHaveBeenCalled();
        expect(selectionDispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'SET_SELECTED_PROPERTY', nodeId: valueNode.id }));
    });

    it('opens on a row body click when auto-open is on', async () => {
        const file = createTestTFile('Apple.md');
        const { rowClick, openFile } = renderPropertyRow({
            assignmentValue: '[[Apple]]',
            enabled: true,
            autoOpen: true,
            resolved: file
        });
        rowClick();
        await Promise.resolve();
        expect(openFile).toHaveBeenCalledWith(file, { active: true });
    });

    it('still dispatches selection when auto-open fires', async () => {
        const { rowClick, selectionDispatch, valueNode } = renderPropertyRow({
            assignmentValue: '[[Apple]]',
            enabled: true,
            autoOpen: true,
            resolved: createTestTFile('Apple.md')
        });
        rowClick();
        await Promise.resolve();
        expect(selectionDispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'SET_SELECTED_PROPERTY', nodeId: valueNode.id }));
    });

    it('does not open on a row body click when auto-open is off', async () => {
        const { rowClick, openFile } = renderPropertyRow({
            assignmentValue: '[[Apple]]',
            enabled: true,
            autoOpen: false,
            resolved: createTestTFile('Apple.md')
        });
        rowClick();
        await Promise.resolve();
        expect(openFile).not.toHaveBeenCalled();
    });

    it('opens on a row body click even with links off', async () => {
        // autoOpenPropertyNote is independent of enablePropertyNoteLinks: it governs
        // mouse-driven navigation, links governs the name affordance and the keyboard.
        const file = createTestTFile('Apple.md');
        const { rowClick, openFile } = renderPropertyRow({
            assignmentValue: '[[Apple]]',
            enabled: false,
            autoOpen: true,
            resolved: file
        });
        rowClick();
        await Promise.resolve();
        expect(openFile).toHaveBeenCalledWith(file, { active: true });
    });

    it('does not open on a row body click for an unresolvable link', async () => {
        const { rowClick, openFile } = renderPropertyRow({
            assignmentValue: '[[Ghost]]',
            enabled: true,
            autoOpen: true,
            resolved: null
        });
        rowClick();
        await Promise.resolve();
        expect(openFile).not.toHaveBeenCalled();
    });

    // Without autoSelectedFile: null the provider resolves a first file for the property, and with
    // autoSelectFirstFileOnFocusChange on the list pane opens it after the property note's open was
    // initiated - replacing the property note in the same tab. Asserting the exact payload (not
    // objectContaining) keeps that field pinned instead of merely tolerated.
    it('also selects the value when the name is clicked, suppressing the auto-selected first file', async () => {
        const { nameClick, selectionDispatch, valueNode } = renderPropertyRow({
            assignmentValue: '[[Apple]]',
            enabled: true,
            resolved: createTestTFile('Apple.md')
        });
        nameClick();
        await Promise.resolve();
        expect(selectionDispatch).toHaveBeenCalledWith({
            type: 'SET_SELECTED_PROPERTY',
            nodeId: valueNode.id,
            autoSelectedFile: null
        });
    });

    it('opens nothing when the links setting is off', async () => {
        const { nameClick, openFile } = renderPropertyRow({
            assignmentValue: '[[Apple]]',
            enabled: false,
            resolved: createTestTFile('Apple.md')
        });
        nameClick();
        await Promise.resolve();
        expect(openFile).not.toHaveBeenCalled();
    });

    it('opens nothing and creates nothing when the link does not resolve', async () => {
        const { nameClick, openFile } = renderPropertyRow({
            assignmentValue: '[[Ghost]]',
            enabled: true,
            resolved: null
        });
        nameClick();
        await Promise.resolve();
        expect(openFile).not.toHaveBeenCalled();
    });

    it('opens nothing for a plain string value', async () => {
        const { nameClick, openFile } = renderPropertyRow({
            assignmentValue: 'draft',
            enabled: true,
            resolved: createTestTFile('Draft.md')
        });
        nameClick();
        await Promise.resolve();
        expect(openFile).not.toHaveBeenCalled();
    });

    it('opens the note in a new tab and selects the value on middle-click', async () => {
        const file = createTestTFile('Apple.md');
        const { nameMouseDown, openFile, selectionDispatch, valueNode } = renderPropertyRow({
            assignmentValue: '[[Apple]]',
            enabled: true,
            resolved: file
        });
        nameMouseDown();
        await Promise.resolve();
        expect(openFile).toHaveBeenCalledWith(file, { active: true });
        expect(selectionDispatch).toHaveBeenCalledWith({
            type: 'SET_SELECTED_PROPERTY',
            nodeId: valueNode.id,
            autoSelectedFile: null
        });
    });

    it('does nothing on a left mouse-down', async () => {
        const { nameMouseDown, openFile, selectionDispatch } = renderPropertyRow({
            assignmentValue: '[[Apple]]',
            enabled: true,
            resolved: createTestTFile('Apple.md')
        });
        nameMouseDown(0);
        await Promise.resolve();
        expect(openFile).not.toHaveBeenCalled();
        expect(selectionDispatch).not.toHaveBeenCalled();
    });

    it('does nothing on middle-click when the links setting is off', async () => {
        const { nameMouseDown, openFile, selectionDispatch } = renderPropertyRow({
            assignmentValue: '[[Apple]]',
            enabled: false,
            resolved: createTestTFile('Apple.md')
        });
        nameMouseDown();
        await Promise.resolve();
        expect(openFile).not.toHaveBeenCalled();
        expect(selectionDispatch).not.toHaveBeenCalled();
    });

    it('does nothing on middle-click when the link does not resolve', async () => {
        const { nameMouseDown, openFile, selectionDispatch } = renderPropertyRow({
            assignmentValue: '[[Ghost]]',
            enabled: true,
            resolved: null
        });
        nameMouseDown();
        await Promise.resolve();
        expect(openFile).not.toHaveBeenCalled();
        expect(selectionDispatch).not.toHaveBeenCalled();
    });
});

describe('handlePropertyToggle placement keys', () => {
    function renderInteractions(params: {
        propertyTree: Map<string, PropertyTreeNode>;
        propertyHierarchyIndex?: PropertyHierarchyIndex;
        collapseOtherBranchesOnExpand?: boolean;
        expansionDispatch: ReturnType<typeof vi.fn>;
    }) {
        let captured: NavigationPaneTreeInteractionsResult | null = null;

        function Harness() {
            captured = useNavigationPaneTreeInteractions({
                app: new App(),
                commandQueue: null,
                settings: {
                    ...DEFAULT_SETTINGS,
                    collapseOtherBranchesOnExpand: params.collapseOtherBranchesOnExpand ?? false
                },
                uiState: { singlePane: false },
                expansionState: {
                    expandedFolders: new Set(),
                    expandedTags: new Set(),
                    expandedProperties: new Set(),
                    expandedVirtualFolders: new Set()
                },
                expansionDispatch: params.expansionDispatch,
                selectionState: createSelectionState(),
                selectionDispatch: vi.fn(),
                uiDispatch: vi.fn(),
                propertyTreeService: null,
                tagTree: new Map(),
                propertyTree: params.propertyTree,
                propertyHierarchyIndex: params.propertyHierarchyIndex ?? EMPTY_PROPERTY_HIERARCHY_INDEX,
                tagsVirtualFolderHasChildren: false,
                setShortcutsExpanded: vi.fn(),
                setRecentNotesExpanded: vi.fn(),
                clearActiveShortcut: vi.fn(),
                openFolderNoteInRightSidebar: vi.fn(),
                openPropertyNoteInRightSidebar: vi.fn(),
                onModifySearchWithTag: vi.fn(),
                onModifySearchWithProperty: vi.fn()
            });
            return null;
        }

        renderToStaticMarkup(React.createElement(Harness));
        if (!captured) {
            throw new Error('Expected hook result');
        }
        return captured as NavigationPaneTreeInteractionsResult;
    }

    it('dispatches the placement key, not the node id, for a nested placement', () => {
        // "Clients" nested under "Work": the node id alone would collide with every other
        // placement of the same value, so the chain-joined placement key is what must travel.
        const clientsNode = createPropertyValueNode('projects', 'clients', 'Clients', ['notes/a.md']);
        const workNode = createPropertyValueNode('projects', 'work', 'Work', [], undefined);
        const keyNode = createPropertyKeyNode('projects', 'Projects', [], [workNode, clientsNode]);
        const propertyTree = new Map<string, PropertyTreeNode>([[keyNode.key, keyNode]]);
        const placementKey = buildPropertyPlacementKey([workNode.id, clientsNode.id]);
        const expansionDispatch = vi.fn();

        const result = renderInteractions({ propertyTree, expansionDispatch });

        result.handlePropertyToggle(placementKey, clientsNode.id);

        expect(expansionDispatch).toHaveBeenCalledWith({ type: 'TOGGLE_PROPERTY_EXPANDED', propertyNodeId: placementKey });
    });

    it('branch replaces a nested placement by mouse, keeping the row it just expanded rendering', () => {
        // Was: this fell through to the plain dispatch, because the mouse path carried a second
        // suppression (placementKey === nodeId) beside the one on the shared target type, and the two
        // drifted. Both are gone: the replacement set now names the key node id, every ancestor
        // placement key and the target, which is exactly what the row needs to stay rendered.
        const clientsNode = createPropertyValueNode('projects', 'clients', 'Clients', ['notes/a.md']);
        const workNode = createPropertyValueNode('projects', 'work', 'Work', [], undefined);
        const acmeNode = createPropertyValueNode('projects', 'acme', 'Acme', ['notes/b.md']);
        const keyNode = createPropertyKeyNode('projects', 'Projects', [], [workNode, clientsNode, acmeNode]);
        const propertyTree = new Map<string, PropertyTreeNode>([[keyNode.key, keyNode]]);
        const propertyHierarchyIndex: PropertyHierarchyIndex = {
            ...EMPTY_PROPERTY_HIERARCHY_INDEX,
            childIds: new Map([
                [workNode.id, [clientsNode.id]],
                [clientsNode.id, [acmeNode.id]]
            ])
        };
        const placementKey = buildPropertyPlacementKey([workNode.id, clientsNode.id]);
        const expansionDispatch = vi.fn();

        const result = renderInteractions({
            propertyTree,
            propertyHierarchyIndex,
            expansionDispatch,
            collapseOtherBranchesOnExpand: true
        });

        result.handlePropertyToggle(placementKey, clientsNode.id);

        expect(expansionDispatch).toHaveBeenCalledWith({
            type: 'SET_EXPANDED_PROPERTIES',
            properties: new Set([keyNode.id, workNode.id, placementKey])
        });
    });

    it('still takes the collapse-others branch for a key node', () => {
        const workNode = createPropertyValueNode('projects', 'work', 'Work', ['notes/a.md']);
        const keyNode = createPropertyKeyNode('projects', 'Projects', [], [workNode]);
        const propertyTree = new Map<string, PropertyTreeNode>([[keyNode.key, keyNode]]);
        const expansionDispatch = vi.fn();

        const result = renderInteractions({ propertyTree, expansionDispatch, collapseOtherBranchesOnExpand: true });

        // A key node's placement key is its own node id, so the caller passes it for both arguments.
        result.handlePropertyToggle(keyNode.id, keyNode.id);

        expect(expansionDispatch).toHaveBeenCalledWith({ type: 'SET_EXPANDED_PROPERTIES', properties: new Set([keyNode.id]) });
    });

    it('expands a root hierarchical value through the collapse-others branch, where its own children map is empty', () => {
        // The collapse-others branch built its target with targetNode.children.size > 0, which is
        // always false for a value node because values are stored as leaf children of their key. That
        // made canExpand false, so nothing dispatched and the early return swallowed the toggle,
        // leaving the entire hierarchical tree unopenable by mouse with this setting on. A ROOT VALUE
        // node is what exercises it; a key node does have children and cannot catch this.
        const workNode = createPropertyValueNode('projects', 'work', 'Work', ['notes/a.md']);
        const clientsNode = createPropertyValueNode('projects', 'clients', 'Clients', ['notes/b.md']);
        const keyNode = createPropertyKeyNode('projects', 'Projects', [], [workNode, clientsNode]);
        const propertyTree = new Map<string, PropertyTreeNode>([[keyNode.key, keyNode]]);
        const propertyHierarchyIndex: PropertyHierarchyIndex = {
            ...EMPTY_PROPERTY_HIERARCHY_INDEX,
            childIds: new Map([[workNode.id, [clientsNode.id]]])
        };
        const expansionDispatch = vi.fn();

        const result = renderInteractions({
            propertyTree,
            propertyHierarchyIndex,
            expansionDispatch,
            collapseOtherBranchesOnExpand: true
        });

        // A root placement's chain is just its own node id (buildPropertyPlacementKey([id]) === id),
        // so the caller passes the node id for both arguments, same as NavigationPaneTreeRow does.
        result.handlePropertyToggle(workNode.id, workNode.id);

        expect(expansionDispatch).toHaveBeenCalledWith({
            type: 'SET_EXPANDED_PROPERTIES',
            properties: new Set([keyNode.id, workNode.id])
        });
    });
});

describe('handlePropertyToggleAllSiblings placement keys', () => {
    it('toggles the clicked placement, not the bare node id, while keeping descendants in node ids', () => {
        // Alt+click on the "Work > Clients" chevron. Before this fix the self-toggle carried
        // clientsNode.id, so the persisted set gained a bare node id that renders nowhere and the
        // clicked row never opened. Only the descendant payload stays in node ids, because
        // TOGGLE_DESCENDANT_PROPERTIES walks node.children, which a hierarchical value never has.
        const grandchildNode = createPropertyValueNode('projects', 'clients/acme', 'Acme', ['notes/c.md']);
        const clientsNode = createPropertyValueNode('projects', 'clients', 'Clients', ['notes/a.md']);
        clientsNode.children.set(grandchildNode.id, grandchildNode);
        const workNode = createPropertyValueNode('projects', 'work', 'Work', [], undefined);
        const keyNode = createPropertyKeyNode('projects', 'Projects', [], [workNode, clientsNode]);
        const propertyTree = new Map<string, PropertyTreeNode>([[keyNode.key, keyNode]]);
        const placementKey = buildPropertyPlacementKey([workNode.id, clientsNode.id]);
        const expansionDispatch = vi.fn();

        let captured: NavigationPaneTreeInteractionsResult | null = null;

        function Harness() {
            captured = useNavigationPaneTreeInteractions({
                app: new App(),
                commandQueue: null,
                settings: DEFAULT_SETTINGS,
                uiState: { singlePane: false },
                expansionState: {
                    expandedFolders: new Set(),
                    expandedTags: new Set(),
                    expandedProperties: new Set(),
                    expandedVirtualFolders: new Set()
                },
                expansionDispatch,
                selectionState: createSelectionState(),
                selectionDispatch: vi.fn(),
                uiDispatch: vi.fn(),
                propertyTreeService: null,
                tagTree: new Map(),
                propertyTree,
                propertyHierarchyIndex: EMPTY_PROPERTY_HIERARCHY_INDEX,
                tagsVirtualFolderHasChildren: false,
                setShortcutsExpanded: vi.fn(),
                setRecentNotesExpanded: vi.fn(),
                clearActiveShortcut: vi.fn(),
                openFolderNoteInRightSidebar: vi.fn(),
                openPropertyNoteInRightSidebar: vi.fn(),
                onModifySearchWithTag: vi.fn(),
                onModifySearchWithProperty: vi.fn()
            });
            return null;
        }

        renderToStaticMarkup(React.createElement(Harness));
        if (!captured) {
            throw new Error('Expected hook result');
        }
        const result = captured as NavigationPaneTreeInteractionsResult;

        result.handlePropertyToggleAllSiblings(clientsNode, placementKey);

        expect(expansionDispatch).toHaveBeenCalledWith({ type: 'TOGGLE_PROPERTY_EXPANDED', propertyNodeId: placementKey });
        expect(expansionDispatch).not.toHaveBeenCalledWith({ type: 'TOGGLE_PROPERTY_EXPANDED', propertyNodeId: clientsNode.id });
        expect(expansionDispatch).toHaveBeenCalledWith({
            type: 'TOGGLE_DESCENDANT_PROPERTIES',
            descendantNodeIds: [grandchildNode.id],
            expand: true
        });
    });
});
