import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Controller } from "../src/controller.js";
function harness({ failConnect = false, gate = null } = {}) {
  const calls = [],
    gains = [];
  const remote = {
    identity: "orbit",
    name: "Orbit",
    isMicrophoneEnabled: true,
    setVolume: (...args) => gains.push(args),
  };
  const companion = {
    identity: "orbit$screen",
    isScreenShareEnabled: true,
    setVolume: (...args) => gains.push(args),
  };
  const room = new EventEmitter();
  Object.assign(room, {
    localParticipant: {
      identity: "self",
      isLocal: true,
      isMicrophoneEnabled: false,
      setMicrophoneEnabled: async (v) => {
        room.localParticipant.isMicrophoneEnabled = v;
      },
    },
    remoteParticipants: new Map([
      ["orbit", remote],
      ["screen", companion],
    ]),
    connect: async () => {
      if (gate) await gate;
      if (failConnect) throw Error("ICE failed");
    },
    startAudio: async () => {},
    disconnect: async () => calls.push("disconnect"),
  });
  const c = new Controller(
    async (name, args) => {
      calls.push(name);
      return name === "token" ? { url: "ws://test", token: "t" } : [];
    },
    () => {},
    () => {},
    () => room,
  );
  c.state.signedIn = true;
  c.config = { server: "https://example.com" };
  return { c, calls, gains, room };
}
test("join starts muted; mute and volume affect voice and screen audio and restore saved gain", async () => {
  const { c, gains } = harness();
  await c.command({ action: "join", room: "main" });
  assert.equal(c.state.micMuted, true);
  await c.command({ action: "volume", identity: "orbit", value: 37 });
  assert.ok(gains.every((g) => g[0] === 0.37));
  gains.length = 0;
  await c.command({ action: "mute", identity: "orbit" });
  assert.ok(gains.every((g) => g[0] === 0));
  gains.length = 0;
  await c.command({ action: "mute", identity: "orbit" });
  assert.ok(gains.every((g) => g[0] === 0.37));
  await c.command({ action: "leave" });
  assert.equal(c.state.status, "idle");
  assert.deepEqual(c.state.participants, []);
});
test("leave supersedes a join that has not started", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const { c, calls } = harness({ gate });
  const joining = c.command({ action: "join" });
  const leaving = c.command({ action: "leave" });
  release();
  await Promise.all([joining, leaving]);
  assert.equal(c.state.status, "idle");
  assert.equal(c.room, null);
  assert.equal(calls.filter((x) => x === "disconnect").length, 0);
});
test("failed media connection removes server presence and returns to lobby", async () => {
  const { c, calls } = harness({ failConnect: true });
  await assert.rejects(c.command({ action: "join" }), /ICE failed/);
  assert.equal(c.state.status, "idle");
  assert.equal(c.room, null);
  assert.equal(calls.at(-1), "leave");
});
test("roster failures clear stale people and expose unavailable status", async () => {
  const { c } = harness();
  c.state.online = [{ name: "Orbit" }];
  c.api = async () => {
    throw Error("offline");
  };
  await c.poll();
  assert.deepEqual(c.state.online, []);
  assert.equal(c.state.onlineError, "offline");
});
test("voice and screen mix remain independent, including native screen companions", async () => {
  const { c, room } = harness();
  const gains = {};
  for (const p of room.remoteParticipants.values())
    p.setVolume = (gain, source) => {
      gains[p.identity + ":" + source] = gain;
    };
  await c.command({ action: "join" });
  await c.command({
    action: "volume",
    identity: "orbit",
    bus: "screen",
    value: 35,
  });
  await c.command({ action: "mute", identity: "orbit", bus: "voice" });
  assert.equal(gains["orbit:microphone"], 0);
  assert.equal(gains["orbit:screen_share_audio"], 0.35);
  assert.equal(gains["orbit$screen:microphone"], 0.35);
  await c.command({ action: "deafen" });
  assert.ok(Object.values(gains).every((x) => x === 0));
  await c.command({ action: "deafen" });
  assert.equal(gains["orbit:microphone"], 0);
  assert.equal(gains["orbit$screen:microphone"], 0.35);
  await c.command({ action: "mute", identity: "orbit", bus: "voice" });
  assert.equal(gains["orbit:microphone"], 1);
  assert.equal(gains["orbit:screen_share_audio"], 0.35);
});
test("changing voice on a legacy mix preserves its previous screen gain", async () => {
  const { c } = harness();
  c.mix.orbit = { volume: 62, muted: false };
  await c.command({ action: "join" });
  await c.command({
    action: "volume",
    identity: "orbit",
    bus: "voice",
    value: 20,
  });
  assert.equal(c.mix.orbit.screenVolume, 62);
  await c.command({ action: "mute", identity: "orbit", bus: "voice" });
  assert.equal(c.mix.orbit.screenMuted, false);
});

test("cancel interrupts a stalled connect without waiting for the media timeout", async () => {
  const { c, calls } = harness({ gate: new Promise(() => {}) });
  const join = c.command({ action: "join" });
  await new Promise((r) => setTimeout(r, 5));
  const leave = c.command({ action: "leave" });
  await Promise.all([join, leave]);
  assert.equal(c.state.status, "idle");
  assert.equal(c.state.error, "");
  assert.equal(calls.filter((x) => x === "disconnect").length, 1);
});

test("leaving disconnects microphone media without waiting for Jam membership cleanup", async () => {
  const { c, calls } = harness();
  await c.command({ action: "join" });
  let release;
  const gate = new Promise((r) => (release = r));
  c.jamClient = { dispose: () => gate };
  const leaving = c.command({ action: "leave" });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(c.room, null);
  assert.ok(calls.includes("disconnect"));
  release();
  await leaving;
  assert.equal(c.state.status, "idle");
});
