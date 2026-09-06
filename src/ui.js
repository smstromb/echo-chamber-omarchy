import { createFeatureUI } from "./feature-ui.js";
import { Controller } from "./controller.js";
import { rooms, roomName, parentIdentity } from "./model.js";
const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const icon = (name) => `<img class="icon" src="icons/${name}.svg" alt="">`;
const ib = (name, label, attrs = "") =>
  `<button class="icon-button" aria-label="${esc(label)}" title="${esc(label)}" ${attrs}>${icon(name)}</button>`;
const setIcon = (el, name, label) => {
  if (el.dataset.currentIcon !== name) {
    el.innerHTML = icon(name);
    el.dataset.currentIcon = name;
  }
  if (label) {
    el.title = label;
    el.setAttribute("aria-label", label);
  }
};
document
  .querySelectorAll("[data-icon]")
  .forEach((el) => (el.innerHTML = icon(el.dataset.icon)));
const browserPreview =
  !window.echo && new URLSearchParams(location.search).has("preview");
if (browserPreview)
  window.echo = {
    call: async (name) =>
      name === "init"
        ? {
            demo: true,
            config: { room: "main", name: "You", mix: {} },
            canRemember: false,
          }
        : {},
    publish: () => {},
    onCommand: () => {},
  };
let selected = "main",
  controller,
  features,
  state,
  scene = "voice",
  view = "grid",
  focused = null,
  drawer = null,
  openedPerson = null;
let rosterKey = "",
  voiceKey = "",
  stageKey = "",
  drawerKey = "";
const media = new Map(),
  personNodes = new Map(),
  voiceNodes = new Map(),
  mediaNodes = new Map();
const hiddenSources = new Set();
const demoPeople = [
  { identity: "self", name: "You", self: true, micMuted: true },
  { identity: "orbit", name: "Orbit", speaking: true },
  { identity: "pixel", name: "Pixel" },
  { identity: "comet", name: "Comet" },
  { identity: "moss", name: "Moss" },
  { identity: "relay", name: "Relay", micMuted: true },
];
const jam = {
  active: false,
  listening: false,
  playing: true,
  volume: 30,
  source: "Orbit’s PC",
  queue: [
    { title: "Night Drive", artist: "Low Coast" },
    { title: "Coastal Highway", artist: "Solar Flare" },
    { title: "After Hours", artist: "Northline" },
  ],
};
const messages = [
  { name: "Orbit", text: "Anyone up for a race?" },
  { name: "Pixel", text: "Give me a minute." },
];
const avatars = {
  orbit: "assets/camera-orbit.png",
  moss: "assets/camera-moss.png",
};
function avatar(p) {
  const live = state?.data?.avatars?.[p.identity];
  if (live)
    return `<span class="avatar"><img src="${esc(live)}" alt=""></span>`;
  return `<span class="avatar">${controller?.demo && avatars[p.identity] ? `<img src="${avatars[p.identity]}" alt="">` : esc(p.name.slice(0, 2).toUpperCase())}</span>`;
}
function joined() {
  return ["joined", "reconnecting"].includes(state?.status);
}
const act = (c) => controller.command(c).catch(() => {});
function selectRoom(room) {
  selected = room;
  $("other-rooms-menu").open = false;
}
function demoScenario(next) {
  scene = next;
  hiddenSources.clear();
  focused = null;
  view = "grid";
  if (joined()) {
    controller.state.participants = demoPeople.map((p) => ({
      ...p,
      volume: 100,
      screenVolume: 100,
      muted: false,
      screenMuted: false,
      ...controller.mix[p.identity],
      sharing:
        next === "screens" && ["orbit", "pixel", "comet"].includes(p.identity),
      camera: next !== "voice" && ["orbit", "moss"].includes(p.identity),
    }));
    controller.publish();
  } else render(state);
}
function syncDemoMedia() {
  if (!controller.demo) return;
  media.clear();
  if (!joined()) return;
  if (scene === "screens") {
    for (const [id, asset] of [
      ["orbit", "screen-space.png"],
      ["pixel", "screen-racing.png"],
      ["comet", "screen-space.png"],
    ])
      media.set(`${id}-screen`, {
        id: `${id}-screen`,
        owner: id,
        name: demoPeople.find((p) => p.identity === id).name,
        type: "screen",
        image: `assets/${asset}`,
      });
  }
  if (scene !== "voice") {
    for (const id of ["orbit", "moss"])
      media.set(`${id}-camera`, {
        id: `${id}-camera`,
        owner: id,
        name: demoPeople.find((p) => p.identity === id).name,
        type: "camera",
        image: avatars[id],
      });
  }
  if (state.camera)
    media.set("self-camera", {
      id: "self-camera",
      owner: "self",
      name: "You",
      type: "camera",
      image: avatars.orbit,
    });
  if (state.sharing)
    media.set("self-screen", {
      id: "self-screen",
      owner: "self",
      name: "You",
      type: "screen",
      image: "assets/screen-space.png",
    });
}
function mixRow(p, bus, scope = "person") {
  const screen = bus === "screen",
    muted = screen ? p.screenMuted : p.muted,
    gain = (screen ? p.screenVolume : p.volume) ?? 100;
  return `<div class="mix-row" data-bus="${bus}"><label for="mix-${scope}-${esc(p.identity)}-${bus}">${screen ? "Screen" : "Voice"}</label>${ib(muted ? "volume-off" : "volume", `${muted ? "Unmute" : "Mute"} ${p.name} ${bus}`, `data-mute="${bus}" aria-pressed="${!!muted}"`)}<input id="mix-${scope}-${esc(p.identity)}-${bus}" type="range" min="0" max="300" value="${gain}" aria-label="${esc(p.name)} ${bus} volume" data-volume="${bus}"><output>${gain}%</output></div>`;
}
function bindMix(container, p) {
  container
    .querySelectorAll("[data-mute]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          act({ action: "mute", identity: p.identity, bus: b.dataset.mute })),
    );
  container.querySelectorAll("[data-volume]").forEach((input) => {
    input.oninput = () =>
      (input.nextElementSibling.textContent = input.value + "%");
    input.onchange = () =>
      act({
        action: "volume",
        identity: p.identity,
        bus: input.dataset.volume,
        value: Number(input.value),
      });
  });
}
function syncMix(container, p) {
  for (const row of container.querySelectorAll(".mix-row")) {
    const screen = row.dataset.bus === "screen",
      muted = !!(screen ? p.screenMuted : p.muted),
      gain = (screen ? p.screenVolume : p.volume) ?? 100;
    const b = row.querySelector("button"),
      input = row.querySelector("input");
    setIcon(
      b,
      muted ? "volume-off" : "volume",
      `${muted ? "Unmute" : "Mute"} ${p.name} ${row.dataset.bus}`,
    );
    b.setAttribute("aria-pressed", String(muted));
    if (document.activeElement !== input) {
      input.value = gain;
      row.querySelector("output").textContent = gain + "%";
    }
  }
}
function renderPeople(users) {
  const key = JSON.stringify([
    joined(),
    users.map((p) => [
      p.identity,
      p.name,
      p.sharing,
      p.camera,
      state.data?.avatars?.[p.identity],
    ]),
    openedPerson,
  ]);
  if (key !== rosterKey) {
    rosterKey = key;
    personNodes.clear();
    $("people").replaceChildren();
    for (const p of users) {
      const el = document.createElement("article");
      el.className = "person";
      el.dataset.identity = p.identity;
      el.innerHTML = `<div class="person-head">${avatar(p)}<div class="person-name">${esc(p.name)}${p.self ? "<small>You</small>" : ""}</div><div class="person-status"></div>${joined() && !p.self ? ib("volume", `Mute ${p.name}`, `data-quick-mute`) + ib("adjustments-horizontal", `${p.name} audio controls`, `data-expand aria-expanded="${openedPerson === p.identity}"`) : ""}</div>${joined() && !p.self && openedPerson === p.identity ? `<div class="person-mix">${mixRow(p, "voice")}${p.sharing ? mixRow(p, "screen") : ""}</div>` : ""}`;
      el.querySelector("[data-expand]")?.addEventListener("click", () => {
        openedPerson = openedPerson === p.identity ? null : p.identity;
        render(state);
      });
      el.querySelector("[data-quick-mute]")?.addEventListener("click", () =>
        act({ action: "mute", identity: p.identity, bus: "voice" }),
      );
      bindMix(el, p);
      personNodes.set(p.identity, el);
      $("people").append(el);
    }
  }
  for (const p of users) {
    const el = personNodes.get(p.identity);
    el.classList.toggle("speaking", !!p.speaking);
    const status = `${p.speaking ? `<span class="speaking-mark" title="Speaking" aria-label="Speaking">${icon("wave-sine")}</span>` : p.micMuted ? `<span title="Microphone off" aria-label="Microphone off">${icon("microphone-off")}</span>` : ""}${p.sharing ? `<span title="Sharing screen" aria-label="Sharing screen">${icon("screen-share")}</span>` : ""}${p.camera ? `<span title="Camera on" aria-label="Camera on">${icon("video")}</span>` : ""}`;
    if (el.querySelector(".person-status").innerHTML !== status)
      el.querySelector(".person-status").innerHTML = status;
    const mute = el.querySelector("[data-quick-mute]");
    if (mute) {
      setIcon(
        mute,
        p.muted ? "volume-off" : "volume",
        `${p.muted ? "Unmute" : "Mute"} ${p.name}`,
      );
      mute.setAttribute("aria-pressed", String(!!p.muted));
    }
    syncMix(el, p);
  }
}
function renderVoice(users) {
  const key = JSON.stringify(
    users.map((p) => [p.identity, p.name, state.data?.avatars?.[p.identity]]),
  );
  if (key !== voiceKey) {
    voiceKey = key;
    voiceNodes.clear();
    $("voice-stage").replaceChildren();
    for (const p of users) {
      const tile = document.createElement("button");
      tile.className = "voice-tile";
      tile.setAttribute(
        "aria-label",
        p.self ? "Your audio state" : `${p.name} audio controls`,
      );
      tile.innerHTML = `${avatar(p)}<span class="name">${esc(p.name)}</span><span class="voice-status"></span>`;
      tile.onclick = () => {
        if (!p.self) {
          openedPerson = p.identity;
          openDrawer(null);
          $("sidebar").hidden = false;
          render(state);
        }
      };
      voiceNodes.set(p.identity, tile);
      $("voice-stage").append(tile);
    }
  }
  for (const p of users) {
    const el = voiceNodes.get(p.identity);
    el.classList.toggle("speaking", !!p.speaking);
    const status = p.muted
      ? "volume-off"
      : p.speaking
        ? "wave-sine"
        : p.micMuted
          ? "microphone-off"
          : "microphone";
    setIcon(el.querySelector(".voice-status"), status);
    el.querySelector(".voice-status").classList.toggle(
      "speaking-mark",
      !!p.speaking,
    );
    el.querySelector(".voice-status").title = p.muted
      ? "Muted for you"
      : p.speaking
        ? "Speaking"
        : p.micMuted
          ? "Microphone off"
          : "Microphone on";
  }
}
function watchVideo(item, enabled) {
  if (!controller.demo && item.owner !== "self") {
    controller
      .command({ action: "watch-video", sid: item.id, enabled })
      .then(() => {
        enabled ? hiddenSources.delete(item.id) : hiddenSources.add(item.id);
        render(state);
      })
      .catch(() => {});
  } else {
    enabled ? hiddenSources.delete(item.id) : hiddenSources.add(item.id);
    render(state);
  }
}
function mediaCard(item) {
  const tile = document.createElement("article");
  tile.className = "media-tile";
  tile.dataset.source = item.id;
  tile.innerHTML = `<div class="media-heading"><span class="name">${esc(item.name)}${item.type === "screen" ? " · Screen" : ""}</span>${item.type === "screen" && item.owner !== "self" ? ib("volume", `${item.name} stream audio`, `data-stream-mute`) + `<input type="range" aria-label="${esc(item.name)} stream volume" min="0" max="300" value="100">` : ""}${ib("focus-2", `Focus ${item.name} ${item.type}`, "data-focus")}${ib("eye", `Hide ${item.name} ${item.type}`, "data-hide")}</div><div class="media-content"></div>`;
  const content = tile.querySelector(".media-content");
  if (item.pending) {
    const placeholder = document.createElement("div");
    placeholder.className = "video-pending";
    placeholder.innerHTML = `${icon("screen-share")}<span>Connecting video…</span>${ib("refresh", "Retry " + item.name + " video", "data-retry")}`;
    placeholder.querySelector("[data-retry]").onclick = () =>
      act({ action: "retry-video", identity: item.owner });
    content.append(placeholder);
    tile.querySelector("[data-focus]").disabled = true;
    tile.querySelector("[data-hide]").disabled = true;
  } else if (item.element) content.append(item.element);
  else {
    const img = document.createElement("img");
    img.src = item.image;
    img.alt = `Sample ${item.type} from ${item.name}`;
    content.append(img);
  }
  const hide = document.createElement("button");
  hide.textContent = "Show";
  hide.hidden = true;
  hide.onclick = () => {
    watchVideo(item, true);
  };
  content.append(hide);
  tile.querySelector("[data-focus]").onclick = () => {
    focused = item.id;
    view = "focus";
    render(state);
  };
  tile.querySelector("[data-hide]").onclick = () => {
    watchVideo(item, hiddenSources.has(item.id));
  };
  tile
    .querySelector("[data-stream-mute]")
    ?.addEventListener("click", () =>
      act({ action: "mute", identity: item.owner, bus: "screen" }),
    );
  tile.querySelector("input")?.addEventListener("change", (e) =>
    act({
      action: "volume",
      identity: item.owner,
      bus: "screen",
      value: Number(e.target.value),
    }),
  );
  return tile;
}
function renderMedia(users) {
  syncDemoMedia();
  // Subscriptions can arrive while connect/startAudio is still settling.
  // Keep those tracks until the call becomes joined; only a real leave clears them.
  if (!joined() && ["idle", "leaving"].includes(state.status)) {
    media.clear();
    mediaNodes.clear();
    $("screens").replaceChildren();
    $("camera-strip").replaceChildren();
    stageKey = "";
  }
  if (!joined()) {
    for (const id of [
      "voice-stage",
      "screens",
      "camera-strip",
      "view-controls",
    ])
      $(id).hidden = true;
    return;
  }
  const items = [...media.values()].filter(
      (item) => !item.publication?.isMuted,
    ),
    screens = [
      ...items.filter((m) => m.type === "screen"),
      ...users
        .filter(
          (p) =>
            p.sharing &&
            !p.self &&
            !items.some((m) => m.type === "screen" && m.owner === p.identity),
        )
        .map((p) => ({
          id: "pending:" + p.identity,
          owner: p.identity,
          name: p.name,
          type: "screen",
          pending: true,
        })),
    ],
    cameras = items.filter((m) => m.type === "camera");
  items.push(...screens.filter((item) => item.pending));
  if (focused && !media.has(focused)) {
    focused = null;
    view = "grid";
  }
  const primary = screens.length ? screens : cameras;
  const secondary = screens.length ? cameras : [];
  if (view === "focus" && !focused && primary.length) focused = primary[0].id;
  const allPrimary =
    focused && secondary.some((x) => x.id === focused)
      ? [...primary, ...secondary]
      : primary;
  const allSecondary = allPrimary.length !== primary.length ? [] : secondary;
  $("voice-stage").hidden = !joined() || items.length > 0;
  $("screens").hidden = !joined() || !primary.length;
  $("camera-strip").hidden = !joined() || !allSecondary.length;
  $("view-controls").hidden = !joined() || !items.length;
  $("screens").className =
    `screens ${allPrimary.length === 1 ? "single" : ""} ${view === "focus" && allPrimary.length > 1 ? "focus-layout" : ""}`;
  $("grid").setAttribute("aria-pressed", String(view === "grid"));
  $("focus").setAttribute("aria-pressed", String(view === "focus"));
  const key = JSON.stringify([
    allPrimary.map((x) => x.id),
    allSecondary.map((x) => x.id),
    view,
    focused,
  ]);
  for (const [id, node] of mediaNodes) {
    if (!items.some((item) => item.id === id)) {
      node.remove();
      mediaNodes.delete(id);
    }
  }
  if (key !== stageKey) {
    stageKey = key;
    for (const [list, parent] of [
      [allPrimary, $("screens")],
      [allSecondary, $("camera-strip")],
    ]) {
      for (const item of list) {
        let node = mediaNodes.get(item.id);
        if (!node) {
          node = mediaCard(item);
          mediaNodes.set(item.id, node);
        }
        parent.append(node);
        node.classList.toggle(
          "focused",
          view === "focus" && focused === item.id,
        );
      }
    }
  }
  for (const item of items) {
    const node = mediaNodes.get(item.id);
    if (!node) continue;
    const hidden = hiddenSources.has(item.id);
    const owner = controller.room?.remoteParticipants.get(
      parentIdentity(item.participant?.identity || ""),
    );
    const activity = controller.data?.activities.get(owner)?.get(item.id);
    node.querySelector(".media-heading .name").title = activity
      ? activity.source_title ||
        (activity.source_type === "monitor" ? "Desktop" : "Screen")
      : "";
    node.classList.toggle("unwatched", hidden);
    const content = node.querySelector(".media-content");
    content.firstElementChild.hidden = hidden;
    content.lastElementChild.hidden = !hidden;
    const p = users.find((p) => p.identity === item.owner);
    const input = node.querySelector("input");
    if (p && input) {
      if (document.activeElement !== input) input.value = p.screenVolume ?? 100;
      setIcon(
        node.querySelector("[data-stream-mute]"),
        p.screenMuted ? "volume-off" : "volume",
        `${p.screenMuted ? "Unmute" : "Mute"} ${p.name} stream audio`,
      );
    }
  }
  if (!items.length) renderVoice(users);
}
function openDrawer(next) {
  drawer = drawer === next && next !== null ? null : next;
  drawerKey = "";
  if (controller.data) {
    controller.data.chatOpen = drawer === "chat";
    if (drawer === "chat") controller.data.state.unread = 0;
  }
  $("sidebar").hidden = false;
  render(state);
}
function renderDrawer(users) {
  $("people").hidden = !!drawer;
  $("drawer").hidden = !drawer;
  $("drawer-close").hidden = !drawer;
  $("people-title").innerHTML = drawer
    ? { audio: "Audio", chat: "Chat", jam: "Jam", soundboard: "Soundboard" }[
        drawer
      ]
    : `People <span id="count">${users.length}</span>`;
  for (const name of ["audio", "chat", "jam", "soundboard"])
    $(name).setAttribute("aria-pressed", String(drawer === name));
  if (!drawer) return;
  const key = JSON.stringify([
    drawer,
    users.map((p) => [p.identity, p.sharing]),
    jam.active,
    jam.listening,
    jam.playing,
    jam.queue,
    controller.demo ? messages : state.data?.revision,
    drawer === "audio" ? state.devices : null,
    drawer === "jam" ? state.jam?.revision : null,
  ]);
  if (key !== drawerKey) {
    drawerKey = key;
    const el = $("drawer");
    if (drawer === "audio") {
      el.innerHTML =
        users
          .filter((p) => !p.self)
          .map(
            (p) =>
              `<section class="drawer-section" data-mix-person="${esc(p.identity)}"><h3>${esc(p.name)}</h3>${mixRow(p, "voice", "drawer")}${p.sharing ? mixRow(p, "screen", "drawer") : ""}</section>`,
          )
          .join("") || '<p class="empty-note">No other participants</p>';
      const devicePanel = document.createElement("div");
      el.prepend(devicePanel);
      features.devices(devicePanel);
      for (const p of users) {
        const box = [...el.querySelectorAll("[data-mix-person]")].find(
          (x) => x.dataset.mixPerson === p.identity,
        );
        if (box) bindMix(box, p);
      }
    }
    if (drawer === "jam" && !controller.demo) features.jam(el);
    if (drawer === "jam" && controller.demo) {
      el.innerHTML = jam.active
        ? `<section class="drawer-section"><h3>${esc(jam.queue[0]?.title || "Queue empty")}</h3><p>${esc(jam.queue[0]?.artist || "")}</p><p>${esc(jam.source)}</p><div class="jam-actions"><button id="drawer-listen">${jam.listening ? "Leave Jam" : "Join Jam"}</button>${ib(jam.playing ? "player-pause" : "player-play", jam.playing ? "Stop music for everyone" : "Resume music", 'id="jam-pause"')}${ib("player-skip-forward", "Skip track for everyone", 'id="jam-skip"')}${ib("x", "End Jam for everyone", 'id="jam-end"')}</div></section><span class="drawer-label">Queue</span>${jam.queue.map((t, i) => `<div class="queue-row"><span class="queue-index">${i + 1}</span><div><strong>${esc(t.title)}</strong><small>${esc(t.artist)}</small></div>${i > 0 ? ib("x", `Remove ${t.title}`, `data-remove="${i}"`) : ""}</div>`).join("")}<form id="add-track" class="drawer-form"><input id="track-title" aria-label="Track title" placeholder="Add a track" required>${ib("plus", "Add track", 'type="submit"')}</form>`
        : `<section class="drawer-section"><label for="jam-source">Audio source</label><select id="jam-source"><option>Orbit’s PC</option><option disabled>Local source unavailable</option></select><button id="start-jam" class="primary">Start Jam</button></section>`;
      $("start-jam")?.addEventListener("click", () => {
        jam.active = true;
        jam.listening = true;
        jam.playing = true;
        render(state);
      });
      $("drawer-listen")?.addEventListener("click", () => {
        jam.listening = !jam.listening;
        render(state);
      });
      $("jam-pause")?.addEventListener("click", () => {
        jam.playing = !jam.playing;
        render(state);
      });
      $("jam-skip")?.addEventListener("click", () => {
        if (jam.queue.length > 1) jam.queue.shift();
        render(state);
      });
      $("jam-end")?.addEventListener("click", () => $("confirm").showModal());
      el.querySelectorAll("[data-remove]").forEach(
        (b) =>
          (b.onclick = () => {
            jam.queue.splice(Number(b.dataset.remove), 1);
            render(state);
          }),
      );
      $("add-track")?.addEventListener("submit", (e) => {
        e.preventDefault();
        jam.queue.push({
          title: $("track-title").value,
          artist: "Added by you",
        });
        render(state);
      });
    }
    if (drawer === "chat" && !controller.demo) features.chat(el);
    if (drawer === "soundboard" && !controller.demo) features.sounds(el);
    if (drawer === "chat" && controller.demo) {
      el.innerHTML = `<div id="messages">${messages.map((m) => `<div class="chat-message"><strong>${esc(m.name)}</strong><p>${esc(m.text)}</p></div>`).join("")}</div><form id="chat-form" class="drawer-form"><input id="message" aria-label="Message" placeholder="Message Main" required>${ib("arrow-up", "Send message", 'type="submit"')}</form>`;
      $("chat-form").onsubmit = (e) => {
        e.preventDefault();
        messages.push({ name: "You", text: $("message").value });
        render(state);
        $("message").focus();
      };
    }
    if (drawer === "soundboard" && controller.demo) {
      el.innerHTML = `<div class="sounds">${["Chime", "Ping", "Bell", "Pop"].map((name, i) => `<button data-sound="${i}">${name}</button>`).join("")}</div><p class="empty-note">Preview sounds · local only</p>`;
      el.querySelectorAll("[data-sound]").forEach(
        (b) =>
          (b.onclick = () => {
            if (state.deafened) return;
            const ctx = new AudioContext(),
              osc = ctx.createOscillator(),
              gain = ctx.createGain();
            osc.frequency.value = 320 + Number(b.dataset.sound) * 160;
            gain.gain.setValueAtTime(0.06, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(
              0.001,
              ctx.currentTime + 0.2,
            );
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.2);
            osc.onended = () => ctx.close();
          }),
      );
    }
  }
  if (drawer === "audio")
    for (const p of users) {
      const box = [...$("drawer").querySelectorAll("[data-mix-person]")].find(
        (x) => x.dataset.mixPerson === p.identity,
      );
      if (box) syncMix(box, p);
    }
}
function render(s) {
  state = s;
  const { data: _data, jam: _jam, devices: _devices, ...barState } = s;
  window.echo?.publish(barState);
  const isJoined = joined(),
    busy = ["joining", "leaving"].includes(s.status);
  const users = isJoined
    ? s.participants
    : s.online
        .filter((p) => p.room === selected)
        .map((p, i) => ({ ...p, identity: `online-${i}` }));
  $("connection").textContent =
    {
      idle: s.signedIn ? "Signed in" : "Not signed in",
      joined: "● Connected",
      joining: "Joining…",
      leaving: "Leaving…",
      reconnecting: "Reconnecting…",
    }[s.status] || s.status;
  $("connection").classList.toggle("connected", isJoined);
  $("heading").textContent = roomName(isJoined ? s.room : selected);
  $("welcome").hidden = isJoined;
  $("call-controls").hidden = !isJoined;
  $("leave").hidden = !isJoined && s.status !== "joining";
  $("leave").disabled = s.status === "leaving";
  setIcon(
    $("leave"),
    "phone-off",
    s.status === "joining" ? "Cancel join" : "Leave room",
  );
  $("join").disabled = busy;
  $("join").textContent = busy ? "Joining…" : `Join ${roomName(selected)}`;
  $("lobby-title").textContent = roomName(selected);
  $("lobby-status").textContent = users.length
    ? `${users.length} ${users.length === 1 ? "person" : "people"} in voice`
    : "No one is connected.";
  if (!isJoined) {
    const content = users
      .map(
        (p) =>
          `<div class="lobby-person">${avatar(p)}<span>${esc(p.name)}</span></div>`,
      )
      .join("");
    if ($("lobby-people").innerHTML !== content)
      $("lobby-people").innerHTML = content;
  }
  $("notice").textContent = s.error || s.onlineError || "";
  $("notice").hidden = !$("notice").textContent;
  $("preview-bar").hidden = !controller.demo;
  for (const b of document.querySelectorAll("[data-scene]"))
    b.setAttribute("aria-pressed", String(scene === b.dataset.scene));
  $("preview-jam").setAttribute("aria-pressed", String(jam.active));
  $("self-name").textContent = controller.demo
    ? "You"
    : controller.config?.name || "You";
  $("self-avatar").textContent = $("self-name")
    .textContent.slice(0, 2)
    .toUpperCase();
  $("local-state").textContent = s.deafened
    ? "Deafened"
    : s.micMuted
      ? "Mic off"
      : "Mic on";
  setIcon(
    $("mic"),
    s.micMuted ? "microphone-off" : "microphone",
    s.micMuted ? "Unmute mic" : "Mute mic",
  );
  $("mic").classList.toggle("muted-icon", s.micMuted);
  $("mic").setAttribute("aria-pressed", String(!s.micMuted));
  setIcon(
    $("deafen"),
    s.deafened ? "headphones-off" : "headphones",
    s.deafened ? "Undeafen" : "Deafen",
  );
  $("deafen").setAttribute("aria-pressed", String(s.deafened));
  setIcon(
    $("share"),
    s.sharing ? "screen-share-off" : "screen-share",
    s.sharing ? "Stop sharing" : "Share screen",
  );
  $("share").setAttribute("aria-pressed", String(s.sharing));
  setIcon(
    $("camera"),
    s.camera ? "video" : "video-off",
    s.camera ? "Turn camera off" : "Turn camera on",
  );
  $("camera").setAttribute("aria-pressed", String(!!s.camera));
  $("pg13").setAttribute("aria-pressed", String(!!s.data?.pg13));
  $("pg13").disabled = controller.demo || !isJoined;
  $("signout").hidden = !s.signedIn;
  $("foot-note").textContent = state.data?.pg13 ? "PG-13" : "";
  $("chat").classList.toggle("has-unread", !!state.data?.unread);
  $("chat").title = state.data?.unread
    ? `Chat · ${state.data.unread} unread`
    : "Chat";
  features?.sync();
  for (const b of document.querySelectorAll("[data-room]")) {
    b.disabled = busy;
    b.classList.toggle(
      "selected",
      b.dataset.room === (isJoined ? s.room : selected),
    );
    b.querySelector(".room-count").textContent =
      s.online.filter((p) => p.room === b.dataset.room).length || "";
  }
  renderPeople(users);
  renderMedia(users);
  if (!isJoined) {
    if (drawer) features?.dispose();
    drawer = null;
    jam.listening = false;
  }
  renderDrawer(users);
  if (!controller.demo) {
    const live = state.jam;
    $("jam-strip").hidden = !isJoined || !live?.server?.active;
    $("jam-track").textContent =
      live?.server?.now_playing?.name || "Queue empty";
    $("jam-artist").textContent = live?.ready
      ? live.server?.now_playing?.artist || ""
      : live?.listening
        ? "Connecting audio…"
        : live?.server?.spotify_device_name || "";
    setIcon(
      $("jam-listen"),
      live?.listening ? "logout" : "player-play",
      live?.listening ? "Leave Jam" : "Join Jam",
    );
    $("jam-volume").disabled = s.deafened;
    if (document.activeElement !== $("jam-volume"))
      $("jam-volume").value = controller.preferences.jamVolume ?? 30;
    $("jam-output").textContent =
      (controller.preferences.jamVolume ?? 30) + "%";
    return;
  }
  $("jam-strip").hidden = !isJoined || !jam.active;
  $("jam-track").textContent = jam.queue[0]?.title || "Queue empty";
  $("jam-artist").textContent = `${jam.queue[0]?.artist || ""} · ${jam.source}`;
  setIcon(
    $("jam-listen"),
    jam.listening ? "logout" : "player-play",
    jam.listening ? "Leave Jam" : "Join Jam",
  );
  $("jam-strip").classList.toggle("deafened", s.deafened);
  $("jam-volume").disabled = s.deafened;
  $("jam-volume").title = s.deafened ? "Deafened" : "Jam volume";
}
controller = new Controller(
  (name, args) => window.echo.call(name, args),
  render,
  (track, pub, p, removed = false) => {
    const id = track.sid || pub?.trackSid;
    if (removed) {
      media.delete(id);
      mediaNodes.get(id)?.remove();
      mediaNodes.delete(id);
      return;
    }
    const element = track.attach();
    element.autoplay = true;
    if (track.kind === "audio") {
      element.hidden = true;
      document.body.append(element);
    } else {
      element.controls = false;
      if (p.isLocal) element.muted = true;
      element.setAttribute(
        "aria-label",
        `${p.name || p.identity} shared screen`,
      );
      const screen =
        pub.source === "screen_share" ||
        parentIdentity(p.identity) !== p.identity;
      if (
        !p.isLocal &&
        controller.watchIntent.get(p.identity + ":" + pub.source) === false
      )
        hiddenSources.add(id);
      media.set(id, {
        id,
        element,
        participant: p,
        publication: pub,
        owner: p.isLocal ? "self" : parentIdentity(p.identity),
        name: p.isLocal ? "You" : p.name || p.identity,
        type: screen ? "screen" : "camera",
      });
    }
  },
);
features = createFeatureUI({ controller, esc, icon, ib, render });
for (const room of rooms) {
  const button = document.createElement("button");
  button.dataset.room = room;
  button.innerHTML = `<span>${roomName(room)}</span><span class="room-count"></span>`;
  button.onclick = () => {
    selectRoom(room);
    if (joined()) act({ action: "join", room });
    else render(state);
  };
  $("rooms").append(button);
}
$("join").onclick = async () => {
  if (!state.signedIn) $("setup").showModal();
  else {
    await act({ action: "join", room: selected });
    if (controller.demo) demoScenario(scene);
  }
};
for (const action of ["leave", "mic", "deafen", "share"])
  $(action).onclick = () => act({ action });
$("camera").onclick = () => act({ action: "camera" });
for (const name of ["audio", "chat", "jam", "soundboard"])
  $(name).onclick = () => openDrawer(name);
$("drawer-close").onclick = () => openDrawer(null);
$("toggle-people").onclick = () => ($("sidebar").hidden = !$("sidebar").hidden);
$("grid").onclick = () => {
  view = "grid";
  focused = null;
  render(state);
};
$("focus").onclick = () => {
  view = "focus";
  render(state);
};
$("fullscreen").onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await $("app").requestFullscreen();
  } catch (e) {
    controller.state.error =
      "Fullscreen is unavailable in this browser. Open the desktop app to use fullscreen.";
    controller.publish();
  }
};
document.addEventListener("fullscreenchange", () => {
  let exit = $("exit-fullscreen");
  if (document.fullscreenElement) {
    if (!exit) {
      exit = document.createElement("button");
      exit.id = "exit-fullscreen";
      exit.className = "icon-button fullscreen-exit";
      exit.innerHTML = icon("minimize");
      exit.title = "Exit fullscreen";
      exit.setAttribute("aria-label", "Exit fullscreen");
      exit.onclick = () => document.exitFullscreen();
      $("stage").append(exit);
    }
  } else {
    exit?.remove();
    $("fullscreen").focus();
  }
});
$("jam-open").onclick = () => openDrawer("jam");
$("jam-listen").onclick = () => {
  if (!controller.demo)
    return act({
      action: "jam",
      operation: state.jam?.listening ? "leave" : "join",
    });
  jam.listening = !jam.listening;
  render(state);
};
$("jam-volume").onchange = () => {
  if (!controller.demo)
    return act({
      action: "preferences",
      value: { jamVolume: Number($("jam-volume").value) },
    });
  jam.volume = Number($("jam-volume").value);
  $("jam-output").textContent = jam.volume + "%";
};
$("preview-jam").onclick = () => {
  jam.active = !jam.active;
  jam.listening = jam.active;
  render(state);
};
$("confirm-cancel").onclick = () => $("confirm").close();
$("confirm-end").onclick = () => {
  if (!controller.demo) {
    $("confirm").close();
    return act({ action: "jam", operation: "end" });
  }
  jam.active = false;
  jam.listening = false;
  jam.queue = [];
  $("confirm").close();
  render(state);
};
for (const b of document.querySelectorAll("[data-scene]"))
  b.onclick = () => demoScenario(b.dataset.scene);
$("settings").onclick = () => {
  if (joined()) {
    openDrawer("audio");
    return;
  }

  if (controller.demo) {
    openDrawer("audio");
    return;
  }
  if (state.status !== "idle") {
    controller.state.error = "Leave the room before changing your connection.";
    controller.publish();
  } else $("setup").showModal();
};
$("signout").onclick = async () => {
  await act({ action: "signout" });
  $("password").value = "";
  $("setup").showModal();
};
$("pg13").onclick = () => act({ action: "pg13", enabled: !state.data?.pg13 });
$("cancel-setup").onclick = () => $("setup").close();
$("setup-form").onsubmit = async (event) => {
  event.preventDefault();
  $("save").disabled = true;
  $("setup-error").textContent = "";
  try {
    await window.echo.call("login", {
      server: $("server").value,
      name: $("name").value,
      room: selected,
      password: $("password").value,
      remember: $("remember").checked,
    });
    controller.config.server = $("server").value;
    controller.config.name = $("name").value;
    controller.state.signedIn = true;
    controller.state.configured = true;
    controller.state.error = "";
    $("password").value = "";
    $("setup").close();
    await controller.poll();
    controller.publish();
  } catch (e) {
    $("setup-error").textContent = e.message;
  } finally {
    $("save").disabled = false;
  }
};
window.echo?.onCommand(async (c) => {
  if (c.action === "join") selectRoom(c.room || selected);
  await controller.command(c);
  if (controller.demo && c.action === "join") demoScenario(scene);
});
if (window.echo)
  controller
    .init()
    .then(async (initial) => {
      selectRoom(initial.config.room || "main");
      $("server").value = initial.config.server || "";
      $("name").value = initial.config.name || "";
      $("remember").disabled = !initial.canRemember;
      $("remember").checked = !!initial.remembered && initial.canRemember;
      $("remember-note").textContent = initial.canRemember
        ? "Encrypted using your desktop keyring."
        : "Desktop keyring unavailable. Password won’t be saved.";
      render(controller.state);
      if (!initial.demo && !state.signedIn) $("setup").showModal();
      if (browserPreview) {
        await controller.command({ action: "join", room: "main" });
        demoScenario("voice");
      }
      if (matchMedia("(max-width:620px)").matches) $("sidebar").hidden = true;
    })
    .catch((e) => {
      $("notice").hidden = false;
      $("notice").textContent = e.message;
    });
else {
  $("notice").hidden = false;
  $("notice").textContent =
    "Open the desktop app, or add ?preview to view the design preview.";
}
