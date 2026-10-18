/**
 * Wallpaper Engine library discovery.
 *
 * Wallpaper Engine stores each project as a directory containing a
 * `project.json` (type: video | web | scene | application), the referenced
 * media file, and a `preview` image. Two roots matter:
 *   - `<install>/projects/myprojects` and `defaultprojects` (local projects)
 *   - `<steam>/steamapps/workshop/content/431960/<id>` (Workshop subscriptions)
 */

import fs from "node:fs";
import path from "node:path";

export type WeProjectType = "video" | "web" | "scene" | "application" | "unknown";

export interface WeProject {
  id: string;
  title: string;
  type: WeProjectType;
  /** Absolute path of the media file the wallpaper actually shows. */
  mediaPath?: string;
  /** Absolute path of the preview image, used as a still/thumbnail. */
  previewPath?: string;
  projectDir: string;
  source: "local" | "workshop";
  /** Raw `file` value from project.json. */
  file?: string;
}

const STEAM_LIBRARY_ROOTS = [
  "C:/Program Files (x86)/Steam",
  "C:/Program Files/Steam",
  "D:/Steam",
  "E:/Steam",
  "F:/Steam",
  "G:/Steam",
  path.join(process.env.LOCALAPPDATA ?? "", "Steam"),
];

/** All plausible Wallpaper Engine install directories. */
export function findWallpaperEngineDirs(): string[] {
  const found = new Set<string>();
  const candidates = [
    ...STEAM_LIBRARY_ROOTS.map((r) => path.join(r, "steamapps", "common", "wallpaper_engine")),
    "C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine",
  ];
  for (const c of candidates) {
    try {
      if (fs.statSync(path.join(c, "wallpaper64.exe")).isFile()) found.add(path.resolve(c));
      else if (fs.statSync(path.join(c, "wallpaper32.exe")).isFile()) found.add(path.resolve(c));
    } catch {
      /* not installed here */
    }
  }
  return [...found];
}

/** Steam library folders parsed from libraryfolders.vdf (best effort). */
export function findSteamLibraries(): string[] {
  const libs = new Set<string>();
  for (const steamRoot of STEAM_LIBRARY_ROOTS) {
    const vdf = path.join(steamRoot, "steamapps", "libraryfolders.vdf");
    let text: string;
    try {
      text = fs.readFileSync(vdf, "utf8");
    } catch {
      continue;
    }
    // Quoted "path" "E:\\Steam" lines; escaping is JSON-like enough for a regex.
    for (const m of text.matchAll(/"path"\s+"([^"]+)"/g)) {
      const p = m[1].replace(/\\\\/g, "/").replace(/\\/g, "/");
      try {
        if (fs.statSync(p).isDirectory()) libs.add(path.resolve(p));
      } catch {
        /* stale entry */
      }
    }
  }
  return [...libs];
}

function readProjectJson(dir: string): any | undefined {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "project.json"), "utf8"));
  } catch {
    return undefined;
  }
}

function isMediaFile(p: string): boolean {
  return /\.(mp4|webm|mov|mkv|m4v|avi|gif|jpg|jpeg|png|webp|html?)$/i.test(p);
}

function resolveMedia(projectDir: string, file: string | undefined, type: WeProjectType): string | undefined {
  if (!file) return undefined;
  const direct = path.resolve(projectDir, file);
  try {
    if (fs.statSync(direct).isFile()) return direct;
  } catch {
    /* fall through to a scan */
  }
  // Some projects reference a scene JSON that names the media elsewhere; scan
  // the directory for the first file with a playable extension.
  try {
    const entries = fs.readdirSync(projectDir).filter(isMediaFile);
    const preferred =
      entries.find((e) => /\.(mp4|webm|mov|m4v)$/i.test(e)) ??
      entries.find((e) => /\.gif$/i.test(e)) ??
      (type === "web" ? entries.find((e) => /\.html?$/i.test(e)) : undefined);
    if (preferred) return path.join(projectDir, preferred);
  } catch {
    /* unreadable */
  }
  return undefined;
}

function toProject(dir: string, source: WeProject["source"], id: string): WeProject | undefined {
  const json = readProjectJson(dir);
  if (!json) return undefined;
  const rawType = String(json.type ?? "").toLowerCase();
  const type: WeProjectType =
    rawType === "video" || rawType === "web" || rawType === "scene" || rawType === "application"
      ? rawType
      : "unknown";

  const mediaPath = resolveMedia(dir, typeof json.file === "string" ? json.file : undefined, type);
  const previewName = typeof json.preview === "string" ? json.preview : undefined;
  const previewPath = previewName ? path.resolve(dir, previewName) : undefined;

  return {
    id,
    title: typeof json.title === "string" && json.title.trim() ? json.title.trim() : id,
    type,
    mediaPath,
    previewPath: previewPath && fs.existsSync(previewPath) ? previewPath : undefined,
    projectDir: dir,
    source,
    file: typeof json.file === "string" ? json.file : undefined,
  };
}

/** Enumerates every project under the given roots (deduped by directory). */
export function scanProjects(): WeProject[] {
  const projects: WeProject[] = [];
  const seen = new Set<string>();

  const push = (p: WeProject | undefined) => {
    if (!p || seen.has(p.projectDir)) return;
    seen.add(p.projectDir);
    projects.push(p);
  };

  for (const weDir of findWallpaperEngineDirs()) {
    for (const sub of ["myprojects", "defaultprojects"]) {
      const root = path.join(weDir, "projects", sub);
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(root, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        push(toProject(path.join(root, e.name), "local", e.name));
      }
    }
  }

  for (const lib of findSteamLibraries()) {
    const root = path.join(lib, "steamapps", "workshop", "content", "431960");
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      push(toProject(path.join(root, e.name), "workshop", e.name));
    }
  }

  return projects.sort((a, b) => a.title.localeCompare(b.title));
}

/** Projects that can actually be shown as an animated background. */
export function listPlayable(): WeProject[] {
  return scanProjects().filter((p) => {
    if (!p.mediaPath) return false;
    if (p.type === "video") return /\.(mp4|webm|mov|m4v)$/i.test(p.mediaPath);
    if (p.type === "web") return /\.html?$/i.test(p.mediaPath);
    return /\.(mp4|webm|mov|m4v|gif)$/i.test(p.mediaPath);
  });
}

export function findProject(idOrTitle: string): WeProject | undefined {
  const needle = idOrTitle.trim().toLowerCase();
  const all = scanProjects();
  return (
    all.find((p) => p.id.toLowerCase() === needle) ??
    all.find((p) => p.title.toLowerCase() === needle) ??
    all.find((p) => p.title.toLowerCase().includes(needle) || p.id.includes(needle))
  );
}
