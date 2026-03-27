import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type OcChatPlugin from "../main";
import type { GatewayClient } from "./gateway";

export class OcChatSettingTab extends PluginSettingTab {
  private plugin: OcChatPlugin;
  private gateway: GatewayClient;
  private tokenField: HTMLInputElement | null = null;

  constructor(app: App, plugin: OcChatPlugin, gateway: GatewayClient) {
    super(app, plugin);
    this.plugin = plugin;
    this.gateway = gateway;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "OpenClaw Chat Settings" });

    // Gateway URL
    new Setting(containerEl)
      .setName("Gateway URL")
      .setDesc("Your OpenClaw gateway URL. E.g. https://your-machine.your-tailnet.ts.net")
      .addText((text) =>
        text
          .setPlaceholder("https://your-gateway.ts.net")
          .setValue(this.plugin.settings.gatewayUrl)
          .onChange(async (value) => {
            this.plugin.settings.gatewayUrl = value.replace(/\/+$/, "");
            await this.plugin.saveSettings();
          })
      );

    // Token (in-memory only — never saved to disk)
    const tokenSetting = new Setting(containerEl)
      .setName("Gateway Token")
      .setDesc(
        "Authentication token. Stored in memory only — you will need to re-enter after restarting Obsidian."
      );

    tokenSetting.addText((text) => {
      this.tokenField = text.inputEl;
      text.inputEl.type = "password";
      text.inputEl.placeholder = "Paste your gateway token";
      text.inputEl.value = this.plugin.runtimeToken;
      text.inputEl.addEventListener("change", (e) => {
        this.plugin.runtimeToken = (e.target as HTMLInputElement).value.trim();
      });
    });

    // Agent name
    new Setting(containerEl)
      .setName("Agent Name")
      .setDesc("Display name for your AI agent")
      .addText((text) =>
        text
          .setPlaceholder("Agent")
          .setValue(this.plugin.settings.agentName)
          .onChange(async (value) => {
            this.plugin.settings.agentName = value || "Agent";
            await this.plugin.saveSettings();
          })
      );

    // Session key
    new Setting(containerEl)
      .setName("Session Key")
      .setDesc("Gateway session key (advanced — leave as default unless told otherwise)")
      .addText((text) =>
        text
          .setPlaceholder("obsidian:main")
          .setValue(this.plugin.settings.sessionKey)
          .onChange(async (value) => {
            this.plugin.settings.sessionKey = value || "obsidian:main";
            await this.plugin.saveSettings();
          })
      );

    // Test connection button
    new Setting(containerEl)
      .setName("Test Connection")
      .setDesc("Verify your gateway URL and token are working")
      .addButton((btn) =>
        btn
          .setButtonText("Test")
          .setCta()
          .onClick(async () => {
            const url = this.plugin.settings.gatewayUrl;
            const token = this.plugin.runtimeToken;

            if (!url) {
              new Notice("Enter a Gateway URL first.");
              return;
            }
            if (!token) {
              new Notice("Enter a Gateway Token first.");
              return;
            }

            btn.setButtonText("Testing…");
            btn.setDisabled(true);

            try {
              const result = await this.gateway.testConnection(url, token);
              new Notice(`✅ ${result}`);
              // Auto-connect on successful test
              this.plugin.connectGateway();
            } catch (e) {
              new Notice(`❌ ${(e as Error).message}`);
            } finally {
              btn.setButtonText("Test");
              btn.setDisabled(false);
            }
          })
      );

    // Status
    const status = containerEl.createDiv({ cls: "oc-status" });
    const connected = this.gateway.isConnected();
    status.setText(connected ? "● Connected to gateway" : "○ Not connected");
    status.style.color = connected ? "var(--color-green)" : "var(--text-muted)";
    status.style.marginTop = "12px";
    status.style.fontSize = "0.85em";
  }
}
