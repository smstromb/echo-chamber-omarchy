# Using Echo Chamber

## Connect

Open **Echo Chamber** from the app launcher or right-click the toolbar icon. Enter the HTTPS server origin (for example `https://echo.example:9443`, without `/viewer/`), a display name and the room password. Sign-in opens the lobby. Select **Join Main** to enter voice; the microphone starts muted.

The plugin needs an existing Echo Chamber server. Connection details are entered locally and are not supplied by this repository.

## Toolbar and call controls

- **Left-click:** see online participants and join; while connected, see speaking activity, share indicators, mute and participant volume.
- **Right-click:** open the desktop app.
- **Voice and screen audio:** independent local mute and 0–300% volume. These controls affect playback, not server moderation.
- **Grid, focus and fullscreen:** available when cameras or screens are active. Voice-only calls use the participant view.
- **Close the window:** keep the call and toolbar running. **Ctrl+Q** quits and leaves voice.
- **Share screen:** select a window or monitor through the desktop portal. Outgoing system/application audio is not yet captured.

Audio devices and processing are in the **Audio** drawer; profile settings expand within it. Chat, soundboard and Jam use dedicated drawers. Jam listens to an existing compatible Windows audio source; Linux source hosting is not implemented.

## Password storage

**Remember password** encrypts the password through the desktop keyring and restores sign-in after an app restart. Saving is disabled when a secure keyring is unavailable. A window reload preserves session credentials without enabling password saving. Failed sign-in attempts preserve previously saved credentials. **Sign out and forget password** removes them.

The app selects GNOME libsecret on Linux and respects an explicit `--password-store` override. No password or bearer token is exposed to the toolbar; the private control socket has mode `0600`.

## Updates

```sh
omarchy plugin update local.echo-chamber
```

The toolbar prepares the pinned desktop release automatically. Quit and reopen the app when ready to switch builds. Existing calls and saved settings are preserved during setup. Builds live under `~/.local/share/echo-chamber/builds/`; after quitting, obsolete builds may be removed, keeping the one referenced by `~/.local/bin/echo-chamber`.

## Troubleshooting

| Problem                               | Check                                                                         |
| ------------------------------------- | ----------------------------------------------------------------------------- |
| Setup/download fails                  | Open the toolbar popover and select **Retry** after checking internet access. |
| Call is connected but silent          | Check Deafen and Output, then use **Audio → Restart audio**. Playback is rebuilt without rejoining. |
| Desktop app does not start            | Inspect `~/.local/share/echo-chamber/app.log`.                                |
| Password saving is unavailable        | Check that GNOME Keyring/Secret Service is running and unlocked.              |
| Screen capture picker does not appear | Check PipeWire and the Hyprland desktop portal.                               |
| No toolbar after install              | This plugin requires the Quickshell bar; legacy Waybar is unsupported.        |
| Server address is rejected            | Enter an HTTPS origin, without a path or embedded credentials.                |

### Diagnostic logs

Structured logs are written locally to `~/.config/Echo Chamber/logs/diagnostics.jsonl` (or `logs/` within a custom profile). The current file and one rotated backup are limited to 1 MiB each and readable only by the user. No logs are uploaded automatically.

They record application/runtime versions, call state transitions, process failures, sleep/resume, device counts and audio recovery results. During a call, a five-second health sample records audio-context state/clock, track and element counts, incoming byte/energy counters and jitter. These counters help distinguish missing incoming audio from a stopped playback pipeline; they do not record sound.

Only approved event names and scalar fields are retained. Credentials, server URLs, participant/device identifiers, chat and media content are excluded. The older `app.log` console output is separate and may contain server addresses or identifiers; review it before sharing.

**Restart audio** rebuilds received voice/screen playback while preserving the room, mic, video and mix settings. A watchdog also attempts recovery for stopped or stalled audio contexts, with a 30-second retry cooldown. Audio-service exit and system-resume events trigger recovery. This cannot diagnose every case of silence or guarantee recovery from network/device failures.

## Uninstall

Quit the app with **Ctrl+Q**, then run:

```sh
omarchy plugin remove local.echo-chamber
```

Remove the companion files: `~/.local/share/echo-chamber/`, `~/.local/bin/echo-chamber`, `~/.local/bin/echo-chamber-ctl`, `~/.local/share/applications/echo-chamber.desktop`, and `~/.config/autostart/echo-chamber.desktop`.

Connection and audio preferences remain in `~/.config/Echo Chamber/` unless a custom profile was configured. Remove that directory only to discard those settings. Removing the toolbar alone does not uninstall the companion app.

## Control CLI

```sh
echo-chamber-ctl status
echo-chamber-ctl watch
echo-chamber-ctl show
echo-chamber-ctl join main
echo-chamber-ctl mic
echo-chamber-ctl mute PARTICIPANT_ID
echo-chamber-ctl volume PARTICIPANT_ID 40
echo-chamber-ctl leave
echo-chamber-ctl quit
```
