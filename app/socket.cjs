const net = require("node:net");
const fs = require("node:fs");
function serve(socketPath, getState, command) {
  const clients = new Set();
  const server = net.createServer((socket) => {
    let buffer = "";
    socket.setTimeout(10000, () => socket.destroy());
    socket.on("error", () => {});
    socket.on("close", () => clients.delete(socket));
    socket.on("data", (chunk) => {
      buffer += chunk;
      if (buffer.length > 16384) return socket.destroy();
      const index = buffer.indexOf("\n");
      if (index < 0) return;
      socket.pause();
      (async () => {
        const input = JSON.parse(buffer.slice(0, index));
        if (input.action === "watch") {
          socket.setTimeout(0);
          clients.add(socket);
          socket.write(JSON.stringify(getState()) + "\n");
          return;
        }
        const result =
          input.action === "status" ? getState() : await command(input);
        socket.end(JSON.stringify({ ok: true, result }) + "\n");
      })().catch((e) =>
        socket.end(JSON.stringify({ ok: false, error: e.message }) + "\n"),
      );
    });
  });
  if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
  server.listen(socketPath, () => fs.chmodSync(socketPath, 0o600));
  return {
    server,
    publish(state) {
      for (const s of clients) {
        if (s.writableLength > 65536) s.destroy();
        else s.write(JSON.stringify(state) + "\n");
      }
    },
  };
}
module.exports = { serve };
