# Echo Chamber Linux client

- Use plain, functional UI language. No slogans, marketing copy, lifestyle language, or decorative descriptions of rooms. Label states and actions directly.
- Prioritize Main, its participants and direct call controls; keep other rooms available under the header room dropdown. Feature parity does not require copying upstream's navigation or visual hierarchy.
- Target functional parity with the active upstream Echo Chamber client while maintaining an independent UI. Distinguish missing implementation, partial implementation, unverified behavior, and confirmed OS limitations.
- Use current `core/viewer`, `core/control`, and active `core/client` source as evidence. Do not revive upstream archived capture experiments.
- Preserve active calls and signed-in sessions when updating the desktop integration. Quickshell plugin changes can hot-reload; renderer/app restarts interrupt media.
- Cover connection/state race fixes with regression tests. Test media with isolated profiles and private sockets; never replace the user's live control socket during tests.

- Use an adaptive main area (voice → cameras → screens), compact right people list, persistent bottom call controls. Prefer icons, hierarchy and tooltips to visible descriptions. No screen-oriented empty state when no screens exist.
- Browser design preview is explicit `?preview`; all participants/media/interactions in that mode are simulated and must never be represented as server-integrated. The desktop client has real chat, soundboard, webcam and Jam integrations; keep its verification separate from preview checks.

- Public documentation and fixtures use neutral sample handles, never personal names, live-call captures or development-machine details. Keep the README concise; place reference material under `docs/`.
