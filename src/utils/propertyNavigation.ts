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

import type { ExpansionAction } from '../context/ExpansionContext';
import type { SelectionAction, SelectionRevealSource } from '../context/SelectionContext';
import type { ContentPane } from '../context/UIStateContext';
import { ItemType, PROPERTIES_ROOT_VIRTUAL_FOLDER_ID } from '../types';
import {
    getPropertyKeyNodeIdFromNodeId,
    normalizePropertyNodeId,
    resolvePropertySelectionNodeId,
    type PropertySelectionNodeId
} from './propertyTree';
import type { PropertyTreeNode } from '../types/storage';
import { expandNavigationTreeItems } from './navigationExpansion';
import { getPropertyPlacementAncestorKeys } from './treeFlattener';
import { resolvePropertyRevealChain, type PropertyHierarchyIndex } from './propertyHierarchy';

type Dispatch<T> = (action: T) => void;

export interface NavigateToPropertyOptions {
    skipScroll?: boolean;
    source?: SelectionRevealSource;
    preserveNavigationFocus?: boolean;
    requirePropertyInTree?: boolean;
    skipFocus?: boolean;
    historyIndex?: number;
    /**
     * Suppresses the selection provider's auto-selected first file for this dispatch by
     * passing `autoSelectedFile: null` explicitly (as opposed to leaving it undefined, which
     * lets the provider resolve one). Defaults to off so every existing caller - auto-reveal,
     * startup, tag fallback - keeps resolving a first file exactly as it does today. Callers
     * that are about to open a property note themselves must set this, or the list pane's
     * auto-selected first file opens in a post-render effect and replaces that note.
     */
    suppressAutoSelect?: boolean;
}

export interface PropertyNavigationEnvironment {
    showProperties: boolean;
    showAllPropertiesFolder: boolean;
    propertyTree: ReadonlyMap<string, PropertyTreeNode>;
    expandedProperties: Set<string>;
    expandedVirtualFolders: Set<string>;
    collapseOtherBranchesOnExpand?: boolean;
    expansionDispatch: Dispatch<ExpansionAction>;
    selectionDispatch: Dispatch<SelectionAction>;
    activatePane: (target: ContentPane) => void;
    resolveSelectionNodeId?: (nodeId: PropertySelectionNodeId) => PropertySelectionNodeId;
    /**
     * Additive nesting over the value nodes of keys marked Hierarchical, surfaced on the tree
     * sections result, together with the depth cap the pane renders it with. Lets reveal expand every
     * ancestor placement of a nested value, not just its key. Optional because not every caller of
     * navigateToProperty has a navigation pane render to read it from; omitting it just means a
     * hierarchical value reveals no deeper than its key, same as before the index existed.
     *
     * The two travel together deliberately: a chain resolved without the cap can be deeper than the
     * pane will ever render, and expanding prefixes of a row that cannot appear is not free. With
     * collapseOtherBranchesOnExpand on it replaces the whole expanded set.
     */
    propertyHierarchy?: { index: PropertyHierarchyIndex; maxDepth: number };
    requestScroll?: (nodeId: PropertySelectionNodeId, options: { align: 'auto'; itemType: typeof ItemType.PROPERTY }) => void;
}

function resolveTargetNodeId(
    env: PropertyNavigationEnvironment,
    nodeId: PropertySelectionNodeId,
    options?: NavigateToPropertyOptions
): PropertySelectionNodeId | null {
    if (nodeId === PROPERTIES_ROOT_VIRTUAL_FOLDER_ID) {
        return nodeId;
    }

    const resolvedNodeId = env.resolveSelectionNodeId
        ? env.resolveSelectionNodeId(nodeId)
        : resolvePropertySelectionNodeId(env.propertyTree, nodeId);

    if (resolvedNodeId === PROPERTIES_ROOT_VIRTUAL_FOLDER_ID) {
        const requirePropertyInTree = options?.requirePropertyInTree ?? true;
        if (requirePropertyInTree) {
            return null;
        }

        return nodeId;
    }

    return resolvedNodeId;
}

function selectPropertyAndFocus(
    env: PropertyNavigationEnvironment,
    nodeId: PropertySelectionNodeId,
    options?: NavigateToPropertyOptions
): void {
    env.selectionDispatch({
        type: 'SET_SELECTED_PROPERTY',
        nodeId,
        source: options?.source,
        historyIndex: options?.historyIndex,
        autoSelectedFile: options?.suppressAutoSelect ? null : undefined
    });

    if (options?.skipFocus) {
        return;
    }

    const preserveNavigationFocus = options?.preserveNavigationFocus ?? true;
    env.activatePane(preserveNavigationFocus ? 'navigation' : 'files');
}

/**
 * Selects a property node in the navigation pane, expands parent nodes, manages focus,
 * and optionally requests scrolling.
 * Returns the resolved selection node id when navigation succeeded, otherwise null.
 */
export function navigateToProperty(
    env: PropertyNavigationEnvironment,
    propertyNodeId: string,
    options?: NavigateToPropertyOptions
): PropertySelectionNodeId | null {
    const normalizedNodeId =
        propertyNodeId === PROPERTIES_ROOT_VIRTUAL_FOLDER_ID ? PROPERTIES_ROOT_VIRTUAL_FOLDER_ID : normalizePropertyNodeId(propertyNodeId);
    if (!normalizedNodeId) {
        return null;
    }

    const resolvedNodeId = resolveTargetNodeId(env, normalizedNodeId, options);
    if (!resolvedNodeId) {
        return null;
    }

    if (env.showProperties && env.showAllPropertiesFolder && !env.expandedVirtualFolders.has(PROPERTIES_ROOT_VIRTUAL_FOLDER_ID)) {
        const nextExpanded = new Set(env.expandedVirtualFolders);
        nextExpanded.add(PROPERTIES_ROOT_VIRTUAL_FOLDER_ID);
        env.expansionDispatch({ type: 'SET_EXPANDED_VIRTUAL_FOLDERS', folders: nextExpanded });
    }

    const keyNodeId =
        resolvedNodeId !== PROPERTIES_ROOT_VIRTUAL_FOLDER_ID
            ? getPropertyKeyNodeIdFromNodeId(resolvedNodeId)
            : PROPERTIES_ROOT_VIRTUAL_FOLDER_ID;
    const hasOwnKeyNode = Boolean(keyNodeId) && keyNodeId !== PROPERTIES_ROOT_VIRTUAL_FOLDER_ID && keyNodeId !== resolvedNodeId;

    // A hierarchical value nested under other values needs every ancestor placement expanded too, not
    // just the key, or the flattener never recurses far enough to emit the target's own row. A
    // non-hierarchical value, a key node, or the root sentinel all resolve to no chain or a
    // single-element one here, which yields no ancestor keys and preserves today's key-only expansion
    // for those exactly.
    const revealChain =
        env.propertyHierarchy && keyNodeId && resolvedNodeId !== PROPERTIES_ROOT_VIRTUAL_FOLDER_ID
            ? resolvePropertyRevealChain({
                  index: env.propertyHierarchy.index,
                  keyNodeId,
                  nodeId: resolvedNodeId,
                  maxDepth: env.propertyHierarchy.maxDepth
              })
            : null;
    const ancestorPlacementKeys = revealChain ? getPropertyPlacementAncestorKeys(revealChain) : [];

    // The full list, always including the key node, then dispatched only when something in it is not
    // already expanded - the same shape navigateToTag uses. Both halves matter: with
    // collapseOtherBranchesOnExpand on this becomes SET_EXPANDED_PROPERTIES, which replaces the whole
    // expanded set, so omitting the already-expanded key would collapse the entire property; and
    // dispatching when nothing needs expanding still allocates a new Set, which is a state change that
    // can re-run the effects revealProperty is a dependency of, writing localStorage every pass.
    const idsToExpand = [...(hasOwnKeyNode && keyNodeId ? [keyNodeId] : []), ...ancestorPlacementKeys];
    const needsExpansion = idsToExpand.some(id => !env.expandedProperties.has(id));
    if (needsExpansion) {
        expandNavigationTreeItems({
            type: 'property',
            ids: idsToExpand,
            collapseOtherBranches: Boolean(env.collapseOtherBranchesOnExpand),
            dispatch: env.expansionDispatch
        });
    }

    selectPropertyAndFocus(env, resolvedNodeId, options);

    const shouldSkipScroll = Boolean(options?.skipScroll);
    if (!shouldSkipScroll && env.requestScroll) {
        env.requestScroll(resolvedNodeId, { align: 'auto', itemType: ItemType.PROPERTY });
    }

    return resolvedNodeId;
}
