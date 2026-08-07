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

import { TFile, App } from 'obsidian';
import { SelectionDispatch, SelectionState } from '../context/SelectionContext';
import {
    ItemType,
    type NavigationItemType,
    type NavigatorContext,
    type PinnedSectionCollapseKey,
    type VisibilityPreferences
} from '../types';
import type { NotebookNavigatorSettings } from '../settings/types';
import type { IPropertyTreeProvider } from '../interfaces/IPropertyTreeProvider';
import type { ITagTreeProvider } from '../interfaces/ITagTreeProvider';
import { getFilesForFolder, getFilesForProperty, getFilesForTag } from './fileFinder';

/**
 * Utilities for managing file selection operations
 */

/**
 * Get the path of the currently selected folder or tag
 * @param selectionState The current selection state
 * @returns The path string or null if nothing is selected
 */
export function getSelectedPath(
    selectionState: Pick<SelectionState, 'selectionType' | 'selectedFolder' | 'selectedTag' | 'selectedProperty'>
): string | null {
    if (selectionState.selectionType === ItemType.FOLDER && selectionState.selectedFolder) {
        return selectionState.selectedFolder.path;
    }
    if (selectionState.selectionType === ItemType.TAG && selectionState.selectedTag) {
        return selectionState.selectedTag;
    }
    if (selectionState.selectionType === ItemType.PROPERTY && selectionState.selectedProperty) {
        return selectionState.selectedProperty;
    }
    return null;
}

/**
 * Get all files for the current selection (folder or tag)
 * @param selectionState The current selection state
 * @param settings Plugin settings
 * @param visibility Visibility preferences for descendant notes and hidden items display
 * @param app Obsidian app instance
 * @param tagTreeService Tag tree service for tag operations
 * @returns Array of files in the selected folder or with the selected tag
 */
export function getFilesForSelection(
    selectionState: SelectionState,
    settings: NotebookNavigatorSettings,
    visibility: VisibilityPreferences,
    app: App,
    tagTreeService: ITagTreeProvider | null,
    propertyTreeService: IPropertyTreeProvider | null
): TFile[] {
    return getFilesForNavigationSelection(
        {
            selectionType: selectionState.selectionType,
            selectedFolder: selectionState.selectedFolder,
            selectedTag: selectionState.selectedTag,
            selectedProperty: selectionState.selectedProperty
        },
        settings,
        visibility,
        app,
        tagTreeService,
        propertyTreeService
    );
}

export interface NavigationSelectionScope {
    selectionType: NavigationItemType | ItemType | null;
    selectedFolder?: SelectionState['selectedFolder'];
    selectedTag?: SelectionState['selectedTag'];
    selectedProperty?: SelectionState['selectedProperty'];
}

interface NavigationSelectionOptions {
    orderResults?: boolean;
}

export function getNavigatorPinContext(selectionType: NavigationSelectionScope['selectionType']): NavigatorContext {
    if (selectionType === ItemType.TAG) {
        return ItemType.TAG;
    }

    if (selectionType === ItemType.PROPERTY) {
        return ItemType.PROPERTY;
    }

    return ItemType.FOLDER;
}

export function getPinnedSectionCollapseKey(selectionScope: NavigationSelectionScope): PinnedSectionCollapseKey {
    if (selectionScope.selectionType === ItemType.TAG && selectionScope.selectedTag) {
        return `tag:${selectionScope.selectedTag}`;
    }

    if (selectionScope.selectionType === ItemType.PROPERTY && selectionScope.selectedProperty) {
        return `property:${selectionScope.selectedProperty}`;
    }

    return `folder:${selectionScope.selectedFolder?.path ?? '/'}`;
}

export function getFilesForNavigationSelection(
    selectionScope: NavigationSelectionScope,
    settings: NotebookNavigatorSettings,
    visibility: VisibilityPreferences,
    app: App,
    tagTreeService: ITagTreeProvider | null,
    propertyTreeService: IPropertyTreeProvider | null,
    options?: NavigationSelectionOptions
): TFile[] {
    if (selectionScope.selectionType === ItemType.FOLDER && selectionScope.selectedFolder) {
        return getFilesForFolder(selectionScope.selectedFolder, settings, visibility, app, options);
    }
    if (selectionScope.selectionType === ItemType.TAG && selectionScope.selectedTag) {
        return getFilesForTag(selectionScope.selectedTag, settings, visibility, app, tagTreeService, options);
    }
    if (selectionScope.selectionType === ItemType.PROPERTY && selectionScope.selectedProperty) {
        return getFilesForProperty(selectionScope.selectedProperty, settings, visibility, app, propertyTreeService, options);
    }
    return [];
}

/**
 * Find the next file to select after removing files (delete or move)
 * @param allFiles - All files in the current view
 * @param removedPaths - Set of paths that are being removed (deleted or moved)
 * @returns The file to select after removal, or null if none
 */
export function findNextFileAfterRemoval(allFiles: readonly TFile[], removedPaths: Set<string>): TFile | null {
    if (allFiles.length === 0) return null;

    // Find the first removed file's index
    let firstRemovedIndex = -1;
    for (let i = 0; i < allFiles.length; i++) {
        if (removedPaths.has(allFiles[i].path)) {
            firstRemovedIndex = i;
            break;
        }
    }

    if (firstRemovedIndex === -1) return null;

    // Strategy 1: Find first unselected file starting from first removed position
    for (let i = firstRemovedIndex; i < allFiles.length; i++) {
        if (!removedPaths.has(allFiles[i].path)) {
            return allFiles[i];
        }
    }

    // Strategy 2: If no file found after, look for first file before the selection
    if (firstRemovedIndex > 0) {
        for (let i = firstRemovedIndex - 1; i >= 0; i--) {
            if (!removedPaths.has(allFiles[i].path)) {
                return allFiles[i];
            }
        }
    }

    return null;
}

/**
 * Get files in range for shift-click selection
 * @param files - All files in order
 * @param startIndex - Starting index
 * @param endIndex - Ending index
 * @returns Array of files in the range
 */
export function getFilesInRange(files: TFile[], startIndex: number, endIndex: number): TFile[] {
    const minIndex = Math.max(0, Math.min(startIndex, endIndex));
    const maxIndex = Math.min(files.length - 1, Math.max(startIndex, endIndex));

    const result: TFile[] = [];
    for (let i = minIndex; i <= maxIndex; i++) {
        if (files[i]) {
            result.push(files[i]);
        }
    }

    return result;
}

export function mergeFilesIntoSelection(
    selectedFiles: ReadonlySet<string>,
    files: readonly TFile[]
): { selectedFiles: Set<string>; changed: boolean } {
    const nextSelectedFiles = new Set<string>(selectedFiles);
    let changed = false;

    files.forEach(file => {
        if (!nextSelectedFiles.has(file.path)) {
            changed = true;
        }

        nextSelectedFiles.add(file.path);
    });

    return {
        selectedFiles: nextSelectedFiles,
        changed
    };
}

/**
 * Find the index of a file in an ordered list
 * @param files - Ordered list of files
 * @param targetFile - File to find
 * @returns Index of the file, or -1 if not found
 */
export function findFileIndex(files: TFile[], targetFile: TFile | null): number {
    if (!targetFile) return -1;
    return files.findIndex(f => f.path === targetFile.path);
}

/**
 * Resolves which row of an ordered file list the list pane cursor sits on.
 *
 * Per-value property grouping renders a note once per value it carries, so the list can hold the same
 * path on several rows and the selected path alone cannot say which of them the user is on. The list
 * pane therefore remembers the row it last selected and passes it here: the remembered row wins while
 * it still holds the selected file, and a stale, cleared or out-of-range row falls back to the first
 * appearance, which is how the list behaved before rows could repeat.
 *
 * This is a cursor only. Selection identity stays the path, so every copy of a note highlights together.
 *
 * `fileIndexByPath` is an optional first-appearance index over the same list, used to keep the fallback
 * O(1) for callers that already build one; callers without it fall back to scanning `files`.
 */
export function resolveRowCursorFileIndex(
    files: TFile[],
    selectedFile: TFile | null,
    rowCursor: number | null | undefined,
    fileIndexByPath?: ReadonlyMap<string, number>
): number {
    if (!selectedFile) {
        return -1;
    }

    if (rowCursor !== null && rowCursor !== undefined && files[rowCursor]?.path === selectedFile.path) {
        return rowCursor;
    }

    if (fileIndexByPath) {
        return fileIndexByPath.get(selectedFile.path) ?? -1;
    }

    return findFileIndex(files, selectedFile);
}

export function orderFilesByReference(files: readonly TFile[], orderedFiles?: readonly TFile[]): TFile[] {
    if (!orderedFiles || files.length < 2) {
        return [...files];
    }

    const fileByPath = new Map(files.map(file => [file.path, file]));
    const ordered: TFile[] = [];
    const seenPaths = new Set<string>();

    orderedFiles.forEach(file => {
        const matchedFile = fileByPath.get(file.path);
        if (!matchedFile || seenPaths.has(file.path)) {
            return;
        }

        seenPaths.add(file.path);
        ordered.push(matchedFile);
    });

    files.forEach(file => {
        if (seenPaths.has(file.path)) {
            return;
        }

        seenPaths.add(file.path);
        ordered.push(file);
    });

    return ordered;
}

/**
 * Resolve the adjacent file in a visible file order.
 * Returns the first or last file when there is no current selection.
 *
 * `rowCursor` is the row the caller's cursor sits on, or null when the caller has no cursor to offer.
 * Per-value property grouping lets the same path hold several rows, so resolving the current file by its
 * first appearance would step onto the note's own next copy instead of leaving it. Callers outside the
 * list pane pass null and keep the first-appearance behaviour, which is correct for their deduplicated
 * file lists.
 */
export function getAdjacentFile(
    files: TFile[],
    targetFile: TFile | null,
    direction: 'next' | 'previous',
    rowCursor: number | null
): TFile | null {
    if (files.length === 0) {
        return null;
    }

    const currentIndex = resolveRowCursorFileIndex(files, targetFile, rowCursor);
    const targetIndex =
        currentIndex === -1 ? (direction === 'next' ? 0 : files.length - 1) : direction === 'next' ? currentIndex + 1 : currentIndex - 1;

    if (targetIndex < 0 || targetIndex >= files.length) {
        return null;
    }

    return files[targetIndex] ?? null;
}

/**
 * Update selection after a file operation (delete, move, etc.)
 * Handles both selection state update and opening the file in editor
 * @param nextFile - The file to select, or null to clear selection
 * @param dispatch - Selection dispatch function
 * @param app - Obsidian app instance
 * @param options - Optional configuration
 */
export async function updateSelectionAfterFileOperation(
    nextFile: TFile | null,
    dispatch: SelectionDispatch,
    app: App,
    options: {
        openInEditor?: boolean; // Whether to open the file in editor (default: true)
        activeFile?: boolean; // Whether to make the file active (default: false)
    } = {}
): Promise<void> {
    const { openInEditor = true, activeFile = false } = options;

    // No file to select, clear selection and return
    if (!nextFile) {
        dispatch({ type: 'CLEAR_FILE_SELECTION' });
        return;
    }

    // Update selection state
    dispatch({ type: 'SET_SELECTED_FILE', file: nextFile });

    // Skip opening file if not requested
    if (!openInEditor) {
        return;
    }

    // Open the file in editor
    const leaf = app.workspace.getLeaf(false);
    if (!leaf) {
        return;
    }

    try {
        await leaf.openFile(nextFile, { active: activeFile });
    } catch (error) {
        console.error('Failed to open next file:', error);
    }
}
