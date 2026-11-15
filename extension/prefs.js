// SPDX-License-Identifier: GPL-2.0-or-later
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

function readRules(settings) {
    try {
        const rules = JSON.parse(settings.get_string('app-rules'));
        return rules && typeof rules === 'object' ? rules : {};
    } catch {
        return {};
    }
}

function appIcon(info) {
    return new Gtk.Image({
        gicon: info?.get_icon() ?? Gio.ThemedIcon.new('application-x-executable'),
        icon_size: Gtk.IconSize.LARGE,
    });
}

function describe(rule) {
    return rule.enabled
        ? `Distance ${rule.speed.toFixed(2)} · ${rule.duration} ms`
        : 'Smoothing off';
}

export default class SmoothScrollPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage();
        page.add(this._globalGroup(settings));
        page.add(this._rulesGroup(settings, window));
        window.add(page);
    }

    _globalGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: 'Scrolling',
            description: 'Each wheel click glides instead of jumping.',
        });

        const enabled = new Adw.SwitchRow({title: 'Smooth scrolling'});
        settings.bind('enabled', enabled, 'active', Gio.SettingsBindFlags.DEFAULT);

        const speed = this._speedRow();
        settings.bind('speed', speed, 'value', Gio.SettingsBindFlags.DEFAULT);

        const duration = this._durationRow();
        settings.bind('duration', duration, 'value', Gio.SettingsBindFlags.DEFAULT);

        const horizontal = new Adw.SwitchRow({
            title: 'Horizontal scrolling',
            subtitle: 'Smooth tilt wheels and side wheels too',
        });
        settings.bind('horizontal', horizontal, 'active', Gio.SettingsBindFlags.DEFAULT);

        for (const row of [enabled, speed, duration, horizontal])
            group.add(row);
        return group;
    }

    _speedRow() {
        const row = Adw.SpinRow.new_with_range(0.1, 10, 0.05);
        row.title = 'Distance';
        row.subtitle = 'Multiplier for how far one click scrolls';
        row.digits = 2;
        return row;
    }

    _durationRow() {
        const row = Adw.SpinRow.new_with_range(20, 2000, 10);
        row.title = 'Glide duration';
        row.subtitle = 'Milliseconds for a click to settle';
        return row;
    }

    _rulesGroup(settings, window) {
        const group = new Adw.PreferencesGroup({
            title: 'App Rules',
            description: 'Applied to the app under the pointer. Other apps use the settings above.',
        });
        const add = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            tooltip_text: 'Add App',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        group.set_header_suffix(add);

        let rows = [];
        const rebuild = () => {
            rows.forEach(row => group.remove(row));
            const rules = readRules(settings);
            rows = Object.keys(rules)
                .map(id => this._ruleRow(settings, id, rules[id], rebuild))
                .sort((a, b) => a.title.localeCompare(b.title));
            if (rows.length === 0) {
                rows.push(new Adw.ActionRow({
                    title: 'No app rules',
                    subtitle: 'Add an app to turn smoothing off for it, or tune it separately.',
                    sensitive: false,
                }));
            }
            rows.forEach(row => group.add(row));
        };

        add.connect('clicked', () => {
            const rules = readRules(settings);
            this._pickApp(window, new Set(Object.keys(rules)), id => {
                const latest = readRules(settings);
                latest[id] = {
                    enabled: false,
                    speed: settings.get_double('speed'),
                    duration: settings.get_int('duration'),
                };
                settings.set_string('app-rules', JSON.stringify(latest));
                rebuild();
            });
        });

        rebuild();
        return group;
    }

    _ruleRow(settings, id, stored, rebuild) {
        const rule = {
            enabled: stored.enabled !== false,
            speed: Number(stored.speed) || settings.get_double('speed'),
            duration: Number(stored.duration) || settings.get_int('duration'),
        };
        const info = GioUnix.DesktopAppInfo.new(id);
        const row = new Adw.ExpanderRow({
            title: info?.get_display_name() ?? id,
            subtitle: describe(rule),
        });
        row.add_prefix(appIcon(info));

        const remove = new Gtk.Button({
            icon_name: 'user-trash-symbolic',
            tooltip_text: 'Remove Rule',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        row.add_suffix(remove);

        const enabled = new Adw.SwitchRow({title: 'Smooth scrolling', active: rule.enabled});
        const speed = this._speedRow();
        speed.value = rule.speed;
        const duration = this._durationRow();
        duration.value = rule.duration;

        const save = () => {
            rule.enabled = enabled.active;
            rule.speed = speed.value;
            rule.duration = Math.round(duration.value);
            speed.sensitive = duration.sensitive = rule.enabled;
            row.subtitle = describe(rule);
            const rules = readRules(settings);
            rules[id] = rule.enabled ? {...rule} : {enabled: false};
            settings.set_string('app-rules', JSON.stringify(rules));
        };
        speed.sensitive = duration.sensitive = rule.enabled;
        enabled.connect('notify::active', save);
        speed.connect('notify::value', save);
        duration.connect('notify::value', save);

        remove.connect('clicked', () => {
            const rules = readRules(settings);
            delete rules[id];
            settings.set_string('app-rules', JSON.stringify(rules));
            rebuild();
        });

        for (const child of [enabled, speed, duration])
            row.add_row(child);
        return row;
    }

    _pickApp(window, existing, onPick) {
        const dialog = new Adw.Dialog({
            title: 'Add App',
            content_width: 380,
            content_height: 520,
        });
        const search = new Gtk.SearchEntry({placeholder_text: 'Search apps'});
        const list = new Gtk.ListBox({
            selection_mode: Gtk.SelectionMode.NONE,
            css_classes: ['boxed-list'],
        });

        const pick = id => {
            dialog.close();
            onPick(id);
        };
        const entries = Gio.AppInfo.get_all()
            .filter(app => app.should_show() && app.get_id() && !existing.has(app.get_id()))
            .sort((a, b) => a.get_display_name().localeCompare(b.get_display_name()))
            .map(app => {
                const row = new Adw.ActionRow({title: app.get_display_name(), activatable: true});
                row.add_prefix(appIcon(app));
                row.connect('activated', () => pick(app.get_id()));
                list.append(row);
                return {row, id: app.get_id(),
                    haystack: `${app.get_display_name()} ${app.get_id()}`.toLowerCase()};
            });
        const matches = entry => entry.haystack.includes(search.text.toLowerCase());
        const byRow = new Map(entries.map(entry => [entry.row, entry]));
        list.set_filter_func(row => matches(byRow.get(row)));
        search.connect('search-changed', () => list.invalidate_filter());
        // Enter takes the first match.
        search.connect('activate', () => {
            const first = entries.find(matches);
            if (first)
                pick(first.id);
        });

        const view = new Adw.ToolbarView({
            content: new Gtk.ScrolledWindow({
                vexpand: true,
                hscrollbar_policy: Gtk.PolicyType.NEVER,
                child: new Adw.Clamp({
                    margin_top: 6,
                    margin_bottom: 12,
                    margin_start: 12,
                    margin_end: 12,
                    child: list,
                }),
            }),
        });
        view.add_top_bar(new Adw.HeaderBar({title_widget: search}));
        dialog.child = view;
        dialog.present(window);
    }
}
