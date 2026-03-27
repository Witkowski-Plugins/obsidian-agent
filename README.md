# OpenClaw Chat — Obsidian Plugin

Chat with your your OpenClaw AI agent directly from inside Obsidian.

## Features

- Real-time chat with your OpenClaw agent via WebSocket
- Clean sidebar chat panel
- Streaming responses
- Works on desktop and mobile
- Zero telemetry, zero external dependencies
- Token stored in memory only (never written to disk)

## Requirements

- An OpenClaw gateway running and accessible (via Tailscale or local network)
- Your gateway token

## Installation (via BRAT)

1. Install the **BRAT** plugin in Obsidian (Community Plugins → Browse → BRAT)
2. Open BRAT settings → **Add Beta Plugin**
3. Enter this repository URL: `https://github.com/Witkowski-Plugins/obsidian-agent`
4. Enable the plugin in Community Plugins settings

## Setup

1. Open Settings → **OpenClaw Chat**
2. Enter your **Gateway URL** (e.g. `https://your-machine.your-tailnet.ts.net`)
3. Enter your **Gateway Token** (re-required after each Obsidian restart)
4. Click **Test Connection** to verify
5. Click the message-circle icon in the ribbon to open the chat panel

## Usage

- Open the chat panel via the ribbon icon or command palette (`Open OpenClaw Chat`)
- Type your message and press **Enter** (or Shift+Enter for new line)
- Agent responses stream in real time
- Click **Clear** to reset the conversation

## Security

- Gateway token is **never written to disk** — it lives in memory only
- All communication goes directly to your configured gateway URL only
- No external servers, no analytics, no data collection

## Building from source

```bash
npm install
npm run build
```

Copy `main.js`, `manifest.json`, and `styles.css` to your vault's `.obsidian/plugins/openclaw-chat/` folder.
