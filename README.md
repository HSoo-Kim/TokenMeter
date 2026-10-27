<div align="center">

<img src="build/icon.png" width="96" alt="TokenMeter icon">

# TokenMeter

**Your AI subscription limits, together in the Windows tray.**

<p>
  <a href="https://github.com/HSoo-Kim/TokenMeter/releases/latest"><img src="https://img.shields.io/badge/Download-Windows%20x64-000000?style=for-the-badge" alt="Download TokenMeter for Windows x64"></a>
  <a href="https://github.com/HSoo-Kim/TokenMeter/releases/latest"><img src="https://img.shields.io/github/v/release/HSoo-Kim/TokenMeter?style=for-the-badge&label=Release&color=007ec6" alt="Latest release"></a>
  <a href="https://github.com/HSoo-Kim/TokenMeter/releases"><img src="https://img.shields.io/github/downloads/HSoo-Kim/TokenMeter/total?style=for-the-badge&label=Downloads&color=1E90FF" alt="Total GitHub release downloads"></a>
  <a href="https://github.com/HSoo-Kim/TokenMeter/stargazers"><img src="https://img.shields.io/github/stars/HSoo-Kim/TokenMeter?style=for-the-badge&label=Stars&logo=github&logoColor=white&color=000000" alt="GitHub stars"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-3DA639?style=for-the-badge" alt="MIT license"></a>
</p>

<p><b>English</b> · <a href="README.ko.md">한국어</a> · <a href="README.zh.md">中文</a></p>

<img src="docs/screenshot.png" width="420" alt="TokenMeter showing example Codex, Claude, Gemini web and Antigravity quotas">

<p><sub>Example accounts and quota values. The Downloads badge counts GitHub Release asset downloads.</sub></p>

</div>

TokenMeter is a Windows tray app for checking remaining Codex, Claude, Gemini web and Antigravity
quota without opening each service. Limits and reset times depend on what each provider returns.

## At a glance

| Feature | What it does |
|---|---|
| **One panel, separate quotas** | Shows Codex, Claude, Gemini web and Antigravity accounts together without combining their usage pools. A legacy Gemini CLI option is available for licensed Code Assist accounts. |
| **Limits and resets** | Displays available 5-hour, weekly and model-specific limits with remaining percentages and reset times when reported. |
| **Multiple accounts** | Add several accounts for the same service and drag their cards into order. |
| **Always at hand** | Open from the tray or with `Ctrl+Alt+U`. The ring gauge reflects the most-used limit; quota refreshes every 60 seconds by default. |
| **Make it yours** | Switch between dark and light themes, choose English, Korean or Chinese, change the shortcut and configure Windows startup. |
| **Updates on your terms** | Get a new-version notification and start a verified installer from the tray menu. |

## Quick Start

1. On Windows 10 or 11 (x64), download `TokenMeter-Setup-<version>.exe` from the [latest release](https://github.com/HSoo-Kim/TokenMeter/releases/latest).
2. Run the installer. It installs per user without administrator rights and lets you choose the install folder.
3. Click the tray icon or press `Ctrl+Alt+U`; use `+` to add an account. For Codex or Claude login, install the corresponding [`codex`](https://developers.openai.com/codex/cli) or [`claude`](https://docs.claude.com/en/docs/claude-code/overview) CLI.

The installer is unsigned, so Windows SmartScreen may show “Windows protected your PC”: choose
**More info → Run anyway**. Uninstall from Windows Settings → Apps; settings in `%APPDATA%\TokenMeter` are kept.

### Updates

Starting with 1.3.0, TokenMeter checks GitHub Releases at startup and every 6 hours. A new stable
version shows a Windows notification and an **Update to v...** item in the tray's right-click menu.
Click it to download the installer, verify its SHA-256 and size against GitHub's release metadata,
then install and restart in the same folder. Account settings and sign-ins are kept.
Only the update action installs anything; automatic checks do not install updates.
The tray menu also offers **Check for updates** and an automatic-check toggle.
Source runs or releases without a verifiable installer open the release page instead.

Versions 1.2.1 and older have no updater. Install 1.3.0 manually once to receive future notifications.

### From source

```
git clone https://github.com/HSoo-Kim/TokenMeter.git
cd TokenMeter
npm install
npm start        # run it
npm run dist     # build dist/TokenMeter-Setup-<version>.exe
```

[Node.js](https://nodejs.org) 20+ is required for this path. `TokenMeter.cmd` starts the app the same way
`npm start` does.

## How it reads your quota

Codex and Claude use the OAuth credentials their CLIs already store on your machine. Expired tokens
are refreshed in the same file. Gemini web uses Google sign-in in an isolated TokenMeter browser session.
Antigravity is read through its running local language server; its login credentials are not copied.

| Provider | Credential file | Usage endpoint |
|---|---|---|
| Codex | `<home>/auth.json` | `chatgpt.com/backend-api/wham/usage` |
| Claude | `<home>/.credentials.json` | `api.anthropic.com/api/oauth/usage` |
| Gemini web | Isolated browser session in `<home>` | Gemini web usage GraphQL |
| Antigravity | Running, signed-in local app | Authenticated loopback quota RPC |
| Gemini CLI (legacy licensed Code Assist) | `<home>/oauth_creds.json` | `cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota` |

Claude reports per-model weekly limits too, so a `Weekly Opus` row appears whenever the API returns one.

### Google accounts

Use `+` to add **Gemini web** or connect **Antigravity**. These are separate quota pools, not one shared
subscription balance. Gemini web shows the reported 5-hour and weekly limits; sign in with Google in
the window that opens, then close it to refresh the card. Each account has its own session. Logging out
clears only that TokenMeter session, not Chrome. Antigravity must stay running and signed in. Its shared
local account cannot be logged out from TokenMeter. Unknown percentages or reset times are not invented.

Consumer Google login for Gemini CLI ended June 18, 2026. The CLI option is for existing licensed Code
Assist accounts, not Google AI Pro/Ultra web subscription quota. It requires the official `gemini` CLI;
run interactive Google sign-in and complete project setup there. For each new CLI account, TokenMeter
sets `GEMINI_CLI_HOME` to a separate base directory and reads its `.gemini/oauth_creds.json`.
An explicit project can be set in that folder's `settings.json` as `{"tokenmeter":{"project":"project-id"}}`.
Token refresh reads the OAuth client from the installed official CLI bundle, not from bundled credentials.
For a nonstandard installation, set `tokenmeter.cliPath` to the official Gemini CLI package directory.
See Google's [individual-account deprecation notice](https://developers.google.com/gemini-code-assist/docs/deprecations/code-assist-individuals).

## Accounts

Settings live in `%APPDATA%\TokenMeter\config.json`. One entry there is one account, and `home` is
that account's CLI credential folder:

```json
{
  "hotkey": "Ctrl+Alt+U",
  "theme": "dark",
  "lang": "en",
  "pollSeconds": 60,
  "accounts": [
    { "id": "codex-1", "type": "codex", "home": "~/.codex" },
    { "id": "codex-2", "type": "codex", "home": "~/.codex-2" },
    { "id": "claude-1", "type": "claude", "home": "~/.claude" }
  ]
}
```

- Drag a card up or down to reorder the list; the order is saved. The `⋯` menu also has Move up / Move down
- `⋯` on a card: log in (opens the provider's web OAuth flow), log out, open the credential folder, remove
- `+` in the header: add an account, which creates a new folder such as `~/.codex-2` and logs in there
- Logging in runs `codex login` / `claude auth login` with `CODEX_HOME` / `CLAUDE_CONFIG_DIR` pointed at that folder,
  so each account stays isolated and your existing CLI sessions are untouched
- Logging out deletes that credential file, which also signs out any CLI using the same folder

## Settings

Theme, language and hotkey are changed in the app and saved to `config.json`. The hotkey chip in the footer
records a new combination: click it, press the keys (one of Ctrl / Alt / Shift is required), `Esc` cancels.
If another app already owns the combination, the old one is kept.

The tray menu has **Open config.json** if you want to edit it by hand; do that with the app closed
(tray menu → Quit), then start it again.

## Development

```
set TOKENMETER_DEMO=1 && set TOKENMETER_SHOT=%CD%\docs\screenshot.png && npm start
```

Renders one frame with fake accounts, writes the PNG and exits. Drop `TOKENMETER_DEMO` to capture real data.

`npm run test:providers` runs the Google provider tests. `npm run test:ui` checks real renderer/preload
integration at short and tall desktop heights in both themes.

## License

MIT
