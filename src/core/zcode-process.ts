/**
 * ZCode process detection (the resident service runs without a console, so
 * every probe must be windowless).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function isZcodeProcessRunning(): Promise<boolean> {
  try {
    if (process.platform === "win32") {
      const { stdout } = await execFileAsync("tasklist", ["/NH", "/FI", "IMAGENAME eq ZCode.exe"], {
        windowsHide: true,
      });
      return stdout.toLowerCase().includes("zcode.exe");
    }
    const name = process.platform === "darwin" ? "ZCode" : "zcode";
    const { stdout } = await execFileAsync("pgrep", ["-x", name]);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}
