# Echo Chamber for Omarchy

An independent desktop client and Omarchy toolbar plugin for [Echo Chamber](https://github.com/SamWatson86/echo-chamber). Distributed directly through this GitHub repository. You need access to an existing Echo Chamber server; this repository does not host a server or contain connection credentials.

## Use

Open **Echo Chamber** from the app launcher. Enter the HTTPS server **origin** (for example `https://echo.example:9443`, without `/viewer/`), your display name, and the shared room password. Sign-in enters the lobby; it does not join voice. Joining starts with your microphone muted.

- **Bar left-click:** preview everyone online and join their room; while joined, see your room's participants, speaking highlights, screen-sharing badges, local mute and 0–300% output volume.
- **Bar right-click:** open/focus the full app.
- **Available friends:** the headphones icon changes to a people icon and uses the theme accent while you are outside voice and someone is online.
- **Close window:** keep the connection and bar running. **Ctrl+Q** or the application menu quits and leaves voice.
- **Screen share:** choose a source through the Wayland/PipeWire portal. Outgoing system audio is not captured. Incoming screen video and audio are supported.
- **Mute/volume:** only your playback changes; nobody else is muted on the server. Voice and screen audio have separate settings.

**Remember password** encrypts the password using Omarchy's desktop keyring and restores sign-in after quitting/reopening the app. The app explicitly selects GNOME libsecret on Linux because Electron does not automatically recognize Hyprland; an explicit `--password-store` override is respected. If the keyring is unavailable, saving is disabled and the password stays in memory until exit. Reloading the window preserves a session without enabling password saving. Failed sign-ins preserve previously saved credentials; **Sign out and forget password** removes them. No password or bearer token is exposed to the bar. The control socket lives in `$XDG_RUNTIME_DIR/echo-chamber.sock` with mode `0600`.

## Install on Omarchy

Requires **Omarchy with the Quickshell bar** on Linux x86-64. Legacy Waybar installations are not supported. The desktop app and Electron runtime are bundled; Node.js and npm are not needed to install or use it.

```sh
omarchy plugin add https://github.com/smstromb/echo-chamber-omarchy.git --enable
```

Enabling the toolbar automatically downloads the desktop app from this repository's pinned GitHub release, checks its SHA-256 digest, and installs it for your user. The toolbar shows download/setup progress. Once ready, right-click its icon to open **Echo Chamber**, enter your server details, and join **Main**. No GitHub account or sudo is needed. Request the server address and password from its host.

If a download fails, open the toolbar popover and click **Retry**. Normal Omarchy services provide PipeWire screen capture and GNOME Keyring password storage.

The app is installed under `~/.local/share/echo-chamber/builds/`, with a launcher, desktop entry and login autostart. The plugin checkout stays free of runtime dependencies so Omarchy can validate and update it normally. Setup does not restart existing calls.

### Update

```sh
omarchy plugin update local.echo-chamber
```

When the updated plugin loads, it prepares the matching desktop release automatically. Quit Echo Chamber with **Ctrl+Q** and reopen it when ready to switch builds; an active call is left running. Saved credentials and audio settings are preserved. Older builds remain available to running processes; after quitting the app, obsolete folders under `~/.local/share/echo-chamber/builds/` can be removed, keeping the build referenced by `~/.local/bin/echo-chamber`.

### Existing source checkout / development

Source development still requires Node.js 22+, npm and Python 3. If you installed from a separate development checkout, update and build there:

```sh
git pull --ff-only
./install.sh
```

For development, run `npm ci`, `npm run build`, then `npm start`. `npm run install:desktop` points the launcher directly at the development checkout. Use `npm start -- --demo` for sample data with a separate control socket and no server connection. Do not run `npm ci` inside the git-managed Omarchy plugin folder; use a separate development clone. `install.sh` remains an optional source-build installer, not part of the normal plugin installation.

## Verification

```sh
npm ci                   # in a separate development checkout
npm test                 # protocol, state transitions, mix, companion identities, private socket
npm run test:install      # isolated installer, configuration preservation and repeat install
npm run test:e2e          # actual Electron GUI with explicitly labelled sample people
npm run test:auth         # isolated dummy account, real desktop keyring, process restart and forget
LIVEKIT_SERVER=/path/to/livekit-server npm run test:media
omarchy plugin validate "$PWD/plugin"
```

The media test starts a loopback LiveKit server, mocks only Echo's documented control endpoints, then connects two real clients with generated audio/video. The remote stream starts before the Linux client joins, with delayed audio startup to cover early subscription handling. It verifies received media, speaking detection, `$screen` folding, amplified gain, microphone/fake-camera publishing, chat/history/deletion/files, soundboard playback/edit events, PG-13, Jam PCM/search/queue/stop/end, device controls and leave cleanup. Jam uses a protocol-v3 WebSocket fixture; it does not connect to Spotify. It does not test your friend's deployment, real microphone hardware, WAN/TURN traversal or the interactive desktop capture portal. Generated screenshots are in `artifacts/`.

Tested against upstream source commit `5425b5ba253e031d75bf5e84926e6a9b0f4a74a1`, LiveKit JS 2.22.2 and local LiveKit server 1.13.6. The upstream clone is reference-only.

## Feature completeness

The target is full supported Echo Chamber functionality with an independent Linux UI. The current implementation is partial. See [the feature parity audit](docs/FEATURE-PARITY.md) for the complete capability inventory, OS constraints, source references and implementation order.

## Protocol and boundaries

| Feature           | Existing server/client contract                                                |
| ----------------- | ------------------------------------------------------------------------------ |
| Pre-join presence | Public `GET /api/online` → `[{name, room}]`, every 10 seconds                  |
| Password sign-in  | `POST /v1/auth/login` → bearer token                                           |
| Join/renew        | `POST /v1/auth/token` with room, identity, name, persistent participantAuthKey |
| Presence          | Authenticated heartbeat every 5 seconds, explicit leave                        |
| Media             | LiveKit on the same origin with `https` changed to `wss`                       |
| Speaker activity  | LiveKit participant `isSpeaking` and audio level                               |
| Screen indicator  | LiveKit publications including `$screen` companions, folded into their owner   |

Token refresh, heartbeat and leave are serialized to prevent late heartbeats from resurrecting departed participants. Media reconnect uses LiveKit's reconnect flow; a final disconnect returns to the lobby and needs a deliberate rejoin. Failed presence polls clear the roster and show an error rather than claiming an empty server is healthy.

Real chat/history/deletion/files, soundboard, webcams, device selectors, profiles/chimes, PG-13 state and Jam listener/controller features are implemented. Audio settings are in the call's Audio drawer; Profile expands inside it. Jam uses the existing Windows audio source; this Linux app does not host Spotify audio yet. Major remaining gaps: outgoing application/system share audio, Spotify authorization/library/playlists, RNNoise processing, safe room-switch rollback, administration/diagnostics and Linux updates. See the audit for narrower limitations and unverified integrations.

## CLI

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

## Uninstall

Quit Echo Chamber with **Ctrl+Q**, then run `omarchy plugin remove local.echo-chamber`. Remove the companion files `~/.local/share/echo-chamber/`, `~/.local/bin/echo-chamber`, `~/.local/bin/echo-chamber-ctl`, `~/.local/share/applications/echo-chamber.desktop` and `~/.config/autostart/echo-chamber.desktop`.

Your saved connection and audio settings remain in `~/.config/Echo Chamber/` unless you used a custom profile path. Delete that directory only if you also want to forget those settings. Removing the plugin alone does not uninstall the companion app.

## Adaptive interface and preview

Run `npm run build` then `npm run preview`; open `http://127.0.0.1:4173/?preview`. The preview starts with six sample participants. Voice, Cameras and Screens select populated scenarios; Jam toggles a simulated session. The preview never joins the real server or captures a microphone/camera.

The desktop renderer now adapts between voice participants, incoming cameras and shared screens, with grid/focus/fullscreen controls and a compact right roster. Voice and screen gain are independent (0–300%), including the toolbar. Hiding remote video pauses its reception; audio remains independent. Hiding your own preview does not stop publishing.

Jam, chat, outgoing cameras and soundboard remain simulations in the explicit preview. In the desktop app these controls now use the real services. Fullscreen in Electron requires the updated main process; browser fullscreen may be blocked by browser policy. See [call experience](docs/CALL-EXPERIENCE.md) for the intended design.

## License

[MIT](LICENSE). See [third-party notices](THIRD-PARTY.md).

## Preparing a desktop release

Maintainers run `npm ci` and `npm run package:linux` on Linux x86-64. This produces `artifacts/releases/echo-chamber-linux-x64.tar.gz` and updates `plugin/runtime.json` with the release URL, size and SHA-256 digest. Test that exact artifact through `plugin/bootstrap.py` in an isolated home before publishing it. Publish the asset under the matching `v<version>` GitHub release **before** advancing `main` to the commit that pins it. Keep release assets immutable; use a new version for a replacement build.
