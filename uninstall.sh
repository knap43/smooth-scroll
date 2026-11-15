#!/usr/bin/env bash
set -euo pipefail
UUID=smooth-scroll@knap43.github.io

gnome-extensions uninstall "$UUID" 2>/dev/null || true
systemctl --user disable --now smooth-scroll 2>/dev/null || true
rm -f ~/.local/bin/smooth-scrolld ~/.config/systemd/user/smooth-scroll.service
systemctl --user daemon-reload
rm -rf "${XDG_CONFIG_HOME:-$HOME/.config}/smooth-scroll"

if [[ -e /etc/udev/rules.d/70-smooth-scroll.rules ]]; then
    sudo rm -f /etc/udev/rules.d/70-smooth-scroll.rules /etc/modules-load.d/smooth-scroll.conf
    sudo udevadm control --reload
    sudo udevadm trigger --action=change --subsystem-match=input --subsystem-match=misc
fi
echo 'Smooth Scroll removed.'
