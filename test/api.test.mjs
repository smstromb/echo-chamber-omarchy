import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { EchoAPI, serverURL, defaults } = createRequire(import.meta.url)(
  "../app/api.cjs",
);
const response = (data) => ({
  ok: true,
  status: 200,
  headers: new Headers(),
  json: async () => data,
});
test("online preview is public and never requests a participant token", async () => {
  const calls = [];
  const api = new EchoAPI(
    { ...defaults(), server: "https://example.com" },
    async (...args) => {
      calls.push(args);
      return response([{ name: "Orbit", room: "main" }]);
    },
  );
  assert.equal((await api.online())[0].name, "Orbit");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "https://example.com/api/online");
  assert.equal(calls[0][1].headers.Authorization, undefined);
});
test("join, renewal, heartbeat and leave use the upstream API and installation binding", async () => {
  const calls = [];
  const config = {
    ...defaults(),
    server: "https://example.com",
    name: "Linux",
  };
  const api = new EchoAPI(config, async (url, options) => {
    calls.push({ url, ...options, body: JSON.parse(options.body || "null") });
    return response({
      token: url.endsWith("login") ? "admin" : "participant",
      expires_in_seconds: 3600,
    });
  });
  await api.login("password");
  const credentials = await api.issue("main");
  await api.heartbeat();
  await api.leave();
  assert.equal(credentials.url, "wss://example.com");
  assert.equal(calls[1].body.participantAuthKey, config.participantAuthKey);
  assert.equal(calls[2].headers.Authorization, "Bearer participant");
  assert.equal(calls[3].body.identity, config.identity);
  assert.equal(api.token, "");
  await api.heartbeat();
  assert.equal(calls.length, 4);
});
test("failed leave still clears credentials", async () => {
  const api = new EchoAPI(defaults(), async () => {
    throw Error("offline");
  });
  api.token = "old";
  await assert.rejects(api.leave());
  assert.equal(api.token, "");
});
test("rejects insecure remote or credential-bearing server addresses", () => {
  assert.equal(
    serverURL("https://example.com:9443/"),
    "https://example.com:9443",
  );
  assert.equal(serverURL("http://127.0.0.1:8091"), "http://127.0.0.1:8091");
  for (const u of [
    "http://example.com",
    "https://user:pass@example.com",
    "https://example.com/viewer/",
    "file:///tmp/x",
  ])
    assert.throws(() => serverURL(u));
});
test("ICE credentials are fetched with admin auth and Jam actions bind both identities", async () => {
  const calls = [];
  const api = new EchoAPI(
    { ...defaults(), server: "https://example.com" },
    async (url, options) => {
      calls.push({ url, ...options });
      return response({
        iceServers: [
          { urls: "turn:example.com", username: "u", credential: "p" },
        ],
      });
    },
  );
  api.admin = "admin";
  api.token = "participant";
  assert.equal((await api.ice())[0].urls, "turn:example.com");
  await api.feature("jam-action", {
    action: "join",
    body: { generation: 4, identity: "spoof" },
  });
  assert.equal(calls[1].headers["X-Echo-Participant-Token"], "participant");
  assert.equal(JSON.parse(calls[1].body).identity, api.config.identity);
  await assert.rejects(api.binary("https://attacker.example/x"), /Unsupported/);
  await assert.rejects(
    api.binary("/api/chat/uploads/../secret"),
    /Unsupported|Invalid/,
  );
});
