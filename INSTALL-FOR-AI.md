# Install zcode-livewall — for AI agents

Goal: install the plugin into the user's ZCode desktop client, then apply a
wallpaper. Everything below is read-only inspection plus one marketplace
registration; nothing modifies ZCode's own files.

## 1. Install via the marketplace UI (preferred, ~30 s)

1. ZCode → Plugin Marketplace → **Add** → **Add Plugin Marketplace**
2. Paste this repo's root directory (the folder containing `marketplace.json`)
3. **Personal** → `zcode-livewall` → **Install**
4. Settings → **Plugins** to confirm `zcode-livewall` is enabled

From a clone, the root is the directory holding `marketplace.json`. Adding a
market does not install anything by itself.

## 2. Launch ZCode with the debug port (required, once)

The plugin injects over the Chrome DevTools Protocol, which production builds
do not open by default.

```bash
node dist/cli.js launch          # starts ZCode with --remote-debugging-port
node dist/cli.js status          # confirms CDP is reachable
```

If an instance is already running without the flag, ZCode must be quit
completely (including the tray icon) and restarted from the launched entry.

## 3. Apply a wallpaper

```bash
node dist/cli.js list            # available Wallpaper Engine projects
node dist/cli.js apply 3030081182 --dim 35
node dist/cli.js serve --detach  # resident service + live settings panel
node dist/cli.js stop            # stop it
```

Once `serve` is running, a 🎞 button appears in ZCode's bottom-right corner for
live switching and tuning.

## 4. Verify

`node dist/cli.js status` reports CDP reachability, the stored config, service
state and whether `ffmpeg` was found. In the app, the wallpaper should be
visible behind the UI and open the 🎞 panel.

## Requirements

- Node >= 20
- ZCode desktop client running with `--remote-debugging-port`
- `ffmpeg` — optional; frame sampling for Monet colors and poster generation.
  Looked up via `FFMPEG_PATH`, then `PATH`. Without it the wallpaper still
  plays, only color extraction is skipped.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| CDP unreachable, wallpaper never appears | ZCode was started without the debug port. Quit it completely and rerun `launch`. |
| Wallpaper plays but colors never change | `ffmpeg` missing. Install it or set `FFMPEG_PATH`. |
| Scene wallpapers look blurry | Scene projects fall back to their tiny `preview` image; no sharper version is extractable from `scene.pkg`. Use a `video` or `web` project for a crisp result. |
| High CPU on 4K sources | Enable the optimize toggle in the panel: the video is transcoded to a display-sized copy in the background. |
| Panel's ✕ does not respond | Fixed — dragging no longer uses pointer capture, which used to retarget the click. |

## How it works

```
ZCode renderer (file://)
  ├── <video id="zcode-livewall-video">  ←  http://127.0.0.1:9333/m/<token>/...
  ├── <img  id="zcode-livewall-poster">  ←  poster / GIF
  ├── <div  id="zcode-livewall-dim">         dim layer
  └── <style id="zcode-livewall-style">      MD3 variables + layer styles

serve process
  ├── CDP session per window (held open)
  ├── media server (Range support, token paths, bound to 127.0.0.1 only)
  └── control API (:9334, x-zlw-token)
```

Media paths carry a random token and the server binds to loopback only, so
other programs on the machine cannot enumerate or guess them.

## Performance

Measured overhead on top of ZCode's own baseline (~110% CPU / 3.0 GB):

| Type | CPU | Note |
| --- | --- | --- |
| 1080p video | +19% | normal; governed by source frame rate |
| 4K 60 fps video | +35-40% | decoding runs at the source resolution |
| web project | +10-15% | the page's own cost; memory can reach 3.5 GB |
| scene (GIF fallback) | +5% | cheapest |

Browser video decoding always runs at the file's resolution: shrinking the
`<video>` box, lowering `playbackRate`, or removing the blur filter does
**not** reduce CPU. Transcoding to a smaller resolution is the only lever.

Why small images look blurry: `cover` scales the image up to cover the window,
so a 256×256 preview on a 1443×904 window is a 7.5× upscale. That is a
resolution problem, not a rendering one.

## Known limitations

- Only `video`, `web` and `scene` projects that resolve to a real media file are
  playable; pure `application` projects are skipped.
- `scene` projects (`scene.json` + `scene.pkg`) are Wallpaper Engine's private
  binary format and cannot be reproduced in a browser. They fall back to the
  project's `preview.gif`, so they animate but are not the original effect.
- Injected iframes cannot receive the mouse (the background layer is
  `pointer-events:none`); they are decoration only.
- Color extraction runs after the frame is injected, so the theme lands a few
  seconds after the picture.
