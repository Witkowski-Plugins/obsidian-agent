import { Plugin, WorkspaceLeaf } from "obsidian";
import { GatewayClient } from "./src/gateway";
import { ChatView, CHAT_VIEW_TYPE } from "./src/chat-view";
import { AdviseCareSettingTab } from "./src/settings";
import { DEFAULT_SETTINGS } from "./src/types";
import type { AdviseCareSettings } from "./src/types";

export default class AdviseCarePlugin extends Plugin {
  settings: AdviseCareSettings = { ...DEFAULT_SETTINGS };
  gateway: GatewayClient = new GatewayClient();

  // Token lives in memory only — never persisted to disk
  runtimeToken: string = "";

  async onload(): Promise<void> {
    await this.loadSettings();

    // Register chat view
    this.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf, this, this.gateway));

    // Ribbon icon
    this.addRibbonIcon("message-circle", "Open AdviseCare Chat", () => {
      this.activateChatView();
    });

    // Command
    this.addCommand({
      id: "open-advisecare-chat",
      name: "Open AdviseCare Chat",
      callback: () => this.activateChatView(),
    });

    // Settings tab
    this.addSettingTab(new AdviseCareSettingTab(this.app, this, this.gateway));

    // Auto-connect if URL is set (token will be empty until user enters it)
    if (this.settings.gatewayUrl) {
      // Delay to allow Obsidian to finish loading
      setTimeout(() => this.connectGateway(), 1000);
    }

    console.log("AdviseCare Agent loaded");
  }

  async onunload(): Promise<void> {
    this.gateway.disconnect();
    console.log("AdviseCare Agent unloaded");
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  connectGateway(): void {
    if (!this.settings.gatewayUrl || !this.runtimeToken) return;
    this.gateway.connect(this.settings.gatewayUrl, this.runtimeToken);
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
}
