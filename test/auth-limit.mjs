import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
const profile = await mkdtemp("/tmp/echo-auth-limit-");
let attempts = 0,
  blocked = true,
  app;
const server = createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/v1/auth/login") {
    for await (const _chunk of req) {
    }
    attempts++;
    if (blocked) return res.writeHead(429, { "Retry-After": "3" }).end("{}");
    return res.end(
      JSON.stringify({ token: "test-admin", expires_in_seconds: 3600 }),
    );
  }
  if (req.url === "/api/online") return res.end("[]");
  res.writeHead(404).end("{}");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
try {
  app = await electron.launch({
    args: ["."],
    env: {
      ...process.env,
      ECHO_USER_DATA: profile,
      ECHO_SOCKET_PATH: profile + "/control.sock",
    },
  });
  const page = await app.firstWindow();
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.locator("#server").fill(origin);
  await page.locator("#name").fill("Test");
  await page.locator("#password").fill("test-password");
  await page.locator("#save").click();
  await page.getByRole("button", { name: /Retry in/ }).waitFor();
  assert.equal(await page.locator("#save").isDisabled(), true);
  assert.doesNotMatch(
    await page.locator("#setup-error").textContent(),
    /invoking remote|echo:call/,
  );
  await page
    .locator("#setup-form")
    .evaluate((form) =>
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      ),
    );
  const result = await page.evaluate(async () => {
    try {
      await window.echo.call("login", {
        server: document.querySelector("#server").value,
        name: "Test",
        password: "test-password",
        remember: false,
      });
      return "";
    } catch (e) {
      return e.message;
    }
  });
  assert.match(result, /Too many login attempts/);
  assert.equal(attempts, 1);
  blocked = false;
  await page.waitForFunction(() => !document.querySelector("#save").disabled);
  await page.locator("#save").click();
  await page.getByText("Signed in", { exact: true }).waitFor();
  assert.equal(attempts, 2);
  await page.reload();
  await page.getByText("Signed in", { exact: true }).waitFor();
  assert.equal(attempts, 2, "renderer reload must reuse the session");
  console.log(
    "Authentication cooldown PASS: one server request, blocked duplicate submits, clean error text, countdown expiry, successful retry and session reuse.",
  );
} finally {
  await app?.close();
  await new Promise((r) => server.close(r));
  await rm(profile, { recursive: true, force: true });
}
