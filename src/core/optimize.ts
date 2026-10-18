/**
 * Optional downscale cache for very large wallpapers.
 *
 * A 4K 60 fps source decodes at full resolution no matter how small it is
 * displayed, which pegs the CPU on this class of hardware. Re-encoding once
 * into a capped 30 fps copy cuts decode cost by roughly an order of magnitude;
 * the cost is a one-time transcode in the background. The target height tracks
 * the display's actual device pixels (see effectiveTargetHeight), so the cache
 * stays sharp instead of being pushed through a fixed 1080 bottleneck.
 *
 * Transcoding is never on the switch path: the original plays immediately and
 * the cached copy takes over on a later poll once it is ready.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { cacheDir } from "./config.js";
import { findFfmpeg, probeDuration } from "./video-theme.js";

const execFileAsync = promisify(execFile);

/** Above this pixel count a video is worth downscaling for background use. */
export const OPTIMIZE_PIXEL_THRESHOLD = 1920 * 1080 * 1.3;
/** Cap the frame rate; 30 fps is plenty for a background. */
const TARGET_FPS = 30;

export interface VideoInfo {
  width: number;
  height: number;
  fps?: number;
  duration?: number;
}

export async function probeVideo(mediaPath: string): Promise<VideoInfo | undefined> {
  const ff = await findFfmpeg();
  if (!ff) return undefined;
  try {
    const { stdout } = await execFileAsync(
      ff.ffprobePath,
      [
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height,r_frame_rate",
        "-of", "default=nw=1:nk=1",
        mediaPath,
      ],
      { timeout: 15000, windowsHide: true }
    );
    const [w, h, rate] = stdout.trim().split(/\s+/);
    const [num, den] = (rate ?? "").split("/").map(Number);
    return {
      width: Number(w),
      height: Number(h),
      fps: Number.isFinite(num) && Number.isFinite(den) && den > 0 ? num / den : undefined,
      duration: await probeDuration(ff.ffprobePath, mediaPath),
    };
  } catch {
    return undefined;
  }
}

export function needsOptimize(info: VideoInfo | undefined): boolean {
  if (!info) return false;
  const pixels = info.width * info.height;
  const tooBig = pixels > OPTIMIZE_PIXEL_THRESHOLD;
  const tooFast = (info.fps ?? 0) > TARGET_FPS + 5;
  return tooBig || tooFast;
}

/** Height floor so tiny displays still get a useful transcode target. */
export const OPTIMIZE_MIN_HEIGHT = 720;

function stampFor(mediaPath: string): string {
  let stamp = "0";
  try {
    const st = fs.statSync(mediaPath);
    stamp = `${Math.round(st.mtimeMs)}-${st.size}`;
  } catch {
    /* unreadable; caller will fail anyway */
  }
  return stamp;
}

function cacheFileFor(mediaPath: string, targetHeight: number): string {
  // Key on path + mtime + size + target height so a replaced file or a changed
  // display re-encodes instead of silently serving a stale cache. Hash the
  // whole string: a truncated base64 prefix collides across wallpapers that
  // share a directory prefix (every Workshop item starts with the same path).
  const key = createHash("sha1")
    .update(`${mediaPath}|${stampFor(mediaPath)}|${targetHeight}`)
    .digest("hex")
    .slice(0, 24);
  return path.join(cacheDir(), `${key}.mp4`);
}

const jobs = new Map<string, Promise<string | undefined>>();

/**
 * Transcode failures are remembered per (path + file stamp): resolveSource runs
 * on every poll, so without this a corrupt or undecodable file would restart a
 * fresh 30-minute ffmpeg attempt every 1.5 seconds forever. Retry policy is a
 * 10-minute cooldown with a hard per-version attempt cap; a replaced file gets
 * a new stamp and starts over. Toggling the panel switch calls
 * clearOptimizeRetries() so the user can still force a new attempt.
 */
const RETRY_COOLDOWN_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const failures = new Map<string, { count: number; at: number }>();

/** Clears failure memory (used when the user re-enables the optimize switch). */
export function clearOptimizeRetries(): void {
  failures.clear();
}

/**
 * Returns the cached downscaled copy if one already exists, otherwise starts a
 * background transcode and returns undefined. Callers play the original until
 * the next poll picks up the cache.
 */
/** Read-only lookup of an existing downscale cache (never starts a job). */
export function cachedCopy(mediaPath: string, targetHeight: number): string | undefined {
  const dest = cacheFileFor(mediaPath, targetHeight);
  try {
    return fs.existsSync(dest) && fs.statSync(dest).size > 0 ? dest : undefined;
  } catch {
    return undefined;
  }
}

export function optimizedCopy(mediaPath: string, targetHeight: number = 1080): string | undefined {
  const dest = cacheFileFor(mediaPath, targetHeight);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return dest;
  const failureKey = `${mediaPath}|${stampFor(mediaPath)}`;
  if (jobs.has(mediaPath)) return undefined;
  const failed = failures.get(failureKey);
  if (failed) {
    if (failed.count >= MAX_ATTEMPTS) return undefined;
    if (Date.now() - failed.at < RETRY_COOLDOWN_MS) return undefined;
  }

  const th = Math.max(OPTIMIZE_MIN_HEIGHT, Math.min(Math.round(targetHeight), 2160));
  const job = (async () => {
    const ff = await findFfmpeg();
    if (!ff) return undefined;
    fs.mkdirSync(cacheDir(), { recursive: true });
    const tmp = `${dest}.part.mp4`;
    try {
      await execFileAsync(
        ff.path,
        [
          "-v", "error",
          "-i", mediaPath,
          // Only ever shrink: `min(ih, <target>)` keeps both a 60 fps small
          // square from being blown up and a 4K source from overshooting.
          "-vf", `scale=-2:min(ih\\,${th}):flags=fast_bilinear`,
          "-r", String(TARGET_FPS),
          "-c:v", "libx264",
          "-preset", "veryfast",
          "-crf", "28",
          "-an",
          "-movflags", "+faststart",
          tmp,
          "-y",
        ],
        { timeout: 30 * 60 * 1000, windowsHide: true }
      );
      fs.renameSync(tmp, dest);
      // A zero-byte cache (ffmpeg exited 0 but decoded nothing) would be
      // re-attempted forever by the "missing cache" path below; record it as
      // a failure instead.
      if (fs.statSync(dest).size <= 0) {
        fs.rmSync(dest, { force: true });
        throw new Error("transcoder produced an empty file");
      }
      return dest;
    } catch {
      failures.set(failureKey, {
        count: (failures.get(failureKey)?.count ?? 0) + 1,
        at: Date.now(),
      });
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        /* ignore */
      }
      return undefined;
    } finally {
      jobs.delete(mediaPath);
    }
  })();

  jobs.set(mediaPath, job);
  void job.catch(() => undefined);
  return undefined;
}

export function isOptimizing(mediaPath: string): boolean {
  return jobs.has(mediaPath);
}
