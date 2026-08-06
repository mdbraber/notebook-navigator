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

import type { App, TFile } from 'obsidian';
import { ItemType } from '../types';
import type { NavigationItemType } from '../types';
import type { PropertyTreeNode } from '../types/storage';
import { parsePropertyLinkTarget } from './propertyUtils';
import {
    getPropertyKeyNodeIdFromNodeId,
    isPropertyTreeNodeId,
    normalizePropertyNodeId,
    type PropertySelectionNodeId
} from './propertyTree';
import type { SelectionRevealSource } from '../context/selection/types';

/**
 * Returns the wikilink target a property value points at, or null when the value is
 * not a strict wikilink. Uses the link target rather than the display text:
 * [[Fruits/Apple|Apple]] normalizes to the value node "apple" but points at "Fruits/Apple".
 */
export function getPropertyNoteLinkTarget(node: PropertyTreeNode | null): string | null {
    if (!node || node.kind !== 'value') {
        return null;
    }

    const assignmentValue = node.assignmentValue;
    if (!assignmentValue) {
        return null;
    }

    const linkTarget = parsePropertyLinkTarget(assignmentValue);
    if (!linkTarget || linkTarget.kind !== 'internal') {
        return null;
    }

    return linkTarget.target;
}

/**
 * A value node has no single source file, but link resolution needs one. The
 * lexicographically first referencing note is deterministic across rebuilds and
 * resolves the link exactly as Obsidian would from a note that uses the value.
 */
export function getPropertyNoteSourcePath(node: PropertyTreeNode): string {
    let earliest: string | null = null;

    for (const path of node.notesWithValue) {
        if (earliest === null || path < earliest) {
            earliest = path;
        }
    }

    return earliest ?? '';
}

/**
 * Resolves the note a property value points at, or null when the value is not a
 * wikilink or the link has no target file.
 */
export function resolvePropertyNote(node: PropertyTreeNode | null, app: App): TFile | null {
    if (!node) {
        return null;
    }

    const linkTarget = getPropertyNoteLinkTarget(node);
    if (!linkTarget) {
        return null;
    }

    return app.metadataCache.getFirstLinkpathDest(linkTarget, getPropertyNoteSourcePath(node));
}

export interface FindPropertyNoteValueNodeParams {
    /** Path of the file to look up. */
    filePath: string;
    /** Property tree to search. Already filtered to the keys the navigation pane shows. */
    propertyTree: ReadonlyMap<string, PropertyTreeNode> | null;
    app: App;
    /**
     * Node id to win ties. A note can define values under more than one key - Clients.md can be
     * both categories=clients and projects=clients - and moving the selection between equally
     * valid answers is churn. Passing the current selection keeps it when it is one of them.
     */
    preferNodeId?: string | null;
}

/**
 * Reverse of resolvePropertyNote: given a file, the property value whose wikilink points at it,
 * or null when the file defines no value. There is no index for this direction, so it resolves on
 * demand - a full pass costs well under a millisecond on a real vault, and runs once per reveal.
 */
export function findPropertyNoteValueNode({
    filePath,
    propertyTree,
    app,
    preferNodeId
}: FindPropertyNoteValueNodeParams): PropertyTreeNode | null {
    if (!propertyTree) {
        return null;
    }

    const matches: PropertyTreeNode[] = [];

    for (const keyNode of propertyTree.values()) {
        for (const valueNode of keyNode.children.values()) {
            const assignmentValue = valueNode.assignmentValue;
            // Cheap pre-filter: a value without link markup can never resolve to a note.
            if (!assignmentValue || !assignmentValue.includes('[[')) {
                continue;
            }

            if (resolvePropertyNote(valueNode, app)?.path !== filePath) {
                continue;
            }

            if (preferNodeId && valueNode.id === preferNodeId) {
                return valueNode;
            }

            matches.push(valueNode);
        }
    }

    if (matches.length === 0) {
        return null;
    }

    // The tree is a fresh map rebuilt from a database scan, so iteration order is not a stable
    // contract. Sorting keeps a note that defines values under several keys landing on the same
    // node every time instead of drifting between equally valid answers across rebuilds.
    matches.sort((a, b) => a.key.localeCompare(b.key) || (a.valuePath ?? '').localeCompare(b.valuePath ?? ''));

    return matches[0];
}

export interface ResolvePropertyRevealTargetParams {
    /** Whether property notes are enabled. */
    propertyNotesEnabled: boolean;
    /** The navigation pane's current selection type. */
    selectionType: NavigationItemType;
    /** The currently selected property node id, if any. */
    selectedProperty: PropertySelectionNodeId | null;
    /** What the core member-reveal resolved to: the current selection, a fallback, or null. */
    memberRevealTarget: PropertySelectionNodeId | null;
    /** The value this file defines, from findPropertyNoteValueNode. */
    definedValueNodeId: PropertySelectionNodeId | null;
}

/**
 * Picks where a reveal lands in the property tree, in order:
 *
 *  1. the current selection, when the file is one of its notes - the file stays visible in the
 *     list you are already browsing, which is what revealing means;
 *  2. the value the file defines, when it is a property note - a property note is not a member of
 *     any value, so without this the fallback below sends the selection somewhere unrelated: the
 *     note for [[Meetings]] carries categories: [[Contexts]] and drags the pane onto Contexts;
 *  3. whatever core resolved by membership, unchanged.
 *
 * Step 2 sits second on purpose. A property note is absent from the list of the value it defines
 * - that list holds the value's members - so landing there hides the very file being revealed.
 * It is the right answer only when step 1 has nothing to offer.
 */
export function resolvePropertyRevealTarget({
    propertyNotesEnabled,
    selectionType,
    selectedProperty,
    memberRevealTarget,
    definedValueNodeId
}: ResolvePropertyRevealTargetParams): PropertySelectionNodeId | null {
    if (!propertyNotesEnabled || selectionType !== ItemType.PROPERTY || !definedValueNodeId) {
        return memberRevealTarget;
    }

    // Core returning the selection unchanged means the file is one of its notes - step 1 holds.
    const memberRevealKeptSelection = memberRevealTarget !== null && memberRevealTarget === selectedProperty;
    if (memberRevealKeptSelection) {
        return memberRevealTarget;
    }

    return definedValueNodeId;
}

export interface PropertyNoteLensJump {
    /** The value node the reveal should land on. */
    targetProperty: PropertySelectionNodeId;
    /** The key node to expand so the value node is visible, or null when there is nothing to expand. */
    keyNodeId: string | null;
}

export interface ResolvePropertyNoteLensJumpParams {
    /** showProperties && enablePropertyNotes && autoRevealPropertyNote. */
    enabled: boolean;
    /** How the reveal was triggered. Only auto-reveal and startup may change the lens. */
    revealSource: SelectionRevealSource | undefined;
    /** The navigation pane's current selection type. */
    selectionType: NavigationItemType;
    /** Path of the file being revealed. */
    filePath: string;
    /** Property tree to search. Already filtered to the keys the navigation pane shows. */
    propertyTree: ReadonlyMap<string, PropertyTreeNode> | null;
    app: App;
}

/**
 * Whether a reveal should leave the current lens and land in the properties tree, and where.
 *
 * Reveal everywhere else in the navigator is containment-based: the target holds the revealed file
 * in its list. A property note is not a member of the value it defines, so containment can never
 * find it, and the only way to reveal one as a property note is to switch lens deliberately.
 */
export function resolvePropertyNoteLensJump({
    enabled,
    revealSource,
    selectionType,
    filePath,
    propertyTree,
    app
}: ResolvePropertyNoteLensJumpParams): PropertyNoteLensJump | null {
    if (!enabled) {
        return null;
    }

    // Shortcuts, recent notes, the homepage's manual trigger and the public API all reach the same
    // reveal function. Those act from inside the navigation pane, where the tree is already visible
    // and the user did not ask to leave it, so only auto-reveal and startup may change the lens.
    if (revealSource !== 'auto' && revealSource !== 'startup') {
        return null;
    }

    // Already in the property tree: resolvePropertyRevealTarget owns that case and resolves a
    // property note correctly without a lens change.
    if (selectionType === ItemType.PROPERTY) {
        return null;
    }

    const valueNode = findPropertyNoteValueNode({ filePath, propertyTree, app });
    if (!valueNode) {
        return null;
    }

    const targetProperty = normalizePropertyNodeId(valueNode.id);
    if (!targetProperty) {
        return null;
    }

    const rawKeyNodeId = getPropertyKeyNodeIdFromNodeId(targetProperty);
    const keyNodeId = rawKeyNodeId && rawKeyNodeId !== targetProperty && isPropertyTreeNodeId(rawKeyNodeId) ? rawKeyNodeId : null;

    return { targetProperty, keyNodeId };
}

export interface ShouldOpenPropertyNoteOnEnterParams {
    /** Whether the triggering keyboard event was the Enter key. */
    isEnterKey: boolean;
    /** Whether property notes and their name-click/Enter links are both enabled. */
    propertyNoteLinksEnabled: boolean;
    /** The navigation pane's current selection type. */
    selectionType: NavigationItemType;
    /** The currently selected property node id, if any. */
    selectedProperty: PropertySelectionNodeId | null;
}

/**
 * Decides whether an explicit-activation keyboard event should trigger opening
 * the note a property value's wikilink points at.
 *
 * This is deliberately restricted to Enter. Arrow-key (and other highlight-only)
 * navigation must never open a note — that is the single worst failure mode for
 * this feature. Keeping the decision in a pure, exported function lets that
 * requirement be pinned by a direct test instead of being assumed from reading
 * the call site.
 */
export function shouldOpenPropertyNoteOnEnter({
    isEnterKey,
    propertyNoteLinksEnabled,
    selectionType,
    selectedProperty
}: ShouldOpenPropertyNoteOnEnterParams): boolean {
    return isEnterKey && propertyNoteLinksEnabled && selectionType === ItemType.PROPERTY && Boolean(selectedProperty);
}
