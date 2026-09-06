const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("echo", {
  diagnostic: (event, fields) =>
    ipcRenderer.send("echo:diagnostic", event, fields),
  call: async (name, args) => {
    const result = await ipcRenderer.invoke("echo:call", name, args);
    if (result?.__echoError) {
      const { message, status, retryAt } = result.__echoError;
      throw Object.assign(Error(message), { status, retryAt });
    }
    return result;
  },
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
