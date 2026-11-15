#!/usr/bin/env bash
# Installs smooth-scrolld, its systemd user unit, the udev rule it needs, and
# the GNOME Shell extension. Safe to re-run after pulling updates.
set -euo pipefail
cd "$(dirname "$0")"
UUID=smooth-scroll@knap43.github.io

if ! python3 -c 'import evdev' 2>/dev/null; then
    echo 'python-evdev is missing. Install it with:  sudo pacman -S python-evdev' >&2
    exit 1
fi

echo '→ Installing the service'
install -Dm755 daemon/smooth-scrolld ~/.local/bin/smooth-scrolld
install -Dm644 systemd/smooth-scroll.service ~/.config/systemd/user/smooth-scroll.service
systemctl --user daemon-reload

if ! cmp -s udev/70-smooth-scroll.rules /etc/udev/rules.d/70-smooth-scroll.rules; then
    echo '→ Granting input access (needs sudo)'
    sudo install -Dm644 udev/70-smooth-scroll.rules /etc/udev/rules.d/70-smooth-scroll.rules
    echo uinput | sudo tee /etc/modules-load.d/smooth-scroll.conf >/dev/null
    sudo modprobe uinput
    sudo udevadm control --reload
    sudo udevadm trigger --action=change --subsystem-match=input --subsystem-match=misc
    sudo udevadm settle
fi

echo '→ Installing the extension'
mkdir -p build
gnome-extensions pack extension --force --out-dir build
gnome-extensions install --force "build/$UUID.shell-extension.zip"

if systemctl --user is-active --quiet smooth-scroll; then
    systemctl --user restart smooth-scroll
fi

if gnome-extensions info "$UUID" >/dev/null 2>&1; then
    gnome-extensions enable "$UUID"
    echo 'Done. Toggle it from Quick Settings; tune it with:  gnome-extensions prefs' "$UUID"
else
    echo "Done. Log out and back in, then run:  gnome-extensions enable $UUID"
fi
