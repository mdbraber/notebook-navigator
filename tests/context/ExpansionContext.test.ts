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

import { describe, expect, it } from 'vitest';
import { expansionReducer, type ExpansionState } from '../../src/context/ExpansionContext';
import { buildPropertyKeyNodeId, buildPropertyValueNodeId } from '../../src/utils/propertyTree';
import { buildPropertyPlacementKey } from '../../src/utils/treeFlattener';

function createState(overrides: Partial<ExpansionState> = {}): ExpansionState {
    return {
        expandedFolders: new Set(),
        expandedTags: new Set(),
        expandedProperties: new Set(),
        expandedVirtualFolders: new Set(),
        collapsedListGroups: new Set(),
        ...overrides
    };
}

const KEY_ID = buildPropertyKeyNodeId('projects');
const WORK_ID = buildPropertyValueNodeId('projects', 'work');
const CLIENTS_ID = buildPropertyValueNodeId('projects', 'clients');
const TARGET_ID = buildPropertyValueNodeId('projects', 'datawerkplaats mooi maasvallei');

describe('expansionReducer CLEANUP_DELETED_PROPERTIES', () => {
    // The whitelist this action carries holds key and value node ids only. A hierarchical value's
    // expansion is stored per placement, whose key is the chain of value node ids joined with a NUL, so
    // a direct membership test deletes every nested expansion. Because the cleanup effect depends on
    // expandedProperties.size, that fired the moment a level-2 row was expanded and erased its own
    // expansion before its children could render.
    it('keeps a nested placement key whose whole chain still exists', () => {
        const clientsUnderWork = buildPropertyPlacementKey([WORK_ID, CLIENTS_ID]);
        const targetUnderClients = buildPropertyPlacementKey([WORK_ID, CLIENTS_ID, TARGET_ID]);
        const state = createState({
            expandedProperties: new Set([KEY_ID, WORK_ID, clientsUnderWork, targetUnderClients])
        });

        const result = expansionReducer(state, {
            type: 'CLEANUP_DELETED_PROPERTIES',
            existingPropertyNodeIds: new Set([KEY_ID, WORK_ID, CLIENTS_ID, TARGET_ID])
        });

        // Nothing needed removing, so the reducer returns the same state object.
        expect(result).toBe(state);
        expect(result.expandedProperties).toEqual(new Set([KEY_ID, WORK_ID, clientsUnderWork, targetUnderClients]));
    });

    it('purges a placement key whose ancestor was deleted', () => {
        const clientsUnderWork = buildPropertyPlacementKey([WORK_ID, CLIENTS_ID]);
        const state = createState({
            expandedProperties: new Set([KEY_ID, clientsUnderWork])
        });

        // Work is gone from the vault, so the placement that nested Clients under it cannot exist.
        const result = expansionReducer(state, {
            type: 'CLEANUP_DELETED_PROPERTIES',
            existingPropertyNodeIds: new Set([KEY_ID, CLIENTS_ID])
        });

        expect(result.expandedProperties).toEqual(new Set([KEY_ID]));
    });

    it('purges a placement key whose own target was deleted', () => {
        const clientsUnderWork = buildPropertyPlacementKey([WORK_ID, CLIENTS_ID]);
        const state = createState({
            expandedProperties: new Set([KEY_ID, WORK_ID, clientsUnderWork])
        });

        const result = expansionReducer(state, {
            type: 'CLEANUP_DELETED_PROPERTIES',
            existingPropertyNodeIds: new Set([KEY_ID, WORK_ID])
        });

        expect(result.expandedProperties).toEqual(new Set([KEY_ID, WORK_ID]));
    });

    it('still purges a plain node id that no longer exists, as it always did', () => {
        const state = createState({
            expandedProperties: new Set([KEY_ID, WORK_ID])
        });

        const result = expansionReducer(state, {
            type: 'CLEANUP_DELETED_PROPERTIES',
            existingPropertyNodeIds: new Set([KEY_ID])
        });

        expect(result.expandedProperties).toEqual(new Set([KEY_ID]));
    });
});
