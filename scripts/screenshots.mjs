import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
const profile = await mkdtemp("/tmp/echo-product-shots-");
const app = await electron.launch({
  args: [".", "--demo"],
  env: {
    ...process.env,
    ECHO_USER_DATA: profile,
    ECHO_SOCKET_PATH: profile + "/control.sock",
  },
});
try {
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.getByText("Design preview", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Join Main", exact: true }).click();
  await page.getByText("● Connected", { exact: true }).waitFor();
  await mkdir("docs/images", { recursive: true });
  await page.screenshot({ path: "docs/images/voice.png" });
  await page.getByRole("button", { name: "Screens", exact: true }).click();
  await page
    .getByRole("button", { name: "Orbit audio controls", exact: true })
    .click();
  await page
    .getByRole("slider", { name: "Orbit screen volume", exact: true })
    .fill("35");
  await page
    .getByRole("slider", { name: "Orbit screen volume", exact: true })
    .dispatchEvent("change");
  await page.waitForFunction(() =>
    [
      ...document.querySelectorAll(
        '#screens img[src^="assets/"], #camera-strip img[src^="assets/"]',
      ),
    ].every((i) => i.complete && i.naturalWidth > 0),
  );
  await page.screenshot({ path: "docs/images/screens.png" });
  console.log(
    "Product screenshots captured from the desktop demo with synthetic handles and media.",
  );
} finally {
  await app.close();
  await rm(profile, { recursive: true, force: true });
}
