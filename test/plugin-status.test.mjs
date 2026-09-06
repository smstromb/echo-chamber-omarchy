import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const status = vm.createContext({});
vm.runInContext(
  readFileSync(new URL("../plugin/Status.js", import.meta.url), "utf8"),
  status,
);
const lobby = { status: "idle", configured: true, signedIn: false };

test("successful app sign-in clears a prior toolbar join error", () => {
  const signedIn = { ...lobby, signedIn: true };
  const error = status.reconciledActionError(
    lobby,
    signedIn,
    "Sign in in the app first.",
  );
  assert.equal(error, "");
  assert.equal(status.message(signedIn, error), "Signed in · Ready to join");
});
test("routine roster and speaker updates retain actionable errors", () => {
  assert.equal(
    status.reconciledActionError(
      lobby,
      { ...lobby, online: [{ name: "Orbit" }] },
      "Server unavailable",
    ),
    "Server unavailable",
  );
  assert.equal(
    status.message(lobby, "Server unavailable"),
    "Server unavailable",
  );
});
test("session transitions retire old errors and describe voice state separately", () => {
  const signedIn = { ...lobby, signedIn: true };
  for (const next of [
    { ...signedIn, status: "joining" },
    { ...signedIn, signedIn: false },
    { ...signedIn, configured: false },
  ]) {
    assert.equal(status.reconciledActionError(signedIn, next, "Old error"), "");
  }
  assert.equal(
    status.message({ ...signedIn, status: "joined", micMuted: true }, ""),
    "Connected · Your mic is off",
  );
  assert.equal(
    status.message({ ...signedIn, status: "reconnecting" }, ""),
    "Reconnecting to the room…",
  );
});
test("current connection failures remain visible after sign-in", () => {
  assert.equal(
    status.message(
      { ...lobby, signedIn: true, onlineError: "Network unavailable" },
      "",
    ),
    "Network unavailable",
  );
});
