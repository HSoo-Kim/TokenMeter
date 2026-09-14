# TokenMeter

[English](README.md) · **中文** · [한국어](README.ko.md)

一个小巧的 Windows 托盘应用，实时显示 Codex 和 Claude 订阅额度还剩多少。

![TokenMeter](docs/screenshot.png)

- 点击托盘图标或按 `Ctrl+Alt+U` 打开／关闭面板（`Esc` 关闭）
- 托盘图标是环形进度条，取用量最高的窗口：绿色 < 50%，橙色 < 80%，再高为红色
- 每 60 秒自动刷新，开机自启动（均可配置）
- 深色／浅色主题，English / 中文 / 한국어，都在标题栏切换
- 同一服务的多个账号可并排显示

## 环境要求

- Windows 10/11、[Node.js](https://nodejs.org) 20+
- 需要跟踪哪家就装哪家的 CLI：[`codex`](https://developers.openai.com/codex/cli)、[`claude`](https://docs.claude.com/en/docs/claude-code/overview)

## 安装

```
git clone https://github.com/HSoo-Kim/TokenMeter.git
cd TokenMeter
npm install
npm start
```

也可以直接运行 `TokenMeter.cmd`，效果相同。

## 额度是怎么读到的

TokenMeter 不会索要密码。它读取各家 CLI 已经保存在本机的 OAuth 凭据，调用 CLI 同样使用的用量接口；
令牌过期时就地刷新并写回同一个文件，因此 CLI 仍能正常使用。

| 服务 | 凭据文件 | 用量接口 |
|---|---|---|
| Codex | `<home>/auth.json` | `chatgpt.com/backend-api/wham/usage` |
| Claude | `<home>/.credentials.json` | `api.anthropic.com/api/oauth/usage` |

Claude 还会返回按模型区分的每周额度，接口返回时就会多出一行 `每周 Opus`。

## 账号

`config.json` 里的一条记录就是一个账号，`home` 是该账号的 CLI 凭据文件夹：

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

- 卡片上的 `⋯`：登录（打开官方网页 OAuth）、退出登录、打开凭据文件夹、从列表移除
- 标题栏的 `+`：添加账号，会新建 `~/.codex-2` 之类的文件夹并在其中登录
- 登录时会带上 `CODEX_HOME` / `CLAUDE_CONFIG_DIR` 执行 `codex login` / `claude auth login`，
  各账号互相隔离，不影响你已有的 CLI 会话
- 退出登录会删除该凭据文件，共用同一文件夹的 CLI 也会一并退出

## 设置

主题、语言和快捷键都在应用内修改，并保存到 `config.json`。底部的快捷键按钮可录制新组合：
点击后按下按键（必须含 Ctrl / Alt / Shift 之一），`Esc` 取消。若组合已被其他应用占用，则保留原设置。

手工编辑 `config.json` 前请先退出应用（托盘菜单 → 退出），改完再启动。

## 开发

```
set TOKENMETER_DEMO=1 && set TOKENMETER_SHOT=%CD%\docs\screenshot.png && npm start
```

用示例账号渲染一帧、保存 PNG 后退出。去掉 `TOKENMETER_DEMO` 则截取真实数据。

## 许可证

MIT
