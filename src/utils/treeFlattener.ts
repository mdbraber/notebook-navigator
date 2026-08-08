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

import { TFolder } from 'obsidian';
import { compareByAlphaSortOrder, naturalCompare, resolveFolderChildSortOrder } from './sortUtils';
import { NavigationPaneItemType } from '../types';
import { PropertyTreeNode, TagTreeNode, type PropertyNodeComparator } from '../types/storage';
import type { FolderTreeItem, TagTreeItem, PropertyValueTreeItem } from '../types/virtualization';
import { isFolderInExcludedFolder } from './fileFilters';
import { matchesHiddenTagPattern, HiddenTagMatcher } from './tagPrefixMatcher';
import type { AlphaSortOrder } from '../settings/types';
import type { PropertyHierarchyIndex } from './propertyHierarchy';

/** Options for flattenFolderTree function */
interface FlattenFolderTreeOptions {
    /** Map of folder paths to their custom display order */
    rootOrderMap?: Map<string, number>;
    /** Default alphabetical order for child folders */
    defaultSortOrder?: AlphaSortOrder;
    /** Per-folder child sort order overrides */
    childSortOrderOverrides?: Record<string, AlphaSortOrder>;
    /** Resolves the string used when alphabetically sorting folders */
    getFolderSortName?: (folder: TFolder) => string;
    /** Additional exclusion check applied per folder */
    isFolderExcluded?: (folder: TFolder) => boolean;
}

interface BuildVisibleFolderTraversalStateParams extends FlattenFolderTreeOptions {
    /** Root folders used by the navigation tree. May be the vault root or ordered root-level folders. */
    rootFolders: TFolder[];
    /** Patterns used to exclude folders from navigation and rainbow assignment. */
    excludePatterns: string[];
    /** Whether child sibling groups should be traversed beyond the root level. */
    includeDescendantSiblingGroups?: boolean;
}

interface WalkOrderedFolderTreeParams extends FlattenFolderTreeOptions {
    rootFolders: TFolder[];
    excludePatterns: string[];
    level?: number;
    visitedPaths?: Set<string>;
    onFolder?: (params: { folder: TFolder; level: number; isExcluded: boolean; parentPath: string }) => void;
    onSiblingGroup?: (params: {
        parentPath: string;
        level: number;
        entries: readonly { folder: TFolder; level: number; isExcluded: boolean; parentPath: string }[];
    }) => void;
    shouldVisitChildren?: (params: { folder: TFolder; level: number; isExcluded: boolean; parentPath: string }) => boolean;
}

/** Options for flattenTagTree function */
interface FlattenTagTreeOptions {
    /** Matcher for determining hidden tags */
    hiddenMatcher?: HiddenTagMatcher;
    /** Custom comparator for sorting tag nodes */
    comparator?: (a: TagTreeNode, b: TagTreeNode) => number;
    /** Per-tag child sort order overrides */
    childSortOrderOverrides?: Record<string, AlphaSortOrder>;
}

/**
 * Compares folders using custom order map with fallback to natural sorting.
 * Returns negative if a comes before b, positive if b comes before a, 0 if equal.
 */
export function compareFolderOrderWithFallback(
    a: TFolder,
    b: TFolder,
    orderMap?: Map<string, number>,
    fallback?: (first: TFolder, second: TFolder) => number
): number {
    const fallbackCompare = fallback ?? ((first: TFolder, second: TFolder) => naturalCompare(first.name, second.name));

    if (!orderMap || orderMap.size === 0) {
        return fallbackCompare(a, b);
    }

    const orderA = orderMap.get(a.path);
    const orderB = orderMap.get(b.path);

    if (orderA !== undefined && orderB !== undefined) {
        return orderA - orderB;
    }
    if (orderA !== undefined) {
        return -1;
    }
    if (orderB !== undefined) {
        return 1;
    }
    return fallbackCompare(a, b);
}

/**
 * Compares tags using custom order map with fallback to provided comparator or natural order.
 * Returns negative if a comes before b, positive if b comes before a, 0 if equal.
 */
export function compareTagOrderWithFallback(
    a: TagTreeNode,
    b: TagTreeNode,
    orderMap?: Map<string, number>,
    fallback?: (first: TagTreeNode, second: TagTreeNode) => number
): number {
    if (!orderMap || orderMap.size === 0) {
        return fallback ? fallback(a, b) : naturalCompare(a.name, b.name);
    }

    const orderA = orderMap.get(a.path);
    const orderB = orderMap.get(b.path);

    if (orderA !== undefined && orderB !== undefined) {
        return orderA - orderB;
    }
    if (orderA !== undefined) {
        return -1;
    }
    if (orderB !== undefined) {
        return 1;
    }
    return fallback ? fallback(a, b) : naturalCompare(a.name, b.name);
}

/**
 * Compares property key nodes using custom order map with fallback comparator or natural order.
 * Returns negative if a comes before b, positive if b comes before a, 0 if equal.
 */
export function comparePropertyOrderWithFallback(
    a: PropertyTreeNode,
    b: PropertyTreeNode,
    orderMap?: Map<string, number>,
    fallback?: (first: PropertyTreeNode, second: PropertyTreeNode) => number
): number {
    if (!orderMap || orderMap.size === 0) {
        return fallback ? fallback(a, b) : naturalCompare(a.name, b.name);
    }

    const orderA = orderMap.get(a.key);
    const orderB = orderMap.get(b.key);

    if (orderA !== undefined && orderB !== undefined) {
        return orderA - orderB;
    }
    if (orderA !== undefined) {
        return -1;
    }
    if (orderB !== undefined) {
        return 1;
    }
    return fallback ? fallback(a, b) : naturalCompare(a.name, b.name);
}

function walkOrderedFolderTree({
    rootFolders,
    excludePatterns,
    rootOrderMap,
    defaultSortOrder,
    childSortOrderOverrides,
    getFolderSortName,
    isFolderExcluded,
    level = 0,
    visitedPaths = new Set<string>(),
    onFolder,
    onSiblingGroup,
    shouldVisitChildren
}: WalkOrderedFolderTreeParams): void {
    const resolvedDefaultSortOrder = defaultSortOrder ?? 'alpha-asc';
    const childSortOrderSettings = {
        folderSortOrder: resolvedDefaultSortOrder,
        folderTreeSortOverrides: childSortOrderOverrides
    };

    const getEffectiveChildSortOrder = (folderPath: string): AlphaSortOrder => {
        return resolveFolderChildSortOrder(childSortOrderSettings, folderPath);
    };

    const compareFolderNames = (order: AlphaSortOrder) => (a: TFolder, b: TFolder) => {
        const leftName = getFolderSortName ? getFolderSortName(a) : a.name;
        const rightName = getFolderSortName ? getFolderSortName(b) : b.name;
        const cmp = compareByAlphaSortOrder(leftName, rightName, order);
        if (cmp !== 0) {
            return cmp;
        }
        return a.path.localeCompare(b.path);
    };

    const isExcluded = (folder: TFolder): boolean => {
        const isExcludedByPattern = excludePatterns.length > 0 && isFolderInExcludedFolder(folder, excludePatterns);
        const isExcludedByRule = isFolderExcluded ? isFolderExcluded(folder) : false;
        return isExcludedByPattern || isExcludedByRule;
    };

    const sortSiblingFolders = (folders: TFolder[], parentPath: string): TFolder[] => {
        if (folders.length <= 1) {
            return folders;
        }

        const order = getEffectiveChildSortOrder(parentPath);
        const compareByName = compareFolderNames(order);
        const sortedFolders = folders.slice();
        if (parentPath === '/') {
            return sortedFolders.sort((left, right) => compareFolderOrderWithFallback(left, right, rootOrderMap, compareByName));
        }
        return sortedFolders.sort(compareByName);
    };

    const walkChildren = (parentPath: string, folders: TFolder[], currentLevel: number) => {
        const entries = sortSiblingFolders(
            folders.filter(folder => !visitedPaths.has(folder.path)),
            parentPath
        ).map(folder => ({
            folder,
            level: currentLevel,
            isExcluded: isExcluded(folder),
            parentPath
        }));

        onSiblingGroup?.({
            parentPath,
            level: currentLevel,
            entries
        });

        entries.forEach(entry => {
            visitedPaths.add(entry.folder.path);
            onFolder?.(entry);

            if (shouldVisitChildren?.(entry) === false) {
                return;
            }

            const childFolders = entry.folder.children.filter((child): child is TFolder => child instanceof TFolder);
            if (childFolders.length === 0) {
                return;
            }

            walkChildren(entry.folder.path, childFolders, currentLevel + 1);
        });
    };

    if (rootFolders.length === 1 && rootFolders[0]?.path === '/') {
        const rootFolder = rootFolders[0];
        if (visitedPaths.has(rootFolder.path)) {
            return;
        }

        const rootEntry = {
            folder: rootFolder,
            level,
            isExcluded: isExcluded(rootFolder),
            parentPath: ''
        };
        visitedPaths.add(rootFolder.path);
        onFolder?.(rootEntry);

        if (shouldVisitChildren?.(rootEntry) === false) {
            return;
        }

        const rootChildren = rootFolder.children.filter((child): child is TFolder => child instanceof TFolder);
        if (rootChildren.length > 0) {
            walkChildren('/', rootChildren, level + 1);
        }
        return;
    }

    walkChildren('/', rootFolders, level);
}

/**
 * Flattens a folder tree into a linear array for virtualization.
 * Only includes folders that are visible based on the expanded state.
 *
 * @param folders - Array of root folders to flatten
 * @param expandedFolders - Set of expanded folder paths
 * @param excludePatterns - Patterns for folders to exclude
 * @param level - Current nesting level (for indentation)
 * @returns Array of flattened folder items
 */
export function flattenFolderTree(
    folders: TFolder[],
    expandedFolders: Set<string>,
    excludePatterns: string[],
    level: number = 0,
    visitedPaths: Set<string> = new Set(),
    options: FlattenFolderTreeOptions = {}
): FolderTreeItem[] {
    const items: FolderTreeItem[] = [];
    walkOrderedFolderTree({
        rootFolders: folders,
        excludePatterns,
        rootOrderMap: options.rootOrderMap,
        defaultSortOrder: options.defaultSortOrder,
        childSortOrderOverrides: options.childSortOrderOverrides,
        getFolderSortName: options.getFolderSortName,
        isFolderExcluded: options.isFolderExcluded,
        level,
        visitedPaths,
        onFolder: ({ folder, level: folderLevel, isExcluded }) => {
            const folderItem: FolderTreeItem = {
                type: NavigationPaneItemType.FOLDER,
                data: folder,
                level: folderLevel,
                path: folder.path,
                key: folder.path
            };

            if (isExcluded) {
                folderItem.isExcluded = true;
            }

            items.push(folderItem);
        },
        shouldVisitChildren: ({ folder }) => expandedFolders.has(folder.path)
    });

    return items;
}

export interface VisibleFolderTraversalState {
    siblingPathsByParent: Map<string, readonly string[]>;
}

export function buildVisibleFolderTraversalState({
    rootFolders,
    excludePatterns,
    rootOrderMap,
    defaultSortOrder,
    childSortOrderOverrides,
    getFolderSortName,
    isFolderExcluded,
    includeDescendantSiblingGroups = true
}: BuildVisibleFolderTraversalStateParams): VisibleFolderTraversalState {
    const siblingPathsByParent = new Map<string, readonly string[]>();
    walkOrderedFolderTree({
        rootFolders,
        excludePatterns,
        rootOrderMap,
        defaultSortOrder,
        childSortOrderOverrides,
        getFolderSortName,
        isFolderExcluded,
        onSiblingGroup: ({ parentPath, entries }) => {
            siblingPathsByParent.set(
                parentPath,
                entries.filter(entry => !entry.isExcluded).map(entry => entry.folder.path)
            );
        },
        shouldVisitChildren: ({ folder }) => {
            if (includeDescendantSiblingGroups) {
                return true;
            }
            return folder.path === '/';
        }
    });
    return {
        siblingPathsByParent
    };
}

/**
 * Flattens a tag tree into a linear array for virtualization.
 * Only includes tags that are visible based on the expanded state.
 *
 * @param tagNodes - Array of root tag nodes to flatten
 * @param expandedTags - Set of expanded tag paths
 * @param level - Current nesting level (for indentation)
 * @param options - Configuration options for flattening behavior
 * @returns Array of flattened tag items
 */
export function flattenTagTree(
    tagNodes: TagTreeNode[],
    expandedTags: Set<string>,
    level: number = 0,
    options: FlattenTagTreeOptions = {}
): TagTreeItem[] {
    const items: TagTreeItem[] = [];
    const { hiddenMatcher, comparator, childSortOrderOverrides } = options;
    /** Use custom comparator or default to alphabetical sorting */
    const sortFn = comparator ?? ((a: TagTreeNode, b: TagTreeNode) => naturalCompare(a.name, b.name));

    /** Sort tags using the selected comparator */
    const sortedNodes = tagNodes.slice().sort(sortFn);

    const compareAlphaNodes = (order: AlphaSortOrder) => (a: TagTreeNode, b: TagTreeNode) => {
        const cmp = compareByAlphaSortOrder(a.name, b.name, order);
        if (cmp !== 0) {
            return cmp;
        }
        return a.path.localeCompare(b.path);
    };

    const getEffectiveChildComparator = (parentTagPath: string) => {
        if (childSortOrderOverrides && Object.prototype.hasOwnProperty.call(childSortOrderOverrides, parentTagPath)) {
            const override = childSortOrderOverrides[parentTagPath];
            if (override) {
                return compareAlphaNodes(override);
            }
        }
        return sortFn;
    };

    /** Recursively adds a tag node and its children to the items array */
    function addNode(node: TagTreeNode, currentLevel: number, parentHidden: boolean = false) {
        const matchesRule = hiddenMatcher ? matchesHiddenTagPattern(node.path, node.name, hiddenMatcher) : false;
        const isHidden = parentHidden || matchesRule;

        const item: TagTreeItem = {
            type: NavigationPaneItemType.TAG,
            data: node,
            level: currentLevel,
            path: node.path,
            key: node.path
        };

        // Mark tags that match hidden patterns (shows eye icon when visible)
        if (isHidden) {
            item.isHidden = true;
        }

        items.push(item);

        // Add children if expanded and has children
        if (expandedTags.has(node.path) && node.children && node.children.size > 0) {
            const childComparator = getEffectiveChildComparator(node.path);
            const sortedChildren = Array.from(node.children.values()).sort(childComparator);

            sortedChildren.forEach(child => addNode(child, currentLevel + 1, isHidden));
        }
    }

    sortedNodes.forEach(node => addNode(node, level));
    return items;
}

/**
 * Joins the value node ids of a placement's chain. A node id can contain both `:` and `/`, so the
 * separator is a NUL, which cannot occur in one. Same reason listItems.ts uses it for bucket keys.
 */
export const PROPERTY_PLACEMENT_SEPARATOR = String.fromCharCode(0);

/**
 * Identity of one placement of a value node in a hierarchical property tree. Tags key identity by
 * node.path; a DAG node has no single path, so the chain is accumulated while walking. A root's
 * chain is just its own node id, which is why turning Hierarchical on preserves persisted expansion
 * for root values.
 */
export function buildPropertyPlacementKey(chain: readonly string[]): string {
    return chain.join(PROPERTY_PLACEMENT_SEPARATOR);
}

/**
 * Placement keys of every ancestor of a chain, in root-to-parent order, excluding the chain's own
 * target. Auto-reveal expands these so every level between the key and the target actually renders:
 * without them the flattener never recurses far enough to emit the target's own row. A single-element
 * chain - a root placement, or any non-hierarchical value - yields nothing, which reproduces today's
 * key-only expansion for those cases exactly.
 */
export function getPropertyPlacementAncestorKeys(chain: readonly string[]): string[] {
    return chain.slice(0, -1).map((_, index) => buildPropertyPlacementKey(chain.slice(0, index + 1)));
}

interface FlattenPropertyHierarchyParams {
    keyNode: PropertyTreeNode;
    index: PropertyHierarchyIndex;
    /** Placement keys, not node ids. */
    expandedPlacements: ReadonlySet<string>;
    /** Level of the emitted root values. */
    level: number;
    /** Levels of nesting below the roots. A backstop against pathological data, not a style choice. */
    maxDepth: number;
    comparator: PropertyNodeComparator;
    getChildComparator?: (parentNodeId: string) => PropertyNodeComparator | undefined;
}

/**
 * Flattens a hierarchical property key into navigation items, one per placement. Mirrors
 * flattenTagTree, differing only in taking children from the hierarchy index rather than from
 * node.children, and in accumulating the placement key rather than reading a path off the node.
 */
export function flattenPropertyHierarchy({
    keyNode,
    index,
    expandedPlacements,
    level,
    maxDepth,
    comparator,
    getChildComparator
}: FlattenPropertyHierarchyParams): PropertyValueTreeItem[] {
    const items: PropertyValueTreeItem[] = [];

    const nodeById = new Map<string, PropertyTreeNode>();
    keyNode.children.forEach(node => {
        if (node.kind === 'value') {
            nodeById.set(node.id, node);
        }
    });

    const resolveNodes = (ids: readonly string[]): PropertyTreeNode[] =>
        ids.map(id => nodeById.get(id)).filter((node): node is PropertyTreeNode => node !== undefined);

    /**
     * Emits one placement and, when it is expanded, its children. chain carries the ancestor node
     * ids, which both forms the placement key and guards against cycles: the index may contain a
     * cycle edge, so a node already in this chain is not descended into again.
     */
    const addNode = (node: PropertyTreeNode, currentLevel: number, chain: readonly string[]): void => {
        const nextChain = [...chain, node.id];
        const placementKey = buildPropertyPlacementKey(nextChain);

        items.push({
            type: NavigationPaneItemType.PROPERTY_VALUE,
            data: node,
            level: currentLevel,
            key: placementKey
        });

        if (currentLevel - level >= maxDepth || !expandedPlacements.has(placementKey)) {
            return;
        }

        const childIds = index.childIds.get(node.id) ?? [];
        const children = resolveNodes(childIds).filter(child => !nextChain.includes(child.id));
        if (children.length === 0) {
            return;
        }

        const childComparator = getChildComparator?.(node.id) ?? comparator;
        children.sort(childComparator).forEach(child => addNode(child, currentLevel + 1, nextChain));
    };

    const roots = resolveNodes(index.rootIds.get(keyNode.id) ?? []);
    roots.sort(comparator).forEach(root => addNode(root, level, []));

    return items;
}
