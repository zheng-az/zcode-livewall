# zcode-livewall

[English](README.md) | [中文](README.zh-CN.md)

给 **ZCode 桌面端**装上会动的壁纸：本机 Wallpaper Engine 的壁纸项目变成 UI 背后的一层动态背景，同时从画面取色，用 Material Design 3（莫奈配色）让整个界面跟着变色。

它是 [zcode-beautify](https://github.com/Logocceai/zcode-beautify) 的姊妹插件：beautify 负责**静态图片**，livewall 负责**会动的**。两者都走 CDP 注入，但 livewall 不复用它的 `background-image` 层——视频塞不进 data URI，所以改成 loopback HTTP + Range 流式传输。

## 功能

- **读取 Wallpaper Engine 壁纸库** — 自动扫描各 Steam 库的 `projects/myprojects`、`projects/defaultprojects`，以及已订阅的创意工坊项目（appid `431960`）
- **链接当前壁纸** — `link` 命令、面板与 MCP 工具可一键采用 Wallpaper Engine 此刻正在显示的壁纸；scene 类项目自动退到静态预览图
- **没有 Wallpaper Engine 也能用** — 未安装时壁纸库为空属预期：导入本地视频/图片即可，未设壁纸时整个界面呈毛玻璃半透明
- **视频类项目** — 以 `<video>` 循环播放，支持暂停、倍速、窗口失焦自动暂停
- **网页 / 场景类项目** — 以 sandboxed `<iframe>` 注入；动态 GIF 在 poster 层播放
- **导入本地文件** — 面板可直接导入任意视频或图片（JPG / PNG / WebP），无需安装 Wallpaper Engine
- **莫奈动态配色** — 用 `ffmpeg` 从视频抽帧，交给官方 MD3 算法生成 light / dark 双套调色板，覆盖 ZCode 的 `--color-*` 语义变量。没有 `ffmpeg` 时壁纸照常播放，只是不取色
- **悬浮设置面板** — 可拖动，支持切换壁纸、模糊、压暗、倍速、暂停、填充方式、Monet 开关、壁纸可见性和一键重置；改动即时预览并持久化
- **两种填充方式** — `cover`（填满裁剪）与 `contain`（完整显示，背后垫同图模糊底）；两种都保持素材自身的原始比例
- **转码优化** — 超大视频会在后台转码成适配显示尺寸的 H.264 副本，4K 素材的 CPU 占用显著下降；转码期间原始文件照常播放
- **更清晰的工坊封面** — 本地 `preview` 图很小，放大必糊。当创意工坊 CDN 有更清晰的封面时，会在后台抓取并自动换上，不阻塞切换
- **重载后自动恢复** — 每个窗口持有 CDP 会话，且每次新建文档都会重装注入脚本，渲染进程重载后壁纸自动回来
- **可由 AI 控制** — 自带 `/livewall` 斜杠命令、一个技能，以及五个 MCP 工具：`list_wallpapers`、`set_live_wallpaper`、`tune_live_wallpaper`、`livewall_status`、`stop_live_wallpaper`
- **不破坏原有环境** — 不修改 Wallpaper Engine，也不接管桌面壁纸，两者可以同时运行

## 安装

1. ZCode → **插件市场** → **添加** → **添加插件市场**
2. 粘贴本仓库根目录 —— 也就是包含 `marketplace.json` 的那个文件夹
3. **个人** → `zcode-livewall` → **安装**
4. 设置 → **插件** → 确认 `zcode-livewall` 已启用

添加市场本身不会安装任何东西。如果是克隆下来的仓库，根目录就是包含 `marketplace.json` 的那一层。

然后启动带调试端口的 ZCode，只需一次：

```bash
node dist/cli.js launch          # 以 --remote-debugging-port 启动 ZCode
node dist/cli.js status          # 确认 CDP 可达
```

插件通过 CDP（Chrome DevTools Protocol）注入，而正式版默认不开这个端口。如果 ZCode 已经在运行但没带这个参数，需要完全退出（包括托盘图标）再执行 `launch`。

最后选一张壁纸：

```bash
node dist/cli.js list                    # 列出可播放的 Wallpaper Engine 项目
node dist/cli.js apply 3030081182        # 用项目 id，或任意本地视频 / 图片路径
node dist/cli.js serve --detach          # 常驻服务 + 悬浮设置面板
```

`serve` 跑起来后，ZCode 右下角会出现一个 🎞 按钮，可随时切换和调节。需要 Node >= 20；`ffmpeg` 可选，仅用于取色。
