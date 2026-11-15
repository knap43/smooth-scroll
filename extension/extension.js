// SPDX-License-Identifier: GPL-2.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {QuickToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';

const UNIT = 'smooth-scroll.service';
const CONFIG_DIR = GLib.build_filenamev([GLib.get_user_config_dir(), 'smooth-scroll']);
const CONFIG_FILE = GLib.build_filenamev([CONFIG_DIR, 'config.json']);
const WRITE_DELAY_MS = 300;

const SmoothScrollToggle = GObject.registerClass(
class SmoothScrollToggle extends QuickToggle {
    constructor(settings) {
        super({
            title: 'Smooth Scroll',
            iconName: 'input-mouse-symbolic',
            toggleMode: true,
        });
        settings.bind('enabled', this, 'checked', Gio.SettingsBindFlags.DEFAULT);
    }
});

export default class SmoothScrollExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._writeId = 0;

        this._indicator = new SystemIndicator();
        this._indicator.quickSettingsItems.push(new SmoothScrollToggle(this._settings));
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);

        this._settingsId = this._settings.connect('changed', (_s, key) => {
            if (key === 'enabled')
                this._applyEnabled();
            else
                this._scheduleWrite();
        });

        this._writeConfig();
        this._applyEnabled();
    }

    disable() {
        if (this._writeId) {
            GLib.source_remove(this._writeId);
            this._writeId = 0;
        }
        this._settings.disconnect(this._settingsId);
        // Without the extension, wheel clicks go back to being plain clicks.
        this._systemd('StopUnit');
        this._indicator.quickSettingsItems.forEach(item => item.destroy());
        this._indicator.destroy();
        this._indicator = null;
        this._settings = null;
    }

    _applyEnabled() {
        this._systemd(this._settings.get_boolean('enabled') ? 'StartUnit' : 'StopUnit');
    }

    _scheduleWrite() {
        // Spin buttons fire a burst of changes; settle before touching the service.
        if (this._writeId)
            GLib.source_remove(this._writeId);
        this._writeId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, WRITE_DELAY_MS, () => {
            this._writeId = 0;
            this._writeConfig();
            if (this._settings.get_boolean('enabled'))
                this._systemd('ReloadUnit');
            return GLib.SOURCE_REMOVE;
        });
    }

    _writeConfig() {
        const config = {
            speed: this._settings.get_double('speed'),
            duration: this._settings.get_int('duration'),
            horizontal: this._settings.get_boolean('horizontal'),
        };
        try {
            GLib.mkdir_with_parents(CONFIG_DIR, 0o755);
            GLib.file_set_contents(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`);
        } catch (e) {
            console.error(`smooth-scroll: cannot write ${CONFIG_FILE}: ${e.message}`);
        }
    }

    _systemd(method) {
        Gio.DBus.session.call(
            'org.freedesktop.systemd1',
            '/org/freedesktop/systemd1',
            'org.freedesktop.systemd1.Manager',
            method,
            new GLib.Variant('(ss)', [UNIT, 'replace']),
            null, Gio.DBusCallFlags.NONE, -1, null,
            (conn, res) => {
                try {
                    conn.call_finish(res);
                } catch (e) {
                    if (method === 'StartUnit') {
                        Main.notifyError('Smooth Scroll could not start',
                            `${e.message}\nRun install.sh from the smooth-scroll repository.`);
                    } else {
                        console.warn(`smooth-scroll: ${method} failed: ${e.message}`);
                    }
                }
            });
    }
}
