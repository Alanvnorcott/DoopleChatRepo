import { describe, it, expect } from "vitest";
import { createQueues, enqueueClient, tryMatch, removeFromQueues } from "../src/matchmaking";
import type { ClientInfo } from "../src/types";

function mk(sessionId: string, mode: "text"|"video", interests: string[] = []): ClientInfo {
  return {
    sessionId,
    mode,
    interests,
    ws: {} as any,
    ip: "test"
  };
}

describe("matchmaking", () => {
  it("pairs FIFO when no interests", () => {
    const q = createQueues();
    const map = new Map<string, ClientInfo>();
    const a = mk("a-1111-4111-8111-111111111111", "text");
    const b = mk("b-1111-4111-8111-111111111111", "text");
    map.set(a.sessionId, a); map.set(b.sessionId, b);
    enqueueClient(q, a); enqueueClient(q, b);
    const res = tryMatch(q, b, map);
    expect(res?.a).toBe(b.sessionId);
    expect(res?.b).toBe(a.sessionId);
  });

  it("prefers interest pool matches", () => {
    const q = createQueues();
    const map = new Map<string, ClientInfo>();
    const a = mk("a-1111-4111-8111-111111111111", "video", ["music"]);
    const b = mk("b-1111-4111-8111-111111111111", "video", ["music"]);
    const c = mk("c-1111-4111-8111-111111111111", "video");
    map.set(a.sessionId, a); map.set(b.sessionId, b); map.set(c.sessionId, c);
    enqueueClient(q, a); enqueueClient(q, c); enqueueClient(q, b);
    const res = tryMatch(q, b, map);
    expect(res && [res.a, res.b].includes(a.sessionId)).toBe(true);
  });

  it("removes from queues on leave", () => {
    const q = createQueues();
    const map = new Map<string, ClientInfo>();
    const a = mk("a-1111-4111-8111-111111111111", "text", ["a"]);
    map.set(a.sessionId, a);
    enqueueClient(q, a);
    removeFromQueues(q, a);
    const res = tryMatch(q, a, map);
    expect(res).toBeNull();
  });
});


