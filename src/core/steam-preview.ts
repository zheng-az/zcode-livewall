/**
 * Steam Workshop preview fetcher.
 *
 * Local `preview.gif` files are tiny (192-256 px square) and look badly
 * blurred the moment they are scaled up. Steam's CDN serves the workshop
 * cover at 968×968 — 14× the pixels of a 256 px GIF — for scene projects,
 * whose real content is locked inside scene.pkg.
 *
 * The download runs strictly in the background: callers get the local
 * preview immediately and re-push once the sharper cover lands. Failures
 * are remembered for 10 minutes so an offline machine does not retry on
 * every wallpaper switch.
 *
 * Pure Node fetch throughout. execFile("curl", ...) loses its quoting on
 * Windows (Content-Type: and & get eaten by the command line), which is
 * exactly why the first attempt here silently downloaded nothing.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { dataDir } from "./config.js";
import { findSteamLibraries } from "./we-library.js";

const STEAM_API = "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/";
const WORKSHOP_APP_ID = "431960";
const DETAILS_TIMEOUT_MS = 6000;
const DETAILS_RETRIES = 4;
const DOWNLOAD_TIMEOUT_MS = 15000;
/** Cooldown starts at 1 min and doubles per consecutive failure (cap 30 min).
 *  The network to Steam is genuinely flaky here (~30% per-attempt success),
 *  so a fixed long cooldown would keep missing the good windows. */
const FAILURE_COOLDOWN_BASE_MS = 60 * 1000;
const FAILURE_COOLDOWN_MAX_MS = 30 * 60 * 1000;

export function isWorkshopId(projectId: string): boolean {
  return /^\d{6,12}$/.test(projectId.trim());
}

/**
 * True when the id is a subscribed Wallpaper Engine workshop project on this
 * machine. Only those are worth a CDN lookup. The libraries are discovered the
 * same way as the rest of the plugin, so no Steam path is baked in here.
 */
function localWorkshopProject(projectId: string): boolean {
  const id = projectId.trim();
  for (const lib of findSteamLibraries()) {
    const p = path.join(lib, "steamapps", "workshop", "content", WORKSHOP_APP_ID, id, "project.json");
    if (fs.existsSync(p)) return true;
  }
  return false;
}

function previewDir(): string {
  return path.join(dataDir(), "steam-previews");
}

function previewCachePath(projectId: string): string {
  return path.join(previewDir(), `${projectId.trim()}.jpg`);
}

/** Sync cache lookup — safe to call on every config build. */
export function cachedSteamPreview(projectId: string): string | undefined {
  if (!isWorkshopId(projectId)) return undefined;
  try {
    const p = previewCachePath(projectId);
    return fs.existsSync(p) && fs.statSync(p).size > 30 * 1024 ? p : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reads pixel dimensions from an image header without a decoder:
 * GIF (bytes 6-9, LE), PNG (IHDR), JPEG (SOF scan). Returns undefined for
 * anything it cannot parse — callers then treat the file as unknown.
 */
export function imageSize(imagePath: string): { width: number; height: number } | undefined {
  try {
    const fd = fs.openSync(imagePath, "r");
    const head = Buffer.alloc(64);
    fs.readSync(fd, head, 0, 64, 0);
    fs.closeSync(fd);

    if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) {
      return { width: head.readUInt16LE(6), height: head.readUInt16LE(8) };
    }
    if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e) {
      const png = Buffer.alloc(24);
      const fd2 = fs.openSync(imagePath, "r");
      fs.readSync(fd2, png, 0, 24, 0);
      fs.closeSync(fd2);
      return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
    }
    if (head[0] === 0xff && head[1] === 0xd8) {
      const fd3 = fs.openSync(imagePath, "r");
      const scan = Buffer.alloc(Math.min(fs.fstatSync(fd3).size, 512 * 1024));
      fs.readSync(fd3, scan, 0, scan.length, 0);
      fs.closeSync(fd3);
      let p = 2;
      while (p + 9 < scan.length) {
        if (scan[p] !== 0xff) { p++; continue; }
        const marker = scan[p + 1];
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { p += 2; continue; }
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: scan.readUInt16BE(p + 5), width: scan.readUInt16BE(p + 7) };
        }
        p += 2 + scan.readUInt16BE(p + 2);
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** A preview this narrow reads as a blur the moment it is scaled up. */
export const MIN_USEFUL_PREVIEW_WIDTH = 640;

const inFlight = new Set<string>();
const failures = new Map<string, { count: number; at: number }>();

function cooldownRemaining(id: string): number {
  const f = failures.get(id);
  if (!f) return 0;
  const wait = Math.min(FAILURE_COOLDOWN_BASE_MS * 2 ** f.count, FAILURE_COOLDOWN_MAX_MS);
  return Math.max(0, wait - (Date.now() - f.at));
}

async function fetchDetails(projectId: string): Promise<string | undefined> {
  const body = `itemcount=1&publishedfileids%5B0%5D=${encodeURIComponent(projectId)}`;
  // The API occasionally times out on the first try (observed in practice),
  // so give it a couple of extra shots before declaring the network dead.
  let lastErr: Error | undefined;
  for (let attempt = 0; attempt < DETAILS_RETRIES; attempt++) {
    try {
      const res = await fetch(STEAM_API, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(DETAILS_TIMEOUT_MS),
      });
      const json = (await res.json()) as { response?: { publishedfiledetails?: { preview_url?: string }[] } };
      return json.response?.publishedfiledetails?.[0]?.preview_url;
    } catch (err) {
      lastErr = err as Error;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  throw lastErr ?? new Error("steam api unreachable");
}

async function downloadTo(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ab = await res.arrayBuffer();
  fs.writeFileSync(dest, Buffer.from(ab));
}

/**
 * Fires the download in the background. Never throws, never blocks; the
 * caller re-checks cachedSteamPreview() on its next config build and pushes
 * the update itself.
 */
export function refreshSteamPreview(
  projectId: string,
  onDone?: (cachePath: string | undefined) => void
): void {
  const id = projectId.trim();
  if (!isWorkshopId(id) || inFlight.has(id)) return;
  if (cooldownRemaining(id) > 0) return;

  if (!localWorkshopProject(id)) return;

  inFlight.add(id);
  void (async () => {
    try {
      const url = await fetchDetails(id);
      if (!url) throw new Error("no preview_url");

      fs.mkdirSync(previewDir(), { recursive: true });
      const tmp = path.join(os.tmpdir(), `zlw-prev-${id}-${Math.random().toString(36).slice(2)}.img`);
      await downloadTo(url, tmp);

      // Accept the three formats Steam actually serves (JPEG, GIF, PNG); the
      // first release rejected GIFs, which is what most scene workshops ship.
      const dim = imageSize(tmp);
      if (!dim) throw new Error("unreadable image");
      if (fs.statSync(tmp).size < 30 * 1024) throw new Error("download too small");
      fs.renameSync(tmp, previewCachePath(id));
      failures.delete(id);
      onDone?.(previewCachePath(id));
    } catch (err) {
      console.error(`steam-preview: ${id} failed — ${(err as Error).message}`);
      const prev = failures.get(id);
      failures.set(id, { count: (prev?.count ?? 0) + 1, at: Date.now() });
      onDone?.(undefined);
    } finally {
      inFlight.delete(id);
    }
  })();
}
