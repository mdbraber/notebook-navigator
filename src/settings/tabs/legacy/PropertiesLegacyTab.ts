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

import { Setting } from 'obsidian';
import { strings } from '../../../i18n';
import { FolderPathInputSuggest } from '../../../suggest/FolderPathInputSuggest';
import { normalizeOptionalVaultFolderPath } from '../../../utils/pathUtils';
import { wireToggleSettingWithDependentSection } from '../../dependentSettings';
import { createSettingGroupFactory } from '../../settingGroups';
import { addSettingSyncModeToggle } from '../../syncModeToggle';
import { isPropertyNoteOpenLocation, isTagSortOrder } from '../../types';
import type { SettingsTabContext } from '../SettingsTabContext';

/** Normalizes a stored property note folder path, matching the vault path createPropertyNote resolves against. */
function normalizePropertyNoteFolderValue(value: string): string {
    return normalizeOptionalVaultFolderPath(value) ?? '';
}

/** Legacy settings renderer used only by Obsidian versions before native 1.13 setting definitions. */
export function renderPropertiesTab(context: SettingsTabContext, heading?: string): void {
    const { containerEl, plugin } = context;
    const createGroup = createSettingGroupFactory(containerEl);

    const propertiesGroup = createGroup(heading);

    const showPropertiesSetting = propertiesGroup.addSetting(setting => {
        setting.setName(strings.settings.items.showProperties.name).setDesc(strings.settings.items.showProperties.desc);
    });

    const propertiesDependentSettingsEl = wireToggleSettingWithDependentSection(
        showPropertiesSetting,
        () => plugin.settings.showProperties,
        async value => {
            plugin.settings.showProperties = value;
            await plugin.saveSettingsAndUpdate();
        }
    );

    new Setting(propertiesDependentSettingsEl)
        .setName(strings.settings.items.showPropertyIcons.name)
        .setDesc(strings.settings.items.showPropertyIcons.desc)
        .addToggle(toggle =>
            toggle.setValue(plugin.settings.showPropertyIcons).onChange(async value => {
                plugin.settings.showPropertyIcons = value;
                await plugin.saveSettingsAndUpdate();
            })
        );

    new Setting(propertiesDependentSettingsEl)
        .setName(strings.settings.items.inheritPropertyColors.name)
        .setDesc(strings.settings.items.inheritPropertyColors.desc)
        .addToggle(toggle =>
            toggle.setValue(plugin.settings.inheritPropertyColors).onChange(async value => {
                plugin.settings.inheritPropertyColors = value;
                await plugin.saveSettingsAndUpdate();
            })
        );

    const propertySortOrderSetting = new Setting(propertiesDependentSettingsEl)
        .setName(strings.settings.items.propertySortOrder.name)
        .setDesc(strings.settings.items.propertySortOrder.desc)
        .addDropdown(dropdown => {
            const frequencyAscLabel = `${strings.settings.items.propertySortOrder.options.frequency} (${strings.settings.items.propertySortOrder.options.lowToHigh})`;
            const frequencyDescLabel = `${strings.settings.items.propertySortOrder.options.frequency} (${strings.settings.items.propertySortOrder.options.highToLow})`;

            dropdown
                .addOption('alpha-asc', strings.settings.items.propertySortOrder.options.alphaAsc)
                .addOption('alpha-desc', strings.settings.items.propertySortOrder.options.alphaDesc)
                .addOption('frequency-asc', frequencyAscLabel)
                .addOption('frequency-desc', frequencyDescLabel)
                .setValue(plugin.getPropertySortOrder())
                .onChange(value => {
                    if (!isTagSortOrder(value)) {
                        return;
                    }
                    plugin.setPropertySortOrder(value);
                });
        });

    addSettingSyncModeToggle({ setting: propertySortOrderSetting, plugin, settingId: 'propertySortOrder' });

    new Setting(propertiesDependentSettingsEl)
        .setName(strings.settings.items.showAllPropertiesFolder.name)
        .setDesc(strings.settings.items.showAllPropertiesFolder.desc)
        .addToggle(toggle =>
            toggle.setValue(plugin.settings.showAllPropertiesFolder).onChange(async value => {
                plugin.settings.showAllPropertiesFolder = value;
                await plugin.saveSettingsAndUpdate();
            })
        );

    new Setting(propertiesDependentSettingsEl)
        .setName(strings.settings.items.scopePropertiesToCurrentContext.name)
        .setDesc(strings.settings.items.scopePropertiesToCurrentContext.desc)
        .addToggle(toggle =>
            toggle.setValue(plugin.settings.scopePropertiesToCurrentContext).onChange(async value => {
                plugin.settings.scopePropertiesToCurrentContext = value;
                await plugin.saveSettingsAndUpdate();
            })
        );

    const propertyKeysInfoSetting = new Setting(propertiesDependentSettingsEl).setName('').setDesc('');
    propertyKeysInfoSetting.settingEl.addClass('nn-setting-info-container');
    propertyKeysInfoSetting.settingEl.addClass('nn-setting-property-keys-info');
    propertyKeysInfoSetting.setDesc(
        `${strings.settings.items.showProperties.propertyKeysInfoPrefix}${strings.settings.items.showProperties.propertyKeysInfoLinkText}${strings.settings.items.showProperties.propertyKeysInfoSuffix}`
    );

    const propertyNotesGroup = createGroup(strings.settings.sections.propertyNotes);

    const enablePropertyNotesSetting = propertyNotesGroup.addSetting(setting => {
        setting.setName(strings.settings.items.enablePropertyNotes.name).setDesc(strings.settings.items.enablePropertyNotes.desc);
    });

    // Both the links toggle and the open location only apply when property notes are on,
    // matching the native tab's visibility gates.
    const propertyNotesDependentSettingsEl = wireToggleSettingWithDependentSection(
        enablePropertyNotesSetting,
        () => plugin.settings.enablePropertyNotes,
        async value => {
            plugin.settings.enablePropertyNotes = value;
            await plugin.saveSettingsAndUpdate();
        }
    );

    new Setting(propertyNotesDependentSettingsEl)
        .setName(strings.settings.items.enablePropertyNoteLinks.name)
        .setDesc(strings.settings.items.enablePropertyNoteLinks.desc)
        .addToggle(toggle =>
            toggle.setValue(plugin.settings.enablePropertyNoteLinks).onChange(async value => {
                plugin.settings.enablePropertyNoteLinks = value;
                await plugin.saveSettingsAndUpdate();
            })
        );

    new Setting(propertyNotesDependentSettingsEl)
        .setName(strings.settings.items.autoOpenPropertyNote.name)
        .setDesc(strings.settings.items.autoOpenPropertyNote.desc)
        .addToggle(toggle =>
            toggle.setValue(plugin.settings.autoOpenPropertyNote).onChange(async value => {
                plugin.settings.autoOpenPropertyNote = value;
                await plugin.saveSettingsAndUpdate();
            })
        );

    new Setting(propertyNotesDependentSettingsEl)
        .setName(strings.settings.items.propertyNoteOpenLocation.name)
        .setDesc(strings.settings.items.propertyNoteOpenLocation.desc)
        .addDropdown(dropdown => {
            dropdown
                .addOption('current-tab', strings.settings.items.propertyNoteOpenLocation.options.currentTab)
                .addOption('new-tab', strings.settings.items.propertyNoteOpenLocation.options.newTab)
                .addOption('right-sidebar', strings.settings.items.propertyNoteOpenLocation.options.rightSidebar)
                .setValue(plugin.settings.propertyNoteOpenLocation)
                .onChange(async value => {
                    if (!isPropertyNoteOpenLocation(value)) {
                        return;
                    }
                    plugin.settings.propertyNoteOpenLocation = value;
                    await plugin.saveSettingsAndUpdate();
                });
        });

    new Setting(propertyNotesDependentSettingsEl)
        .setName(strings.settings.items.autoRevealPropertyNote.name)
        .setDesc(strings.settings.items.autoRevealPropertyNote.desc)
        .addToggle(toggle =>
            toggle.setValue(plugin.settings.autoRevealPropertyNote).onChange(async value => {
                plugin.settings.autoRevealPropertyNote = value;
                await plugin.saveSettingsAndUpdate();
            })
        );

    const propertyNoteFolderSetting = new Setting(propertyNotesDependentSettingsEl);
    context.configureDebouncedTextSetting(
        propertyNoteFolderSetting,
        strings.settings.items.propertyNoteFolder.name,
        strings.settings.items.propertyNoteFolder.desc,
        '',
        () => normalizePropertyNoteFolderValue(plugin.settings.propertyNoteFolder),
        value => {
            plugin.settings.propertyNoteFolder = normalizePropertyNoteFolderValue(value);
        }
    );
    propertyNoteFolderSetting.controlEl.addClass('nn-setting-wide-input');
    const propertyNoteFolderInputEl = propertyNoteFolderSetting.controlEl.querySelector<HTMLInputElement>('input');
    if (propertyNoteFolderInputEl) {
        const propertyNoteFolderSuggest = new FolderPathInputSuggest(context.app, propertyNoteFolderInputEl);
        propertyNoteFolderInputEl.addEventListener('click', () => propertyNoteFolderSuggest.open());
    }
}
