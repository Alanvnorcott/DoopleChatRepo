/**
 * Architect note:
 * In-memory FIFO matchmaking with interest pools for Dooplechat.
 * Keeps separate queues for text and video, and interest-indexed pools.
 * No persistence. Suitable for single-instance deployments.
 */
export function createQueues() {
    return {
        waiting_text: [],
        waiting_video: [],
        interestPoolsText: new Map(),
        interestPoolsVideo: new Map(),
    };
}
export function enqueueClient(queues, client) {
    const isVideo = client.mode === "video";
    const waiting = isVideo ? queues.waiting_video : queues.waiting_text;
    const pools = isVideo ? queues.interestPoolsVideo : queues.interestPoolsText;
    // Add to interest pools
    for (const interest of client.interests) {
        const key = interest.trim().toLowerCase();
        if (!key)
            continue;
        const set = pools.get(key) ?? new Set();
        set.add(client.sessionId);
        pools.set(key, set);
    }
    // Add to general waiting tail
    waiting.push(client.sessionId);
}
export function removeFromQueues(queues, client) {
    const isVideo = client.mode === "video";
    const waiting = isVideo ? queues.waiting_video : queues.waiting_text;
    const pools = isVideo ? queues.interestPoolsVideo : queues.interestPoolsText;
    // Remove from general waiting
    const idx = waiting.indexOf(client.sessionId);
    if (idx >= 0)
        waiting.splice(idx, 1);
    // Remove from pools
    for (const interest of client.interests) {
        const key = interest.toLowerCase();
        const set = pools.get(key);
        if (set) {
            set.delete(client.sessionId);
            if (set.size === 0)
                pools.delete(key);
        }
    }
}
/**
 * Try to find a match for the given client. Strategy:
 * 1) Interest pools first: find any pool where another user exists; pair FIFO by general queue order among candidates.
 * 2) If no pool match within a short grace (handled by caller with timer), fall back to general queue head.
 */
export function tryMatch(queues, client, sessionIdToClient) {
    const isVideo = client.mode === "video";
    const waiting = isVideo ? queues.waiting_video : queues.waiting_text;
    const pools = isVideo ? queues.interestPoolsVideo : queues.interestPoolsText;
    // Candidate set from interest pools
    const candidateSet = new Set();
    for (const interest of client.interests) {
        const key = interest.toLowerCase();
        const set = pools.get(key);
        if (!set)
            continue;
        for (const sid of set) {
            if (sid !== client.sessionId)
                candidateSet.add(sid);
        }
    }
    // If have interest candidates, choose the one that appears earliest in the general waiting queue
    if (candidateSet.size > 0) {
        for (const sid of waiting) {
            if (sid === client.sessionId)
                continue;
            if (candidateSet.has(sid)) {
                // Remove both from queues and pools
                const other = sessionIdToClient.get(sid);
                if (!other || other.mode !== client.mode)
                    continue;
                removeFromQueues(queues, client);
                removeFromQueues(queues, other);
                return { a: client.sessionId, b: sid };
            }
        }
    }
    // Otherwise, try general queue head pairing (FIFO) with someone else of same mode
    for (const sid of waiting) {
        if (sid === client.sessionId)
            continue;
        const other = sessionIdToClient.get(sid);
        if (!other || other.mode !== client.mode)
            continue;
        removeFromQueues(queues, client);
        removeFromQueues(queues, other);
        return { a: client.sessionId, b: sid };
    }
    return null;
}
//# sourceMappingURL=matchmaking.js.map