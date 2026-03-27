import { App, Notice, PluginSettingTab, Setting, setIcon } from "obsidian";
import type OcChatPlugin from "../main";
import type { AgentConfig } from "./types";

export class OcChatSettingTab extends PluginSettingTab {
  private plugin: OcChatPlugin;

  constructor(app: App, plugin: OcChatPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("oc-settings");

    containerEl.createEl("h2", { text: "OpenClaw Chat — Agents" });
    containerEl.createEl("p", {
      text: "Configure one or more AI agents. Tokens are stored in memory only and must be re-entered after restarting Obsidian.",
      cls: "setting-item-description",
    });

    const agentList = containerEl.createDiv({ cls: "oc-agent-list" });

    for (const agent of this.plugin.settings.agents) {
      this.renderAgentCard(agentList, agent);
    }

    // Add Agent button
    new Setting(containerEl)
      .addButton((btn) =>
        btn
          .setButtonText("+ Add Agent")
          .setCta()
          .onClick(async () => {
            const id = crypto.randomUUID();
            const agent: AgentConfig = {
              id,
              name: "",
              gatewayUrl: "",
              sessionKey: "obsidian:main",
              enabled: true,
            };
            this.plugin.settings.agents.push(agent);
            await this.plugin.saveSettings();
            this.display();
          })
      );
  }

  private renderAgentCard(container: HTMLElement, agent: AgentConfig): void {
    const card = container.createDiv({ cls: "oc-agent-card" });

    const connected = this.plugin.gatewayManager.isConnected(agent.id);

    // Card header (always visible)
    const header = card.createDiv({ cls: "oc-agent-card-header" });

    header.createSpan({
      cls: `oc-status-dot ${connected ? "connected" : "disconnected"}`,
    });

    const titleEl = header.createSpan({
      cls: "oc-agent-card-title",
      text: agent.name || "Unnamed Agent",
    });

    const urlHint = header.createSpan({
      cls: "oc-agent-card-url",
      text: this.safeHostname(agent.gatewayUrl),
    });

    const expandBtn = header.createEl("button", {
      cls: "oc-agent-expand-btn clickable-icon",
      attr: { "aria-label": "Expand" },
    });
    setIcon(expandBtn, "chevron-down");

    // Card body (collapsed by default)
    const body = card.createDiv({ cls: "oc-agent-card-body collapsed" });

    const toggleExpand = () => {
      body.toggleClass("collapsed", !body.hasClass("collapsed"));
      expandBtn.toggleClass("expanded", !body.hasClass("collapsed"));
    };

    expandBtn.addEventListener("click", toggleExpand);
    header.addEventListener("click", (e) => {
      if (e.target === expandBtn || expandBtn.contains(e.target as Node)) return;
      toggleExpand();
    });

    // --- Fields ---

    // Name
    new Setting(body)
      .setName("Agent Name")
      .setDesc("Display name shown in chat tabs")
      .addText((text) =>
        text
          .setPlaceholder("e.g. Agent")
          .setValue(agent.name)
          .onChange(async (value) => {
            agent.name = value;
            titleEl.setText(value || "Unnamed Agent");
            await this.plugin.saveSettings();
          })
      );

    // Gateway URL
    new Setting(body)
      .setName("Gateway URL")
      .setDesc("Your OpenClaw gateway URL")
      .addText((text) =>
        text
          .setPlaceholder("https://your-gateway.ts.net")
          .setValue(agent.gatewayUrl)
          .onChange(async (value) => {
            agent.gatewayUrl = value.replace(/\/+$/, "");
            urlHint.setText(this.safeHostname(value));
            await this.plugin.saveSettings();
          })
      );

    // Token (memory-only)
    new Setting(body)
      .setName("Gateway Token")
      .setDesc("Stored in memory only — re-enter after restart")
      .addText((text) => {
        text.inputEl.type = "password";
        text.inputEl.placeholder = "Paste your gateway token";
        text.inputEl.value = this.plugin.tokenStore.get(agent.id) ?? "";
        text.inputEl.addEventListener("change", (e) => {
          const val = (e.target as HTMLInputElement).value.trim();
          if (val) {
            this.plugin.tokenStore.set(agent.id, val);
          } else {
            this.plugin.tokenStore.delete(agent.id);
          }
        });
      });

    // Session Key
    new Setting(body)
      .setName("Session Key")
      .setDesc("Advanced — leave as default unless told otherwise")
      .addText((text) =>
        text
          .setPlaceholder("obsidian:main")
          .setValue(agent.sessionKey)
          .onChange(async (value) => {
            agent.sessionKey = value || "obsidian:main";
            await this.plugin.saveSettings();
          })
      );

    // Enabled toggle
    new Setting(body)
      .setName("Enabled")
      .setDesc("Show this agent in chat tabs")
      .addToggle((toggle) =>
        toggle.setValue(agent.enabled).onChange(async (value) => {
          agent.enabled = value;
          await this.plugin.saveSettings();
          if (!value) {
            this.plugin.gatewayManager.disconnectAgent(agent.id);
          }
          this.plugin.refreshChatView();
        })
      );

    // Actions row
    const actions = body.createDiv({ cls: "oc-agent-actions" });

    // Test Connection
    const testBtn = actions.createEl("button", {
      cls: "mod-cta",
      text: "Test Connection",
    });
    testBtn.addEventListener("click", async () => {
      const url = agent.gatewayUrl;
      const token = this.plugin.tokenStore.get(agent.id);
      if (!url) { new Notice("Enter a Gateway URL first."); return; }
      if (!token) { new Notice("Enter a Gateway Token first."); return; }

      testBtn.setText("Testing…");
      testBtn.disabled = true;
      try {
        const client = this.plugin.gatewayManager.getClient(agent.id);
        const result = await client.testConnection(url, token);
        new Notice(`${agent.name || "Agent"}: ${result}`);
        this.plugin.connectAgent(agent.id);
        this.display();
      } catch (e) {
        new Notice(`${agent.name || "Agent"}: ${(e as Error).message}`);
      } finally {
        testBtn.setText("Test Connection");
        testBtn.disabled = false;
      }
    });

    // Delete
    const deleteBtn = actions.createEl("button", {
      cls: "mod-warning",
      text: "Delete Agent",
    });
    deleteBtn.addEventListener("click", async () => {
      if (!confirm(`Delete agent "${agent.name || "Unnamed"}"? This cannot be undone.`)) return;
      this.plugin.gatewayManager.removeAgent(agent.id);
      this.plugin.tokenStore.delete(agent.id);
      this.plugin.settings.agents = this.plugin.settings.agents.filter(
        (a) => a.id !== agent.id
      );
      await this.plugin.saveSettings();
      this.plugin.refreshChatView();
      this.display();
    });
  }

  private safeHostname(url: string): string {
    if (!url) return "No URL set";
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }
}
