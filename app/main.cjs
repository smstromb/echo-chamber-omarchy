const {
  app,
  BrowserWindow,
  ipcMain,
  session,
  Menu,
  safeStorage,
  desktopCapturer,
  dialog,
  shell,
  powerMonitor,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { EchoAPI, defaults } = require("./api.cjs");
const credentials = require("./credentials.cjs");
const { serve } = require("./socket.cjs");
const { createLogger } = require("./diagnostics.cjs");
const demo = process.argv.includes("--demo");
if (process.env.ECHO_USER_DATA)
  app.setPath("userData", process.env.ECHO_USER_DATA);
app.setName("Echo Chamber");
// Chromium does not recognize Hyprland's desktop name. Omarchy provides
// Secret Service through GNOME Keyring; honor an explicit user override.
if (
  process.platform === "linux" &&
  !app.commandLine.hasSwitch("password-store")
)
  app.commandLine.appendSwitch("password-store", "gnome-libsecret");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win,
    bridge,
    api,
    config,
    quitting = false;
  let state = { status: "starting", participants: [], online: [], error: "" };
  let counter = 0;
  const pending = new Map();
  let diagnostic, lastCallState;
  const log = (event, fields) => diagnostic?.write(event, fields);
  let apiQueue = Promise.resolve();
  const configPath = path.join(app.getPath("userData"), "connection.json");
  const persist = (value = config) => {
    fs.mkdirSync(path.dirname(configPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(configPath + ".tmp", JSON.stringify(value, null, 2), {
      mode: 0o600,
    });
    fs.renameSync(configPath + ".tmp", configPath);
  };
  const secureStore = () => credentials.canRemember(safeStorage);
  function show() {
    if (win) {
      win.show();
      win.focus();
    }
  }
  function command(c) {
    if (c.action === "show") {
      show();
      return;
    }
    if (c.action === "quit") {
      setTimeout(() => app.quit(), 50);
      return;
    }
    if (
      ![
        "join",
        "leave",
        "mute",
        "volume",
        "mic",
        "deafen",
        "share",
        "camera",
        "recover-audio",
      ].includes(c.action)
    )
      throw Error("Unknown command");
    if (c.action === "join" && !api.admin && !demo) {
      show();
      throw Error("Sign in in the app first.");
    }
    return new Promise((resolve, reject) => {
      const id = ++counter;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Error("The app did not finish the command."));
      }, 45000);
      pending.set(id, { resolve, reject, timer });
      win.webContents.send("echo:command", id, c);
    });
  }
  app.on("second-instance", show);
  process.on("SIGTERM", () => app.quit());
  process.on("SIGINT", () => app.quit());
  app.whenReady().then(async () => {
    diagnostic = createLogger(path.join(app.getPath("userData"), "logs"));
    log("app.start", {
      pid: process.pid,
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
    });
    const recoverAudio = (reason) => {
      if (!quitting && ["joined", "reconnecting"].includes(state.status))
        command({ action: "recover-audio", reason }).catch(() => {});
    };
    app.on("child-process-gone", (_event, details) => {
      const audio =
        /audio/i.test(details.name || "") ||
        /audio/i.test(details.serviceName || "");
      log("process.gone", {
        process: audio ? "Audio" : details.type === "GPU" ? "GPU" : "Utility",
        reason: details.reason,
        exitCode: details.exitCode,
      });
      if (audio) setTimeout(() => recoverAudio("audio-service"), 500);
    });
    powerMonitor.on("suspend", () => log("system.suspend"));
    powerMonitor.on("resume", () => {
      log("system.resume");
      setTimeout(() => recoverAudio("system-resume"), 1000);
    });
    config = defaults();
    try {
      config = {
        ...config,
        ...JSON.parse(fs.readFileSync(configPath, "utf8")),
      };
    } catch {}
    api = new EchoAPI(config);
    api.password = credentials.restorePassword(config, safeStorage);
    win = new BrowserWindow({
      width: 1180,
      height: 790,
      minWidth: 760,
      minHeight: 560,
      show: !process.argv.includes("--background"),
      title: "Echo Chamber",
      backgroundColor: "#101612",
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: "Echo Chamber",
          submenu: [
            { label: "Show window", click: show },
            {
              label: "Quit Echo Chamber",
              accelerator: "CmdOrCtrl+Q",
              click: () => app.quit(),
            },
          ],
        },
        { role: "editMenu" },
        { role: "viewMenu" },
      ]),
    );
    const trusted = (wc) => wc === win.webContents;
    win.webContents.on("render-process-gone", (_event, details) =>
      log("process.gone", {
        process: "Renderer",
        reason: details.reason,
        exitCode: details.exitCode,
      }),
    );
    win.on("unresponsive", () => log("renderer.unresponsive"));
    win.on("responsive", () => log("renderer.responsive"));
    ipcMain.on("echo:diagnostic", (e, event, fields) => {
      if (trusted(e.sender)) log(event, fields);
    });
    session.defaultSession.setPermissionRequestHandler(
      (wc, permission, callback, details) =>
        callback(
          trusted(wc) &&
            [
              "media",
              "display-capture",
              "fullscreen",
              "speaker-selection",
            ].includes(permission),
        ),
    );
    session.defaultSession.setPermissionCheckHandler(
      (wc, permission) =>
        trusted(wc) &&
        [
          "media",
          "display-capture",
          "fullscreen",
          "speaker-selection",
        ].includes(permission),
    );
    // PipeWire's getSources opens the Wayland portal and returns the user's selection.
    session.defaultSession.setDisplayMediaRequestHandler(
      async (request, callback) => {
        if (request.frame !== win.webContents.mainFrame) return callback({});
        try {
          const sources = await desktopCapturer.getSources({
            types: ["screen", "window"],
            thumbnailSize: { width: 0, height: 0 },
          });
          if (!sources.length) return callback({});
          let chosen = 0;
          if (sources.length > 1) {
            const result = await dialog.showMessageBox(win, {
              type: "question",
              message: "Choose what to share",
              buttons: [...sources.map((s) => s.name), "Cancel"],
              cancelId: sources.length,
            });
            chosen = result.response;
          }
          callback(chosen < sources.length ? { video: sources[chosen] } : {});
        } catch {
          callback({});
        }
      },
    );
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (e) => e.preventDefault());
    win.on("close", (e) => {
      if (!quitting) {
        e.preventDefault();
        win.hide();
      }
    });
    ipcMain.handle("echo:call", (e, name, args = {}) => {
      if (!trusted(e.sender)) throw Error("Untrusted window");
      const run = async () => {
        switch (name) {
          case "init":
            return {
              config: {
                server: config.server,
                name: config.name,
                room: config.room,
                mix: config.mix,
                preferences: config.preferences || {},
                deviceId: config.identity,
              },
              demo,
              canRemember: secureStore(),
              remembered: !!config.secret,
              hasSessionPassword: !!api.password,
            };
          case "login":
            return credentials.login(
              { api, config, storage: safeStorage, persist },
              args,
            );
          case "ice":
            return api.ice();
          case "preferences":
            config.preferences = args;
            persist();
            return;
          case "signout":
            await api.leave().catch(() => {});
            api.admin = "";
            api.password = "";
            delete config.secret;
            persist();
            return;
          case "feature":
            return api.feature(args.name, args.args);
          case "download": {
            const data = await api.feature("media-file", { path: args.path });
            const result = await dialog.showSaveDialog(win, {
              defaultPath: path.basename(String(args.name || "attachment")),
            });
            if (!result.canceled && result.filePath)
              fs.writeFileSync(result.filePath, Buffer.from(data.bytes));
            return;
          }
          case "external": {
            const url = new URL(args.url);
            if (
              !["http:", "https:"].includes(url.protocol) ||
              url.username ||
              url.password
            )
              throw Error("Unsupported link.");
            await shell.openExternal(url.href);
            return;
          }
          case "online":
            return api.online();
          case "token":
            config.room = String(args.room || config.room);
            persist();
            return api.issue(config.room);
          case "heartbeat":
            return api.heartbeat();
          case "leave":
            return api.leave();
          case "mix":
            config.mix = args;
            persist();
            return;
          case "hide":
            win.hide();
            return;
          case "quit":
            app.quit();
            return;
          default:
            throw Error("Unknown API operation");
        }
      };
      // Presence writes and token rotation must finish before leave; no late heartbeat resurrection.
      if (name === "online" || name === "init") return run();
      const result = apiQueue.then(run).catch((error) => {
        log("operation.failed", { error: error.name });
        throw error;
      });
      apiQueue = result.catch(() => {});
      return result;
    });
    ipcMain.on("echo:state", (e, next) => {
      if (trusted(e.sender)) {
        state = next;
        const callState = JSON.stringify([
          state.status,
          state.deafened,
          state.micMuted,
          state.participants?.length,
        ]);
        if (callState !== lastCallState) {
          lastCallState = callState;
          log("call.state", {
            state: state.status,
            deafened: state.deafened,
            micMuted: state.micMuted,
            participants: state.participants?.length || 0,
          });
        }
        bridge?.publish(state);
      }
    });
    ipcMain.on("echo:reply", (e, id, result) => {
      if (!trusted(e.sender)) return;
      const p = pending.get(id);
      if (!p) return;
      clearTimeout(p.timer);
      pending.delete(id);
      result.ok ? p.resolve() : p.reject(Error(result.error));
    });
    const runtime = process.env.XDG_RUNTIME_DIR;
    if (!runtime)
      throw Error(
        "XDG_RUNTIME_DIR is required for the private toolbar socket.",
      );
    bridge = serve(
      process.env.ECHO_SOCKET_PATH ||
        path.join(
          runtime,
          demo ? "echo-chamber-demo.sock" : "echo-chamber.sock",
        ),
      () => state,
      command,
    );
    await win.loadFile(path.join(__dirname, "../dist/index.html"));
  });
  app.on("before-quit", (e) => {
    if (quitting) return;
    e.preventDefault();
    quitting = true;
    log("app.quit");
    const done = () => {
      bridge?.server.close();
      app.quit();
    };
    Promise.race([
      command({ action: "leave" }),
      new Promise((r) => setTimeout(r, 3000)),
    ])
      .finally(done)
      .catch(() => {});
  });
  app.on("window-all-closed", () => {});
}
