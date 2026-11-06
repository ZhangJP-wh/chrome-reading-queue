# Agent install instructions / Agent 安装说明

If a user pastes https://github.com/ZhangJP-wh/chrome-reading-queue and asks you to install this extension, follow this file.

若用户把上述仓库链接发给你并要求安装本扩展，请按本文件执行。

## Success criteria / 成功标准

- Extension loaded via “Load unpacked” / 「加载已解压的扩展程序」
- Toolbar icon visible
- Right-click on a **link** shows 「加入阅读队列」
- Right-click on **page blank** shows 「加入当前页」
- Site access / host permissions allowed if prompted

## Procedure / 步骤

1. Download ZIP from GitHub (**Code → Download ZIP**) or `git clone https://github.com/ZhangJP-wh/chrome-reading-queue.git`
2. Unzip. Ensure `manifest.json` is at the **root** of the folder you will select (not inside an extra nested folder only).
3. Open `chrome://extensions` (Edge: `edge://extensions`). Enable **Developer mode**.
4. **Load unpacked** → select that folder.
5. Allow site access if Chrome asks.
6. Report done in the user’s language (Chinese or English).

## Constraints / 约束

- Same steps for macOS and Windows.
- Do **not** rewrite extension code unless install fails.
- Do **not** open random tabs to “test title fetch” with autoplay; smoke-test with toolbar popup only unless user asks.
- Prefer ZIP download for non-technical users.
- Do **not** promise a tab-strip (browser tab bar) context menu — Chrome/Edge APIs cannot add items there.

## Optional smoke test / 可选冒烟

1. Open any page with links → right-click a link → 「加入阅读队列」→ popup shows the item (title may be the visible card text).
2. On the same page, right-click blank area → 「加入当前页」→ popup shows the current page with its tab title.
