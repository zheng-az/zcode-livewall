#!/usr/bin/env node
/**
 * zcode-livewall CLI
 *
 *   launch   Start ZCode with the CDP debug port enabled (required once).
 *   list     List playable Wallpaper Engine projects.
 *   apply    Apply a project (or a file) as the animated background.
 *   serve    Resident service: injection + media + settings panel.
 *   stop     Stop a detached serve process.
 *   status   Report CDP reachability and the stored config.
 *   reset    Remove the animated background.
 */

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  currentConfig,
  dataDir,
  DEFAULT_CONFIG,
  loadConfig,
  pidFile,
  saveConfig,
  type LiveWallConfig,
} from "./core/config.js";
import { discoverCdpPort, listTargets, pickRendererTargets } from "./core/cdp.js";
import { findProject, listPlayable } from "./core/we-library.js";
import { startServe, existingServePid } from "./core/serve.js";
import { launchZcode } from "./core/launch.js";

const USAGE = `zcode-livewall <command> [options]

Commands:
  launch [--port N]              Start ZCode with --remote-debugging-port=N
  list                           List playable Wallpaper Engine projects
  apply <project|file> [options] Set the animated wallpaper
    --blur <px>                  Blur radius (default from config)
    --dim <0-100>                Darken the wallpaper
    --fit <cover|contain>        Framing mode
    --no-monet                   Keep ZCode's original colors
  serve [--api-port M] [--media-port P] [--detach]
                                 Resident service + settings panel (default API 9334)
  stop                           Stop the detached service
  status                         Show CDP reachability and stored config
  reset                          Remove the animated background
`;

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const i = rest.indexOf(name);
    return i >= 0 && i + 1 < rest.length ? rest[i + 1] : undefined;
  };
  const has = (name: string): boolean => rest.includes(name);

  try {
    switch (cmd) {
      case "launch": {
        const port = Number(flag("--port") ?? 9222);
        const r = await launchZcode(port);
        if (r.started) console.log(`ZCode started with CDP on port ${port}.`);
        else if (r.reason === "running-without-cdp") {
          console.error(
            "A ZCode instance is already running without the debug port. Quit ZCode completely " +
              "(including the tray icon) and run this command again."
          );
          process.exitCode = 1;
        } else console.log(`ZCode already reachable on port ${port}.`);
        break;
      }
      case "list": {
        const projects = listPlayable();
        if (projects.length === 0) {
          console.log("No playable Wallpaper Engine projects found.");
          break;
        }
        for (const p of projects) {
          const kind = p.type.padEnd(8);
          console.log(`${kind} ${p.id.padEnd(12)} ${p.title}${p.source === "workshop" ? "  [workshop]" : ""}`);
        }
        break;
      }
      case "apply": {
        const target = rest.find((a) => !a.startsWith("--"));
        if (!target) {
          console.error(USAGE);
          process.exitCode = 1;
          break;
        }
        const asFile = fs.existsSync(target) ? path.resolve(target) : undefined;
        const project = asFile ? undefined : findProject(target);
        if (!asFile && !project?.mediaPath) {
          console.error(`No Wallpaper Engine project or file matching "${target}".`);
          process.exitCode = 1;
          break;
        }
        const config: LiveWallConfig = {
          ...currentConfig(),
          source: asFile ?? project!.mediaPath!,
          sourceKind: asFile
            ? /\.html?$/i.test(asFile)
              ? "web"
              : /\.(mp4|webm|mov|m4v|mkv)$/i.test(asFile)
                ? "video"
                : "image"
            : project!.type === "web"
              ? "web"
              : /\.(mp4|webm|mov|m4v)$/i.test(project!.mediaPath!)
                ? "video"
                : "image",
          projectId: project?.id,
        };
        if (flag("--blur")) config.blur = Number(flag("--blur"));
        if (flag("--dim")) config.dim = Number(flag("--dim"));
        if (flag("--fit") === "cover" || flag("--fit") === "contain") config.fit = flag("--fit") as any;
        if (has("--no-monet")) config.monet = false;
        saveConfig(config);
        console.log(`Stored "${project?.title ?? path.basename(config.source!)}" as the animated wallpaper.`);
        console.log("Run `zcode-livewall serve` (or use the plugin panel) to inject it.");
        break;
      }
      case "serve": {
        const apiPort = Number(flag("--api-port") ?? DEFAULT_CONFIG.apiPort);
        const mediaPort = Number(flag("--media-port") ?? DEFAULT_CONFIG.mediaPort);
        if (has("--detach")) {
          await startDetached(apiPort, mediaPort, flag("--port") ? Number(flag("--port")) : undefined);
          break;
        }
        await startServe({
          apiPort,
          mediaPort,
          cdpPort: flag("--port") ? Number(flag("--port")) : undefined,
        });
        break;
      }
      case "stop": {
        let pid: number | undefined;
        try {
          pid = Number(fs.readFileSync(pidFile(), "utf8").trim());
        } catch {
          /* not running */
        }
        if (!pid) {
          console.log("No serve pid file; nothing to stop.");
          break;
        }
        try {
          process.kill(pid);
          fs.rmSync(pidFile(), { force: true });
          console.log(`Stopped serve (pid ${pid}).`);
        } catch (err) {
          console.error(`Could not stop pid ${pid}: ${(err as Error).message}`);
        }
        break;
      }
      case "status": {
        const stored = loadConfig();
        const port = await discoverCdpPort(stored.cdpPort && stored.cdpPort > 0 ? stored.cdpPort : undefined);
        console.log(JSON.stringify({ config: { ...DEFAULT_CONFIG, ...stored }, cdpPort: port ?? null }, null, 2));
        if (!port) {
          console.log(
            "CDP not reachable. If ZCode is running, it was started without --remote-debugging-port.\n" +
              "Quit ZCode completely, then start it from a shortcut that carries the flag (see zcode-beautify repair-launchers)."
          );
        } else {
          const targets = pickRendererTargets(await listTargets(port));
          console.log(`${targets.length} renderer target(s) on port ${port}.`);
        }
        break;
      }
      case "reset": {
        const config = currentConfig();
        saveConfig({ ...config, source: undefined, sourceKind: undefined, projectId: undefined });
        console.log("Stored source cleared. The running service removes the layer on its next poll.");
        break;
      }
      case "help":
      case "--help":
      case "-h":
        console.log(USAGE);
        break;
      default:
        console.log(USAGE);
        if (cmd !== undefined) process.exitCode = 1;
    }
  } catch (err) {
    console.error(`error: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

async function startDetached(
  apiPort: number,
  mediaPort: number,
  cdpPort?: number
): Promise<void> {
  const already = await existingServePid(apiPort);
  if (already !== undefined) {
    throw new Error(`a livewall service is already running on port ${apiPort} (pid ${already})`);
  }
  fs.mkdirSync(dataDir(), { recursive: true });
  const logFile = path.join(dataDir(), "serve.log");
  const out = fs.openSync(logFile, "a");
  const args = [process.argv[1], "serve", "--api-port", String(apiPort), "--media-port", String(mediaPort)];
  if (cdpPort) args.push("--port", String(cdpPort));
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: ["ignore", out, out],
    windowsHide: true,
  });
  child.unref();
  fs.closeSync(out);

  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const res = await fetch(`http://127.0.0.1:${apiPort}/api/health`, {
        signal: AbortSignal.timeout(1000),
      });
      const body = (await res.json()) as { service?: string; pid?: number };
      if (body?.service === "zcode-livewall") {
        console.log(`LiveWall service running on http://127.0.0.1:${apiPort} (pid ${body.pid}).`);
        console.log(`Log: ${logFile}`);
        return;
      }
    } catch {
      /* not up yet */
    }
  }
  console.error(`serve did not come up within 10s — see ${logFile}`);
  process.exitCode = 1;
}

main();
