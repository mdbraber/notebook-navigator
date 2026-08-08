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

import type { PropertyTreeNode } from '../types/storage';
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

/**
 * Deduped note paths of a value node and everything below it, following child edges with a cycle
 * guard. One walk serves both the subtree count and the notes a selected row lists, which is what
 * makes the badge and the list agree by construction rather than by two implementations staying in
 * step. Nodes the map does not know are skipped, and their edges are not followed.
 */
function collectSubtreeNotePaths(
    nodesById: ReadonlyMap<string, PropertyTreeNode>,
    childIds: ReadonlyMap<string, readonly string[]>,
    rootId: string
): Set<string> {
    const notePaths = new Set<string>();
    const visited = new Set<string>();
    const pending = [rootId];

    while (pending.length > 0) {
        const nodeId = pending.pop();
        if (nodeId === undefined || visited.has(nodeId)) {
            continue;
        }
        visited.add(nodeId);

        const node = nodesById.get(nodeId);
        if (!node) {
            continue;
        }

        node.notesWithValue.forEach(notePath => notePaths.add(notePath));
        (childIds.get(nodeId) ?? []).forEach(childId => pending.push(childId));
    }

    return notePaths;
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
            // Sorted for the same reason rootIds and childIds are: resolvePropertyRevealChain walks
            // these lists in order, so which chain it finds must not depend on the order notes
            // happened to be scanned in. Every value node of a hierarchical key gets an entry, empty
            // for a root, which is what lets that walk tell an unknown node from a root.
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

        // Deduped subtree counts, from the same walk selection uses, so a badge and the notes the row
        // lists can only ever be the same set.
        const nodesById = new Map<string, PropertyTreeNode>(valueNodes.map(node => [node.id, node]));
        valueNodes.forEach(node => {
            subtreeCount.set(node.id, collectSubtreeNotePaths(nodesById, childIds, node.id).size);
        });
    });

    return { rootIds, childIds, parentIds, subtreeCount };
}

/**
 * Deduped note paths a hierarchical value row lists when descendant notes are on: its own notes
 * unioned with its whole subtree's, so a note carrying both a parent and a child value appears once.
 * Equals the set `index.subtreeCount` sized, because both come from the same walk.
 *
 * Falls back to the node's own notes whenever the node has no index entry, which is every node while
 * its key is not hierarchical, so a flat key keeps listing exactly what it lists today. Deliberately
 * ignores the flattener's depth cap, matching the counts: the cap is a rendering limit, so moving it
 * must not change what a row contains.
 */
export function collectPropertyValueSubtreeNotePaths(
    keyNode: PropertyTreeNode,
    nodeId: string,
    index: PropertyHierarchyIndex
): Set<string> {
    const nodesById = new Map<string, PropertyTreeNode>();
    keyNode.children.forEach(node => {
        if (node.kind === 'value') {
            nodesById.set(node.id, node);
        }
    });

    return collectSubtreeNotePaths(nodesById, index.childIds, nodeId);
}

interface ResolvePropertyRevealChainParams {
    index: PropertyHierarchyIndex;
    /** Key node id of the target, which is what `rootIds` is keyed by. */
    keyNodeId: string;
    /** Value node id to reveal. */
    nodeId: string;
    /** The flattener's depth cap. A chain deeper than this expands prefixes it never recurses into. */
    maxDepth: number;
}

/**
 * Chain of value node ids from a rendered root down to the target, or null when no such chain exists
 * within the depth cap. The head is always a node in `index.rootIds` for the key, which is the whole
 * point: a head that merely has no unseen parent left can be a cycle member that renders nowhere at
 * the key's root, and expanding a placement key naming no rendered row is not a silent no-op. With
 * collapseOtherBranchesOnExpand on, the expansion set is replaced wholesale, so revealing a value
 * that way collapses the branch the value was actually visible in.
 *
 * Walks parents breadth first, so the chain found is the shallowest one and therefore the one most
 * likely to fit under the cap. Parent lists are sorted by the index, which makes the result
 * deterministic. Null means reveal expands the key alone, which is what a non-hierarchical value has
 * always done.
 *
 * The chain need not equal the flattener's first emitted placement, and does not need to: once every
 * prefix is expanded the target's row exists, and selection and highlighting are keyed by node id
 * regardless of which placement the user ends up looking at. Deliberately independent of expansion
 * state: anything read back out of the flattener describes only rows that are already visible, because
 * the flattener recurses into a placement's children solely when that placement is expanded, so it can
 * never tell reveal what to expand.
 */
export function resolvePropertyRevealChain({ index, keyNodeId, nodeId, maxDepth }: ResolvePropertyRevealChainParams): string[] | null {
    if (!index.parentIds.has(nodeId)) {
        return null;
    }

    const rootIds = new Set(index.rootIds.get(keyNodeId) ?? []);
    // A root renders at the key's own level, so its chain is itself and nothing needs expanding.
    // Checked first because a promoted cycle member is both a root and somebody's child.
    if (rootIds.has(nodeId)) {
        return [nodeId];
    }

    // Breadth first upward. `cameFrom` maps each visited node to the node it was reached from, which
    // is that node's child in the chain, so a hit rebuilds the chain by walking back down.
    const cameFrom = new Map<string, string>();
    const visited = new Set<string>([nodeId]);
    let frontier = [nodeId];

    for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
        const nextFrontier: string[] = [];
        for (const current of frontier) {
            for (const parentId of index.parentIds.get(current) ?? []) {
                if (visited.has(parentId)) {
                    continue;
                }
                visited.add(parentId);
                cameFrom.set(parentId, current);

                if (rootIds.has(parentId)) {
                    const chain = [parentId];
                    let cursor = parentId;
                    for (;;) {
                        const child = cameFrom.get(cursor);
                        if (child === undefined) {
                            return chain;
                        }
                        chain.push(child);
                        cursor = child;
                    }
                }

                nextFrontier.push(parentId);
            }
        }
        frontier = nextFrontier;
    }

    return null;
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
