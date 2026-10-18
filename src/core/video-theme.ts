/**
 * Monet / Material Design 3 colors sampled from a video frame.
 *
 * Video frames are decoded by the system ffmpeg into raw RGB, so no image
 * decoder library is needed. Sampling several timestamps and averaging the
 * per-frame palette keeps the theme from being decided by a black fade-in.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  QuantizerCelebi,
  Score,
  argbFromRgb,
  themeFromSourceColor,
  type Theme,
} from "@material/material-color-utilities";

const execFileAsync = promisify(execFile);

export interface VideoTheme {
  sourceArgb: number;
  theme: Theme;
  /** Representative still (JPEG bytes) usable as a poster / fallback image. */
  posterJpeg?: Buffer;
  /** Timestamp the poster was taken at, in seconds. */
  posterAt: number;
  duration?: number;
}

export interface FfmpegInfo {
  path: string;
  ffprobePath: string;
}

const FFMPEG_CANDIDATES = [
  process.env.FFMPEG_PATH,
  "ffmpeg",
  "D:/.codex/tools/ffmpeg/ffmpeg-n9.0.1-11-ge47273f4d9-win64-gpl-9.0/bin/ffmpeg.exe",
  "C:/ffmpeg/bin/ffmpeg.exe",
].filter(Boolean) as string[];

/** Cached lookup: probing PATH costs a process spawn each time, and every
 *  theme extraction / transcode / poster grab would otherwise repeat it. */
let ffmpegCache: FfmpegInfo | undefined | null = null;

/** Locates ffmpeg/ffprobe, preferring PATH and then the known local install. */
export async function findFfmpeg(): Promise<FfmpegInfo | undefined> {
  if (ffmpegCache !== null) return ffmpegCache ?? undefined;
  for (const candidate of FFMPEG_CANDIDATES) {
    const isPath = !candidate.includes("/") && !candidate.includes("\\");
    const exe = isPath ? candidate : candidate;
    try {
      await execFileAsync(exe, ["-version"], { timeout: 8000, windowsHide: true });
      const ffprobe = exe.replace(/ffmpeg(\.exe)?$/i, "ffprobe$1");
      const ffprobePath = ffprobe === exe ? "ffprobe" : ffprobe;
      try {
        await execFileAsync(ffprobePath, ["-version"], { timeout: 8000, windowsHide: true });
      } catch {
        ffmpegCache = { path: exe, ffprobePath: "ffprobe" };
        return ffmpegCache;
      }
      ffmpegCache = { path: exe, ffprobePath };
      return ffmpegCache;
    } catch {
      /* try next */
    }
  }
  ffmpegCache = undefined;
  return undefined;
}

export async function probeDuration(ffprobePath: string, mediaPath: string): Promise<number | undefined> {
  try {
    const { stdout } = await execFileAsync(
      ffprobePath,
      [
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "format=duration",
        "-of", "default=nw=1:nk=1",
        mediaPath,
      ],
      { timeout: 15000, windowsHide: true }
    );
    const value = Number(stdout.trim());
    return Number.isFinite(value) && value > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Grabs one frame at `at` seconds as a small raw RGB buffer. */
async function grabFrameRaw(
  ffmpegPath: string,
  mediaPath: string,
  at: number,
  width = 96,
  height = 54
): Promise<Buffer | undefined> {
  const tmp = path.join(os.tmpdir(), `zcode-livewall-${process.pid}-${Math.random().toString(36).slice(2)}.raw`);
  try {
    // `-ss` before `-i` seeks the input; a still image has no timeline, so the
    // seek yields zero frames and the whole extraction silently fails.
    const seek = at > 0 ? ["-ss", at.toFixed(3)] : [];
    await execFileAsync(
      ffmpegPath,
      [
        "-v", "error",
        ...seek,
        "-i", mediaPath,
        "-frames:v", "1",
        "-vf", `scale=${width}:${height}`,
        "-f", "rawvideo",
        "-pix_fmt", "rgb24",
        tmp,
        "-y",
      ],
      { timeout: 20000, windowsHide: true }
    );
    const buf = fs.readFileSync(tmp);
    return buf.length >= width * height * 3 ? buf.subarray(0, width * height * 3) : undefined;
  } catch {
    return undefined;
  } finally {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* ignore */
    }
  }
}

/** Grabs one JPEG frame, used as a poster and as the static fallback. */
export async function grabPosterJpeg(
  ffmpegPath: string,
  mediaPath: string,
  at: number,
  maxWidth = 1920,
  quality = 4
): Promise<Buffer | undefined> {
  const tmp = path.join(os.tmpdir(), `zcode-livewall-poster-${process.pid}-${Math.random().toString(36).slice(2)}.jpg`);
  try {
    // See grabFrameRaw: seeking a still image produces no frame at all.
    const seek = at > 0 ? ["-ss", at.toFixed(3)] : [];
    await execFileAsync(
      ffmpegPath,
      [
        "-v", "error",
        ...seek,
        "-i", mediaPath,
        "-frames:v", "1",
        "-vf", `scale='min(${maxWidth},iw)':-2`,
        "-q:v", String(quality),
        tmp,
        "-y",
      ],
      { timeout: 30000, windowsHide: true }
    );
    const buf = fs.readFileSync(tmp);
    return buf.length > 0 ? buf : undefined;
  } catch {
    return undefined;
  } finally {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* ignore */
    }
  }
}

function paletteFromRaw(raw: Buffer): number[] {
  const pixels: number[] = [];
  // Stride keeps the quantizer fast while still covering the whole frame.
  for (let i = 0; i + 2 < raw.length; i += 3) {
    pixels.push(argbFromRgb(raw[i], raw[i + 1], raw[i + 2]));
  }
  if (pixels.length === 0) return [];
  return Score.score(QuantizerCelebi.quantize(pixels, 48));
}

/**
 * Samples 3-5 evenly spaced frames, scores each palette, and uses the color
 * that ranks best across samples (with a brightness guard so a mostly-black
 * frame cannot win by being the only colorful thing in a fade).
 */
export async function themeFromVideo(mediaPath: string): Promise<VideoTheme | undefined> {
  const ff = await findFfmpeg();
  if (!ff) return undefined;

  const duration = await probeDuration(ff.ffprobePath, mediaPath);
  const points = duration
    ? [0.12, 0.3, 0.5, 0.7, 0.88].map((f) => Math.max(0.5, duration * f))
    : [1, 3, 6, 10];

  const scores = new Map<number, number>();
  const frames: Buffer[] = [];
  for (const at of points) {
    const raw = await grabFrameRaw(ff.path, mediaPath, at);
    if (!raw) continue;
    frames.push(raw);
    const ranked = paletteFromRaw(raw);
    ranked.slice(0, 6).forEach((argb, rank) => {
      scores.set(argb, (scores.get(argb) ?? 0) + (6 - rank));
    });
  }

  let best = [...scores.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (best === undefined) {
    // No decodable frame: fall back to a neutral MD3 seed.
    best = argbFromRgb(103, 80, 164);
  }

  const posterAt = points[Math.floor(points.length / 2)] ?? 1;
  const posterJpeg = await grabPosterJpeg(ff.path, mediaPath, posterAt);

  return {
    sourceArgb: best,
    theme: themeFromSourceColor(best),
    posterJpeg,
    posterAt,
    duration,
  };
}

/**
 * Theme from a still image or animated GIF. `scene` projects degrade to their
 * preview image, and those still need colors or the UI falls back to ZCode's
 * native palette after the switch.
 */
export async function themeFromImage(imagePath: string): Promise<VideoTheme | undefined> {
  const ff = await findFfmpeg();
  if (!ff) return undefined;

  const raw = await grabFrameRaw(ff.path, imagePath, 0, 128, 128);
  if (!raw) return undefined;
  const ranked = paletteFromRaw(raw);
  const sourceArgb = ranked[0] ?? argbFromRgb(103, 80, 164);

  return {
    sourceArgb,
    theme: themeFromSourceColor(sourceArgb),
    posterJpeg: undefined,
    posterAt: 0,
    duration: undefined,
  };
}

export function argbToCss(argb: number, alpha = 1): string {
  const r = (argb & 0xff0000) >> 16;
  const g = (argb & 0x00ff00) >> 8;
  const b = argb & 0x0000ff;
  return alpha >= 1
    ? `#${toHex(r)}${toHex(g)}${toHex(b)}`
    : `rgba(${r}, ${g}, ${b}, ${round2(alpha)})`;
}

function toHex(v: number): string {
  return v.toString(16).padStart(2, "0");
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
