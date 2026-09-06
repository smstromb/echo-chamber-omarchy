import { Room, Track, LocalAudioTrack, LocalVideoTrack } from "livekit-client";
window.connectPeer = async (url, token, screenToken) => {
  const room = new Room();
  window.receivedData = [];
  room.on("dataReceived", (data, p) =>
    window.receivedData.push({
      message: JSON.parse(new TextDecoder().decode(data)),
      identity: p.identity,
    }),
  );
  await room.connect(url, token);
  const audio = new AudioContext();
  await audio.resume();
  const oscillator = audio.createOscillator();
  oscillator.frequency.value = 440;
  const gain = audio.createGain();
  gain.gain.value = 0.15;
  const output = audio.createMediaStreamDestination();
  oscillator.connect(gain).connect(output);
  oscillator.start();
  await room.localParticipant.publishTrack(
    new LocalAudioTrack(output.stream.getAudioTracks()[0]),
    { source: Track.Source.Microphone },
  );
  const screen = new Room();
  await screen.connect(url, screenToken);
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 360;
  document.body.append(canvas);
  const ctx = canvas.getContext("2d");
  let x = 0;
  setInterval(() => {
    ctx.fillStyle = "#263521";
    ctx.fillRect(0, 0, 640, 360);
    ctx.fillStyle = "#c9ec9f";
    ctx.fillRect(x++ % 600, 120, 40, 80);
  }, 50);
  await screen.localParticipant.publishTrack(
    new LocalVideoTrack(canvas.captureStream(20).getVideoTracks()[0]),
    { source: Track.Source.ScreenShare },
  );
  window.peerRooms = [room, screen];
  return true;
};
