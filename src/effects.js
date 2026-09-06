import { identityBase } from "./room-data.js";
// Local playback shares output/deafen controls, but never enters the microphone mix.
export class Effects {
  constructor(controller) {
    this.c = controller;
    this.playing = new Set();
    this.cache = new Map();
    this.epoch = 0;
    this.recent = [];
  }
  async context() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
    }
    await this.ctx.resume();
    const output =
      this.c.preferences?.audiooutput === "default"
        ? ""
        : this.c.preferences?.audiooutput || "";
    if (this.ctx.setSinkId && this.ctx.sinkId !== output)
      await this.ctx.setSinkId(output);
    this.sync();
    return this.ctx;
  }
  sync() {
    if (this.master) this.master.gain.value = this.c.state.deafened ? 0 : 1;
  }
  async sound(id, data) {
    const now = Date.now();
    this.recent = this.recent.filter((t) => now - t < 5000);
    if (this.recent.length >= 8 || this.c.state.deafened) return;
    this.recent.push(now);
    const epoch = this.epoch;
    const sound = data.state.sounds.find((s) => s.id === id);
    if (!sound) return;
    const ctx = await this.context();
    const file = await data.feature("media-file", {
      path: "/api/soundboard/file/" + encodeURIComponent(id),
    });
    const buffer = await ctx.decodeAudioData(new Uint8Array(file.bytes).buffer);
    if (epoch !== this.epoch || !data.active || this.c.state.deafened) return;
    this.play(
      buffer,
      (((this.c.preferences.soundVolume ?? 70) / 100) *
        Math.min(200, Number(sound.volume ?? 100) || 0)) /
        100,
    );
  }
  play(buffer, gainValue) {
    const source = this.ctx.createBufferSource(),
      gain = this.ctx.createGain();
    source.buffer = buffer;
    gain.gain.value = gainValue;
    source.connect(gain).connect(this.master);
    this.playing.add(source);
    source.onended = () => {
      this.playing.delete(source);
      source.disconnect();
      gain.disconnect();
    };
    source.start();
  }
  async chime(kind, identity) {
    if (this.c.state.deafened || !this.c.preferences.chimes) return;
    const epoch = this.epoch,
      ctx = await this.context();
    if (epoch !== this.epoch) return;
    const vol = (this.c.preferences.chimeVolume ?? 40) / 100;
    if (identity && ["enter", "exit"].includes(kind) && this.c.data) {
      const key =
        this.c.data.devices.get(identity) ||
        (identity === this.c.room?.localParticipant.identity
          ? this.c.config.deviceId
          : identityBase(identity));
      const path = "/api/chime/" + encodeURIComponent(key) + "/" + kind;
      try {
        let entry = this.cache.get(path);
        if (!entry || Date.now() - entry.time > 60000) {
          const file = await this.c.data.feature("media-file", { path });
          entry = {
            time: Date.now(),
            buffer: await ctx.decodeAudioData(
              new Uint8Array(file.bytes).buffer,
            ),
          };
          this.cache.set(path, entry);
          if (this.cache.size > 40)
            this.cache.delete(this.cache.keys().next().value);
        }
        if (epoch !== this.epoch || this.c.state.deafened) return;
        this.play(entry.buffer, vol);
        return;
      } catch {}
    }
    if (epoch !== this.epoch || this.c.state.deafened) return;
    const notes =
      kind === "enter"
        ? [520, 660]
        : kind === "exit"
          ? [660, 440]
          : kind === "share"
            ? [780, 980, 1170]
            : [1170, 980, 780];
    notes.forEach((freq, i) => {
      const oscillator = ctx.createOscillator(),
        gain = ctx.createGain(),
        at = ctx.currentTime + i * 0.09;
      oscillator.frequency.value = freq;
      gain.gain.setValueAtTime(0.12 * vol, at);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.25);
      oscillator.connect(gain).connect(this.master);
      this.playing.add(oscillator);
      oscillator.onended = () => {
        this.playing.delete(oscillator);
        oscillator.disconnect();
        gain.disconnect();
      };
      oscillator.start(at);
      oscillator.stop(at + 0.3);
    });
  }
  stop() {
    this.epoch++;
    for (const s of this.playing) {
      try {
        s.stop();
      } catch {}
    }
    this.playing.clear();
  }
}
