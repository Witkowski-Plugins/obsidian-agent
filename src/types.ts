export interface OcChatSettings {
  gatewayUrl: string;
  agentName: string;
  sessionKey: string;
}

export const DEFAULT_SETTINGS: OcChatSettings = {
  gatewayUrl: "",
  agentName: "Agent",
  sessionKey: "obsidian:main",
};

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface GatewayFrame {
  type: "req" | "res" | "event";
  id?: string;
  method?: string;
  params?: unknown;
  ok?: boolean;
  error?: { code: string; message: string };
  event?: string;
  payload?: unknown;
}

export interface ChatEventPayload {
  runId: string;
  sessionKey: string;
  seq: number;
  state: "delta" | "final" | "error";
  message?: {
    role: "assistant";
    content: Array<{ type: string; text: string }>;
    timestamp: number;
  };
  errorMessage?: string;
}
