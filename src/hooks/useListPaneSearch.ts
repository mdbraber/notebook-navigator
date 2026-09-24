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

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { App } from 'obsidian';
import { useExpansionState } from '../context/ExpansionContext';
import { useSelectionState } from '../context/SelectionContext';
import { useServices } from '../context/ServicesContext';
import { useSettingsState } from '../context/SettingsContext';
import { useShortcuts } from '../context/ShortcutsContext';
import { useUIDispatch } from '../context/UIStateContext';
import { useUXPreferenceActions, useUXPreferences } from '../context/UXPreferencesContext';
import { strings } from '../i18n';
import { InputModal } from '../modals/InputModal';
import { PROPERTIES_ROOT_VIRTUAL_FOLDER_ID, TAGGED_TAG_ID, UNTAGGED_TAG_ID } from '../types';
import { TIMEOUTS } from '../types/obsidian-extended';
import {
    ShortcutStartType,
    isShortcutStartFolder,
    isShortcutStartProperty,
    isShortcutStartTag,
    type SearchShortcut,
    type ShortcutStartProperty,
    type ShortcutStartTarget
} from '../types/shortcuts';
import { EMPTY_SEARCH_NAV_FILTER_STATE, type SearchNavFilterState, type SearchProvider } from '../types/search';
import { focusElementPreventScroll } from '../utils/domUtils';
import {
    buildSearchNavFilterState,
    parseFilterSearchTokens,
    updateFilterQueryWithDateToken,
    updateFilterQueryWithProperty,
    updateFilterQueryWithTag,
    type InclusionOperator
} from '../utils/filterSearch';
import { showNotice } from '../utils/noticeUtils';
import { supportsKeyboardInteractions } from '../utils/paneLayout';
import { normalizeOptionalVaultFolderPath } from '../utils/pathUtils';
import { EMPTY_PROPERTY_HIERARCHY_INDEX, type PropertyHierarchyIndex } from '../utils/propertyHierarchy';
import { parsePropertyNodeId } from '../utils/propertyTree';
import { resolveRenderedPropertyPlacementChain } from '../utils/treeFlattener';
import { resolveFolderShortcutTarget } from '../utils/shortcutPathResolver';
import { normalizeTagPath } from '../utils/tagUtils';
import type { FilterSearchTokens } from '../utils/filterSearch';
import type { PropertyTreeNode } from '../types/storage';
import type { NavigateToFolderOptions, RevealPropertyOptions, RevealTagOptions } from './useNavigatorReveal';
import type { EnsureSelectionOptions, EnsureSelectionResult } from './useListPaneSelectionCoordinator';

interface ExecuteSearchShortcutParams {
    searchShortcut: SearchShortcut;
}

export interface SearchQueryUpdateOptions {
    focusSearch?: boolean;
}

interface UseListPaneSearchParams {
    rootContainerRef: RefObject<HTMLDivElement | null>;
    onSearchTokensChange?: (state: SearchNavFilterState) => void;
    onNavigateToFolder: (folderPath: string, options?: NavigateToFolderOptions) => void;
    onRevealTag: (tagPath: string, options?: RevealTagOptions) => void;
    onRevealProperty: (propertyNodeId: string, options?: RevealPropertyOptions) => boolean;
    ensureSelectionForCurrentFilterRef: RefObject<((options?: EnsureSelectionOptions) => EnsureSelectionResult) | null>;
}

export interface UseListPaneSearchResult {
    isSearchActive: boolean;
    searchProvider: SearchProvider;
    searchQuery: string;
    debouncedSearchQuery: string;
    debouncedSearchTokens: FilterSearchTokens;
    searchHighlightTerms: readonly string[] | undefined;
    shouldFocusSearch: boolean;
    activeSearchShortcut: SearchShortcut | null;
    isSavingSearchShortcut: boolean;
    suppressSearchTopScrollRef: { current: boolean };
    setSearchQuery: Dispatch<SetStateAction<string>>;
    setShouldFocusSearch: Dispatch<SetStateAction<boolean>>;
    handleSearchToggle: () => void;
    closeSearch: () => void;
    focusSearchComplete: () => void;
    handleSaveSearchShortcut: () => void;
    handleRemoveSearchShortcut: () => Promise<void>;
    modifySearchWithTag: (tag: string, operator: InclusionOperator, options?: SearchQueryUpdateOptions) => void;
    modifySearchWithProperty: (key: string, value: string | null, operator: InclusionOperator, options?: SearchQueryUpdateOptions) => void;
    modifySearchWithDateToken: (dateToken: string, options?: SearchQueryUpdateOptions) => void;
    toggleSearch: () => void;
    executeSearchShortcut: (params: ExecuteSearchShortcutParams) => Promise<void>;
}

/** Stands in for the property tree before the service has one, so neither reader allocates per call. */
const EMPTY_PROPERTY_TREE: ReadonlyMap<string, PropertyTreeNode> = new Map();

function formatSearchShortcutFolderLabel(folderPath: string): string {
    if (folderPath === '/' || folderPath.startsWith('/')) {
        return folderPath;
    }

    return `/${folderPath}`;
}

function formatSearchShortcutTagLabel(tagPath: string): string {
    if (tagPath === TAGGED_TAG_ID) {
        return strings.tagList.tags;
    }

    if (tagPath === UNTAGGED_TAG_ID) {
        return strings.common.untagged;
    }

    if (tagPath.startsWith('#')) {
        return tagPath;
    }

    return `#${tagPath}`;
}

/**
 * Names a property node the way the list pane breadcrumb does: the key, then the value, both in the
 * casing the vault wrote them in. The node id alone carries neither - it is casefolded, and a value id
 * says nothing about which key it belongs to - so a label built from it reads as some unrelated value
 * in lower case. Falls back to the id's own parts for a node the tree no longer holds.
 */
function formatSearchShortcutPropertyLabel(nodeId: string, propertyTree: ReadonlyMap<string, PropertyTreeNode>): string {
    if (nodeId === PROPERTIES_ROOT_VIRTUAL_FOLDER_ID) {
        return strings.navigationPane.properties;
    }

    const parsed = parsePropertyNodeId(nodeId);
    if (!parsed) {
        return nodeId;
    }

    const keyNode = propertyTree.get(parsed.key) ?? null;
    const displayKey = keyNode?.name ?? parsed.key;
    if (!parsed.valuePath) {
        return displayKey;
    }

    const valueNode = keyNode?.children.get(nodeId) ?? null;
    return `${displayKey}/${valueNode?.displayPath ?? parsed.valuePath}`;
}

export function formatSearchShortcutStartTargetPath(
    startTarget: ShortcutStartTarget,
    propertyTree: ReadonlyMap<string, PropertyTreeNode>
): string {
    switch (startTarget.type) {
        case ShortcutStartType.FOLDER:
            return formatSearchShortcutFolderLabel(startTarget.path);
        case ShortcutStartType.TAG:
            return formatSearchShortcutTagLabel(startTarget.tagPath);
        case ShortcutStartType.PROPERTY:
            return formatSearchShortcutPropertyLabel(startTarget.nodeId, propertyTree);
    }
}

/**
 * Property start target for a node, carrying which of its placements the search should start in when
 * that is not in doubt.
 *
 * A value of a key marked Hierarchical can render at several places at once, and neither selection nor
 * the node id records which one the user is looking at, so the only evidence is the tree on screen: a
 * chain is recorded exactly when one row for the value is currently rendered. With several open the
 * target keeps just the node id, which leaves reveal picking a placement the way it always has.
 */
export function resolveSearchShortcutPropertyStartTarget({
    nodeId,
    propertyTree,
    hierarchyIndex,
    expandedProperties,
    maxDepth
}: {
    nodeId: string;
    propertyTree: ReadonlyMap<string, PropertyTreeNode>;
    hierarchyIndex: PropertyHierarchyIndex;
    expandedProperties: ReadonlySet<string>;
    maxDepth: number;
}): ShortcutStartProperty {
    const startTarget: ShortcutStartProperty = { type: ShortcutStartType.PROPERTY, nodeId };

    const parsed = parsePropertyNodeId(nodeId);
    const keyNode = parsed?.valuePath ? (propertyTree.get(parsed.key) ?? null) : null;
    if (!keyNode) {
        return startTarget;
    }

    const placementChain = resolveRenderedPropertyPlacementChain({
        keyNode,
        nodeId,
        index: hierarchyIndex,
        expandedPlacements: expandedProperties,
        maxDepth
    });

    // A root placement is where the reveal's own walk already lands, so recording one would only add a
    // way for the stored chain and that walk to disagree after the vault changes.
    if (!placementChain || placementChain.length < 2) {
        return startTarget;
    }

    return { ...startTarget, placementChain };
}

export function resolveSearchShortcutStartFolderPath(app: App, startTarget: ShortcutStartTarget): string | null {
    if (!isShortcutStartFolder(startTarget)) {
        return null;
    }

    const normalizedStartFolder = normalizeOptionalVaultFolderPath(startTarget.path);
    if (!normalizedStartFolder) {
        return null;
    }

    return resolveFolderShortcutTarget(app, normalizedStartFolder)?.path ?? null;
}

export function useListPaneSearch({
    rootContainerRef,
    onSearchTokensChange,
    onNavigateToFolder,
    onRevealTag,
    onRevealProperty,
    ensureSelectionForCurrentFilterRef
}: UseListPaneSearchParams): UseListPaneSearchResult {
    const { app, plugin, propertyTreeService } = useServices();
    const settings = useSettingsState();
    const selectionState = useSelectionState();
    const expansionState = useExpansionState();
    const shortcuts = useShortcuts();
    const uiDispatch = useUIDispatch();
    const uxPreferences = useUXPreferences();
    const { setSearchActive } = useUXPreferenceActions();
    const { addSearchShortcut, removeSearchShortcut, searchShortcutsByName } = shortcuts;
    const searchShortcuts = useMemo(() => Array.from(searchShortcutsByName.values()), [searchShortcutsByName]);

    const isSearchActive = uxPreferences.searchActive;
    const searchProvider: SearchProvider = settings.searchProvider ?? 'internal';
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
    const [shouldFocusSearch, setShouldFocusSearch] = useState(false);
    const [isSavingSearchShortcut, setIsSavingSearchShortcut] = useState(false);
    const suppressSearchTopScrollRef = useRef(false);

    const debouncedSearchTokens = useMemo(
        () => parseFilterSearchTokens(isSearchActive ? debouncedSearchQuery : ''),
        [debouncedSearchQuery, isSearchActive]
    );
    // Name highlighting uses parsed folded name tokens instead of the raw query so quoted literal
    // terms (for example `".F"`) highlight without their quotes and filter tokens such as
    // `folder:...` never leak into name highlights. Tokens are parsed from the immediate query,
    // not the debounced one, so highlights keep tracking while the user types.
    const searchHighlightTerms = useMemo(() => {
        if (!isSearchActive) {
            return undefined;
        }

        const tokens = parseFilterSearchTokens(searchQuery);
        if (tokens.mode === 'tag' || tokens.nameTokens.length === 0) {
            return undefined;
        }

        return tokens.nameTokens;
    }, [isSearchActive, searchQuery]);

    const activeSearchShortcut = useMemo(() => {
        const normalizedQuery = searchQuery.trim();
        if (!normalizedQuery) {
            return null;
        }

        const normalizedProvider = searchProvider ?? 'internal';
        let firstMatch: SearchShortcut | null = null;

        for (const saved of searchShortcuts) {
            if (saved.query !== normalizedQuery) {
                continue;
            }

            if (!firstMatch) {
                firstMatch = saved;
            }

            const savedProvider = saved.provider ?? 'internal';
            if (savedProvider === normalizedProvider) {
                return saved;
            }
        }

        return firstMatch;
    }, [searchProvider, searchQuery, searchShortcuts]);

    useEffect(() => {
        if (!isSearchActive && searchQuery) {
            setSearchQuery('');
        }
    }, [isSearchActive, searchQuery]);

    useEffect(() => {
        if (!isSearchActive) {
            if (debouncedSearchQuery) {
                setDebouncedSearchQuery('');
            }
            return;
        }

        if (debouncedSearchQuery === searchQuery) {
            return;
        }

        const timeoutId = window.setTimeout(() => {
            setDebouncedSearchQuery(searchQuery);
        }, TIMEOUTS.DEBOUNCE_KEYBOARD);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [debouncedSearchQuery, isSearchActive, searchQuery]);

    useEffect(() => {
        if (!onSearchTokensChange) {
            return;
        }

        const nextState = searchQuery.trim() ? buildSearchNavFilterState(searchQuery) : EMPTY_SEARCH_NAV_FILTER_STATE;
        onSearchTokensChange(nextState);
    }, [onSearchTokensChange, searchQuery]);

    // Resolved when the save modal opens rather than on every render: the property tree and its
    // hierarchy index are read from a service, which does not re-render this hook when it changes, and
    // a start target is only ever wanted at the moment a shortcut is saved.
    const resolveActiveSearchShortcutStartTarget = useCallback((): ShortcutStartTarget | undefined => {
        if (selectionState.selectionType === 'folder' && selectionState.selectedFolder) {
            return {
                type: ShortcutStartType.FOLDER,
                path: selectionState.selectedFolder.path
            };
        }

        if (selectionState.selectionType === 'tag' && selectionState.selectedTag) {
            return {
                type: ShortcutStartType.TAG,
                tagPath: selectionState.selectedTag
            };
        }

        if (selectionState.selectionType === 'property' && selectionState.selectedProperty) {
            return resolveSearchShortcutPropertyStartTarget({
                nodeId: selectionState.selectedProperty,
                propertyTree: propertyTreeService?.getPropertyTree() ?? EMPTY_PROPERTY_TREE,
                hierarchyIndex: propertyTreeService?.getHierarchyIndex() ?? EMPTY_PROPERTY_HIERARCHY_INDEX,
                expandedProperties: expansionState.expandedProperties,
                maxDepth: settings.propertyHierarchyMaxDepth
            });
        }

        return undefined;
    }, [
        expansionState.expandedProperties,
        propertyTreeService,
        selectionState.selectedFolder,
        selectionState.selectedProperty,
        selectionState.selectedTag,
        selectionState.selectionType,
        settings.propertyHierarchyMaxDepth
    ]);

    const activateSearch = useCallback(
        (target: 'search' | 'files' | null = 'search') => {
            if (!isSearchActive) {
                setSearchActive(true);
            }

            if (target) {
                uiDispatch({ type: 'ACTIVATE_PANE', target });
            }
        },
        [isSearchActive, setSearchActive, uiDispatch]
    );

    const closeSearch = useCallback(() => {
        setSearchActive(false);
        uiDispatch({ type: 'ACTIVATE_PANE', target: 'files' });
    }, [setSearchActive, uiDispatch]);

    const handleSearchToggle = useCallback(() => {
        if (!isSearchActive) {
            setShouldFocusSearch(true);
            activateSearch();
            return;
        }

        closeSearch();
    }, [activateSearch, closeSearch, isSearchActive]);

    const handleSaveSearchShortcut = useCallback(() => {
        const normalizedQuery = searchQuery.trim();
        if (!normalizedQuery || isSavingSearchShortcut) {
            return;
        }

        const startTarget = resolveActiveSearchShortcutStartTarget();
        const startTargetLabel = startTarget
            ? strings.searchInput.shortcutStartIn.replace(
                  '{path}',
                  formatSearchShortcutStartTargetPath(startTarget, propertyTreeService?.getPropertyTree() ?? EMPTY_PROPERTY_TREE)
              )
            : null;
        let modal: InputModal | null = null;

        modal = new InputModal(
            app,
            strings.searchInput.shortcutModalTitle,
            strings.searchInput.shortcutNamePlaceholder,
            async (rawName, context) => {
                const trimmedName = rawName.trim();
                if (trimmedName.length === 0) {
                    showNotice(strings.shortcuts.emptySearchName, { variant: 'warning' });
                    return;
                }

                setIsSavingSearchShortcut(true);
                try {
                    const saveStartTarget = context?.checkboxValue ? startTarget : undefined;
                    const success = await addSearchShortcut({
                        name: trimmedName,
                        query: normalizedQuery,
                        provider: searchProvider,
                        startTarget: saveStartTarget
                    });
                    if (success) {
                        modal?.close();
                    }
                } finally {
                    setIsSavingSearchShortcut(false);
                }
            },
            normalizedQuery,
            {
                closeOnSubmit: false,
                checkbox: startTargetLabel
                    ? {
                          label: startTargetLabel,
                          defaultChecked: false
                      }
                    : undefined
            }
        );

        modal.open();
    }, [
        addSearchShortcut,
        app,
        isSavingSearchShortcut,
        propertyTreeService,
        resolveActiveSearchShortcutStartTarget,
        searchProvider,
        searchQuery
    ]);

    const handleRemoveSearchShortcut = useCallback(async () => {
        if (!activeSearchShortcut || isSavingSearchShortcut) {
            return;
        }

        setIsSavingSearchShortcut(true);
        try {
            await removeSearchShortcut(activeSearchShortcut.name);
        } finally {
            setIsSavingSearchShortcut(false);
        }
    }, [activeSearchShortcut, isSavingSearchShortcut, removeSearchShortcut]);

    const updateSearchQuery = useCallback(
        (mutate: (query: string) => string, options?: SearchQueryUpdateOptions) => {
            const shouldFocusSearch = options?.focusSearch !== false;
            if (shouldFocusSearch) {
                setShouldFocusSearch(true);
            }
            activateSearch(shouldFocusSearch ? 'search' : null);

            let nextQueryValue: string | null = null;
            setSearchQuery(previousQuery => {
                const updatedQuery = mutate(previousQuery);
                nextQueryValue = updatedQuery;
                return updatedQuery;
            });

            if (nextQueryValue !== null) {
                setDebouncedSearchQuery(nextQueryValue);
            }
        },
        [activateSearch]
    );

    const modifySearchWithTag = useCallback(
        (tag: string, operator: InclusionOperator, options?: SearchQueryUpdateOptions) => {
            const normalizedTag = normalizeTagPath(tag);
            if (!normalizedTag || normalizedTag === UNTAGGED_TAG_ID) {
                return;
            }

            updateSearchQuery(query => updateFilterQueryWithTag(query, normalizedTag, operator).query, options);
        },
        [updateSearchQuery]
    );

    const modifySearchWithProperty = useCallback(
        (key: string, value: string | null, operator: InclusionOperator, options?: SearchQueryUpdateOptions) => {
            const normalizedKey = key.trim();
            if (!normalizedKey) {
                return;
            }

            updateSearchQuery(query => updateFilterQueryWithProperty(query, normalizedKey, value, operator).query, options);
        },
        [updateSearchQuery]
    );

    const modifySearchWithDateToken = useCallback(
        (dateToken: string, options?: SearchQueryUpdateOptions) => {
            const normalizedToken = dateToken.trim();
            if (!normalizedToken) {
                return;
            }

            if (searchProvider !== 'internal') {
                plugin.setSearchProvider('internal');
            }

            updateSearchQuery(query => updateFilterQueryWithDateToken(query, normalizedToken).query, options);
        },
        [plugin, searchProvider, updateSearchQuery]
    );

    const waitForNextFrame = useCallback(() => {
        return new Promise<void>(resolve => {
            window.requestAnimationFrame(() => resolve());
        });
    }, []);

    const waitForSinglePaneTransition = useCallback(async () => {
        const container = rootContainerRef.current;
        if (!container) {
            return;
        }

        // Dual pane switches views without a sliding transition and never gets the
        // show-files class, so waiting would always run until the full deadline.
        if (!container.classList.contains('nn-single-pane')) {
            return;
        }

        const transitionDurationMs = settings.paneTransitionDuration;
        const deadline = performance.now() + transitionDurationMs + 20;
        while (performance.now() < deadline && container.isConnected && !container.classList.contains('show-files')) {
            await new Promise(requestAnimationFrame);
        }
    }, [rootContainerRef, settings.paneTransitionDuration]);

    const focusListScroller = useCallback(() => {
        const scope = rootContainerRef.current ?? activeDocument;
        const listPaneScroller = scope.querySelector('.nn-list-pane-scroller');
        if (listPaneScroller instanceof HTMLElement) {
            focusElementPreventScroll(listPaneScroller);
        }
    }, [rootContainerRef]);

    const focusSearchInput = useCallback(() => {
        window.setTimeout(() => {
            const scope = rootContainerRef.current ?? activeDocument;
            const searchInput = scope.querySelector('.nn-search-input');
            if (searchInput instanceof HTMLInputElement) {
                searchInput.focus();
                uiDispatch({ type: 'ACTIVATE_PANE', target: 'search' });
            }
        }, 0);
    }, [rootContainerRef, uiDispatch]);

    const toggleSearch = useCallback(() => {
        if (isSearchActive) {
            focusSearchInput();
            return;
        }

        setShouldFocusSearch(true);
        activateSearch();
    }, [activateSearch, focusSearchInput, isSearchActive]);

    const executeSearchShortcut = useCallback(
        async ({ searchShortcut }: ExecuteSearchShortcutParams) => {
            const normalizedQuery = searchShortcut.query.trim();
            const targetProvider = searchShortcut.provider ?? 'internal';
            const startTarget = searchShortcut.startTarget;

            plugin.setSearchProvider(targetProvider);

            if (startTarget) {
                if (isShortcutStartFolder(startTarget)) {
                    const startFolderPath = resolveSearchShortcutStartFolderPath(app, startTarget);
                    if (startFolderPath) {
                        onNavigateToFolder(startFolderPath, {
                            source: 'shortcut',
                            suppressAutoSelect: true,
                            skipScroll: settings.skipAutoScroll
                        });
                    }
                } else if (isShortcutStartTag(startTarget)) {
                    onRevealTag(startTarget.tagPath, { source: 'shortcut', skipScroll: settings.skipAutoScroll });
                } else if (isShortcutStartProperty(startTarget)) {
                    onRevealProperty(startTarget.nodeId, {
                        source: 'shortcut',
                        skipScroll: settings.skipAutoScroll,
                        placementChain: startTarget.placementChain
                    });
                }
            }

            uiDispatch({ type: 'ACTIVATE_PANE', target: 'files' });

            // The sliding view transition only exists in single pane. Dual pane switches
            // instantly, so suppressing the post-search scroll there would swallow the
            // first legitimate scroll to top after filtering.
            if (rootContainerRef.current?.classList.contains('nn-single-pane')) {
                suppressSearchTopScrollRef.current = true;
                await waitForSinglePaneTransition();
            }

            if (!isSearchActive) {
                setSearchActive(true);
            }

            setShouldFocusSearch(false);
            setSearchQuery(normalizedQuery);
            setDebouncedSearchQuery(normalizedQuery);

            await waitForNextFrame();
            await waitForNextFrame();

            if (supportsKeyboardInteractions()) {
                ensureSelectionForCurrentFilterRef.current?.({ openInEditor: false, clearIfEmpty: true, selectFallback: true });
            }

            focusListScroller();
        },
        [
            app,
            ensureSelectionForCurrentFilterRef,
            focusListScroller,
            isSearchActive,
            onNavigateToFolder,
            onRevealProperty,
            onRevealTag,
            plugin,
            rootContainerRef,
            setSearchActive,
            settings.skipAutoScroll,
            uiDispatch,
            waitForSinglePaneTransition,
            waitForNextFrame
        ]
    );

    return {
        isSearchActive,
        searchProvider,
        searchQuery,
        debouncedSearchQuery,
        debouncedSearchTokens,
        searchHighlightTerms,
        shouldFocusSearch,
        activeSearchShortcut,
        isSavingSearchShortcut,
        suppressSearchTopScrollRef,
        setSearchQuery,
        setShouldFocusSearch,
        handleSearchToggle,
        closeSearch,
        focusSearchComplete: () => setShouldFocusSearch(false),
        handleSaveSearchShortcut,
        handleRemoveSearchShortcut,
        modifySearchWithTag,
        modifySearchWithProperty,
        modifySearchWithDateToken,
        toggleSearch,
        executeSearchShortcut
    };
}
