export function jamContract(s = {}) {
  const compatible =
    s.jam_protocol_version === 3 &&
    Number.isSafeInteger(s.generation) &&
    s.generation >= 0;
  const status = String(s.source_status || "unknown").toLowerCase();
  const available =
    s.source_availability_known === true &&
    s.source_enabled === true &&
    ![
      "disabled",
      "offline",
      "unconfigured",
      "error",
      "failed",
      "negotiating",
    ].includes(status);
  const ready =
    available &&
    status !== "stalled" &&
    (s.source_ready === true || ["ready", "live", "silent"].includes(status));
  const control =
    available &&
    (s.source_ready === true ||
      ["ready", "live", "silent", "stalled"].includes(status));
  return {
    compatible,
    canJoin: compatible && s.active === true && ready,
    canStart:
      compatible &&
      !s.active &&
      !s.starting &&
      s.spotify_connected === true &&
      ready,
    canControl:
      compatible &&
      s.active === true &&
      control &&
      !s.skip_reconciliation_pending,
    canPause:
      compatible &&
      s.active === true &&
      s.spotify_connected === true &&
      s.playback_stop_supported === true,
  };
}
export function pcmFrame(bytes) {
  if (
    !(bytes instanceof ArrayBuffer) ||
    !bytes.byteLength ||
    bytes.byteLength % 8 ||
    bytes.byteLength > 48000 * 8
  )
    return null;
  const input = new Float32Array(bytes),
    left = new Float32Array(input.length / 2),
    right = new Float32Array(input.length / 2);
  for (let i = 0; i < left.length; i++) {
    left[i] = Number.isFinite(input[i * 2])
      ? Math.max(-1, Math.min(1, input[i * 2]))
      : 0;
    right[i] = Number.isFinite(input[i * 2 + 1])
      ? Math.max(-1, Math.min(1, input[i * 2 + 1]))
      : 0;
  }
  return [left, right];
}
export class JamClient {
  constructor(c) {
    this.c = c;
    this.active = true;
    this.state = {
      server: null,
      listening: false,
      ready: false,
      error: "",
      results: [],
      revision: 0,
    };
    this.nodes = new Set();
    this.polling = false;
    this.busy = false;
    this.requests = new Map();
    this.requestEpoch = 0;
  }
  api(name, args) {
    return this.c.api("feature", { name, args });
  }
  update() {
    if (this.active) {
      this.state.revision++;
      this.c.publish();
    }
  }
  async refresh() {
    if (!this.active || this.polling || this.busy) return;
    this.polling = true;
    const request = ++this.requestEpoch;
    try {
      const s = await this.api("jam-state");
      if (!this.active || request !== this.requestEpoch) return;
      this.state.server = s;
      if (
        this.state.listening &&
        (!s.active ||
          s.generation !== this.generation ||
          !jamContract(s).compatible)
      ) {
        this.state.listening = false;
        this.stopAudio();
      }
      if (
        this.state.listening &&
        !this.socket &&
        jamContract(s).canJoin &&
        !this.connecting
      )
        await this.open();
    } catch (e) {
      if (this.active) this.state.error = e.message;
    } finally {
      this.polling = false;
      this.update();
    }
  }
  async action(action, body = {}) {
    if (!this.active || this.busy) throw Error("Jam is busy.");
    // Finish any state fetch before mutation; suppress its late result with a generation snapshot below.
    const s = this.state.server || {},
      contract = jamContract(s);
    if (!contract.compatible)
      throw Error("Jam requires a compatible version 3 server.");
    if (
      (action === "join" && !contract.canJoin) ||
      (action === "start" && !contract.canStart) ||
      (["add", "remove", "skip"].includes(action) && !contract.canControl) ||
      (action === "pause" && !contract.canPause)
    )
      throw Error("Jam source is not ready for this action.");
    this.busy = true;
    this.requestEpoch++;
    this.state.error = "";
    try {
      const payload = {
        ...body,
        generation: action === "leave" ? this.generation : s.generation,
      };
      let requestKey;
      if (action === "add") {
        requestKey = s.generation + ":" + body.spotify_uri;
        payload.request_id =
          this.requests.get(requestKey) || crypto.randomUUID();
        this.requests.set(requestKey, payload.request_id);
      }
      if (action === "remove") {
        payload.request_id = crypto.randomUUID();
        payload.expected_queue_revision = s.queue_revision;
      }
      const result = await this.api("jam-action", { action, body: payload });
      if (!this.active) return;
      if (requestKey) this.requests.delete(requestKey);
      if (action === "join" || action === "start") {
        this.generation = action === "start" ? result.generation : s.generation;
        this.state.listening =
          action === "join" || result.listener_joined !== false;
        if (!Number.isSafeInteger(this.generation)) {
          this.state.listening = false;
          throw Error("Server returned an invalid Jam generation.");
        }
        if (this.state.listening) await this.open();
      }
      if (action === "leave" || action === "end") {
        this.state.listening = false;
        this.stopAudio();
      }
      if (action === "search")
        this.state.results = (
          Array.isArray(result) ? result : result.items || result.tracks || []
        ).slice(0, 50);
      if (["start", "end", "pause"].includes(action))
        await this.c.data
          .send({
            type:
              action === "start"
                ? "jam-started"
                : action === "end"
                  ? "jam-stopped"
                  : "jam-playback-stopped",
            host: this.c.config.name,
          })
          .catch(() => {});
    } catch (e) {
      this.state.error = e.message;
      throw e;
    } finally {
      this.busy = false;
      await this.refresh();
      this.update();
    }
  }
  async open() {
    if (!this.active || !this.state.listening || this.socket || this.connecting)
      return;
    this.connecting = true;
    const generation = this.generation;
    try {
      // Idempotent rejoin also restores membership after a transport failure.
      await this.api("jam-action", { action: "join", body: { generation } });
      const credentials = await this.api("jam-credentials");
      const ctx = await this.c.effects.context();
      if (
        !this.active ||
        !this.state.listening ||
        generation !== this.generation
      )
        return;
      if (!this.gain) {
        this.gain = ctx.createGain();
        this.gain.connect(this.c.effects.master);
      }
      this.sync();
      this.next = 0;
      const url = new URL(credentials.url);
      url.search = new URLSearchParams({
        jam_protocol_version: "3",
        generation: String(generation),
      });
      const socket = new WebSocket(url);
      socket.binaryType = "arraybuffer";
      this.socket = socket;
      const current = () =>
        this.active &&
        this.socket === socket &&
        this.state.listening &&
        this.generation === generation;
      const timeout = setTimeout(() => {
        if (current() && !this.state.ready) {
          this.state.error = "Jam audio handshake timed out.";
          socket.close();
        }
      }, 7000);
      socket.onopen = () => {
        if (current())
          socket.send(
            JSON.stringify({ type: "auth", token: credentials.token }),
          );
      };
      socket.onmessage = (e) => {
        if (!current()) return;
        if (typeof e.data === "string") {
          try {
            const message = JSON.parse(e.data);
            if (message.type !== "ready")
              throw Error(message.message || "Jam audio rejected.");
            this.state.ready = true;
            this.state.error = "";
            clearTimeout(timeout);
            this.update();
          } catch (error) {
            this.state.error = error.message;
            socket.close();
          }
          return;
        }
        if (!this.state.ready) {
          this.state.error = "Jam audio arrived before authentication.";
          socket.close();
          return;
        }
        const channels = pcmFrame(e.data);
        if (!channels) return;
        const at = Math.max(this.next, ctx.currentTime + 0.02);
        if (at - ctx.currentTime > 0.5) return;
        const buffer = ctx.createBuffer(2, channels[0].length, 48000);
        channels.forEach((ch, i) => buffer.copyToChannel(ch, i));
        const node = ctx.createBufferSource();
        node.buffer = buffer;
        node.connect(this.gain);
        this.nodes.add(node);
        node.onended = () => {
          this.nodes.delete(node);
          node.disconnect();
        };
        node.start(at);
        this.next = at + buffer.duration;
      };
      socket.onerror = () => {};
      socket.onclose = () => {
        clearTimeout(timeout);
        if (this.socket === socket) {
          this.socket = null;
          this.state.ready = false;
          this.clearFrames();
          this.update();
        }
      };
    } finally {
      this.connecting = false;
    }
  }
  sync() {
    if (this.gain)
      this.gain.gain.value = (this.c.preferences.jamVolume ?? 30) / 100;
  }
  clearFrames() {
    for (const n of this.nodes) {
      try {
        n.stop();
      } catch {}
    }
    this.nodes.clear();
    this.next = 0;
  }
  stopAudio() {
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.state.ready = false;
    this.clearFrames();
  }
  async dispose() {
    this.active = false;
    this.stopAudio();
    if (this.state.listening) {
      this.state.listening = false;
      await this.api("jam-action", {
        action: "leave",
        body: { generation: this.generation },
      }).catch(() => {});
    }
    this.gain?.disconnect();
  }
}
