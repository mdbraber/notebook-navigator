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
import { App, TFolder } from 'obsidian';
import { ShortcutStartType } from '../../src/types/shortcuts';
import {
    formatSearchShortcutStartTargetPath,
    resolveSearchShortcutPropertyStartTarget,
    resolveSearchShortcutStartFolderPath
} from '../../src/hooks/useListPaneSearch';
import { buildPropertyHierarchyIndex } from '../../src/utils/propertyHierarchy';
import type { PropertyTreeNode } from '../../src/types/storage';

interface TestVaultRegistration {
    registerFolder(folder: TFolder): void;
}

function getTestVault(app: App): TestVaultRegistration {
    return app.vault as unknown as TestVaultRegistration;
}

const KEY_NODE_ID = 'key:projects';
const valueId = (value: string) => `key:projects=${value.toLowerCase()}`;

/** Fiddle.md carries projects: [[Test]], [[Other]], which is what gives Fiddle two rows. */
function createPropertyTree(): Map<string, PropertyTreeNode> {
    const keyNode: PropertyTreeNode = {
        id: KEY_NODE_ID,
        kind: 'key',
        key: 'projects',
        valuePath: null,
        name: 'Projects',
        displayPath: 'Projects',
        children: new Map(),
        notesWithValue: new Set()
    };

    const addValue = (value: string, notes: string[]): void => {
        keyNode.children.set(valueId(value), {
            id: valueId(value),
            kind: 'value',
            key: 'projects',
            valuePath: value.toLowerCase(),
            name: value,
            displayPath: value,
            assignmentValue: `[[${value}]]`,
            children: new Map(),
            notesWithValue: new Set(notes)
        });
    };

    addValue('Test', ['Fiddle.md']);
    addValue('Other', ['Fiddle.md']);
    addValue('Fiddle', []);

    return new Map([['projects', keyNode]]);
}

const propertyTree = createPropertyTree();
const hierarchyIndex = buildPropertyHierarchyIndex({
    tree: propertyTree,
    hierarchicalKeys: new Set(['projects']),
    resolveValueNotePath: node => {
        const match = /^\[\[([^\]|]+)\]\]$/.exec(node.assignmentValue ?? '');
        return match ? `${match[1]}.md` : null;
    }
});

describe('formatSearchShortcutStartTargetPath', () => {
    it('names a property value with its key and the display casing of both', () => {
        expect(formatSearchShortcutStartTargetPath({ type: ShortcutStartType.PROPERTY, nodeId: valueId('Fiddle') }, propertyTree)).toBe(
            'Projects/Fiddle'
        );
    });

    it('names a property key with its display casing', () => {
        expect(formatSearchShortcutStartTargetPath({ type: ShortcutStartType.PROPERTY, nodeId: KEY_NODE_ID }, propertyTree)).toBe(
            'Projects'
        );
    });

    it('falls back to the node id parts when the value is no longer in the tree', () => {
        expect(formatSearchShortcutStartTargetPath({ type: ShortcutStartType.PROPERTY, nodeId: 'key:projects=gone' }, propertyTree)).toBe(
            'Projects/gone'
        );
    });

    it('keeps naming folders and tags by their full path', () => {
        expect(formatSearchShortcutStartTargetPath({ type: ShortcutStartType.FOLDER, path: 'projects/active' }, propertyTree)).toBe(
            '/projects/active'
        );
        expect(formatSearchShortcutStartTargetPath({ type: ShortcutStartType.TAG, tagPath: 'work/today' }, propertyTree)).toBe(
            '#work/today'
        );
    });
});

describe('resolveSearchShortcutPropertyStartTarget', () => {
    it('records the placement chain of the row the value is showing at', () => {
        expect(
            resolveSearchShortcutPropertyStartTarget({
                nodeId: valueId('Fiddle'),
                propertyTree,
                hierarchyIndex,
                expandedProperties: new Set([KEY_NODE_ID, valueId('Test')]),
                maxDepth: 10
            })
        ).toEqual({
            type: ShortcutStartType.PROPERTY,
            nodeId: valueId('Fiddle'),
            placementChain: [valueId('Test'), valueId('Fiddle')]
        });
    });

    it('records no chain while the value shows under two open parents at once', () => {
        expect(
            resolveSearchShortcutPropertyStartTarget({
                nodeId: valueId('Fiddle'),
                propertyTree,
                hierarchyIndex,
                expandedProperties: new Set([KEY_NODE_ID, valueId('Test'), valueId('Other')]),
                maxDepth: 10
            })
        ).toEqual({
            type: ShortcutStartType.PROPERTY,
            nodeId: valueId('Fiddle')
        });
    });

    it('records no chain for a key node, which renders in one place by construction', () => {
        expect(
            resolveSearchShortcutPropertyStartTarget({
                nodeId: KEY_NODE_ID,
                propertyTree,
                hierarchyIndex,
                expandedProperties: new Set([KEY_NODE_ID]),
                maxDepth: 10
            })
        ).toEqual({
            type: ShortcutStartType.PROPERTY,
            nodeId: KEY_NODE_ID
        });
    });
});

describe('resolveSearchShortcutStartFolderPath', () => {
    it('resolves folder start targets with mismatched casing', () => {
        const app = new App();
        getTestVault(app).registerFolder(new TFolder('applab/skills-workflows/mmgi'));

        expect(
            resolveSearchShortcutStartFolderPath(app, {
                type: ShortcutStartType.FOLDER,
                path: 'appLab/SKILLS-WORKFLOWS/mmgi'
            })
        ).toBe('applab/skills-workflows/mmgi');
    });
});
