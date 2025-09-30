// Minimal shims to satisfy TypeScript during lightweight checks.
// If you install @types/node and other packages, this file can be removed.

declare const process: {
  env: { [key: string]: string | undefined };
};

declare module 'express';
declare module 'cors';
declare module 'ws';
declare module 'node:crypto';

// Relaxed IncomingMessage typing for small project checks
declare module 'http' {
  export interface IncomingMessage {
    headers: { [k: string]: string | string[] | undefined };
    socket: { remoteAddress?: string | undefined };
  }
  export function createServer(...args: any[]): any;
}

// WebSocket minimal typing
declare interface WebSocket {
  send(data: string): void;
  on(event: string, cb: (...args: any[]) => void): void;
  close(code?: number, reason?: string): void;
}
