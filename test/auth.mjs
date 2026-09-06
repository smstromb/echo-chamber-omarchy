import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "node:http";
const data = await mkdtemp("/tmp/echo-auth-test-");
// Playwright injects --password-store=basic. Remove only that test default
// before loading the real entrypoint, so its Omarchy backend selection runs.
const entry = data + "/launch.cjs";
await writeFile(
  entry,
  `require('electron').app.commandLine.removeSwitch('password-store');require(${JSON.stringify(resolve("app/main.cjs"))});`,
);
const password = "dummy-password-for-isolated-auth-test";
let logins = 0;
const server = createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/v1/auth/login") {
    let body = "";
    for await (const chunk of req) body += chunk;
    if (JSON.parse(body).password !== password)
      return res.writeHead(401).end("{}");
    logins++;
    return res.end(JSON.stringify({ token: "isolated-test-admin" }));
  }
  if (req.url === "/api/online") return res.end("[]");
  res.writeHead(404).end("{}");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let app, page;
async function launch(args = []) {
  app = await electron.launch({
    args: [args.length ? "." : entry, ...args],
    env: {
      ...process.env,
      ECHO_USER_DATA: data,
      ECHO_SOCKET_PATH: data + "/control.sock",
    },
  });
  page = await app.firstWindow();
  await page.waitForFunction(() => !!window.echo);
}
async function close() {
  await app.close();
  app = null;
}
async function signIn(remember) {
  await page.locator("#setup").waitFor({ state: "visible" });
  await page.locator("#server").fill(origin);
  await page.locator("#name").fill("Test");
  await page.locator("#password").fill(password);
  await page.locator("#remember").setChecked(remember);
  await page.locator("#save").click();
  await page.locator("#setup").waitFor({ state: "hidden" });
  await page.getByText("Signed in", { exact: true }).waitFor();
}
async function init() {
  return page.evaluate(() => window.echo.call("init"));
}
async function disk() {
  return JSON.parse(await readFile(data + "/connection.json", "utf8"));
}
try {
  await launch();
  await page.locator("#setup").waitFor({ state: "visible" });
  assert.equal((await init()).canRemember, true);
  assert.equal(await page.locator("#remember").isEnabled(), true);
  await signIn(true);
  assert.ok((await disk()).secret);
  assert.equal(
    (await readFile(data + "/connection.json", "utf8")).includes(password),
    false,
  );
  assert.equal((await stat(data + "/connection.json")).mode & 0o777, 0o600);
  const saved = (await disk()).secret;
  const failure = await page.evaluate(async () => {
    try {
      await window.echo.call("login", { password: "wrong", remember: false });
      return "";
    } catch (e) {
      return e.message;
    }
  });
  assert.match(failure, /Password or session/);
  assert.equal((await disk()).secret, saved);
  await close();
  await launch();
  await page.getByText("Signed in", { exact: true }).waitFor();
  assert.equal((await init()).remembered, true);
  assert.equal((await init()).hasSessionPassword, true);
  assert.ok(logins >= 2);
  await page.locator("#settings").click();
  await page.locator("#signout").click();
  await page.locator("#setup").waitFor({ state: "visible" });
  assert.equal((await disk()).secret, undefined);
  await signIn(false);
  await page.reload();
  await page.getByText("Signed in", { exact: true }).waitFor();
  assert.equal((await init()).remembered, false);
  assert.equal((await init()).hasSessionPassword, true);
  assert.equal((await disk()).secret, undefined);
  await close();
  await launch();
  await page.locator("#setup").waitFor({ state: "visible" });
  assert.equal((await init()).hasSessionPassword, false);
  await close();
  await launch(["--password-store=basic"]);
  await page.locator("#setup").waitFor({ state: "visible" });
  assert.equal((await init()).canRemember, false);
  assert.equal(await page.locator("#remember").isDisabled(), true);
  await signIn(false);
  assert.equal((await disk()).secret, undefined);
  console.log(
    "Auth PASS: real keyring encryption, automatic sign-in across process restart, failed-login preservation, sign-out forgets, memory-only reload/restart, explicit basic backend never saves.",
  );
} finally {
  if (app) await app.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
  await rm(data, { recursive: true, force: true });
}
