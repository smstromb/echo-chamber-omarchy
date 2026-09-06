import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const {
  canRemember,
  restorePassword,
  login,
} = require("../app/credentials.cjs");
const { EchoAPI } = require("../app/api.cjs");
function fixture() {
  const config = {
    server: "https://example.com",
    name: "You",
    secret: "c2VhbGVk",
  };
  const requests = [];
  const api = new EchoAPI(config, async (url, options) => {
    requests.push(url);
    return new Response(JSON.stringify({ token: "new-session" }), {
      status: JSON.parse(options.body).password === "valid" ? 200 : 401,
    });
  });
  api.password = "valid";
  api.admin = "old-session";
  let saved;
  const storage = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "gnome_libsecret",
    encryptString: () => Buffer.from("new-sealed"),
    decryptString: () => "valid",
  };
  return {
    config,
    api,
    requests,
    storage,
    persist: (value) => {
      saved = { ...value };
    },
    get saved() {
      return saved;
    },
  };
}
test("only real Linux keyrings enable password saving", () => {
  const f = fixture();
  for (const backend of ["basic_text", "unknown"]) {
    f.storage.getSelectedStorageBackend = () => backend;
    assert.equal(canRemember(f.storage, "linux"), false);
    assert.equal(restorePassword(f.config, f.storage), "");
  }
  f.storage.getSelectedStorageBackend = () => "gnome_libsecret";
  assert.equal(restorePassword(f.config, f.storage), "valid");
  f.storage.decryptString = () => {
    throw Error("locked");
  };
  assert.equal(restorePassword(f.config, f.storage), "");
});
test("failed replacement sign-in preserves saved credentials and connection", async () => {
  const f = fixture();
  await assert.rejects(
    login(f, {
      server: "https://other.example",
      name: "New",
      password: "invalid",
      remember: false,
    }),
  );
  assert.equal(f.config.server, "https://example.com");
  assert.equal(f.config.secret, "c2VhbGVk");
  assert.equal(f.api.password, "valid");
  assert.equal(f.api.admin, "old-session");
  assert.equal(f.saved, undefined);
});
test("renderer reauthentication preserves memory-only and remembered choices", async () => {
  const f = fixture();
  await login(f);
  assert.equal(f.saved.secret, "c2VhbGVk");
  delete f.config.secret;
  await login(f);
  assert.equal(f.saved.secret, undefined);
  assert.equal(f.api.password, "valid");
});
test("successful sign-in saves only encrypted credentials or explicitly forgets", async () => {
  const f = fixture();
  await login(f, { password: "valid", remember: true });
  assert.equal(f.saved.secret, Buffer.from("new-sealed").toString("base64"));
  assert.equal(JSON.stringify(f.saved).includes("valid"), false);
  await login(f, { password: "valid", remember: false });
  assert.equal(f.saved.secret, undefined);
  assert.equal(f.config.secret, undefined);
});
test("keyring and persistence failures are visible and preserve existing credentials", async () => {
  const f = fixture();
  f.storage.isEncryptionAvailable = () => false;
  await assert.rejects(
    login(f, { password: "valid", remember: true }),
    /keyring unavailable/,
  );
  assert.equal(f.requests.length, 0);
  f.storage.isEncryptionAvailable = () => true;
  f.storage.encryptString = () => {
    throw Error("locked");
  };
  await assert.rejects(
    login(f, { password: "valid", remember: true }),
    /Could not save/,
  );
  f.persist = () => {
    throw Error("disk full");
  };
  await assert.rejects(
    login(f, { password: "valid", remember: false }),
    /disk full/,
  );
  assert.equal(f.config.secret, "c2VhbGVk");
  assert.equal(f.api.admin, "old-session");
});
test("a new origin never receives the previous password implicitly", async () => {
  const f = fixture();
  await assert.rejects(
    login(f, { server: "https://other.example", name: "You" }),
    /Enter your password/,
  );
  assert.equal(f.requests.length, 0);
});
