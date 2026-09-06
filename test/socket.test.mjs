import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import net from "node:net";
const { serve } = createRequire(import.meta.url)("../app/socket.cjs");
test("private socket streams state and rejects unknown commands", async () => {
  const dir = await mkdtemp(tmpdir() + "/echo-test-");
  const path = dir + "/test.sock";
  const bridge = serve(
    path,
    () => ({ status: "idle" }),
    () => {
      throw Error("Unknown command");
    },
  );
  await new Promise((r) => bridge.server.once("listening", r));
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  const request = (payload) =>
    new Promise((resolve, reject) => {
      const s = net.connect(path, () =>
        s.write(JSON.stringify(payload) + "\n"),
      );
      s.on("error", reject);
      s.once("data", (d) => {
        s.destroy();
        resolve(JSON.parse(d));
      });
    });
  assert.deepEqual(await request({ action: "watch" }), { status: "idle" });
  assert.equal((await request({ action: "bad" })).ok, false);
  await new Promise((r) => bridge.server.close(r));
  await rm(dir, { recursive: true });
});
