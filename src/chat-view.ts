import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import type { ChatMessage } from "./types";
import type { GatewayClient } from "./gateway";
import type OcChatPlugin from "../main";

export const CHAT_VIEW_TYPE = "oc-chat";

export class ChatView extends ItemView {
  private plugin: OcChatPlugin;
  private gateway: GatewayClient;
  private messages: ChatMessage[] = [];
  private messagesEl: HTMLElement | null = null;
  private inputEl: HTMLTextAreaElement | null = null;
  private sendBtn: HTMLButtonElement | null = null;
  private statusEl: HTMLElement | null = null;
  private streamBuffer: string = "";
  private streamMsgEl: HTMLElement | null = null;
  private isStreaming: boolean = false;

  constructor(leaf: WorkspaceLeaf, plugin: OcChatPlugin, gateway: GatewayClient) {
    super(leaf);
    this.plugin = plugin;
    this.gateway = gateway;
  }

  getViewType(): string {
    return CHAT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return `${this.plugin.settings.agentName} — OpenClaw`;
  }

  getIcon(): string {
    return "message-circle";
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("oc-chat-container");

    // Header
    const header = container.createDiv({ cls: "oc-header" });
    header.createEl("span", {
      cls: "oc-header-title",
      text: this.plugin.settings.agentName,
    });

    const clearBtn = header.createEl("button", {
      cls: "oc-clear-btn",
      text: "Clear",
    });
    clearBtn.addEventListener("click", () => this.clearMessages());

    // Status bar
    this.statusEl = container.createDiv({ cls: "oc-status-bar" });
    this.updateStatus();

    // Messages area
    this.messagesEl = container.createDiv({ cls: "oc-messages" });

    // Render existing messages
    for (const msg of this.messages) {
      this.renderMessage(msg);
    }
    this.scrollToBottom();

    // Token warning if not set
    if (!this.plugin.runtimeToken) {
      this.showTokenWarning();
    }

    // Input area
    const inputArea = container.createDiv({ cls: "oc-input-area" });
    this.inputEl = inputArea.createEl("textarea", {
      cls: "oc-input",
      attr: { placeholder: `Message ${this.plugin.settings.agentName}…`, rows: "3" },
    });

    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.handleSend();
      }
    });

    this.sendBtn = inputArea.createEl("button", {
      cls: "oc-send-btn",
      text: "Send",
    });
    this.sendBtn.addEventListener("click", () => this.handleSend());

    // Listen for gateway events
    this.gateway.onChat((payload) => {
      if (payload.state === "error") {
        this.finishStream();
        this.addMessage({ role: "assistant", content: `Error: ${payload.errorMessage ?? "Unknown error"}`, timestamp: Date.now() });
        this.setInputDisabled(false);
        return;
      }
      if (payload.state === "delta" && payload.message) {
        const text = payload.message.content
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("");
        this.replaceStream(text);
      }
      if (payload.state === "final") {
        if (payload.message) {
          const text = payload.message.content
            .filter((c) => c.type === "text")
            .map((c) => c.text)
            .join("");
          this.replaceStream(text);
        }
        this.finishStream();
        this.setInputDisabled(false);
      }
    });

    this.gateway.onStateChange((connected) => {
      this.updateStatus();
      if (!connected && this.isStreaming) {
        this.finishStream();
        this.setInputDisabled(false);
      }
    });
  }

  private showTokenWarning(): void {
    if (!this.messagesEl) return;
    const warn = this.messagesEl.createDiv({ cls: "oc-token-warning" });
    warn.innerHTML = `⚠️ Gateway token not set. <a class="oc-settings-link">Open Settings</a> to enter your token.`;
    warn.querySelector(".oc-settings-link")?.addEventListener("click", () => {
      (this.app as unknown as { setting: { open: () => void; openTabById: (id: string) => void } }).setting.open();
      (this.app as unknown as { setting: { open: () => void; openTabById: (id: string) => void } }).setting.openTabById("openclaw-chat");
    });
  }

  private updateStatus(): void {
    if (!this.statusEl) return;
    const connected = this.gateway.isConnected();
    this.statusEl.setText(connected ? "● Connected" : "○ Disconnected");
    this.statusEl.className = `oc-status-bar ${connected ? "connected" : "disconnected"}`;
  }

  private renderMessage(msg: ChatMessage): void {
    if (!this.messagesEl) return;
    const el = this.messagesEl.createDiv({
      cls: `oc-message oc-message-${msg.role}`,
    });
    const bubble = el.createDiv({ cls: "oc-bubble" });
    bubble.setText(msg.content);
  }

  private replaceStream(fullText: string): void {
    if (!this.messagesEl) return;
    if (!this.isStreaming) {
      this.isStreaming = true;
      this.streamBuffer = "";
      const el = this.messagesEl.createDiv({
        cls: "oc-message oc-message-assistant oc-streaming",
      });
      this.streamMsgEl = el.createDiv({ cls: "oc-bubble" });
    }
    this.streamBuffer = fullText;
    if (this.streamMsgEl) {
      this.streamMsgEl.setText(this.streamBuffer);
    }
    this.scrollToBottom();
  }

  private finishStream(): void {
    if (!this.isStreaming) return;
    this.isStreaming = false;
    if (this.streamBuffer) {
      this.messages.push({
        role: "assistant",
        content: this.streamBuffer,
        timestamp: Date.now(),
      });
    }
    this.streamBuffer = "";
    this.streamMsgEl = null;
    // Remove streaming class
    this.messagesEl?.querySelector(".oc-streaming")?.removeClass("oc-streaming");
  }

  private addMessage(msg: ChatMessage): void {
    this.messages.push(msg);
    this.renderMessage(msg);
    this.scrollToBottom();
  }

  private async handleSend(): Promise<void> {
    const text = this.inputEl?.value?.trim();
    if (!text) return;

    if (!this.gateway.isConnected()) {
      new Notice("Not connected to gateway. Check Settings.");
      return;
    }
    if (!this.plugin.runtimeToken) {
      new Notice("Gateway token not set. Open Settings to enter it.");
      return;
    }

    this.addMessage({ role: "user", content: text, timestamp: Date.now() });
    if (this.inputEl) this.inputEl.value = "";
    this.setInputDisabled(true);

    try {
      await this.gateway.sendChat(this.plugin.settings.sessionKey, text);
    } catch (e) {
      this.finishStream();
      this.addMessage({ role: "assistant", content: `Failed to send: ${(e as Error).message}`, timestamp: Date.now() });
      this.setInputDisabled(false);
    }
  }

  private setInputDisabled(disabled: boolean): void {
    if (this.inputEl) this.inputEl.disabled = disabled;
    if (this.sendBtn) this.sendBtn.disabled = disabled;
  }

  private clearMessages(): void {
    this.messages = [];
    if (this.messagesEl) {
      this.messagesEl.empty();
      if (!this.plugin.runtimeToken) {
        this.showTokenWarning();
      }
    }
  }

  private scrollToBottom(): void {
    if (this.messagesEl) {
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }
  }

  async onClose(): Promise<void> {
    // nothing to clean up
  }
}
