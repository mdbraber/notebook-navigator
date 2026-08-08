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

import { useCallback, useMemo } from 'react';
import type React from 'react';
import { useSelectionState } from '../context/SelectionContext';
import { useCommandQueue, useServices } from '../context/ServicesContext';
import { useSettingsState } from '../context/SettingsContext';
import { useFileCache } from '../context/StorageContext';
import { ItemType } from '../types';
import { runAsyncAction } from '../utils/async';
import { resolveFolderNoteClickOpenContext } from '../utils/keyboardOpenContext';
import { resolvePropertyNote } from '../utils/propertyNoteLookup';
import { openPropertyNoteFile } from '../utils/propertyNotes';
import { resolvePropertyTreeNode } from '../utils/propertyTree';

export interface PropertyNoteLink {
    hasPropertyNote: boolean;
    handleClick: (event: React.MouseEvent<HTMLElement>) => void;
    handleMouseDown: (event: React.MouseEvent<HTMLElement>) => void;
}

/**
 * Resolves the note a selected property value links to and exposes click/mousedown
 * handlers that open it. Mirrors the folder-note interaction model: the currently
 * selected property value's title becomes clickable when its value is a wikilink
 * that resolves to an existing note.
 */
export function usePropertyNoteLink(): PropertyNoteLink {
    const { app, plugin } = useServices();
    const commandQueue = useCommandQueue();
    const settings = useSettingsState();
    const selectionState = useSelectionState();
    const { getPropertyTree } = useFileCache();

    // Property note links only apply when a property value is the active selection.
    const propertyNote = useMemo(() => {
        if (!settings.enablePropertyNotes || !settings.enablePropertyNoteLinks) {
            return null;
        }
        if (selectionState.selectionType !== ItemType.PROPERTY || !selectionState.selectedProperty) {
            return null;
        }

        const resolved = resolvePropertyTreeNode({
            nodeId: selectionState.selectedProperty,
            propertyTree: getPropertyTree()
        });

        return resolved ? resolvePropertyNote(resolved.node, app) : null;
    }, [
        settings.enablePropertyNotes,
        settings.enablePropertyNoteLinks,
        selectionState.selectionType,
        selectionState.selectedProperty,
        getPropertyTree,
        app
    ]);

    const handleClick = useCallback(
        (event: React.MouseEvent<HTMLElement>) => {
            if (!propertyNote) {
                return;
            }

            // Prevents title/header click handlers from also running.
            event.stopPropagation();

            const context = resolveFolderNoteClickOpenContext(event, settings.propertyNoteOpenLocation, settings.multiSelectModifier);
            runAsyncAction(() =>
                openPropertyNoteFile({
                    app,
                    commandQueue,
                    propertyNote,
                    context,
                    openInRightSidebar: propertyNoteFile => plugin.openPropertyNoteInRightSidebar(propertyNoteFile)
                })
            );
        },
        [propertyNote, app, commandQueue, plugin, settings.propertyNoteOpenLocation, settings.multiSelectModifier]
    );

    const handleMouseDown = useCallback(
        (event: React.MouseEvent<HTMLElement>) => {
            if (event.button !== 1 || !propertyNote) {
                return;
            }

            // Middle-click always opens in a new tab.
            event.preventDefault();
            event.stopPropagation();
            runAsyncAction(() => openPropertyNoteFile({ app, commandQueue, propertyNote, context: 'tab' }));
        },
        [propertyNote, app, commandQueue]
    );

    return useMemo(
        () => ({ hasPropertyNote: propertyNote !== null, handleClick, handleMouseDown }),
        [propertyNote, handleClick, handleMouseDown]
    );
}
