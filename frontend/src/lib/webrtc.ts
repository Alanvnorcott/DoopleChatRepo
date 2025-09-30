/**
 * Architect note:
 * WebRTC helper: create RTCPeerConnection, manage media tracks, data channel,
 * ICE timeout, and clean teardown. Minimal surface for app needs.
 */

export interface TurnConfig {
  host: string;
  username: string;
  credential: string;
}

export interface WebRTCConfig {
  turn: TurnConfig;
  iceTimeoutMs?: number; // default 20000
}

export interface PeerBundle {
  pc: RTCPeerConnection;
  data?: RTCDataChannel;
  localStream?: MediaStream;
  remoteStream?: MediaStream;
  destroy: () => void;
}

export function createPeer(config: WebRTCConfig, mode: "text" | "video"): PeerBundle {
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: ["stun:stun.l.google.com:19302"] },
      { urls: [`turn:${config.turn.host}:3478`], username: config.turn.username, credential: config.turn.credential }
    ],
    iceTransportPolicy: "all",
  });

  const bundle: PeerBundle = {
    pc,
    destroy: () => {
      try { bundle.data?.close(); } catch {}
      pc.getSenders().forEach((s) => {
        try { s.track?.stop(); } catch {}
      });
      pc.getTransceivers().forEach((t) => {
        try { t.stop(); } catch {}
      });
      try { pc.close(); } catch {}
      bundle.localStream?.getTracks().forEach((t) => t.stop());
    },
  };

  if (mode === "text") {
    bundle.data = pc.createDataChannel("text");
  }

  // Prepare remote stream aggregation
  const remoteStream = new MediaStream();
  bundle.remoteStream = remoteStream;
  pc.ontrack = (ev) => {
    for (const track of ev.streams[0].getTracks()) {
      remoteStream.addTrack(track);
    }
  };

  return bundle;
}


