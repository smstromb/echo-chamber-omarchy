import { Room, RoomEvent, Track } from "livekit-client";
import { JamClient } from "./jam.js";
import { RoomData, identityBase } from "./room-data.js";
import { Effects } from "./effects.js";
import { AudioPlayback } from "./audio-playback.js";
import { people, parentIdentity, volume } from "./model.js";
export class Controller {
  constructor(api, emit, attach, createRoom = (options) => new Room(options)) {
    this.createRoom = createRoom;
    this.api = api;
    this.emit = emit;
    this.attach = attach;
    this.room = null;
    this.preferences = {};
    this.effects = new Effects(this);
    this.mix = {};
    this.queue = Promise.resolve();
    this.joinEpoch = 0;
    this.watchIntent = new Map();
    this.pollBusy = false;
    this.heartBusy = false;
    this.state = {
      status: "idle",
      room: "main",
      participants: [],
      online: [],
      error: "",
      onlineError: "",
      micMuted: true,
      deafened: false,
      sharing: false,
      signedIn: false,
      configured: false,
    };
  }
  diagnostic(event, fields = {}) {
    globalThis.window?.echo?.diagnostic?.(event, fields);
  }
  publish() {
    if (this.room) {
      this.state.participants = people(
        [this.room.localParticipant, ...this.room.remoteParticipants.values()],
        this.mix,
      );
      this.state.micMuted = !this.room.localParticipant.isMicrophoneEnabled;
      this.state.sharing = this.room.localParticipant.isScreenShareEnabled;
      this.state.camera = this.room.localParticipant.isCameraEnabled;
      this.state.videos = [...this.room.remoteParticipants.values()].flatMap(
        (p) =>
          [...(p.videoTrackPublications?.values() || [])].map((pub) => ({
            identity: p.identity,
            sid: pub.trackSid,
            source: pub.source,
            muted: pub.isMuted,
            subscribed: pub.isSubscribed,
            enabled: pub.isEnabled,
            width: pub.track?.attachedElements?.[0]?.videoWidth || 0,
            height: pub.track?.attachedElements?.[0]?.videoHeight || 0,
          })),
      );
    }
    this.state.data = this.data?.state;
    this.state.jam = this.jamClient?.state;
    this.emit({ ...this.state });
  }
  async init() {
    const initial = await this.api("init");
    this.config = initial.config;
    this.demo = initial.demo;
    this.mix = this.config.mix || {};
    this.preferences = {
      chimes: true,
      chimeVolume: 40,
      soundVolume: 70,
      noiseSuppression: true,
      ...this.config.preferences,
    };
    this.state.room = this.config.room;
    this.initial = initial;
    this.state.configured = !!this.config.server || !!initial.demo;
    if (this.demo) {
      this.state.online = [
        { name: "Orbit", room: "main" },
        { name: "Pixel", room: "main" },
        { name: "Comet", room: "breakout-1" },
      ];
      this.config.name = "You";
      this.state.signedIn = true;
    } else if (initial.hasSessionPassword) {
      try {
        await this.api("login");
        this.state.signedIn = true;
      } catch (e) {
        this.state.error = e.message;
      }
    }
    this.publish();
    await this.poll();
    this.pollTimer = setInterval(() => this.poll(), 10000);
    this.heartTimer = setInterval(() => {
      this.heartbeat();
      this.jamClient?.refresh();
    }, 5000);
    this.activityTimer = setInterval(() => {
      if (this.room || (this.demo && this.state.status === "joined"))
        this.publish();
    }, 200);
    if (globalThis.navigator?.mediaDevices) {
      navigator.mediaDevices.addEventListener("devicechange", () =>
        this.refreshDevices(true).catch((e) => {
          this.state.error = e.message;
          this.publish();
        }),
      );
      await this.refreshDevices();
    }
    return initial;
  }
  async poll() {
    if (this.demo || !this.config?.server || this.pollBusy) return;
    this.pollBusy = true;
    try {
      const online = await this.api("online");
      if (!Array.isArray(online)) throw Error("Unexpected roster response.");
      this.state.online = online;
      this.state.onlineError = "";
    } catch (e) {
      this.state.online = [];
      this.state.onlineError = e.message;
    } finally {
      this.pollBusy = false;
      this.publish();
    }
  }
  async heartbeat() {
    if (!this.room || this.state.status !== "joined" || this.heartBusy) return;
    this.heartBusy = true;
    try {
      // Upstream `stale` compares its hosted viewer asset stamp, not this independent client.
      await this.api("heartbeat");
      if (this.state.error.startsWith("Presence:")) this.state.error = "";
    } catch (e) {
      if (this.room) this.state.error = "Presence: " + e.message;
    } finally {
      this.heartBusy = false;
      this.publish();
    }
  }
  command(c) {
    if (["join", "leave", "signout"].includes(c.action)) {
      c = { ...c, epoch: ++this.joinEpoch };
      this.joinAbort?.abort();
    }
    const run = this.queue.then(async () => {
      this.state.error = "";
      try {
        await this.execute(c);
      } catch (e) {
        if (e.name === "AbortError") return;
        this.state.error = e.message;
        throw e;
      } finally {
        this.publish();
      }
    });
    this.queue = run.catch(() => {});
    return run;
  }
  async execute(c) {
    if (c.action === "recover-audio") {
      if (!this.room) throw Error("Join a room first.");
      await this.audioPlayback?.recover(c.reason || "manual");
      return;
    }
    if (c.action === "retry-video") {
      const room = this.room;
      const publications = [...(room?.remoteParticipants.values() || [])]
        .filter((p) => parentIdentity(p.identity) === c.identity)
        .flatMap((p) =>
          [...p.videoTrackPublications.values()].map((pub) => ({ p, pub })),
        );
      if (!publications.length)
        throw Error("That screen is no longer being shared.");
      publications.forEach(({ pub }) => pub.setSubscribed(false));
      await new Promise((r) => setTimeout(r, 300));
      if (this.room !== room) return;
      publications.forEach(({ p, pub }) => {
        if (
          room.remoteParticipants.get(p.identity) === p &&
          p.videoTrackPublications.get(pub.trackSid) === pub
        )
          pub.setSubscribed(true);
      });
    } else if (c.action === "watch-video") {
      for (const p of this.room?.remoteParticipants.values() || []) {
        const pub = p.videoTrackPublications.get(c.sid);
        if (pub) {
          this.watchIntent.set(p.identity + ":" + pub.source, !!c.enabled);
          pub.setEnabled(!!c.enabled);
          return;
        }
      }
      throw Error("That video is no longer available.");
    } else if (c.action === "profile") {
      if (!this.data) throw Error("Join a room first.");
      const result = await this.data.feature(c.operation, c);
      if (result?.ok === false)
        throw Error(result.error || "Profile could not be saved.");
      if (c.operation === "avatar-upload") {
        await this.data.loadAvatar(this.room.localParticipant);
        await this.data.send({
          type: "avatar-update",
          identityBase: identityBase(this.room.localParticipant.identity),
          avatarUrl: "/api/avatar/" + encodeURIComponent(this.config.deviceId),
        });
      }
      this.effects.cache.clear();
    } else if (c.action === "jam") {
      if (!this.jamClient) throw Error("Join a room first.");
      await this.jamClient.action(c.operation, c.body);
    } else if (
      [
        "chat-send",
        "chat-delete",
        "sound-play",
        "sound-save",
        "pg13",
        "refresh-data",
      ].includes(c.action)
    ) {
      if (!this.data || this.state.status !== "joined")
        throw Error("Join a room first.");
      if (c.action === "chat-send") await this.data.chat(c.text, c.file);
      if (c.action === "chat-delete") await this.data.remove(c.id);
      if (c.action === "refresh-data") await this.data.load();
      if (c.action === "pg13") {
        this.data.state.pg13 = !!c.enabled;
        await this.data.send({
          type: "pg13-mode",
          enabled: !!c.enabled,
          senderName: this.config.name,
        });
      }
      if (c.action === "sound-play") {
        const sound = this.data.state.sounds.find((s) => s.id === c.id);
        if (!sound) throw Error("Sound no longer available.");
        await this.data.send({
          type: "sound-play",
          soundId: c.id,
          senderName: this.config.name,
          soundName: sound.name,
        });
        await this.effects.sound(c.id, this.data);
      }
      if (c.action === "sound-save") {
        const result = await this.data.feature(
          c.id ? "sound-update" : "sound-upload",
          c,
        );
        if (!result?.ok || !result.sound)
          throw Error(result?.error || "Sound could not be saved.");
        await this.data.load();
        await this.data.send({
          type: c.id ? "sound-updated" : "sound-added",
          sound: result.sound,
        });
      }
    } else if (c.action === "preferences") {
      const previous = { ...this.preferences };
      const next = { ...this.preferences, ...c.value };
      try {
        for (const kind of ["audioinput", "audiooutput", "videoinput"]) {
          if (next[kind] !== previous[kind] && this.room) {
            const ok = await this.room.switchActiveDevice(
              kind,
              next[kind] || "default",
            );
            if (!ok) throw Error("Device could not be selected.");
          }
        }
        if (next.noiseSuppression !== previous.noiseSuppression && this.room) {
          this.room.options.audioCaptureDefaults.noiseSuppression =
            !!next.noiseSuppression;
          const pub = this.room.localParticipant.getTrackPublication(
            Track.Source.Microphone,
          );
          if (pub?.track)
            await pub.track.restartTrack({
              noiseSuppression: !!next.noiseSuppression,
            });
        }
        this.preferences = next;
        this.jamClient?.sync();
        if (this.effects.ctx) await this.effects.context();
        await this.api("preferences", next);
      } catch (e) {
        this.preferences = previous;
        throw e;
      }
    } else if (c.action === "signout") {
      await this.leave();
      await this.api("signout");
      this.state.signedIn = false;
    } else if (c.action === "join") {
      if (c.epoch !== this.joinEpoch) return;
      if (
        this.state.status === "joined" &&
        (!c.room || c.room === this.state.room)
      )
        return;
      if (!this.state.signedIn)
        throw Error("Sign in in the app before joining.");
      await this.leave();
      if (c.epoch !== this.joinEpoch) return;
      const abort = new AbortController();
      this.joinAbort = abort;
      this.state.room = c.room || this.state.room;
      this.state.status = "joining";
      this.publish();
      if (this.demo) {
        this.state.status = "joined";
        this.state.participants = [
          {
            identity: "self",
            name: "You",
            self: true,
            volume: 100,
            micMuted: true,
          },
          {
            identity: "orbit",
            name: "Orbit",
            volume: 100,
            speaking: true,
            sharing: true,
          },
          { identity: "pixel", name: "Pixel", volume: 100 },
        ];
        return;
      }
      this.audioPlayback = new AudioPlayback(this);
      const room = this.createRoom({
        adaptiveStream: true,
        webAudioMix: this.audioPlayback.options(),
        audioOutput: { deviceId: this.preferences.audiooutput || "default" },
        videoCaptureDefaults: {
          deviceId: this.preferences.videoinput || "default",
        },
        dynacast: true,
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: this.preferences.noiseSuppression !== false,
          deviceId: this.preferences.audioinput || "default",
          autoGainControl: true,
        },
      });
      this.room = room;
      this.data = new RoomData(this);
      this.jamClient = new JamClient(this);
      const data = this.data;
      room.on(RoomEvent.DataReceived, (payload, p) => {
        if (this.room === room)
          data.receive(payload, p).catch((e) => {
            if (this.room === room) {
              this.state.error = e.message;
              this.publish();
            }
          });
      });
      room.on(RoomEvent.ParticipantConnected, (p) => {
        if (this.room !== room) return;
        if (parentIdentity(p.identity) === p.identity) {
          this.effects.chime("enter", p.identity).catch(() => {});
          data.announce(p.identity).catch(() => {});
        }
      });
      room.on(RoomEvent.ParticipantDisconnected, (p) => {
        if (this.room !== room) return;
        if (parentIdentity(p.identity) === p.identity)
          this.effects.chime("exit", p.identity).catch(() => {});
        data.activities.delete(p);
      });
      room.on(RoomEvent.LocalTrackPublished, (pub) => {
        if (this.room !== room) return;
        if (pub.track?.kind === "video")
          this.attach(pub.track, pub, room.localParticipant);
        if (pub.source === Track.Source.ScreenShare)
          data.broadcastSource().catch(() => {});
        this.refreshDevices().catch(() => {});
        this.publish();
      });
      room.on(RoomEvent.LocalTrackUnpublished, (pub) => {
        if (this.room !== room) return;
        if (pub.track) {
          pub.track.detach().forEach((el) => el.remove());
          this.attach(pub.track, pub, room.localParticipant, true);
        }
        this.publish();
      });
      room.on(RoomEvent.TrackPublished, (pub, p) => {
        if (
          this.room === room &&
          pub.kind === "video" &&
          (pub.source === Track.Source.ScreenShare ||
            parentIdentity(p.identity) !== p.identity)
        )
          this.effects.chime("share", p.identity).catch(() => {});
      });
      room.on(RoomEvent.TrackUnpublished, (pub, p) => {
        if (this.room !== room) return;
        if (
          pub.kind === "video" &&
          (pub.source === Track.Source.ScreenShare ||
            parentIdentity(p.identity) !== p.identity)
        )
          this.effects.chime("stop", p.identity).catch(() => {});
      });
      room.on(RoomEvent.AudioPlaybackStatusChanged, (canPlayback) => {
        if (this.room !== room) return;
        this.diagnostic("audio.playback", { canPlayback });
        this.state.audioError = canPlayback
          ? ""
          : "Audio playback interrupted. Restart audio from Audio settings.";
        this.publish();
      });
      room.on(RoomEvent.TrackSubscriptionFailed, (sid, p) => {
        if (this.room !== room) return;
        this.diagnostic("media.subscription.failed", {});
        this.state.error =
          "Media subscription failed" +
          (p?.name ? " for " + p.name : "") +
          ". Use Retry on the screen tile.";
        this.publish();
      });
      room.on(RoomEvent.TrackSubscribed, (track, pub, participant) => {
        if (this.room !== room) return;
        this.applyMix();
        if (
          track.kind === "video" &&
          this.watchIntent.get(participant.identity + ":" + pub.source) ===
            false
        )
          pub.setEnabled(false);
        this.attach(track, pub, participant);
        this.publish();
      });
      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        if (this.room !== room) return;
        track.detach().forEach((el) => el.remove());
        this.attach(track, null, null, true);
        this.publish();
      });
      room.on(RoomEvent.Reconnecting, () => {
        if (this.room === room) {
          this.state.status = "reconnecting";
          this.publish();
        }
      });
      room.on(RoomEvent.Reconnected, () => {
        if (this.room === room) {
          this.state.status = "joined";
          this.publish();
        }
      });
      room.on(RoomEvent.Disconnected, () => {
        if (this.room === room)
          this.command({ action: "lost", sourceRoom: room }).catch(() => {});
      });
      try {
        await this.audioPlayback.selectOutput();
        const credentials = await this.api("token", { room: this.state.room });
        let iceServers;
        try {
          iceServers = await this.api("ice");
        } catch (e) {
          this.state.error = "TURN configuration unavailable: " + e.message;
        }
        abort.signal.throwIfAborted();
        await Promise.race([
          room.connect(credentials.url, credentials.token, {
            rtcConfig: { ...(Array.isArray(iceServers) ? { iceServers } : {}) },
          }),
          new Promise((_, reject) =>
            abort.signal.addEventListener(
              "abort",
              () => reject(new DOMException("Join cancelled.", "AbortError")),
              { once: true },
            ),
          ),
        ]);
        abort.signal.throwIfAborted();
        await room.startAudio();
        // Join listening, then explicitly enable your mic. Never capture in the lobby.
        this.state.status = "joined";
        this.audioPlayback.start(room);
        await this.heartbeat();
        data.announce().catch(() => {});
        data.load().catch(() => {});
        for (const p of [
          room.localParticipant,
          ...room.remoteParticipants.values(),
        ])
          data.loadAvatar(p).catch(() => {});
        this.jamClient.refresh();
        this.joinAbort = null;
      } catch (e) {
        await this.leave();
        throw e;
      }
    } else if (c.action === "leave" || c.action === "lost") {
      if (c.action === "lost" && c.sourceRoom && c.sourceRoom !== this.room)
        return;
      await this.leave();
      if (c.action === "lost")
        this.state.error = "Connection ended. Select Join to reconnect.";
    } else if (c.action === "mute" || c.action === "volume") {
      const person = this.state.participants.find(
        (p) => p.identity === c.identity && !p.self,
      );
      if (!person) throw Error("That person is no longer in the room.");
      const setting = this.mix[c.identity] || { volume: 100, muted: false };
      setting.screenMuted ??= setting.muted ?? false;
      setting.screenVolume ??= setting.volume ?? 100;
      const buses =
        c.bus === "voice"
          ? ["voice"]
          : c.bus === "screen"
            ? ["screen"]
            : ["voice", "screen"];
      for (const bus of buses) {
        const muteKey = bus === "voice" ? "muted" : "screenMuted";
        const gainKey = bus === "voice" ? "volume" : "screenVolume";
        if (c.action === "mute")
          setting[muteKey] =
            typeof c.muted === "boolean"
              ? c.muted
              : !(setting[muteKey] ?? false);
        else setting[gainKey] = volume(c.value);
      }
      this.mix[c.identity] = setting;
      if (this.demo) {
        Object.assign(person, setting);
      } else {
        this.applyMix();
        await this.api("mix", this.mix);
      }
    } else if (c.action === "mic") {
      if (this.demo) {
        this.state.micMuted = !this.state.micMuted;
        const self = this.state.participants.find((p) => p.self);
        if (self) self.micMuted = this.state.micMuted;
        return;
      }
      if (!this.room) throw Error("Join a room first.");
      await this.room.localParticipant.setMicrophoneEnabled(
        !this.room.localParticipant.isMicrophoneEnabled,
      );
    } else if (c.action === "camera") {
      if (this.demo) {
        this.state.camera = !this.state.camera;
        return;
      }
      if (!this.room) throw Error("Join a room first.");
      await this.room.localParticipant.setCameraEnabled(
        !this.room.localParticipant.isCameraEnabled,
      );
    } else if (c.action === "deafen") {
      this.state.deafened = !this.state.deafened;
      this.applyMix();
    } else if (c.action === "share") {
      if (this.demo) {
        this.state.sharing = !this.state.sharing;
        return;
      }
      if (!this.room) throw Error("Join a room first.");
      await this.room.localParticipant.setScreenShareEnabled(
        !this.room.localParticipant.isScreenShareEnabled,
        { audio: false },
      );
    } else throw Error("Unknown action");
  }
  applyMix() {
    this.effects.sync();
    for (const p of this.room?.remoteParticipants.values() || []) {
      const setting = this.mix[parentIdentity(p.identity)] || {
        volume: 100,
        muted: false,
      };
      const voiceGain =
        this.state.deafened || setting.muted
          ? 0
          : (setting.volume ?? 100) / 100;
      const screenGain =
        this.state.deafened || (setting.screenMuted ?? setting.muted)
          ? 0
          : (setting.screenVolume ?? setting.volume ?? 100) / 100;
      p.setVolume(
        parentIdentity(p.identity) !== p.identity ? screenGain : voiceGain,
        Track.Source.Microphone,
      );
      p.setVolume(screenGain, Track.Source.ScreenShareAudio);
    }
  }
  async refreshDevices(fallback = false) {
    if (!globalThis.navigator?.mediaDevices) return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    this.diagnostic("devices.changed", {
      inputCount: devices.filter((d) => d.kind === "audioinput").length,
      outputCount: devices.filter((d) => d.kind === "audiooutput").length,
      cameraCount: devices.filter((d) => d.kind === "videoinput").length,
    });
    this.state.devices = devices.map((d) => ({
      kind: d.kind,
      deviceId: d.deviceId,
      label: d.label,
    }));
    if (fallback)
      for (const kind of ["audioinput", "audiooutput", "videoinput"]) {
        const id = this.preferences[kind];
        if (
          id &&
          id !== "default" &&
          !devices.some((d) => d.kind === kind && d.deviceId === id)
        ) {
          await this.command({
            action: "preferences",
            value: { [kind]: "default" },
          });
          this.state.error =
            "Selected device disconnected. Using system default.";
        }
      }
    this.publish();
  }
  async leave() {
    this.joinAbort?.abort();
    this.joinAbort = null;
    this.audioPlayback?.dispose();
    this.audioPlayback = null;
    this.state.audioError = "";
    const old = this.room;
    const jam = this.jamClient;
    this.jamClient = null;
    this.room = null;
    this.data?.dispose();
    this.data = null;
    this.watchIntent.clear();
    for (const p of [
      old?.localParticipant,
      ...(old?.remoteParticipants.values() || []),
    ]) {
      for (const pub of p?.trackPublications?.values() || []) {
        if (pub.track) {
          pub.track.detach().forEach((el) => el.remove());
          this.attach(pub.track, pub, p, true);
        }
      }
    }
    this.room = null;
    this.state.status = "leaving";
    this.state.participants = [];
    this.state.videos = [];
    this.publish();
    try {
      await Promise.all([old?.disconnect(), jam?.dispose()]);
    } finally {
      try {
        if (!this.demo) await this.api("leave");
      } finally {
        this.state.status = "idle";
        this.state.micMuted = true;
        this.state.sharing = false;
        this.state.camera = false;
        this.state.participants = [];
      }
    }
  }
}
