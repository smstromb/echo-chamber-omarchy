import { test } from "node:test";
import assert from "node:assert/strict";
import { RoomData, decodeMessage, normalizeChat } from "../src/room-data.js";
import { jamContract, pcmFrame, JamClient } from "../src/jam.js";
const encode = (x) => new TextEncoder().encode(JSON.stringify(x));
const message = {
  type: "chat-message",
  id: "sam-1",
  identity: "sam",
  name: "Sam",
  text: "hello",
  room: "main",
  timestamp: 1,
};
test("room data rejects spoofed identities, other rooms, internal participants and oversized payloads", () => {
  assert.ok(decodeMessage(encode(message), { identity: "sam" }, "main"));
  assert.equal(
    decodeMessage(encode(message), { identity: "alex" }, "main"),
    null,
  );
  assert.equal(
    decodeMessage(encode(message), { identity: "sam" }, "breakout-1"),
    null,
  );
  assert.equal(
    decodeMessage(
      encode({ ...message, identity: "sam$screen" }),
      { identity: "sam$screen" },
      "main",
    ),
    null,
  );
  assert.equal(
    decodeMessage(new Uint8Array(16001), { identity: "sam" }, "main"),
    null,
  );
  assert.equal(
    normalizeChat({
      ...message,
      type: "chat-file",
      fileUrl: "https://attacker.example/file",
    }),
    null,
  );
  assert.equal(
    normalizeChat({
      ...message,
      type: "chat-file",
      fileUrl: "/api/chat/uploads/../private",
    }),
    null,
  );
});
function harness(api = async () => []) {
  const sam = { identity: "sam", name: "Sam" },
    alex = { identity: "alex", name: "Alex" },
    sent = [];
  const c = {
    config: { deviceId: "linux-1" },
    state: { room: "main" },
    publish() {},
    api,
    room: {
      localParticipant: {
        identity: "self",
        name: "You",
        publishData: async (data) =>
          sent.push(JSON.parse(new TextDecoder().decode(data))),
      },
      remoteParticipants: new Map([
        ["sam", sam],
        ["alex", alex],
      ]),
    },
  };
  return { data: new RoomData(c), c, sam, alex, sent };
}
test("late history merges live messages without duplicates or resurrecting deleted messages", async () => {
  let resolve;
  const gate = new Promise((r) => (resolve = r));
  const { data, sam } = harness(async (_, { name }) =>
    name === "chat-history" ? gate : { sounds: [] },
  );
  const loading = data.load();
  await data.receive(encode(message), sam);
  await data.receive(encode(message), sam);
  assert.equal(data.state.messages.length, 1);
  assert.equal(data.state.unread, 1);
  await data.receive(
    encode({ type: "chat-delete", id: "sam-1", identity: "sam", room: "main" }),
    sam,
  );
  resolve([message]);
  await loading;
  assert.equal(data.state.messages.length, 0);
});
test("a sender cannot delete another participant message or inject events from a retired participant object", async () => {
  const { data, sam, alex } = harness();
  await data.receive(encode(message), sam);
  await data.receive(
    encode({ type: "chat-delete", id: "sam-1", identity: "alex" }),
    alex,
  );
  assert.equal(data.state.messages.length, 1);
  await data.receive(encode({ ...message, id: "sam-2" }), { ...sam });
  assert.equal(data.state.messages.length, 1);
});
test("failed chat persistence does not broadcast or appear delivered", async () => {
  const { data, sent } = harness(async () => {
    throw Error("offline");
  });
  await assert.rejects(data.chat("hello"), /offline/);
  assert.equal(sent.length, 0);
  assert.equal(data.state.messages.length, 0);
});
test("disposing a room ignores late history and new data", async () => {
  let resolve;
  const gate = new Promise((r) => (resolve = r));
  const { data, sam } = harness(() => gate);
  const loading = data.load();
  data.dispose();
  resolve([]);
  await loading;
  await data.receive(encode(message), sam);
  assert.equal(data.state.messages.length, 0);
});
const ready = {
  jam_protocol_version: 3,
  generation: 4,
  active: true,
  source_enabled: true,
  source_availability_known: true,
  source_status: "live",
  spotify_connected: true,
  playback_stop_supported: true,
};
test("Jam refuses incompatible or stale sources but allows recovery controls for stalled audio", () => {
  assert.equal(jamContract(ready).canJoin, true);
  assert.equal(
    jamContract({ ...ready, jam_protocol_version: 2 }).canJoin,
    false,
  );
  assert.equal(
    jamContract({ ...ready, source_status: "stalled" }).canJoin,
    false,
  );
  assert.equal(
    jamContract({ ...ready, source_status: "stalled" }).canControl,
    true,
  );
  assert.equal(
    jamContract({ ...ready, skip_reconciliation_pending: true }).canControl,
    false,
  );
  assert.equal(
    jamContract({ ...ready, source_status: "offline" }).canPause,
    true,
  );
});
test("PCM decoder rejects malformed frames and clamps nonfinite or out-of-range samples", () => {
  assert.equal(pcmFrame(new ArrayBuffer(7)), null);
  const [left, right] = pcmFrame(
    new Float32Array([0.5, -0.2, Infinity, 3]).buffer,
  );
  assert.equal(left[0], 0.5);
  assert.equal(left[1], 0);
  assert.equal(right[1], 1);
});
test("Jam does not carry listener intent into another generation", async () => {
  const c = { publish() {}, api: async () => ({ ...ready, generation: 5 }) };
  const jam = new JamClient(c);
  jam.state.listening = true;
  jam.generation = 4;
  await jam.refresh();
  assert.equal(jam.state.listening, false);
  assert.equal(jam.state.ready, false);
});

test("Windows numeric session suffixes use base identity for device announcements", () => {
  assert.ok(
    decodeMessage(
      encode({ type: "device-id", identityBase: "sam", deviceId: "dev-1" }),
      { identity: "sam-1234" },
      "main",
    ),
  );
  assert.equal(
    decodeMessage(
      encode({ type: "device-id", identityBase: "alex", deviceId: "dev-1" }),
      { identity: "sam-1234" },
      "main",
    ),
    null,
  );
});
