---
name: livewall
description: Set, tune or troubleshoot an animated (video) wallpaper for the ZCode desktop client using local Wallpaper Engine projects, including Monet color extraction from a video frame. Use when the user asks for 动态壁纸, 视频壁纸, live wallpaper, Wallpaper Engine 壁纸 in ZCode, or when the animated background stopped/paused/failed to appear.
---

# zcode-livewall

把本机 Wallpaper Engine 的动态壁纸注入 ZCode 桌面端，并从视频抽帧做 MD3 取色。

## 先判断状态

1. `node dist/cli.js list` —— 有输出说明 Wallpaper Engine 库能被读到。
2. `node dist/cli.js status` —— 看 `cdpPort` 是否为数字。
   - `null`：ZCode 没有开 CDP 端口。必须完全退出 ZCode（含托盘），再用带
     `--remote-debugging-port` 的入口启动。插件会扫 9222–9240。
3. 服务是否在跑：`curl -s http://127.0.0.1:9334/api/health`
   - 没有响应 → `node dist/cli.js serve --detach`

## 常规操作

```bash
node dist/cli.js list                          # 列出可用壁纸
node dist/cli.js apply <id|标题片段> --dim 35   # 选定壁纸
node dist/cli.js serve --detach                # 启动注入 + 媒体 + 面板
node dist/cli.js stop                          # 停止
```

启动后 ZCode 右下角出现 🎞 悬浮按钮；面板里可以切换壁纸、调模糊/压暗/倍速/暂停、
切填充方式、开关 Monet。

面板底部有两个导入按钮：

- **视频…** — 选任意本地视频文件（mp4/webm/mov/mkv），上限 120 MB
- **图片…** — 选任意本地图片（jpg/png/webp/gif/bmp/avif），作为静态壁纸，上限 40 MB

静态图片零解码开销，是最省性能的选择；图片同样会做 Monet 取色。

## 新设备首次启用

- **node 不在 PATH**：MCP 工具由 ZCode 用 `node` 直接拉起，找不到就整组失联。
  处理：用 `where node` 找任意 Node 20+（含其他软件自带的），显式用它跑
  `dist\cli.js`；或直接运行插件目录的 `scripts\start-livewall.cmd [壁纸文件] [--dim 35]`，
  脚本会自动定位 Node、写壁纸配置、带调试端口启动 ZCode 并拉起常驻服务。
- **9222 被其他程序占用**（Chrome 等也爱用这个端口）：不用手工处理，
  `launch` / autoRestart 会自动改选 9222–9240 里的空闲端口。
- 装完插件后**重启一次 ZCode** 即可：MCP 服务器启动时会自动拉起 serve；
  serve 发现 ZCode 没开 CDP，30 秒后会自动带端口重启它。之后一切自愈。

## 排障

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 面板显示「服务未运行」 | serve 没起或已退出 | `serve --detach`，看 `data/serve.log` |
| 壁纸层存在但黑屏 | 媒体服务没起 / 视频解码失败 | 查 `serve.log`；确认 `:9333` 可访问 |
| 视频不动，`paused=true` | 面板点了暂停，或失焦暂停生效 | 面板点「继续」；关掉「失焦暂停」 |
| 界面不变色 | ffmpeg 未找到，或 `monet=false` | 设 `FFMPEG_PATH`；面板打开「UI 莫奈取色」 |
| 切换壁纸后仍显示旧的 | 渲染进程未重载且推送失败 | 面板点一次「重试连接」，或重启 serve |
| 窗口重载后壁纸消失 | 注入会话断开 | serve 会自动重连；确认 serve 常驻 |

## 注意

- 媒体服务只绑定 `127.0.0.1`，路径带随机 token，不要把它暴露到局域网。
- 场景类（scene）项目注入为 iframe，背景层 `pointer-events:none`，不响应鼠标是预期行为。
- 本插件不改 Wallpaper Engine 配置，也不接管桌面壁纸。
