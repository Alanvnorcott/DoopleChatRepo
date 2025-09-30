import { ResilientWS } from "./wsClient";

export interface Signaling {
  sendOffer: (to: string, sdp: string) => void;
  sendAnswer: (to: string, sdp: string) => void;
  sendIce: (to: string, candidate: unknown) => void;
  sendFallbackMessage: (to: string, text: string) => void;
}

export function createSignaling(ws: ResilientWS): Signaling {
  return {
    sendOffer: (to, sdp) => ws.send({ type: "offer", to, sdp }),
    sendAnswer: (to, sdp) => ws.send({ type: "answer", to, sdp }),
    sendIce: (to, candidate) => ws.send({ type: "ice", to, candidate }),
    sendFallbackMessage: (to, text) => ws.send({ type: "message", to, payload: { text } }),
  };
}


