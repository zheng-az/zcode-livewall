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
