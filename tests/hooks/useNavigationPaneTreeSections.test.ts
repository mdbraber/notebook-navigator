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
import { App, TFolder, type TAbstractFile } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_SETTINGS } from '../../src/settings/defaultSettings';
import type { NotebookNavigatorSettings } from '../../src/settings/types';
import type { PropertyItem } from '../../src/storage/IndexedDBStorage';
import { ItemType, NavigationPaneItemType } from '../../src/types';
import type { TagTreeNode, PropertyTreeNode } from '../../src/types/storage';
import { createHiddenTagVisibility } from '../../src/utils/tagPrefixMatcher';
import { buildPropertyKeyNodeId, buildPropertyValueNodeId } from '../../src/utils/propertyTree';
import { buildPropertyPlacementKey } from '../../src/utils/treeFlattener';
import type { CombinedNavigationItem, PropertyValueTreeItem } from '../../src/types/virtualization';
import type { NavigationPaneSourceState } from '../../src/hooks/navigationPane/data/useNavigationPaneSourceState';
import {
    useNavigationPaneTreeSections,
    type NavigationPaneTreeSectionsResult
} from '../../src/hooks/navigationPane/data/useNavigationPaneTreeSections';
import { createTestTFile } from '../utils/createTestTFile';

/**
 * [type, key, level] for each item, for asserting a whole rendered property section at once. Narrows on
 * item.type first because CombinedNavigationItem includes members with no level, such as RootSpacerItem.
 */
function describePropertyItems(items: CombinedNavigationItem[]): [string, string, number][] {
    return items.map(item => {
        if (item.type !== NavigationPaneItemType.PROPERTY_KEY && item.type !== NavigationPaneItemType.PROPERTY_VALUE) {
            throw new Error(`Expected a property item, received ${item.type}`);
        }
        return [item.type, item.key, item.level];
    });
}

const dbFileDataByPath = new Map<string, { tags: string[] | null; properties: PropertyItem[] | null }>();

vi.mock('../../src/storage/fileOperations', () => ({
    getDBInstanceOrNull: () => ({
        getFile: (path: string) => {
            const entry = dbFileDataByPath.get(path);
            if (!entry) {
                return null;
            }
            return {
                mtime: 0,
                markdownPipelineMtime: 0,
                tagsMtime: 0,
                metadataMtime: 0,
                fileThumbnailsMtime: 0,
                tags: entry.tags,
                wordCount: null,
                taskTotal: 0,
                taskUnfinished: 0,
                properties: entry.properties,
                previewStatus: 'unprocessed',
                featureImage: null,
                featureImageStatus: 'unprocessed',
                featureImageKey: null,
                metadata: null
            };
        },
        forEachFile: () => {
            throw new Error('full database scan should not run for scoped tag rendering');
        }
    })
}));

function createFolder(path: string, children: TAbstractFile[] = []): TFolder {
    const folder = new TFolder();
    Reflect.set(folder, 'path', path);
    Reflect.set(folder, 'name', path.split('/').pop() ?? path);
    Reflect.set(folder, 'children', children);
    return folder;
}

function createTagNode(path: string, displayPath: string): TagTreeNode {
    return {
        name: displayPath.split('/').pop() ?? displayPath,
        path,
        displayPath,
        children: new Map(),
        notesWithTag: new Set()
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

function createSettings(overrides: Partial<NotebookNavigatorSettings> = {}): NotebookNavigatorSettings {
    return {
        ...DEFAULT_SETTINGS,
        showTags: true,
        showAllTagsFolder: false,
        showUntagged: false,
        showProperties: false,
        scopeTagsToCurrentContext: true,
        ...overrides
    };
}

function createSourceState(params?: {
    visibleTagTree?: Map<string, TagTreeNode>;
    propertyTree?: Map<string, PropertyTreeNode>;
    rootPropertyOrderMap?: Map<string, number>;
    visiblePropertyNavigationKeySet?: Set<string>;
    hasRootPropertyShortcut?: boolean;
}): NavigationPaneSourceState {
    const hiddenTagVisibility = createHiddenTagVisibility([], false);
    const visibleTagTree = params?.visibleTagTree ?? new Map<string, TagTreeNode>();
    const propertyTree = params?.propertyTree ?? new Map<string, PropertyTreeNode>();

    return {
        effectiveFrontmatterExclusions: [],
        hiddenFolders: [],
        descendantExcludedFolders: [],
        hiddenTags: [],
        hiddenFileProperties: [],
        hiddenFileNames: [],
        hiddenFileTags: [],
        fileVisibility: DEFAULT_SETTINGS.vaultProfiles[0].fileVisibility,
        navigationBannerPath: null,
        folderCountFileNameMatcher: null,
        hiddenFilePropertyMatcher: { hasCriteria: false, matches: () => false },
        rootFolders: [],
        rootLevelFolders: [],
        rootFolderOrderMap: new Map(),
        missingRootFolderPaths: [],
        tagTree: visibleTagTree,
        propertyTree,
        untaggedCount: 0,
        visibleTaggedCount: 2,
        hiddenTagMatcher: hiddenTagVisibility.matcher,
        hiddenMatcherHasRules: false,
        visibleTagTree,
        hasRootPropertyShortcut: params?.hasRootPropertyShortcut ?? false,
        tagComparator: undefined,
        hiddenRootTagNodes: new Map(),
        tagTreeForOrdering: visibleTagTree,
        rootTagOrderMap: new Map(),
        missingRootTagPaths: [],
        propertyKeyComparator: (a, b) => a.name.localeCompare(b.name),
        rootPropertyOrderMap: params?.rootPropertyOrderMap ?? new Map<string, number>(),
        missingRootPropertyKeys: [],
        visiblePropertyNavigationKeySet: params?.visiblePropertyNavigationKeySet ?? new Set<string>(),
        metadataDecorationVersion: 0,
        metadataVisibilityVersion: 0,
        tagDataVersion: 0,
        propertyDataVersion: 0,
        getFolderSortName: folder => folder.name,
        folderExclusionByFolderNote: undefined,
        recentNotesHiddenFileMatcher: () => false,
        fileChangeVersion: 0,
        folderChangeVersion: 0
    };
}

/**
 * Renders the hook once for a property section. Returned so a test can re-render with a different
 * expansion set and compare the two, which is the only way to check a row's chevron against what
 * expanding it actually produces.
 */
function renderPropertySection(params: {
    app: App;
    settings: NotebookNavigatorSettings;
    expandedProperties: Set<string>;
    folder: TFolder;
    visiblePropertyNavigationKeySet: Set<string>;
}): NavigationPaneTreeSectionsResult {
    let captured: NavigationPaneTreeSectionsResult | null = null;

    function Harness() {
        captured = useNavigationPaneTreeSections({
            app: params.app,
            settings: params.settings,
            expansionState: {
                expandedFolders: new Set(),
                expandedTags: new Set(),
                expandedProperties: params.expandedProperties,
                expandedVirtualFolders: new Set()
            },
            showHiddenItems: false,
            includeDescendantNotes: true,
            sourceState: createSourceState({
                propertyTree: new Map(),
                visiblePropertyNavigationKeySet: params.visiblePropertyNavigationKeySet
            }),
            selectionScope: {
                selectionType: ItemType.FOLDER,
                selectedFolder: params.folder
            },
            tagTreeService: null,
            propertyTreeService: null
        });
        return null;
    }

    renderToStaticMarkup(React.createElement(Harness));

    if (!captured) {
        throw new Error('Expected hook result');
    }
    return captured;
}

/**
 * The invariant the emitter and the flattener have to share: a placement whose chevron says it has
 * children must gain rows when it is expanded, and one that says it has none must gain nothing.
 * Every defect found in this feature lived in that seam rather than in either side alone.
 */
function expectChevronsMatchFlattenedRows(params: {
    app: App;
    settings: NotebookNavigatorSettings;
    expandedProperties: Set<string>;
    folder: TFolder;
    visiblePropertyNavigationKeySet: Set<string>;
}): void {
    const base = renderPropertySection(params);

    base.propertyItems.forEach(item => {
        if (item.type !== NavigationPaneItemType.PROPERTY_VALUE || params.expandedProperties.has(item.key)) {
            return;
        }

        const withItemExpanded = renderPropertySection({
            ...params,
            expandedProperties: new Set([...params.expandedProperties, item.key])
        });
        const addedRows = withItemExpanded.propertyItems.length - base.propertyItems.length;

        if (item.hasChildren) {
            expect(addedRows, `${item.key} claims children`).toBeGreaterThan(0);
        } else {
            expect(addedRows, `${item.key} claims no children`).toBe(0);
        }
    });
}

describe('useNavigationPaneTreeSections', () => {
    it('keeps global root tag ordering available while scoped rendering shows only current-context tags', () => {
        dbFileDataByPath.clear();

        const alphaFile = createTestTFile('notes/project/alpha.md');
        dbFileDataByPath.set(alphaFile.path, { tags: ['#alpha'], properties: null });

        const folder = createFolder('notes/project', [alphaFile]);
        Reflect.set(alphaFile, 'parent', folder);

        const alphaNode = createTagNode('alpha', 'Alpha');
        const betaNode = createTagNode('beta', 'Beta');
        const visibleTagTree = new Map<string, TagTreeNode>([
            [alphaNode.path, alphaNode],
            [betaNode.path, betaNode]
        ]);

        const app = new App();
        let captured: NavigationPaneTreeSectionsResult | null = null;

        function Harness() {
            captured = useNavigationPaneTreeSections({
                app,
                settings: createSettings(),
                expansionState: {
                    expandedFolders: new Set(),
                    expandedTags: new Set(),
                    expandedProperties: new Set(),
                    expandedVirtualFolders: new Set()
                },
                showHiddenItems: false,
                includeDescendantNotes: true,
                sourceState: createSourceState({ visibleTagTree }),
                selectionScope: {
                    selectionType: ItemType.FOLDER,
                    selectedFolder: folder
                },
                tagTreeService: null,
                propertyTreeService: null
            });
            return null;
        }

        renderToStaticMarkup(React.createElement(Harness));

        expect(captured).not.toBeNull();
        if (!captured) {
            throw new Error('Expected hook result');
        }
        const result = captured as NavigationPaneTreeSectionsResult;

        const renderTagTreeKeys = Array.from(result.renderTagTree.keys());
        const rootOrderingTagTreeKeys = Array.from(result.rootOrderingTagTree.keys());
        const renderedItemTypes = result.tagItems.map(item => item.type);
        const renderedItemKeys = result.tagItems.map(item => item.key);

        expect(renderTagTreeKeys).toEqual(['alpha']);
        expect(rootOrderingTagTreeKeys).toEqual(['alpha', 'beta']);
        expect(result.resolvedRootTagKeys).toEqual(['alpha', 'beta']);
        expect(renderedItemTypes).toEqual([NavigationPaneItemType.TAG]);
        expect(renderedItemKeys).toEqual(['alpha']);
        const firstRenderedTagItem = result.tagItems[0];
        expect(firstRenderedTagItem && 'noteCount' in firstRenderedTagItem ? firstRenderedTagItem.noteCount : undefined).toBeUndefined();
    });

    it('keeps global root property ordering available while scoped rendering shows only current-context properties', () => {
        dbFileDataByPath.clear();

        const statusFile = createTestTFile('notes/project/status.md');
        dbFileDataByPath.set(statusFile.path, {
            tags: null,
            properties: [{ fieldKey: 'Status', value: 'Open', valueKind: 'string' }]
        });

        const folder = createFolder('notes/project', [statusFile]);
        Reflect.set(statusFile, 'parent', folder);

        const statusValueNode = createPropertyValueNode('status', 'open', 'Open', ['notes/project/status.md']);
        const statusKeyNode = createPropertyKeyNode('status', 'Status', ['notes/project/status.md'], [statusValueNode]);
        const priorityKeyNode = createPropertyKeyNode('priority', 'Priority', ['notes/priority.md']);
        const propertyTree = new Map<string, PropertyTreeNode>([
            [statusKeyNode.key, statusKeyNode],
            [priorityKeyNode.key, priorityKeyNode]
        ]);

        const app = new App();
        let captured: NavigationPaneTreeSectionsResult | null = null;

        function Harness() {
            captured = useNavigationPaneTreeSections({
                app,
                settings: createSettings({
                    showTags: false,
                    showProperties: true,
                    showAllPropertiesFolder: false,
                    scopeTagsToCurrentContext: false,
                    scopePropertiesToCurrentContext: true
                }),
                expansionState: {
                    expandedFolders: new Set(),
                    expandedTags: new Set(),
                    expandedProperties: new Set([buildPropertyKeyNodeId('status')]),
                    expandedVirtualFolders: new Set()
                },
                showHiddenItems: false,
                includeDescendantNotes: true,
                sourceState: createSourceState({
                    propertyTree,
                    rootPropertyOrderMap: new Map<string, number>([
                        ['priority', 0],
                        ['status', 1]
                    ]),
                    visiblePropertyNavigationKeySet: new Set(['status', 'priority']),
                    hasRootPropertyShortcut: true
                }),
                selectionScope: {
                    selectionType: ItemType.FOLDER,
                    selectedFolder: folder
                },
                tagTreeService: null,
                propertyTreeService: null
            });
            return null;
        }

        renderToStaticMarkup(React.createElement(Harness));

        expect(captured).not.toBeNull();
        if (!captured) {
            throw new Error('Expected hook result');
        }
        const result = captured as NavigationPaneTreeSectionsResult;

        expect(Array.from(result.renderPropertyTree.keys())).toEqual(['status']);
        expect(Array.from(result.rootOrderingPropertyTree.keys())).toEqual(['priority', 'status']);
        expect(result.resolvedRootPropertyKeys).toEqual(['priority', 'status']);
        expect(result.propertyItems.map(item => item.type)).toEqual([
            NavigationPaneItemType.PROPERTY_KEY,
            NavigationPaneItemType.PROPERTY_VALUE
        ]);
        expect(result.propertyItems.map(item => item.key)).toEqual([buildPropertyKeyNodeId('status'), statusValueNode.id]);
        expect(result.propertyCollectionCount).toEqual({ current: 1, descendants: 0, total: 1 });
    });

    it('keeps scoped property rendering empty when no navigation property keys are enabled', () => {
        dbFileDataByPath.clear();

        const statusFile = createTestTFile('notes/project/status.md');
        dbFileDataByPath.set(statusFile.path, {
            tags: null,
            properties: [{ fieldKey: 'Status', value: 'Open', valueKind: 'string' }]
        });

        const folder = createFolder('notes/project', [statusFile]);
        Reflect.set(statusFile, 'parent', folder);

        const app = new App();
        let captured: NavigationPaneTreeSectionsResult | null = null;

        function Harness() {
            captured = useNavigationPaneTreeSections({
                app,
                settings: createSettings({
                    showTags: false,
                    showProperties: true,
                    showAllPropertiesFolder: false,
                    scopeTagsToCurrentContext: false,
                    scopePropertiesToCurrentContext: true
                }),
                expansionState: {
                    expandedFolders: new Set(),
                    expandedTags: new Set(),
                    expandedProperties: new Set(),
                    expandedVirtualFolders: new Set()
                },
                showHiddenItems: false,
                includeDescendantNotes: true,
                sourceState: createSourceState({
                    visiblePropertyNavigationKeySet: new Set<string>()
                }),
                selectionScope: {
                    selectionType: ItemType.FOLDER,
                    selectedFolder: folder
                },
                tagTreeService: null,
                propertyTreeService: null
            });
            return null;
        }

        renderToStaticMarkup(React.createElement(Harness));

        expect(captured).not.toBeNull();
        if (!captured) {
            throw new Error('Expected hook result');
        }
        const result = captured as NavigationPaneTreeSectionsResult;

        expect(Array.from(result.renderPropertyTree.keys())).toEqual([]);
        expect(result.propertyItems).toEqual([]);
    });

    it("nests a hierarchical key's values and sources subtree counts from the scoped tree, not the global one", () => {
        dbFileDataByPath.clear();

        // Building software.md carries projects: [[Fiddle]], so it counts toward Fiddle directly.
        // Bulwark.md carries projects: [[Building software]], so through Building software's own
        // assignmentValue wikilink it nests under Fiddle. Same fixture propertyHierarchy.test.ts uses.
        const buildingSoftwareFile = createTestTFile('notes/project/Building software.md');
        const bulwarkFile = createTestTFile('notes/project/Bulwark.md');
        dbFileDataByPath.set(buildingSoftwareFile.path, {
            tags: null,
            properties: [{ fieldKey: 'Projects', value: '[[Fiddle]]', valueKind: 'string' }]
        });
        dbFileDataByPath.set(bulwarkFile.path, {
            tags: null,
            properties: [{ fieldKey: 'Projects', value: '[[Building software]]', valueKind: 'string' }]
        });

        const folder = createFolder('notes/project', [buildingSoftwareFile, bulwarkFile]);
        Reflect.set(buildingSoftwareFile, 'parent', folder);
        Reflect.set(bulwarkFile, 'parent', folder);

        const app = new App();
        app.metadataCache.getFirstLinkpathDest = (linkpath: string) => (linkpath === 'Building software' ? buildingSoftwareFile : null);

        const fiddleId = buildPropertyValueNodeId('projects', 'fiddle');
        const buildingSoftwareId = buildPropertyValueNodeId('projects', 'building software');

        // An artificially larger, flat "global" tree standing in for whatever pre-scope source the
        // index must not read from. If the index read this tree instead of the scoped one, Fiddle's
        // subtree count would be 3 (its own notes, no nesting) instead of the scoped 2 (Building
        // software.md unioned with Bulwark.md through the nesting above).
        const globalFiddleValueNode = createPropertyValueNode('projects', 'fiddle', 'Fiddle', [
            buildingSoftwareFile.path,
            'notes/elsewhere-1.md',
            'notes/elsewhere-2.md'
        ]);
        const globalProjectsKeyNode = createPropertyKeyNode(
            'projects',
            'Projects',
            [buildingSoftwareFile.path, 'notes/elsewhere-1.md', 'notes/elsewhere-2.md'],
            [globalFiddleValueNode]
        );
        const globalPropertyTree = new Map<string, PropertyTreeNode>([[globalProjectsKeyNode.key, globalProjectsKeyNode]]);

        let captured: NavigationPaneTreeSectionsResult | null = null;

        function Harness() {
            captured = useNavigationPaneTreeSections({
                app,
                settings: createSettings({
                    showTags: false,
                    showProperties: true,
                    showAllPropertiesFolder: false,
                    scopeTagsToCurrentContext: false,
                    scopePropertiesToCurrentContext: true,
                    propertyHierarchicalKeys: { projects: true }
                }),
                expansionState: {
                    expandedFolders: new Set(),
                    expandedTags: new Set(),
                    expandedProperties: new Set([buildPropertyKeyNodeId('projects'), fiddleId]),
                    expandedVirtualFolders: new Set()
                },
                showHiddenItems: false,
                includeDescendantNotes: true,
                sourceState: createSourceState({
                    propertyTree: globalPropertyTree,
                    visiblePropertyNavigationKeySet: new Set(['projects'])
                }),
                selectionScope: {
                    selectionType: ItemType.FOLDER,
                    selectedFolder: folder
                },
                tagTreeService: null,
                propertyTreeService: null
            });
            return null;
        }

        renderToStaticMarkup(React.createElement(Harness));

        expect(captured).not.toBeNull();
        if (!captured) {
            throw new Error('Expected hook result');
        }
        const result = captured as NavigationPaneTreeSectionsResult;

        expect(result.propertyItems.map(item => item.type)).toEqual([
            NavigationPaneItemType.PROPERTY_KEY,
            NavigationPaneItemType.PROPERTY_VALUE,
            NavigationPaneItemType.PROPERTY_VALUE
        ]);
        // Fiddle is a root placement, so its item key equals its node id. Building software is
        // nested one level under Fiddle, so its item key is the chain-joined placement key.
        expect(result.propertyItems.map(item => item.key)).toEqual([
            buildPropertyKeyNodeId('projects'),
            fiddleId,
            buildPropertyPlacementKey([fiddleId, buildingSoftwareId])
        ]);
        const propertyItemLevels = result.propertyItems.map(item =>
            item.type === NavigationPaneItemType.PROPERTY_KEY || item.type === NavigationPaneItemType.PROPERTY_VALUE ? item.level : null
        );
        expect(propertyItemLevels).toEqual([0, 1, 2]);

        const fiddleItem = result.propertyItems[1] as PropertyValueTreeItem;
        const buildingSoftwareItem = result.propertyItems[2] as PropertyValueTreeItem;
        expect(fiddleItem.hasChildren).toBe(true);
        expect(buildingSoftwareItem.hasChildren).toBe(false);

        // Must reflect the scoped tree's counts (2), not the larger global tree passed above (3).
        expect(result.propertyHierarchyIndex.subtreeCount.get(fiddleId)).toBe(2);
    });

    it('expanding a level-2 placement emits its level-3 children', () => {
        dbFileDataByPath.clear();

        // Fiddle (root) <- Building software (level 2, carries Projects: Fiddle) <- Bulwark
        // (level 3, carries Projects: Building software). uses-bulwark.md is what makes "Bulwark" a
        // value node of projects at all: it is the note that carries Projects: [[Bulwark]].
        const buildingSoftwareFile = createTestTFile('notes/project/Building software.md');
        const bulwarkFile = createTestTFile('notes/project/Bulwark.md');
        const usesBulwarkFile = createTestTFile('notes/project/uses-bulwark.md');
        dbFileDataByPath.set(buildingSoftwareFile.path, {
            tags: null,
            properties: [{ fieldKey: 'Projects', value: '[[Fiddle]]', valueKind: 'string' }]
        });
        dbFileDataByPath.set(bulwarkFile.path, {
            tags: null,
            properties: [{ fieldKey: 'Projects', value: '[[Building software]]', valueKind: 'string' }]
        });
        dbFileDataByPath.set(usesBulwarkFile.path, {
            tags: null,
            properties: [{ fieldKey: 'Projects', value: '[[Bulwark]]', valueKind: 'string' }]
        });

        const folder = createFolder('notes/project', [buildingSoftwareFile, bulwarkFile, usesBulwarkFile]);
        Reflect.set(buildingSoftwareFile, 'parent', folder);
        Reflect.set(bulwarkFile, 'parent', folder);
        Reflect.set(usesBulwarkFile, 'parent', folder);

        const app = new App();
        app.metadataCache.getFirstLinkpathDest = (linkpath: string) =>
            linkpath === 'Building software' ? buildingSoftwareFile : linkpath === 'Bulwark' ? bulwarkFile : null;

        const fiddleId = buildPropertyValueNodeId('projects', 'fiddle');
        const buildingSoftwareId = buildPropertyValueNodeId('projects', 'building software');
        const bulwarkId = buildPropertyValueNodeId('projects', 'bulwark');
        const buildingSoftwarePlacementKey = buildPropertyPlacementKey([fiddleId, buildingSoftwareId]);

        let captured: NavigationPaneTreeSectionsResult | null = null;

        function Harness() {
            captured = useNavigationPaneTreeSections({
                app,
                settings: createSettings({
                    showTags: false,
                    showProperties: true,
                    showAllPropertiesFolder: false,
                    scopeTagsToCurrentContext: false,
                    scopePropertiesToCurrentContext: true,
                    propertyHierarchicalKeys: { projects: true }
                }),
                expansionState: {
                    expandedFolders: new Set(),
                    expandedTags: new Set(),
                    // The key, the root placement (level 1) and the level-2 placement all need to be
                    // expanded for the flattener to recurse far enough to reach level 3.
                    expandedProperties: new Set([buildPropertyKeyNodeId('projects'), fiddleId, buildingSoftwarePlacementKey]),
                    expandedVirtualFolders: new Set()
                },
                showHiddenItems: false,
                includeDescendantNotes: true,
                sourceState: createSourceState({
                    propertyTree: new Map(),
                    visiblePropertyNavigationKeySet: new Set(['projects'])
                }),
                selectionScope: {
                    selectionType: ItemType.FOLDER,
                    selectedFolder: folder
                },
                tagTreeService: null,
                propertyTreeService: null
            });
            return null;
        }

        renderToStaticMarkup(React.createElement(Harness));

        expect(captured).not.toBeNull();
        if (!captured) {
            throw new Error('Expected hook result');
        }
        const result = captured as NavigationPaneTreeSectionsResult;

        expect(describePropertyItems(result.propertyItems)).toEqual([
            [NavigationPaneItemType.PROPERTY_KEY, buildPropertyKeyNodeId('projects'), 0],
            [NavigationPaneItemType.PROPERTY_VALUE, fiddleId, 1],
            [NavigationPaneItemType.PROPERTY_VALUE, buildingSoftwarePlacementKey, 2],
            [NavigationPaneItemType.PROPERTY_VALUE, buildPropertyPlacementKey([fiddleId, buildingSoftwareId, bulwarkId]), 3]
        ]);
    });

    it('renders a key flat when its hierarchical entry is present but false', () => {
        dbFileDataByPath.clear();

        // sanitizeRecord keeps false values, and the service reader requires === true, so a
        // hand-edited data.json holding {"projects": false} must render exactly as an absent entry
        // does. Reading Object.keys instead rendered it hierarchical while the menu checkmark was off.
        const buildingSoftwareFile = createTestTFile('notes/project/Building software.md');
        const bulwarkFile = createTestTFile('notes/project/Bulwark.md');
        dbFileDataByPath.set(buildingSoftwareFile.path, {
            tags: null,
            properties: [{ fieldKey: 'Projects', value: '[[Fiddle]]', valueKind: 'string' }]
        });
        dbFileDataByPath.set(bulwarkFile.path, {
            tags: null,
            properties: [{ fieldKey: 'Projects', value: '[[Building software]]', valueKind: 'string' }]
        });

        const folder = createFolder('notes/project', [buildingSoftwareFile, bulwarkFile]);
        Reflect.set(buildingSoftwareFile, 'parent', folder);
        Reflect.set(bulwarkFile, 'parent', folder);

        const app = new App();
        app.metadataCache.getFirstLinkpathDest = (linkpath: string) => (linkpath === 'Building software' ? buildingSoftwareFile : null);

        const fiddleId = buildPropertyValueNodeId('projects', 'fiddle');
        const buildingSoftwareId = buildPropertyValueNodeId('projects', 'building software');

        const result = renderPropertySection({
            app,
            settings: createSettings({
                showTags: false,
                showProperties: true,
                showAllPropertiesFolder: false,
                scopeTagsToCurrentContext: false,
                scopePropertiesToCurrentContext: true,
                propertyHierarchicalKeys: { projects: false }
            }),
            expandedProperties: new Set([buildPropertyKeyNodeId('projects'), fiddleId]),
            folder,
            visiblePropertyNavigationKeySet: new Set(['projects'])
        });

        // Both values at the same level, keyed by node id, and no index at all.
        expect(describePropertyItems(result.propertyItems)).toEqual([
            [NavigationPaneItemType.PROPERTY_KEY, buildPropertyKeyNodeId('projects'), 0],
            [NavigationPaneItemType.PROPERTY_VALUE, buildingSoftwareId, 1],
            [NavigationPaneItemType.PROPERTY_VALUE, fiddleId, 1]
        ]);
        expect(result.propertyHierarchyIndex.rootIds.size).toBe(0);
    });

    it('gives a placement at the depth cap no chevron, because expanding it emits nothing', () => {
        dbFileDataByPath.clear();

        // Work <- Clients <- Acme, rendered with the cap at one level of nesting. Clients.md is what
        // makes "Work" a value node, Acme.md makes "Clients" one, and uses-acme.md makes "Acme" one.
        const clientsFile = createTestTFile('notes/project/Clients.md');
        const acmeFile = createTestTFile('notes/project/Acme.md');
        const usesAcmeFile = createTestTFile('notes/project/uses-acme.md');
        dbFileDataByPath.set(clientsFile.path, {
            tags: null,
            properties: [{ fieldKey: 'Projects', value: '[[Work]]', valueKind: 'string' }]
        });
        dbFileDataByPath.set(acmeFile.path, {
            tags: null,
            properties: [{ fieldKey: 'Projects', value: '[[Clients]]', valueKind: 'string' }]
        });
        dbFileDataByPath.set(usesAcmeFile.path, {
            tags: null,
            properties: [{ fieldKey: 'Projects', value: '[[Acme]]', valueKind: 'string' }]
        });

        const folder = createFolder('notes/project', [clientsFile, acmeFile, usesAcmeFile]);
        Reflect.set(clientsFile, 'parent', folder);
        Reflect.set(acmeFile, 'parent', folder);
        Reflect.set(usesAcmeFile, 'parent', folder);

        const app = new App();
        // "Work" resolves to no note, which is what makes it a root; the other two resolve, which is
        // what nests Clients under Work and Acme under Clients.
        app.metadataCache.getFirstLinkpathDest = (linkpath: string) =>
            linkpath === 'Clients' ? clientsFile : linkpath === 'Acme' ? acmeFile : null;

        const workId = buildPropertyValueNodeId('projects', 'work');
        const clientsId = buildPropertyValueNodeId('projects', 'clients');
        const acmeId = buildPropertyValueNodeId('projects', 'acme');
        const renderParams = {
            app,
            settings: createSettings({
                showTags: false,
                showProperties: true,
                showAllPropertiesFolder: false,
                scopeTagsToCurrentContext: false,
                scopePropertiesToCurrentContext: true,
                propertyHierarchicalKeys: { projects: true },
                propertyHierarchyMaxDepth: 1
            }),
            expandedProperties: new Set([buildPropertyKeyNodeId('projects'), workId]),
            folder,
            visiblePropertyNavigationKeySet: new Set(['projects'])
        };

        const result = renderPropertySection(renderParams);

        expect(describePropertyItems(result.propertyItems)).toEqual([
            [NavigationPaneItemType.PROPERTY_KEY, buildPropertyKeyNodeId('projects'), 0],
            [NavigationPaneItemType.PROPERTY_VALUE, workId, 1],
            [NavigationPaneItemType.PROPERTY_VALUE, buildPropertyPlacementKey([workId, clientsId]), 2]
        ]);

        // The index is depth independent by design, so it still reports Acme under Clients. Only the
        // chevron has to know that this placement sits at the cap.
        expect(result.propertyHierarchyIndex.childIds.get(clientsId)).toEqual([acmeId]);
        expect((result.propertyItems[1] as PropertyValueTreeItem).hasChildren).toBe(true);
        expect((result.propertyItems[2] as PropertyValueTreeItem).hasChildren).toBe(false);

        expectChevronsMatchFlattenedRows(renderParams);
    });

    it('gives a placement whose only child is its own ancestor no chevron', () => {
        dbFileDataByPath.clear();

        // A.md carries topics: [[B]] and B.md carries topics: [[A]], so each is the other's parent and
        // both are promoted to roots. Under A, B's only child is A, which A's own chain already holds.
        const aFile = createTestTFile('notes/project/A.md');
        const bFile = createTestTFile('notes/project/B.md');
        dbFileDataByPath.set(aFile.path, {
            tags: null,
            properties: [{ fieldKey: 'Topics', value: '[[B]]', valueKind: 'string' }]
        });
        dbFileDataByPath.set(bFile.path, {
            tags: null,
            properties: [{ fieldKey: 'Topics', value: '[[A]]', valueKind: 'string' }]
        });

        const folder = createFolder('notes/project', [aFile, bFile]);
        Reflect.set(aFile, 'parent', folder);
        Reflect.set(bFile, 'parent', folder);

        const app = new App();
        app.metadataCache.getFirstLinkpathDest = (linkpath: string) => (linkpath === 'A' ? aFile : linkpath === 'B' ? bFile : null);

        const aId = buildPropertyValueNodeId('topics', 'a');
        const bId = buildPropertyValueNodeId('topics', 'b');
        const renderParams = {
            app,
            settings: createSettings({
                showTags: false,
                showProperties: true,
                showAllPropertiesFolder: false,
                scopeTagsToCurrentContext: false,
                scopePropertiesToCurrentContext: true,
                propertyHierarchicalKeys: { topics: true }
            }),
            expandedProperties: new Set([buildPropertyKeyNodeId('topics'), aId, bId]),
            folder,
            visiblePropertyNavigationKeySet: new Set(['topics'])
        };

        const result = renderPropertySection(renderParams);

        expect(describePropertyItems(result.propertyItems)).toEqual([
            [NavigationPaneItemType.PROPERTY_KEY, buildPropertyKeyNodeId('topics'), 0],
            [NavigationPaneItemType.PROPERTY_VALUE, aId, 1],
            [NavigationPaneItemType.PROPERTY_VALUE, buildPropertyPlacementKey([aId, bId]), 2],
            [NavigationPaneItemType.PROPERTY_VALUE, bId, 1],
            [NavigationPaneItemType.PROPERTY_VALUE, buildPropertyPlacementKey([bId, aId]), 2]
        ]);

        expect(result.propertyHierarchyIndex.childIds.get(bId)).toEqual([aId]);
        expect((result.propertyItems[2] as PropertyValueTreeItem).hasChildren).toBe(false);
        expect((result.propertyItems[4] as PropertyValueTreeItem).hasChildren).toBe(false);

        expectChevronsMatchFlattenedRows(renderParams);
    });

    it('expands one placement of a multi-parent value without expanding the other', () => {
        dbFileDataByPath.clear();

        // Clients.md carries categories: [[Areas]], [[Categories]], giving Clients two parents -
        // the same shape as the real vault (Clients under both Areas and Categories). Acme.md
        // carries categories: [[Clients]], and uses-acme.md is what makes "Acme" a value node of
        // categories at all: it is the note that carries categories: [[Acme]].
        const clientsFile = createTestTFile('notes/project/Clients.md');
        const acmeFile = createTestTFile('notes/project/Acme.md');
        const usesAcmeFile = createTestTFile('notes/project/uses-acme.md');
        dbFileDataByPath.set(clientsFile.path, {
            tags: null,
            properties: [
                { fieldKey: 'Categories', value: '[[Areas]]', valueKind: 'string' },
                { fieldKey: 'Categories', value: '[[Categories]]', valueKind: 'string' }
            ]
        });
        dbFileDataByPath.set(acmeFile.path, {
            tags: null,
            properties: [{ fieldKey: 'Categories', value: '[[Clients]]', valueKind: 'string' }]
        });
        dbFileDataByPath.set(usesAcmeFile.path, {
            tags: null,
            properties: [{ fieldKey: 'Categories', value: '[[Acme]]', valueKind: 'string' }]
        });

        const folder = createFolder('notes/project', [clientsFile, acmeFile, usesAcmeFile]);
        Reflect.set(clientsFile, 'parent', folder);
        Reflect.set(acmeFile, 'parent', folder);
        Reflect.set(usesAcmeFile, 'parent', folder);

        const app = new App();
        app.metadataCache.getFirstLinkpathDest = (linkpath: string) =>
            linkpath === 'Clients' ? clientsFile : linkpath === 'Acme' ? acmeFile : null;

        const areasId = buildPropertyValueNodeId('categories', 'areas');
        const categoriesId = buildPropertyValueNodeId('categories', 'categories');
        const clientsId = buildPropertyValueNodeId('categories', 'clients');
        const acmeId = buildPropertyValueNodeId('categories', 'acme');
        const clientsUnderAreas = buildPropertyPlacementKey([areasId, clientsId]);
        const clientsUnderCategories = buildPropertyPlacementKey([categoriesId, clientsId]);

        let captured: NavigationPaneTreeSectionsResult | null = null;

        function Harness() {
            captured = useNavigationPaneTreeSections({
                app,
                settings: createSettings({
                    showTags: false,
                    showProperties: true,
                    showAllPropertiesFolder: false,
                    scopeTagsToCurrentContext: false,
                    scopePropertiesToCurrentContext: true,
                    propertyHierarchicalKeys: { categories: true }
                }),
                expansionState: {
                    expandedFolders: new Set(),
                    expandedTags: new Set(),
                    // Both root placements (Areas, Categories) are expanded, but only the Areas
                    // placement of Clients is - the Categories placement of Clients must stay collapsed.
                    expandedProperties: new Set([buildPropertyKeyNodeId('categories'), areasId, categoriesId, clientsUnderAreas]),
                    expandedVirtualFolders: new Set()
                },
                showHiddenItems: false,
                includeDescendantNotes: true,
                sourceState: createSourceState({
                    propertyTree: new Map(),
                    visiblePropertyNavigationKeySet: new Set(['categories'])
                }),
                selectionScope: {
                    selectionType: ItemType.FOLDER,
                    selectedFolder: folder
                },
                tagTreeService: null,
                propertyTreeService: null
            });
            return null;
        }

        renderToStaticMarkup(React.createElement(Harness));

        expect(captured).not.toBeNull();
        if (!captured) {
            throw new Error('Expected hook result');
        }
        const result = captured as NavigationPaneTreeSectionsResult;

        // Clients appears under both Areas and Categories, but Acme (its only child) only renders
        // under the Areas placement, whose placement key is the one that was expanded.
        expect(describePropertyItems(result.propertyItems)).toEqual([
            [NavigationPaneItemType.PROPERTY_KEY, buildPropertyKeyNodeId('categories'), 0],
            [NavigationPaneItemType.PROPERTY_VALUE, areasId, 1],
            [NavigationPaneItemType.PROPERTY_VALUE, clientsUnderAreas, 2],
            [NavigationPaneItemType.PROPERTY_VALUE, buildPropertyPlacementKey([areasId, clientsId, acmeId]), 3],
            [NavigationPaneItemType.PROPERTY_VALUE, categoriesId, 1],
            [NavigationPaneItemType.PROPERTY_VALUE, clientsUnderCategories, 2]
        ]);
    });
});
