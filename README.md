# TokenMeter

**English** · [中文](README.zh.md) · [한국어](README.ko.md)

A Windows tray app showing remaining Codex, Claude, Gemini web and Antigravity quota.

![TokenMeter](docs/screenshot.png)

- Click the tray icon or press `Ctrl+Alt+U` to toggle the panel (`Esc` closes it)
- The tray icon is a ring gauge for the most-used window: green < 50%, amber < 80%, red above
- Refreshes every 60 s and starts with Windows (both configurable)
- Dark / light theme, English / 中文 / 한국어 — switch from the header
- Multiple accounts of the same provider side by side, dragged into whatever order you like

## Install

Download `TokenMeter-Setup-<version>.exe` from [Releases](https://github.com/HSoo-Kim/TokenMeter/releases)
and run it. It installs per user, so Windows asks for no administrator rights, and you can choose the
install folder. Uninstall from Windows Settings → Apps; your settings in `%APPDATA%\TokenMeter` are kept.

The installer is unsigned, so SmartScreen shows "Windows protected your PC" on first run:
choose **More info → Run anyway**.

You still need the CLI of each provider you want to track, because TokenMeter reads the credentials they
store: [`codex`](https://developers.openai.com/codex/cli),
[`claude`](https://docs.claude.com/en/docs/claude-code/overview). Windows 10 or 11 is required.

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
