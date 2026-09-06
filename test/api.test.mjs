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

test("login cooldown is shared by candidate clients and honors Retry-After", async () => {
  let requests = 0;
  const config = { server: "https://example.com" };
  const api = new EchoAPI(config, async () => {
    requests++;
    return new Response("{}", {
      status: 429,
      headers: { "Retry-After": "60" },
    });
  });
  const candidate = new EchoAPI(config, api.fetch, api.authState);
  await assert.rejects(
    candidate.login("test"),
    (e) => e.status === 429 && e.retryAt > Date.now() + 58000,
  );
  await assert.rejects(api.login("test"), (e) => e.status === 429);
  assert.equal(requests, 1);
  api.loginLimit().retryAt = Date.now() - 1;
  await assert.rejects(api.login("test"), (e) => e.status === 429);
  assert.equal(requests, 2);
});
test("missing Retry-After uses a conservative 15-minute cooldown; non-login 429 is not mislabeled", async () => {
  const api = new EchoAPI(
    { server: "https://example.com" },
    async () => new Response("{}", { status: 429 }),
  );
  await assert.rejects(
    api.login("test"),
    (e) => e.retryAt > Date.now() + 899000,
  );
  await assert.rejects(api.request("/api/jam/state"), /Too many requests/);
});
test("background auth stops retrying a rejected password, while explicit corrected sign-in remains available", async () => {
  let logins = 0;
  const api = new EchoAPI(
    { server: "https://example.com" },
    async (url, options) => {
      if (!url.endsWith("/login")) return new Response("{}", { status: 401 });
      logins++;
      return new Response(JSON.stringify({ token: "new" }), {
        status: JSON.parse(options.body).password === "correct" ? 200 : 401,
      });
    },
  );
  api.admin = "expired";
  api.password = "wrong";
  for (let n = 0; n < 3; n++)
    await assert.rejects(api.authenticated("/api/jam/state"));
  assert.equal(logins, 1);
  await api.login("correct");
  assert.equal(logins, 2);
  assert.equal(api.password, "correct");
});
test("simultaneous authentication refreshes share one login request", async () => {
  let requests = 0,
    release;
  const api = new EchoAPI({ server: "https://example.com" }, async () => {
    requests++;
    await new Promise((r) => {
      release = r;
    });
    return new Response(JSON.stringify({ token: "new" }));
  });
  const a = api.login("test"),
    b = api.login("test");
  release();
  await Promise.all([a, b]);
  assert.equal(requests, 1);
});
test("Retry-After HTTP dates are honored", async () => {
  const deadline = Date.now() + 60000;
  const api = new EchoAPI(
    { server: "https://example.com" },
    async () =>
      new Response("{}", {
        status: 429,
        headers: { "Retry-After": new Date(deadline).toUTCString() },
      }),
  );
  await assert.rejects(
    api.login("test"),
    (e) => e.retryAt > deadline - 1000 && e.retryAt <= deadline,
  );
});

test("Retry-After zero uses a short local guard instead of the fallback lockout", async () => {
  const api = new EchoAPI(
    { server: "https://example.com" },
    async () =>
      new Response("{}", { status: 429, headers: { "Retry-After": "0" } }),
  );
  await assert.rejects(
    api.login("test"),
    (e) => e.retryAt > Date.now() && e.retryAt <= Date.now() + 1000,
  );
});
