// Own the receive AudioContext so a failed audio service can be recovered
// without reconnecting the room, microphone, camera or screen publications.
export class AudioPlayback {
  constructor(controller) {
    this.c = controller;
    this.context = this.createContext();
    this.lastAttempt = 0;
  }
  createContext() {
    if (!globalThis.AudioContext) return null;
    const ctx = new AudioContext();
    // LiveKit 2.22 skips restoring an exactly-zero gain when rebuilding its
    // graph. Start muted so graph reconstruction cannot briefly undo deafen
    // or a participant's zero volume. Nonzero saved gains are applied by SDK.
    const createGain = ctx.createGain.bind(ctx);
    ctx.createGain = () => {
      const node = createGain();
      node.gain.value = 0;
      return node;
    };
    ctx.onstatechange = () => {
      if (this.context === ctx && !this.disposed)
        this.c.diagnostic("audio.context", { state: ctx.state });
    };
    return ctx;
  }
  async selectOutput(context = this.context) {
    const output = this.c.preferences.audiooutput;
    if (context?.setSinkId)
      await context.setSinkId(output && output !== "default" ? output : "");
  }
  options() {
    return this.context ? { audioContext: this.context } : true;
  }
  start(room) {
    this.room = room;
    this.timer = setInterval(() => this.check(), 5000);
    this.timer.unref?.();
    this.check();
  }
  async check() {
    if (this.checking || this.disposed || this.c.room !== this.room) return;
    this.checking = true;
    try {
      const tracks = [...this.room.remoteParticipants.values()].flatMap((p) =>
        [...(p.audioTrackPublications?.values() || [])]
          .map((pub) => pub.track)
          .filter(Boolean),
      );
      const elements = tracks.flatMap((t) => t.attachedElements || []);
      const stats = await Promise.all(
        tracks.map((t) => t.getReceiverStats?.().catch(() => null)),
      );
      if (this.disposed || this.c.room !== this.room) return;
      const sum = (key) =>
        stats.reduce((total, s) => total + (Number(s?.[key]) || 0), 0);
      this.c.diagnostic("audio.health", {
        state: this.context?.state || "unavailable",
        contextTime: this.context?.currentTime || 0,
        audioTracks: tracks.length,
        attached: elements.length,
        paused: elements.filter((e) => e.paused).length,
        ended: tracks.filter((t) => t.mediaStreamTrack?.readyState === "ended")
          .length,
        canPlayback: this.room.canPlaybackAudio,
        deafened: this.c.state.deafened,
        defaultOutput:
          !this.c.preferences.audiooutput ||
          this.c.preferences.audiooutput === "default",
        bytesReceived: sum("bytesReceived"),
        totalAudioEnergy: sum("totalAudioEnergy"),
        concealedSamples: sum("concealedSamples"),
        jitter: sum("jitter"),
      });
      const time = this.context?.currentTime;
      const stalled = time !== undefined && this.lastTime === time;
      this.stalledChecks = stalled ? (this.stalledChecks || 0) + 1 : 0;
      this.lastTime = time;
      if (
        tracks.length &&
        this.context &&
        !this.pending &&
        (this.context.state !== "running" ||
          this.stalledChecks >= 2 ||
          this.room.canPlaybackAudio === false) &&
        Date.now() - this.lastAttempt > 30000
      ) {
        this.recover("watchdog").catch(() => {});
      }
    } catch (error) {
      if (!this.disposed)
        this.c.diagnostic("operation.failed", { error: error.name });
    } finally {
      this.checking = false;
    }
  }
  recover(reason = "manual") {
    if (this.pending) return this.pending;
    this.lastAttempt = Date.now();
    this.pending = this.rebuild(reason).finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
  async rebuild(reason) {
    const room = this.room,
      old = this.context;
    if (this.disposed || !room || this.c.room !== room) return;
    this.c.diagnostic("audio.recovery.start", { reason });
    let next, timeout;
    try {
      next = this.createContext();
      await this.selectOutput(next);
      if (this.disposed || this.c.room !== room) {
        await next?.close();
        return;
      }
      if (next) {
        this.context = next;
        room.options.webAudioMix = { audioContext: next };
      }
      await Promise.race([
        room.startAudio(),
        new Promise((_, reject) => {
          timeout = setTimeout(
            () =>
              reject(
                new DOMException("Audio restart timed out.", "TimeoutError"),
              ),
            5000,
          );
        }),
      ]);
      if (this.disposed || this.c.room !== room) return;
      this.c.applyMix();
      if (this.c.effects.ctx) await this.c.effects.context();
      if (next && next.state !== "running")
        throw Error("Audio output is unavailable.");
      this.c.state.audioError = "";
      this.stalledChecks = 0;
      this.c.diagnostic("audio.recovery.complete", {
        reason,
        state: next?.state || "unavailable",
      });
    } catch (error) {
      if (!this.disposed && this.c.room === room) {
        this.c.state.audioError =
          "Audio playback could not restart. Try rejoining the room.";
        this.c.diagnostic("audio.recovery.failed", {
          reason,
          error: error.name,
        });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      if (old && this.context !== old) {
        old.onstatechange = null;
        await old.close().catch(() => {});
      }
      if (next && this.context !== next) await next.close().catch(() => {});
      if (!this.disposed && this.c.room === room) this.c.publish();
    }
  }
  dispose() {
    this.disposed = true;
    clearInterval(this.timer);
    if (this.context) {
      this.context.onstatechange = null;
      this.context.close().catch(() => {});
    }
  }
}
