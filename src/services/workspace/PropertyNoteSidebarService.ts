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

import { FileView, TFile, type WorkspaceLeaf } from 'obsidian';
import type NotebookNavigatorPlugin from '../../main';
import { getLeafSplitLocation } from '../../utils/workspaceSplit';

/** Leaf view types that can display a property note, which is any file a wikilink resolves to */
const PROPERTY_NOTE_DOCUMENT_VIEW_TYPES = new Set(['markdown', 'canvas', 'base', 'excalidraw']);

/**
 * Keeps property notes opened in the right sidebar to a single leaf.
 *
 * Without a tracked leaf, every open calls getRightLeaf(true), which splits, so property
 * notes stack up one leaf per open. The service reuses only a leaf it created itself or a leaf
 * already showing the very note being opened: the right sidebar also holds unrelated tool panes
 * (backlinks, outline, and so on), and taking one of those over would be worse than the stacking
 * it replaces. That rules out getRightLeaf(false) as a reuse shortcut, since it returns whatever
 * leaf happens to be there.
 */
export class PropertyNoteSidebarService {
    private readonly plugin: NotebookNavigatorPlugin;
    /** The leaf this service created for property notes, if it is still around */
    private companionLeaf: WorkspaceLeaf | null = null;

    constructor(plugin: NotebookNavigatorPlugin) {
        this.plugin = plugin;
    }

    /**
     * Opens a property note in the sidebar leaf, creating that leaf on the first open.
     * The note opens without taking focus, matching the inline right-sidebar open it replaces.
     */
    async openPropertyNote(propertyNote: TFile): Promise<void> {
        const leaf = this.getOrCreateCompanionLeaf(propertyNote);
        if (!leaf) {
            return;
        }

        await leaf.openFile(propertyNote, { active: false });
        await this.plugin.app.workspace.revealLeaf(leaf);
    }

    private getOrCreateCompanionLeaf(propertyNote: TFile): WorkspaceLeaf | null {
        const existingLeaf = this.getUsableCompanionLeaf();
        if (existingLeaf) {
            return existingLeaf;
        }

        const restoredLeaf = this.findRestoredCompanionLeaf(propertyNote);
        if (restoredLeaf) {
            this.companionLeaf = restoredLeaf;
            return restoredLeaf;
        }

        const leaf = this.plugin.app.workspace.getRightLeaf(true) ?? this.plugin.app.workspace.getRightLeaf(false);
        this.companionLeaf = leaf;
        return leaf;
    }

    /**
     * Returns the tracked leaf when it can still be reused, clearing it otherwise.
     * A leaf stops being usable when the user closes it or drags it out of the right sidebar.
     */
    private getUsableCompanionLeaf(): WorkspaceLeaf | null {
        const leaf = this.companionLeaf;
        if (!leaf) {
            return null;
        }

        // leaf.detach() nulls leaf.parent, so this one check covers both ways the leaf can stop
        // being ours: the user closed it, or dragged it out of the right sidebar.
        if (getLeafSplitLocation(this.plugin.app, leaf) !== 'right-sidebar') {
            this.companionLeaf = null;
            return null;
        }

        return leaf;
    }

    /**
     * Finds a right sidebar leaf already displaying this exact note, so it can be adopted.
     *
     * While a property note sits in the right sidebar, Obsidian saves that leaf in the workspace
     * layout and restores it on the next launch, where companionLeaf starts null. Without this,
     * the first open after every restart would split a second leaf beside the restored one.
     * Only an exact path match is adopted: a leaf already showing the note being opened cannot be
     * a tool pane or unrelated content, so reusing it cannot clobber anything. A restored leaf
     * showing some other note is therefore left where it is, and opening a different property note
     * after a restart does leave it behind until the user closes it.
     */
    private findRestoredCompanionLeaf(propertyNote: TFile): WorkspaceLeaf | null {
        let match: WorkspaceLeaf | null = null;

        this.plugin.app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
            if (match || getLeafSplitLocation(this.plugin.app, leaf) !== 'right-sidebar') {
                return;
            }

            if (this.getFilePathFromLeaf(leaf) === propertyNote.path) {
                match = leaf;
            }
        });

        return match;
    }

    /**
     * The path of the file a leaf displays, or null when the leaf is not a document leaf.
     * The view type gate carries the safety: tool panes such as backlinks and outline put the file
     * they describe in their own view state, so matching on the path alone could hand one of those
     * to openFile.
     */
    private getFilePathFromLeaf(leaf: WorkspaceLeaf): string | null {
        const viewState = leaf.getViewState();
        if (!PROPERTY_NOTE_DOCUMENT_VIEW_TYPES.has(viewState.type)) {
            return null;
        }

        // A restored leaf can still be deferred, with no view instance to ask, which is why the
        // saved view state is the fallback.
        const view = leaf.view;
        if (typeof FileView === 'function' && view instanceof FileView && view.file instanceof TFile) {
            return view.file.path;
        }

        const filePath = viewState.state?.file;
        return typeof filePath === 'string' && filePath.length > 0 ? filePath : null;
    }
}
