export const rooms = ["main", "breakout-1", "breakout-2", "breakout-3"];
export const roomName = (id) =>
  id === "main" ? "Main" : id.replace("breakout-", "Breakout ");
export const parentIdentity = (id) =>
  id.replace(/\$(screen|native-presenter)$/, "");
export function volume(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw Error("Volume must be a number.");
  return Math.max(0, Math.min(300, n));
}
export function people(participants, mix = {}) {
  const all = [...participants];
  return all
    .filter((p) => parentIdentity(p.identity) === p.identity)
    .map((p) => {
      const companions = all.filter(
        (x) => parentIdentity(x.identity) === p.identity,
      );
      return {
        identity: p.identity,
        name: p.name || p.identity,
        self: !!p.isLocal,
        speaking: !!p.isSpeaking,
        micMuted: !p.isMicrophoneEnabled,
        sharing: companions.some(
          (x) =>
            x.isScreenShareEnabled ||
            [...(x.videoTrackPublications?.values() || [])].some(
              (t) =>
                !t.isMuted &&
                (t.source === "screen_share" || x.identity !== p.identity),
            ),
        ),
        level: p.audioLevel || 0,
        volume: mix[p.identity]?.volume ?? 100,
        muted: mix[p.identity]?.muted ?? false,
        screenVolume:
          mix[p.identity]?.screenVolume ?? mix[p.identity]?.volume ?? 100,
        screenMuted:
          mix[p.identity]?.screenMuted ?? mix[p.identity]?.muted ?? false,
        camera: !!p.isCameraEnabled,
      };
    })
    .sort(
      (a, b) => Number(b.self) - Number(a.self) || a.name.localeCompare(b.name),
    );
}
export function iconState(state) {
  if (["joined", "reconnecting"].includes(state.status)) return "joined";
  if (state.onlineError) return "unavailable";
  return state.online?.length ? "people-online" : "idle";
}
