# TokenMeter

**English** · [中文](README.zh.md) · [한국어](README.ko.md)

A tiny Windows tray app that shows how much of your Codex and Claude subscription quota is left, live.

![TokenMeter](docs/screenshot.png)

- Click the tray icon or press `Ctrl+Alt+U` to toggle the panel (`Esc` closes it)
- The tray icon is a ring gauge for the most-used window: green < 50%, amber < 80%, red above
- Refreshes every 60 s and starts with Windows (both configurable)
- Dark / light theme, English / 中文 / 한국어 — switch from the header
- Multiple accounts of the same provider side by side

## Requirements

- Windows 10/11, [Node.js](https://nodejs.org) 20+
- The CLI for each provider you want to track: [`codex`](https://developers.openai.com/codex/cli), [`claude`](https://docs.claude.com/en/docs/claude-code/overview)

## Install

```
git clone https://github.com/HSoo-Kim/TokenMeter.git
cd TokenMeter
npm install
npm start
```

`TokenMeter.cmd` launches it the same way from Explorer or a shortcut.

## How it reads your quota

TokenMeter never asks for a password. It reads the OAuth credentials the provider CLIs already store on
your machine, calls the same usage endpoints the CLIs use, and refreshes an expired token in place so the
CLI keeps working from the same file.

| Provider | Credential file | Usage endpoint |
|---|---|---|
| Codex | `<home>/auth.json` | `chatgpt.com/backend-api/wham/usage` |
| Claude | `<home>/.credentials.json` | `api.anthropic.com/api/oauth/usage` |

Claude reports per-model weekly limits too, so a `Weekly Opus` row appears whenever the API returns one.

## Accounts

One entry in `config.json` is one account, and `home` is that account's CLI credential folder:

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

- `⋯` on a card: log in (opens the provider's web OAuth flow), log out, open the credential folder, remove
- `+` in the header: add an account, which creates a new folder such as `~/.codex-2` and logs in there
- Logging in runs `codex login` / `claude auth login` with `CODEX_HOME` / `CLAUDE_CONFIG_DIR` pointed at that folder,
  so each account stays isolated and your existing CLI sessions are untouched
- Logging out deletes that credential file, which also signs out any CLI using the same folder

## Settings

Theme, language and hotkey are changed in the app and saved to `config.json`. The hotkey chip in the footer
records a new combination: click it, press the keys (one of Ctrl / Alt / Shift is required), `Esc` cancels.
If another app already owns the combination, the old one is kept.

Edit `config.json` by hand only while the app is closed (tray menu → Quit), then start it again.

## Development

```
set TOKENMETER_DEMO=1 && set TOKENMETER_SHOT=%CD%\docs\screenshot.png && npm start
```

Renders one frame with fake accounts, writes the PNG and exits. Drop `TOKENMETER_DEMO` to capture real data.

## License

MIT
