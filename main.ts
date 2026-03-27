import { Plugin, WorkspaceLeaf, TFile, Menu, Notice } from "obsidian";
import { GatewayManager } from "./src/gateway";
import { ChatView, CHAT_VIEW_TYPE } from "./src/chat-view";
import { OcChatSettingTab } from "./src/settings";
import { DEFAULT_SETTINGS } from "./src/types";
import type { OcChatSettings } from "./src/types";

export default class OcChatPlugin extends Plugin {
  settings: OcChatSettings = { ...DEFAULT_SETTINGS };
  gatewayManager: GatewayManager = new GatewayManager();

  // Tokens live in memory only — never persisted to disk
  tokenStore: Map<string, string> = new Map();

  async onload(): Promise<void> {
    await this.loadSettings();

    // Register chat view
    this.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf, this));

    // Ribbon icon
    this.addRibbonIcon("message-circle", "Open OpenClaw Chat", () => {
      this.activateChatView();
    });

    // Command: Open Chat
    this.addCommand({
      id: "open-oc-chat",
      name: "Open Chat",
      callback: () => this.activateChatView(),
    });

    // Commands: Switch to Agent: {name}
    this.registerAgentCommands();

    // Settings tab
    this.addSettingTab(new OcChatSettingTab(this.app, this));

    // Right-click on file: "Ask Agent about this note"
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu: Menu, file: TFile) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        menu.addItem((item) => {
          item
            .setTitle("Ask Agent about this note")
            .setIcon("message-circle")
            .onClick(async () => {
              await this.askAgentAboutNote(file);
            });
        });
      })
    );

    // Auto-connect enabled agents that have URLs configured
    setTimeout(() => this.autoConnectAgents(), 1000);

    console.log("OpenClaw Chat v2 loaded");
  }

  async onunload(): Promise<void> {
    this.gatewayManager.disconnectAll();
    console.log("OpenClaw Chat v2 unloaded");
  }

  async loadSettings(): Promise<void> {
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    // Ensure agents array exists (migration from v1)
    if (!Array.isArray(this.settings.agents)) {
      this.settings.agents = [];
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  connectAgent(agentId: string): void {
    const agent = this.settings.agents.find((a) => a.id === agentId);
    if (!agent) return;
    const token = this.tokenStore.get(agentId);
    if (!agent.gatewayUrl || !token) return;
    this.gatewayManager.connectAgent(agentId, agent.gatewayUrl, token);
  }

  private autoConnectAgents(): void {
    for (const agent of this.settings.agents) {
      if (agent.enabled && agent.gatewayUrl && this.tokenStore.has(agent.id)) {
        this.connectAgent(agent.id);
      }
    }
  }

  private registerAgentCommands(): void {
    for (const agent of this.settings.agents) {
      if (!agent.enabled || !agent.name) continue;
      this.addCommand({
        id: `switch-agent-${agent.id}`,
        name: `Switch to Agent: ${agent.name}`,
        callback: async () => {
          await this.activateChatView();
          const view = this.getChatView();
          if (view) view.switchToAgent(agent.id);
        },
      });
    }
  }

  refreshChatView(): void {
    const view = this.getChatView();
    if (view) view.refresh();
  }

  private getChatView(): ChatView | null {
    const leaves = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE);
    if (leaves.length > 0) {
      return leaves[0].view as ChatView;
    }
    return null;
  }

  async activateChatView(): Promise<void> {
    const { workspace } = this.app;

    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(CHAT_VIEW_TYPE);

    if (leaves.length > 0) {
      leaf = leaves[0];
    } else {
      leaf = workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({ type: CHAT_VIEW_TYPE, active: true });
      }
    }

    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  private async askAgentAboutNote(file: TFile): Promise<void> {
    const content = await this.app.vault.cachedRead(file);

    if (!this.getChatView()) {
      await this.activateChatView();
    }

    const chatView = this.getChatView();
    if (!chatView) {
      new Notice("Could not open chat panel.");
      return;
    }

    const message = `I'd like to discuss this note:\n\n**${file.basename}**\n\n${content}`;
    await chatView.sendMessage(message);

    const leaves = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE);
    if (leaves.length > 0) {
      this.app.workspace.revealLeaf(leaves[0]);
    }
  }
}
