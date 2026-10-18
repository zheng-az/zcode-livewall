/**
 * Launch ZCode with the CDP debug port enabled.
 *
 * ZCode reads --remote-debugging-port once at startup and enforces a single
 * instance, so a running instance without the flag can never grow one.
 */

import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { discoverCdpPort } from "./cdp.js";
import { isZcodeProcessRunning } from "./zcode-process.js";

const execFileAsync = promisify(execFile);

const ZCODE_EXE_CANDIDATES =
  process.platform === "win32"
    ? [
        process.env.ZCODE_WINDOWS_APP_INSTALL_DIR
          ? path.join(process.env.ZCODE_WINDOWS_APP_INSTALL_DIR, "ZCode.exe")
          : undefined,
        "C:\\Program Files\\ZCode\\ZCode.exe",
        "D:\\ZCode\\ZCode.exe",
        path.join(os.homedir(), "AppData", "Local", "Programs", "ZCode", "ZCode.exe"),
      ].filter(Boolean) as string[]
    : process.platform === "darwin"
      ? ["/Applications/ZCode.app/Contents/MacOS/ZCode"]
      : ["/usr/bin/zcode", "/opt/ZCode/zcode"];

export function findZcodeExecutable(): string | undefined {
  return ZCODE_EXE_CANDIDATES.find((p) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  });
}

export interface LaunchResult {
  started: boolean;
  reason?: string;
}

export async function launchZcode(port: number): Promise<LaunchResult> {
  if (await discoverCdpPort(port)) {
    return { started: false, reason: "already-running-with-cdp" };
  }
  const exe = findZcodeExecutable();
  if (!exe) {
    throw new Error(
      "ZCode executable not found; set ZCODE_WINDOWS_APP_INSTALL_DIR or install ZCode to a known path."
    );
  }
  if (await isZcodeProcessRunning()) {
    return { started: false, reason: "running-without-cdp" };
  }

  const child = spawn(exe, [`--remote-debugging-port=${port}`], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();

  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await discoverCdpPort(port)) return { started: true };
  }
  throw new Error(
    "ZCode started but no CDP endpoint appeared. Quit ZCode completely and try again."
  );
}

/** Kills every ZCode process; callers must confirm with the user first. */
export async function killZcode(): Promise<boolean> {
  try {
    if (process.platform === "win32") {
      await execFileAsync("taskkill", ["/F", "/IM", "ZCode.exe"], { windowsHide: true });
    } else {
      await execFileAsync("pkill", ["-x", process.platform === "darwin" ? "ZCode" : "zcode"]);
    }
    return true;
  } catch {
    return false;
  }
}
