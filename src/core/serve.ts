/**
 * `serve`: the resident service.
 *
 * Holds one CDP connection per ZCode renderer so
 * Page.addScriptToEvaluateOnNewDocument keeps re-installing the wallpaper
 * across renderer reloads, serves the video over loopback HTTP, and exposes a
 * token-gated control API for the injected panel and the MCP tools.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomBytes, createHash } from "node:crypto";
import {
  CdpConnection,
  discoverCdpPort,
  listTargets,
  pickRendererTargets,
} from "./cdp.js";
import {
  currentConfig,
  loadConfig,
  saveConfig,
  dataDir,
  cacheDir,
  pidFile,
  tokenFile,
  type LiveWallConfig,
  type SourceKind,
} from "./config.js";
import { buildPayload, buildResetScript, type PayloadInput } from "./payload.js";
import { startMediaServer, type MediaServer } from "./media-server.js";
import { findProject, listPlayable, type WeProject } from "./we-library.js";
import { themeFromVideo, themeFromImage, grabPosterJpeg, findFfmpeg } from "./video-theme.js";
import { optimizedCopy, probeVideo, needsOptimize, isOptimizing, clearOptimizeRetries, cachedCopy } from "./optimize.js";
import { buildPanelScript } from "../panel/panel-script.js";
import { isZcodeProcessRunning } from "./zcode-process.js";
import { killZcode, launchZcode } from "./launch.js";
import {
  cachedSteamPreview,
  refreshSteamPreview,
  imageSize,
  MIN_USEFUL_PREVIEW_WIDTH,
} from "./steam-preview.js";

const POLL_MS = 1500;
/**
 * Grace period before the resident service restarts a CDP-less ZCode with the
 * debug port. It must outlast a normal app update / crash-restart cycle so we
 * only act when ZCode is genuinely up and unreachable: the user experience is
 * "the wallpaper was gone for half a minute, then came back by itself".
 */
const AUTORESTART_DELAY_MS = 30_000;
/** Min interval between auto-restart attempts, so a refusing ZCode is not spawned in a loop. */
const AUTORESTART_COOLDOWN_MS = 10 * 60_000;
/** Uploads arrive as base64, so the body cap has to allow the encoded size. */
const MAX_UPLOAD_BYTES = 120 * 1024 * 1024;
const MAX_BODY = Math.ceil(MAX_UPLOAD_BYTES * 1.4);

export interface ServeOptions {
  cdpPort?: number;
  apiPort?: number;
  mediaPort?: number;
}

interface HeldSession {
  conn: CdpConnection;
  themeScriptId?: string;
  panelScriptId?: string;
}

interface RuntimeState {
  cdpReachable: boolean;
  cdpPort?: number;
  rendererCount: number;
  zcodeRunning: boolean;
  lastError?: string;
  updatedAt?: string;
}

let runtimeState: RuntimeState = { cdpReachable: false, rendererCount: 0, zcodeRunning: false };
let nextProcessProbe = 0;

/** Cached theme + poster, keyed by source path and mtime. */
let cachedSource:
  | { path: string; mtimeMs: number; theme?: Awaited<ReturnType<typeof themeFromVideo>> }
  | undefined;

/** In-flight theme extractions, so repeated polls share one ffmpeg run. */
const themeJobs = new Map<string, Promise<Awaited<ReturnType<typeof themeFromVideo>>>>();

/**
 * Failed theme extractions keyed the same way as the jobs (path + mtime), so a
 * broken file is not re-decoded on every later push. Retry after a cooldown;
 * a replaced file gets a new mtime and is retried immediately.
 */
const THEME_RETRY_COOLDOWN_MS = 5 * 60 * 1000;
const themeFailedAt = new Map<string, number>();

/** Poster naming keyed by the sampled file, not one shared "last video" file. */
function posterFileFor(samplePath: string): string {
  const hash = createHash("sha1").update(samplePath.toLowerCase()).digest("hex").slice(0, 16);
  return path.join(dataDir(), `poster-${hash}.jpg`);
}

/** In-flight single-frame poster extractions, so repeated switches share one. */
const posterJobs = new Map<string, Promise<void>>();

/**
 * Files already probed against the downscale threshold. Keyed by path+stamp so
 * a replaced file is re-checked, and cleared when the user re-enables the
 * optimize switch — otherwise a first probe that ran while ffmpeg was busy
 * would permanently suppress the transcode for this process's lifetime.
 */
const optimizingChecked = new Set<string>();

export function clearOptimizeChecks(): void {
  optimizingChecked.clear();
}

/** Last media path pushed to the renderers, so a cache swap can be detected. */
let lastPlayedPath: string | undefined;

/**
 * Renderer viewport need, captured at injection time. It decides the transcode
 * target height: a fixed 1080 cache is visibly soft on a 1440p+ window, and this
 * machine runs dpr 1.25 (~1153 device pixels tall), so the "optimized" copy of
 * 4K wallpapers must be cut to match, not to 1080.
 */
let viewNeeds = { w: 0, h: 0, dpr: 1 };

/** Display-derived transcode target: clamped [720, 2160], 1080 fallback. */
function displayTargetHeight(): number {
  if (!viewNeeds.h) return 1080;
  return Math.min(2160, Math.max(720, Math.round(viewNeeds.h * (viewNeeds.dpr || 1))));
}

/** Fire-and-forget sample of the renderer viewport (called after injections). */
function captureViewNeeds(conn: CdpConnection): void {
  conn
    .send("Runtime.evaluate", {
      expression: "JSON.stringify({w: window.innerWidth|0, h: window.innerHeight|0, dpr: Number(window.devicePixelRatio)||1})",
      returnByValue: true,
    })
    .then((r: any) => {
      const parsed = JSON.parse(r?.result?.value ?? "{}");
      if (parsed && parsed.h > 0) viewNeeds = parsed;
    })
    .catch(() => {});
}

/**
 * Theme lookup with two modes:
 *   - blocking (block: true): waits for the ffmpeg run and returns the theme.
 *   - background (default): returns the cached theme if present, otherwise
 *     starts the job and returns undefined immediately.
 *
 * The old implementation raced the job against `Promise.resolve(undefined)`,
 * which always won, so the background path could never surface a result and
 * every call re-started ffmpeg.
 */
function themeFor(
  sourcePath: string,
  opts: { block?: boolean } = {}
): Promise<Awaited<ReturnType<typeof themeFromVideo>>> {
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(sourcePath).mtimeMs;
  } catch {
    return Promise.resolve(undefined);
  }

  const cached = cachedSource?.path === sourcePath && cachedSource.mtimeMs === mtimeMs;
  if (cached && (cachedSource!.theme || opts.block)) {
    return Promise.resolve(cachedSource!.theme);
  }
  if (!/\.(mp4|webm|mov|m4v|mkv)$/i.test(sourcePath)) return Promise.resolve(undefined);

  const key = `${sourcePath}:${mtimeMs}`;
  // A recent failure for this exact file version short-circuits; the cooldown
  // allows one background retry, a replaced file (new mtime) retries at once.
  const failure = themeFailedAt.get(key);
  if (failure !== undefined && Date.now() - failure < THEME_RETRY_COOLDOWN_MS) {
    return Promise.resolve(undefined);
  }
  let job = themeJobs.get(key);
  if (!job) {
    job = themeFromVideo(sourcePath)
      .then((theme) => {
        cachedSource = { path: sourcePath, mtimeMs, theme };
        themeFailedAt.delete(key);
        return theme;
      })
      .catch(() => {
        // Remember the failure so a broken file is not re-decoded forever.
        cachedSource = { path: sourcePath, mtimeMs, theme: undefined };
        themeFailedAt.set(key, Date.now());
        return undefined;
      })
      .finally(() => {
        themeJobs.delete(key);
      });
    themeJobs.set(key, job);
  }
  return opts.block ? job : cached ? Promise.resolve(cachedSource!.theme) : Promise.resolve(undefined);
}

/**
 * Same caching contract as themeFor, for still images / animated GIFs.
 * `scene` projects play their preview image, and without colors the UI drops
 * back to ZCode's native palette after switching to one.
 */
function themeForImage(
  sourcePath: string,
  opts: { block?: boolean } = {}
): Promise<Awaited<ReturnType<typeof themeFromImage>>> {
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(sourcePath).mtimeMs;
  } catch {
    return Promise.resolve(undefined);
  }

  const cached = cachedSource?.path === sourcePath && cachedSource.mtimeMs === mtimeMs;
  if (cached && (cachedSource!.theme || opts.block)) {
    return Promise.resolve(cachedSource!.theme);
  }

  const key = `img:${sourcePath}:${mtimeMs}`;
  // Same failure guard as themeFor: never re-run ffmpeg for a still frame
  // that already failed recently.
  const failure = themeFailedAt.get(key);
  if (failure !== undefined && Date.now() - failure < THEME_RETRY_COOLDOWN_MS) {
    return Promise.resolve(undefined);
  }
  let job = themeJobs.get(key);
  if (!job) {
    job = themeFromImage(sourcePath)
      .then((theme) => {
        cachedSource = { path: sourcePath, mtimeMs, theme };
        themeFailedAt.delete(key);
        return theme;
      })
      .catch(() => {
        cachedSource = { path: sourcePath, mtimeMs, theme: undefined };
        themeFailedAt.set(key, Date.now());
        return undefined;
      })
      .finally(() => {
        themeJobs.delete(key);
      });
    themeJobs.set(key, job);
  }
  return opts.block ? job : cached ? Promise.resolve(cachedSource!.theme) : Promise.resolve(undefined);
}

function isVideo(p: string): boolean {
  return /\.(mp4|webm|mov|m4v|mkv)$/i.test(p);
}
function isWeb(p: string): boolean {
  return /\.html?$/i.test(p);
}
function isAnimatedImage(p: string): boolean {
  return /\.gif$/i.test(p);
}

interface ResolvedSource {
  kind: SourceKind;
  /** The file the wallpaper actually plays (may be a downscaled cache copy). */
  path: string;
  /** The user-selected original, kept so colors/poster sample the real file. */
  originalPath?: string;
  posterPath?: string;
  project?: WeProject;
}

function resolveSource(config: LiveWallConfig): ResolvedSource | undefined {
  if (!config.source || !fs.existsSync(config.source)) return undefined;
  if (isWeb(config.source)) return { kind: "web", path: config.source, posterPath: undefined };
  if (isVideo(config.source)) {
    // `optimize` swaps in a downscaled cache once it exists; the original is
    // what plays until then, and what gets sampled for colors either way.
    if (config.optimize) {
      const cached = optimizedCopy(config.source, displayTargetHeight());
      if (cached) return { kind: "video", path: cached, posterPath: undefined, originalPath: config.source };
      void ensureOptimized(config.source);
    }
    return { kind: "video", path: config.source };
  }
  if (isAnimatedImage(config.source)) return { kind: "image", path: config.source };
  return { kind: "image", path: config.source };
}

/** Starts a background transcode for oversized videos (no-op once cached). */
async function ensureOptimized(mediaPath: string): Promise<void> {
  // Key on the file stamp so a replaced file is probed again.
  let stamp = "0";
  try {
    const st = fs.statSync(mediaPath);
    stamp = `${Math.round(st.mtimeMs)}-${st.size}`;
  } catch {
    return;
  }
  const key = `${mediaPath}|${stamp}`;
  if (optimizingChecked.has(key)) return;
  optimizingChecked.add(key);
  const info = await probeVideo(mediaPath);
  if (needsOptimize(info)) optimizedCopy(mediaPath, displayTargetHeight());
}

export async function startServe(opts: ServeOptions): Promise<void> {
  fs.mkdirSync(dataDir(), { recursive: true });

  const stored = currentConfig();
  const apiPort = opts.apiPort ?? stored.apiPort;
  const mediaPort = opts.mediaPort ?? stored.mediaPort;
  const fixedCdpPort = opts.cdpPort ?? (stored.cdpPort > 0 ? stored.cdpPort : undefined);

  const token = randomBytes(16).toString("hex");
  fs.writeFileSync(tokenFile(), token);
  fs.writeFileSync(pidFile(), String(process.pid));

  const media = await startMediaServer(mediaPort);
  let currentCdpPort: number | undefined;

  // --- injection session management ---------------------------------------

  const held = new Map<string, HeldSession>();

  /** Media URLs are stable per serve lifetime, but the token rotates on restart. */
  let publishedFor: { path: string; videoUrl?: string; posterUrl?: string; webUrl?: string } | undefined;

  async function mediaUrls(config: LiveWallConfig, source: ResolvedSource) {
    if (publishedFor?.path === source.path) return publishedFor;
    const entry: typeof publishedFor = { path: source.path };
    if (source.kind === "web") {
      entry.webUrl = `http://127.0.0.1:${media.port}${media.publish("web", source.path)}`;
    } else {
      entry.videoUrl = `http://127.0.0.1:${media.port}${media.publish("media", source.path)}`;
    }

    // Poster: the project preview, or a cached frame keyed by the sampled
    // file. A cold video has none yet; the layer simply starts on the video
    // and gains a poster on the follow-up push once the background extraction
    // finishes. Never reuse another video's frame as the poster.
    let posterPath = source.posterPath;
    if (!posterPath && source.kind === "video") {
      const posterFile = posterFileFor(source.originalPath ?? source.path);
      if (fs.existsSync(posterFile)) posterPath = posterFile;
    }
    // Scene projects ship a huge variety of local previews: some are true
    // 1080p JPEGs, others 192-256 px GIFs that blur instantly when scaled.
    // Prefer a cached Steam cover, but only when it is genuinely larger —
    // for many workshop items the CDN copy is the same 256 px GIF as the
    // local one, and swapping would change nothing.
    if (config.projectId && (source.kind === "image" || source.kind === "web")) {
      const cached = cachedSteamPreview(config.projectId);
      const localDim = posterPath ? imageSize(posterPath) : undefined;
      const localWidth = localDim?.width ?? 0;
      if (cached) {
        const cachedDim = imageSize(cached);
        if ((cachedDim?.width ?? 0) > localWidth) posterPath = cached;
      } else if (!localDim || localWidth < MIN_USEFUL_PREVIEW_WIDTH) {
        refreshSteamPreview(config.projectId, (downloaded) => {
          // Land the sharper cover: rebuild only if the source did not
          // change while we were downloading.
          const latest = currentConfig();
          if (latest.projectId === config.projectId && downloaded) {
            publishedFor = undefined;
            void pushConfig(latest).catch(() => 0);
          }
        });
      }
    }
    if (posterPath) {
      entry.posterUrl = `http://127.0.0.1:${media.port}${media.publish("poster", posterPath)}`;
    }
    publishedFor = entry;
    return entry;
  }

  async function buildFor(
    config: LiveWallConfig,
    opts: { blockTheme?: boolean } = {}
  ): Promise<{ payload: ReturnType<typeof buildPayload>; input: PayloadInput } | undefined> {
    const source = resolveSource(config);
    if (!source) return undefined;
    const urls = await mediaUrls(config, source);
    // Sample the original, not the downscaled cache: re-encoding shifts colors.
    const samplePath = source.originalPath ?? source.path;
    const theme =
      source.kind === "video"
        ? await themeFor(samplePath, { block: opts.blockTheme })
        : source.kind === "image"
          ? await themeForImage(samplePath, { block: opts.blockTheme })
          : undefined;
    const input: PayloadInput = {
      config,
      videoUrl: source.kind === "image" ? undefined : urls.videoUrl,
      posterUrl: urls.posterUrl,
      webUrl: urls.webUrl,
      theme: theme?.theme,
    };
    // Animated GIFs use the poster slot as an <img> so they animate on their own.
    if (source.kind === "image") {
      input.posterUrl = urls.videoUrl;
      input.videoUrl = undefined;
    }
    return { payload: buildPayload(input), input };
  }

  async function holdSession(
    target: { id: string; webSocketDebuggerUrl?: string },
    config: LiveWallConfig
  ): Promise<void> {
    if (!target.webSocketDebuggerUrl) return;
    const conn = await CdpConnection.connect(target.webSocketDebuggerUrl);
    try {
      await conn.send("Page.enable");
      const session: HeldSession = { conn };

      const built = await buildFor(config);
      if (built) {
        const { identifier } = await conn.send("Page.addScriptToEvaluateOnNewDocument", {
          source: built.payload.script,
        });
        session.themeScriptId = identifier;
        await conn.send("Runtime.evaluate", { expression: built.payload.script, returnByValue: true });
        // A cold video has no theme yet (the non-blocking build only starts the
        // ffmpeg job), so schedule the colored follow-up push.
        if (built.input.theme === undefined) scheduleThemeRefresh(config);
        // Same reasoning for the poster: get a thumbnail going immediately on
        // a fresh renderer attachment for video sources.
        kickPoster(config);
      }
      captureViewNeeds(conn);

      const panelScript = buildPanelScript(apiPort, token);
      const panel = await conn.send("Page.addScriptToEvaluateOnNewDocument", { source: panelScript });
      session.panelScriptId = panel.identifier;
      await conn.send("Runtime.evaluate", { expression: panelScript, returnByValue: true });

      held.set(target.id, session);
    } catch (err) {
      conn.close();
      throw err;
    }
  }

  async function pushConfig(config: LiveWallConfig, opts: { blockTheme?: boolean } = {}): Promise<number> {
    const built = await buildFor(config, opts);
    if (!built) return 0;
    let ok = 0;
    for (const [id, session] of held) {
      try {
        if (session.themeScriptId) {
          await session.conn
            .send("Page.removeScriptToEvaluateOnNewDocument", { identifier: session.themeScriptId })
            .catch(() => {});
        }
        session.themeScriptId = await session.conn
          .send("Page.addScriptToEvaluateOnNewDocument", { source: built.payload.script })
          .then((r: any) => r.identifier);
        await session.conn.send("Runtime.evaluate", {
          expression: built.payload.script,
          returnByValue: true,
        });
        captureViewNeeds(session.conn);
        ok++;
      } catch {
        session.conn.close();
        held.delete(id);
      }
    }
    return ok;
  }

  /**
   * A switch must paint immediately, but the theme needs an ffmpeg run. So the
   * first push goes out without colors, and this second pass re-pushes once the
   * extraction lands (or right away when the theme was already cached).
   */
  function scheduleThemeRefresh(config: LiveWallConfig): void {
    const source = resolveSource(config);
    if (!source) return;
    // Videos and still images both get colors; web projects are an opaque page
    // that covers the layer, so there is nothing to sample from.
    if (source.kind !== "video" && source.kind !== "image") return;
    // Sample the original like buildFor does: a downscaled cache shifts colors.
    const sample = source.originalPath ?? source.path;
    const wanted = source.path;
    const lookup = source.kind === "video" ? themeFor : themeForImage;
    void lookup(sample, { block: true })
      .then(async (theme) => {
        if (!theme) return;
        // The user may have switched again while ffmpeg was running.
        const latest = resolveSource(currentConfig());
        if (!latest || latest.path !== wanted) return;
        if (theme.posterJpeg) {
          try {
            const posterFile = posterFileFor(sample);
            fs.writeFileSync(posterFile, theme.posterJpeg);
            // The legacy shared poster plus keyed frames of other sources are
            // irrelevant the moment this source owns its own poster.
            for (const entry of fs.readdirSync(dataDir())) {
              const isStale = entry === "poster.jpg" ||
                (entry.startsWith("poster-") && entry !== path.basename(posterFile));
              if (!isStale) continue;
              try { fs.rmSync(path.join(dataDir(), entry), { force: true }); } catch { /* ignore */ }
            }
          } catch {
            /* poster is optional */
          }
        }
        publishedFor = undefined;
        // The theme is already in hand at this point, so the follow-up push can
        // wait for it and ship colors + poster in the same injection.
        await pushConfig(currentConfig(), { blockTheme: true }).catch(() => 0);
      })
      .catch(() => {
        /* colors are cosmetic; the wallpaper keeps playing */
      });
  }

  /**
   * The follow-up push after the theme job can take seconds on a 4K original
   * (it samples many frames for the palette). The poster is a cheap artifact
   * worth having much earlier: one frame, preferably from the tiny 800p cache.
   * Extract it as its own job right after a switch so the video layer can sit
   * on a real thumbnail instead of a black frame while it buffers.
   */
  function kickPoster(config: LiveWallConfig): void {
    const source = resolveSource(config);
    if (!source || source.kind !== "video") return;
    const sample = source.originalPath ?? source.path;
    const posterFile = posterFileFor(sample);
    try {
      if (fs.existsSync(posterFile)) return;
    } catch {
      /* fall through and try again */
    }
    if (posterJobs.has(sample)) return;
    const job = (async () => {
      try {
        const ff = await findFfmpeg();
        if (!ff) return;
        // The downscale cache decodes an order of magnitude cheaper.
        const from = cachedCopy(sample, displayTargetHeight()) ?? sample;
        const buf = await grabPosterJpeg(ff.path, from, 0);
        if (buf) fs.writeFileSync(posterFile, buf);
      } catch {
        /* poster is optional */
      } finally {
        posterJobs.delete(sample);
      }
      // If the user has not switched away meanwhile, push the poster onto the
      // live layer (a reload gets it automatically via addScript...).
      const latest = resolveSource(currentConfig());
      if ((latest?.originalPath ?? latest?.path) === sample) {
        publishedFor = undefined;
        await pushConfig(currentConfig()).catch(() => 0);
      }
    })();
    posterJobs.set(sample, job);
  }

  /**
   * Auto-recovery: when ZCode is running but was started without the debug
   * port, injection is impossible and the wallpaper stays gone. Instead of
   * waiting forever, restart ZCode with --remote-debugging-port after a grace
   * period (config.autoRestart, default on). Cooldown prevents spawn loops.
   */
  let cdpMissingSince = 0;
  let lastAutoRestart = 0;

  async function maybeAutoRestart(): Promise<void> {
    if (!currentConfig().autoRestart) return;
    const now = Date.now();
    if (!cdpMissingSince) cdpMissingSince = now;
    if (now - cdpMissingSince < AUTORESTART_DELAY_MS) return;
    if (now - lastAutoRestart < AUTORESTART_COOLDOWN_MS) return;
    if (!(await isZcodeProcessRunning())) {
      cdpMissingSince = now; // nothing to restart; wait for ZCode to appear
      return;
    }
    lastAutoRestart = now;
    console.log("serve: ZCode has no CDP port — restarting it with --remote-debugging-port");
    // launchZcode alone refuses while an instance is running (it cannot grow a
    // port), so the CDP-less instance must go first. Graceful close keeps the
    // user's work; if ZCode refuses to die the restart is abandoned for now.
    await killZcode();
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (!(await isZcodeProcessRunning())) break;
    }
    if (await isZcodeProcessRunning()) {
      console.error("serve: ZCode did not exit; auto-restart abandoned for this cooldown");
      return;
    }
    const r = await launchZcode(fixedCdpPort ?? 9222).catch((err) => {
      console.error(`serve: auto-restart failed — ${(err as Error).message}`);
      return { started: false } as const;
    });
    if (r.started) console.log("serve: ZCode restarted with CDP; injection resumes on the next poll");
  }

  async function poll(): Promise<void> {
    const config = currentConfig();
    let port = fixedCdpPort;
    if (!port) {
      port = await discoverCdpPort();
      if (!port) {
        for (const [id, session] of held) {
          session.conn.close();
          held.delete(id);
        }
        if (Date.now() > nextProcessProbe) {
          nextProcessProbe = Date.now() + 15000;
          runtimeState = {
            cdpReachable: false,
            rendererCount: 0,
            zcodeRunning: await isZcodeProcessRunning(),
            lastError: "No ZCode renderer with an open CDP port found.",
            updatedAt: new Date().toISOString(),
          };
        }
        await maybeAutoRestart();
        return;
      }
    }
    currentCdpPort = port;
    cdpMissingSince = 0;

    try {
      const targets = pickRendererTargets(await listTargets(port));
      const current = new Set(targets.map((t) => t.id));
      for (const t of targets) {
        if (!held.has(t.id)) {
          try {
            await holdSession(t, config);
            console.log(`serve: injected into "${t.title}" (${t.id})`);
          } catch {
            /* retry next tick */
          }
        }
      }
      for (const id of [...held.keys()]) {
        if (!current.has(id)) {
          held.get(id)!.conn.close();
          held.delete(id);
        }
      }

      // A background transcode may have finished since the last injection;
      // swap the renderer over to the cached copy once it appears.
      const sourceNow = resolveSource(config);
      const playing = sourceNow?.path;
      if (config.optimize && playing && sourceNow?.originalPath && playing !== lastPlayedPath) {
        lastPlayedPath = playing;
        void pushConfig(config).catch(() => 0);
      } else if (playing) {
        lastPlayedPath = playing;
      }

      runtimeState = {
        cdpReachable: true,
        cdpPort: port,
        rendererCount: targets.length,
        zcodeRunning: true,
        updatedAt: new Date().toISOString(),
      };
    } catch (err) {
      for (const [id, session] of held) {
        session.conn.close();
        held.delete(id);
      }
      if (Date.now() > nextProcessProbe) {
        nextProcessProbe = Date.now() + 15000;
        runtimeState = {
          cdpReachable: false,
          cdpPort: port,
          rendererCount: 0,
          zcodeRunning: await isZcodeProcessRunning(),
          lastError: (err as Error).message,
          updatedAt: new Date().toISOString(),
        };
      }
      // The port answered before but is gone now (ZCode restarted without the
      // flag, or is mid-restart) — run the same recovery path as discovery.
      await maybeAutoRestart();
    }
  }

  // --- HTTP API ------------------------------------------------------------

  function publicConfig(config: LiveWallConfig) {
    const source = resolveSource(config);
    return {
      blur: config.blur,
      dim: config.dim,
      monet: config.monet,
      wallpaperVisible: config.wallpaperVisible,
      fit: config.fit,
      speed: config.speed,
      paused: config.paused,
      pauseOnBlur: config.pauseOnBlur,
      optimize: config.optimize,
      optimizing: Boolean(config.source && isOptimizing(config.source)),
      sourceSet: Boolean(source),
      sourceKind: source?.kind,
      /**
       * The user-selected file. Never the downscaled cache: clients treat this
       * as the source of truth, and handing them a cache path makes them
       * resolve the wrong wallpaper (or fall back to the first entry).
       */
      source: source?.originalPath ?? source?.path,
      sourceName: config.projectId
        ? findProject(config.projectId)?.title ?? path.basename(config.source ?? "")
        : config.source
          ? path.basename(config.source)
          : undefined,
      cdpPort: runtimeState.cdpPort,
      mediaPort: media.port,
    };
  }

  function sanitize(body: any): Partial<LiveWallConfig> {
    const out: Partial<LiveWallConfig> = {};
    if (typeof body?.blur === "number" && body.blur >= 0 && body.blur <= 100) out.blur = body.blur;
    if (typeof body?.dim === "number" && body.dim >= 0 && body.dim <= 100) out.dim = body.dim;
    if (typeof body?.monet === "boolean") out.monet = body.monet;
    if (typeof body?.wallpaperVisible === "boolean") out.wallpaperVisible = body.wallpaperVisible;
    if (body?.fit === "cover" || body?.fit === "contain") out.fit = body.fit;
    if (typeof body?.speed === "number" && body.speed >= 0.25 && body.speed <= 3) out.speed = body.speed;
    if (typeof body?.paused === "boolean") out.paused = body.paused;
    if (typeof body?.pauseOnBlur === "boolean") out.pauseOnBlur = body.pauseOnBlur;
    if (typeof body?.optimize === "boolean") out.optimize = body.optimize;
    return out;
  }

  function sendJson(res: http.ServerResponse, code: number, body: unknown): void {
    try {
      res.writeHead(code, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, x-zlw-token",
      });
      res.end(JSON.stringify(body));
    } catch {
      /* socket gone */
    }
  }

  function authorized(req: http.IncomingMessage): boolean {
    const header = req.headers["x-zlw-token"];
    return typeof header === "string" && header === token;
  }

  function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => {
        size += c.length;
        if (size > MAX_BODY) {
          reject(new Error("request body too large"));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch(() => {
      try {
        res.destroy();
      } catch {
        /* socket gone */
      }
    });
  });

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    try {
      if (req.method === "OPTIONS") return sendJson(res, 204, {});
      if (url.pathname !== "/api/health" && !authorized(req)) {
        return sendJson(res, 403, { error: "missing or invalid token" });
      }

      if (req.method === "GET" && url.pathname === "/api/config") {
        return sendJson(res, 200, publicConfig(currentConfig()));
      }

      if (req.method === "POST" && url.pathname === "/api/config") {
        const patch = sanitize(JSON.parse(await readBody(req)));
        if (patch.optimize === true) {
          clearOptimizeRetries();
          // Also drop the "already probed" memory: without this, re-enabling
          // the switch after a failed probe does nothing until a restart.
          clearOptimizeChecks();
        }
        const config = { ...currentConfig(), ...patch };
        saveConfig(config);
        const windows = await pushConfig(config).catch(() => 0);
        if (patch.monet !== undefined) scheduleThemeRefresh(config);
        return sendJson(res, 200, { ok: true, windows, ...publicConfig(config) });
      }

      if (req.method === "GET" && url.pathname === "/api/projects") {
        const projects = listPlayable().map((p) => ({
          id: p.id,
          title: p.title,
          type: p.type,
          source: p.source,
          media: p.mediaPath ? path.basename(p.mediaPath) : undefined,
        }));
        return sendJson(res, 200, { projects });
      }

      if (req.method === "POST" && url.pathname === "/api/source") {
        const body = JSON.parse(await readBody(req));
        // Panel/MCP send strings; tolerate numbers so a bare id from any
        // client still resolves instead of matching "".
        const wanted = body?.project != null && body.project !== "" ? String(body.project) : "";
        const project = wanted ? findProject(wanted) : undefined;
        if (!project?.mediaPath) {
          return sendJson(res, 400, { error: `no playable project matching "${wanted}"` });
        }
        const config: LiveWallConfig = {
          ...currentConfig(),
          source: project.mediaPath,
          sourceKind: project.type === "web" ? "web" : isVideo(project.mediaPath) ? "video" : "image",
          projectId: project.id,
        };
        publishedFor = undefined;
        saveConfig(config);
        const windows = await pushConfig(config).catch(() => 0);
        scheduleThemeRefresh(config);
        kickPoster(config);
        return sendJson(res, 200, { ok: true, windows, ...publicConfig(config) });
      }

      if (req.method === "POST" && url.pathname === "/api/source/path") {
        const body = JSON.parse(await readBody(req));
        const file = typeof body?.path === "string" ? path.resolve(body.path) : "";
        if (!file || !fs.existsSync(file)) {
          return sendJson(res, 400, { error: "file not found" });
        }
        // A cache file is an internal artifact; accepting it as a new source
        // would silently pin the wallpaper to a stale transcode.
        if (file.startsWith(cacheDir())) {
          return sendJson(res, 400, { error: "cache files cannot be used as a wallpaper source" });
        }
        const config: LiveWallConfig = {
          ...currentConfig(),
          source: file,
          sourceKind: isWeb(file) ? "web" : isVideo(file) ? "video" : "image",
          projectId: undefined,
        };
        publishedFor = undefined;
        saveConfig(config);
        const windows = await pushConfig(config).catch(() => 0);
        scheduleThemeRefresh(config);
        kickPoster(config);
        return sendJson(res, 200, { ok: true, windows, ...publicConfig(config) });
      }

      if (req.method === "POST" && url.pathname === "/api/upload") {
        const body = JSON.parse(await readBody(req));
        const name = typeof body?.name === "string" ? path.basename(body.name) : "";
        const dataUri = typeof body?.dataUri === "string" ? body.dataUri : "";
        const m = /^data:(video\/[\w.+-]+|image\/[\w.+-]+);base64,(.+)$/.exec(dataUri);
        if (!m || !name) return sendJson(res, 400, { error: "name and a base64 media data URI are required" });
        const bytes = Buffer.from(m[2], "base64");
        if (bytes.length > MAX_UPLOAD_BYTES) {
          return sendJson(res, 400, {
            error: `file too large (max ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB)`,
          });
        }
        const dir = path.join(dataDir(), "uploads");
        fs.mkdirSync(dir, { recursive: true });
        // Keep a real extension: the kind detection and the media server's
        // Content-Type both key off it, and some pickers hand over bare names.
        const extByMime: Record<string, string> = {
          "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp",
          "image/gif": ".gif", "image/bmp": ".bmp", "image/avif": ".avif",
          "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov",
          "video/x-matroska": ".mkv",
        };
        let safeName = name;
        if (!path.extname(safeName)) safeName += extByMime[m[1]] ?? "";
        const dest = path.join(dir, safeName);
        fs.writeFileSync(dest, bytes);
        const config: LiveWallConfig = {
          ...currentConfig(),
          source: dest,
          sourceKind: isWeb(dest) ? "web" : isVideo(dest) ? "video" : "image",
          projectId: undefined,
        };
        publishedFor = undefined;
        saveConfig(config);
        const windows = await pushConfig(config).catch(() => 0);
        scheduleThemeRefresh(config);
        kickPoster(config);
        return sendJson(res, 200, { ok: true, windows, ...publicConfig(config) });
      }

      if (req.method === "POST" && url.pathname === "/api/reset") {
        for (const [id, session] of held) {
          try {
            if (session.themeScriptId) {
              await session.conn
                .send("Page.removeScriptToEvaluateOnNewDocument", { identifier: session.themeScriptId })
                .catch(() => {});
              session.themeScriptId = undefined;
            }
            await session.conn.send("Runtime.evaluate", { expression: buildResetScript() });
          } catch {
            session.conn.close();
            held.delete(id);
          }
        }
        const config = currentConfig();
        saveConfig({ ...config, source: undefined, sourceKind: undefined, projectId: undefined });
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === "GET" && url.pathname === "/api/status") {
        return sendJson(res, 200, {
          ...runtimeState,
          service: "zcode-livewall",
          pid: process.pid,
        });
      }

      if (req.method === "GET" && url.pathname === "/api/health") {
        return sendJson(res, 200, { ok: true, service: "zcode-livewall", pid: process.pid });
      }

      return sendJson(res, 404, { error: "not found" });
    } catch (err) {
      return sendJson(res, 400, { error: (err as Error).message });
    }
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(apiPort, "127.0.0.1", resolve);
  });
  server.on("error", (err) => console.error(`serve: http error — ${(err as Error).message}`));

  const shutdown = async () => {
    try {
      fs.rmSync(pidFile(), { force: true });
    } catch {
      /* ignore */
    }
    for (const [, s] of held) s.conn.close();
    await media.close().catch(() => {});
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log(`serve: control API on http://127.0.0.1:${apiPort}`);
  console.log(`serve: media on http://127.0.0.1:${media.port} (token-gated)`);
  console.log(`serve: CDP ${fixedCdpPort ? `pinned to ${fixedCdpPort}` : "auto-discovering"}`);

  await poll();
  // A small-preview scene wallpaper keeps a background Steam-cover download
  // ticking even when the user touches nothing: the cooldown may have expired
  // or the flaky network may have entered a good window, and nothing else
  // re-triggers the fetch until the next user action otherwise.
  let steamRetryAt = 0;
  for (;;) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    await poll();
    const now = Date.now();
    if (now - steamRetryAt > 60_000) {
      steamRetryAt = now;
      const cfg = currentConfig();
      const source = resolveSource(cfg);
      if (
        cfg.projectId &&
        source &&
        (source.kind === "image" || source.kind === "web") &&
        !cachedSteamPreview(cfg.projectId)
      ) {
        const poster = source.posterPath;
        const dim = poster ? imageSize(poster) : undefined;
        if (!dim || dim.width < MIN_USEFUL_PREVIEW_WIDTH) {
          refreshSteamPreview(cfg.projectId, (downloaded) => {
            const latest = currentConfig();
            if (latest.projectId === cfg.projectId && downloaded) {
              publishedFor = undefined;
              void pushConfig(latest).catch(() => 0);
            }
          });
        }
      }
    }
  }
}

/** True when another serve of this plugin already owns the API port. */
export async function existingServePid(apiPort: number): Promise<number | undefined> {
  try {
    const res = await fetch(`http://127.0.0.1:${apiPort}/api/health`, {
      signal: AbortSignal.timeout(1000),
    });
    const body = (await res.json()) as { service?: string; pid?: number };
    return body?.service === "zcode-livewall" ? body.pid : undefined;
  } catch {
    return undefined;
  }
}
