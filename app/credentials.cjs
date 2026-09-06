const { EchoAPI, serverURL } = require("./api.cjs");

function canRemember(storage, platform = process.platform) {
  return (
    storage.isEncryptionAvailable() &&
    (platform !== "linux" ||
      ["gnome_libsecret", "kwallet", "kwallet5", "kwallet6"].includes(
        storage.getSelectedStorageBackend(),
      ))
  );
}

function restorePassword(config, storage) {
  if (!config.secret || !canRemember(storage)) return "";
  try {
    return storage.decryptString(Buffer.from(config.secret, "base64"));
  } catch {
    return "";
  }
}

// Authenticate and persist first: a failed attempt must not replace working
// credentials, and a renderer reload must not opt into password storage.
async function login({ api, config, storage, persist }, args = {}) {
  const next = { ...config };
  if (args.server !== undefined) {
    if (api.token)
      throw Error("Leave your room before changing connection settings.");
    next.server = serverURL(args.server);
    next.name = String(args.name || "").trim();
    if (!next.name || [...next.name].length > 128)
      throw Error("Enter a display name of up to 128 characters.");
    next.room = String(args.room || "main");
  }
  const password =
    args.password ?? (next.server === config.server ? api.password : "");
  if (!password) throw Error("Enter your password.");
  if (args.remember === true) {
    if (!canRemember(storage))
      throw Error(
        "Desktop keyring unavailable. Unlock it or turn off Remember password.",
      );
    try {
      next.secret = storage.encryptString(password).toString("base64");
    } catch {
      throw Error(
        "Could not save your password. Unlock your desktop keyring and try again.",
      );
    }
  } else if (args.remember === false || next.server !== config.server) {
    delete next.secret;
  }
  const candidate = new EchoAPI(next, api.fetch);
  await candidate.login(password);
  persist(next);
  Object.assign(config, next);
  if (!next.secret) delete config.secret;
  api.admin = candidate.admin;
  api.password = candidate.password;
  return { ok: true };
}

module.exports = { canRemember, restorePassword, login };
