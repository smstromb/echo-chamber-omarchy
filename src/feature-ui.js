import { jamContract } from "./jam.js";
export function createFeatureUI({ controller: c, esc, icon, ib, render }) {
  let chatDraft = "",
    soundQuery = "",
    jamQuery = "",
    chatBusy = false;
  const blobs = new Set();
  const fail = (e) => {
    c.state.error = e.message;
    c.publish();
  };
  const run = (task) => Promise.resolve().then(task).catch(fail);
  const command = (value) => c.command(value);
  function devices(el) {
    const items = c.state.devices || [];
    el.innerHTML = `<section class="drawer-section device-settings">${[
      ["audioinput", "Microphone"],
      ["audiooutput", "Output"],
      ["videoinput", "Camera"],
    ]
      .map(
        ([kind, label]) =>
          `<label>${label}<select data-device="${kind}" aria-label="${label}"><option value="default">System default</option>${items
            .filter(
              (d) => d.kind === kind && d.deviceId && d.deviceId !== "default",
            )
            .map(
              (d, i) =>
                `<option value="${esc(d.deviceId)}" ${c.preferences[kind] === d.deviceId ? "selected" : ""}>${esc(d.label || label + " " + (i + 1))}</option>`,
            )
            .join("")}</select></label>`,
      )
      .join(
        "",
      )}${ib("refresh", "Refresh devices", 'id="refresh-devices"')}<label class="checkbox"><input type="checkbox" id="noise-suppression" ${c.preferences.noiseSuppression ? "checked" : ""}>Noise suppression</label><label class="checkbox"><input type="checkbox" id="chimes" ${c.preferences.chimes ? "checked" : ""}>Call sounds</label>${[
      ["chimeVolume", "Call sounds", 40],
      ["soundVolume", "Soundboard", 70],
    ]
      .map(
        ([key, label, fallback]) =>
          `<label>${label}<input type="range" min="0" max="100" value="${c.preferences[key] ?? fallback}" data-pref="${key}" aria-label="${label} volume"></label>`,
      )
      .join("")}</section>`;
    if (c.room) {
      const recovery = document.createElement("button");
      recovery.id = "recover-audio";
      recovery.textContent = "Restart audio";
      recovery.onclick = () => {
        recovery.disabled = true;
        run(() => command({ action: "recover-audio" })).finally(() => {
          recovery.disabled = false;
        });
      };
      el.append(recovery);
      const profile = document.createElement("details");
      profile.className = "profile-settings";
      profile.innerHTML = `<summary>Profile</summary><label>Avatar<input type="file" data-profile="avatar-upload" accept="image/png,image/jpeg,image/gif,image/webp"></label>${["enter", "exit"].map((kind) => `<label>${kind === "enter" ? "Join sound" : "Leave sound"}<input type="file" data-profile="chime-upload" data-kind="${kind}" accept="audio/*"></label><div class="utility-actions">${ib("player-play", "Preview " + kind + " sound", `data-preview-chime="${kind}"`)}${ib("trash", "Remove " + kind + " sound", `data-remove-chime="${kind}"`)}</div>`).join("")}`;
      el.append(profile);
      profile.querySelectorAll("[data-profile]").forEach(
        (input) =>
          (input.onchange = () =>
            run(async () => {
              const file = input.files[0];
              if (!file) return;
              if (file.size > 5 * 1024 * 1024)
                throw Error("Profile file exceeds 5 MB.");
              await command({
                action: "profile",
                operation: input.dataset.profile,
                kind: input.dataset.kind,
                bytes: await file.arrayBuffer(),
                mime: file.type,
              });
              input.value = "";
            })),
      );
      profile
        .querySelectorAll("[data-preview-chime]")
        .forEach(
          (b) =>
            (b.onclick = () =>
              run(() =>
                c.effects.chime(
                  b.dataset.previewChime,
                  c.room.localParticipant.identity,
                ),
              )),
        );
      profile.querySelectorAll("[data-remove-chime]").forEach(
        (b) =>
          (b.onclick = () =>
            run(() =>
              command({
                action: "profile",
                operation: "chime-delete",
                kind: b.dataset.removeChime,
              }),
            )),
      );
    }
    el.querySelectorAll("[data-device]").forEach(
      (input) =>
        (input.onchange = () =>
          run(() =>
            command({
              action: "preferences",
              value: { [input.dataset.device]: input.value },
            }),
          )),
    );
    el.querySelector("#refresh-devices").onclick = () =>
      run(() => c.refreshDevices());
    el.querySelector("#noise-suppression").onchange = (e) =>
      run(() =>
        command({
          action: "preferences",
          value: { noiseSuppression: e.target.checked },
        }),
      );
    el.querySelector("#chimes").onchange = (e) =>
      run(() =>
        command({ action: "preferences", value: { chimes: e.target.checked } }),
      );
    el.querySelectorAll("[data-pref]").forEach(
      (input) =>
        (input.onchange = () =>
          run(() =>
            command({
              action: "preferences",
              value: { [input.dataset.pref]: Number(input.value) },
            }),
          )),
    );
  }
  function linkText(text) {
    return String(text)
      .split(/(https?:\/\/[^\s<>]+)/g)
      .map((part) =>
        /^https?:\/\//.test(part)
          ? `<button class="text-link" data-link="${esc(part)}">${esc(part)}</button>`
          : esc(part),
      )
      .join("");
  }
  function chat(el) {
    const data = c.data?.state;
    el.innerHTML = `${data?.error ? `<p role="status">${esc(data.error)}</p>` : ""}<div class="utility-actions">${ib("refresh", "Reload chat", "data-refresh")}${ib("mood-smile", "Insert emoji", 'id="emoji"')}</div><div id="messages">${(data?.messages || []).map((m) => `<article class="chat-message" data-message="${esc(m.id)}"><div class="chat-heading"><strong>${esc(m.name)}</strong><time title="${esc(new Date(m.timestamp).toLocaleString())}">${esc(new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))}</time>${m.identity === c.room?.localParticipant.identity ? ib("trash", "Delete message", `data-delete="${esc(m.id)}"`) : ""}</div><p>${linkText(m.text)}</p>${m.fileUrl ? `<div class="attachment">${ib("download", `Save ${m.fileName}`, `data-download="${esc(m.id)}"`)}<button class="attachment-name" data-preview="${esc(m.id)}">${esc(m.fileName)}</button><div class="attachment-preview"></div></div>` : ""}</article>`).join("")}</div><form id="chat-form" class="drawer-form">${ib("paperclip", "Attach file", 'type="button" id="attach-file"')}<input id="chat-file" type="file" hidden><input id="message" aria-label="Message" placeholder="Message ${esc(c.state.room === "main" ? "Main" : c.state.room)}" maxlength="6000" value="${esc(chatDraft)}">${ib("arrow-up", "Send message", `type="submit" ${chatBusy ? "disabled" : ""}`)}</form><div id="emoji-picker" class="emoji-picker" hidden>${["👍", "😂", "❤️", "🎉", "👀", "🔥", "🙃", "🤔", "😭", "👋", "✅", "🎮"].map((e) => `<button data-emoji="${e}">${e}</button>`).join("")}</div>`;
    const input = el.querySelector("#message");
    input.oninput = () => (chatDraft = input.value);
    el.querySelector("#emoji").onclick = () => {
      const picker = el.querySelector("#emoji-picker");
      picker.hidden = !picker.hidden;
    };
    el.querySelectorAll("[data-emoji]").forEach(
      (b) =>
        (b.onclick = () => {
          input.value += b.dataset.emoji;
          chatDraft = input.value;
          input.focus();
        }),
    );
    const send = async (file) => {
      if (chatBusy) return;
      chatBusy = true;
      try {
        await command({ action: "chat-send", text: chatDraft, file });
        chatDraft = "";
      } catch (e) {
        fail(e);
      } finally {
        chatBusy = false;
        chat(el);
        el.querySelector("#message").focus();
      }
    };
    el.querySelector("#chat-form").onsubmit = (e) => {
      e.preventDefault();
      run(() => send());
    };
    const upload = async (file) => {
      if (!file) return;
      if (file.size > 50 * 1024 * 1024) throw Error("File exceeds 50 MB.");
      await send({
        name: file.name,
        type: file.type,
        bytes: await file.arrayBuffer(),
      });
    };
    el.querySelector("#attach-file").onclick = () =>
      el.querySelector("#chat-file").click();
    el.querySelector("#chat-file").onchange = (e) =>
      run(() => upload(e.target.files[0]));
    input.onpaste = (e) => {
      const file = [...e.clipboardData.items]
        .find((x) => x.kind === "file")
        ?.getAsFile();
      if (file) {
        e.preventDefault();
        run(() => upload(file));
      }
    };
    el.querySelectorAll("[data-delete]").forEach(
      (b) =>
        (b.onclick = () =>
          run(() => command({ action: "chat-delete", id: b.dataset.delete }))),
    );
    el.querySelectorAll("[data-link]").forEach(
      (b) =>
        (b.onclick = () =>
          run(() => c.api("external", { url: b.dataset.link }))),
    );
    el.querySelectorAll("[data-download]").forEach(
      (b) =>
        (b.onclick = () => {
          const m = data.messages.find((m) => m.id === b.dataset.download);
          run(() => c.api("download", { path: m.fileUrl, name: m.fileName }));
        }),
    );
    el.querySelectorAll("[data-preview]").forEach(
      (b) =>
        (b.onclick = () =>
          run(async () => {
            const m = data.messages.find((m) => m.id === b.dataset.preview),
              holder = b.parentElement.querySelector(".attachment-preview");
            if (holder.childElementCount) {
              holder.replaceChildren();
              return;
            }
            if (
              !/^(image\/(png|jpeg|gif|webp|avif)|audio\/(mpeg|ogg|wav|webm|mp4|flac)|video\/(mp4|webm|ogg))$/.test(
                m.fileType,
              )
            )
              return c.api("download", { path: m.fileUrl, name: m.fileName });
            b.disabled = true;
            try {
              const file = await c.api("feature", {
                name: "media-file",
                args: { path: m.fileUrl },
              });
              if (!b.isConnected) return;
              const url = URL.createObjectURL(
                new Blob([new Uint8Array(file.bytes)], { type: m.fileType }),
              );
              blobs.add(url);
              const media = document.createElement(
                m.fileType.startsWith("image/")
                  ? "img"
                  : m.fileType.startsWith("video/")
                    ? "video"
                    : "audio",
              );
              media.src = url;
              media.alt = m.fileName;
              media.controls = true;
              media.preload = "metadata";
              media.muted = c.state.deafened;
              holder.append(media);
            } finally {
              b.disabled = false;
            }
          })),
    );
    el.querySelector("[data-refresh]").onclick = () =>
      run(() => command({ action: "refresh-data" }));
    el.querySelector("#messages").scrollTop =
      el.querySelector("#messages").scrollHeight;
  }
  function sounds(el) {
    const data = c.data?.state;
    const favorites = c.preferences.soundFavorites || [];
    el.innerHTML = `<div class="utility-actions"><input id="sound-search" type="search" aria-label="Search sounds" placeholder="Search" value="${esc(soundQuery)}">${ib("refresh", "Reload sounds", "data-refresh")}${ib("plus", "Upload sound", 'id="new-sound"')}</div>${data?.error ? `<p role="status">${esc(data.error)}</p>` : ""}<div class="sounds live-sounds">${
      [...(data?.sounds || [])]
        .sort(
          (a, b) =>
            Number(favorites.includes(b.id)) - Number(favorites.includes(a.id)),
        )
        .map(
          (s) =>
            `<div class="sound-item" data-sound-name="${esc(String(s.name).toLowerCase())}"><button data-play="${esc(s.id)}"><span>${esc(s.icon || "🔊")}</span>${esc(s.name)}</button><div>${ib(favorites.includes(s.id) ? "star-filled" : "star", `Favourite ${s.name}`, `data-favorite="${esc(s.id)}" aria-pressed="${favorites.includes(s.id)}"`)}${ib("pencil", `Edit ${s.name}`, `data-edit="${esc(s.id)}"`)}</div></div>`,
        )
        .join("") || '<p class="empty-note">No sounds</p>'
    }</div>`;
    const filter = () =>
      el
        .querySelectorAll("[data-sound-name]")
        .forEach(
          (row) =>
            (row.hidden = !row.dataset.soundName.includes(
              soundQuery.toLowerCase(),
            )),
        );
    el.querySelector("#sound-search").oninput = (e) => {
      soundQuery = e.target.value;
      filter();
    };
    filter();
    el.querySelector("[data-refresh]").onclick = () =>
      run(() => command({ action: "refresh-data" }));
    el.querySelectorAll("[data-play]").forEach(
      (b) =>
        (b.onclick = () =>
          run(() => command({ action: "sound-play", id: b.dataset.play }))),
    );
    el.querySelectorAll("[data-favorite]").forEach(
      (b) =>
        (b.onclick = () =>
          run(async () => {
            const id = b.dataset.favorite;
            await command({
              action: "preferences",
              value: {
                soundFavorites: favorites.includes(id)
                  ? favorites.filter((x) => x !== id)
                  : [...favorites, id],
              },
            });
            sounds(el);
          })),
    );
    const edit = (sound = {}) => {
      const dialog = document.createElement("dialog");
      dialog.className = "sound-editor";
      dialog.innerHTML = `<form><div class="dialog-heading"><h2>${sound.id ? "Edit sound" : "Upload sound"}</h2>${ib("x", "Close sound editor", 'type="button" data-close')}</div><label>Name<input name="name" required maxlength="60" value="${esc(sound.name || "")}"></label><label>Icon<input name="icon" maxlength="16" value="${esc(sound.icon || "🔊")}"></label><label>Clip volume<input name="volume" type="range" min="0" max="200" value="${sound.volume ?? 100}"><output>${sound.volume ?? 100}%</output></label>${sound.id ? "" : '<input name="file" type="file" accept="audio/*" required aria-label="Audio file">'}<p role="alert"></p><button class="primary" type="submit">Save</button></form>`;
      document.body.append(dialog);
      dialog.showModal();
      dialog.onclose = () => dialog.remove();
      dialog.querySelector("[data-close]").onclick = () => dialog.close();
      dialog.querySelector("[name=volume]").oninput = (e) =>
        (dialog.querySelector("output").textContent = e.target.value + "%");
      dialog.querySelector("form").onsubmit = async (e) => {
        e.preventDefault();
        const button = dialog.querySelector("[type=submit]");
        button.disabled = true;
        try {
          const form = e.target,
            file = form.elements.file?.files[0];
          if (file?.size > 50 * 1024 * 1024) throw Error("File exceeds 50 MB.");
          await command({
            action: "sound-save",
            id: sound.id,
            name: form.elements.name.value,
            icon: form.elements.icon.value,
            volume: Number(form.elements.volume.value),
            ...(file
              ? { bytes: await file.arrayBuffer(), mime: file.type }
              : {}),
          });
          dialog.close();
        } catch (error) {
          dialog.querySelector("[role=alert]").textContent = error.message;
        } finally {
          button.disabled = false;
        }
      };
    };
    el.querySelector("#new-sound").onclick = () => edit();
    el.querySelectorAll("[data-edit]").forEach(
      (b) =>
        (b.onclick = () =>
          edit(data.sounds.find((s) => s.id === b.dataset.edit))),
    );
  }
  function jam(el) {
    const state = c.jamClient?.state || {},
      s = state.server || {},
      contract = jamContract(s);
    const operation = (op, body) =>
      run(() => command({ action: "jam", operation: op, body }));
    el.innerHTML = `<section class="drawer-section"><h3>${esc(s.now_playing?.name || (s.active ? "Queue empty" : "No active Jam"))}</h3><p>${esc(s.now_playing?.artist || "")}</p><small>${esc(s.spotify_device_name || s.host_identity || "")}</small>${state.error ? `<p role="status">${esc(state.error)}</p>` : ""}${!contract.compatible ? '<p class="empty-note">Jam unavailable: incompatible server</p>' : !contract.canJoin && !contract.canStart ? `<p class="empty-note">${esc(s.source_error || "Source: " + (s.source_status || "unavailable"))}</p>` : ""}<div class="jam-actions">${s.active ? `<button id="live-listen" ${!state.listening && !contract.canJoin ? "disabled" : ""}>${state.listening ? "Leave Jam" : "Join Jam"}</button>${ib("player-pause", "Stop music for everyone", `id="live-pause" ${contract.canPause ? "" : "disabled"}`)}${ib("player-skip-forward", "Skip track for everyone", `id="live-skip" ${contract.canControl ? "" : "disabled"}`)}${s.host_identity === c.room?.localParticipant.identity ? ib("x", "End Jam for everyone", 'id="live-end"') : ""}` : `<button id="live-start" class="primary" ${contract.canStart ? "" : "disabled"}>Start Jam</button>`}</div><label>Jam volume<input type="range" min="0" max="100" value="${c.preferences.jamVolume ?? 30}" id="live-jam-volume" aria-label="Jam volume"></label></section><form id="jam-search" class="drawer-form"><input aria-label="Search music" placeholder="Search music" value="${esc(jamQuery)}" maxlength="200" minlength="2" required>${ib("search", "Search music", 'type="submit"')}</form><div class="jam-search-results">${(state.results || []).map((track, i) => `<div class="queue-row"><div><strong>${esc(track.name)}</strong><small>${esc(track.artist || "")}</small></div>${ib("plus", `Queue ${track.name}`, `data-add="${i}" ${contract.canControl ? "" : "disabled"}`)}</div>`).join("")}</div><span class="drawer-label">Queue</span>${(s.queue || []).map((track, i) => `<div class="queue-row"><span class="queue-index">${i + 1}</span><div><strong>${esc(track.name)}</strong><small>${esc(track.artist || "")}</small></div>${track.can_remove && contract.canControl ? ib("x", `Remove ${track.name}`, `data-remove="${esc(track.queue_entry_id)}"`) : ""}</div>`).join("")}`;
    el.querySelector("#live-listen")?.addEventListener("click", () =>
      operation(state.listening ? "leave" : "join"),
    );
    el.querySelector("#live-start")?.addEventListener("click", () =>
      operation("start"),
    );
    el.querySelector("#live-pause")?.addEventListener("click", () =>
      operation("pause"),
    );
    el.querySelector("#live-skip")?.addEventListener("click", () =>
      operation("skip"),
    );
    el.querySelector("#live-end")?.addEventListener("click", () =>
      document.getElementById("confirm").showModal(),
    );
    el.querySelector("#live-jam-volume").onchange = (e) =>
      run(() =>
        command({
          action: "preferences",
          value: { jamVolume: Number(e.target.value) },
        }),
      );
    el.querySelector("#jam-search input").oninput = (e) =>
      (jamQuery = e.target.value);
    el.querySelector("#jam-search").onsubmit = (e) => {
      e.preventDefault();
      operation("search", {
        kind: "track",
        query: jamQuery,
        offset: 0,
        limit: 20,
      });
    };
    el.querySelectorAll("[data-add]").forEach(
      (b) =>
        (b.onclick = () => {
          const t = state.results[Number(b.dataset.add)];
          operation("add", {
            spotify_uri: t.spotify_uri || t.uri,
            name: t.name,
            artist: t.artist || "",
            album_art_url: t.artwork_url || t.album_art_url || "",
            duration_ms: t.duration_ms || 0,
          });
        }),
    );
    el.querySelectorAll("[data-remove]").forEach(
      (b) =>
        (b.onclick = () =>
          operation("remove", { queue_entry_ids: [b.dataset.remove] })),
    );
  }
  return {
    devices,
    chat,
    sounds,
    jam,
    dispose() {
      chatDraft = "";
      for (const url of blobs) URL.revokeObjectURL(url);
      blobs.clear();
    },
    sync() {
      document
        .querySelectorAll(".attachment-preview audio,.attachment-preview video")
        .forEach((el) => {
          el.muted = c.state.deafened;
          const output = c.preferences.audiooutput;
          if (el.setSinkId && output && el.sinkId !== output)
            el.setSinkId(output === "default" ? "" : output).catch(() => {});
        });
    },
  };
}
