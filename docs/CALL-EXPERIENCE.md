# Echo Chamber call experience

Design proposal, 2026-09-05. This defines target behavior, not current implementation. Pair with [the implementation audit](FEATURE-PARITY.md).

## Product structure

Design for a small group spending time in Main. Opening the app should reveal the people and ongoing activity. A permanent room-navigation column is unnecessary: put Main and the secondary room switcher in the header. Keep account, connection, appearance and administrative settings in a menu.

Three stable areas:

- **Call stage:** the actual content—people when voice-only, cameras when video is active, selected screen shares when watching. Its layout responds to the activity rather than accumulating sections down a page.
- **People and tools:** a compact participant list plus one optional, resizable drawer for Chat, Audio, Jam or Soundboard. Tools must not replace the call or cover its controls. On smaller windows the people list becomes a button with a count.
- **Call controls:** persistent microphone, deafen, camera, share and leave controls. Input/output/camera selectors open from adjacent chevrons. Show the local identity and exact media state. The user can stop sharing or mute immediately in every layout.

Use neutral dark surfaces, restrained green for connected/speaking/selected states, readable 14–16px body labels and concise action names. Reserve red for destructive actions or actual failures. No slogans, decorative empty panels, oversized identity cards or server-management furniture.

## Viewing model

Keep people and media sources distinct. Sam is one person, even if Sam publishes a webcam and a screen. Both tiles identify their owner and source. Audio belongs to the source, not whichever tile happens to be focused.

| Situation | Default presentation | Available transition |
|---|---|---|
| Signed in, outside voice | Main occupancy, names, share/camera indicators where the public protocol exposes them, Join Main; local mic/device preparation | Join with mic muted and camera off. No live media preview implied by the public roster. |
| Connected, voice only | Compact participant grid with names, mute state and subtle speaking indication | Open Chat, Audio, Jam or Soundboard without navigating away |
| Cameras active | Camera grid, with voice-only people kept in the roster | Pin a camera, hide local preview, focus/fullscreen |
| A screen becomes available | Named source with Watch; avoid starting unfamiliar stream audio automatically | Watch that source or add it to the current grid |
| Watching one screen | Large aspect-correct screen and compact camera/people strip | Grid, switch source, fullscreen, stop watching |
| Watching several screens | Balanced grid of selected screens with consistent source headers; camera strip separate | Focus any source; return to the same grid selection |
| Focus | One large source plus a filmstrip of other watched sources | Select another source; hide filmstrip; return to grid |
| Fullscreen | Current focused source or entire grid, depending on entry point | Escape restores previous layout, panels and focus; controls appear on pointer movement or keyboard focus |
| Source ends/reconnects | Tile states Source ended / Reconnecting; preserve stable tile identity during recovery | If focused source ends, return to remaining grid; never leave a black fullscreen trap |

Grid, focus and fullscreen are view choices. They do not change volume, mute people, join/leave Jam, or start/stop publishing. A new speaker does not steal a pinned focus. New streams appear as available sources rather than reshuffling watched tiles. Preserve source order, selection, mix and keyboard focus through routine roster/activity updates.

Screens preserve their full aspect ratio with letterboxing; never crop shared text or game HUDs to fill a card. Webcam thumbnails may crop with a fit option. Offer 1, 2, 4 and 6 visible sources at practical desktop sizes; when more are selected use explicit paging with a count, not unreadably tiny tiles. Hidden-page videos may reduce quality while their chosen audio continues; expose that behavior. Resource failures must not silently unsubscribe or mute a user's chosen source.

## Audio model

Quick controls sit where the sound originates; the Audio drawer offers the whole mix. These operate on shared state so the GUI and toolbar never disagree.

| Control | Meaning |
|---|---|
| Microphone | Whether others hear my voice; independent of camera and share publishing |
| Deafen | Mute all received Echo audio: voice, streams, Jam, sounds and chimes. Also mute my microphone while deafened and restore its prior intent on undeafen; make this behavior visible. |
| Person → Voice | Local mute and 0–300% gain for that person's microphone |
| Source → Stream audio | Local mute and 0–300% gain for this screen's audio; never mute the owner's voice implicitly |
| Person → Mute all from Sam | Explicit optional shortcut affecting Sam's voice and streams; clearly separate from moderator actions |
| Jam volume | My listening gain; does not change the shared playback volume or other listeners |
| Soundboard / event sounds | Separate local gains; independent from voice and Jam |
| Output device | Destination for every received audio bus, including future soundboard/Jam integration |

Opening a participant's audio control shows two labeled rows when a screen exists: Voice and Screen. Numeric percentages remain visible; a speaker icon indicates local mute. Speaking indicators represent microphone activity, not stream/game audio. Muting retains the gain so unmute restores it. New screen audio starts muted with an explicit Enable audio action; the user's subsequent choice persists for that source during the session. Focusing or hiding a thumbnail does not alter that choice. Stop watching unsubscribes that screen's audio and video, leaving the person's voice unchanged.

Support an explicit Solo stream audio action only as a reversible local mix operation: preserve and restore other streams' prior mute states, never silence voice or Jam without saying so. Do not make focus secretly act as solo.

## Publishing and devices

Camera: preview and choose a device before first publishing; persistent Camera on state; turning off or hiding one's preview are separate actions. Subsequent enabling uses the selected device. Permission denial is recoverable from the same control.

Share: choose a monitor/window through the OS picker, then confirm available audio capture and quality settings. The app must accurately reflect when a portal starts capture; do not claim a preview is private if publishing has started. Show the active source and a persistent Stop sharing control. Cancel returns to the call without changing existing streams. Switching source must make any capture gap visible. Audio options unavailable on the Linux build show a concise reason instead of appearing to work.

Device menus support changing microphone, output and camera during a call. Hot-unplug shows the lost device and fallback; do not silently turn an intentionally muted microphone on. A settings drawer contains input meters, test playback, noise processing and persistent device preferences without forcing the user to leave Main.

## Jam is part of the call

Use one compact now-playing strip when a Jam is active: track/artist, source owner, listener state, local volume and Open Jam. The drawer contains queue and track search/library; it does not take the media stage away. Starting a stream should not discard Jam state. Audio ducking, if added, is an explicit preference, not an unannounced volume change.

| Jam state | User-facing behavior |
|---|---|
| No Jam | Start Jam in the Jam drawer; source readiness shown before attempting to start |
| Available, not listening | Track/source summary and Join Jam; continuing voice does not require listening |
| Listening | Leave Jam and My volume. Keep the queue readable; expose shared queue actions allowed by the server. |
| Controlling shared playback | Distinct Skip and Stop music controls with shared-effect labels where needed |
| Music stopped | Queue and membership remain; Resume music is distinct from starting a new Jam |
| End Jam | Separate menu action, labeled Ends Jam for everyone; confirm because it clears the shared session/queue |
| Source offline | Explain the source interruption, preserve queue and provide reconnect/source selection when supported |

Distinguish starting/controlling a Jam from supplying its audio. Source selection can use the friend's available Windows PC. Listening and queue participation on Linux do not require a local Spotify audio source. “Use this computer as source” has an explicit readiness state and stays unavailable until Linux capture/routing exists. Do not invent local source support to complete a mockup. Expose takeover and local monitoring controls only to the source computer where meaningful. Leaving Main releases Jam listening/source responsibilities according to the protocol; closing the app window preserves the call.

## Other functions have intentional homes

Chat uses a drawer with history, unread marker, composer, attachments and clipboard images. Opening chat should resize the stage; opening an attachment returns to the same message/scroll position. Soundboard uses a searchable drawer with favorites and volume; library editing is secondary. Participant details own avatars, enter/exit sounds and per-person chime gain. Settings owns appearance, diagnostics, updates and devices. Moderator actions are permission-dependent, clearly labeled as server actions and separated from local mute.

## Toolbar companion

The bar is a quick-call surface, not a second full media application. Icon state distinguishes offline/unreachable, signed in and alone, people available, joining, joined, and deafened. A separate badge can indicate mic mute without concealing connection state; tooltip text explains the state without relying on color alone.

Before joining: Main occupancy and names, freshness/unreachable feedback, Join Main. After joining: stable participant rows, speaking indicator, camera/share badges, one-click local voice mute and an expansion for Voice/Screen gain. Sharing badge opens that person's source in the GUI. Footer provides microphone, deafen, leave and Open app. A compact Jam row offers join/leave and local volume if active; queue and hosting configuration open the GUI. Right-click keeps its requested behavior: open the GUI. Do not put context actions behind that same gesture.

## Required design/prototype scenarios

1. Main empty, two people online before join, stale/unreachable roster, authentication expired.
2. Six people in voice, two speaking, one self-muted, one locally muted; no video.
3. Six people, three screen shares and three cameras; grid and focus on each source.
4. Fullscreen grid and focused fullscreen; Escape returns to exact prior state.
5. Same person has voice, webcam and screen; muting screen leaves their voice audible.
6. Audio drawer changes voice, screen, Jam and soundboard independently; deafen and restoration.
7. Watch/stop watching, late stream arrival, focused source stops, reconnect and renamed participants.
8. Jam available, listening, queue control, source selection, source offline, Stop music versus End Jam.
9. Own camera preview, share picker cancelled, active sharing, source switch, unavailable share audio.
10. Chat or soundboard open while several streams remain visible; new unread messages while closed.
11. Compact window, 1440×1024 and ultrawide; keyboard-only controls, reduced motion, 200% zoom.
12. Toolbar and GUI agree on every local mix, microphone, connection and Jam transition.

Prototype all scenarios with clearly labeled sample data and simulated media before replacing the installed UI. Then wire the selected design to real protocol capabilities in the audit's dependency order. Visual mocks alone cannot validate focus management, media lifecycle, audio behavior or accessibility.

## References and limits

- [Discord video calls](https://support.discord.com/hc/en-us/articles/360041721052-Video-Calls): grid/focus, filmstrip, fullscreen/pop-out, simultaneous webcam and screen, in-call device controls. These inform familiar viewing patterns, not a requirement to copy Discord navigation.
- [Discord multistream](https://support.discord.com/hc/en-us/articles/360045784891-Video-Screenshare-Updates-Multistream-and-More): selecting multiple streams and reducing non-video clutter.
- Active upstream `core/viewer/index.html`, `jam.js`, `participants.js`, `participants-grid.js`, and the pinned references in the parity audit establish protocol capabilities. Repository screenshots dated February 2026 were inspected as historical visual context only; they are not proof of today's running Windows UI.
- The current Linux connected-state screenshot shows the existing room sidebar, large participant cards and scattered bottom controls. It has no populated multi-stream/Jam experience to validate. Proposed frames are mockups, not screenshots of implemented features.
