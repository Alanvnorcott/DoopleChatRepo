/**
 * Architect note:
 * Minimal resilient WebSocket client with exponential backoff.
 * Used for signaling with the backend.
 */

type Listener = (data: any) => void;

export class ResilientWS {
  private url: string;
  private ws: WebSocket | null = null;
  private listeners: Set<Listener> = new Set();
  private backoffMs = 500;
  private maxBackoffMs = 5000;
  private shouldRun = true;

  constructor(url: string) {
    this.url = url;
    this.connect();
  }

  private connect() {
    if (!this.shouldRun) return;
    this.ws = new WebSocket(this.url);
    this.ws.onopen = () => {
      this.backoffMs = 500;
    };
    this.ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(String(ev.data));
        for (const l of this.listeners) l(data);
      } catch {
        // ignore
      }
    };
    this.ws.onclose = () => {
      if (!this.shouldRun) return;
      setTimeout(() => this.connect(), this.backoffMs);
      this.backoffMs = Math.min(this.maxBackoffMs, this.backoffMs * 2);
    };
    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  send(obj: unknown) {
    const data = JSON.stringify(obj);
    this.ws?.send(data);
  }

  onMessage(listener: Listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  close() {
    this.shouldRun = false;
    this.ws?.close();
  }
}


