const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("echo", {
  call: (name, args) => ipcRenderer.invoke("echo:call", name, args),
  publish: (state) => ipcRenderer.send("echo:state", state),
  onCommand: (callback) =>
    ipcRenderer.on("echo:command", async (_event, id, command) => {
      try {
        await callback(command);
        ipcRenderer.send("echo:reply", id, { ok: true });
      } catch (e) {
        ipcRenderer.send("echo:reply", id, { ok: false, error: e.message });
      }
    }),
});
