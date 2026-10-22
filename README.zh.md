# TokenMeter

[English](README.md) · **中文** · [한국어](README.ko.md)

Windows 托盘应用，显示 Codex、Claude、Gemini 网页和 Antigravity 的剩余额度。

![TokenMeter](docs/screenshot.png)

- 点击托盘图标或按 `Ctrl+Alt+U` 打开／关闭面板（`Esc` 关闭）
- 托盘图标是环形进度条，取用量最高的窗口：绿色 < 50%，橙色 < 80%，再高为红色
- 每 60 秒自动刷新，开机自启动（均可配置）
- 深色／浅色主题，English / 中文 / 한국어，都在标题栏切换
- 同一服务的多个账号可并排显示，拖动卡片即可任意排序

## 安装

在 [Releases](https://github.com/HSoo-Kim/TokenMeter/releases) 下载 `TokenMeter-Setup-<版本>.exe` 并运行。
安装为当前用户级别，无需管理员权限，可自选安装目录。卸载在「设置 → 应用」中进行，
`%APPDATA%\TokenMeter` 里的配置会保留。

安装包未做代码签名，首次运行时 SmartScreen 会提示「Windows 已保护你的电脑」，
选择 **更多信息 → 仍要运行** 即可。

还需要安装你想跟踪的服务的 CLI，因为 TokenMeter 读取的正是它们保存的凭据：
[`codex`](https://developers.openai.com/codex/cli)、
[`claude`](https://docs.claude.com/en/docs/claude-code/overview)。系统需为 Windows 10 或 11。

### 从源码运行

```
git clone https://github.com/HSoo-Kim/TokenMeter.git
cd TokenMeter
npm install
npm start        # 运行
npm run dist     # 生成 dist/TokenMeter-Setup-<版本>.exe
```

这种方式需要 [Node.js](https://nodejs.org) 20+。`TokenMeter.cmd` 与 `npm start` 效果相同。

## 额度是怎么读到的

Codex 和 Claude 使用其 CLI 已保存在本机的 OAuth 凭据，并在原文件中刷新过期令牌。
Gemini 网页使用 TokenMeter 独立浏览器会话登录 Google。Antigravity 通过正在运行的本地语言服务器
读取额度，不复制其登录凭据。

| 服务 | 凭据文件 | 用量接口 |
|---|---|---|
| Codex | `<home>/auth.json` | `chatgpt.com/backend-api/wham/usage` |
| Claude | `<home>/.credentials.json` | `api.anthropic.com/api/oauth/usage` |
| Gemini 网页 | `<home>` 中的独立浏览器会话 | Gemini 网页用量 GraphQL |
| Antigravity | 正在运行且已登录的本地应用 | 经认证的本地额度 RPC |
| Gemini CLI（已有 Code Assist 许可） | `<home>/oauth_creds.json` | `cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota` |

Claude 还会返回按模型区分的每周额度，接口返回时就会多出一行 `每周 Opus`。

### Google 账号

点击 `+` 添加 **Gemini 网页**或连接 **Antigravity**。两者额度互相独立，不合并显示。
在打开的 Google 窗口登录后关闭窗口，即可刷新网页账号的 5 小时及每周额度。每个账号会话独立，
退出登录不会影响 Chrome。Antigravity 必须保持运行并已登录；TokenMeter 不提供共享应用账号的退出功能。
未返回的百分比或重置时间不会被猜测为可用额度。

个人账号的 Gemini CLI Google 登录已于 2026 年 6 月 18 日停止。CLI 选项仅用于已有 Code Assist
许可账号，不表示 Google AI Pro/Ultra 网页订阅额度。需安装官方 `gemini` CLI，完成交互式登录及项目设置。
新账号使用独立 `GEMINI_CLI_HOME` 下的 `.gemini/oauth_creds.json`。也可在该目录的 `settings.json`
设置 `{"tokenmeter":{"project":"project-id"}}`。
刷新令牌所需的 OAuth 客户端从已安装的官方 CLI 读取，不随应用分发。
非标准安装可在 `tokenmeter.cliPath` 指定官方 Gemini CLI 包目录。
参见 [Google 个人账号支持终止说明](https://developers.google.com/gemini-code-assist/docs/deprecations/code-assist-individuals)。

## 账号

配置保存在 `%APPDATA%\TokenMeter\config.json`。其中一条记录就是一个账号，`home` 是该账号的 CLI 凭据文件夹：

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

- 上下拖动卡片即可调整顺序，顺序会被保存；`⋯` 菜单里也有「上移 / 下移」
- 卡片上的 `⋯`：登录（打开官方网页 OAuth）、退出登录、打开凭据文件夹、从列表移除
- 标题栏的 `+`：添加账号，会新建 `~/.codex-2` 之类的文件夹并在其中登录
- 登录时会带上 `CODEX_HOME` / `CLAUDE_CONFIG_DIR` 执行 `codex login` / `claude auth login`，
  各账号互相隔离，不影响你已有的 CLI 会话
- 退出登录会删除该凭据文件，共用同一文件夹的 CLI 也会一并退出

## 设置

主题、语言和快捷键都在应用内修改，并保存到 `config.json`。底部的快捷键按钮可录制新组合：
点击后按下按键（必须含 Ctrl / Alt / Shift 之一），`Esc` 取消。若组合已被其他应用占用，则保留原设置。

托盘菜单里的「打开 config.json」可直接定位该文件；手工编辑前请先退出应用（托盘菜单 → 退出），改完再启动。

## 开发

```
set TOKENMETER_DEMO=1 && set TOKENMETER_SHOT=%CD%\docs\screenshot.png && npm start
```

用示例账号渲染一帧、保存 PNG 后退出。去掉 `TOKENMETER_DEMO` 则截取真实数据。

`npm run test:providers` 测试 Google 提供者，`npm run test:ui` 验证两种窗口高度、深浅主题及真实 preload IPC。

## 许可证

MIT
