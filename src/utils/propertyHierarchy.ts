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

import type { PropertyTreeNode, PropertyTreeNodeId } from '../types/storage';
import type { NoteCountInfo } from '../types/noteCounts';

/**
 * Additive hierarchy over a property key's value nodes. The property tree itself is never
 * reparented: twenty sites assume a value node is a direct child of its key, including the lookup
 * property notes resolve through, so the nesting lives here instead and is keyed by existing node ids.
 */
export interface PropertyHierarchyIndex {
    /** Key node id to the value node ids rendered at that key's root. */
    rootIds: ReadonlyMap<string, readonly string[]>;
    /** Value node id to its child value node ids. May contain cycles; walkers must guard. */
    childIds: ReadonlyMap<string, readonly string[]>;
    /** Value node id -> its parent value node ids. Empty for a root. May participate in cycles. */
    parentIds: ReadonlyMap<string, readonly string[]>;
    /** Value node id to the deduped note count for that node and its whole subtree. */
    subtreeCount: ReadonlyMap<string, number>;
}

export const EMPTY_PROPERTY_HIERARCHY_INDEX: PropertyHierarchyIndex = {
    rootIds: new Map<string, readonly string[]>(),
    childIds: new Map<string, readonly string[]>(),
    parentIds: new Map<string, readonly string[]>(),
    subtreeCount: new Map<string, number>()
};

interface BuildPropertyHierarchyIndexParams {
    tree: ReadonlyMap<string, PropertyTreeNode>;
    /** Normalized property keys the user marked hierarchical. */
    hierarchicalKeys: ReadonlySet<string>;
    /**
     * Path of the note a value points at, or null when the value is not a wikilink or resolves to
     * nothing. Wire this to resolvePropertyNote so the hierarchy and property notes can never
     * disagree about which note a value means.
     */
    resolveValueNotePath: (node: PropertyTreeNode) => string | null;
}

export function buildPropertyHierarchyIndex({
    tree,
    hierarchicalKeys,
    resolveValueNotePath
}: BuildPropertyHierarchyIndexParams): PropertyHierarchyIndex {
    if (hierarchicalKeys.size === 0) {
        return EMPTY_PROPERTY_HIERARCHY_INDEX;
    }

    const rootIds = new Map<string, readonly string[]>();
    const childIds = new Map<string, readonly string[]>();
    const parentIds = new Map<string, readonly string[]>();
    const subtreeCount = new Map<string, number>();

    tree.forEach((keyNode, normalizedKey) => {
        if (!hierarchicalKeys.has(normalizedKey)) {
            return;
        }

        const valueNodes = Array.from(keyNode.children.values()).filter(node => node.kind === 'value');
        if (valueNodes.length === 0) {
            return;
        }

        // Which value nodes of this key each note carries. A value's parents are the values carried
        // by the note that value points at.
        const valuesByNotePath = new Map<string, string[]>();
        valueNodes.forEach(node => {
            node.notesWithValue.forEach(notePath => {
                const existing = valuesByNotePath.get(notePath);
                if (existing) {
                    existing.push(node.id);
                } else {
                    valuesByNotePath.set(notePath, [node.id]);
                }
            });
        });

        const parentsById = new Map<string, string[]>();
        valueNodes.forEach(node => {
            const notePath = resolveValueNotePath(node);
            // A value cannot parent itself. Dropping the self edge is what turns a hub note filed
            // under its own key, such as Categories, into a root rather than an unreachable island.
            const parents = notePath === null ? [] : (valuesByNotePath.get(notePath) ?? []).filter(id => id !== node.id);
            parentsById.set(node.id, parents);
            // Sorted for the same reason rootIds and childIds are: the walk in
            // resolvePropertyRevealChain takes the first parent, so it must not depend on the order
            // notes happened to be scanned in. Every value node of a hierarchical key gets an entry,
            // empty for a root, which is what lets that walk tell an unknown node from a root.
            parentIds.set(node.id, parents.slice().sort());
        });

        const childrenById = new Map<string, string[]>();
        parentsById.forEach((parents, nodeId) => {
            parents.forEach(parentId => {
                const existing = childrenById.get(parentId);
                if (existing) {
                    existing.push(nodeId);
                } else {
                    childrenById.set(parentId, [nodeId]);
                }
            });
        });

        const roots = valueNodes.filter(node => (parentsById.get(node.id) ?? []).length === 0).map(node => node.id);

        // Reachability sweep. A cycle with no entry point, such as A parented by B and B parented by
        // A, is placed only under itself and would vanish from the tree. Promote whatever the walk
        // from the roots never reaches.
        const reached = new Set<string>();
        const visit = (nodeId: string): void => {
            if (reached.has(nodeId)) {
                return;
            }
            reached.add(nodeId);
            (childrenById.get(nodeId) ?? []).forEach(visit);
        };
        roots.forEach(visit);
        const promoted = valueNodes.filter(node => !reached.has(node.id)).map(node => node.id);
        promoted.forEach(visit);

        // Sorted for deterministic output; the flattener applies the user's comparator on top.
        rootIds.set(keyNode.id, [...roots, ...promoted].sort());
        childrenById.forEach((children, parentId) => {
            childIds.set(parentId, children.slice().sort());
        });

        // Deduped subtree counts, post-order with a cycle guard, matching getTotalNoteCount for tags.
        const nodesById = new Map(valueNodes.map(node => [node.id, node]));
        const collect = (nodeId: string, visiting: ReadonlySet<string>): ReadonlySet<string> => {
            const node = nodesById.get(nodeId as PropertyTreeNodeId);
            if (!node || visiting.has(nodeId)) {
                return new Set<string>();
            }
            const nextVisiting = new Set(visiting).add(nodeId);
            const notes = new Set<string>(node.notesWithValue);
            (childIds.get(nodeId) ?? []).forEach(childId => {
                collect(childId, nextVisiting).forEach(path => notes.add(path));
            });
            return notes;
        };
        valueNodes.forEach(node => {
            subtreeCount.set(node.id, collect(node.id, new Set<string>()).size);
        });
    });

    return { rootIds, childIds, parentIds, subtreeCount };
}

/**
 * Chain of value node ids from a root down to the target, or null when the node is unknown.
 * Walks parents deterministically, taking the first parent id, and stops on a node already in the
 * chain so a cycle terminates rather than looping. The user's rule is that auto-reveal targets the
 * first placement, and taking the first parent at each step is what makes that deterministic.
 *
 * The chain need not equal the flattener's first emitted placement, and does not need to: once every
 * prefix is expanded the target's row exists, and selection and highlighting are keyed by node id
 * regardless of which placement the user ends up looking at. Deliberately independent of expansion
 * state, unlike firstPlacementByNodeId, which only ever contains a node whose row is already visible
 * and therefore can never tell reveal what to expand.
 */
export function resolvePropertyRevealChain(index: PropertyHierarchyIndex, nodeId: string): string[] | null {
    if (!index.parentIds.has(nodeId)) {
        return null;
    }

    const chain = [nodeId];
    const seen = new Set([nodeId]);
    for (;;) {
        const parentId = index.parentIds.get(chain[0])?.[0];
        if (parentId === undefined || seen.has(parentId)) {
            return chain;
        }
        chain.unshift(parentId);
        seen.add(parentId);
    }
}

/**
 * Whether a property tree node should show a chevron. A hierarchical value node's own `children` map
 * is always empty by design (the tree is never reparented), so every caller that only checked
 * `node.children.size > 0` reported "no children" for one and silently did nothing. Asking the index
 * too is what makes those checks correct for hierarchical values while leaving flat keys exactly as
 * they behave today, since a non-hierarchical key has no entry in the index at all.
 *
 * Known related defect, deliberately not fixed here: this mirrors the flattener's own
 * `hasChildren` computation, which is raw `childIds.length > 0` and ignores the flattener's depth cap
 * and its cycle filter. A placement at the cap, or one whose only child is its own ancestor, reports
 * children it cannot actually expand into. Centralizing the check here is what lets a later fix
 * correct every caller at once instead of hunting them down again.
 */
export function propertyNodeHasChildren(node: PropertyTreeNode, index: PropertyHierarchyIndex): boolean {
    return node.children.size > 0 || (index.childIds.get(node.id)?.length ?? 0) > 0;
}

/**
 * Note counts for a property value node, mirroring createTagNoteCountInfo so hierarchical properties
 * and tags present counts identically. Falls back to the node's own count when the node has no entry
 * in the index, which is every node while the key is not hierarchical.
 */
export function createPropertyNoteCountInfo(
    node: PropertyTreeNode,
    index: PropertyHierarchyIndex,
    includeDescendantNotes: boolean
): NoteCountInfo {
    const current = node.notesWithValue.size;
    if (!includeDescendantNotes) {
        return { current, descendants: 0, total: current };
    }

    const total = index.subtreeCount.get(node.id) ?? current;
    return { current, descendants: Math.max(total - current, 0), total };
}
