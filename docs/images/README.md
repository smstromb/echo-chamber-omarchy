# Documentation images

All product screenshots show the real application UI with synthetic fixtures. They contain no live calls, private servers, credentials or participant photographs.

| File | Source |
| --- | --- |
| [hero.png](hero.png) | Original illustration generated with the built-in image-generation tool, 2026-09-05. |
| [screens.png](screens.png) | Electron desktop demo, multiple shared screens and participant audio controls. |
| [voice.png](voice.png) | Electron desktop demo, voice-only call. |
| [toolbar.png](toolbar.png) | Actual Quickshell plugin popover rendered with an isolated sample-data socket. Appearance follows the active Omarchy theme. |

Run `npm run build && npm run screenshots` from the repository root to regenerate the desktop captures. The script uses a temporary profile and private socket, and retains the visible preview indicator. Sample media provenance is in [src/assets/README.md](../../src/assets/README.md).

The toolbar capture uses an independent Quickshell instance and a temporary plugin installation. Its status fixture contains three sample participants: Echo (self), Orbit (speaking and screen sharing, voice 100%, screen 35%), and Pixel (voice 70%). The popup card is saved directly through Qt's `Item.grabToImage`; no desktop background or running call is captured.

<details>
<summary>Hero generation prompt</summary>

Mode: built-in image generation. Output saved as `docs/images/hero.png`.

> Use case: illustration-story. Asset type: quirky but professionally art-directed GitHub README hero banner for an open-source Linux voice-chat and screen-sharing plugin called Echo Chamber. Create one very wide panoramic illustration, approximately 3:1 aspect ratio. A small impossible acoustic chamber formed from three rounded dark charcoal architectural arches: sound waves travel through it and curl back into the shape of a pair of headphones, with two tiny abstract speaker creatures perched on the arches chatting. Understated visual joke about an echo chamber. Crisp editorial illustration with a restrained screen-printed texture, fine warm ivory outlines, muted sage-green highlights and a little soft amber. Matte near-black forest-charcoal background matching a dark Linux desktop app. An elegant balanced centered composition with generous breathing room at both sides and no busy scenery. Charming, slightly odd, crafted, sophisticated rather than corporate or kawaii. No people, no actual faces, no application interface, no product screenshots, no logos, no badges. No text or lettering whatsoever; the project name will be ordinary Markdown below the illustration. The image should read clearly at 900 pixels wide and about 300 pixels tall.

</details>
