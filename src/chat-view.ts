import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import type { ChatMessage } from "./types";
import type { GatewayClient } from "./gateway";
import type AdviseCarePlugin from "../main";

export const CHAT_VIEW_TYPE = "advisecare-chat";

export class ChatView extends ItemView {
  private plugin: AdviseCarePlugin;
  private gateway: GatewayClient;
  private messages: ChatMessage[] = [];
  private messagesEl: HTMLElement | null = null;
  private inputEl: HTMLTextAreaElement | null = null;
  private sendBtn: HTMLButtonElement | null = null;
  private statusEl: HTMLElement | null = null;
  private streamBuffer: string = "";
  private streamMsgEl: HTMLElement | null = null;
  private isStreaming: boolean = false;

  constructor(leaf: WorkspaceLeaf, plugin: AdviseCarePlugin, gateway: GatewayClient) {
    super(leaf);
    this.plugin = plugin;
    this.gateway = gateway;
  }

  getViewType(): string {
    return CHAT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return `${this.plugin.settings.agentName} — AdviseCare`;
  }

  getIcon(): string {
    return "message-circle";
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("advisecare-chat-container");

    // Header
    const header = container.createDiv({ cls: "advisecare-header" });
    header.createEl("span", {
      cls: "advisecare-header-title",
      text: this.plugin.settings.agentName,
    });

    const clearBtn = header.createEl("button", {
      cls: "advisecare-clear-btn",
      text: "Clear",
    });
    clearBtn.addEventListener("click", () => this.clearMessages());

    // Status bar
    this.statusEl = container.createDiv({ cls: "advisecare-status-bar" });
    this.updateStatus();

    // Messages area
    this.messagesEl = container.createDiv({ cls: "advisecare-messages" });

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
    const inputArea = container.createDiv({ cls: "advisecare-input-area" });
    this.inputEl = inputArea.createEl("textarea", {
      cls: "advisecare-input",
      attr: { placeholder: `Message ${this.plugin.settings.agentName}…`, rows: "3" },
    });

    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.handleSend();
      }
    });

    this.sendBtn = inputArea.createEl("button", {
      cls: "advisecare-send-btn",
      text: "Send",
    });
    this.sendBtn.addEventListener("click", () => this.handleSend());

    // Listen for gateway events
    this.gateway.onChat((payload) => {
      if (payload.error) {
        this.finishStream();
        this.addMessage({ role: "assistant", content: `Error: ${payload.error}`, timestamp: Date.now() });
        this.setInputDisabled(false);
        return;
      }
      if (payload.delta) {
        this.appendStream(payload.delta);
      }
      if (payload.done) {
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
    const warn = this.messagesEl.createDiv({ cls: "advisecare-token-warning" });
    warn.innerHTML = `⚠️ Gateway token not set. <a class="advisecare-settings-link">Open Settings</a> to enter your token.`;
    warn.querySelector(".advisecare-settings-link")?.addEventListener("click", () => {
      (this.app as unknown as { setting: { open: () => void; openTabById: (id: string) => void } }).setting.open();
      (this.app as unknown as { setting: { open: () => void; openTabById: (id: string) => void } }).setting.openTabById("advisecare-agent");
    });
  }

  private updateStatus(): void {
    if (!this.statusEl) return;
    const connected = this.gateway.isConnected();
    this.statusEl.setText(connected ? "● Connected" : "○ Disconnected");
    this.statusEl.className = `advisecare-status-bar ${connected ? "connected" : "disconnected"}`;
  }

  private renderMessage(msg: ChatMessage): void {
    if (!this.messagesEl) return;
    const el = this.messagesEl.createDiv({
      cls: `advisecare-message advisecare-message-${msg.role}`,
    });
    const bubble = el.createDiv({ cls: "advisecare-bubble" });
    bubble.setText(msg.content);
  }

  private appendStream(delta: string): void {
    if (!this.messagesEl) return;
    if (!this.isStreaming) {
      this.isStreaming = true;
      this.streamBuffer = "";
      const el = this.messagesEl.createDiv({
        cls: "advisecare-message advisecare-message-assistant advisecare-streaming",
      });
      this.streamMsgEl = el.createDiv({ cls: "advisecare-bubble" });
    }
    this.streamBuffer += delta;
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
    this.messagesEl?.querySelector(".advisecare-streaming")?.removeClass("advisecare-streaming");
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
