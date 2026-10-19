/**
 * Config persistence, data directory and PID/token files.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * cover:   fill the window, crop the overflow.
 * contain: show the whole media at its own aspect ratio, letterboxed with a
 *          blurred copy. The default — the wallpaper keeps its native framing.
 */
export type WallpaperFit = "cover" | "contain";
export type SourceKind = "video" | "web" | "image";

export interface LiveWallConfig {
  /** 0 means "discover the CDP port of the running ZCode". */
  cdpPort: number;
  mediaPort: number;
  apiPort: number;
  source?: string;
  sourceKind?: SourceKind;
  projectId?: string;
  blur: number;
  dim: number;
  monet: boolean;
  wallpaperVisible: boolean;
  fit: WallpaperFit;
  speed: number;
  paused: boolean;
  pauseOnBlur: boolean;
  optimize: boolean;
  /**
   * When ZCode runs without a CDP port (the plugin cannot inject without one),
   * the resident service restarts it with --remote-debugging-port after a
   * grace period instead of waiting forever.
   */
  autoRestart: boolean;
}

export const DEFAULT_CONFIG: LiveWallConfig = {
  cdpPort: 0,
  mediaPort: 9333,
  apiPort: 9334,
  blur: 0,
  dim: 30,
  monet: true,
  wallpaperVisible: true,
  fit: "contain",
  speed: 1,
  paused: false,
  pauseOnBlur: true,
  optimize: false,
  autoRestart: true,
};

export function dataDir(): string {
  const override = process.env.ZCODE_LIVEWALL_DATA_DIR;
  if (override) {
    return path.isAbsolute(override)
      ? override
      : path.join(os.homedir(), ".zcode", "cli", "plugins", "data", override);
  }
  const root = path.join(os.homedir(), ".zcode", "cli", "plugins", "data");
  const pluginScoped = path.join(root, "zcode-livewall@zcode-livewall");
  if (fs.existsSync(pluginScoped)) return pluginScoped;
  return path.join(root, "zcode-livewall");
}

export function configFile(): string {
  return path.join(dataDir(), "config.json");
}

export function tokenFile(): string {
  return path.join(dataDir(), "serve-token");
}

export function pidFile(): string {
  return path.join(dataDir(), "serve.pid");
}

export function cacheDir(): string {
  return path.join(dataDir(), "cache");
}

/** The resident service polls every 1.5s; stat + read each time is wasteful.
 *  Re-read only when the file's mtime changes. */
let cachedConfig: { mtimeMs: number; value: Partial<LiveWallConfig> } | undefined;

export function loadConfig(): Partial<LiveWallConfig> {
  try {
    const mtimeMs = fs.statSync(configFile()).mtimeMs;
    if (cachedConfig && cachedConfig.mtimeMs === mtimeMs) return cachedConfig.value;
    const value = JSON.parse(fs.readFileSync(configFile(), "utf8")) as Partial<LiveWallConfig>;
    cachedConfig = { mtimeMs, value };
    return value;
  } catch {
    return {};
  }
}

export function saveConfig(config: Partial<LiveWallConfig>): void {
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(config, null, 2));
  // Sub-ms writes may not move mtime; drop the cache so the next read is fresh.
  cachedConfig = undefined;
}

export function currentConfig(): LiveWallConfig {
  return { ...DEFAULT_CONFIG, ...loadConfig() };
}

export function readServeToken(): string | undefined {
  try {
    const value = fs.readFileSync(tokenFile(), "utf8").trim();
    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}
