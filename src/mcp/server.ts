/**
 * MCP server exposing zcode-livewall to the ZCode agent.
 *
 * Tools talk to the resident `serve` process over its token-gated API so that
 * the agent and the injected panel always drive the same state.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { currentConfig, loadConfig, readServeToken, saveConfig, DEFAULT_CONFIG } from "../core/config.js";
import { discoverCdpPort, listTargets, pickRendererTargets } from "../core/cdp.js";
import { findProject, listPlayable } from "../core/we-library.js";
import { findFfmpeg } from "../core/video-theme.js";

declare const __PLUGIN_VERSION__: string;

const server = new McpServer({ name: "zcode-livewall", version: __PLUGIN_VERSION__ });

function apiBase(): string {
  return `http://127.0.0.1:${currentConfig().apiPort}`;
}

async function call(path: string, body?: unknown): Promise<any> {
  const token = readServeToken();
  if (!token) {
    throw new Error(
      "The livewall service is not running. Start it with `node dist/cli.js serve --detach` from the plugin directory."
    );
  }
  const res = await fetch(apiBase() + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "x-zlw-token": token,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json();
  if (!res.ok || data?.error) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data;
}

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}
function fail(err: unknown) {
  return { content: [{ type: "text" as const, text: `Failed: ${(err as Error).message}` }], isError: true };
}

server.registerTool(
  "list_wallpapers",
  {
    title: "List animated wallpapers",
    description:
      "List the Wallpaper Engine projects installed on this machine that can be used as an animated ZCode background (video, web/scene and animated image projects).",
    inputSchema: {
      limit: z.number().min(1).max(200).optional().describe("Maximum entries to return (default 60)"),
    },
  },
  async ({ limit }) => {
    const projects = listPlayable();
    const shown = projects.slice(0, limit ?? 60);
    if (shown.length === 0) {
      return ok("No playable Wallpaper Engine projects found. Check that Wallpaper Engine is installed and has local or Workshop projects.");
    }
    const lines = shown.map(
      (p) => `- ${p.id} | ${p.title} | ${p.type}${p.source === "workshop" ? " (workshop)" : ""}`
    );
    return ok(`${projects.length} playable project(s):\n${lines.join("\n")}`);
  }
);

server.registerTool(
  "set_live_wallpaper",
  {
    title: "Set animated ZCode wallpaper",
    description:
      "Use a Wallpaper Engine project (by id or title) or a local video/image file as the animated background of the ZCode desktop client. " +
      "Requires the livewall service; returns how many windows received it.",
    inputSchema: {
      project: z.string().optional().describe("Wallpaper Engine project id or title"),
      file: z.string().optional().describe("Absolute path to a video/image file, used instead of project"),
      blur: z.number().min(0).max(100).optional().describe("Blur radius in px"),
      dim: z.number().min(0).max(100).optional().describe("Darkening 0-100"),
      fit: z.enum(["cover", "contain"]).optional().describe("cover fills and crops, contain shows the whole media letterboxed with a blurred backdrop"),
      monet: z.boolean().optional().describe("Recolor the UI from a sampled video frame"),
    },
  },
  async ({ project, file, blur, dim, fit, monet }) => {
    try {
      let data: any;
      if (file) {
        data = await call("/api/source/path", { path: file });
      } else if (project) {
        const found = findProject(project);
        if (!found?.mediaPath) throw new Error(`no playable project matching "${project}"`);
        data = await call("/api/source", { project: found.id });
      } else {
        throw new Error("provide either project or file");
      }

      const patch: Record<string, unknown> = {};
      if (blur !== undefined) patch.blur = blur;
      if (dim !== undefined) patch.dim = dim;
      if (fit !== undefined) patch.fit = fit;
      if (monet !== undefined) patch.monet = monet;
      if (Object.keys(patch).length > 0) data = await call("/api/config", patch);

      const name = project ?? file;
      return ok(`Applied "${name}" to ${data.windows ?? 0} window(s).`);
    } catch (err) {
      return fail(err);
    }
  }
);

server.registerTool(
  "tune_live_wallpaper",
  {
    title: "Tune animated wallpaper",
    description:
      "Adjust the running animated wallpaper without changing the source: blur, dim, playback speed, pause state, pause-on-blur, Monet colors, visibility and framing.",
    inputSchema: {
      blur: z.number().min(0).max(100).optional(),
      dim: z.number().min(0).max(100).optional(),
      speed: z.number().min(0.25).max(3).optional().describe("Playback rate multiplier"),
      paused: z.boolean().optional().describe("Pause or resume playback"),
      pause_on_blur: z.boolean().optional().describe("Pause when the window is hidden or unfocused"),
      monet: z.boolean().optional().describe("Recolor the UI from the wallpaper"),
      wallpaper_visible: z.boolean().optional().describe("Show the wallpaper (translucent) or hide it (opaque)"),
      fit: z.enum(["cover", "contain"]).optional(),
    },
  },
  async ({ blur, dim, speed, paused, pause_on_blur, monet, wallpaper_visible, fit }) => {
    try {
      const patch: Record<string, unknown> = {};
      if (blur !== undefined) patch.blur = blur;
      if (dim !== undefined) patch.dim = dim;
      if (speed !== undefined) patch.speed = speed;
      if (paused !== undefined) patch.paused = paused;
      if (pause_on_blur !== undefined) patch.pauseOnBlur = pause_on_blur;
      if (monet !== undefined) patch.monet = monet;
      if (wallpaper_visible !== undefined) patch.wallpaperVisible = wallpaper_visible;
      if (fit !== undefined) patch.fit = fit;
      if (Object.keys(patch).length === 0) return ok("Nothing to change.");

      const data = await call("/api/config", patch);
      return ok(`Updated in ${data.windows ?? 0} window(s).`);
    } catch (err) {
      return fail(err);
    }
  }
);

server.registerTool(
  "livewall_status",
  {
    title: "Animated wallpaper status",
    description:
      "Report the stored animated-wallpaper configuration, whether the resident service is running, and whether the ZCode CDP endpoint is reachable.",
    inputSchema: {},
  },
  async () => {
    const stored = currentConfig();
    let service: any;
    let liveConfig: any;
    try {
      service = await call("/api/status");
      // The resident service holds the authoritative state; the on-disk file
      // can lag behind a request that is still being applied.
      liveConfig = await call("/api/config");
    } catch (err) {
      service = { running: false, error: (err as Error).message };
    }
    let cdp: any;
    try {
      const port = await discoverCdpPort(stored.cdpPort > 0 ? stored.cdpPort : undefined);
      if (!port) throw new Error("no ZCode renderer with an open CDP port");
      cdp = { reachable: true, port, renderers: pickRendererTargets(await listTargets(port)).length };
    } catch (err) {
      cdp = { reachable: false, error: (err as Error).message };
    }
    const ff = await findFfmpeg();
    return ok(
      JSON.stringify(
        {
          config: liveConfig ?? { ...DEFAULT_CONFIG, ...loadConfig() },
          service,
          cdp,
          ffmpeg: ff ? ff.path : "not found (video color sampling unavailable)",
        },
        null,
        2
      )
    );
  }
);

server.registerTool(
  "stop_live_wallpaper",
  {
    title: "Remove animated wallpaper",
    description: "Clear the stored animated wallpaper and remove the injected layer from the running ZCode client.",
    inputSchema: {},
  },
  async () => {
    try {
      await call("/api/reset", {});
      return ok("Animated wallpaper removed.");
    } catch (err) {
      return fail(err);
    }
  }
);

await server.connect(new StdioServerTransport());
