/**
 * Links to the wallpaper Wallpaper Engine is currently showing.
 *
 * WE records the per-monitor selection in its own config.json under
 * `<steam-account-id>.general.wallpaperconfig.selectedwallpapers`. The `file`
 * entry points at the project directory's project.json — or directly at a
 * `scene.pkg`, WE's private binary format that a browser cannot reproduce.
 * Scene / application projects therefore degrade to their preview image,
 * exactly like the library scan does.
 */

import fs from "node:fs";
import path from "node:path";

export interface CurrentWallpaper {
  monitor: string;
  /** The `file` value WE recorded (project.json or scene.pkg path). */
  file: string;
  title: string;
  id?: string;
  /** Playable media when the project carries one (video/web/gif). */
  mediaPath?: string;
  /** Static image to use when no playable media exists (scene/application). */
  previewPath?: string;
}

const PLAYABLE_VIDEO = /\.(mp4|webm|mov|m4v)$/i;
const IS_WEB = /\.html?$/i;
const IS_GIF = /\.gif$/i;
const IS_STILL = /\.(gif|jpe?g|png|webp|bmp|avif)$/i;
/** scene.pkg / scene.json / application binaries — none are browser-playable. */
const IS_PLAYABLE = (p: string) => PLAYABLE_VIDEO.test(p) || IS_WEB.test(p) || IS_GIF.test(p);

/** All per-account `selectedwallpapers` maps found in WE's config.json. */
function readSelectedWallpapers(): Record<string, { file: string | null }> {
  const out: Record<string, { file: string | null }> = {};
  const candidates = [
    ...["C:/Program Files (x86)/Steam", "C:/Program Files/Steam", "D:/Steam", "E:/Steam", "F:/Steam", "G:/Steam"]
      .map((r) => path.join(r, "steamapps", "common", "wallpaper_engine")),
    path.join(process.env.LOCALAPPDATA ?? "", "Steam", "steamapps", "common", "wallpaper_engine"),
  ];
  for (const weDir of candidates) {
    const cfg = path.join(weDir, "config.json");
    let text: string;
    try {
      text = fs.readFileSync(cfg, "utf8");
    } catch {
      continue;
    }
    try {
      const json = JSON.parse(text.replace(/^\uFEFF/, ""));
      for (const section of Object.values<any>(json)) {
        const sel = section?.general?.wallpaperconfig?.selectedwallpapers;
        if (sel && typeof sel === "object") {
          for (const [monitor, entry] of Object.entries<any>(sel)) {
            if (entry && typeof entry === "object") out[monitor] = entry;
          }
        }
      }
    } catch {
      /* corrupt config; try the next install dir */
    }
  }
  return out;
}

function projectIdFromDir(dir: string): string {
  const norm = dir.replace(/\\/g, "/").toLowerCase();
  const m = norm.match(/workshop\/content\/431960\/(\d+)/);
  return m ? m[1] : path.basename(dir);
}

/**
 * Resolves what Wallpaper Engine is showing right now. `monitor` optionally
 * pins a monitor name ("Monitor0"); otherwise the first monitor with a file
 * wins. Returns undefined when WE is not installed or has no wallpaper set.
 */
export function resolveCurrentWallpaper(monitor?: string): CurrentWallpaper | undefined {
  const selected = readSelectedWallpapers();
  if (!selected) return undefined;
  const names = Object.keys(selected);
  const pick =
    monitor && selected[monitor] ? monitor : names.find((n) => selected[n]?.file);
  if (!pick) return undefined;
  const file = selected[pick].file;
  if (!file) return undefined;

  const dir = path.dirname(file);
  const out: CurrentWallpaper = { monitor: pick, file, title: path.basename(dir) };

  // A scene.pkg / scene.json selection may or may not ship a project.json;
  // when it does not, the preview image beside it is the only representation.
  let json: any;
  try {
    json = JSON.parse(fs.readFileSync(path.join(dir, "project.json"), "utf8"));
  } catch {
    json = undefined;
  }

  const previewName = typeof json?.preview === "string" ? json.preview : "preview.gif";
  const previewPath = path.resolve(dir, previewName);
  out.previewPath = fs.existsSync(previewPath) ? previewPath : undefined;

  if (json) {
    out.id = projectIdFromDir(dir);
    if (typeof json.title === "string" && json.title.trim()) out.title = json.title.trim();
    const mediaFile = typeof json.file === "string" ? json.file : undefined;
    if (mediaFile) {
      const direct = path.resolve(dir, mediaFile);
      try {
        if (fs.statSync(direct).isFile() && IS_PLAYABLE(direct)) out.mediaPath = direct;
      } catch {
        /* referenced file missing; fall through to the preview */
      }
    }
  }
  return out;
}

export interface CurrentApplyChoice {
  source?: string;
  sourceKind?: "video" | "web" | "image";
  projectId?: string;
  title?: string;
  error?: string;
}

/** Picks what the plugin can actually display for the current WE wallpaper. */
export function applyChoiceFor(cur: CurrentWallpaper): CurrentApplyChoice {
  if (cur.mediaPath) {
    return {
      source: cur.mediaPath,
      sourceKind: IS_WEB.test(cur.mediaPath) ? "web" : PLAYABLE_VIDEO.test(cur.mediaPath) ? "video" : "image",
      projectId: cur.id,
      title: cur.title,
    };
  }
  if (cur.previewPath && IS_STILL.test(cur.previewPath)) {
    return {
      source: cur.previewPath,
      sourceKind: "image",
      projectId: cur.id,
      // Scene previews as a wallpaper read as a still, so say so in the title.
      title: `${cur.title}（静态预览）`,
    };
  }
  return {
    error: `此 Wallpaper Engine 壁纸（${cur.title}）没有可在浏览器播放的媒体，也没有预览图`,
  };
}
