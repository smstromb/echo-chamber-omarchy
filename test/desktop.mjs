import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
const data = await mkdtemp("/tmp/echo-desktop-test-");
const env = {
  ...process.env,
  ECHO_USER_DATA: data,
  ECHO_SOCKET_PATH: data + "/control.sock",
};
await mkdir("artifacts", { recursive: true });
const app = await electron.launch({ args: [".", "--demo"], env });
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByText("Design preview").waitFor();
  await page.screenshot({ path: "artifacts/lobby.png" });
  const otherRooms = page.locator("#other-rooms-menu");
  assert.equal(await otherRooms.evaluate((el) => el.open), false);
  await otherRooms.locator("summary").click();
  await page.locator('button[data-room="breakout-1"]').click();
  await page.getByRole("button", { name: "Join Breakout 1" }).waitFor();
  await otherRooms.locator("summary").click();
  await page.locator('button[data-room="main"]').click();
  assert.equal(await otherRooms.evaluate((el) => el.open), false);
  await page.getByRole("button", { name: "Join Main" }).click();
  await page.getByText("● Connected", { exact: true }).waitFor();
  const sam = page.locator('article[data-identity="sam"]');
  await sam.getByRole("button", { name: "Mute Sam", exact: true }).click();
  await sam.getByRole("button", { name: "Unmute Sam", exact: true }).waitFor();
  await sam.getByRole("button", { name: "Sam audio controls" }).click();
  const slider = sam.getByRole("slider");
  await slider.fill("38");
  await slider.dispatchEvent("change");
  await page.waitForFunction(
    () =>
      document.querySelector('[data-identity="sam"] output').textContent ===
      "38%",
  );
  await sam.getByRole("button", { name: "Unmute Sam", exact: true }).click();
  await sam.getByLabel("Speaking", { exact: true }).waitFor();
  await page.screenshot({ path: "artifacts/connected.png" });
  const state = JSON.parse(
    execFileSync("python3", ["bin/echo-chamber-ctl", "--demo", "status"], {
      encoding: "utf8",
      env,
    }),
  ).result;
  assert.equal(state.status, "joined");
  assert.equal(state.participants.find((p) => p.identity === "sam").volume, 38);
  assert.equal(await page.locator("#view-controls").isVisible(), false);
  await page.getByRole("button", { name: "Screens", exact: true }).click();
  await page.getByRole("button", { name: "Focus Sam screen" }).click();
  assert.equal(
    await page
      .locator("#screens")
      .evaluate((el) => el.classList.contains("focus-layout")),
    true,
  );
  await page.getByRole("button", { name: "Fullscreen", exact: true }).click();
  await page.waitForFunction(() => document.fullscreenElement?.id === "app");
  assert.equal(await page.locator("#mic").isVisible(), true);
  assert.equal(await page.locator("#leave").isVisible(), true);
  await page.screenshot({ path: "artifacts/design-fullscreen.png" });
  await page
    .getByRole("button", { name: "Exit fullscreen", exact: true })
    .click();
  await page.waitForFunction(() => !document.fullscreenElement);
  await page.getByRole("button", { name: "Grid", exact: true }).click();
  await sam
    .getByRole("slider", { name: "Sam screen volume", exact: true })
    .fill("35");
  await sam
    .getByRole("slider", { name: "Sam screen volume", exact: true })
    .dispatchEvent("change");
  assert.equal(
    await sam
      .getByRole("slider", { name: "Sam voice volume", exact: true })
      .inputValue(),
    "38",
  );
  await page.locator("#jam").click();
  await page.getByRole("button", { name: "Start Jam", exact: true }).click();
  await page
    .getByRole("button", { name: "Leave Jam", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Join Jam", exact: true })
    .first()
    .waitFor();
  await page.getByRole("button", { name: "Back to people" }).click();
  await page.getByRole("button", { name: "Cameras", exact: true }).click();
  assert.equal(await page.locator("#screens .media-tile").count(), 2);
  await page.getByRole("button", { name: "Voice", exact: true }).click();
  assert.equal(await page.locator("#voice-stage").isVisible(), true);
  await page.getByRole("button", { name: "Leave room" }).click();
  await page.getByText("Signed in", { exact: true }).waitFor();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].close(),
  );
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isVisible(),
    ),
    false,
  );
  execFileSync("python3", ["bin/echo-chamber-ctl", "--demo", "show"], { env });
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isVisible(),
    ),
    true,
  );
  assert.deepEqual(errors, []);
  const closing = app.waitForEvent("close", { timeout: 7000 });
  app.process().kill("SIGTERM");
  await closing;
  console.log(
    "Desktop PASS: SIGTERM graceful quit, lobby, join, speaking/share badges, mute, volume, leave, background and socket reopen.",
  );
} finally {
  await app.close().catch(() => {});
  await rm(data, { recursive: true, force: true });
}
