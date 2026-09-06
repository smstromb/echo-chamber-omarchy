const { randomUUID, randomBytes, createHash } = require("node:crypto");
function serverURL(value) {
  const u = new URL(value);
  if (
    !["https:", "http:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    u.pathname !== "/"
  )
    throw Error("Use a server origin, such as https://echo.example:9443");
  if (
    u.protocol === "http:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)
  )
    throw Error("Use HTTPS for remote servers.");
  return u.origin;
}
class EchoAPI {
  constructor(config, fetcher = fetch, authState = new Map()) {
    this.config = config;
    this.authState = authState;
    this.adminExpires = 0;
    this.fetch = fetcher;
    this.admin = "";
    this.password = "";
    this.token = "";
    this.expires = 0;
    this.room = "";
  }
  async request(path, body, token, extraHeaders = {}) {
    const response = await this.fetch(this.config.server + path, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        ...extraHeaders,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
      redirect: "error",
    });
    if (!response.ok) {
      const e = Error(
        {
          401: "Password or session is no longer valid. Sign in again.",
          409: "That name is already connected. Choose another name.",
          429:
            path === "/v1/auth/login"
              ? "Too many login attempts. Wait before trying again."
              : "Too many requests. Wait before trying again.",
        }[response.status] || `Server request failed (${response.status})`,
      );
      e.status = response.status;
      if (response.status === 429) {
        const retry = response.headers.get("retry-after");
        const seconds =
          retry && /^\d+$/.test(retry.trim()) ? Number(retry) : NaN;
        const deadline = Number.isFinite(seconds)
          ? Date.now() + seconds * 1000
          : Date.parse(retry);
        if (Number.isFinite(deadline))
          e.retryAt = Math.max(Date.now() + 1000, deadline);
      }
      throw e;
    }
    return response.status === 204 ||
      response.headers.get("content-length") === "0"
      ? null
      : response.json();
  }
  loginLimit() {
    const origin = this.config.server;
    if (!this.authState.has(origin))
      this.authState.set(origin, { retryAt: 0, rejected: new Set() });
    return this.authState.get(origin);
  }
  async login(password, { automatic = false } = {}) {
    const limit = this.loginLimit();
    const fingerprint = createHash("sha256").update(password).digest("hex");
    if (limit.retryAt > Date.now())
      throw Object.assign(
        Error("Too many login attempts. Wait before trying again."),
        { status: 429, retryAt: limit.retryAt },
      );
    if (automatic && limit.rejected.has(fingerprint))
      throw Object.assign(
        Error("Saved password was rejected. Enter the current room password."),
        { status: 401 },
      );
    if (limit.pending && limit.pending.fingerprint !== fingerprint)
      throw Error("Sign-in is already in progress.");
    if (!limit.pending) {
      const pending = { fingerprint };
      pending.promise = this.request("/v1/auth/login", { password })
        .then((data) => {
          limit.retryAt = 0;
          limit.rejected.clear();
          return data;
        })
        .catch((error) => {
          if (error.status === 401) limit.rejected.add(fingerprint);
          if (error.status === 429) {
            // Upstream omits Retry-After. Use a conservative local delay;
            // the server's actual remaining window can be shorter.
            limit.retryAt = error.retryAt || Date.now() + 15 * 60 * 1000;
            error.retryAt = limit.retryAt;
          }
          throw error;
        })
        .finally(() => {
          if (limit.pending === pending) limit.pending = null;
        });
      limit.pending = pending;
    }
    const data = await limit.pending.promise;
    this.admin = data.token;
    this.adminExpires =
      data.expires_in_seconds > 0
        ? Date.now() + data.expires_in_seconds * 1000
        : Infinity;
    this.password = password;
    return { ok: true };
  }
  async issue(room) {
    const body = {
      room,
      identity: this.config.identity,
      name: this.config.name,
      participantAuthKey: this.config.participantAuthKey,
    };
    let data;
    try {
      data = await this.request("/v1/auth/token", body, this.admin);
    } catch (e) {
      if (e.status !== 401 || !this.password) throw e;
      await this.login(this.password, { automatic: true });
      data = await this.request("/v1/auth/token", body, this.admin);
    }
    this.token = data.token;
    this.expires = Date.now() + data.expires_in_seconds * 1000;
    this.room = room;
    return {
      token: this.token,
      url: this.config.server.replace(/^http/, "ws"),
    };
  }
  async heartbeat() {
    if (!this.token) return;
    if (this.expires - Date.now() < 120000) await this.issue(this.room);
    return this.request(
      "/v1/participants/heartbeat",
      {
        room: this.room,
        identity: this.config.identity,
        name: this.config.name,
        viewer_version: "omarchy-0.1.0",
      },
      this.token,
    );
  }
  async leave() {
    const token = this.token;
    this.token = "";
    this.room = "";
    if (token)
      await this.request(
        "/v1/participants/leave",
        { identity: this.config.identity },
        token,
      );
  }
  async authenticated(path, body, participant = false) {
    if (!(participant ? this.token : this.admin))
      throw Error("Sign in and join a room first.");
    try {
      return await this.request(
        path,
        body,
        participant ? this.token : this.admin,
      );
    } catch (e) {
      if (e.status !== 401 || participant || !this.password) throw e;
      await this.login(this.password, { automatic: true });
      return this.request(path, body, this.admin);
    }
  }
  async ice() {
    const data = await this.authenticated("/v1/ice-servers");
    if (!Array.isArray(data?.iceServers))
      throw Error("Invalid ICE server configuration.");
    return data.iceServers;
  }
  async binary(path, { bytes, mime, participant = false } = {}) {
    // Only application-owned endpoints; never forward credentials to message URLs.
    if (
      !/^\/api\/(chat\/(uploads\/[^/?]+|upload\?room=[^/]+)|soundboard\/(file\/[^/?]+|upload\?[^/]+)|avatar\/[^/]+|chime\/(upload\?[^/]+|[^/]+\/(enter|exit)(\?.*)?))$/.test(
        path,
      )
    )
      throw Error("Unsupported media path.");
    if (path.includes("..") || path.includes("\\"))
      throw Error("Invalid media path.");
    if (bytes && bytes.byteLength > 50 * 1024 * 1024)
      throw Error("File exceeds 50 MB.");
    const response = await this.fetch(this.config.server + path, {
      method: bytes ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${participant ? this.token : this.admin}`,
        "Content-Type": mime || "application/octet-stream",
      },
      body: bytes ? Buffer.from(bytes) : undefined,
      signal: AbortSignal.timeout(60000),
      redirect: "error",
    });
    if (!response.ok)
      throw Object.assign(Error(`Media request failed (${response.status})`), {
        status: response.status,
      });
    if (bytes) return response.json();
    const length = Number(response.headers.get("content-length"));
    if (length > 50 * 1024 * 1024) throw Error("File exceeds 50 MB.");
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > 50 * 1024 * 1024) throw Error("File exceeds 50 MB.");
      chunks.push(Buffer.from(chunk));
    }
    return {
      bytes: Buffer.concat(chunks),
      mime: response.headers.get("content-type") || "application/octet-stream",
    };
  }
  feature(name, args = {}) {
    const room = encodeURIComponent(this.room);
    switch (name) {
      case "avatar-upload":
        return this.binary(
          `/api/avatar/upload?identity=${encodeURIComponent(this.config.identity)}`,
          args,
        );
      case "chime-upload":
        if (!["enter", "exit"].includes(args.kind))
          throw Error("Invalid chime kind.");
        return this.binary(
          `/api/chime/upload?identity=${encodeURIComponent(this.config.identity)}&kind=${args.kind}`,
          args,
        );
      case "chime-delete":
        if (!["enter", "exit"].includes(args.kind))
          throw Error("Invalid chime kind.");
        return this.authenticated("/api/chime/delete", {
          identity: this.config.identity,
          kind: args.kind,
        });
      case "jam-state":
        return this.authenticated("/api/jam/state");
      case "jam-credentials":
        if (!this.token) throw Error("Join a room first.");
        return {
          url: this.config.server.replace(/^http/, "ws") + "/api/jam/audio",
          token: this.token,
        };
      case "jam-action": {
        if (!this.token || !this.admin) throw Error("Join a room first.");
        const routes = {
          join: "join",
          leave: "leave",
          start: "start",
          end: "stop",
          pause: "playback/stop",
          skip: "skip",
          add: "queue",
          remove: "queue/remove",
          search: "catalog/search",
        };
        if (!routes[args.action]) throw Error("Unsupported Jam action.");
        return this.request(
          "/api/jam/" + routes[args.action],
          { ...args.body, identity: this.config.identity },
          this.admin,
          { "X-Echo-Participant-Token": this.token },
        );
      }
      case "chat-history":
        return this.authenticated(`/api/chat/history/${room}`);
      case "chat-save":
        return this.authenticated("/api/chat/message", {
          ...args,
          room: this.room,
          identity: this.config.identity,
          name: this.config.name,
        });
      case "chat-delete":
        return this.authenticated("/api/chat/delete", {
          id: args.id,
          room: this.room,
          identity: this.config.identity,
        });
      case "chat-upload":
        return this.binary(`/api/chat/upload?room=${room}`, args);
      case "media-file":
        return this.binary(args.path, { participant: true });
      case "sounds":
        return this.authenticated(
          `/api/soundboard/list?roomId=${room}`,
          undefined,
          true,
        );
      case "sound-upload":
        return this.binary(
          `/api/soundboard/upload?${new URLSearchParams({ roomId: this.room, name: String(args.name).slice(0, 60), icon: String(args.icon || "🔊").slice(0, 16), volume: String(Math.max(0, Math.min(200, Number(args.volume) || 100))) })}`,
          { ...args, participant: true },
        );
      case "sound-update":
        return this.authenticated(
          "/api/soundboard/update",
          {
            roomId: this.room,
            soundId: args.id,
            name: String(args.name).slice(0, 60),
            icon: String(args.icon || "🔊").slice(0, 16),
            volume: Math.max(0, Math.min(200, Number(args.volume) || 0)),
          },
          true,
        );
      default:
        throw Error("Unknown feature operation");
    }
  }
  online() {
    return this.request("/api/online");
  }
}
function defaults() {
  return {
    server: "",
    name: "",
    room: "main",
    identity: `linux-${randomUUID()}`,
    participantAuthKey: randomBytes(32).toString("hex"),
    mix: {},
  };
}
module.exports = { EchoAPI, serverURL, defaults };
