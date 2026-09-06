# Third-party software and media

This is an independent client for [Echo Chamber](https://github.com/SamWatson86/echo-chamber). The upstream repository is the protocol/functionality reference; its server and Windows client are not bundled here.

Runtime and build dependencies retain their own licenses, supplied in their npm packages:

- LiveKit JS client: Apache-2.0.
- Electron: MIT, with Chromium and other third-party notices in the downloaded runtime.
- Tabler Icons: MIT. The build copies the icon license to `dist/icons/LICENSE`.
- esbuild: MIT.
- Playwright (testing): Apache-2.0.
- Prettier (formatting): MIT.
- ws (testing): MIT.

The four images in `src/assets/` are generated sample media, used only in explicit preview/demo mode; see [their provenance](src/assets/README.md). README artwork and product-image provenance are documented in [docs/images/README.md](docs/images/README.md). No live call captures or participant photos are included.
