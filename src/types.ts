export interface AdviseCareSettings {
  gatewayUrl: string;
  agentName: string;
  sessionKey: string;
}

export const DEFAULT_SETTINGS: AdviseCareSettings = {
  gatewayUrl: "",
  agentName: "Max",
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
  delta?: string;
  done?: boolean;
  runId?: string;
  error?: string;
}
