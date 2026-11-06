# 阅读队列 / Reading Queue

Chrome / Edge 扩展：右键把**链接**或**当前页面**加入阅读队列，关掉当前页后自动打开下一个，避免一次开几十个标签把浏览器卡死。

Chrome / Edge extension: right-click a **link** or the **current page** into a reading queue; closing a queue tab opens the next one so you don’t open dozens of tabs at once.

**仓库 / Repo:** https://github.com/ZhangJP-wh/chrome-reading-queue  
**版本 / Version:** **2.0.6**（见 `manifest.json`）

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
- 在**链接**上右键 → **加入阅读队列**
- 在网页**空白处**右键 → **加入当前页**（用已打开标签的真实标题，一般一步到位）
- 点工具栏图标打开列表

Then:
- Right-click a **link** → **加入阅读队列**
- Right-click **page blank** → **加入当前页** (uses the open tab’s real title)
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
- right-click a link → 加入阅读队列
- right-click page blank → 加入当前页
```

仓库里也有独立文件 [`AGENT_INSTALL.md`](./AGENT_INSTALL.md)，Agent 可直接按该文件执行。  
See also [`AGENT_INSTALL.md`](./AGENT_INSTALL.md).

---

## 功能 / Features

| 中文 | English |
|------|---------|
| 右键**链接**入队（此链接） | Right-click **link** → enqueue that URL |
| 右键网页**空白处**入队当前页（用 `tab.title`） | Right-click **page blank** → enqueue current tab |
| 入队时尽量用页面上看得见的卡片标题 | Prefer visible on-page link/card title at enqueue |
| 关闭扩展打开的标签后自动开下一条未读 | Closing a queue-opened tab opens the next unread |
| 可设同时打开的最大标签数（1–5） | Max concurrent tabs (1–5) |
| 已打开条目变灰进历史；可清空历史/整队 | Opened items become grey history; clear history/queue |
| 卡片左侧 ★ 星标收藏；顶部「阅读队列 / 星标队列」页签（均显示数量） | Star ★ on each card; **阅读队列 / 星标队列** tabs (both show counts) |
| 星标队列页签浅金背景（`#fde68a`；★ 为 `#eab308`） | Starred tab light-gold fill (`#fde68a`; lit ★ `#eab308`) |
| 最新加入的卡片排在列表上方；打开下一个仍先开最早未读 | Newest cards at top of list; open-next still oldest unread |
| 拖动手柄（☰）跟手拖动排序；荧光蓝线 + 上下卡片挤开让位 | Drag handle (☰); neon line + cards push apart at gap |
| 补全标题：网络静默（不开标签、不抢前台） | Title fill: silent network (no tabs / no focus steal) |
| 卡片「复制链接」一键复制完整 URL | Card **复制链接** copies full URL |
| **不会**为取标题抢前台或自动播视频 | **No** focus-steal / autoplay just to fetch titles |

---

## 浏览器标签栏右键？做不到 / Tab-strip right-click? Not possible

**Chrome / Edge 不允许扩展往「浏览器顶部标签栏」的右键菜单里加项目。**  
这是浏览器平台限制，不是本扩展漏做。

**Chrome / Edge do not allow extensions to add items to the browser tab-strip (tab bar) context menu.**  
This is a platform limitation, not a missing feature in this extension.

**变通办法 / Workarounds：**

1. 先点一下那个后台标签页（切到前台），再在网页空白处右键 → **加入当前页**  
   Focus that background tab first, then page-blank right-click → enqueue current page  
2. 或在弹窗里点 **补全标题**（网络静默抓取；国内网络可能失败）  
   Or use popup **补全标题** (silent network fetch; may fail on restricted networks)  

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

## v2.0.6 变更 / Changelog

- 落点蓝线处，上方卡片整体上移、下方卡片整体下移，**挤开更大空隙**，插入位置更直观  
  At the insert line, cards above shift up and cards below shift down to **open a clear gap**
- 仍保留 ☰ 跟手幽灵卡、荧光蓝插入线（非整卡高亮）、同组 `addedAt` 持久化  
  Keeps glued ghost, neon insert line (not full-card highlight), same-group `addedAt` persistence

### v2.0.5

- 拖拽改为 **指针拖动 + 自定义幽灵卡片**：☰ 始终贴着鼠标，卡片只轻微浮起、不再漂到弹窗右侧外  
  Reorder uses **pointer drag + custom ghost**: ☰ stays glued to the cursor; slight lift only (no far-right drift)
- 落点反馈改为卡片之间的 **荧光蓝插入线**（加长加粗加亮），不再整卡高亮（避免像「合并」）  
  Drop cue is a **bright neon-blue insertion line** between cards (longer/thicker), not a full-card highlight
- 排序持久化逻辑不变（同组 `addedAt`）；打开下一个仍是最早未读 FIFO  
  Persistence unchanged (same-group `addedAt`); open-next stays oldest-unread FIFO

### v2.0.4

- 卡片右侧 ↑↓ 合并为 **拖动手柄**（三条横杠）；按住上下拖动即可排序  
  Per-card ↑↓ replaced by a **drag handle** (three bars); drag to reorder
- 排序仍通过重写同组（未读/历史）内的 `addedAt` 持久化；打开下一个仍是最早未读 FIFO  
  Reorder persists by reassigning `addedAt` within the same read-group; open-next stays oldest-unread FIFO

### v2.0.3

- 列表按 **添加时间** 排序：最新加入的在最上方（未读一组内、历史一组内皆如此；星标页签同理）  
  List sorted by **addedAt**: newest on top (within unread, then within history; starred tab same)
- 「打开下一个」仍按最早未读 FIFO 消费，与屏幕上下位置无关  
  **打开下一个** still consumes oldest unread (FIFO), independent of on-screen order

### v2.0.2

- **星标队列**页签背景改为浅金 `#fde68a`（`--star-tab`），黑字更易读；点亮 ★ 仍为 `#eab308`  
  **星标队列** tab fill lightened to `#fde68a` (`--star-tab`) for black-text contrast; lit ★ stays `#eab308`

### v2.0.1

- **星标队列**页签背景与点亮 ★ 同色（`#eab308` / `--star`）  
  **星标队列** tab background matches lit ★ (`#eab308` / `--star`)
- **阅读队列**与**星标队列**页签均显示条目数量徽章  
  Both tabs show item-count badges
- 移除弹窗按钮「从已打开标签补标题」  
  Removed popup button “从已打开标签补标题”
- 卡片复制按钮文案：**复制** → **复制链接**  
  Copy button label: **复制** → **复制链接**

### v2.0.0

- 新增：每条卡片标题前 ★ / ☆ 星标按钮（点星不打开条目；状态持久化 `starred`）  
  New: ★/☆ star button before each title (does not open the item; persists `starred`)
- 新增顶部页签：**阅读队列**（全部）与 **星标队列**（仅星标；未读在前、历史在后；激活时金色背景）  
  New header tabs: **阅读队列** (all) and **星标队列** (starred only; unread then history; gold when active)
- 清空历史 / 清空队列仍会删掉被清掉的条目（含星标）  
  Clear history / clear queue still deletes removed items (including starred ones)

### v1.9.1

- 网页空白处右键 → **加入当前页**；链接右键 → **加入阅读队列**  
  Page blank → enqueue current page; link → enqueue that link
- 无法向浏览器标签栏右键菜单注入项（平台限制）  
  Cannot inject into browser tab-strip context menu (platform limit)

---

## License

MIT
