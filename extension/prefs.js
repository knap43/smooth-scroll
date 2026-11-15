// SPDX-License-Identifier: GPL-2.0-or-later
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class SmoothScrollPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup({
            title: 'Scrolling',
            description: 'Each wheel click glides instead of jumping.',
        });

        const enabled = new Adw.SwitchRow({title: 'Smooth scrolling'});
        settings.bind('enabled', enabled, 'active', Gio.SettingsBindFlags.DEFAULT);

        const speed = Adw.SpinRow.new_with_range(0.1, 10, 0.05);
        speed.title = 'Distance';
        speed.subtitle = 'Multiplier for how far one click scrolls';
        speed.digits = 2;
        settings.bind('speed', speed, 'value', Gio.SettingsBindFlags.DEFAULT);

        const duration = Adw.SpinRow.new_with_range(20, 2000, 10);
        duration.title = 'Glide duration';
        duration.subtitle = 'Milliseconds for a click to settle';
        settings.bind('duration', duration, 'value', Gio.SettingsBindFlags.DEFAULT);

        const horizontal = new Adw.SwitchRow({
            title: 'Horizontal scrolling',
            subtitle: 'Smooth tilt wheels and side wheels too',
        });
        settings.bind('horizontal', horizontal, 'active', Gio.SettingsBindFlags.DEFAULT);

        for (const row of [enabled, speed, duration, horizontal])
            group.add(row);
        page.add(group);
        window.add(page);
    }
}
