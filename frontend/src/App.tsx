import React, { useEffect, useMemo, useRef, useState } from "react";
import t from "./i18n.json";
import { ResilientWS } from "./lib/wsClient";
import { v4 as uuidv4 } from "uuid";
import { createPeer, type WebRTCConfig, type PeerBundle } from "./lib/webrtc";
import { createSignaling } from "./lib/signaling";

type Mode = "idle" | "text" | "video";

const WS_URL = ((): string => {
  const loc = window.location;
  const proto = loc.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${loc.host}/ws`;
})();

const TURN: WebRTCConfig["turn"] = {
  host: (import.meta as any).env?.VITE_COTURN_HOST ?? "turn.example.com",
  username: (import.meta as any).env?.VITE_COTURN_USER ?? "user",
  credential: (import.meta as any).env?.VITE_COTURN_PASS ?? "pass",
};

export function App() {
  const [ageOk, setAgeOk] = useState<boolean | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [mode, setMode] = useState<Mode>("idle");
  const [sessionId] = useState(() => {
    try {
      let id = sessionStorage.getItem("doople:sessionId");
      if (!id) {
        id = uuidv4();
        sessionStorage.setItem("doople:sessionId", id);
      }
      return id;
    } catch {
      // sessionStorage may be unavailable in some environments; fallback to in-memory id
      return uuidv4();
    }
  });
  const [pairedWith, setPairedWith] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [interests, setInterests] = useState<string[]>([]);
  const [interestInput, setInterestInput] = useState("");

  const ws = useMemo(() => new ResilientWS(WS_URL), []);
  const signaling = useMemo(() => createSignaling(ws), [ws]);

  useEffect(() => {
    const off = ws.onMessage(async (msg) => {
      if (msg.type === "paired") {
        setPairedWith(msg.peerSessionId);
        setWaiting(false);
        // Decide initiator: lexicographically smaller sessionId becomes caller
        const iAmCaller = sessionId < msg.peerSessionId;
        if (mode === "video") {
          await ensurePeer("video");
        } else if (mode === "text") {
          await ensurePeer("text");
        }
        const bundle = peerRef.current!;
        if (mode === "text" && !bundle.data) {
          bundle.data = bundle.pc.createDataChannel("text");
        }
        wirePeerEvents();
        if (iAmCaller) {
          const offer = await bundle.pc.createOffer();
          await bundle.pc.setLocalDescription(offer);
          signaling.sendOffer(msg.peerSessionId, offer.sdp ?? "");
        }
      } else if (msg.type === "waiting") {
        setWaiting(true);
      } else if (msg.type === "debug") {
        // console.debug(msg.message)
      } else if (msg.type === "offer" && pairedWith === msg.to /* not needed */) {
        // ignore
      } else if (msg.type === "offer") {
        await ensurePeer(mode === "video" ? "video" : "text");
        const desc = new RTCSessionDescription({ type: "offer", sdp: msg.sdp });
        await peerRef.current!.pc.setRemoteDescription(desc);
        const answer = await peerRef.current!.pc.createAnswer();
        await peerRef.current!.pc.setLocalDescription(answer);
        signaling.sendAnswer(msg.to ?? sessionId, answer.sdp ?? "");
      } else if (msg.type === "answer") {
        if (peerRef.current) {
          const desc = new RTCSessionDescription({ type: "answer", sdp: msg.sdp });
          await peerRef.current.pc.setRemoteDescription(desc);
        }
      } else if (msg.type === "ice") {
        try {
          await peerRef.current?.pc.addIceCandidate(msg.candidate);
        } catch {
          // ignore
        }
      } else if (msg.type === "message") {
        // text fallback relay
        appendMessage({ from: "peer", text: sanitize(msg.payload?.text ?? "") });
      }
    });
    return () => off();
  }, [ws]);

  // Video state
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerRef = useRef<PeerBundle | null>(null);
  const [messages, setMessages] = useState<Array<{ from: "me"|"peer"; text: string; time: number }>>([]);
  const [textInput, setTextInput] = useState("");

  function appendMessage(m: { from: "me"|"peer"; text: string }){
    setMessages((prev)=> [...prev, { ...m, time: Date.now() }].slice(-200));
  }

  function sanitize(s: string){
    const div = document.createElement("div");
    div.innerText = s;
    return div.innerHTML;
  }

  function onAddInterest(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    const v = interestInput.trim().toLowerCase();
    if (!v) return;
    if (interests.includes(v)) { setInterestInput(""); return; }
    setInterests((prev) => [...prev, v].slice(0, 10));
    setInterestInput("");
  }

  function removeInterest(v: string) {
    setInterests((prev) => prev.filter((x) => x !== v));
  }

  function start(modeChosen: Mode) {
    if (ageOk !== true) return;
    setMode(modeChosen);
    // show searching state immediately while waiting for server response
    setWaiting(true);
    ws.send({ type: "join", mode: modeChosen, sessionId, interests });
  }

  function next() {
    if (!pairedWith) {
      ws.send({ type: "next", sessionId });
      return;
    }
    setPairedWith(null);
    ws.send({ type: "next", sessionId });
  }

  function report() {
    ws.send({ type: "report", sessionId, reason: "user_report" });
    setPairedWith(null);
  }

  async function startVideo() {
    if (mode !== "video") return;
    const bundle = createPeer({ turn: TURN }, "video");
    peerRef.current = bundle;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      bundle.localStream = stream;
      for (const track of stream.getTracks()) {
        bundle.pc.addTrack(track, stream);
      }
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        await localVideoRef.current.play().catch(() => undefined);
      }
    } catch {
      // permission denied or unavail
      return;
    }
  }

  async function ensurePeer(m: "text" | "video"){
    if (peerRef.current) return;
    const bundle = createPeer({ turn: TURN }, m);
    peerRef.current = bundle;
    wirePeerEvents();
  }

  function wirePeerEvents(){
    const bundle = peerRef.current!;
    bundle.pc.onicecandidate = (ev) => {
      if (ev.candidate && pairedWith) {
        signaling.sendIce(pairedWith, ev.candidate);
      }
    };
    bundle.pc.onconnectionstatechange = () => {
      if (bundle.pc.connectionState === "failed" || bundle.pc.connectionState === "disconnected"){
        // show hint
      }
    };
    bundle.pc.ondatachannel = (ev) => {
      bundle.data = ev.channel;
      setupDataChannel(bundle.data);
    };
    if (bundle.data) setupDataChannel(bundle.data);
    if (remoteVideoRef.current && bundle.remoteStream){
      remoteVideoRef.current.srcObject = bundle.remoteStream;
      remoteVideoRef.current.play().catch(()=>undefined);
    }
  }

  function setupDataChannel(ch: RTCDataChannel){
    ch.onmessage = (ev) => {
      appendMessage({ from: "peer", text: sanitize(String(ev.data)) });
    };
  }

  function sendText(){
    const text = textInput.trim();
    if (!text || !pairedWith) return;
    const ch = peerRef.current?.data;
    if (ch && ch.readyState === "open"){
      ch.send(text);
    } else {
      signaling.sendFallbackMessage(pairedWith, text);
    }
    appendMessage({ from: "me", text: sanitize(text) });
    setTextInput("");
  }

  function toggleMute() {
    const tracks = peerRef.current?.localStream?.getAudioTracks() ?? [];
    const to = !muted;
    tracks.forEach((t) => (t.enabled = !to));
    setMuted(to);
  }

  function toggleCamera() {
    const tracks = peerRef.current?.localStream?.getVideoTracks() ?? [];
    const to = !cameraOff;
    tracks.forEach((t) => (t.enabled = !to));
    setCameraOff(to);
  }

  // Age gate modal handlers
  function onAgeYes() { setAgeOk(true); }
  function onAgeNo() { setAgeOk(false); setBlocked(true); }

  const showAgeModal = ageOk === null && (mode === "text" || mode === "video" || true);

  return (
    <div className="container">
      <div className="card">
        <h1 className="title">{t.title}</h1>
        <p className="muted">{t.valueProp}</p>
        {blocked ? (
          <p>{t.blocked}</p>
        ) : (
          <>
            {mode === "idle" && (
              <div className="col">
                <div className="row">
                  <input className="input" placeholder={t.interestsPlaceholder} value={interestInput} onChange={(e)=>setInterestInput(e.target.value)} onKeyDown={onAddInterest} />
                  <button className="button ghost" onClick={()=>{ if(interestInput.trim()){ onAddInterest({ key: "Enter", preventDefault(){}, stopPropagation(){}} as any); } }}>Add</button>
                </div>
                <div className="chips" aria-live="polite">
                  {interests.map((v)=> (
                    <button key={v} className="chip" onClick={()=>removeInterest(v)} aria-label={`remove interest ${v}`}>{v} <span style={{opacity:0.7, marginLeft:8}}>✕</span></button>
                  ))}
                </div>
                <div className="row">
                  <button className="button" onClick={()=>{ setAgeOk(null); setMode("text"); }}>{t.startText}</button>
                  <button className="button secondary" onClick={()=>{ setAgeOk(null); setMode("video"); }}>{t.startVideo}</button>
                </div>
              </div>
            )}

            {(mode === "text" || mode === "video") && (
              <div className="col">
                <div className="row" style={{justifyContent:"space-between"}}>
                  <div style={{display:'flex',alignItems:'center',gap:12}}>
                    <div className="waiting-badge">{pairedWith ? `Paired` : waiting ? t.waiting : "Not connected"}</div>
                    {pairedWith && <div className="muted">{pairedWith}</div>}
                  </div>
                  <div className="toolbar">
                    {mode === "video" && (
                      <>
                        <button className="button ghost" onClick={startVideo}>{t.startVideoBtn}</button>
                        <button className="button ghost" onClick={toggleMute}>{muted ? t.unmute : t.mute}</button>
                        <button className="button ghost" onClick={toggleCamera}>{cameraOff ? t.cameraOn : t.cameraOff}</button>
                      </>
                    )}
                    <button className="button" onClick={next}>{t.next}</button>
                    <button className="button secondary" onClick={report}>{t.report}</button>
                  </div>
                </div>
                {mode === "video" && (
                  <div className="videos">
                    <video className="video" ref={localVideoRef} muted playsInline></video>
                    <video className="video" ref={remoteVideoRef} playsInline></video>
                  </div>
                )}
                {mode === "text" && (
                  <div className="col" style={{minHeight:200}}>
                    <div style={{border:"1px solid #233", borderRadius:10, padding:12, minHeight:160, maxHeight:240, overflowY:"auto"}}>
                      {messages.map((m,i)=> (
                        <div key={i} className="row" style={{justifyContent: m.from==='me'?'flex-end':'flex-start'}}>
                          <span className="chip" dangerouslySetInnerHTML={{__html: m.text}}></span>
                          <span className="muted" style={{fontSize:12}}>{new Date(m.time).toLocaleTimeString()}</span>
                        </div>
                      ))}
                    </div>
                    <div className="row">
                      <input className="input" value={textInput} onChange={(e)=>setTextInput(e.target.value)} onKeyDown={(e)=>{ if(e.key==='Enter') sendText(); }} />
                      <button className="button" onClick={sendText}>Send</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {showAgeModal && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3 style={{marginTop:0}}>{t.agePrompt}</h3>
            <div className="row" style={{justifyContent:"flex-end"}}>
              <button className="button ghost" onClick={onAgeNo}>{t.no}</button>
              <button className="button" onClick={()=>{ onAgeYes(); if(mode!=="idle") start(mode); }}>{t.yes}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


