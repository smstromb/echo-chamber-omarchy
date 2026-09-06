import { test } from "node:test";
import assert from "node:assert/strict";
import { people, volume, iconState } from "../src/model.js";
test("native screen companions map to their owner without duplicate people", () => {
  const rows = people(
    [
      {
        identity: "sam",
        name: "Sam",
        isSpeaking: true,
        isMicrophoneEnabled: true,
      },
      { identity: "sam$screen", isScreenShareEnabled: true },
      {
        identity: "sam$native-presenter",
        videoTrackPublications: new Map([
          ["v", { source: "camera", isMuted: false }],
        ]),
      },
    ],
    { sam: { volume: 34, muted: true } },
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sharing, true);
  assert.equal(rows[0].speaking, true);
  assert.equal(rows[0].volume, 34);
  assert.equal(rows[0].muted, true);
});
test("icon distinguishes available friends, joined, empty and unreachable", () => {
  assert.equal(
    iconState({ status: "idle", online: [{ name: "Sam" }] }),
    "people-online",
  );
  assert.equal(iconState({ status: "joined", online: [] }), "joined");
  assert.equal(iconState({ status: "idle", online: [] }), "idle");
  assert.equal(
    iconState({ status: "idle", online: [{}], onlineError: "offline" }),
    "unavailable",
  );
});
test("volume is bounded and rejects nonnumeric values", () => {
  assert.equal(volume(-2), 0);
  assert.equal(volume(170), 170);
  assert.equal(volume(400), 300);
  assert.throws(() => volume("oops"));
});
