import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger, sanitize } from "../app/diagnostics.cjs";
test("diagnostics only retain approved values, never arbitrary text or credentials", () => {
  const secret = "https://private.example/?token=secret";
  assert.equal(sanitize("arbitrary." + secret, {}), null);
  assert.deepEqual(
    sanitize("audio.health", {
      state: secret,
      name: secret,
      token: secret,
      error: secret,
      pid: secret,
      bytesReceived: Infinity,
      audioTracks: 3,
      deafened: false,
    }),
    { event: "audio.health", audioTracks: 3, deafened: false },
  );
});
test("diagnostics rotate into one private backup and survive write failures", () => {
  const dir = mkdtempSync(join(tmpdir(), "echo-logs-"));
  try {
    const logger = createLogger(dir, 180);
    for (let n = 0; n < 10; n++)
      logger.write("audio.health", { audioTracks: n });
    assert.ok(statSync(logger.file).size <= 180);
    assert.ok(statSync(logger.file + ".1").size <= 180);
    assert.equal(statSync(logger.file).mode & 0o777, 0o600);
    assert.equal(statSync(logger.file + ".1").mode & 0o777, 0o600);
    assert.ok(readFileSync(logger.file, "utf8").includes("audio.health"));
    assert.doesNotThrow(() =>
      createLogger(join(logger.file, "invalid")).write("app.start"),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
