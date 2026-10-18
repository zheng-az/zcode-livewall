---
description: 给 ZCode 设置或调整动态（视频）壁纸
---

调用 `livewall` 技能，把本机 Wallpaper Engine 的动态壁纸注入 ZCode 桌面端。

用户参数：`$ARGUMENTS`

步骤：
1. 运行 `node dist/cli.js list` 列出可用壁纸；若用户已指定 id/标题，跳过列举。
2. 运行 `node dist/cli.js apply <目标>` 写入配置。
3. 运行 `node dist/cli.js serve --detach` 启动注入（已在跑则跳过）。
4. 报告实际选中的壁纸名、注入窗口数，以及面板入口（ZCode 右下角 🎞）。

若 `status` 显示 CDP 不可达，明确告知用户需要完全退出 ZCode 后重新用带
`--remote-debugging-port` 的入口启动，不要声称已生效。
