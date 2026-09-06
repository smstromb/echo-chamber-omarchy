const fs = require("node:fs");
const path = require("node:path");
// Only fixed event names and explicitly approved scalar fields reach disk.
// Never accept raw exceptions, URLs, device IDs, participant IDs or message text.
const events = new Set([
  "app.start",
  "app.quit",
  "process.gone",
  "renderer.unresponsive",
  "renderer.responsive",
  "system.suspend",
  "system.resume",
  "call.state",
  "audio.health",
  "audio.context",
  "audio.recovery.start",
  "audio.recovery.complete",
  "audio.recovery.failed",
  "audio.playback",
  "media.subscription.failed",
  "devices.changed",
  "operation.failed",
]);
const numbers = new Set([
  "pid",
  "exitCode",
  "participants",
  "audioTracks",
  "attached",
  "paused",
  "ended",
  "bytesReceived",
  "totalAudioEnergy",
  "concealedSamples",
  "jitter",
  "contextTime",
  "inputCount",
  "outputCount",
  "cameraCount",
]);
const booleans = new Set([
  "deafened",
  "micMuted",
  "canPlayback",
  "defaultOutput",
]);
const enums = {
  state: [
    "idle",
    "joining",
    "joined",
    "reconnecting",
    "leaving",
    "running",
    "suspended",
    "interrupted",
    "closed",
    "unavailable",
  ],
  reason: [
    "manual",
    "audio-service",
    "system-resume",
    "watchdog",
    "clean-exit",
    "abnormal-exit",
    "killed",
    "crashed",
    "oom",
    "launch-failed",
    "integrity-failure",
    "memory-eviction",
  ],
  process: ["Audio", "Utility", "GPU", "Renderer", "Unknown"],
  error: [
    "Error",
    "TypeError",
    "NotAllowedError",
    "NotFoundError",
    "NotReadableError",
    "AbortError",
    "InvalidStateError",
    "TimeoutError",
  ],
};
function sanitize(event, fields = {}) {
  if (!events.has(event) || !fields || typeof fields !== "object") return null;
  const safe = {};
  for (const [key, value] of Object.entries(fields)) {
    if (numbers.has(key) && typeof value === "number" && Number.isFinite(value))
      safe[key] = value;
    else if (booleans.has(key) && typeof value === "boolean") safe[key] = value;
    else if (enums[key]?.includes(value)) safe[key] = value;
    else if (
      ["version", "electron", "chrome"].includes(key) &&
      typeof value === "string" &&
      /^\d+(\.\d+){1,3}$/.test(value)
    )
      safe[key] = value;
  }
  return { event, ...safe };
}
function createLogger(directory, limit = 1024 * 1024) {
  const file = path.join(directory, "diagnostics.jsonl");
  let windowStart = 0,
    count = 0;
  return {
    file,
    write(event, fields) {
      const entry = sanitize(event, fields);
      if (!entry) return;
      const now = Date.now();
      if (now - windowStart >= 1000) {
        windowStart = now;
        count = 0;
      }
      if (++count > 30) return; // Bound event storms independently of rotation.
      try {
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
        const line =
          JSON.stringify({ time: new Date(now).toISOString(), ...entry }) +
          "\n";
        if (
          fs.existsSync(file) &&
          fs.statSync(file).size + Buffer.byteLength(line) > limit
        ) {
          fs.rmSync(file + ".1", { force: true });
          fs.renameSync(file, file + ".1");
        }
        fs.appendFileSync(file, line, { mode: 0o600 });
        fs.chmodSync(file, 0o600);
      } catch {
        /* A full or read-only disk must not interrupt a call. */
      }
    },
  };
}
module.exports = { createLogger, sanitize };
