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

import { App, TFile } from 'obsidian';
import { describe, expect, it } from 'vitest';
import { ItemType, type NavigationItemType } from '../../src/types';
import type { PropertyTreeNode } from '../../src/types/storage';
import { buildPropertyKeyNodeId, buildPropertyValueNodeId } from '../../src/utils/propertyTree';
import {
    getPropertyNoteLinkTarget,
    getPropertyNoteSourcePath,
    findPropertyNoteValueNode,
    resolvePropertyNote,
    resolvePropertyNoteLensJump,
    resolvePropertyRevealTarget,
    shouldOpenPropertyNoteOnEnter
} from '../../src/utils/propertyNoteLookup';
import { createTestTFile } from './createTestTFile';

function createValueNode(key: string, valuePath: string, assignmentValue: string | undefined, notes: string[] = []): PropertyTreeNode {
    return {
        id: buildPropertyValueNodeId(key, valuePath),
        kind: 'value',
        key,
        valuePath,
        name: valuePath,
        displayPath: valuePath,
        assignmentValue,
        children: new Map(),
        notesWithValue: new Set(notes)
    };
}

function createKeyNode(key: string): PropertyTreeNode {
    return {
        id: buildPropertyKeyNodeId(key),
        kind: 'key',
        key,
        valuePath: null,
        name: key,
        displayPath: key,
        children: new Map(),
        notesWithValue: new Set()
    };
}

function createApp(dest: TFile | null): App {
    const app = new App();
    app.metadataCache.getFirstLinkpathDest = () => dest;
    return app;
}

function createTree(...nodes: PropertyTreeNode[]): Map<string, PropertyTreeNode> {
    const tree = new Map<string, PropertyTreeNode>();
    for (const node of nodes) {
        const keyNode = tree.get(node.key) ?? createKeyNode(node.key);
        keyNode.children.set(node.id, node);
        tree.set(node.key, keyNode);
    }
    return tree;
}

// Resolves each wikilink target to its own file, so a scan over several values distinguishes
// them the way the real metadata cache does.
function createLinkingApp(...paths: string[]): App {
    const files = new Map(paths.map(path => [path.replace(/\.md$/, ''), createTestTFile(path)]));
    const app = new App();
    app.metadataCache.getFirstLinkpathDest = (target: string) => files.get(target) ?? null;
    return app;
}

describe('getPropertyNoteLinkTarget', () => {
    it('returns the target of a bare wikilink', () => {
        expect(getPropertyNoteLinkTarget(createValueNode('references', 'apple', '[[Apple]]'))).toBe('Apple');
    });

    it('returns the target, not the alias, for an aliased wikilink', () => {
        expect(getPropertyNoteLinkTarget(createValueNode('references', 'apple', '[[Fruits/Apple|Apple]]'))).toBe('Fruits/Apple');
    });

    it('returns the full path for a pathed wikilink', () => {
        expect(getPropertyNoteLinkTarget(createValueNode('references', 'fruits/apple', '[[Fruits/Apple]]'))).toBe('Fruits/Apple');
    });

    it('returns null for a plain string value', () => {
        expect(getPropertyNoteLinkTarget(createValueNode('status', 'draft', 'draft'))).toBeNull();
    });

    it('returns null for an external link value', () => {
        expect(getPropertyNoteLinkTarget(createValueNode('source', 'https://example.com', 'https://example.com'))).toBeNull();
    });

    it('returns null when assignmentValue is absent', () => {
        expect(getPropertyNoteLinkTarget(createValueNode('references', 'apple', undefined))).toBeNull();
    });

    it('returns null for a key node', () => {
        expect(getPropertyNoteLinkTarget(createKeyNode('references'))).toBeNull();
    });

    it('returns null for a null node', () => {
        expect(getPropertyNoteLinkTarget(null)).toBeNull();
    });
});

describe('getPropertyNoteSourcePath', () => {
    it('returns the lexicographically first referencing note', () => {
        const node = createValueNode('references', 'apple', '[[Apple]]', ['zeta.md', 'alpha.md', 'mid.md']);
        expect(getPropertyNoteSourcePath(node)).toBe('alpha.md');
    });

    it('is stable regardless of insertion order', () => {
        const a = createValueNode('references', 'apple', '[[Apple]]', ['alpha.md', 'zeta.md']);
        const b = createValueNode('references', 'apple', '[[Apple]]', ['zeta.md', 'alpha.md']);
        expect(getPropertyNoteSourcePath(a)).toBe(getPropertyNoteSourcePath(b));
    });

    it('falls back to the vault root when nothing references the value', () => {
        expect(getPropertyNoteSourcePath(createValueNode('references', 'apple', '[[Apple]]', []))).toBe('');
    });
});

describe('resolvePropertyNote', () => {
    it('returns the resolved file for a wikilink value', () => {
        const file = createTestTFile('Fruits/Apple.md');
        const node = createValueNode('references', 'apple', '[[Apple]]', ['note.md']);
        expect(resolvePropertyNote(node, createApp(file))).toBe(file);
    });

    it('returns null when the link does not resolve', () => {
        const node = createValueNode('references', 'apple', '[[Apple]]', ['note.md']);
        expect(resolvePropertyNote(node, createApp(null))).toBeNull();
    });

    it('returns null for a plain string value even when a file would resolve', () => {
        const node = createValueNode('status', 'draft', 'draft');
        expect(resolvePropertyNote(node, createApp(createTestTFile('Draft.md')))).toBeNull();
    });

    it('returns null for a null node', () => {
        expect(resolvePropertyNote(null, createApp(createTestTFile('Apple.md')))).toBeNull();
    });
});

describe('findPropertyNoteValueNode', () => {
    it('finds the value whose wikilink points at the file', () => {
        const tree = createTree(
            createValueNode('categories', 'contexts', '[[Contexts]]', ['a.md']),
            createValueNode('categories', 'meetings', '[[Meetings]]', ['a.md'])
        );

        const found = findPropertyNoteValueNode({
            filePath: 'Meetings.md',
            propertyTree: tree,
            app: createLinkingApp('Meetings.md', 'Contexts.md')
        });

        expect(found?.id).toBe(buildPropertyValueNodeId('categories', 'meetings'));
    });

    it('returns null for a file no value points at', () => {
        const tree = createTree(createValueNode('categories', 'contexts', '[[Contexts]]', ['a.md']));

        expect(
            findPropertyNoteValueNode({ filePath: 'Unrelated.md', propertyTree: tree, app: createLinkingApp('Contexts.md') })
        ).toBeNull();
    });

    it('prefers the requested node when a note defines values under several keys', () => {
        // Clients.md is both categories=clients and projects=clients. Moving the selection between
        // two equally correct answers is churn, so the current selection wins when it is one.
        const tree = createTree(
            createValueNode('categories', 'clients', '[[Clients]]', ['a.md']),
            createValueNode('projects', 'clients', '[[Clients]]', ['a.md'])
        );
        const app = createLinkingApp('Clients.md');

        expect(
            findPropertyNoteValueNode({
                filePath: 'Clients.md',
                propertyTree: tree,
                app,
                preferNodeId: buildPropertyValueNodeId('projects', 'clients')
            })?.id
        ).toBe(buildPropertyValueNodeId('projects', 'clients'));

        // Without a preference it takes the first match in tree order.
        expect(findPropertyNoteValueNode({ filePath: 'Clients.md', propertyTree: tree, app })?.id).toBe(
            buildPropertyValueNodeId('categories', 'clients')
        );
    });

    it('picks the same node regardless of tree iteration order', () => {
        // A note can be the target of values under several keys. The tree is a fresh map rebuilt
        // from a database scan, so iteration order is not a contract - without a sort the answer
        // drifts between equally valid nodes across rebuilds.
        const app = createLinkingApp('Clients.md');
        const forward = createTree(
            createValueNode('categories', 'clients', '[[Clients]]', ['a.md']),
            createValueNode('projects', 'clients', '[[Clients]]', ['a.md'])
        );
        const reversed = createTree(
            createValueNode('projects', 'clients', '[[Clients]]', ['a.md']),
            createValueNode('categories', 'clients', '[[Clients]]', ['a.md'])
        );

        const fromForward = findPropertyNoteValueNode({ filePath: 'Clients.md', propertyTree: forward, app });
        const fromReversed = findPropertyNoteValueNode({ filePath: 'Clients.md', propertyTree: reversed, app });

        expect(fromForward?.id).toBe(buildPropertyValueNodeId('categories', 'clients'));
        expect(fromReversed?.id).toBe(fromForward?.id);
    });

    it('sorts by value path when one key holds several matching values', () => {
        const app = createLinkingApp('Clients.md');
        const tree = createTree(
            createValueNode('categories', 'zulu', '[[Clients]]', ['a.md']),
            createValueNode('categories', 'alpha', '[[Clients]]', ['a.md'])
        );

        expect(findPropertyNoteValueNode({ filePath: 'Clients.md', propertyTree: tree, app })?.id).toBe(
            buildPropertyValueNodeId('categories', 'alpha')
        );
    });

    it('returns null without a tree', () => {
        expect(findPropertyNoteValueNode({ filePath: 'Meetings.md', propertyTree: null, app: createLinkingApp('Meetings.md') })).toBeNull();
    });
});

describe('resolvePropertyRevealTarget', () => {
    const selected = buildPropertyValueNodeId('categories', 'categories');
    const defined = buildPropertyValueNodeId('categories', 'contexts');
    const baseParams = {
        propertyNotesEnabled: true,
        selectionType: ItemType.PROPERTY,
        selectedProperty: selected,
        memberRevealTarget: selected,
        definedValueNodeId: defined
    };

    it('keeps the current selection when the file is one of its notes', () => {
        // Browsing Categories and opening Contexts.md, which carries categories: [[Categories]].
        // It is in the list already, so revealing means leaving the selection where it is - the
        // file stays visible. Its own value node would hide it, holding only that value's members.
        expect(resolvePropertyRevealTarget(baseParams)).toBe(selected);
    });

    it('falls to the defined value when the file is not in the current list', () => {
        // The regression: on Meetings, opening Meetings.md. It carries categories: [[Contexts]],
        // so core resolves to Contexts - a value the note has nothing to do with.
        expect(
            resolvePropertyRevealTarget({
                ...baseParams,
                selectedProperty: buildPropertyValueNodeId('categories', 'meetings'),
                memberRevealTarget: buildPropertyValueNodeId('categories', 'contexts'),
                definedValueNodeId: buildPropertyValueNodeId('categories', 'meetings')
            })
        ).toBe(buildPropertyValueNodeId('categories', 'meetings'));
    });

    it('keeps the core result for a file that defines no value', () => {
        const memberRevealTarget = buildPropertyValueNodeId('categories', 'topics');
        expect(resolvePropertyRevealTarget({ ...baseParams, memberRevealTarget, definedValueNodeId: null })).toBe(memberRevealTarget);
    });

    it('keeps the core result while property notes are disabled', () => {
        const memberRevealTarget = buildPropertyValueNodeId('categories', 'contexts');
        expect(resolvePropertyRevealTarget({ ...baseParams, propertyNotesEnabled: false, memberRevealTarget })).toBe(memberRevealTarget);
    });

    it.each([ItemType.FOLDER, ItemType.TAG])('does not apply to %s selections', selectionType => {
        const memberRevealTarget = buildPropertyValueNodeId('categories', 'contexts');
        expect(resolvePropertyRevealTarget({ ...baseParams, selectionType, memberRevealTarget })).toBe(memberRevealTarget);
    });

    it('reveals a property note even when nothing is selected yet', () => {
        expect(
            resolvePropertyRevealTarget({ ...baseParams, selectedProperty: null, memberRevealTarget: null, definedValueNodeId: defined })
        ).toBe(defined);
    });
});

describe('resolvePropertyNoteLensJump', () => {
    const tree = createTree(createValueNode('categories', 'clients', '[[Clients]]', ['a.md']));

    function baseParams() {
        return {
            enabled: true,
            revealSource: 'auto' as const,
            selectionType: ItemType.FOLDER as NavigationItemType,
            filePath: 'Clients.md',
            propertyTree: tree,
            app: createLinkingApp('Clients.md')
        };
    }

    it('jumps to the value node the file defines, with its key node to expand', () => {
        expect(resolvePropertyNoteLensJump(baseParams())).toEqual({
            targetProperty: buildPropertyValueNodeId('categories', 'clients'),
            keyNodeId: buildPropertyKeyNodeId('categories')
        });
    });

    it('jumps from a tag selection too - defining a value beats carrying a tag', () => {
        expect(resolvePropertyNoteLensJump({ ...baseParams(), selectionType: ItemType.TAG })?.targetProperty).toBe(
            buildPropertyValueNodeId('categories', 'clients')
        );
    });

    it('does not jump while the setting is off', () => {
        expect(resolvePropertyNoteLensJump({ ...baseParams(), enabled: false })).toBeNull();
    });

    it.each(['shortcut', 'manual'] as const)('does not jump for a %s reveal', revealSource => {
        // Shortcuts and recent notes run through the same reveal function. Those clicks happen
        // inside the navigation pane, where the user can see the tree and did not ask to leave it.
        expect(resolvePropertyNoteLensJump({ ...baseParams(), revealSource })).toBeNull();
    });

    it('does not jump for an undefined reveal source', () => {
        expect(resolvePropertyNoteLensJump({ ...baseParams(), revealSource: undefined })).toBeNull();
    });

    it.each(['auto', 'startup'] as const)('jumps for a %s reveal', revealSource => {
        expect(resolvePropertyNoteLensJump({ ...baseParams(), revealSource })).not.toBeNull();
    });

    it('does not jump when the property lens is already selected', () => {
        // resolvePropertyRevealTarget owns that case and handles a property note without a lens change.
        expect(resolvePropertyNoteLensJump({ ...baseParams(), selectionType: ItemType.PROPERTY })).toBeNull();
    });

    it('does not jump for a file no value points at', () => {
        expect(resolvePropertyNoteLensJump({ ...baseParams(), filePath: 'Unrelated.md' })).toBeNull();
    });

    it('does not jump when the link target does not resolve', () => {
        expect(resolvePropertyNoteLensJump({ ...baseParams(), app: createLinkingApp() })).toBeNull();
    });

    it('does not jump without a property tree', () => {
        expect(resolvePropertyNoteLensJump({ ...baseParams(), propertyTree: null })).toBeNull();
    });
});

describe('shouldOpenPropertyNoteOnEnter', () => {
    it('returns true for Enter with the setting on and a property value selected', () => {
        expect(
            shouldOpenPropertyNoteOnEnter({
                isEnterKey: true,
                propertyNoteLinksEnabled: true,
                selectionType: ItemType.PROPERTY,
                selectedProperty: buildPropertyValueNodeId('references', 'apple')
            })
        ).toBe(true);
    });

    it('returns false for a non-Enter (e.g. arrow-key) event, even with everything else satisfied', () => {
        // This is the regression this helper exists to pin: arrow-key movement through the
        // tree must never open a note. Any non-Enter keyboard event, including ArrowUp/ArrowDown,
        // must return false.
        expect(
            shouldOpenPropertyNoteOnEnter({
                isEnterKey: false,
                propertyNoteLinksEnabled: true,
                selectionType: ItemType.PROPERTY,
                selectedProperty: buildPropertyValueNodeId('references', 'apple')
            })
        ).toBe(false);
    });

    it('returns false when the setting is off', () => {
        expect(
            shouldOpenPropertyNoteOnEnter({
                isEnterKey: true,
                propertyNoteLinksEnabled: false,
                selectionType: ItemType.PROPERTY,
                selectedProperty: buildPropertyValueNodeId('references', 'apple')
            })
        ).toBe(false);
    });

    it('returns false when the selection is not a property (e.g. a folder is selected)', () => {
        expect(
            shouldOpenPropertyNoteOnEnter({
                isEnterKey: true,
                propertyNoteLinksEnabled: true,
                selectionType: ItemType.FOLDER,
                selectedProperty: null
            })
        ).toBe(false);
    });

    it('returns false when there is no selected property node id', () => {
        expect(
            shouldOpenPropertyNoteOnEnter({
                isEnterKey: true,
                propertyNoteLinksEnabled: true,
                selectionType: ItemType.PROPERTY,
                selectedProperty: null
            })
        ).toBe(false);
    });
});
