import type { GatewayFrame, ChatEventPayload } from "./types";

type Listener<T> = (data: T) => void;

export class GatewayClient {
  private ws: WebSocket | null = null;
  private token: string = "";
  private gatewayUrl: string = "";
  private connected: boolean = false;
  private counter: number = 0;
  private pendingRequests = new Map<string, {
    resolve: (frame: GatewayFrame) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  private chatListeners: Listener<ChatEventPayload>[] = [];
  private stateListeners: Listener<boolean>[] = [];

  onChat(fn: Listener<ChatEventPayload>): void {
    this.chatListeners.push(fn);
  }

  onStateChange(fn: Listener<boolean>): void {
    this.stateListeners.push(fn);
  }

  private emitChat(payload: ChatEventPayload): void {
    for (const fn of this.chatListeners) fn(payload);
  }

  private emitState(state: boolean): void {
    this.connected = state;
    for (const fn of this.stateListeners) fn(state);
  }

  isConnected(): boolean {
    return this.connected;
  }

  private nextId(): string {
    return `oc-${++this.counter}-${Date.now()}`;
  }

  private toWsUrl(url: string): string {
    return url
      .replace(/^https:\/\//, "wss://")
      .replace(/^http:\/\//, "ws://")
      .replace(/\/+$/, "");
  }

  connect(gatewayUrl: string, token: string): void {
    this.disconnect();
    this.gatewayUrl = gatewayUrl;
    this.token = token;

    const wsUrl = this.toWsUrl(gatewayUrl);
    if (!wsUrl) {
      console.error("[OpenClaw] No gateway URL configured");
      return;
    }

    try {
      this.ws = new WebSocket(wsUrl);
    } catch (e) {
      console.error("[OpenClaw] WebSocket init error:", e);
      return;
    }

    this.ws.onopen = () => {
      // Wait for challenge event; if none in 3s, connect anyway
      setTimeout(() => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN && !this.connected) {
          this.sendConnect(null);
        }
      }, 3000);
    };

    this.ws.onmessage = (evt) => {
      this.handleMessage(evt.data);
    };

    this.ws.onclose = () => {
      this.emitState(false);
    };

    this.ws.onerror = () => {
      this.emitState(false);
    };
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      if (
        this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING
      ) {
        this.ws.close();
      }
      this.ws = null;
    }
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Disconnected"));
    }
    this.pendingRequests.clear();
    this.emitState(false);
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== "string") return;
    let frame: GatewayFrame;
    try {
      frame = JSON.parse(data) as GatewayFrame;
    } catch {
      return;
    }

    if (frame.type === "event") {
      if (frame.event === "connect.challenge") {
        const payload = frame.payload as { nonce?: string } | undefined;
        this.sendConnect(payload?.nonce ?? null);
      } else if (frame.event === "chat") {
        const payload = frame.payload as ChatEventPayload;
        this.emitChat(payload);
      }
    } else if (frame.type === "res" && frame.id) {
      const pending = this.pendingRequests.get(frame.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(frame.id);
        pending.resolve(frame);
      }
    }
  }

  private sendConnect(nonce: string | null): void {
    const id = this.nextId();
    const params: Record<string, unknown> = {
      minProtocol: 1,
      maxProtocol: 1,
      client: {
        id: "webchat",
        version: "1.0.0",
        platform: "obsidian",
        mode: "ui",
        displayName: "Obsidian",
      },
      role: "operator",
      scopes: ["operator.read", "operator.write"],
      auth: { token: this.token },
    };
    if (nonce) params.nonce = nonce;

    const frame: GatewayFrame = { type: "req", id, method: "connect", params };
    this.sendFrame(frame);

    // Wait for connect response
    this.pendingRequests.set(id, {
      resolve: (res) => {
        if (res.ok) {
          this.emitState(true);
        } else {
          console.error("[OpenClaw] Connect rejected:", res.error);
          this.emitState(false);
        }
      },
      reject: (err) => {
        console.error("[OpenClaw] Connect failed:", err);
      },
      timer: setTimeout(() => {
        this.pendingRequests.delete(id);
        console.error("[OpenClaw] Connect timed out");
      }, 10000),
    });
  }

  async sendChat(sessionKey: string, message: string): Promise<void> {
    const id = this.nextId();
    return new Promise((resolve, reject) => {
      const frame: GatewayFrame = {
        type: "req",
        id,
        method: "chat.send",
        params: {
          sessionKey,
          message,
          idempotencyKey: id,
        },
      };

      this.pendingRequests.set(id, {
        resolve: (res) => {
          if (res.ok) resolve();
          else reject(new Error(res.error?.message ?? "chat.send failed"));
        },
        reject,
        timer: setTimeout(() => {
          this.pendingRequests.delete(id);
          reject(new Error("chat.send timed out"));
        }, 15000),
      });

      this.sendFrame(frame);
    });
  }

  async testConnection(gatewayUrl: string, token: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const wsUrl = this.toWsUrl(gatewayUrl);
      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch (e) {
        reject(new Error("Invalid URL"));
        return;
      }

      const timer = setTimeout(() => {
        ws.close();
        reject(new Error("Connection timed out"));
      }, 8000);

      let challengeHandled = false;

      const tryConnect = (nonce: string | null) => {
        if (challengeHandled) return;
        challengeHandled = true;

        const id = `test-${Date.now()}`;
        const params: Record<string, unknown> = {
          minProtocol: 1,
          maxProtocol: 1,
          client: { id: "webchat", version: "1.0.0", platform: "obsidian", mode: "ui", displayName: "Obsidian" },
          role: "operator",
          scopes: ["operator.read", "operator.write"],
          auth: { token },
        };
        if (nonce) params.nonce = nonce;

        ws.send(JSON.stringify({ type: "req", id, method: "connect", params }));

        ws.onmessage = (evt) => {
          try {
            const frame = JSON.parse(evt.data as string) as GatewayFrame;
            if (frame.type === "res" && frame.id === id) {
              clearTimeout(timer);
              ws.close();
              if (frame.ok) resolve("Connected successfully");
              else reject(new Error(frame.error?.message ?? "Auth failed"));
            }
          } catch { /* ignore */ }
        };
      };

      ws.onopen = () => {
        setTimeout(() => tryConnect(null), 3000);
      };

      ws.addEventListener("message", (evt) => {
        try {
          const frame = JSON.parse(evt.data as string) as GatewayFrame;
          if (frame.type === "event" && frame.event === "connect.challenge") {
            const payload = frame.payload as { nonce?: string } | undefined;
            tryConnect(payload?.nonce ?? null);
          }
        } catch { /* ignore */ }
      });

      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error("Connection failed — check URL and that gateway is running"));
      };

      ws.onclose = () => {
        clearTimeout(timer);
      };
    });
  }

  private sendFrame(frame: GatewayFrame): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(frame));
    }
  }
}
