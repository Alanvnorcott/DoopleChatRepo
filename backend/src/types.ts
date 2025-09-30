/**
 * Architect note:
 * Shared types and message schemas for the Dooplechat signaling server.
 * This file contains strict TypeScript types for WebSocket messages and
 * internal server structures. No business logic lives here.
 */

export type ChatMode = "text" | "video";

export interface JoinMessage {
  type: "join";
  mode: ChatMode;
  sessionId: string;
  interests?: string[]; // lowercase interests
}

export interface LeaveMessage {
  type: "leave";
  sessionId: string;
}

export interface OfferMessage {
  type: "offer";
  to: string;
  sdp: string;
}

export interface AnswerMessage {
  type: "answer";
  to: string;
  sdp: string;
}

export interface IceMessage {
  type: "ice";
  to: string;
  candidate: unknown;
}

export interface RelayTextMessagePayload {
  text: string;
}

export interface RelayTextMessage {
  type: "message";
  to: string;
  payload: RelayTextMessagePayload;
}

export interface NextMessage {
  type: "next";
  sessionId: string;
}

export interface ReportMessage {
  type: "report";
  sessionId: string;
  reason: string;
}

export type IncomingMessage =
  | JoinMessage
  | LeaveMessage
  | OfferMessage
  | AnswerMessage
  | IceMessage
  | RelayTextMessage
  | NextMessage
  | ReportMessage;

export interface PairedNotification {
  type: "paired";
  peerSessionId: string;
}

export interface WaitingNotification {
  type: "waiting";
}

export interface ErrorNotification {
  type: "error";
  error: string;
}

export interface DebugNotification {
  type: "debug";
  message: string;
}

export type OutgoingMessage =
  | PairedNotification
  | WaitingNotification
  | ErrorNotification
  | DebugNotification
  | OfferMessage
  | AnswerMessage
  | IceMessage
  | RelayTextMessage;

export interface ClientInfo {
  sessionId: string;
  mode: ChatMode;
  interests: string[];
  ws: WebSocket;
  pairedWith?: string;
  ip: string;
}

export interface RateLimiterConfig {
  windowMs: number;
  max: number;
}


