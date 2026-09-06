import { parentIdentity } from "./model.js";
const decoder = new TextDecoder();
export const identityBase = (id) => parentIdentity(id).replace(/-\d+$/, "");
export function decodeMessage(payload, participant, roomName) {
  if (
    !participant ||
    parentIdentity(participant.identity) !== participant.identity ||
    payload.byteLength > 16000
  )
    return null;
  try {
    const message = JSON.parse(decoder.decode(payload));
    if (
      !message ||
      typeof message.type !== "string" ||
      (message.room && message.room !== roomName)
    )
      return null;
    if (message.identity && message.identity !== participant.identity)
      return null;
    if (
      message.identityBase &&
      message.identityBase !== identityBase(participant.identity)
    )
      return null;
    return message;
  } catch {
    return null;
  }
}
export function normalizeChat(m) {
  if (
    !m ||
    !["chat-message", "chat-file"].includes(m.type) ||
    typeof m.id !== "string" ||
    typeof m.identity !== "string"
  )
    return null;
  if (
    m.type === "chat-file" &&
    !/^\/api\/chat\/uploads\/[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9]+)?$/.test(m.fileUrl)
  )
    return null;
  return {
    type: m.type,
    id: m.id.slice(0, 256),
    identity: m.identity,
    name: String(m.name || m.identity).slice(0, 128),
    text: String(m.text || "").slice(0, 6000),
    timestamp: Number(m.timestamp) || Date.now(),
    room: m.room,
    fileUrl: m.fileUrl,
    fileName: String(m.fileName || "Attachment").slice(0, 255),
    fileType: String(m.fileType || ""),
  };
}
export class RoomData {
  constructor(controller) {
    this.c = controller;
    this.state = {
      avatars: {},
      messages: [],
      unread: 0,
      sounds: [],
      pg13: false,
      error: "",
      revision: 0,
    };
    this.avatarEpoch = new Map();
    this.devices = new Map();
    this.activities = new Map();
    this.deleted = new Set();
    this.active = true;
    this.chatOpen = false;
  }
  update() {
    if (this.active) {
      this.state.revision++;
      this.c.publish();
    }
  }
  feature(name, args) {
    return this.c.api("feature", { name, args });
  }
  async send(message, destination) {
    if (!this.active || !this.c.room) throw Error("Join a room first.");
    await this.c.room.localParticipant.publishData?.(
      new TextEncoder().encode(JSON.stringify(message)),
      {
        reliable: true,
        ...(destination ? { destinationIdentities: [destination] } : {}),
      },
    );
  }
  async load() {
    const result = await Promise.allSettled([
      this.feature("chat-history"),
      this.feature("sounds"),
    ]);
    if (!this.active) return;
    if (result[0].status === "fulfilled" && Array.isArray(result[0].value)) {
      const combined = new Map();
      for (const m of [...result[0].value, ...this.state.messages]) {
        const valid = normalizeChat(m);
        if (
          valid &&
          !this.deleted.has(valid.id) &&
          (!m.room || m.room === this.c.state.room)
        )
          combined.set(valid.id, valid);
      }
      this.state.messages = [...combined.values()]
        .sort((a, b) => a.timestamp - b.timestamp)
        .slice(-1000);
    }
    if (result[1].status === "fulfilled")
      this.state.sounds = (result[1].value?.sounds || []).filter(
        (x) => typeof x.id === "string",
      );
    this.state.error = result.some((x) => x.status === "rejected")
      ? "Some room features could not load. Retry in Chat or Soundboard."
      : "";
    this.update();
  }
  async announce(destination) {
    await this.send(
      {
        type: "device-id",
        identityBase: identityBase(this.c.room.localParticipant.identity),
        deviceId:
          this.c.config.deviceId || this.c.room.localParticipant.identity,
      },
      destination,
    );
    if (!destination) {
      await this.send({ type: "pg13-query" });
      await this.send({ type: "stream-activity-query", version: 1 });
    }
  }
  add(message, incoming = false) {
    const m = normalizeChat(message);
    if (
      !m ||
      this.deleted.has(m.id) ||
      this.state.messages.some((x) => x.id === m.id)
    )
      return;
    this.state.messages.push(m);
    this.state.messages = this.state.messages.slice(-1000);
    if (incoming && !this.chatOpen) this.state.unread++;
  }
  async receive(payload, p) {
    if (!this.active || this.c.room?.remoteParticipants.get(p?.identity) !== p)
      return;
    const msg = decodeMessage(payload, p, this.c.state.room);
    if (!msg) return;
    switch (msg.type) {
      case "chat-message":
      case "chat-file":
        this.add(
          { ...msg, identity: p.identity, name: p.name || p.identity },
          true,
        );
        break;
      case "chat-delete":
        if (
          this.state.messages.some(
            (m) => m.id === msg.id && m.identity !== p.identity,
          )
        )
          return;
        // Upstream ids start with the sender identity. Reject deletion of unseen foreign messages.
        if (!String(msg.id).startsWith(p.identity + "-")) return;
        this.deleted.add(msg.id);
        this.state.messages = this.state.messages.filter(
          (m) => m.id !== msg.id,
        );
        break;
      case "sound-play":
        if (
          typeof msg.soundId === "string" &&
          !this.state.sounds.some((s) => s.id === msg.soundId)
        )
          await this.load();
        if (typeof msg.soundId === "string")
          await this.c.effects?.sound(msg.soundId, this);
        break;
      case "sound-added":
      case "sound-updated":
        await this.load();
        break;
      case "device-id":
        if (
          typeof msg.deviceId === "string" &&
          /^[\w-]{1,160}$/.test(msg.deviceId)
        ) {
          this.devices.set(p.identity, msg.deviceId);
          this.loadAvatar(p).catch(() => {});
        }
        break;
      case "avatar-update":
        await this.loadAvatar(p);
        break;
      case "pg13-mode":
        this.state.pg13 = !!msg.enabled;
        break;
      case "pg13-query":
        if (this.state.pg13)
          await this.send(
            { type: "pg13-mode", enabled: true, sync: true },
            p.identity,
          );
        break;
      case "stream-activity": {
        if (
          msg.version !== 1 ||
          typeof msg.trackSid !== "string" ||
          msg.trackSid.length > 128
        )
          return;
        const source = msg.source;
        if (
          source &&
          !["game", "window", "monitor", "browser"].includes(source.source_type)
        )
          return;
        const entries = this.activities.get(p) || new Map();
        if (source)
          entries.set(msg.trackSid, {
            source_type: source.source_type,
            source_title: ["game", "window"].includes(source.source_type)
              ? String(source.source_title || "")
                  .replace(
                    /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,
                    " ",
                  )
                  .slice(0, 160)
              : "",
          });
        else entries.delete(msg.trackSid);
        while (entries.size > 4) entries.delete(entries.keys().next().value);
        this.activities.set(p, entries);
        break;
      }
      case "stream-activity-query":
        await this.broadcastSource(p.identity);
        break;
      case "jam-started":
      case "jam-stopped":
      case "jam-playback-stopped":
        await this.c.jamClient?.refresh();
        break;
      default:
        return;
    }
    this.update();
  }
  async loadAvatar(p) {
    if (!globalThis.URL?.createObjectURL) return;
    const epoch = (this.avatarEpoch.get(p.identity) || 0) + 1;
    this.avatarEpoch.set(p.identity, epoch);
    const keys = [
      this.devices.get(p.identity),
      p.isLocal ? this.c.config.deviceId : null,
      identityBase(p.identity),
    ].filter(Boolean);
    for (const key of new Set(keys)) {
      try {
        const file = await this.feature("media-file", {
          path: "/api/avatar/" + encodeURIComponent(key),
        });
        if (!this.active || this.avatarEpoch.get(p.identity) !== epoch) return;
        if (!/^image\/(png|jpeg|gif|webp)$/.test(file.mime)) continue;
        const old = this.state.avatars[p.identity];
        this.state.avatars[p.identity] = URL.createObjectURL(
          new Blob([new Uint8Array(file.bytes)], { type: file.mime }),
        );
        if (old) URL.revokeObjectURL(old);
        this.update();
        return;
      } catch {}
    }
  }
  async broadcastSource(destination) {
    const publication = [
      ...(this.c.room?.localParticipant.videoTrackPublications?.values() || []),
    ].find((p) => p.source === "screen_share");
    if (!publication) return;
    const surface =
      publication.track?.mediaStreamTrack?.getSettings?.().displaySurface;
    await this.send(
      {
        type: "stream-activity",
        version: 1,
        trackSid: publication.trackSid,
        source: {
          source_type: surface === "monitor" ? "monitor" : "browser",
          source_title: ["monitor", "window", "browser"].includes(surface)
            ? surface
            : "",
        },
      },
      destination,
    );
  }
  async chat(text, file) {
    const local = this.c.room.localParticipant;
    text = String(text || "")
      .trim()
      .slice(0, 6000);
    if (!text && !file) return;
    const message = {
      type: file ? "chat-file" : "chat-message",
      identity: local.identity,
      name: local.name || local.identity,
      text,
      room: this.c.state.room,
      timestamp: Date.now(),
      id: `${local.identity}-${Date.now()}-${crypto.randomUUID()}`,
    };
    if (file) {
      const data = await this.feature("chat-upload", {
        bytes: file.bytes,
        mime: file.type,
      });
      if (!data?.ok || !data.url) throw Error("Upload failed.");
      Object.assign(message, {
        fileUrl: data.url,
        fileName: file.name,
        fileType: file.type,
      });
    }
    // Persist first: a failed save must not create an apparently successful message.
    await this.feature("chat-save", message);
    if (!this.active) return;
    this.add(message);
    this.update();
    try {
      await this.send(message);
    } catch {
      throw Error(
        "Message saved; live delivery failed. Other clients can retrieve it from history.",
      );
    }
  }
  async remove(id) {
    const m = this.state.messages.find((m) => m.id === id);
    if (!m || m.identity !== this.c.room.localParticipant.identity)
      throw Error("You can delete only your own messages.");
    await this.feature("chat-delete", { id });
    if (!this.active) return;
    this.deleted.add(id);
    this.state.messages = this.state.messages.filter((m) => m.id !== id);
    this.update();
    await this.send({
      type: "chat-delete",
      id,
      identity: m.identity,
      room: this.c.state.room,
    });
  }
  dispose() {
    this.active = false;
    for (const url of Object.values(this.state.avatars))
      URL.revokeObjectURL(url);
    this.c.effects?.stop();
  }
}
