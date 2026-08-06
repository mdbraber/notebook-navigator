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

import { describe, expect, it, vi } from 'vitest';
import { navigateToProperty, type PropertyNavigationEnvironment } from '../../src/utils/propertyNavigation';
import { buildPropertyKeyNodeId } from '../../src/utils/propertyTree';
import type { PropertyTreeNode } from '../../src/types/storage';

function createKeyNode(key: string, name: string): PropertyTreeNode {
    return {
        id: buildPropertyKeyNodeId(key),
        kind: 'key',
        key,
        valuePath: null,
        name,
        displayPath: name,
        children: new Map(),
        notesWithValue: new Set(['notes/a.md'])
    };
}

function createEnv(overrides: Partial<PropertyNavigationEnvironment> = {}): PropertyNavigationEnvironment {
    return {
        showProperties: false,
        showAllPropertiesFolder: false,
        propertyTree: new Map(),
        expandedProperties: new Set(),
        expandedVirtualFolders: new Set(),
        expansionDispatch: vi.fn(),
        selectionDispatch: vi.fn(),
        activatePane: vi.fn(),
        ...overrides
    };
}

describe('navigateToProperty - suppressAutoSelect', () => {
    // Regression coverage for the shortcut-activation auto-open race: SET_SELECTED_PROPERTY with
    // autoSelectedFile left undefined lets useSelectionProvider's enhancedDispatch resolve a first
    // file for the property, which (with autoSelectFirstFileOnFocusChange on) opens in a post-render
    // effect one render after the reveal's SET_KEYBOARD_NAVIGATION flag resets - replacing whatever
    // note was just opened by the auto-open feature. Callers about to open a note themselves must
    // pass suppressAutoSelect so the dispatch carries autoSelectedFile: null instead.

    it('leaves autoSelectedFile undefined by default, preserving every existing caller', () => {
        const keyNode = createKeyNode('status', 'Status');
        const propertyTree = new Map<string, PropertyTreeNode>([[keyNode.key, keyNode]]);
        const selectionDispatch = vi.fn();
        const env = createEnv({ propertyTree, selectionDispatch });

        const resolvedNodeId = navigateToProperty(env, keyNode.id);

        expect(resolvedNodeId).toBe(keyNode.id);
        expect(selectionDispatch).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'SET_SELECTED_PROPERTY',
                nodeId: keyNode.id,
                autoSelectedFile: undefined
            })
        );
    });

    it('sets autoSelectedFile to null when suppressAutoSelect is requested', () => {
        const keyNode = createKeyNode('status', 'Status');
        const propertyTree = new Map<string, PropertyTreeNode>([[keyNode.key, keyNode]]);
        const selectionDispatch = vi.fn();
        const env = createEnv({ propertyTree, selectionDispatch });

        const resolvedNodeId = navigateToProperty(env, keyNode.id, { suppressAutoSelect: true });

        expect(resolvedNodeId).toBe(keyNode.id);
        expect(selectionDispatch).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'SET_SELECTED_PROPERTY',
                nodeId: keyNode.id,
                autoSelectedFile: null
            })
        );
    });
});
