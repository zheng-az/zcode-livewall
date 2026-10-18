# zcode-livewall

[English](README.md) | [中文](README.zh-CN.md)

Animated wallpaper for the **ZCode desktop client**: local Wallpaper Engine projects become a live background layer behind the UI, and the whole interface re-themes itself with Material Design 3 (Monet) dynamic color sampled from the wallpaper.

The companion to [zcode-beautify](https://github.com/Logocceai/zcode-beautify): beautify handles **still images**, livewall handles **moving ones**. Both inject over the Chrome DevTools Protocol, but livewall does not reuse beautify's `background-image` layer — video cannot go into a data URI, so it streams over loopback HTTP with Range support instead.

## Features

- **Wallpaper Engine library** — reads `projects/myprojects`, `projects/defaultprojects` and subscribed Workshop items (appid `431960`) from every Steam library listed in `libraryfolders.vdf`.
- **Video projects** — played in a looping `<video>` layer with pause, playback speed, and pause-on-blur.
- **Web and scene projects** — injected as a sandboxed `<iframe>`; animated GIF previews play on the poster layer.
- **Local files** — import any video or image (JPG / PNG / WebP) straight from the settings panel, with no Wallpaper Engine install.
- **Monet theming** — `ffmpeg` samples frames from the video and the official MD3 algorithm derives light and dark palettes, overriding ZCode's semantic `--color-*` tokens. Without `ffmpeg` the wallpaper still plays, just without color extraction.
- **Live settings panel** — a draggable in-app panel for wallpaper swap, blur, dim, playback speed, pause, framing mode, Monet, wallpaper visibility and reset. Changes preview instantly and persist.
- **Framing** — `cover` (fill and crop) and `contain` (letterboxed over a blurred backdrop of the same picture). Both keep the wallpaper's own aspect ratio.
- **Transcode optimization** — oversized videos are re-encoded to a display-sized H.264 copy in the background, which cuts CPU use substantially on 4K sources. The original keeps playing while it works.
- **Sharper Workshop covers** — local `preview` images are tiny and blur badly when scaled. When the Workshop CDN serves a sharper cover, it is fetched in the background and swapped in without blocking the switch.
- **Survives reloads** — the CDP session is held per window and the payload is re-installed on every new document, so the wallpaper comes back when the renderer reloads.
- **Agent control** — a `/livewall` slash command, a skill, and five MCP tools: `list_wallpapers`, `set_live_wallpaper`, `tune_live_wallpaper`, `livewall_status`, `stop_live_wallpaper`.
- **Non-destructive** — never modifies Wallpaper Engine or takes over the desktop wallpaper; both can run at the same time.

## Requirements

- Node >= 20
- ZCode desktop client running with `--remote-debugging-port`
- Wallpaper Engine — optional. Without it, local video and image files still work.
- `ffmpeg` — optional. Used for frame sampling (Monet colors) and poster generation; looked up via `FFMPEG_PATH`, then `PATH`. Without it the wallpaper still plays, only color extraction is skipped.

## Install

1. ZCode → **Plugin Marketplace** → **Add** → **Add Plugin Marketplace**
2. Paste this repository's root — the folder containing `marketplace.json`
3. **Personal** → `zcode-livewall` → **Install**
4. Settings → **Plugins** → confirm `zcode-livewall` is enabled

Adding a marketplace does not install anything by itself. From a clone, the root is the directory holding `marketplace.json`.

## Usage

### 1. Start ZCode with the debug port (once)

The plugin injects over the Chrome DevTools Protocol, which production builds do not open by default.

```bash
node dist/cli.js launch          # starts ZCode with --remote-debugging-port
node dist/cli.js status          # confirms CDP is reachable
```

If ZCode is already running without the flag, quit it completely (including the tray icon) and run `launch` again.

### 2. Pick a wallpaper

```bash
node dist/cli.js list                    # playable Wallpaper Engine projects
node dist/cli.js apply 3030081182        # by project id from the list
node dist/cli.js apply D:/clip.mp4       # or any local video / image file
```

`apply` options:

| Option | Effect |
| --- | --- |
| `--blur <px>` | Blur radius |
| `--dim <0-100>` | Darken the wallpaper |
| `--fit <cover\|contain>` | Fill and crop, or letterbox over a blurred backdrop |
| `--no-monet` | Keep ZCode's original colors |

### 3. Tune it live

```bash
node dist/cli.js serve --detach   # resident service + live settings panel
```

Once `serve` is running, a 🎞 button appears in ZCode's bottom-right corner: swap wallpaper, blur, dim, playback speed, pause, framing, Monet, visibility and reset — all previewing instantly and persisting across restarts.

### 4. Stop

```bash
node dist/cli.js stop             # stop the service
node dist/cli.js reset            # remove the animated background
```

The wallpaper survives renderer reloads while the service is up.

## Agent control

A `/livewall` slash command, a skill, and five MCP tools: `list_wallpapers`, `set_live_wallpaper`, `tune_live_wallpaper`, `livewall_status`, `stop_live_wallpaper`. Ask ZCode to "change the wallpaper" or "make the background darker" and it drives the same service.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| CDP unreachable, wallpaper never appears | ZCode was started without the debug port. Quit it completely and rerun `launch`. |
| Wallpaper plays but colors never change | `ffmpeg` missing. Install it or set `FFMPEG_PATH`. |
| Scene wallpapers look blurry | Scene projects fall back to their tiny `preview` image; no sharper version is extractable from `scene.pkg`. Use a `video` or `web` project for a crisp result. |
| High CPU on 4K sources | Enable the optimize toggle in the panel: the video is transcoded to a display-sized copy in the background. |
| `apply` finds no projects | Wallpaper Engine is not installed, or no project resolves to a real media file. Use a local file path instead. |
