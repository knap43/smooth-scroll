// SPDX-License-Identifier: GPL-2.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {QuickToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';

const UNIT = 'smooth-scroll.service';
const CONFIG_DIR = GLib.build_filenamev([GLib.get_user_config_dir(), 'smooth-scroll']);
const CONFIG_FILE = GLib.build_filenamev([CONFIG_DIR, 'config.json']);
// smooth-scrolld connects here to learn the rule for the app under the pointer.
const SOCKET_PATH = GLib.build_filenamev([GLib.get_user_runtime_dir(), 'smooth-scroll.sock']);
const WRITE_DELAY_MS = 300;
const POINTER_POLL_MS = 40;

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
        this._pointerId = 0;
        this._app = undefined;
        this._message = '{}\n';
        this._clients = new Set();
        this._loadRules();

        this._indicator = new SystemIndicator();
        this._indicator.quickSettingsItems.push(new SmoothScrollToggle(this._settings));
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);

        this._settingsId = this._settings.connect('changed', (_s, key) => {
            if (key === 'enabled') {
                this._applyEnabled();
            } else if (key === 'app-rules') {
                this._loadRules();
                this._updateApp(true);
            } else {
                this._scheduleWrite();
            }
        });

        this._startSocket();
        this._watchPointer();
        this._writeConfig();
        this._applyEnabled();
    }

    disable() {
        for (const id of [this._writeId, this._pointerId]) {
            if (id)
                GLib.source_remove(id);
        }
        this._writeId = this._pointerId = 0;
        for (const [object, id] of this._signals)
            object.disconnect(id);
        this._signals = null;
        this._settings.disconnect(this._settingsId);
        // Without the extension, wheel clicks go back to being plain clicks.
        this._systemd('StopUnit');
        this._stopSocket();
        this._indicator.quickSettingsItems.forEach(item => item.destroy());
        this._indicator.destroy();
        this._indicator = null;
        this._settings = null;
    }

    _applyEnabled() {
        this._systemd(this._settings.get_boolean('enabled') ? 'StartUnit' : 'StopUnit');
    }

    // ── Per-app rules ──────────────────────────────────────────────────────

    _loadRules() {
        try {
            const rules = JSON.parse(this._settings.get_string('app-rules'));
            this._rules = rules && typeof rules === 'object' ? rules : {};
        } catch {
            this._rules = {};
        }
    }

    _watchPointer() {
        const queue = () => this._queueAppUpdate();
        const tracker = global.backend.get_cursor_tracker();
        this._signals = [
            [tracker, tracker.connect('position-invalidated', queue)],
            [global.display, global.display.connect('restacked', queue)],
            [global.workspace_manager,
                global.workspace_manager.connect('active-workspace-changed', queue)],
            [Main.overview, Main.overview.connect('showing', queue)],
            [Main.overview, Main.overview.connect('hidden', queue)],
        ];
        this._updateApp(true);
    }

    _queueAppUpdate() {
        // The pointer moves far more often than it changes windows: sample it.
        if (this._pointerId)
            return;
        this._pointerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, POINTER_POLL_MS, () => {
            this._pointerId = 0;
            this._updateApp(false);
            return GLib.SOURCE_REMOVE;
        });
    }

    _appUnderPointer() {
        if (Main.overview.visible)
            return null;
        const [x, y] = global.get_pointer();
        const workspace = global.workspace_manager.get_active_workspace();
        const actors = global.get_window_actors();
        for (let i = actors.length - 1; i >= 0; i--) {
            const win = actors[i].meta_window;
            if (!win || !actors[i].visible || win.minimized || win.is_hidden() ||
                !win.located_on_workspace(workspace))
                continue;
            const rect = win.get_frame_rect();
            if (x >= rect.x && x < rect.x + rect.width &&
                y >= rect.y && y < rect.y + rect.height)
                return Shell.WindowTracker.get_default().get_window_app(win)?.get_id() ?? null;
        }
        return null;
    }

    _updateApp(force) {
        const app = this._appUnderPointer();
        if (!force && app === this._app)
            return;
        this._app = app;
        const rule = app ? this._rules[app] : null;
        let message = {};
        if (rule && rule.enabled === false)
            message = {app, enabled: false};
        else if (rule)
            message = {app, enabled: true, speed: rule.speed, duration: rule.duration};
        this._message = `${JSON.stringify(message)}\n`;
        for (const client of this._clients)
            this._send(client);
    }

    // ── Socket to smooth-scrolld ───────────────────────────────────────────

    _startSocket() {
        this._removeSocketFile();
        this._service = new Gio.SocketService();
        try {
            this._service.add_address(Gio.UnixSocketAddress.new(SOCKET_PATH),
                Gio.SocketType.STREAM, Gio.SocketProtocol.DEFAULT, null);
        } catch (e) {
            console.error(`smooth-scroll: cannot listen on ${SOCKET_PATH}: ${e.message}`);
        }
        this._service.connect('incoming', (_service, connection) => {
            // Never block the Shell on a slow reader: a client that cannot
            // keep up is dropped and simply reconnects.
            connection.get_socket().set_blocking(false);
            this._clients.add(connection);
            this._send(connection);
            return true;
        });
        this._service.start();
    }

    _stopSocket() {
        this._service.stop();
        this._service.close();
        this._service = null;
        for (const client of this._clients)
            client.close(null);
        this._clients.clear();
        this._removeSocketFile();
    }

    _removeSocketFile() {
        try {
            Gio.File.new_for_path(SOCKET_PATH).delete(null);
        } catch {
            // Not there: nothing to clean up.
        }
    }

    _send(client) {
        const bytes = new TextEncoder().encode(this._message);
        try {
            if (client.get_socket().send(bytes, null) === bytes.length)
                return;
        } catch {
            // Disconnected, or its buffer is full.
        }
        this._clients.delete(client);
        client.close(null);
    }

    // ── Global settings and the systemd unit ───────────────────────────────

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
