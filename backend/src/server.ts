/**
 * Architect note:
 * Minimal Express + ws signaling server for Dooplechat.
 * - Serves health endpoint and (later) static frontend files.
 * - WebSocket endpoint `/ws` with JSON message protocol.
 * - In-memory matchmaking with interest pools and FIFO queues.
 * - Ephemeral report queue and simple IP-based rate limiter.
 * - No persistence; optional Redis added in separate module.
 */

import express from "express";
import cors from "cors";
import { WebSocketServer, WebSocket } from "ws";
import http from "http";
import { randomUUID } from "node:crypto";
import {
  type IncomingMessage,
  type OutgoingMessage,
  type ClientInfo,
  type ChatMode,
  type RateLimiterConfig,
} from "./types.js";
import {
  createQueues,
  enqueueClient,
  removeFromQueues,
  tryMatch,
  type MatchmakingQueues,
} from "./matchmaking.js";

const PORT = Number(process.env.PORT ?? 8080);
const NODE_ENV = process.env.NODE_ENV ?? "development";
const LOG_LEVEL = process.env.LOG_LEVEL ?? "info"; // "debug" | "info" | "warn" | "error"

function log(level: "debug" | "info" | "warn" | "error", msg: string, meta?: unknown) {
  const levels: Record<string, number> = { debug: 10, info: 20, warn: 30, error: 40 };
  const current = levels[LOG_LEVEL] ?? 20;
  if (levels[level] >= current) {
    const line = `[${level.toUpperCase()}] ${msg}`;
    if (meta) console.log(line, meta);
    else console.log(line);
  }
}

// Simple token bucket per IP
const rateLimiterConfig: RateLimiterConfig = { windowMs: 60_000, max: 30 };
const ipToWindow: Map<string, { windowStart: number; count: number }> = new Map();
function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const info = ipToWindow.get(ip);
  if (!info) {
    ipToWindow.set(ip, { windowStart: now, count: 1 });
    return true;
  }
  if (now - info.windowStart > rateLimiterConfig.windowMs) {
    ipToWindow.set(ip, { windowStart: now, count: 1 });
    return true;
  }
  info.count += 1;
  return info.count <= rateLimiterConfig.max;
}

const app = express();
app.use(cors());
app.use(express.json());

app.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true });
});

// Placeholder for static serving (frontend built files can be mounted here in docker-compose)
// app.use(express.static(path.join(__dirname, "..", "frontend_dist")));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const sessionIdToClient: Map<string, ClientInfo> = new Map();
const queues: MatchmakingQueues = createQueues();
const reportsQueue: Array<{ sessionId: string; reason: string; time: number; ip: string }> = [];

function isValidUuidV4(candidate: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate);
}

function send(ws: WebSocket, message: OutgoingMessage) {
  try {
    ws.send(JSON.stringify(message));
  } catch (err) {
    log("warn", "Failed to send WS message", err);
  }
}

function sanitizeInterests(interests?: unknown): string[] {
  if (!Array.isArray(interests)) return [];
  return interests
    .map((x) => (typeof x === "string" ? x.trim().toLowerCase() : ""))
    .filter(Boolean)
    .slice(0, 10);
}

function getIp(req: http.IncomingMessage): string {
  // ws exposes req.socket.remoteAddress; behind proxy you should trust X-Forwarded-For (not enabled by default)
  const raw = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0];
  return raw ?? (req.socket.remoteAddress ?? "unknown");
}

wss.on("connection", (ws, req) => {
  const origin = req.headers["origin"] as string | undefined;
  const allowed = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((s)=>s.trim()).filter(Boolean);
  if (origin && allowed.length > 0 && !allowed.includes(origin)) {
    ws.close();
    return;
  }
  const ip = getIp(req);

  ws.on("message", (data) => {
    let msg: IncomingMessage;
    try {
      msg = JSON.parse(String(data));
    } catch {
      send(ws, { type: "error", error: "invalid_json" });
      return;
    }

    if (!checkRateLimit(ip)) {
      send(ws, { type: "error", error: "rate_limited" });
      return;
    }

    switch (msg.type) {
      case "join": {
        const { sessionId, mode } = msg;
        if (!isValidUuidV4(sessionId)) {
          send(ws, { type: "error", error: "invalid_sessionId" });
          return;
        }
        if (mode !== "text" && mode !== "video") {
          send(ws, { type: "error", error: "invalid_mode" });
          return;
        }

        const interests = sanitizeInterests(msg.interests);
        const info: ClientInfo = { sessionId, mode, interests, ws, ip };
        sessionIdToClient.set(sessionId, info);
        enqueueClient(queues, info);

        // Interest grace: if user has interests and no immediate match, wait 1s before falling back
        const attemptMatch = () => {
          const current = sessionIdToClient.get(sessionId);
          if (!current) return;
          const attempt = tryMatch(queues, current, sessionIdToClient);
          if (attempt) {
            const a = sessionIdToClient.get(attempt.a);
            const b = sessionIdToClient.get(attempt.b);
            if (a && b) {
              a.pairedWith = b.sessionId;
              b.pairedWith = a.sessionId;
              send(a.ws, { type: "paired", peerSessionId: b.sessionId });
              send(b.ws, { type: "paired", peerSessionId: a.sessionId });
            }
          } else {
            send(ws, { type: "waiting" });
          }
        };

        if (interests.length > 0) {
          setTimeout(attemptMatch, 1_000);
        } else {
          attemptMatch();
        }
        break;
      }
      case "leave": {
        const c = sessionIdToClient.get(msg.sessionId);
        if (!c) return;
        // If paired, notify peer
        if (c.pairedWith) {
          const peer = sessionIdToClient.get(c.pairedWith);
          if (peer) {
            peer.pairedWith = undefined;
            send(peer.ws, { type: "debug", message: "peer_left" });
          }
        }
        removeFromQueues(queues, c);
        sessionIdToClient.delete(c.sessionId);
        break;
      }
      case "next": {
        const c = sessionIdToClient.get(msg.sessionId);
        if (!c) return;
        // tear down existing pairing
        if (c.pairedWith) {
          const peer = sessionIdToClient.get(c.pairedWith);
          if (peer) {
            peer.pairedWith = undefined;
            send(peer.ws, { type: "debug", message: "peer_skipped" });
            // Place peer back to tail
            enqueueClient(queues, peer);
          }
          c.pairedWith = undefined;
        }
        // Move requester to tail and try to match again (respect interest grace)
        removeFromQueues(queues, c);
        enqueueClient(queues, c);
        if (c.interests.length > 0) {
          setTimeout(() => {
            const attempt = tryMatch(queues, c, sessionIdToClient);
            if (attempt) {
              const a = sessionIdToClient.get(attempt.a);
              const b = sessionIdToClient.get(attempt.b);
              if (a && b) {
                a.pairedWith = b.sessionId;
                b.pairedWith = a.sessionId;
                send(a.ws, { type: "paired", peerSessionId: b.sessionId });
                send(b.ws, { type: "paired", peerSessionId: a.sessionId });
              }
            } else {
              send(c.ws, { type: "waiting" });
            }
          }, 1_000);
        } else {
          const attempt = tryMatch(queues, c, sessionIdToClient);
          if (attempt) {
            const a = sessionIdToClient.get(attempt.a);
            const b = sessionIdToClient.get(attempt.b);
            if (a && b) {
              a.pairedWith = b.sessionId;
              b.pairedWith = a.sessionId;
              send(a.ws, { type: "paired", peerSessionId: b.sessionId });
              send(b.ws, { type: "paired", peerSessionId: a.sessionId });
            }
          } else {
            send(c.ws, { type: "waiting" });
          }
        }
        break;
      }
      case "offer":
      case "answer":
      case "ice":
      case "message": {
        const to = (msg as any).to as string | undefined;
        if (!to) return;
        const peer = sessionIdToClient.get(to);
        if (!peer) return;
        send(peer.ws, msg as any);
        break;
      }
      case "report": {
        reportsQueue.push({ sessionId: msg.sessionId, reason: msg.reason, time: Date.now(), ip });
        // Close any active pairing of the reporter
        const c = sessionIdToClient.get(msg.sessionId);
        if (c && c.pairedWith) {
          const peer = sessionIdToClient.get(c.pairedWith);
          if (peer) {
            peer.pairedWith = undefined;
            send(peer.ws, { type: "debug", message: "peer_reported" });
          }
          c.pairedWith = undefined;
        }
        break;
      }
      default: {
        send(ws, { type: "error", error: "unknown_type" });
      }
    }
  });

  ws.on("close", () => {
    // Find the client by WebSocket and clean up
    for (const [sid, c] of sessionIdToClient.entries()) {
      if (c.ws === ws) {
        if (c.pairedWith) {
          const peer = sessionIdToClient.get(c.pairedWith);
          if (peer) {
            peer.pairedWith = undefined;
            send(peer.ws, { type: "debug", message: "peer_disconnected" });
            enqueueClient(queues, peer);
          }
        }
        removeFromQueues(queues, c);
        sessionIdToClient.delete(sid);
        break;
      }
    }
  });
});

server.listen(PORT, () => {
  log("info", `Dooplechat signaling server listening on :${PORT} (${NODE_ENV})`);
});


