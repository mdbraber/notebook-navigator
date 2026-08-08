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

import { App, TFile, TFolder } from 'obsidian';
import { strings } from '../i18n';
import { CommandQueueService } from '../services/CommandQueueService';
import type { PropertyTreeNode } from '../types/storage';
import { buildPathInFolder, createMarkdownFileFromTemplatePreferTemplater } from './fileCreationUtils';
import { containsForbiddenNameCharactersWindows, containsInvalidLinkCharacters } from './fileNameUtils';
import { showNotice } from './noticeUtils';
import { openFileInContext } from './openFileInContext';
import { normalizeOptionalVaultFolderPath } from './pathUtils';
import { getPropertyNoteLinkTarget, getPropertyNoteSourcePath, resolvePropertyNote } from './propertyNoteLookup';

export interface OpenPropertyNoteFileParams {
    app: App;
    commandQueue: CommandQueueService | null;
    propertyNote: TFile;
    context: 'tab' | 'right-sidebar' | null;
    active?: boolean;
    /**
     * Routes the open through the plugin's property note sidebar leaf, which is reused across
     * opens. Callers that can reach the plugin should always pass it: the fallback below creates
     * a new leaf every time, so notes stack up in the sidebar.
     */
    openInRightSidebar?: (propertyNote: TFile) => Promise<void>;
}

export async function openPropertyNoteFile({
    app,
    commandQueue,
    propertyNote,
    context,
    active = true,
    openInRightSidebar
}: OpenPropertyNoteFileParams): Promise<void> {
    const openFile = async () => {
        if (context === 'right-sidebar') {
            if (openInRightSidebar) {
                await openInRightSidebar(propertyNote);
                return;
            }

            const leaf = app.workspace.getRightLeaf(true) ?? app.workspace.getRightLeaf(false);
            if (!leaf) {
                return;
            }

            await leaf.openFile(propertyNote, { active: false });
            await app.workspace.revealLeaf(leaf);
            return;
        }

        if (context) {
            await openFileInContext({ app, commandQueue, file: propertyNote, context, active });
            return;
        }

        const leaf = app.workspace.getLeaf(false);
        if (!leaf) {
            return;
        }

        await leaf.openFile(propertyNote, { active });
    };

    if (commandQueue) {
        await commandQueue.executeOpenPropertyNote(propertyNote.path, openFile);
        return;
    }

    await openFile();
}

export interface CreatePropertyNoteParams {
    app: App;
    commandQueue: CommandQueueService | null;
    node: PropertyTreeNode;
    propertyNoteFolder: string;
    openContext: 'tab' | 'right-sidebar' | null;
    openInRightSidebar?: (propertyNote: TFile) => Promise<void>;
}

/**
 * Resolves the folder a new property note should be created in, creating it when missing.
 * An empty setting defers to Obsidian's own default location for new notes.
 */
async function resolvePropertyNoteTargetFolder(app: App, folderPath: string, sourcePath: string): Promise<TFolder | null> {
    const trimmed = folderPath.trim();
    if (!trimmed) {
        return app.fileManager.getNewFileParent(sourcePath);
    }

    // Normalize before every lookup so a trailing slash (e.g. "References/") matches the same
    // folder buildPathInFolder would target. Without this, the pre-check and the post-createFolder
    // check both look up the raw, un-normalized path while vault.createFolder normalizes internally,
    // so the two sides silently disagree and a valid, existing folder path resolves to null.
    const normalizedPath = normalizeOptionalVaultFolderPath(trimmed) ?? trimmed;

    const existing = app.vault.getAbstractFileByPath(normalizedPath);
    if (existing instanceof TFolder) {
        return existing;
    }
    if (existing) {
        // A file already occupies the configured path.
        return null;
    }

    try {
        await app.vault.createFolder(normalizedPath);
    } catch {
        // Another process may have created it between the check and the call.
    }

    const created = app.vault.getAbstractFileByPath(normalizedPath);
    return created instanceof TFolder ? created : null;
}

/**
 * Checks whether a property note's would-be basename would create a file other than the one
 * the wikilink actually points at.
 *
 * - `containsInvalidLinkCharacters` (#, |, ^, :, %%, [[, ]]) catches heading/block-reference
 *   targets like [[Book#Chapter 3]] or [[Apple#^abc123]] - the link resolves only to Book.md /
 *   Apple.md, never to a file literally named after the anchor.
 * - `containsForbiddenNameCharactersWindows` catches names Obsidian itself would refuse to
 *   create on Windows, like [[A?B]].
 * - A literal "." disables Obsidian's own implicit ".md" suffixing when it resolves a wikilink
 *   (a well-known Obsidian behavior: a period in the target means the target is taken literally,
 *   extension included). So for [[Apple.md]] or [[Board.canvas]] the link points at that exact
 *   file, never at "{target}.md" - appending ".md" here would create "Apple.md.md" or
 *   "Board.canvas.md", a different file than the one being named.
 */
function baseNameWouldMismatchLinkTarget(baseName: string): boolean {
    return baseName.includes('.') || containsInvalidLinkCharacters(baseName) || containsForbiddenNameCharactersWindows(baseName);
}

/**
 * Creates the note a property value's wikilink points at, when it does not already resolve.
 *
 * A pathed wikilink (e.g. [[Fruits/Apple]]) resolves only to that exact path, so the folder
 * setting cannot apply to it - creating it anywhere else would leave the value still showing
 * as having no note. Only bare links (e.g. [[Apple]]) use propertyNoteFolder.
 */
export async function createPropertyNote({
    app,
    commandQueue,
    node,
    propertyNoteFolder,
    openContext,
    openInRightSidebar
}: CreatePropertyNoteParams): Promise<TFile | null> {
    const linkTarget = getPropertyNoteLinkTarget(node);
    if (!linkTarget) {
        return null;
    }

    if (resolvePropertyNote(node, app)) {
        showNotice(strings.fileSystem.errors.propertyNoteAlreadyExists, { variant: 'warning' });
        return null;
    }

    // A pathed link resolves only to its own path, so the folder setting cannot apply to it.
    const separatorIndex = linkTarget.lastIndexOf('/');
    const baseName = separatorIndex >= 0 ? linkTarget.slice(separatorIndex + 1) : linkTarget;
    const folderPath = separatorIndex >= 0 ? linkTarget.slice(0, separatorIndex) : propertyNoteFolder;

    // Refuse rather than sanitise: the feature's contract is "create the note this link points
    // at", and none of these basenames is that note. Sanitising would silently create a
    // different, unrelated file instead.
    if (baseNameWouldMismatchLinkTarget(baseName)) {
        showNotice(strings.fileSystem.errors.propertyNoteInvalidTarget, { variant: 'warning' });
        return null;
    }

    const targetFolder = await resolvePropertyNoteTargetFolder(app, folderPath, getPropertyNoteSourcePath(node));
    if (!targetFolder) {
        showNotice(strings.fileSystem.errors.propertyNoteFolderUnavailable, { variant: 'warning' });
        return null;
    }
    if (!baseName) {
        return null;
    }

    const notePath = buildPathInFolder(targetFolder.path, `${baseName}.md`);
    if (app.vault.getAbstractFileByPath(notePath)) {
        showNotice(strings.fileSystem.errors.propertyNoteAlreadyExists, { variant: 'warning' });
        return null;
    }

    try {
        const file = await createMarkdownFileFromTemplatePreferTemplater({
            app,
            folder: targetFolder,
            baseName,
            templatePath: null,
            templateErrorContext: 'property note'
        });

        await openPropertyNoteFile({ app, commandQueue, propertyNote: file, context: openContext, active: true, openInRightSidebar });
        return file;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        showNotice(strings.fileSystem.errors.createFile.replace('{error}', message), { variant: 'warning' });
        return null;
    }
}
