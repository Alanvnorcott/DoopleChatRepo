/**
 * Architect note:
 * Redis-backed scalable matchmaking/signaling primitives.
 * This module documents keys and channels, and provides minimal helpers.
 * It does NOT fully replace server.ts wiring in this snippet; operators can
 * import and integrate these helpers when running multiple instances.
 */
import { createClient } from "redis";
/**
 * Key naming:
 * - queue:{mode} -> Redis list (LPUSH/BRPOP) for FIFO waiting users
 * - pool:{mode}:{interest} -> Redis set of sessionIds interested
 * - presence:{sessionId} -> string "1" with TTL (e.g., 30s) refreshed by heartbeat
 * Pub/Sub channels:
 * - signal:{sessionId} -> fanout for offers/answers/ice/messages targeting a session
 */
export async function connectRedis(cfg) {
    const client = createClient({ url: cfg.url });
    const sub = client.duplicate();
    const pub = client.duplicate();
    await client.connect();
    await sub.connect();
    await pub.connect();
    return {
        client,
        sub,
        pub,
        close: async () => {
            await Promise.all([sub.quit(), pub.quit(), client.quit()]);
        },
    };
}
export function queueKey(mode) {
    return `queue:${mode}`;
}
export function poolKey(mode, interest) {
    return `pool:${mode}:${interest}`;
}
export function presenceKey(sessionId) {
    return `presence:${sessionId}`;
}
export function signalChannel(sessionId) {
    return `signal:${sessionId}`;
}
export async function enqueue(mm, mode, sessionId, interests) {
    await mm.client.rPush(queueKey(mode), sessionId);
    for (const i of interests) {
        await mm.client.sAdd(poolKey(mode, i), sessionId);
    }
}
export async function removeFromAll(mm, mode, sessionId, interests) {
    await mm.client.lRem(queueKey(mode), 0, sessionId);
    for (const i of interests) {
        await mm.client.sRem(poolKey(mode, i), sessionId);
    }
}
export async function tryDequeuePair(mm, mode, sessionId, interests) {
    // Interest-first: check each interest set for another member present in queue
    for (const i of interests) {
        const members = await mm.client.sMembers(poolKey(mode, i));
        for (const candidate of members) {
            if (candidate === sessionId)
                continue;
            // Heuristic: ensure candidate is still in general queue
            const list = await mm.client.lRange(queueKey(mode), 0, -1);
            if (list.includes(candidate)) {
                await removeFromAll(mm, mode, sessionId, interests);
                // For candidate interests we don't know; remove candidate from queue only
                await mm.client.lRem(queueKey(mode), 0, candidate);
                return candidate;
            }
        }
    }
    // Fallback: pop head other than self
    const all = await mm.client.lRange(queueKey(mode), 0, -1);
    for (const id of all) {
        if (id !== sessionId) {
            await removeFromAll(mm, mode, sessionId, interests);
            await mm.client.lRem(queueKey(mode), 0, id);
            return id;
        }
    }
    return null;
}
//# sourceMappingURL=redisMatchmaking.js.map