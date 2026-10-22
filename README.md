# zcode-livewall

[English](README.md) | [中文](README.zh-CN.md)

Animated wallpaper for the **ZCode desktop client**: local Wallpaper Engine projects become a live background layer behind the UI, and the whole interface re-themes itself with Material Design 3 (Monet) dynamic color sampled from the wallpaper.

The companion to [zcode-beautify](https://github.com/Logocceai/zcode-beautify): beautify handles **still images**, livewall handles **moving ones**. Both inject over the Chrome DevTools Protocol, but livewall does not reuse beautify's `background-image` layer — video cannot go into a data URI, so it streams over loopback HTTP with Range support instead.

## Features

- **Wallpaper Engine library** — reads `projects/myprojects`, `projects/defaultprojects` and subscribed Workshop items (appid `431960`) from every Steam library listed in `libraryfolders.vdf`.
- **Link the live wallpaper** — `link` (CLI), a panel action and the `link_wallpaper_engine` MCP tool adopt whatever Wallpaper Engine is showing right now; scene types fall back to their preview image.
- **Works without Wallpaper Engine** — no WE installed means no library, not no plugin: import any local video/image, and with no wallpaper set the whole UI settles into a frosted-glass translucency.
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

## Install

1. ZCode → **Plugin Marketplace** → **Add** → **Add Plugin Marketplace**
2. Paste this repository's root — the folder containing `marketplace.json`
3. **Personal** → `zcode-livewall` → **Install**
4. Settings → **Plugins** → confirm `zcode-livewall` is enabled

Adding a marketplace does not install anything by itself. From a clone, the root is the directory holding `marketplace.json`.

Then start ZCode with the debug port, once:

```bash
node dist/cli.js launch          # starts ZCode with --remote-debugging-port
node dist/cli.js status          # confirms CDP is reachable
```

The plugin injects over the Chrome DevTools Protocol, which production builds do not open by default. If ZCode is already running without the flag, quit it completely (including the tray icon) and run `launch` again.

To pick a wallpaper:

```bash
node dist/cli.js list                    # playable Wallpaper Engine projects
node dist/cli.js apply 3030081182        # by project id, or any local video / image path
node dist/cli.js serve --detach          # resident service + live settings panel
```

Once `serve` is running, a 🎞 button appears in ZCode's bottom-right corner for switching and tuning. Requires Node >= 20; `ffmpeg` is optional and only used for color extraction.
