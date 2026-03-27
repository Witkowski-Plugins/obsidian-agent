import { ItemView, WorkspaceLeaf, Notice, setIcon } from "obsidian";
import type { ChatMessage, AgentConfig, ChatEventPayload } from "./types";
import type { GatewayClient } from "./gateway";
import type OcChatPlugin from "../main";

export const CHAT_VIEW_TYPE = "oc-chat";

interface AgentChatState {
  messages: ChatMessage[];
  streamBuffer: string;
  streamMsgEl: HTMLElement | null;
  isStreaming: boolean;
}

export class ChatView extends ItemView {
  private plugin: OcChatPlugin;
  private activeAgentId: string | null = null;

  // Per-agent chat state (in-memory)
  private agentStates = new Map<string, AgentChatState>();

  // Per-agent listener references for cleanup
  private boundListeners = new Map<string, {
    chat: (payload: ChatEventPayload) => void;
    state: (connected: boolean) => void;
  }>();

  // DOM refs
  private tabBarEl: HTMLElement | null = null;
  private chatAreaEl: HTMLElement | null = null;
  private messagesEl: HTMLElement | null = null;
  private inputEl: HTMLTextAreaElement | null = null;
  private sendBtn: HTMLButtonElement | null = null;
  private statusEl: HTMLElement | null = null;
  private emptyStateEl: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: OcChatPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return CHAT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "OpenClaw Chat";
  }

  getIcon(): string {
    return "message-circle";
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("oc-chat-container");

    // Tab bar
    this.tabBarEl = container.createDiv({ cls: "oc-tab-bar" });

    // Chat area (messages + input) — hidden until agent selected
    this.chatAreaEl = container.createDiv({ cls: "oc-chat-area" });

    // Status bar with clear button
    const statusRow = this.chatAreaEl.createDiv({ cls: "oc-status-row" });
    this.statusEl = statusRow.createSpan({ cls: "oc-status-bar disconnected" });
    this.statusEl.setText("○ Disconnected");
    const clearBtn = statusRow.createEl("button", { cls: "oc-clear-btn", text: "Clear" });
    clearBtn.addEventListener("click", () => this.clearActiveChat());

    // Messages area
    this.messagesEl = this.chatAreaEl.createDiv({ cls: "oc-messages" });

    // Empty state (shown when no agents)
    this.emptyStateEl = container.createDiv({ cls: "oc-empty-state" });

    // Input area
    const inputArea = this.chatAreaEl.createDiv({ cls: "oc-input-area" });
    const inputRow = inputArea.createDiv({ cls: "oc-input-row" });

    this.inputEl = inputRow.createEl("textarea", {
      cls: "oc-input",
      attr: { placeholder: "Message…", rows: "2" },
    });

    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.handleSend();
      }
    });

    this.sendBtn = inputRow.createEl("button", { cls: "oc-send-btn" });
    setIcon(this.sendBtn, "send");
    this.sendBtn.setAttribute("aria-label", "Send");
    this.sendBtn.addEventListener("click", () => this.handleSend());

    // Build tabs and bind listeners
    this.buildTabs();
    this.bindAllAgentListeners();

    // Select first enabled agent
    const enabled = this.plugin.settings.agents.filter((a) => a.enabled);
    if (enabled.length > 0) {
      this.switchToAgent(enabled[0].id);
    } else {
      this.showEmptyState();
    }
  }

  /** Called by plugin when agent list changes */
  refresh(): void {
    this.unbindAllAgentListeners();
    this.buildTabs();
    this.bindAllAgentListeners();

    const enabled = this.plugin.settings.agents.filter((a) => a.enabled);
    if (enabled.length === 0) {
      this.activeAgentId = null;
      this.showEmptyState();
    } else if (!this.activeAgentId || !enabled.find((a) => a.id === this.activeAgentId)) {
      this.switchToAgent(enabled[0].id);
    } else {
      this.switchToAgent(this.activeAgentId);
    }
  }

  switchToAgent(agentId: string): void {
    this.activeAgentId = agentId;
    const agent = this.plugin.settings.agents.find((a) => a.id === agentId);
    if (!agent) return;

    // Hide empty state, show chat
    if (this.emptyStateEl) this.emptyStateEl.style.display = "none";
    if (this.chatAreaEl) this.chatAreaEl.style.display = "flex";

    // Update active tab
    this.tabBarEl?.querySelectorAll(".oc-tab").forEach((tab) => {
      tab.toggleClass("active", tab.getAttribute("data-agent-id") === agentId);
    });

    // Update input placeholder
    if (this.inputEl) {
      this.inputEl.placeholder = `Message ${agent.name || "Agent"}…`;
    }

    // Render messages
    this.renderMessages();
    this.updateStatus();

    // Show token warning if needed
    const hasToken = this.plugin.tokenStore.has(agentId);
    const connected = this.plugin.gatewayManager.isConnected(agentId);
    if (!hasToken && !connected) {
      this.showInlineWarning("Token not set — open Settings to enter your gateway token.");
    }
  }

  // ─── Tab bar ───

  private buildTabs(): void {
    if (!this.tabBarEl) return;
    this.tabBarEl.empty();

    const enabled = this.plugin.settings.agents.filter((a) => a.enabled);

    for (const agent of enabled) {
      const tab = this.tabBarEl.createDiv({
        cls: "oc-tab",
        attr: { "data-agent-id": agent.id },
      });

      const connected = this.plugin.gatewayManager.isConnected(agent.id);
      tab.createSpan({ cls: `oc-tab-dot ${connected ? "connected" : "disconnected"}` });
      tab.createSpan({ cls: "oc-tab-name", text: agent.name || "Agent" });

      tab.addEventListener("click", () => this.switchToAgent(agent.id));

      if (agent.id === this.activeAgentId) {
        tab.addClass("active");
      }
    }

    // "+" tab opens settings
    const addTab = this.tabBarEl.createDiv({ cls: "oc-tab oc-tab-add" });
    addTab.createSpan({ text: "+" });
    addTab.addEventListener("click", () => {
      (this.app as unknown as { setting: { open: () => void; openTabById: (id: string) => void } }).setting.open();
      (this.app as unknown as { setting: { open: () => void; openTabById: (id: string) => void } }).setting.openTabById("openclaw-chat");
    });
  }

  // ─── Listener management ───

  private bindAllAgentListeners(): void {
    for (const agent of this.plugin.settings.agents) {
      if (!agent.enabled) continue;
      this.bindAgentListeners(agent);
    }
  }

  private bindAgentListeners(agent: AgentConfig): void {
    if (this.boundListeners.has(agent.id)) return;
    const client = this.plugin.gatewayManager.getClient(agent.id);

    const chatListener = (payload: ChatEventPayload) => {
      this.handleChatEvent(agent.id, payload);
    };

    const stateListener = (connected: boolean) => {
      this.handleStateChange(agent.id, connected);
    };

    client.onChat(chatListener);
    client.onStateChange(stateListener);
    this.boundListeners.set(agent.id, { chat: chatListener, state: stateListener });
  }

  private unbindAllAgentListeners(): void {
    for (const [agentId, listeners] of this.boundListeners) {
      const client = this.plugin.gatewayManager.getClient(agentId);
      client.offChat(listeners.chat);
      client.offStateChange(listeners.state);
    }
    this.boundListeners.clear();
  }

  // ─── Event handlers ───

  private handleChatEvent(agentId: string, payload: ChatEventPayload): void {
    const state = this.getAgentState(agentId);

    // Filter out heartbeat responses
    if (payload.state === "final" && payload.message) {
      const text = payload.message.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("")
        .trim();
      if (text === "HEARTBEAT_OK" || text === "OK" || text === "NO_REPLY") {
        this.finishStream(agentId);
        if (agentId === this.activeAgentId) {
          this.setInputDisabled(false);
        }
        return;
      }
    }
    if (payload.state === "delta" && payload.message) {
      const text = payload.message.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("")
        .trim();
      if (text === "HEARTBEAT_OK" || text === "OK" || text === "NO_REPLY") {
        return;
      }
    }

    if (payload.state === "error") {
      this.finishStream(agentId);
      state.messages.push({
        role: "assistant",
        content: `Error: ${payload.errorMessage ?? "Unknown error"}`,
        timestamp: Date.now(),
      });
      if (agentId === this.activeAgentId) {
        this.renderMessages();
        this.setInputDisabled(false);
      }
      return;
    }

    if (payload.state === "delta" && payload.message) {
      const text = payload.message.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("");
      this.replaceStream(agentId, text);
    }

    if (payload.state === "final") {
      if (payload.message) {
        const text = payload.message.content
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("");
        this.replaceStream(agentId, text);
      }
      this.finishStream(agentId);
      if (agentId === this.activeAgentId) {
        this.setInputDisabled(false);
      }
    }
  }

  private handleStateChange(agentId: string, connected: boolean): void {
    // Update tab dot
    const tab = this.tabBarEl?.querySelector(`[data-agent-id="${agentId}"]`);
    const dot = tab?.querySelector(".oc-tab-dot");
    if (dot) {
      dot.className = `oc-tab-dot ${connected ? "connected" : "disconnected"}`;
    }

    if (agentId === this.activeAgentId) {
      this.updateStatus();
      if (!connected) {
        const state = this.getAgentState(agentId);
        if (state.isStreaming) {
          this.finishStream(agentId);
          this.setInputDisabled(false);
        }
      }
    }
  }

  // ─── Streaming ───

  private replaceStream(agentId: string, fullText: string): void {
    const state = this.getAgentState(agentId);

    if (!state.isStreaming) {
      state.isStreaming = true;
      state.streamBuffer = "";
      state.streamMsgEl = null;
    }

    state.streamBuffer = fullText;

    // Only render if this is the active agent
    if (agentId === this.activeAgentId && this.messagesEl) {
      if (!state.streamMsgEl) {
        const agent = this.plugin.settings.agents.find((a) => a.id === agentId);
        const el = this.messagesEl.createDiv({
          cls: "oc-message oc-message-assistant oc-streaming",
        });
        el.createDiv({ cls: "oc-agent-label", text: agent?.name || "Agent" });
        state.streamMsgEl = el.createDiv({ cls: "oc-bubble" });
      }
      state.streamMsgEl.setText(state.streamBuffer);
      this.scrollToBottom();
    }
  }

  private finishStream(agentId: string): void {
    const state = this.getAgentState(agentId);
    if (!state.isStreaming) return;

    state.isStreaming = false;
    if (state.streamBuffer) {
      state.messages.push({
        role: "assistant",
        content: state.streamBuffer,
        timestamp: Date.now(),
      });
    }
    state.streamBuffer = "";
    state.streamMsgEl = null;

    if (agentId === this.activeAgentId) {
      this.renderMessages();
    }
  }

  // ─── Rendering ───

  private renderMessages(): void {
    if (!this.messagesEl || !this.activeAgentId) return;
    this.messagesEl.empty();

    const state = this.getAgentState(this.activeAgentId);
    const agent = this.plugin.settings.agents.find((a) => a.id === this.activeAgentId);

    for (const msg of state.messages) {
      this.renderMessage(msg, agent);
    }

    // Re-render active stream if any
    if (state.isStreaming && state.streamBuffer) {
      const el = this.messagesEl.createDiv({
        cls: "oc-message oc-message-assistant oc-streaming",
      });
      el.createDiv({ cls: "oc-agent-label", text: agent?.name || "Agent" });
      state.streamMsgEl = el.createDiv({ cls: "oc-bubble" });
      state.streamMsgEl.setText(state.streamBuffer);
    }

    this.scrollToBottom();
  }

  private renderMessage(msg: ChatMessage, agent?: AgentConfig): void {
    if (!this.messagesEl) return;
    const el = this.messagesEl.createDiv({
      cls: `oc-message oc-message-${msg.role}`,
    });

    if (msg.role === "assistant") {
      el.createDiv({ cls: "oc-agent-label", text: agent?.name || "Agent" });
    }

    const bubble = el.createDiv({ cls: "oc-bubble" });
    bubble.setText(msg.content);

    // Timestamp on hover
    const ts = new Date(msg.timestamp);
    const timeStr = ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    bubble.setAttribute("title", timeStr);
  }

  private updateStatus(): void {
    if (!this.statusEl || !this.activeAgentId) return;
    const connected = this.plugin.gatewayManager.isConnected(this.activeAgentId);
    this.statusEl.setText(connected ? "● Connected" : "○ Disconnected");
    this.statusEl.className = `oc-status-bar ${connected ? "connected" : "disconnected"}`;
  }

  private showEmptyState(): void {
    if (this.chatAreaEl) this.chatAreaEl.style.display = "none";
    if (!this.emptyStateEl) return;
    this.emptyStateEl.style.display = "flex";
    this.emptyStateEl.empty();

    this.emptyStateEl.createDiv({ cls: "oc-empty-icon" });
    setIcon(this.emptyStateEl.querySelector(".oc-empty-icon") as HTMLElement, "message-circle");
    this.emptyStateEl.createDiv({
      cls: "oc-empty-title",
      text: "No agents configured",
    });
    const link = this.emptyStateEl.createEl("a", {
      cls: "oc-empty-link",
      text: "Open Settings to add an agent",
    });
    link.addEventListener("click", () => {
      (this.app as unknown as { setting: { open: () => void; openTabById: (id: string) => void } }).setting.open();
      (this.app as unknown as { setting: { open: () => void; openTabById: (id: string) => void } }).setting.openTabById("openclaw-chat");
    });
  }

  private showInlineWarning(text: string): void {
    if (!this.messagesEl) return;
    // Only show if no messages exist
    const state = this.getAgentState(this.activeAgentId!);
    if (state.messages.length > 0) return;

    const warn = this.messagesEl.createDiv({ cls: "oc-token-warning" });
    const warningText = warn.createSpan({ text: "⚠ " + text + " " });
    const link = warningText.createEl("a", { cls: "oc-settings-link", text: "Open Settings" });
    link.addEventListener("click", () => {
      (this.app as unknown as { setting: { open: () => void; openTabById: (id: string) => void } }).setting.open();
      (this.app as unknown as { setting: { open: () => void; openTabById: (id: string) => void } }).setting.openTabById("openclaw-chat");
    });
  }

  // ─── Input ───

  private async handleSend(): Promise<void> {
    const text = this.inputEl?.value?.trim();
    if (!text || !this.activeAgentId) return;

    const agent = this.plugin.settings.agents.find((a) => a.id === this.activeAgentId);
    if (!agent) return;

    const client = this.plugin.gatewayManager.getClient(this.activeAgentId);

    if (!client.isConnected()) {
      new Notice("Not connected to gateway. Check Settings.");
      return;
    }

    const token = this.plugin.tokenStore.get(this.activeAgentId);
    if (!token) {
      new Notice("Gateway token not set. Open Settings to enter it.");
      return;
    }

    const state = this.getAgentState(this.activeAgentId);
    state.messages.push({ role: "user", content: text, timestamp: Date.now() });
    this.renderMessages();
    if (this.inputEl) this.inputEl.value = "";
    this.setInputDisabled(true);

    try {
      await client.sendChat(agent.sessionKey, text);
    } catch (e) {
      this.finishStream(this.activeAgentId);
      state.messages.push({
        role: "assistant",
        content: `Failed to send: ${(e as Error).message}`,
        timestamp: Date.now(),
      });
      this.renderMessages();
      this.setInputDisabled(false);
    }
  }

  private setInputDisabled(disabled: boolean): void {
    if (this.inputEl) this.inputEl.disabled = disabled;
    if (this.sendBtn) this.sendBtn.disabled = disabled;
  }

  // ─── Agent state ───

  private getAgentState(agentId: string): AgentChatState {
    let state = this.agentStates.get(agentId);
    if (!state) {
      state = {
        messages: [],
        streamBuffer: "",
        streamMsgEl: null,
        isStreaming: false,
      };
      this.agentStates.set(agentId, state);
    }
    return state;
  }

  /** Send a message programmatically as the user (used by "Ask Agent about this note") */
  async sendMessage(text: string): Promise<void> {
    if (!this.activeAgentId) return;
    const agent = this.plugin.settings.agents.find((a) => a.id === this.activeAgentId);
    if (!agent) return;
    const client = this.plugin.gatewayManager.getClient(this.activeAgentId);
    if (!client.isConnected()) {
      new Notice("Not connected to gateway. Check Settings.");
      return;
    }

    const state = this.getAgentState(this.activeAgentId);
    state.messages.push({ role: "user", content: text, timestamp: Date.now() });
    this.renderMessages();
    this.setInputDisabled(true);

    try {
      await client.sendChat(agent.sessionKey, text);
    } catch (e) {
      this.finishStream(this.activeAgentId);
      state.messages.push({
        role: "assistant",
        content: `Failed to send: ${(e as Error).message}`,
        timestamp: Date.now(),
      });
      this.renderMessages();
      this.setInputDisabled(false);
    }
  }

  clearActiveChat(): void {
    if (!this.activeAgentId) return;
    const state = this.getAgentState(this.activeAgentId);
    state.messages = [];
    state.streamBuffer = "";
    state.streamMsgEl = null;
    state.isStreaming = false;
    this.renderMessages();
  }

  // ─── Utils ───

  private scrollToBottom(): void {
    if (this.messagesEl) {
      requestAnimationFrame(() => {
        if (this.messagesEl) {
          this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
        }
      });
    }
  }

  async onClose(): Promise<void> {
    this.unbindAllAgentListeners();
  }
}
