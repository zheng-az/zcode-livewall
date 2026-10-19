# Changelog

## v0.2.0

Automatic recovery: the wallpaper now comes back on its own after restarts —
no manual command needed.

### Added

- **MCP server auto-spawn** — the MCP server (loaded by ZCode on every
  session) checks the resident service's pid file at startup and spawns
  `serve --detach` when it is down, so a dead service recovers by itself.
- **CDP-less ZCode auto-restart** — when ZCode runs without
  `--remote-debugging-port` for 30 s, the resident service gracefully closes
  it and relaunches with the debug port (10-minute cooldown; disable with
  `autoRestart: false` in `config.json`).
- **Boot-time autostart recipes** — README documents registry entries that
  start ZCode with the debug port and the resident service at login.
- `autoRestart` config switch (default on).

### Fixed

- Bundle rebuild produced a duplicate `createRequire` banner when run on a
  previously bundled `dist/`; the build now starts from clean tsc output.

## v0.1.0

First release. Brings local Wallpaper Engine projects into the ZCode desktop
client as a live, animated background layer, and re-themes the whole UI from
the wallpaper with Material Design 3 (Monet) dynamic color.

### Added

- **Wallpaper Engine library discovery** — reads `projects/myprojects`,
  `projects/defaultprojects` and subscribed Workshop items (appid `431960`)
  from every Steam library listed in `libraryfolders.vdf`. Project types
  `video`, `web` and `scene` are playable; `application` is reported but
  skipped.
- **Video wallpaper** — the media file is streamed to the renderer over a
  loopback HTTP server with Range support, and played in a looping
  `pointer-events:none` `<video>` layer behind the UI.
- **Web / scene projects** — injected as a sandboxed `<iframe>`; animated GIF
  previews play on the poster layer.
- **Local files** — the settings panel can import any video or image directly,
  without a Wallpaper Engine install.
- **Monet theming** — `ffmpeg` samples frames from the video and the MD3
  algorithm derives light/dark palettes that override ZCode's semantic
  `--color-*` tokens. Without `ffmpeg` the wallpaper still plays, just without
  color extraction.
- **Live settings panel** — a draggable in-app panel with blur and dim
  sliders, playback speed, pause, framing mode, Monet toggle, wallpaper
  visibility, pause-on-blur and one-click reset. Changes preview instantly and
  persist.
- **Framing** — `cover` (fill and crop) and `contain` (letterboxed over a
  blurred backdrop). Both keep the wallpaper's own aspect ratio by computing
  the size in JS, because `object-fit` cannot scale media up to a full-size box.
- **Transcode optimization** — oversized videos (above ~2.7 MP) are re-encoded
  to a display-sized H.264 copy in the background, which cuts CPU use
  substantially on 4K sources.
- **Steam Workshop cover upgrade** — local `preview.gif` files are tiny
  (192-256 px) and blur badly when scaled. When the Workshop CDN serves a
  sharper cover, it is fetched in the background and swapped in without
  blocking the switch.
- **Survives reloads** — the CDP session is held per window and the payload is
  re-installed with `Page.addScriptToEvaluateOnNewDocument`, so the wallpaper
  comes back when the renderer reloads.
- **Agent control** — a `/livewall` slash command, a skill, and five MCP tools
  (`list_wallpapers`, `set_live_wallpaper`, `tune_live_wallpaper`,
  `livewall_status`, `stop_live_wallpaper`).

### Notes

- ZCode must be running with `--remote-debugging-port`; the plugin scans
  9222-9240 and can launch ZCode with the flag itself.
- `ffmpeg` is optional but recommended (frame sampling and poster generation).
- `scene.pkg` textures use Wallpaper Engine's own compression, so scene
  projects fall back to their preview image.
