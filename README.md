# 阅读队列 / Reading Queue

Chrome / Edge 扩展：右键把**链接**或**当前页面**加入阅读队列，关掉当前页后自动打开下一个，避免一次开几十个标签把浏览器卡死。

Chrome / Edge extension: right-click a **link** or the **current page** into a reading queue; closing a queue tab opens the next one so you don’t open dozens of tabs at once.

**仓库 / Repo:** https://github.com/ZhangJP-wh/chrome-reading-queue  
**版本 / Version:** **2.0.0**（见 `manifest.json`）

---

## 给电脑小白：一分钟安装（Mac 和 Windows 相同）

## For beginners: 1-minute install (same on Mac & Windows)

1. 打开本仓库页面 → 点绿色 **Code** → **Download ZIP**  
   Open this repo → green **Code** → **Download ZIP**
2. 解压 zip，得到文件夹（里面应有 `manifest.json`）  
   Unzip; the folder must contain `manifest.json`
3. 浏览器地址栏打开：`chrome://extensions`（Edge 用 `edge://extensions`）  
   Open `chrome://extensions` (Edge: `edge://extensions`)
4. 打开右上角 **开发者模式 / Developer mode**
5. 点 **加载已解压的扩展程序 / Load unpacked** → 选中解压后的那个文件夹  
   Click **Load unpacked** → select the unzipped folder
6. 若提示读取网站数据，点 **允许 / Allow**  
   If asked for site access, click **Allow**

装好后：
- 在**链接**上右键 → **将此链接加入到阅读队列**
- 在网页**空白处**右键 → **将当前页加入到阅读队列**（用已打开标签的真实标题，一般一步到位）
- 点工具栏图标打开列表

Then:
- Right-click a **link** → **将此链接加入到阅读队列**
- Right-click **page blank** → **将当前页加入到阅读队列** (uses the open tab’s real title)
- Click the toolbar icon for the list

---

## 给 AI Agent：把下面整段复制发给你的 Agent（安装指令）

## For AI Agents: paste this block to your Agent

把下面整段（含链接）发给 Cursor / Grok / ChatGPT 等任意能操作本机的 Agent：

Copy everything below (including the URL) to any Agent that can operate the user’s computer:

```text
Please install this Chrome/Edge extension for me from:
https://github.com/ZhangJP-wh/chrome-reading-queue

Goal: load the unpacked extension so I can use “阅读队列 / Reading Queue”.

Steps (do them for me; Mac and Windows are the same flow):
1. Download the repo ZIP from GitHub (Code → Download ZIP), or clone the repo.
2. Unzip if needed. The folder must contain manifest.json at the top level (not nested oddly).
3. Open chrome://extensions (or edge://extensions). Enable Developer mode.
4. Click “Load unpacked” / “加载已解压的扩展程序” and select that folder.
5. If Chrome asks for site access / host permissions, allow it.
6. Confirm the extension appears and the toolbar icon works.

Do not rewrite the extension code unless install fails. Prefer the ZIP download path for non-technical users.
When done, tell me briefly that it is installed and how to:
- right-click a link → 将此链接加入到阅读队列
- right-click page blank → 将当前页加入到阅读队列
```

仓库里也有独立文件 [`AGENT_INSTALL.md`](./AGENT_INSTALL.md)，Agent 可直接按该文件执行。  
See also [`AGENT_INSTALL.md`](./AGENT_INSTALL.md).

---

## 功能 / Features

| 中文 | English |
|------|---------|
| 右键**链接** → **将此链接加入到阅读队列** | Right-click **link** → enqueue that URL |
| 右键网页**空白处** → **将当前页加入到阅读队列**（用 `tab.title`） | Right-click **page blank** → enqueue current tab |
| 入队时尽量用页面上看得见的卡片标题 | Prefer visible on-page link/card title at enqueue |
| 关闭扩展打开的标签后自动开下一条未读 | Closing a queue-opened tab opens the next unread |
| 可设同时打开的最大标签数（1–5） | Max concurrent tabs (1–5) |
| 已打开条目变灰进历史；可清空历史/整队 | Opened items become grey history; clear history/queue |
| 卡片左侧 ★ 星标收藏；顶部「星标队列」页签 | Star ★ on each card; **星标队列** tab for starred only |
| 补全标题：网络静默；可选「从已打开标签补标题」 | Title fill: silent network; optional “from open tabs” |
| **不会**为取标题抢前台或自动播视频 | **No** focus-steal / autoplay just to fetch titles |

---

## 浏览器标签栏右键？做不到 / Tab-strip right-click? Not possible

**Chrome / Edge 不允许扩展往「浏览器顶部标签栏」的右键菜单里加项目。**  
这是浏览器平台限制，不是本扩展漏做。

**Chrome / Edge do not allow extensions to add items to the browser tab-strip (tab bar) context menu.**  
This is a platform limitation, not a missing feature in this extension.

**变通办法 / Workarounds：**

1. 先点一下那个后台标签页（切到前台），再在网页空白处右键 → **将当前页加入到阅读队列**  
   Focus that background tab first, then page-blank right-click → **将当前页加入到阅读队列**  
2. 或者打开该页后，用弹窗里的 **「从已打开标签补标题」**  
   Or use the popup button **「从已打开标签补标题」** after the page is open  

---

## 系统要求 / Requirements

- Google Chrome 或 Microsoft Edge（Chromium）最新稳定版  
  Latest stable Chrome or Edge (Chromium)
- macOS、Windows、Linux 均可（同一套文件）  
  Works on macOS, Windows, and Linux (same files)

不需要编译、不需要 Node、不需要命令行。  
No build, no Node, no command line required.

---

## 手动开发加载（给会改代码的人）

## Dev load (for people who edit code)

```bash
git clone https://github.com/ZhangJP-wh/chrome-reading-queue.git
```

然后在 `chrome://extensions` → 开发者模式 → 加载已解压 → 选仓库根目录。  
Then Load unpacked → select the repo root.

改完代码后点 **重新加载**。  
After edits, click **Reload**.

---

## 隐私 / Privacy

数据只存在本机 `chrome.storage.local`。不上传账号、不收集分析。补全标题时可能向页面所在站点或公开 oEmbed 接口发起请求（国内网络可能导致失败）。  
Data stays in local `chrome.storage.local`. No accounts, no analytics. Title fetch may request the page host or public oEmbed (may fail on restricted networks).

---

## v2.0.0 变更 / Changelog

- 新增：每条卡片标题前 ★ / ☆ 星标按钮（点星不打开条目；状态持久化 `starred`）  
  New: ★/☆ star button before each title (does not open the item; persists `starred`)
- 新增顶部页签：**阅读队列**（全部）与 **星标队列**（仅星标；未读在前、历史在后；激活时金色背景）  
  New header tabs: **阅读队列** (all) and **星标队列** (starred only; unread then history; gold when active)
- 清空历史 / 清空队列仍会删掉被清掉的条目（含星标）  
  Clear history / clear queue still deletes removed items (including starred ones)

### v1.9.1

- 新增：网页空白处 / frame 右键 → **将当前页加入到阅读队列**（`tab.url` + 清理后的 `tab.title`；标题够强则不再联网抓）  
  New: page/frame right-click → **将当前页加入到阅读队列** (`tab.url` + cleaned `tab.title`; skip network when title is strong)
- 链接右键菜单文案为 **将此链接加入到阅读队列**，与「当前页」区分  
  Link menu title is **将此链接加入到阅读队列**
- README 明确：无法向标签栏右键菜单注入项；给出切前台 / 弹窗补标题变通  
  Docs: tab-strip menu impossible; document workarounds

---

## License

MIT
