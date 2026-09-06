# Development

Use a separate checkout outside the installed Omarchy plugin directory. Source development requires Node.js 22+, npm and Python 3.

```sh
npm ci
npm run build
npm start
```

`npm start -- --demo` starts the explicit sample-data preview with a separate control socket. It never joins a server or captures media. To preview in a browser, run `npm run preview` after building and open `http://127.0.0.1:4173/?preview`.

## Verification

```sh
npm ci                   # in a separate development checkout
npm test                 # protocol, state transitions, mix, companion identities, private socket
npm run test:install      # isolated installer, configuration preservation and repeat install
npm run test:e2e          # actual Electron GUI with explicitly labelled sample people
npm run test:auth-limit   # isolated rate limit, duplicate-submit guard, cooldown and session reuse
npm run test:auth         # isolated dummy account, real desktop keyring, process restart and forget
LIVEKIT_SERVER=/path/to/livekit-server npm run test:media
omarchy plugin validate "$PWD/plugin"
```

The media test starts a loopback LiveKit server, mocks only Echo's documented control endpoints, then connects two real clients with generated audio/video. The remote stream starts before the Linux client joins, with delayed audio startup to cover early subscription handling. It verifies received media, closed/suspended audio-context recovery without room rejoin, preserved deafen/gain and structured diagnostic output, speaking detection, `$screen` folding, amplified gain, microphone/fake-camera publishing, chat/history/deletion/files, soundboard playback/edit events, PG-13, Jam PCM/search/queue/stop/end, device controls and leave cleanup. Jam uses a protocol-v3 WebSocket fixture; it does not connect to Spotify. It does not test a production deployment, real microphone hardware, WAN/TURN traversal or the interactive desktop capture portal. Generated screenshots are in `artifacts/`.

Tested against upstream source commit `5425b5ba253e031d75bf5e84926e6a9b0f4a74a1`, LiveKit JS 2.22.2 and local LiveKit server 1.13.6. The upstream clone is reference-only.

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

Real chat/history/deletion/files, soundboard, webcams, device selectors, profiles/chimes, PG-13 state and Jam listener/controller features are implemented. Audio settings are in the call's Audio drawer; Profile expands inside it. Jam uses the existing Windows audio source; this Linux app does not host Spotify audio yet. Major remaining gaps: outgoing application/system share audio, Spotify authorization/library/playlists, RNNoise processing, safe room-switch rollback, administration/diagnostics and automatic app-only updates outside the plugin lifecycle. See the audit for narrower limitations and unverified integrations.

## Preparing a desktop release

Maintainers run `npm ci` and `npm run package:linux` on Linux x86-64. This produces `artifacts/releases/echo-chamber-linux-x64.tar.gz` and updates `plugin/runtime.json` with the release URL, size and SHA-256 digest. Test that exact artifact through `plugin/bootstrap.py` in an isolated home before publishing it. Publish the asset under the matching `v<version>` GitHub release **before** advancing `main` to the commit that pins it. Keep release assets immutable; use a new version for a replacement build.

## Product screenshots

Run `npm run screenshots` to capture the desktop UI from an isolated demo profile. Screenshot fixtures use nonpersonal handles and generated sample media. Keep the preview indicator visible. Never publish live-call captures, server credentials or participant photos. Asset provenance is recorded in [images/README.md](images/README.md).
