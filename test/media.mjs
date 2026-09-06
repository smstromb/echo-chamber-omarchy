import { WebSocketServer } from "ws";
import { _electron as electron } from "playwright";
import { createServer, request } from "node:http";
import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { build } from "esbuild";
import assert from "node:assert/strict";
const dir = await mkdtemp("/tmp/echo-media-");
const secret = "secret";
function token(identity, name) {
  const enc = (x) => Buffer.from(JSON.stringify(x)).toString("base64url");
  const b =
    enc({ alg: "HS256", typ: "JWT" }) +
    "." +
    enc({
      iss: "devkey",
      sub: identity,
      name,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      video: {
        room: "main",
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      },
    });
  return b + "." + createHmac("sha256", secret).update(b).digest("base64url");
}
await writeFile(
  dir + "/livekit.yaml",
  "port: 17880\nbind_addresses: [127.0.0.1]\nrtc:\n  tcp_port: 17881\n  udp_port: 17882\n  use_external_ip: false\nkeys:\n  devkey: secret\n",
);
const livekit = spawn(
  process.env.LIVEKIT_SERVER || "/tmp/echo-livekit-test/livekit-server",
  ["--config", dir + "/livekit.yaml", "--dev"],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let logs = "";
livekit.stderr.on("data", (d) => (logs += d));
livekit.stdout.on("data", (d) => (logs += d));
const presence = new Map();
let heartbeatCount = 0;
const chatHistory = [];
let iceCount = 0;
const sockets = new WebSocketServer({ noServer: true });
let jamJoined = false,
  jamAuth = 0,
  jamFrames = 0;
const jamState = {
  jam_protocol_version: 3,
  generation: 1,
  active: false,
  starting: false,
  source_enabled: true,
  source_availability_known: true,
  source_status: "live",
  spotify_connected: true,
  spotify_is_playing: true,
  playback_stop_supported: true,
  spotify_device_name: "Windows source",
  queue: [],
  queue_revision: 1,
  now_playing: { name: "Test track", artist: "Test artist" },
};
const sounds = [
  { id: "test-sound", name: "Test chime", icon: "🔊", volume: 100 },
];
const wav = Buffer.alloc(44 + 4800 * 2);
wav.write("RIFF");
wav.writeUInt32LE(wav.length - 8, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(48000, 24);
wav.writeUInt32LE(96000, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(wav.length - 44, 40);
for (let i = 0; i < 4800; i++)
  wav.writeInt16LE(
    Math.round(Math.sin((i / 48000) * 440 * Math.PI * 2) * 4000),
    44 + i * 2,
  );
let uploadBytes;
sockets.on("connection", (ws) => {
  ws.once("message", (raw) => {
    const auth = JSON.parse(String(raw));
    assert.equal(auth.type, "auth");
    assert.ok(auth.token.split(".").length === 3);
    jamAuth++;
    ws.send(JSON.stringify({ type: "ready" }));
    const timer = setInterval(() => {
      const frame = new Float32Array(1920);
      for (let i = 0; i < frame.length; i++)
        frame[i] = Math.sin(i * 0.05) * 0.1;
      ws.send(frame);
      jamFrames++;
    }, 20);
    ws.once("close", () => clearInterval(timer));
  });
});
const server = createServer(async (req, res) => {
  if (!req.url.startsWith("/v1/") && !req.url.startsWith("/api/")) {
    const upstream = request(
      {
        hostname: "127.0.0.1",
        port: 17880,
        path: req.url,
        method: req.method,
        headers: req.headers,
      },
      (r) => {
        res.writeHead(r.statusCode, r.headers);
        r.pipe(res);
      },
    );
    upstream.on("error", () => res.writeHead(502).end());
    req.pipe(upstream);
    return;
  }
  const chunks = [];
  for await (const part of req) chunks.push(part);
  const raw = Buffer.concat(chunks);
  const binary = req.url.includes("/upload?");
  const body = binary ? {} : JSON.parse(raw.toString() || "{}");
  res.setHeader("Content-Type", "application/json");
  if (req.url.startsWith("/api/chat/upload?")) {
    uploadBytes = raw;
    res.end('{"ok":true,"url":"/api/chat/uploads/upload-test"}');
  } else if (req.url === "/api/chat/uploads/upload-test") {
    res.setHeader("Content-Type", "audio/wav");
    res.end(uploadBytes);
  } else if (req.url === "/api/soundboard/file/test-sound") {
    res.setHeader("Content-Type", "audio/wav");
    res.end(wav);
  } else if (req.url === "/api/soundboard/update") {
    Object.assign(sounds[0], body);
    res.end(JSON.stringify({ ok: true, sound: sounds[0] }));
  } else if (req.url.startsWith("/api/jam/") && req.url !== "/api/jam/state") {
    assert.equal(req.headers.authorization, "Bearer mock-admin");
    assert.ok(req.headers["x-echo-participant-token"]);
    if (req.url.endsWith("/start")) {
      jamState.active = true;
      jamState.host_identity = body.identity;
      jamJoined = true;
    }
    if (req.url.endsWith("/join")) jamJoined = true;
    if (req.url.endsWith("/leave")) jamJoined = false;
    if (req.url === "/api/jam/stop") {
      jamState.active = false;
      jamJoined = false;
    }
    if (req.url === "/api/jam/playback/stop")
      jamState.spotify_is_playing = false;
    if (req.url === "/api/jam/catalog/search")
      return res.end(
        JSON.stringify({
          items: [
            {
              spotify_uri: "spotify:track:123",
              name: "Search result",
              artist: "Artist",
              duration_ms: 2000,
            },
          ],
        }),
      );
    if (req.url === "/api/jam/queue") {
      jamState.queue.push({
        ...body,
        queue_entry_id: "entry-1",
        can_remove: true,
      });
      jamState.queue_revision++;
    }
    if (req.url === "/api/jam/queue/remove") {
      assert.equal(body.expected_queue_revision, jamState.queue_revision);
      jamState.queue = [];
      jamState.queue_revision++;
    }
    res.end(
      JSON.stringify({ ok: true, generation: 1, listener_joined: jamJoined }),
    );
  } else if (req.url === "/api/chat/history/main")
    res.end(JSON.stringify(chatHistory));
  else if (req.url === "/api/chat/message") {
    chatHistory.push(body);
    res.end("{}");
  } else if (req.url === "/api/chat/delete") {
    const i = chatHistory.findIndex((x) => x.id === body.id);
    if (i >= 0) chatHistory.splice(i, 1);
    res.end("{}");
  } else if (req.url === "/api/soundboard/list?roomId=main")
    res.end(JSON.stringify({ sounds }));
  else if (req.url === "/api/jam/state") res.end(JSON.stringify(jamState));
  else if (req.url === "/v1/ice-servers") {
    iceCount++;
    res.end('{"iceServers":[]}');
  } else if (req.url === "/api/online")
    res.end(JSON.stringify([{ name: "Sam", room: "main" }]));
  else if (req.url === "/v1/auth/login")
    res.end(JSON.stringify({ token: "mock-admin", expires_in_seconds: 3600 }));
  else if (req.url === "/v1/auth/token") {
    presence.set(body.identity, body);
    res.end(
      JSON.stringify({
        token: token(body.identity, body.name),
        expires_in_seconds: 3600,
      }),
    );
  } else if (req.url === "/v1/participants/heartbeat") {
    heartbeatCount++;
    res.end("{}");
  } else if (req.url === "/v1/participants/leave") {
    presence.delete(body.identity);
    res.writeHead(204).end();
  } else res.writeHead(404).end("{}");
});
server.on("upgrade", (req, socket, head) => {
  if (req.url.startsWith("/api/jam/audio?")) {
    const url = new URL(req.url, "http://localhost");
    assert.equal(url.searchParams.get("jam_protocol_version"), "3");
    assert.equal(url.searchParams.get("generation"), "1");
    assert.equal(url.searchParams.has("token"), false);
    sockets.handleUpgrade(req, socket, head, (ws) =>
      sockets.emit("connection", ws),
    );
    return;
  }
  const upstream = request({
    hostname: "127.0.0.1",
    port: 17880,
    path: req.url,
    headers: req.headers,
  });
  upstream.on("upgrade", (res, peer, uphead) => {
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        Object.entries(res.headers)
          .map(([k, v]) => k + ": " + v)
          .join("\r\n") +
        "\r\n\r\n",
    );
    if (uphead.length) socket.write(uphead);
    if (head.length) peer.write(head);
    peer.pipe(socket);
    socket.pipe(peer);
    peer.on("error", () => socket.destroy());
    socket.on("error", () => peer.destroy());
  });
  upstream.on("error", () => socket.destroy());
  upstream.end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = "http://127.0.0.1:" + server.address().port;
let app;
try {
  for (let i = 0; i < 50; i++) {
    try {
      await fetch("http://127.0.0.1:17880");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  await build({
    entryPoints: ["test/media-peer.js"],
    bundle: true,
    outfile: dir + "/peer.js",
    format: "iife",
  });
  await writeFile(
    dir + "/peer.html",
    '<html><body><script src="peer.js"></script></body></html>',
  );
  app = await electron.launch({
    args: [
      ".",
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
    env: {
      ...process.env,
      ECHO_USER_DATA: dir + "/profile",
      ECHO_SOCKET_PATH: dir + "/control.sock",
    },
  });
  const page = await app.firstWindow();
  await page.addInitScript(() => {
    window.testGains = [];
    const resume = AudioContext.prototype.resume;
    AudioContext.prototype.resume = async function (...args) {
      await resume.apply(this, args);
      await new Promise((r) => setTimeout(r, 500));
    };
    const create = AudioContext.prototype.createGain;
    AudioContext.prototype.createGain = function (...args) {
      const node = create.apply(this, args);
      window.testGains.push(node);
      return node;
    };
  });
  await page.reload();
  const errors = [];
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.error("Renderer:", e.message);
  });
  await page.getByLabel("Server address").fill(origin);
  await page.getByLabel("Your name", { exact: true }).fill("Linux test");
  await page.getByLabel("Room password").fill("test");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const nextWindow = app.waitForEvent("window");
  await app.evaluate(async ({ BrowserWindow }, file) => {
    const win = new BrowserWindow({
      show: false,
      webPreferences: { backgroundThrottling: false },
    });
    await win.loadFile(file);
  }, dir + "/peer.html");
  const peer = await nextWindow;
  await peer.evaluate(
    async ({ url, token, screenToken }) =>
      window.connectPeer(url, token, screenToken),
    {
      url: origin.replace("http", "ws"),
      token: token("sam", "Sam"),
      screenToken: token("sam$screen", "Sam screen"),
    },
  );
  await page.getByRole("button", { name: "Join Main" }).click();
  await page.getByText("● Connected", { exact: true }).waitFor();
  const sam = page.locator('article[data-identity="sam"]');
  await sam.getByLabel("Speaking", { exact: true }).waitFor({ timeout: 20000 });
  await sam.getByLabel("Sharing screen", { exact: true }).waitFor();
  await page.waitForFunction(() =>
    [...document.querySelectorAll("video")].some((v) => v.videoWidth >= 320),
  );
  await page
    .getByRole("button", { name: "Hide Sam screen screen", exact: true })
    .click();
  await page.getByRole("button", { name: "Show", exact: true }).waitFor();
  await page.getByRole("button", { name: "Show", exact: true }).click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll("video")].some(
      (v) => !v.hidden && v.videoWidth >= 320,
    ),
  );
  await sam.getByRole("button", { name: "Mute Sam", exact: true }).click();
  await sam.getByRole("button", { name: "Unmute Sam", exact: true }).waitFor();
  await sam.getByRole("button", { name: "Sam audio controls" }).click();
  await page.waitForFunction(() =>
    window.testGains.some((a) => a.gain.value < 0.001),
  );
  const slider = sam.getByRole("slider", {
    name: "Sam voice volume",
    exact: true,
  });
  await slider.fill("31");
  await slider.dispatchEvent("change");
  await sam.getByRole("button", { name: "Unmute Sam", exact: true }).click();
  await page.waitForFunction(() =>
    window.testGains.some((a) => Math.abs(a.gain.value - 0.31) < 0.01),
  );
  await page.getByRole("button", { name: "Unmute mic", exact: true }).click();
  await peer.waitForFunction(() =>
    [...window.peerRooms[0].remoteParticipants.values()].some(
      (p) => p.isMicrophoneEnabled,
    ),
  );
  await slider.fill("170");
  await slider.dispatchEvent("change");
  await page.waitForFunction(() =>
    window.testGains.some((g) => Math.abs(g.gain.value - 1.7) < 0.01),
  );
  await page
    .getByRole("button", { name: "Turn camera on", exact: true })
    .click();
  await peer.waitForFunction(() =>
    [...window.peerRooms[0].remoteParticipants.values()].some(
      (p) => p.isCameraEnabled,
    ),
  );
  await page.waitForFunction(() =>
    [...document.querySelectorAll("video")].some(
      (v) => v.muted && v.videoWidth > 0,
    ),
  );
  await page
    .getByRole("button", { name: "Turn camera off", exact: true })
    .click();
  await peer.waitForFunction(() =>
    [...window.peerRooms[0].remoteParticipants.values()].every(
      (p) => !p.isCameraEnabled,
    ),
  );
  assert.equal(
    await page.getByRole("button", { name: "Focus You camera" }).count(),
    0,
  );
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Hello from Linux");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await peer.waitForFunction(() =>
    window.receivedData.some((x) => x.message.text === "Hello from Linux"),
  );
  assert.equal(chatHistory[0].text, "Hello from Linux");
  await peer.evaluate(() =>
    window.peerRooms[0].localParticipant.publishData(
      new TextEncoder().encode(
        JSON.stringify({
          type: "chat-message",
          id: "sam-123",
          identity: "sam",
          name: "Sam",
          text: "Hello from Windows protocol",
          timestamp: Date.now(),
          room: "main",
        }),
      ),
      { reliable: true },
    ),
  );
  await page
    .getByText("Hello from Windows protocol", { exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Delete message", exact: true })
    .click();
  await peer.waitForFunction(() =>
    window.receivedData.some((x) => x.message.type === "chat-delete"),
  );
  assert.equal(chatHistory.length, 0);
  await page.getByRole("button", { name: "Toggle PG-13 mode" }).click();
  await peer.waitForFunction(() =>
    window.receivedData.some(
      (x) => x.message.type === "pg13-mode" && x.message.enabled,
    ),
  );
  assert.equal(iceCount, 1);
  await page
    .locator("#chat-file")
    .setInputFiles({ name: "clip.wav", mimeType: "audio/wav", buffer: wav });
  await page.getByRole("button", { name: "clip.wav", exact: true }).waitFor();
  assert.deepEqual(uploadBytes, wav);
  await page.getByRole("button", { name: "clip.wav", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector(".attachment-preview audio")?.readyState >= 2,
  );
  await page.getByRole("button", { name: "Soundboard", exact: true }).click();
  await page.locator('[data-play="test-sound"]').click();
  await peer.waitForFunction(() =>
    window.receivedData.some((x) => x.message.type === "sound-play"),
  );
  await page.getByRole("button", { name: "Edit Test chime" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Renamed chime");
  await page
    .locator(".sound-editor")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await peer.waitForFunction(() =>
    window.receivedData.some(
      (x) =>
        x.message.type === "sound-updated" &&
        x.message.sound.name === "Renamed chime",
    ),
  );
  await page.getByRole("button", { name: "Jam", exact: true }).click();
  await page.getByRole("button", { name: "Start Jam", exact: true }).click();
  await page
    .getByRole("button", { name: "Leave Jam", exact: true })
    .first()
    .waitFor();
  await page.waitForFunction(
    () => document.querySelector("#jam-artist").textContent === "Test artist",
  );
  assert.equal(jamJoined, true);
  assert.ok(jamAuth > 0);
  await page
    .getByRole("textbox", { name: "Search music", exact: true })
    .fill("search");
  await page.getByRole("button", { name: "Search music", exact: true }).click();
  await page.getByRole("button", { name: "Queue Search result" }).click();
  await page.getByRole("button", { name: "Remove Search result" }).waitFor();
  assert.equal(jamState.queue.length, 1);
  await page.getByRole("button", { name: "Remove Search result" }).click();
  await page.waitForFunction(
    () => !document.querySelector('[data-remove="entry-1"]'),
  );
  assert.equal(jamState.queue.length, 0);
  await page.getByRole("button", { name: "Stop music for everyone" }).click();
  await peer.waitForFunction(() =>
    window.receivedData.some((x) => x.message.type === "jam-playback-stopped"),
  );
  assert.equal(jamState.active, true);
  assert.equal(jamState.spotify_is_playing, false);
  await page.getByRole("button", { name: "End Jam for everyone" }).click();
  await page.getByRole("button", { name: "End Jam", exact: true }).click();
  await page.getByRole("button", { name: "Start Jam", exact: true }).waitFor();
  assert.equal(jamJoined, false);
  assert.ok(jamFrames > 0);
  await page.getByRole("button", { name: "Audio", exact: true }).click();
  await page.getByLabel("Microphone", { exact: true }).selectOption("default");
  await page.getByLabel("Noise suppression", { exact: true }).uncheck();
  await page.screenshot({ path: "artifacts/live-audio-settings.png" });
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/live-media.png" });
  await page.getByRole("button", { name: "Leave room" }).click();
  await page.getByText("Signed in", { exact: true }).waitFor();
  assert.equal(presence.size, 0);
  await page.reload();
  await page.getByText("Signed in", { exact: true }).waitFor();
  assert.equal(await page.locator("#setup").evaluate((el) => el.open), false);
  assert.ok(heartbeatCount > 0);
  assert.deepEqual(errors, []);
  console.log(
    "Live media, camera, chat/files, soundboard and Jam integration PASS: real SFU join, received audio/video, speaker detection, companion share badge, local audio gain/mute, microphone publishing and leave presence cleanup.",
  );
} catch (e) {
  if (app) {
    const page = await app.firstWindow();
    console.error(await page.locator("body").innerText());
    console.error(
      await page.evaluate(() => ({
        videos: [...document.querySelectorAll("video")].map((v) => ({
          w: v.videoWidth,
          paused: v.paused,
          ready: v.readyState,
        })),
        gains: window.testGains?.map((g) => g.gain.value),
      })),
    );
    await page.screenshot({ path: "artifacts/media-failure.png" });
  }
  console.error(logs.slice(-1000));
  throw e;
} finally {
  if (app) await app.close();
  server.closeAllConnections();
  server.close();
  for (const ws of sockets.clients) ws.terminate();
  sockets.close();
  livekit.kill();
  await rm(dir, { recursive: true, force: true });
}
