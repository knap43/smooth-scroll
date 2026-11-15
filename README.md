# Smooth Scroll

Smooth, eased mouse-wheel scrolling for GNOME on Wayland, in every app:
GTK 3 and 4, libadwaita, Qt, Firefox, Chromium, and GNOME Shell itself.

Each wheel click glides over a few hundred milliseconds instead of jumping a
fixed distance. Quick successive clicks build on one another, and reversing
direction stops the glide at once.

## How it works

Under Wayland, mutter hands wheel events to apps before any Shell extension can
see them, so an extension alone can't smooth app scrolling. The work is
therefore split in two:

- **`smooth-scrolld`** is a small Python service. It takes over each mouse and
  re-emits all of its input through a virtual twin unchanged, except the wheel.
  Each wheel click is replayed as a stream of high-resolution scroll steps
  (`REL_WHEEL_HI_RES`) with an exponential ease-out.
- **The GNOME extension** adds a *Smooth Scroll* toggle to Quick Settings and
  a preferences window. It starts and stops the service and passes your
  settings to it.

Touchpads are left alone, since they already scroll smoothly.

## Install

```fish
sudo pacman -S python-evdev
git clone https://github.com/knap43/smooth-scroll.git
cd smooth-scroll
./install.sh
```

`install.sh` asks for sudo once, to install a udev rule
(`/etc/udev/rules.d/70-smooth-scroll.rules`). The rule lets the user at the
active seat read mice and create virtual input devices through `/dev/uinput`.
That is what allows the service to run without root. Note that any program you
run can then inject input events.

If this is the first install, log out and back in so GNOME Shell discovers the
extension, then run:

```fish
gnome-extensions enable smooth-scroll@knap43.github.io
```

## Settings

Open them with `gnome-extensions prefs smooth-scroll@knap43.github.io`.

| Setting              | Default | Meaning                                    |
| -------------------- | ------- | ------------------------------------------ |
| Distance             | 1.00    | Multiplier for how far one click scrolls   |
| Glide duration       | 250 ms  | Time for a click's glide to settle         |
| Horizontal scrolling | on      | Also smooth tilt wheels and side wheels    |

### App rules

Under **App Rules** in the preferences, add any installed app with the **+**
button. Each rule either turns smoothing off for that app or gives it its own
Distance and Glide duration. A rule applies to the app whose window is under
the pointer when you scroll. Apps without a rule, and the Shell's own UI, use
the global settings.

The extension tracks the window under the pointer and passes the matching
rule to the service over a private socket,
`$XDG_RUNTIME_DIR/smooth-scroll.sock`. App rules therefore need the extension;
the service alone always uses the global settings.

### Without the extension

The service also runs on its own. Write
`~/.config/smooth-scroll/config.json`:

```json
{ "speed": 1.0, "duration": 250, "horizontal": true }
```

Then start it with `systemctl --user enable --now smooth-scroll`. After
editing the file, apply the changes with `systemctl --user reload smooth-scroll`.

## Troubleshooting

```fish
journalctl --user -u smooth-scroll -f
```

The log names every mouse the service takes over. If the service stops, the
grab is released and the mouse works normally again.

## Uninstall

```fish
./uninstall.sh
```

## Licence

GPL-2.0-or-later
