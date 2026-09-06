import { test } from "node:test";
import assert from "node:assert/strict";
import { AudioPlayback } from "../src/audio-playback.js";
class Context {
  state = "suspended";
  currentTime = 0;
  createGain() {
    return { gain: { value: 1 } };
  }
  async setSinkId(id) {
    this.sinkId = id;
  }
  async close() {
    this.state = "closed";
  }
}
function harness() {
  const logs = [],
    c = {
      preferences: { audiooutput: "selected" },
      state: { deafened: true },
      diagnostic: (...args) => logs.push(args),
      applyMix() {
        this.mixed = true;
      },
      effects: {},
      publish() {},
    };
  const audio = new AudioPlayback(c);
  const room = {
    options: {},
    remoteParticipants: new Map(),
    async startAudio() {
      room.starts = (room.starts || 0) + 1;
      room.options.webAudioMix.audioContext.state = "running";
    },
  };
  c.room = room;
  audio.room = room;
  return { audio, room, c, logs };
}
test("audio recovery preserves the room and mix, selects the output, and starts gains muted", async () => {
  const original = globalThis.AudioContext;
  globalThis.AudioContext = Context;
  try {
    const { audio, room, c } = harness(),
      old = audio.context;
    await audio.recover();
    assert.equal(c.room, room);
    assert.equal(c.state.deafened, true);
    assert.equal(c.mixed, true);
    assert.equal(audio.context.sinkId, "selected");
    assert.equal(old.state, "closed");
    assert.equal(audio.context.createGain().gain.value, 0);
    audio.dispose();
  } finally {
    globalThis.AudioContext = original;
  }
});
test("overlapping recoveries coalesce and a leave during device setup cannot restart retired media", async () => {
  const original = globalThis.AudioContext;
  globalThis.AudioContext = Context;
  try {
    const { audio, room, c } = harness();
    let release;
    Context.prototype.setSinkId = () =>
      new Promise((r) => {
        release = r;
      });
    const first = audio.recover();
    assert.equal(first, audio.recover());
    c.room = null;
    audio.dispose();
    release();
    await first;
    assert.equal(room.starts, undefined);
    assert.equal(c.state.audioError, undefined);
  } finally {
    globalThis.AudioContext = original;
    Context.prototype.setSinkId = async function (id) {
      this.sinkId = id;
    };
  }
});
