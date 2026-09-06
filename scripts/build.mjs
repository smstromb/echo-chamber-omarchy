import { build } from "esbuild";
import { mkdir, copyFile, cp, rm } from "node:fs/promises";
await mkdir("dist/icons", { recursive: true });
await build({
  entryPoints: ["src/ui.js"],
  bundle: true,
  format: "iife",
  outfile: "dist/ui.js",
});
for (const file of ["index.html", "style.css"])
  await copyFile(`src/${file}`, `dist/${file}`);
await rm("dist/assets", { recursive: true, force: true });
await cp("src/assets", "dist/assets", { recursive: true });
const icons = [
  "wave-sine",
  "search",
  "refresh",
  "paperclip",
  "trash",
  "download",
  "star",
  "pencil",
  "shield",
  "microphone",
  "microphone-off",
  "headphones",
  "headphones-off",
  "video",
  "video-off",
  "screen-share",
  "screen-share-off",
  "volume",
  "volume-off",
  "layout-grid",
  "focus-2",
  "maximize",
  "minimize",
  "adjustments-horizontal",
  "message-circle",
  "music",
  "phone-off",
  "chevron-down",
  "chevron-right",
  "x",
  "player-play",
  "player-pause",
  "player-skip-forward",
  "users",
  "settings",
  "dots",
  "plus",
  "arrow-up",
  "logout",
  "mood-smile",
  "check",
  "device-desktop",
  "ear",
  "eye",
  "eye-off",
];
for (const name of icons)
  await copyFile(
    `node_modules/@tabler/icons/icons/outline/${name}.svg`,
    `dist/icons/${name}.svg`,
  );

await copyFile("node_modules/@tabler/icons/LICENSE", "dist/icons/LICENSE");

await copyFile(
  "node_modules/@tabler/icons/icons/filled/star.svg",
  "dist/icons/star-filled.svg",
);
