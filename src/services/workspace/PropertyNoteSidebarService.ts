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

import type { TFile, WorkspaceLeaf } from 'obsidian';
import type NotebookNavigatorPlugin from '../../main';
import { getLeafSplitLocation } from '../../utils/workspaceSplit';

/**
 * Keeps property notes opened in the right sidebar to a single leaf.
 *
 * Without a tracked leaf, every open calls getRightLeaf(true), which splits, so property
 * notes stack up one leaf per open. Only leaves this service created are ever reused: the
 * right sidebar also holds unrelated tool panes (backlinks, outline, and so on), and taking
 * one of those over would be worse than the stacking it replaces. That rules out
 * getRightLeaf(false) as a reuse shortcut, since it returns whatever leaf happens to be there.
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
        const leaf = this.getOrCreateCompanionLeaf();
        if (!leaf) {
            return;
        }

        await leaf.openFile(propertyNote, { active: false });
        await this.plugin.app.workspace.revealLeaf(leaf);
    }

    private getOrCreateCompanionLeaf(): WorkspaceLeaf | null {
        const existingLeaf = this.getUsableCompanionLeaf();
        if (existingLeaf) {
            return existingLeaf;
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

        // A detached leaf keeps both its object identity and its parent reference, so the split
        // check alone cannot tell it apart from an attached one. Ask the workspace instead.
        if (!this.isLeafAttached(leaf) || getLeafSplitLocation(this.plugin.app, leaf) !== 'right-sidebar') {
            this.companionLeaf = null;
            return null;
        }

        return leaf;
    }

    private isLeafAttached(leaf: WorkspaceLeaf): boolean {
        let attached = false;
        this.plugin.app.workspace.iterateAllLeaves((candidate: WorkspaceLeaf) => {
            if (candidate === leaf) {
                attached = true;
            }
        });

        return attached;
    }
}
