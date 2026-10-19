#!/usr/bin/env node
import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);

// dist/cli.js
import fs9 from "node:fs";
import path9 from "node:path";
import { spawn as spawn2 } from "node:child_process";

// dist/core/config.js
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
var DEFAULT_CONFIG = {
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
  autoRestart: true
};
function dataDir() {
  const override = process.env.ZCODE_LIVEWALL_DATA_DIR;
  if (override) {
    return path.isAbsolute(override) ? override : path.join(os.homedir(), ".zcode", "cli", "plugins", "data", override);
  }
  const root = path.join(os.homedir(), ".zcode", "cli", "plugins", "data");
  const pluginScoped = path.join(root, "zcode-livewall@zcode-livewall");
  if (fs.existsSync(pluginScoped))
    return pluginScoped;
  return path.join(root, "zcode-livewall");
}
function configFile() {
  return path.join(dataDir(), "config.json");
}
function tokenFile() {
  return path.join(dataDir(), "serve-token");
}
function pidFile() {
  return path.join(dataDir(), "serve.pid");
}
function cacheDir() {
  return path.join(dataDir(), "cache");
}
var cachedConfig;
function loadConfig() {
  try {
    const mtimeMs = fs.statSync(configFile()).mtimeMs;
    if (cachedConfig && cachedConfig.mtimeMs === mtimeMs)
      return cachedConfig.value;
    const value = JSON.parse(fs.readFileSync(configFile(), "utf8"));
    cachedConfig = { mtimeMs, value };
    return value;
  } catch {
    return {};
  }
}
function saveConfig(config) {
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(config, null, 2));
  cachedConfig = void 0;
}
function currentConfig() {
  return { ...DEFAULT_CONFIG, ...loadConfig() };
}

// dist/core/cdp.js
var CdpError = class extends Error {
};
async function listTargets(port, host = "127.0.0.1") {
  let res;
  try {
    res = await fetch(`http://${host}:${port}/json/list`, { signal: AbortSignal.timeout(2500) });
  } catch {
    throw new CdpError(`Cannot reach CDP at ${host}:${port} \u2014 is ZCode running with --remote-debugging-port=${port}?`);
  }
  if (!res.ok)
    throw new CdpError(`CDP /json/list returned HTTP ${res.status}`);
  return await res.json();
}
function pickRendererTargets(targets) {
  const pages = targets.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
  const main2 = pages.filter((t) => t.url.includes("out/renderer/index.html") || t.title === "ZCode");
  return main2.length > 0 ? main2 : pages.filter((t) => !t.url.includes("devtools://"));
}
var cachedPort;
async function discoverCdpPort(preferred) {
  if (cachedPort !== void 0) {
    try {
      const targets = await listTargets(cachedPort);
      if (pickRendererTargets(targets).length > 0)
        return cachedPort;
    } catch {
      cachedPort = void 0;
    }
  }
  const candidates = [];
  if (preferred && preferred > 0)
    candidates.push(preferred);
  for (let p = 9222; p <= 9240; p++)
    if (!candidates.includes(p))
      candidates.push(p);
  const probe = async (port) => {
    try {
      const targets = await listTargets(port);
      return pickRendererTargets(targets).length > 0 ? port : void 0;
    } catch {
      return void 0;
    }
  };
  const results = await Promise.all(candidates.map(probe));
  const found = results.find((p) => p !== void 0);
  if (found)
    cachedPort = found;
  return found;
}
var CdpConnection = class _CdpConnection {
  ws;
  nextId = 1;
  pending = /* @__PURE__ */ new Map();
  eventHandlers = /* @__PURE__ */ new Map();
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id !== void 0) {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          if (msg.error)
            p.reject(new CdpError(`${msg.error.message} (code ${msg.error.code})`));
          else
            p.resolve(msg.result);
        }
      } else if (msg.method) {
        this.eventHandlers.get(msg.method)?.forEach((h) => h(msg.params));
      }
    });
    this.ws.addEventListener("close", () => {
      for (const p of this.pending.values())
        p.reject(new CdpError("CDP connection closed"));
      this.pending.clear();
    });
  }
  static connect(wsUrl) {
    return new Promise((resolve, reject) => {
      const conn = new _CdpConnection(wsUrl);
      const timer = setTimeout(() => reject(new CdpError("CDP websocket connect timeout")), 5e3);
      conn.ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve(conn);
      });
      conn.ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new CdpError(`CDP websocket error for ${wsUrl}`));
      });
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() {
    try {
      this.ws.close();
    } catch {
    }
  }
};

// dist/core/we-library.js
import fs2 from "node:fs";
import path2 from "node:path";
var STEAM_LIBRARY_ROOTS = [
  "C:/Program Files (x86)/Steam",
  "C:/Program Files/Steam",
  "D:/Steam",
  "E:/Steam",
  "F:/Steam",
  "G:/Steam",
  path2.join(process.env.LOCALAPPDATA ?? "", "Steam")
];
function findWallpaperEngineDirs() {
  const found = /* @__PURE__ */ new Set();
  const candidates = [
    ...STEAM_LIBRARY_ROOTS.map((r) => path2.join(r, "steamapps", "common", "wallpaper_engine")),
    "C:/Program Files (x86)/Steam/steamapps/common/wallpaper_engine"
  ];
  for (const c of candidates) {
    try {
      if (fs2.statSync(path2.join(c, "wallpaper64.exe")).isFile())
        found.add(path2.resolve(c));
      else if (fs2.statSync(path2.join(c, "wallpaper32.exe")).isFile())
        found.add(path2.resolve(c));
    } catch {
    }
  }
  return [...found];
}
function findSteamLibraries() {
  const libs = /* @__PURE__ */ new Set();
  for (const steamRoot of STEAM_LIBRARY_ROOTS) {
    const vdf = path2.join(steamRoot, "steamapps", "libraryfolders.vdf");
    let text;
    try {
      text = fs2.readFileSync(vdf, "utf8");
    } catch {
      continue;
    }
    for (const m of text.matchAll(/"path"\s+"([^"]+)"/g)) {
      const p = m[1].replace(/\\\\/g, "/").replace(/\\/g, "/");
      try {
        if (fs2.statSync(p).isDirectory())
          libs.add(path2.resolve(p));
      } catch {
      }
    }
  }
  return [...libs];
}
function readProjectJson(dir) {
  try {
    return JSON.parse(fs2.readFileSync(path2.join(dir, "project.json"), "utf8"));
  } catch {
    return void 0;
  }
}
function isMediaFile(p) {
  return /\.(mp4|webm|mov|mkv|m4v|avi|gif|jpg|jpeg|png|webp|html?)$/i.test(p);
}
function resolveMedia(projectDir, file, type) {
  if (!file)
    return void 0;
  const direct = path2.resolve(projectDir, file);
  try {
    if (fs2.statSync(direct).isFile())
      return direct;
  } catch {
  }
  try {
    const entries = fs2.readdirSync(projectDir).filter(isMediaFile);
    const preferred = entries.find((e) => /\.(mp4|webm|mov|m4v)$/i.test(e)) ?? entries.find((e) => /\.gif$/i.test(e)) ?? (type === "web" ? entries.find((e) => /\.html?$/i.test(e)) : void 0);
    if (preferred)
      return path2.join(projectDir, preferred);
  } catch {
  }
  return void 0;
}
function toProject(dir, source, id) {
  const json = readProjectJson(dir);
  if (!json)
    return void 0;
  const rawType = String(json.type ?? "").toLowerCase();
  const type = rawType === "video" || rawType === "web" || rawType === "scene" || rawType === "application" ? rawType : "unknown";
  const mediaPath = resolveMedia(dir, typeof json.file === "string" ? json.file : void 0, type);
  const previewName = typeof json.preview === "string" ? json.preview : void 0;
  const previewPath = previewName ? path2.resolve(dir, previewName) : void 0;
  return {
    id,
    title: typeof json.title === "string" && json.title.trim() ? json.title.trim() : id,
    type,
    mediaPath,
    previewPath: previewPath && fs2.existsSync(previewPath) ? previewPath : void 0,
    projectDir: dir,
    source,
    file: typeof json.file === "string" ? json.file : void 0
  };
}
function scanProjects() {
  const projects = [];
  const seen = /* @__PURE__ */ new Set();
  const push = (p) => {
    if (!p || seen.has(p.projectDir))
      return;
    seen.add(p.projectDir);
    projects.push(p);
  };
  for (const weDir of findWallpaperEngineDirs()) {
    for (const sub of ["myprojects", "defaultprojects"]) {
      const root = path2.join(weDir, "projects", sub);
      let entries;
      try {
        entries = fs2.readdirSync(root, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        if (!e.isDirectory())
          continue;
        push(toProject(path2.join(root, e.name), "local", e.name));
      }
    }
  }
  for (const lib of findSteamLibraries()) {
    const root = path2.join(lib, "steamapps", "workshop", "content", "431960");
    let entries;
    try {
      entries = fs2.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory())
        continue;
      push(toProject(path2.join(root, e.name), "workshop", e.name));
    }
  }
  return projects.sort((a, b) => a.title.localeCompare(b.title));
}
function listPlayable() {
  return scanProjects().filter((p) => {
    if (!p.mediaPath)
      return false;
    if (p.type === "video")
      return /\.(mp4|webm|mov|m4v)$/i.test(p.mediaPath);
    if (p.type === "web")
      return /\.html?$/i.test(p.mediaPath);
    return /\.(mp4|webm|mov|m4v|gif)$/i.test(p.mediaPath);
  });
}
function findProject(idOrTitle) {
  const needle = idOrTitle.trim().toLowerCase();
  const all = scanProjects();
  return all.find((p) => p.id.toLowerCase() === needle) ?? all.find((p) => p.title.toLowerCase() === needle) ?? all.find((p) => p.title.toLowerCase().includes(needle) || p.id.includes(needle));
}

// dist/core/serve.js
import http2 from "node:http";
import fs8 from "node:fs";
import path8 from "node:path";
import { randomBytes as randomBytes2, createHash as createHash2 } from "node:crypto";

// dist/core/video-theme.js
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs3 from "node:fs";
import os2 from "node:os";
import path3 from "node:path";

// node_modules/@material/material-color-utilities/utils/math_utils.js
/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
function signum(num) {
  if (num < 0) {
    return -1;
  } else if (num === 0) {
    return 0;
  } else {
    return 1;
  }
}
function lerp(start, stop, amount) {
  return (1 - amount) * start + amount * stop;
}
function clampInt(min, max, input) {
  if (input < min) {
    return min;
  } else if (input > max) {
    return max;
  }
  return input;
}
function clampDouble(min, max, input) {
  if (input < min) {
    return min;
  } else if (input > max) {
    return max;
  }
  return input;
}
function sanitizeDegreesInt(degrees) {
  degrees = degrees % 360;
  if (degrees < 0) {
    degrees = degrees + 360;
  }
  return degrees;
}
function sanitizeDegreesDouble(degrees) {
  degrees = degrees % 360;
  if (degrees < 0) {
    degrees = degrees + 360;
  }
  return degrees;
}
function rotationDirection(from, to) {
  const increasingDifference = sanitizeDegreesDouble(to - from);
  return increasingDifference <= 180 ? 1 : -1;
}
function differenceDegrees(a, b) {
  return 180 - Math.abs(Math.abs(a - b) - 180);
}
function matrixMultiply(row, matrix) {
  const a = row[0] * matrix[0][0] + row[1] * matrix[0][1] + row[2] * matrix[0][2];
  const b = row[0] * matrix[1][0] + row[1] * matrix[1][1] + row[2] * matrix[1][2];
  const c = row[0] * matrix[2][0] + row[1] * matrix[2][1] + row[2] * matrix[2][2];
  return [a, b, c];
}

// node_modules/@material/material-color-utilities/utils/color_utils.js
/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
var SRGB_TO_XYZ = [
  [0.41233895, 0.35762064, 0.18051042],
  [0.2126, 0.7152, 0.0722],
  [0.01932141, 0.11916382, 0.95034478]
];
var XYZ_TO_SRGB = [
  [
    3.2413774792388685,
    -1.5376652402851851,
    -0.49885366846268053
  ],
  [
    -0.9691452513005321,
    1.8758853451067872,
    0.04156585616912061
  ],
  [
    0.05562093689691305,
    -0.20395524564742123,
    1.0571799111220335
  ]
];
var WHITE_POINT_D65 = [95.047, 100, 108.883];
function argbFromRgb(red, green, blue) {
  return (255 << 24 | (red & 255) << 16 | (green & 255) << 8 | blue & 255) >>> 0;
}
function argbFromLinrgb(linrgb) {
  const r = delinearized(linrgb[0]);
  const g = delinearized(linrgb[1]);
  const b = delinearized(linrgb[2]);
  return argbFromRgb(r, g, b);
}
function alphaFromArgb(argb) {
  return argb >> 24 & 255;
}
function redFromArgb(argb) {
  return argb >> 16 & 255;
}
function greenFromArgb(argb) {
  return argb >> 8 & 255;
}
function blueFromArgb(argb) {
  return argb & 255;
}
function argbFromXyz(x, y, z) {
  const matrix = XYZ_TO_SRGB;
  const linearR = matrix[0][0] * x + matrix[0][1] * y + matrix[0][2] * z;
  const linearG = matrix[1][0] * x + matrix[1][1] * y + matrix[1][2] * z;
  const linearB = matrix[2][0] * x + matrix[2][1] * y + matrix[2][2] * z;
  const r = delinearized(linearR);
  const g = delinearized(linearG);
  const b = delinearized(linearB);
  return argbFromRgb(r, g, b);
}
function xyzFromArgb(argb) {
  const r = linearized(redFromArgb(argb));
  const g = linearized(greenFromArgb(argb));
  const b = linearized(blueFromArgb(argb));
  return matrixMultiply([r, g, b], SRGB_TO_XYZ);
}
function argbFromLab(l, a, b) {
  const whitePoint = WHITE_POINT_D65;
  const fy = (l + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;
  const xNormalized = labInvf(fx);
  const yNormalized = labInvf(fy);
  const zNormalized = labInvf(fz);
  const x = xNormalized * whitePoint[0];
  const y = yNormalized * whitePoint[1];
  const z = zNormalized * whitePoint[2];
  return argbFromXyz(x, y, z);
}
function labFromArgb(argb) {
  const linearR = linearized(redFromArgb(argb));
  const linearG = linearized(greenFromArgb(argb));
  const linearB = linearized(blueFromArgb(argb));
  const matrix = SRGB_TO_XYZ;
  const x = matrix[0][0] * linearR + matrix[0][1] * linearG + matrix[0][2] * linearB;
  const y = matrix[1][0] * linearR + matrix[1][1] * linearG + matrix[1][2] * linearB;
  const z = matrix[2][0] * linearR + matrix[2][1] * linearG + matrix[2][2] * linearB;
  const whitePoint = WHITE_POINT_D65;
  const xNormalized = x / whitePoint[0];
  const yNormalized = y / whitePoint[1];
  const zNormalized = z / whitePoint[2];
  const fx = labF(xNormalized);
  const fy = labF(yNormalized);
  const fz = labF(zNormalized);
  const l = 116 * fy - 16;
  const a = 500 * (fx - fy);
  const b = 200 * (fy - fz);
  return [l, a, b];
}
function argbFromLstar(lstar) {
  const y = yFromLstar(lstar);
  const component = delinearized(y);
  return argbFromRgb(component, component, component);
}
function lstarFromArgb(argb) {
  const y = xyzFromArgb(argb)[1];
  return 116 * labF(y / 100) - 16;
}
function yFromLstar(lstar) {
  return 100 * labInvf((lstar + 16) / 116);
}
function lstarFromY(y) {
  return labF(y / 100) * 116 - 16;
}
function linearized(rgbComponent) {
  const normalized = rgbComponent / 255;
  if (normalized <= 0.040449936) {
    return normalized / 12.92 * 100;
  } else {
    return Math.pow((normalized + 0.055) / 1.055, 2.4) * 100;
  }
}
function delinearized(rgbComponent) {
  const normalized = rgbComponent / 100;
  let delinearized2 = 0;
  if (normalized <= 31308e-7) {
    delinearized2 = normalized * 12.92;
  } else {
    delinearized2 = 1.055 * Math.pow(normalized, 1 / 2.4) - 0.055;
  }
  return clampInt(0, 255, Math.round(delinearized2 * 255));
}
function whitePointD65() {
  return WHITE_POINT_D65;
}
function labF(t) {
  const e = 216 / 24389;
  const kappa = 24389 / 27;
  if (t > e) {
    return Math.pow(t, 1 / 3);
  } else {
    return (kappa * t + 16) / 116;
  }
}
function labInvf(ft) {
  const e = 216 / 24389;
  const kappa = 24389 / 27;
  const ft3 = ft * ft * ft;
  if (ft3 > e) {
    return ft3;
  } else {
    return (116 * ft - 16) / kappa;
  }
}

// node_modules/@material/material-color-utilities/hct/viewing_conditions.js
/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
var ViewingConditions = class _ViewingConditions {
  /**
   * Create ViewingConditions from a simple, physically relevant, set of
   * parameters.
   *
   * @param whitePoint White point, measured in the XYZ color space.
   *     default = D65, or sunny day afternoon
   * @param adaptingLuminance The luminance of the adapting field. Informally,
   *     how bright it is in the room where the color is viewed. Can be
   *     calculated from lux by multiplying lux by 0.0586. default = 11.72,
   *     or 200 lux.
   * @param backgroundLstar The lightness of the area surrounding the color.
   *     measured by L* in L*a*b*. default = 50.0
   * @param surround A general description of the lighting surrounding the
   *     color. 0 is pitch dark, like watching a movie in a theater. 1.0 is a
   *     dimly light room, like watching TV at home at night. 2.0 means there
   *     is no difference between the lighting on the color and around it.
   *     default = 2.0
   * @param discountingIlluminant Whether the eye accounts for the tint of the
   *     ambient lighting, such as knowing an apple is still red in green light.
   *     default = false, the eye does not perform this process on
   *       self-luminous objects like displays.
   */
  static make(whitePoint = whitePointD65(), adaptingLuminance = 200 / Math.PI * yFromLstar(50) / 100, backgroundLstar = 50, surround = 2, discountingIlluminant = false) {
    const xyz = whitePoint;
    const rW = xyz[0] * 0.401288 + xyz[1] * 0.650173 + xyz[2] * -0.051461;
    const gW = xyz[0] * -0.250268 + xyz[1] * 1.204414 + xyz[2] * 0.045854;
    const bW = xyz[0] * -2079e-6 + xyz[1] * 0.048952 + xyz[2] * 0.953127;
    const f = 0.8 + surround / 10;
    const c = f >= 0.9 ? lerp(0.59, 0.69, (f - 0.9) * 10) : lerp(0.525, 0.59, (f - 0.8) * 10);
    let d = discountingIlluminant ? 1 : f * (1 - 1 / 3.6 * Math.exp((-adaptingLuminance - 42) / 92));
    d = d > 1 ? 1 : d < 0 ? 0 : d;
    const nc = f;
    const rgbD = [
      d * (100 / rW) + 1 - d,
      d * (100 / gW) + 1 - d,
      d * (100 / bW) + 1 - d
    ];
    const k = 1 / (5 * adaptingLuminance + 1);
    const k4 = k * k * k * k;
    const k4F = 1 - k4;
    const fl = k4 * adaptingLuminance + 0.1 * k4F * k4F * Math.cbrt(5 * adaptingLuminance);
    const n = yFromLstar(backgroundLstar) / whitePoint[1];
    const z = 1.48 + Math.sqrt(n);
    const nbb = 0.725 / Math.pow(n, 0.2);
    const ncb = nbb;
    const rgbAFactors = [
      Math.pow(fl * rgbD[0] * rW / 100, 0.42),
      Math.pow(fl * rgbD[1] * gW / 100, 0.42),
      Math.pow(fl * rgbD[2] * bW / 100, 0.42)
    ];
    const rgbA = [
      400 * rgbAFactors[0] / (rgbAFactors[0] + 27.13),
      400 * rgbAFactors[1] / (rgbAFactors[1] + 27.13),
      400 * rgbAFactors[2] / (rgbAFactors[2] + 27.13)
    ];
    const aw = (2 * rgbA[0] + rgbA[1] + 0.05 * rgbA[2]) * nbb;
    return new _ViewingConditions(n, aw, nbb, ncb, c, nc, rgbD, fl, Math.pow(fl, 0.25), z);
  }
  /**
   * Parameters are intermediate values of the CAM16 conversion process. Their
   * names are shorthand for technical color science terminology, this class
   * would not benefit from documenting them individually. A brief overview
   * is available in the CAM16 specification, and a complete overview requires
   * a color science textbook, such as Fairchild's Color Appearance Models.
   */
  constructor(n, aw, nbb, ncb, c, nc, rgbD, fl, fLRoot, z) {
    this.n = n;
    this.aw = aw;
    this.nbb = nbb;
    this.ncb = ncb;
    this.c = c;
    this.nc = nc;
    this.rgbD = rgbD;
    this.fl = fl;
    this.fLRoot = fLRoot;
    this.z = z;
  }
};
ViewingConditions.DEFAULT = ViewingConditions.make();

// node_modules/@material/material-color-utilities/hct/cam16.js
/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
var Cam16 = class _Cam16 {
  /**
   * All of the CAM16 dimensions can be calculated from 3 of the dimensions, in
   * the following combinations:
   *      -  {j or q} and {c, m, or s} and hue
   *      - jstar, astar, bstar
   * Prefer using a static method that constructs from 3 of those dimensions.
   * This constructor is intended for those methods to use to return all
   * possible dimensions.
   *
   * @param hue
   * @param chroma informally, colorfulness / color intensity. like saturation
   *     in HSL, except perceptually accurate.
   * @param j lightness
   * @param q brightness; ratio of lightness to white point's lightness
   * @param m colorfulness
   * @param s saturation; ratio of chroma to white point's chroma
   * @param jstar CAM16-UCS J coordinate
   * @param astar CAM16-UCS a coordinate
   * @param bstar CAM16-UCS b coordinate
   */
  constructor(hue, chroma, j, q, m, s, jstar, astar, bstar) {
    this.hue = hue;
    this.chroma = chroma;
    this.j = j;
    this.q = q;
    this.m = m;
    this.s = s;
    this.jstar = jstar;
    this.astar = astar;
    this.bstar = bstar;
  }
  /**
   * CAM16 instances also have coordinates in the CAM16-UCS space, called J*,
   * a*, b*, or jstar, astar, bstar in code. CAM16-UCS is included in the CAM16
   * specification, and is used to measure distances between colors.
   */
  distance(other) {
    const dJ = this.jstar - other.jstar;
    const dA = this.astar - other.astar;
    const dB = this.bstar - other.bstar;
    const dEPrime = Math.sqrt(dJ * dJ + dA * dA + dB * dB);
    const dE = 1.41 * Math.pow(dEPrime, 0.63);
    return dE;
  }
  /**
   * @param argb ARGB representation of a color.
   * @return CAM16 color, assuming the color was viewed in default viewing
   *     conditions.
   */
  static fromInt(argb) {
    return _Cam16.fromIntInViewingConditions(argb, ViewingConditions.DEFAULT);
  }
  /**
   * @param argb ARGB representation of a color.
   * @param viewingConditions Information about the environment where the color
   *     was observed.
   * @return CAM16 color.
   */
  static fromIntInViewingConditions(argb, viewingConditions) {
    const red = (argb & 16711680) >> 16;
    const green = (argb & 65280) >> 8;
    const blue = argb & 255;
    const redL = linearized(red);
    const greenL = linearized(green);
    const blueL = linearized(blue);
    const x = 0.41233895 * redL + 0.35762064 * greenL + 0.18051042 * blueL;
    const y = 0.2126 * redL + 0.7152 * greenL + 0.0722 * blueL;
    const z = 0.01932141 * redL + 0.11916382 * greenL + 0.95034478 * blueL;
    const rC = 0.401288 * x + 0.650173 * y - 0.051461 * z;
    const gC = -0.250268 * x + 1.204414 * y + 0.045854 * z;
    const bC = -2079e-6 * x + 0.048952 * y + 0.953127 * z;
    const rD = viewingConditions.rgbD[0] * rC;
    const gD = viewingConditions.rgbD[1] * gC;
    const bD = viewingConditions.rgbD[2] * bC;
    const rAF = Math.pow(viewingConditions.fl * Math.abs(rD) / 100, 0.42);
    const gAF = Math.pow(viewingConditions.fl * Math.abs(gD) / 100, 0.42);
    const bAF = Math.pow(viewingConditions.fl * Math.abs(bD) / 100, 0.42);
    const rA = signum(rD) * 400 * rAF / (rAF + 27.13);
    const gA = signum(gD) * 400 * gAF / (gAF + 27.13);
    const bA = signum(bD) * 400 * bAF / (bAF + 27.13);
    const a = (11 * rA + -12 * gA + bA) / 11;
    const b = (rA + gA - 2 * bA) / 9;
    const u = (20 * rA + 20 * gA + 21 * bA) / 20;
    const p2 = (40 * rA + 20 * gA + bA) / 20;
    const atan2 = Math.atan2(b, a);
    const atanDegrees = atan2 * 180 / Math.PI;
    const hue = atanDegrees < 0 ? atanDegrees + 360 : atanDegrees >= 360 ? atanDegrees - 360 : atanDegrees;
    const hueRadians = hue * Math.PI / 180;
    const ac = p2 * viewingConditions.nbb;
    const j = 100 * Math.pow(ac / viewingConditions.aw, viewingConditions.c * viewingConditions.z);
    const q = 4 / viewingConditions.c * Math.sqrt(j / 100) * (viewingConditions.aw + 4) * viewingConditions.fLRoot;
    const huePrime = hue < 20.14 ? hue + 360 : hue;
    const eHue = 0.25 * (Math.cos(huePrime * Math.PI / 180 + 2) + 3.8);
    const p1 = 5e4 / 13 * eHue * viewingConditions.nc * viewingConditions.ncb;
    const t = p1 * Math.sqrt(a * a + b * b) / (u + 0.305);
    const alpha = Math.pow(t, 0.9) * Math.pow(1.64 - Math.pow(0.29, viewingConditions.n), 0.73);
    const c = alpha * Math.sqrt(j / 100);
    const m = c * viewingConditions.fLRoot;
    const s = 50 * Math.sqrt(alpha * viewingConditions.c / (viewingConditions.aw + 4));
    const jstar = (1 + 100 * 7e-3) * j / (1 + 7e-3 * j);
    const mstar = 1 / 0.0228 * Math.log(1 + 0.0228 * m);
    const astar = mstar * Math.cos(hueRadians);
    const bstar = mstar * Math.sin(hueRadians);
    return new _Cam16(hue, c, j, q, m, s, jstar, astar, bstar);
  }
  /**
   * @param j CAM16 lightness
   * @param c CAM16 chroma
   * @param h CAM16 hue
   */
  static fromJch(j, c, h) {
    return _Cam16.fromJchInViewingConditions(j, c, h, ViewingConditions.DEFAULT);
  }
  /**
   * @param j CAM16 lightness
   * @param c CAM16 chroma
   * @param h CAM16 hue
   * @param viewingConditions Information about the environment where the color
   *     was observed.
   */
  static fromJchInViewingConditions(j, c, h, viewingConditions) {
    const q = 4 / viewingConditions.c * Math.sqrt(j / 100) * (viewingConditions.aw + 4) * viewingConditions.fLRoot;
    const m = c * viewingConditions.fLRoot;
    const alpha = c / Math.sqrt(j / 100);
    const s = 50 * Math.sqrt(alpha * viewingConditions.c / (viewingConditions.aw + 4));
    const hueRadians = h * Math.PI / 180;
    const jstar = (1 + 100 * 7e-3) * j / (1 + 7e-3 * j);
    const mstar = 1 / 0.0228 * Math.log(1 + 0.0228 * m);
    const astar = mstar * Math.cos(hueRadians);
    const bstar = mstar * Math.sin(hueRadians);
    return new _Cam16(h, c, j, q, m, s, jstar, astar, bstar);
  }
  /**
   * @param jstar CAM16-UCS lightness.
   * @param astar CAM16-UCS a dimension. Like a* in L*a*b*, it is a Cartesian
   *     coordinate on the Y axis.
   * @param bstar CAM16-UCS b dimension. Like a* in L*a*b*, it is a Cartesian
   *     coordinate on the X axis.
   */
  static fromUcs(jstar, astar, bstar) {
    return _Cam16.fromUcsInViewingConditions(jstar, astar, bstar, ViewingConditions.DEFAULT);
  }
  /**
   * @param jstar CAM16-UCS lightness.
   * @param astar CAM16-UCS a dimension. Like a* in L*a*b*, it is a Cartesian
   *     coordinate on the Y axis.
   * @param bstar CAM16-UCS b dimension. Like a* in L*a*b*, it is a Cartesian
   *     coordinate on the X axis.
   * @param viewingConditions Information about the environment where the color
   *     was observed.
   */
  static fromUcsInViewingConditions(jstar, astar, bstar, viewingConditions) {
    const a = astar;
    const b = bstar;
    const m = Math.sqrt(a * a + b * b);
    const M = (Math.exp(m * 0.0228) - 1) / 0.0228;
    const c = M / viewingConditions.fLRoot;
    let h = Math.atan2(b, a) * (180 / Math.PI);
    if (h < 0) {
      h += 360;
    }
    const j = jstar / (1 - (jstar - 100) * 7e-3);
    return _Cam16.fromJchInViewingConditions(j, c, h, viewingConditions);
  }
  /**
   *  @return ARGB representation of color, assuming the color was viewed in
   *     default viewing conditions, which are near-identical to the default
   *     viewing conditions for sRGB.
   */
  toInt() {
    return this.viewed(ViewingConditions.DEFAULT);
  }
  /**
   * @param viewingConditions Information about the environment where the color
   *     will be viewed.
   * @return ARGB representation of color
   */
  viewed(viewingConditions) {
    const alpha = this.chroma === 0 || this.j === 0 ? 0 : this.chroma / Math.sqrt(this.j / 100);
    const t = Math.pow(alpha / Math.pow(1.64 - Math.pow(0.29, viewingConditions.n), 0.73), 1 / 0.9);
    const hRad = this.hue * Math.PI / 180;
    const eHue = 0.25 * (Math.cos(hRad + 2) + 3.8);
    const ac = viewingConditions.aw * Math.pow(this.j / 100, 1 / viewingConditions.c / viewingConditions.z);
    const p1 = eHue * (5e4 / 13) * viewingConditions.nc * viewingConditions.ncb;
    const p2 = ac / viewingConditions.nbb;
    const hSin = Math.sin(hRad);
    const hCos = Math.cos(hRad);
    const gamma = 23 * (p2 + 0.305) * t / (23 * p1 + 11 * t * hCos + 108 * t * hSin);
    const a = gamma * hCos;
    const b = gamma * hSin;
    const rA = (460 * p2 + 451 * a + 288 * b) / 1403;
    const gA = (460 * p2 - 891 * a - 261 * b) / 1403;
    const bA = (460 * p2 - 220 * a - 6300 * b) / 1403;
    const rCBase = Math.max(0, 27.13 * Math.abs(rA) / (400 - Math.abs(rA)));
    const rC = signum(rA) * (100 / viewingConditions.fl) * Math.pow(rCBase, 1 / 0.42);
    const gCBase = Math.max(0, 27.13 * Math.abs(gA) / (400 - Math.abs(gA)));
    const gC = signum(gA) * (100 / viewingConditions.fl) * Math.pow(gCBase, 1 / 0.42);
    const bCBase = Math.max(0, 27.13 * Math.abs(bA) / (400 - Math.abs(bA)));
    const bC = signum(bA) * (100 / viewingConditions.fl) * Math.pow(bCBase, 1 / 0.42);
    const rF = rC / viewingConditions.rgbD[0];
    const gF = gC / viewingConditions.rgbD[1];
    const bF = bC / viewingConditions.rgbD[2];
    const x = 1.86206786 * rF - 1.01125463 * gF + 0.14918677 * bF;
    const y = 0.38752654 * rF + 0.62144744 * gF - 897398e-8 * bF;
    const z = -0.0158415 * rF - 0.03412294 * gF + 1.04996444 * bF;
    const argb = argbFromXyz(x, y, z);
    return argb;
  }
  /// Given color expressed in XYZ and viewed in [viewingConditions], convert to
  /// CAM16.
  static fromXyzInViewingConditions(x, y, z, viewingConditions) {
    const rC = 0.401288 * x + 0.650173 * y - 0.051461 * z;
    const gC = -0.250268 * x + 1.204414 * y + 0.045854 * z;
    const bC = -2079e-6 * x + 0.048952 * y + 0.953127 * z;
    const rD = viewingConditions.rgbD[0] * rC;
    const gD = viewingConditions.rgbD[1] * gC;
    const bD = viewingConditions.rgbD[2] * bC;
    const rAF = Math.pow(viewingConditions.fl * Math.abs(rD) / 100, 0.42);
    const gAF = Math.pow(viewingConditions.fl * Math.abs(gD) / 100, 0.42);
    const bAF = Math.pow(viewingConditions.fl * Math.abs(bD) / 100, 0.42);
    const rA = signum(rD) * 400 * rAF / (rAF + 27.13);
    const gA = signum(gD) * 400 * gAF / (gAF + 27.13);
    const bA = signum(bD) * 400 * bAF / (bAF + 27.13);
    const a = (11 * rA + -12 * gA + bA) / 11;
    const b = (rA + gA - 2 * bA) / 9;
    const u = (20 * rA + 20 * gA + 21 * bA) / 20;
    const p2 = (40 * rA + 20 * gA + bA) / 20;
    const atan2 = Math.atan2(b, a);
    const atanDegrees = atan2 * 180 / Math.PI;
    const hue = atanDegrees < 0 ? atanDegrees + 360 : atanDegrees >= 360 ? atanDegrees - 360 : atanDegrees;
    const hueRadians = hue * Math.PI / 180;
    const ac = p2 * viewingConditions.nbb;
    const J = 100 * Math.pow(ac / viewingConditions.aw, viewingConditions.c * viewingConditions.z);
    const Q = 4 / viewingConditions.c * Math.sqrt(J / 100) * (viewingConditions.aw + 4) * viewingConditions.fLRoot;
    const huePrime = hue < 20.14 ? hue + 360 : hue;
    const eHue = 1 / 4 * (Math.cos(huePrime * Math.PI / 180 + 2) + 3.8);
    const p1 = 5e4 / 13 * eHue * viewingConditions.nc * viewingConditions.ncb;
    const t = p1 * Math.sqrt(a * a + b * b) / (u + 0.305);
    const alpha = Math.pow(t, 0.9) * Math.pow(1.64 - Math.pow(0.29, viewingConditions.n), 0.73);
    const C = alpha * Math.sqrt(J / 100);
    const M = C * viewingConditions.fLRoot;
    const s = 50 * Math.sqrt(alpha * viewingConditions.c / (viewingConditions.aw + 4));
    const jstar = (1 + 100 * 7e-3) * J / (1 + 7e-3 * J);
    const mstar = Math.log(1 + 0.0228 * M) / 0.0228;
    const astar = mstar * Math.cos(hueRadians);
    const bstar = mstar * Math.sin(hueRadians);
    return new _Cam16(hue, C, J, Q, M, s, jstar, astar, bstar);
  }
  /// XYZ representation of CAM16 seen in [viewingConditions].
  xyzInViewingConditions(viewingConditions) {
    const alpha = this.chroma === 0 || this.j === 0 ? 0 : this.chroma / Math.sqrt(this.j / 100);
    const t = Math.pow(alpha / Math.pow(1.64 - Math.pow(0.29, viewingConditions.n), 0.73), 1 / 0.9);
    const hRad = this.hue * Math.PI / 180;
    const eHue = 0.25 * (Math.cos(hRad + 2) + 3.8);
    const ac = viewingConditions.aw * Math.pow(this.j / 100, 1 / viewingConditions.c / viewingConditions.z);
    const p1 = eHue * (5e4 / 13) * viewingConditions.nc * viewingConditions.ncb;
    const p2 = ac / viewingConditions.nbb;
    const hSin = Math.sin(hRad);
    const hCos = Math.cos(hRad);
    const gamma = 23 * (p2 + 0.305) * t / (23 * p1 + 11 * t * hCos + 108 * t * hSin);
    const a = gamma * hCos;
    const b = gamma * hSin;
    const rA = (460 * p2 + 451 * a + 288 * b) / 1403;
    const gA = (460 * p2 - 891 * a - 261 * b) / 1403;
    const bA = (460 * p2 - 220 * a - 6300 * b) / 1403;
    const rCBase = Math.max(0, 27.13 * Math.abs(rA) / (400 - Math.abs(rA)));
    const rC = signum(rA) * (100 / viewingConditions.fl) * Math.pow(rCBase, 1 / 0.42);
    const gCBase = Math.max(0, 27.13 * Math.abs(gA) / (400 - Math.abs(gA)));
    const gC = signum(gA) * (100 / viewingConditions.fl) * Math.pow(gCBase, 1 / 0.42);
    const bCBase = Math.max(0, 27.13 * Math.abs(bA) / (400 - Math.abs(bA)));
    const bC = signum(bA) * (100 / viewingConditions.fl) * Math.pow(bCBase, 1 / 0.42);
    const rF = rC / viewingConditions.rgbD[0];
    const gF = gC / viewingConditions.rgbD[1];
    const bF = bC / viewingConditions.rgbD[2];
    const x = 1.86206786 * rF - 1.01125463 * gF + 0.14918677 * bF;
    const y = 0.38752654 * rF + 0.62144744 * gF - 897398e-8 * bF;
    const z = -0.0158415 * rF - 0.03412294 * gF + 1.04996444 * bF;
    return [x, y, z];
  }
};

// node_modules/@material/material-color-utilities/hct/hct_solver.js
/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
var HctSolver = class _HctSolver {
  /**
   * Sanitizes a small enough angle in radians.
   *
   * @param angle An angle in radians; must not deviate too much
   * from 0.
   * @return A coterminal angle between 0 and 2pi.
   */
  static sanitizeRadians(angle) {
    return (angle + Math.PI * 8) % (Math.PI * 2);
  }
  /**
   * Delinearizes an RGB component, returning a floating-point
   * number.
   *
   * @param rgbComponent 0.0 <= rgb_component <= 100.0, represents
   * linear R/G/B channel
   * @return 0.0 <= output <= 255.0, color channel converted to
   * regular RGB space
   */
  static trueDelinearized(rgbComponent) {
    const normalized = rgbComponent / 100;
    let delinearized2 = 0;
    if (normalized <= 31308e-7) {
      delinearized2 = normalized * 12.92;
    } else {
      delinearized2 = 1.055 * Math.pow(normalized, 1 / 2.4) - 0.055;
    }
    return delinearized2 * 255;
  }
  static chromaticAdaptation(component) {
    const af = Math.pow(Math.abs(component), 0.42);
    return signum(component) * 400 * af / (af + 27.13);
  }
  /**
   * Returns the hue of a linear RGB color in CAM16.
   *
   * @param linrgb The linear RGB coordinates of a color.
   * @return The hue of the color in CAM16, in radians.
   */
  static hueOf(linrgb) {
    const scaledDiscount = matrixMultiply(linrgb, _HctSolver.SCALED_DISCOUNT_FROM_LINRGB);
    const rA = _HctSolver.chromaticAdaptation(scaledDiscount[0]);
    const gA = _HctSolver.chromaticAdaptation(scaledDiscount[1]);
    const bA = _HctSolver.chromaticAdaptation(scaledDiscount[2]);
    const a = (11 * rA + -12 * gA + bA) / 11;
    const b = (rA + gA - 2 * bA) / 9;
    return Math.atan2(b, a);
  }
  static areInCyclicOrder(a, b, c) {
    const deltaAB = _HctSolver.sanitizeRadians(b - a);
    const deltaAC = _HctSolver.sanitizeRadians(c - a);
    return deltaAB < deltaAC;
  }
  /**
   * Solves the lerp equation.
   *
   * @param source The starting number.
   * @param mid The number in the middle.
   * @param target The ending number.
   * @return A number t such that lerp(source, target, t) = mid.
   */
  static intercept(source, mid, target) {
    return (mid - source) / (target - source);
  }
  static lerpPoint(source, t, target) {
    return [
      source[0] + (target[0] - source[0]) * t,
      source[1] + (target[1] - source[1]) * t,
      source[2] + (target[2] - source[2]) * t
    ];
  }
  /**
   * Intersects a segment with a plane.
   *
   * @param source The coordinates of point A.
   * @param coordinate The R-, G-, or B-coordinate of the plane.
   * @param target The coordinates of point B.
   * @param axis The axis the plane is perpendicular with. (0: R, 1:
   * G, 2: B)
   * @return The intersection point of the segment AB with the plane
   * R=coordinate, G=coordinate, or B=coordinate
   */
  static setCoordinate(source, coordinate, target, axis) {
    const t = _HctSolver.intercept(source[axis], coordinate, target[axis]);
    return _HctSolver.lerpPoint(source, t, target);
  }
  static isBounded(x) {
    return 0 <= x && x <= 100;
  }
  /**
   * Returns the nth possible vertex of the polygonal intersection.
   *
   * @param y The Y value of the plane.
   * @param n The zero-based index of the point. 0 <= n <= 11.
   * @return The nth possible vertex of the polygonal intersection
   * of the y plane and the RGB cube, in linear RGB coordinates, if
   * it exists. If this possible vertex lies outside of the cube,
   * [-1.0, -1.0, -1.0] is returned.
   */
  static nthVertex(y, n) {
    const kR = _HctSolver.Y_FROM_LINRGB[0];
    const kG = _HctSolver.Y_FROM_LINRGB[1];
    const kB = _HctSolver.Y_FROM_LINRGB[2];
    const coordA = n % 4 <= 1 ? 0 : 100;
    const coordB = n % 2 === 0 ? 0 : 100;
    if (n < 4) {
      const g = coordA;
      const b = coordB;
      const r = (y - g * kG - b * kB) / kR;
      if (_HctSolver.isBounded(r)) {
        return [r, g, b];
      } else {
        return [-1, -1, -1];
      }
    } else if (n < 8) {
      const b = coordA;
      const r = coordB;
      const g = (y - r * kR - b * kB) / kG;
      if (_HctSolver.isBounded(g)) {
        return [r, g, b];
      } else {
        return [-1, -1, -1];
      }
    } else {
      const r = coordA;
      const g = coordB;
      const b = (y - r * kR - g * kG) / kB;
      if (_HctSolver.isBounded(b)) {
        return [r, g, b];
      } else {
        return [-1, -1, -1];
      }
    }
  }
  /**
   * Finds the segment containing the desired color.
   *
   * @param y The Y value of the color.
   * @param targetHue The hue of the color.
   * @return A list of two sets of linear RGB coordinates, each
   * corresponding to an endpoint of the segment containing the
   * desired color.
   */
  static bisectToSegment(y, targetHue) {
    let left = [-1, -1, -1];
    let right = left;
    let leftHue = 0;
    let rightHue = 0;
    let initialized = false;
    let uncut = true;
    for (let n = 0; n < 12; n++) {
      const mid = _HctSolver.nthVertex(y, n);
      if (mid[0] < 0) {
        continue;
      }
      const midHue = _HctSolver.hueOf(mid);
      if (!initialized) {
        left = mid;
        right = mid;
        leftHue = midHue;
        rightHue = midHue;
        initialized = true;
        continue;
      }
      if (uncut || _HctSolver.areInCyclicOrder(leftHue, midHue, rightHue)) {
        uncut = false;
        if (_HctSolver.areInCyclicOrder(leftHue, targetHue, midHue)) {
          right = mid;
          rightHue = midHue;
        } else {
          left = mid;
          leftHue = midHue;
        }
      }
    }
    return [left, right];
  }
  static midpoint(a, b) {
    return [
      (a[0] + b[0]) / 2,
      (a[1] + b[1]) / 2,
      (a[2] + b[2]) / 2
    ];
  }
  static criticalPlaneBelow(x) {
    return Math.floor(x - 0.5);
  }
  static criticalPlaneAbove(x) {
    return Math.ceil(x - 0.5);
  }
  /**
   * Finds a color with the given Y and hue on the boundary of the
   * cube.
   *
   * @param y The Y value of the color.
   * @param targetHue The hue of the color.
   * @return The desired color, in linear RGB coordinates.
   */
  static bisectToLimit(y, targetHue) {
    const segment = _HctSolver.bisectToSegment(y, targetHue);
    let left = segment[0];
    let leftHue = _HctSolver.hueOf(left);
    let right = segment[1];
    for (let axis = 0; axis < 3; axis++) {
      if (left[axis] !== right[axis]) {
        let lPlane = -1;
        let rPlane = 255;
        if (left[axis] < right[axis]) {
          lPlane = _HctSolver.criticalPlaneBelow(_HctSolver.trueDelinearized(left[axis]));
          rPlane = _HctSolver.criticalPlaneAbove(_HctSolver.trueDelinearized(right[axis]));
        } else {
          lPlane = _HctSolver.criticalPlaneAbove(_HctSolver.trueDelinearized(left[axis]));
          rPlane = _HctSolver.criticalPlaneBelow(_HctSolver.trueDelinearized(right[axis]));
        }
        for (let i = 0; i < 8; i++) {
          if (Math.abs(rPlane - lPlane) <= 1) {
            break;
          } else {
            const mPlane = Math.floor((lPlane + rPlane) / 2);
            const midPlaneCoordinate = _HctSolver.CRITICAL_PLANES[mPlane];
            const mid = _HctSolver.setCoordinate(left, midPlaneCoordinate, right, axis);
            const midHue = _HctSolver.hueOf(mid);
            if (_HctSolver.areInCyclicOrder(leftHue, targetHue, midHue)) {
              right = mid;
              rPlane = mPlane;
            } else {
              left = mid;
              leftHue = midHue;
              lPlane = mPlane;
            }
          }
        }
      }
    }
    return _HctSolver.midpoint(left, right);
  }
  static inverseChromaticAdaptation(adapted) {
    const adaptedAbs = Math.abs(adapted);
    const base = Math.max(0, 27.13 * adaptedAbs / (400 - adaptedAbs));
    return signum(adapted) * Math.pow(base, 1 / 0.42);
  }
  /**
   * Finds a color with the given hue, chroma, and Y.
   *
   * @param hueRadians The desired hue in radians.
   * @param chroma The desired chroma.
   * @param y The desired Y.
   * @return The desired color as a hexadecimal integer, if found; 0
   * otherwise.
   */
  static findResultByJ(hueRadians, chroma, y) {
    let j = Math.sqrt(y) * 11;
    const viewingConditions = ViewingConditions.DEFAULT;
    const tInnerCoeff = 1 / Math.pow(1.64 - Math.pow(0.29, viewingConditions.n), 0.73);
    const eHue = 0.25 * (Math.cos(hueRadians + 2) + 3.8);
    const p1 = eHue * (5e4 / 13) * viewingConditions.nc * viewingConditions.ncb;
    const hSin = Math.sin(hueRadians);
    const hCos = Math.cos(hueRadians);
    for (let iterationRound = 0; iterationRound < 5; iterationRound++) {
      const jNormalized = j / 100;
      const alpha = chroma === 0 || j === 0 ? 0 : chroma / Math.sqrt(jNormalized);
      const t = Math.pow(alpha * tInnerCoeff, 1 / 0.9);
      const ac = viewingConditions.aw * Math.pow(jNormalized, 1 / viewingConditions.c / viewingConditions.z);
      const p2 = ac / viewingConditions.nbb;
      const gamma = 23 * (p2 + 0.305) * t / (23 * p1 + 11 * t * hCos + 108 * t * hSin);
      const a = gamma * hCos;
      const b = gamma * hSin;
      const rA = (460 * p2 + 451 * a + 288 * b) / 1403;
      const gA = (460 * p2 - 891 * a - 261 * b) / 1403;
      const bA = (460 * p2 - 220 * a - 6300 * b) / 1403;
      const rCScaled = _HctSolver.inverseChromaticAdaptation(rA);
      const gCScaled = _HctSolver.inverseChromaticAdaptation(gA);
      const bCScaled = _HctSolver.inverseChromaticAdaptation(bA);
      const linrgb = matrixMultiply([rCScaled, gCScaled, bCScaled], _HctSolver.LINRGB_FROM_SCALED_DISCOUNT);
      if (linrgb[0] < 0 || linrgb[1] < 0 || linrgb[2] < 0) {
        return 0;
      }
      const kR = _HctSolver.Y_FROM_LINRGB[0];
      const kG = _HctSolver.Y_FROM_LINRGB[1];
      const kB = _HctSolver.Y_FROM_LINRGB[2];
      const fnj = kR * linrgb[0] + kG * linrgb[1] + kB * linrgb[2];
      if (fnj <= 0) {
        return 0;
      }
      if (iterationRound === 4 || Math.abs(fnj - y) < 2e-3) {
        if (linrgb[0] > 100.01 || linrgb[1] > 100.01 || linrgb[2] > 100.01) {
          return 0;
        }
        return argbFromLinrgb(linrgb);
      }
      j = j - (fnj - y) * j / (2 * fnj);
    }
    return 0;
  }
  /**
   * Finds an sRGB color with the given hue, chroma, and L*, if
   * possible.
   *
   * @param hueDegrees The desired hue, in degrees.
   * @param chroma The desired chroma.
   * @param lstar The desired L*.
   * @return A hexadecimal representing the sRGB color. The color
   * has sufficiently close hue, chroma, and L* to the desired
   * values, if possible; otherwise, the hue and L* will be
   * sufficiently close, and chroma will be maximized.
   */
  static solveToInt(hueDegrees, chroma, lstar) {
    if (chroma < 1e-4 || lstar < 1e-4 || lstar > 99.9999) {
      return argbFromLstar(lstar);
    }
    hueDegrees = sanitizeDegreesDouble(hueDegrees);
    const hueRadians = hueDegrees / 180 * Math.PI;
    const y = yFromLstar(lstar);
    const exactAnswer = _HctSolver.findResultByJ(hueRadians, chroma, y);
    if (exactAnswer !== 0) {
      return exactAnswer;
    }
    const linrgb = _HctSolver.bisectToLimit(y, hueRadians);
    return argbFromLinrgb(linrgb);
  }
  /**
   * Finds an sRGB color with the given hue, chroma, and L*, if
   * possible.
   *
   * @param hueDegrees The desired hue, in degrees.
   * @param chroma The desired chroma.
   * @param lstar The desired L*.
   * @return An CAM16 object representing the sRGB color. The color
   * has sufficiently close hue, chroma, and L* to the desired
   * values, if possible; otherwise, the hue and L* will be
   * sufficiently close, and chroma will be maximized.
   */
  static solveToCam(hueDegrees, chroma, lstar) {
    return Cam16.fromInt(_HctSolver.solveToInt(hueDegrees, chroma, lstar));
  }
};
HctSolver.SCALED_DISCOUNT_FROM_LINRGB = [
  [
    0.001200833568784504,
    0.002389694492170889,
    2795742885861124e-19
  ],
  [
    5891086651375999e-19,
    0.0029785502573438758,
    3270666104008398e-19
  ],
  [
    10146692491640572e-20,
    5364214359186694e-19,
    0.0032979401770712076
  ]
];
HctSolver.LINRGB_FROM_SCALED_DISCOUNT = [
  [
    1373.2198709594231,
    -1100.4251190754821,
    -7.278681089101213
  ],
  [
    -271.815969077903,
    559.6580465940733,
    -32.46047482791194
  ],
  [
    1.9622899599665666,
    -57.173814538844006,
    308.7233197812385
  ]
];
HctSolver.Y_FROM_LINRGB = [0.2126, 0.7152, 0.0722];
HctSolver.CRITICAL_PLANES = [
  0.015176349177441876,
  0.045529047532325624,
  0.07588174588720938,
  0.10623444424209313,
  0.13658714259697685,
  0.16693984095186062,
  0.19729253930674434,
  0.2276452376616281,
  0.2579979360165119,
  0.28835063437139563,
  0.3188300904430532,
  0.350925934958123,
  0.3848314933096426,
  0.42057480301049466,
  0.458183274052838,
  0.4976837250274023,
  0.5391024159806381,
  0.5824650784040898,
  0.6277969426914107,
  0.6751227633498623,
  0.7244668422128921,
  0.775853049866786,
  0.829304845476233,
  0.8848452951698498,
  0.942497089126609,
  1.0022825574869039,
  1.0642236851973577,
  1.1283421258858297,
  1.1946592148522128,
  1.2631959812511864,
  1.3339731595349034,
  1.407011200216447,
  1.4823302800086415,
  1.5599503113873272,
  1.6398909516233677,
  1.7221716113234105,
  1.8068114625156377,
  1.8938294463134073,
  1.9832442801866852,
  2.075074464868551,
  2.1693382909216234,
  2.2660538449872063,
  2.36523901573795,
  2.4669114995532007,
  2.5710888059345764,
  2.6777882626779785,
  2.7870270208169257,
  2.898822059350997,
  3.0131901897720907,
  3.1301480604002863,
  3.2497121605402226,
  3.3718988244681087,
  3.4967242352587946,
  3.624204428461639,
  3.754355295633311,
  3.887192587735158,
  4.022731918402185,
  4.160988767090289,
  4.301978482107941,
  4.445716283538092,
  4.592217266055746,
  4.741496401646282,
  4.893568542229298,
  5.048448422192488,
  5.20615066083972,
  5.3666897647573375,
  5.5300801301023865,
  5.696336044816294,
  5.865471690767354,
  6.037501145825082,
  6.212438385869475,
  6.390297286737924,
  6.571091626112461,
  6.7548350853498045,
  6.941541251256611,
  7.131223617812143,
  7.323895587840543,
  7.5195704746346665,
  7.7182615035334345,
  7.919981813454504,
  8.124744458384042,
  8.332562408825165,
  8.543448553206703,
  8.757415699253682,
  8.974476575321063,
  9.194643831691977,
  9.417930041841839,
  9.644347703669503,
  9.873909240696694,
  10.106627003236781,
  10.342513269534024,
  10.58158024687427,
  10.8238400726681,
  11.069304815507364,
  11.317986476196008,
  11.569896988756009,
  11.825048221409341,
  12.083451977536606,
  12.345119996613247,
  12.610063955123938,
  12.878295467455942,
  13.149826086772048,
  13.42466730586372,
  13.702830557985108,
  13.984327217668513,
  14.269168601521828,
  14.55736596900856,
  14.848930523210871,
  15.143873411576273,
  15.44220572664832,
  15.743938506781891,
  16.04908273684337,
  16.35764934889634,
  16.66964922287304,
  16.985093187232053,
  17.30399201960269,
  17.62635644741625,
  17.95219714852476,
  18.281524751807332,
  18.614349837764564,
  18.95068293910138,
  19.290534541298456,
  19.633915083172692,
  19.98083495742689,
  20.331304511189067,
  20.685334046541502,
  21.042933821039977,
  21.404114048223256,
  21.76888489811322,
  22.137256497705877,
  22.50923893145328,
  22.884842241736916,
  23.264076429332462,
  23.6469514538663,
  24.033477234264016,
  24.42366364919083,
  24.817520537484558,
  25.21505769858089,
  25.61628489293138,
  26.021211842414342,
  26.429848230738664,
  26.842203703840827,
  27.258287870275353,
  27.678110301598522,
  28.10168053274597,
  28.529008062403893,
  28.96010235337422,
  29.39497283293396,
  29.83362889318845,
  30.276079891419332,
  30.722335150426627,
  31.172403958865512,
  31.62629557157785,
  32.08401920991837,
  32.54558406207592,
  33.010999283389665,
  33.4802739966603,
  33.953417292456834,
  34.430438229418264,
  34.911345834551085,
  35.39614910352207,
  35.88485700094671,
  36.37747846067349,
  36.87402238606382,
  37.37449765026789,
  37.87891309649659,
  38.38727753828926,
  38.89959975977785,
  39.41588851594697,
  39.93615253289054,
  40.460400508064545,
  40.98864111053629,
  41.520882981230194,
  42.05713473317016,
  42.597404951718396,
  43.141702194811224,
  43.6900349931913,
  44.24241185063697,
  44.798841244188324,
  45.35933162437017,
  45.92389141541209,
  46.49252901546552,
  47.065252796817916,
  47.64207110610409,
  48.22299226451468,
  48.808024568002054,
  49.3971762874833,
  49.9904556690408,
  50.587870934119984,
  51.189430279724725,
  51.79514187861014,
  52.40501387947288,
  53.0190544071392,
  53.637271562750364,
  54.259673423945976,
  54.88626804504493,
  55.517063457223934,
  56.15206766869424,
  56.79128866487574,
  57.43473440856916,
  58.08241284012621,
  58.734331877617365,
  59.39049941699807,
  60.05092333227251,
  60.715611475655585,
  61.38457167773311,
  62.057811747619894,
  62.7353394731159,
  63.417162620860914,
  64.10328893648692,
  64.79372614476921,
  65.48848194977529,
  66.18756403501224,
  66.89098006357258,
  67.59873767827808,
  68.31084450182222,
  69.02730813691093,
  69.74813616640164,
  70.47333615344107,
  71.20291564160104,
  71.93688215501312,
  72.67524319850172,
  73.41800625771542,
  74.16517879925733,
  74.9167682708136,
  75.67278210128072,
  76.43322770089146,
  77.1981124613393,
  77.96744375590167,
  78.74122893956174,
  79.51947534912904,
  80.30219030335869,
  81.08938110306934,
  81.88105503125999,
  82.67721935322541,
  83.4778813166706,
  84.28304815182372,
  85.09272707154808,
  85.90692527145302,
  86.72564993000343,
  87.54890820862819,
  88.3767072518277,
  89.2090541872801,
  90.04595612594655,
  90.88742016217518,
  91.73345337380438,
  92.58406282226491,
  93.43925555268066,
  94.29903859396902,
  95.16341895893969,
  96.03240364439274,
  96.9059996312159,
  97.78421388448044,
  98.6670533535366,
  99.55452497210776
];

// node_modules/@material/material-color-utilities/hct/hct.js
/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
var Hct = class _Hct {
  static from(hue, chroma, tone) {
    return new _Hct(HctSolver.solveToInt(hue, chroma, tone));
  }
  /**
   * @param argb ARGB representation of a color.
   * @return HCT representation of a color in default viewing conditions
   */
  static fromInt(argb) {
    return new _Hct(argb);
  }
  toInt() {
    return this.argb;
  }
  /**
   * A number, in degrees, representing ex. red, orange, yellow, etc.
   * Ranges from 0 <= hue < 360.
   */
  get hue() {
    return this.internalHue;
  }
  /**
   * @param newHue 0 <= newHue < 360; invalid values are corrected.
   * Chroma may decrease because chroma has a different maximum for any given
   * hue and tone.
   */
  set hue(newHue) {
    this.setInternalState(HctSolver.solveToInt(newHue, this.internalChroma, this.internalTone));
  }
  get chroma() {
    return this.internalChroma;
  }
  /**
   * @param newChroma 0 <= newChroma < ?
   * Chroma may decrease because chroma has a different maximum for any given
   * hue and tone.
   */
  set chroma(newChroma) {
    this.setInternalState(HctSolver.solveToInt(this.internalHue, newChroma, this.internalTone));
  }
  /** Lightness. Ranges from 0 to 100. */
  get tone() {
    return this.internalTone;
  }
  /**
   * @param newTone 0 <= newTone <= 100; invalid valids are corrected.
   * Chroma may decrease because chroma has a different maximum for any given
   * hue and tone.
   */
  set tone(newTone) {
    this.setInternalState(HctSolver.solveToInt(this.internalHue, this.internalChroma, newTone));
  }
  constructor(argb) {
    this.argb = argb;
    const cam = Cam16.fromInt(argb);
    this.internalHue = cam.hue;
    this.internalChroma = cam.chroma;
    this.internalTone = lstarFromArgb(argb);
    this.argb = argb;
  }
  setInternalState(argb) {
    const cam = Cam16.fromInt(argb);
    this.internalHue = cam.hue;
    this.internalChroma = cam.chroma;
    this.internalTone = lstarFromArgb(argb);
    this.argb = argb;
  }
  /**
   * Translates a color into different [ViewingConditions].
   *
   * Colors change appearance. They look different with lights on versus off,
   * the same color, as in hex code, on white looks different when on black.
   * This is called color relativity, most famously explicated by Josef Albers
   * in Interaction of Color.
   *
   * In color science, color appearance models can account for this and
   * calculate the appearance of a color in different settings. HCT is based on
   * CAM16, a color appearance model, and uses it to make these calculations.
   *
   * See [ViewingConditions.make] for parameters affecting color appearance.
   */
  inViewingConditions(vc) {
    const cam = Cam16.fromInt(this.toInt());
    const viewedInVc = cam.xyzInViewingConditions(vc);
    const recastInVc = Cam16.fromXyzInViewingConditions(viewedInVc[0], viewedInVc[1], viewedInVc[2], ViewingConditions.make());
    const recastHct = _Hct.from(recastInVc.hue, recastInVc.chroma, lstarFromY(viewedInVc[1]));
    return recastHct;
  }
};

// node_modules/@material/material-color-utilities/blend/blend.js
/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
var Blend = class _Blend {
  /**
   * Blend the design color's HCT hue towards the key color's HCT
   * hue, in a way that leaves the original color recognizable and
   * recognizably shifted towards the key color.
   *
   * @param designColor ARGB representation of an arbitrary color.
   * @param sourceColor ARGB representation of the main theme color.
   * @return The design color with a hue shifted towards the
   * system's color, a slightly warmer/cooler variant of the design
   * color's hue.
   */
  static harmonize(designColor, sourceColor) {
    const fromHct = Hct.fromInt(designColor);
    const toHct = Hct.fromInt(sourceColor);
    const differenceDegrees2 = differenceDegrees(fromHct.hue, toHct.hue);
    const rotationDegrees = Math.min(differenceDegrees2 * 0.5, 15);
    const outputHue = sanitizeDegreesDouble(fromHct.hue + rotationDegrees * rotationDirection(fromHct.hue, toHct.hue));
    return Hct.from(outputHue, fromHct.chroma, fromHct.tone).toInt();
  }
  /**
   * Blends hue from one color into another. The chroma and tone of
   * the original color are maintained.
   *
   * @param from ARGB representation of color
   * @param to ARGB representation of color
   * @param amount how much blending to perform; 0.0 >= and <= 1.0
   * @return from, with a hue blended towards to. Chroma and tone
   * are constant.
   */
  static hctHue(from, to, amount) {
    const ucs = _Blend.cam16Ucs(from, to, amount);
    const ucsCam = Cam16.fromInt(ucs);
    const fromCam = Cam16.fromInt(from);
    const blended = Hct.from(ucsCam.hue, fromCam.chroma, lstarFromArgb(from));
    return blended.toInt();
  }
  /**
   * Blend in CAM16-UCS space.
   *
   * @param from ARGB representation of color
   * @param to ARGB representation of color
   * @param amount how much blending to perform; 0.0 >= and <= 1.0
   * @return from, blended towards to. Hue, chroma, and tone will
   * change.
   */
  static cam16Ucs(from, to, amount) {
    const fromCam = Cam16.fromInt(from);
    const toCam = Cam16.fromInt(to);
    const fromJ = fromCam.jstar;
    const fromA = fromCam.astar;
    const fromB = fromCam.bstar;
    const toJ = toCam.jstar;
    const toA = toCam.astar;
    const toB = toCam.bstar;
    const jstar = fromJ + (toJ - fromJ) * amount;
    const astar = fromA + (toA - fromA) * amount;
    const bstar = fromB + (toB - fromB) * amount;
    return Cam16.fromUcs(jstar, astar, bstar).toInt();
  }
};

// node_modules/@material/material-color-utilities/contrast/contrast.js
/**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
var Contrast = class _Contrast {
  /**
   * Returns a contrast ratio, which ranges from 1 to 21.
   *
   * @param toneA Tone between 0 and 100. Values outside will be clamped.
   * @param toneB Tone between 0 and 100. Values outside will be clamped.
   */
  static ratioOfTones(toneA, toneB) {
    toneA = clampDouble(0, 100, toneA);
    toneB = clampDouble(0, 100, toneB);
    return _Contrast.ratioOfYs(yFromLstar(toneA), yFromLstar(toneB));
  }
  static ratioOfYs(y1, y2) {
    const lighter = y1 > y2 ? y1 : y2;
    const darker = lighter === y2 ? y1 : y2;
    return (lighter + 5) / (darker + 5);
  }
  /**
   * Returns a tone >= tone parameter that ensures ratio parameter.
   * Return value is between 0 and 100.
   * Returns -1 if ratio cannot be achieved with tone parameter.
   *
   * @param tone Tone return value must contrast with.
   * Range is 0 to 100. Invalid values will result in -1 being returned.
   * @param ratio Contrast ratio of return value and tone.
   * Range is 1 to 21, invalid values have undefined behavior.
   */
  static lighter(tone, ratio) {
    if (tone < 0 || tone > 100) {
      return -1;
    }
    const darkY = yFromLstar(tone);
    const lightY = ratio * (darkY + 5) - 5;
    const realContrast = _Contrast.ratioOfYs(lightY, darkY);
    const delta = Math.abs(realContrast - ratio);
    if (realContrast < ratio && delta > 0.04) {
      return -1;
    }
    const returnValue = lstarFromY(lightY) + 0.4;
    if (returnValue < 0 || returnValue > 100) {
      return -1;
    }
    return returnValue;
  }
  /**
   * Returns a tone <= tone parameter that ensures ratio parameter.
   * Return value is between 0 and 100.
   * Returns -1 if ratio cannot be achieved with tone parameter.
   *
   * @param tone Tone return value must contrast with.
   * Range is 0 to 100. Invalid values will result in -1 being returned.
   * @param ratio Contrast ratio of return value and tone.
   * Range is 1 to 21, invalid values have undefined behavior.
   */
  static darker(tone, ratio) {
    if (tone < 0 || tone > 100) {
      return -1;
    }
    const lightY = yFromLstar(tone);
    const darkY = (lightY + 5) / ratio - 5;
    const realContrast = _Contrast.ratioOfYs(lightY, darkY);
    const delta = Math.abs(realContrast - ratio);
    if (realContrast < ratio && delta > 0.04) {
      return -1;
    }
    const returnValue = lstarFromY(darkY) - 0.4;
    if (returnValue < 0 || returnValue > 100) {
      return -1;
    }
    return returnValue;
  }
  /**
   * Returns a tone >= tone parameter that ensures ratio parameter.
   * Return value is between 0 and 100.
   * Returns 100 if ratio cannot be achieved with tone parameter.
   *
   * This method is unsafe because the returned value is guaranteed to be in
   * bounds for tone, i.e. between 0 and 100. However, that value may not reach
   * the ratio with tone. For example, there is no color lighter than T100.
   *
   * @param tone Tone return value must contrast with.
   * Range is 0 to 100. Invalid values will result in 100 being returned.
   * @param ratio Desired contrast ratio of return value and tone parameter.
   * Range is 1 to 21, invalid values have undefined behavior.
   */
  static lighterUnsafe(tone, ratio) {
    const lighterSafe = _Contrast.lighter(tone, ratio);
    return lighterSafe < 0 ? 100 : lighterSafe;
  }
  /**
   * Returns a tone >= tone parameter that ensures ratio parameter.
   * Return value is between 0 and 100.
   * Returns 100 if ratio cannot be achieved with tone parameter.
   *
   * This method is unsafe because the returned value is guaranteed to be in
   * bounds for tone, i.e. between 0 and 100. However, that value may not reach
   * the [ratio with [tone]. For example, there is no color darker than T0.
   *
   * @param tone Tone return value must contrast with.
   * Range is 0 to 100. Invalid values will result in 0 being returned.
   * @param ratio Desired contrast ratio of return value and tone parameter.
   * Range is 1 to 21, invalid values have undefined behavior.
   */
  static darkerUnsafe(tone, ratio) {
    const darkerSafe = _Contrast.darker(tone, ratio);
    return darkerSafe < 0 ? 0 : darkerSafe;
  }
};

// node_modules/@material/material-color-utilities/dislike/dislike_analyzer.js
/**
 * @license
 * Copyright 2023 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
var DislikeAnalyzer = class _DislikeAnalyzer {
  /**
   * Returns true if a color is disliked.
   *
   * @param hct A color to be judged.
   * @return Whether the color is disliked.
   *
   * Disliked is defined as a dark yellow-green that is not neutral.
   */
  static isDisliked(hct) {
    const huePasses = Math.round(hct.hue) >= 90 && Math.round(hct.hue) <= 111;
    const chromaPasses = Math.round(hct.chroma) > 16;
    const tonePasses = Math.round(hct.tone) < 65;
    return huePasses && chromaPasses && tonePasses;
  }
  /**
   * If a color is disliked, lighten it to make it likable.
   *
   * @param hct A color to be judged.
   * @return A new color if the original color is disliked, or the original
   *   color if it is acceptable.
   */
  static fixIfDisliked(hct) {
    if (_DislikeAnalyzer.isDisliked(hct)) {
      return Hct.from(hct.hue, hct.chroma, 70);
    }
    return hct;
  }
};

// node_modules/@material/material-color-utilities/dynamiccolor/dynamic_color.js
/**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
var DynamicColor = class _DynamicColor {
  /**
   * Create a DynamicColor defined by a TonalPalette and HCT tone.
   *
   * @param args Functions with DynamicScheme as input. Must provide a palette
   * and tone. May provide a background DynamicColor and ToneDeltaConstraint.
   */
  static fromPalette(args) {
    return new _DynamicColor(args.name ?? "", args.palette, args.tone, args.isBackground ?? false, args.background, args.secondBackground, args.contrastCurve, args.toneDeltaPair);
  }
  /**
   * The base constructor for DynamicColor.
   *
   * _Strongly_ prefer using one of the convenience constructors. This class is
   * arguably too flexible to ensure it can support any scenario. Functional
   * arguments allow  overriding without risks that come with subclasses.
   *
   * For example, the default behavior of adjust tone at max contrast
   * to be at a 7.0 ratio with its background is principled and
   * matches accessibility guidance. That does not mean it's the desired
   * approach for _every_ design system, and every color pairing,
   * always, in every case.
   *
   * @param name The name of the dynamic color. Defaults to empty.
   * @param palette Function that provides a TonalPalette given
   * DynamicScheme. A TonalPalette is defined by a hue and chroma, so this
   * replaces the need to specify hue/chroma. By providing a tonal palette, when
   * contrast adjustments are made, intended chroma can be preserved.
   * @param tone Function that provides a tone, given a DynamicScheme.
   * @param isBackground Whether this dynamic color is a background, with
   * some other color as the foreground. Defaults to false.
   * @param background The background of the dynamic color (as a function of a
   *     `DynamicScheme`), if it exists.
   * @param secondBackground A second background of the dynamic color (as a
   *     function of a `DynamicScheme`), if it
   * exists.
   * @param contrastCurve A `ContrastCurve` object specifying how its contrast
   * against its background should behave in various contrast levels options.
   * @param toneDeltaPair A `ToneDeltaPair` object specifying a tone delta
   * constraint between two colors. One of them must be the color being
   * constructed.
   */
  constructor(name, palette, tone, isBackground, background, secondBackground, contrastCurve, toneDeltaPair) {
    this.name = name;
    this.palette = palette;
    this.tone = tone;
    this.isBackground = isBackground;
    this.background = background;
    this.secondBackground = secondBackground;
    this.contrastCurve = contrastCurve;
    this.toneDeltaPair = toneDeltaPair;
    this.hctCache = /* @__PURE__ */ new Map();
    if (!background && secondBackground) {
      throw new Error(`Color ${name} has secondBackgrounddefined, but background is not defined.`);
    }
    if (!background && contrastCurve) {
      throw new Error(`Color ${name} has contrastCurvedefined, but background is not defined.`);
    }
    if (background && !contrastCurve) {
      throw new Error(`Color ${name} has backgrounddefined, but contrastCurve is not defined.`);
    }
  }
  /**
   * Return a ARGB integer (i.e. a hex code).
   *
   * @param scheme Defines the conditions of the user interface, for example,
   * whether or not it is dark mode or light mode, and what the desired
   * contrast level is.
   */
  getArgb(scheme) {
    return this.getHct(scheme).toInt();
  }
  /**
   * Return a color, expressed in the HCT color space, that this
   * DynamicColor is under the conditions in scheme.
   *
   * @param scheme Defines the conditions of the user interface, for example,
   * whether or not it is dark mode or light mode, and what the desired
   * contrast level is.
   */
  getHct(scheme) {
    const cachedAnswer = this.hctCache.get(scheme);
    if (cachedAnswer != null) {
      return cachedAnswer;
    }
    const tone = this.getTone(scheme);
    const answer = this.palette(scheme).getHct(tone);
    if (this.hctCache.size > 4) {
      this.hctCache.clear();
    }
    this.hctCache.set(scheme, answer);
    return answer;
  }
  /**
   * Return a tone, T in the HCT color space, that this DynamicColor is under
   * the conditions in scheme.
   *
   * @param scheme Defines the conditions of the user interface, for example,
   * whether or not it is dark mode or light mode, and what the desired
   * contrast level is.
   */
  getTone(scheme) {
    const decreasingContrast = scheme.contrastLevel < 0;
    if (this.toneDeltaPair) {
      const toneDeltaPair = this.toneDeltaPair(scheme);
      const roleA = toneDeltaPair.roleA;
      const roleB = toneDeltaPair.roleB;
      const delta = toneDeltaPair.delta;
      const polarity = toneDeltaPair.polarity;
      const stayTogether = toneDeltaPair.stayTogether;
      const bg = this.background(scheme);
      const bgTone = bg.getTone(scheme);
      const aIsNearer = polarity === "nearer" || polarity === "lighter" && !scheme.isDark || polarity === "darker" && scheme.isDark;
      const nearer = aIsNearer ? roleA : roleB;
      const farther = aIsNearer ? roleB : roleA;
      const amNearer = this.name === nearer.name;
      const expansionDir = scheme.isDark ? 1 : -1;
      const nContrast = nearer.contrastCurve.get(scheme.contrastLevel);
      const fContrast = farther.contrastCurve.get(scheme.contrastLevel);
      const nInitialTone = nearer.tone(scheme);
      let nTone = Contrast.ratioOfTones(bgTone, nInitialTone) >= nContrast ? nInitialTone : _DynamicColor.foregroundTone(bgTone, nContrast);
      const fInitialTone = farther.tone(scheme);
      let fTone = Contrast.ratioOfTones(bgTone, fInitialTone) >= fContrast ? fInitialTone : _DynamicColor.foregroundTone(bgTone, fContrast);
      if (decreasingContrast) {
        nTone = _DynamicColor.foregroundTone(bgTone, nContrast);
        fTone = _DynamicColor.foregroundTone(bgTone, fContrast);
      }
      if ((fTone - nTone) * expansionDir >= delta) {
      } else {
        fTone = clampDouble(0, 100, nTone + delta * expansionDir);
        if ((fTone - nTone) * expansionDir >= delta) {
        } else {
          nTone = clampDouble(0, 100, fTone - delta * expansionDir);
        }
      }
      if (50 <= nTone && nTone < 60) {
        if (expansionDir > 0) {
          nTone = 60;
          fTone = Math.max(fTone, nTone + delta * expansionDir);
        } else {
          nTone = 49;
          fTone = Math.min(fTone, nTone + delta * expansionDir);
        }
      } else if (50 <= fTone && fTone < 60) {
        if (stayTogether) {
          if (expansionDir > 0) {
            nTone = 60;
            fTone = Math.max(fTone, nTone + delta * expansionDir);
          } else {
            nTone = 49;
            fTone = Math.min(fTone, nTone + delta * expansionDir);
          }
        } else {
          if (expansionDir > 0) {
            fTone = 60;
          } else {
            fTone = 49;
          }
        }
      }
      return amNearer ? nTone : fTone;
    } else {
      let answer = this.tone(scheme);
      if (this.background == null) {
        return answer;
      }
      const bgTone = this.background(scheme).getTone(scheme);
      const desiredRatio = this.contrastCurve.get(scheme.contrastLevel);
      if (Contrast.ratioOfTones(bgTone, answer) >= desiredRatio) {
      } else {
        answer = _DynamicColor.foregroundTone(bgTone, desiredRatio);
      }
      if (decreasingContrast) {
        answer = _DynamicColor.foregroundTone(bgTone, desiredRatio);
      }
      if (this.isBackground && 50 <= answer && answer < 60) {
        if (Contrast.ratioOfTones(49, bgTone) >= desiredRatio) {
          answer = 49;
        } else {
          answer = 60;
        }
      }
      if (this.secondBackground) {
        const [bg1, bg2] = [this.background, this.secondBackground];
        const [bgTone1, bgTone2] = [bg1(scheme).getTone(scheme), bg2(scheme).getTone(scheme)];
        const [upper, lower] = [Math.max(bgTone1, bgTone2), Math.min(bgTone1, bgTone2)];
        if (Contrast.ratioOfTones(upper, answer) >= desiredRatio && Contrast.ratioOfTones(lower, answer) >= desiredRatio) {
          return answer;
        }
        const lightOption = Contrast.lighter(upper, desiredRatio);
        const darkOption = Contrast.darker(lower, desiredRatio);
        const availables = [];
        if (lightOption !== -1)
          availables.push(lightOption);
        if (darkOption !== -1)
          availables.push(darkOption);
        const prefersLight = _DynamicColor.tonePrefersLightForeground(bgTone1) || _DynamicColor.tonePrefersLightForeground(bgTone2);
        if (prefersLight) {
          return lightOption < 0 ? 100 : lightOption;
        }
        if (availables.length === 1) {
          return availables[0];
        }
        return darkOption < 0 ? 0 : darkOption;
      }
      return answer;
    }
  }
  /**
   * Given a background tone, find a foreground tone, while ensuring they reach
   * a contrast ratio that is as close to [ratio] as possible.
   *
   * @param bgTone Tone in HCT. Range is 0 to 100, undefined behavior when it
   *     falls outside that range.
   * @param ratio The contrast ratio desired between bgTone and the return
   *     value.
   */
  static foregroundTone(bgTone, ratio) {
    const lighterTone = Contrast.lighterUnsafe(bgTone, ratio);
    const darkerTone = Contrast.darkerUnsafe(bgTone, ratio);
    const lighterRatio = Contrast.ratioOfTones(lighterTone, bgTone);
    const darkerRatio = Contrast.ratioOfTones(darkerTone, bgTone);
    const preferLighter = _DynamicColor.tonePrefersLightForeground(bgTone);
    if (preferLighter) {
      const negligibleDifference = Math.abs(lighterRatio - darkerRatio) < 0.1 && lighterRatio < ratio && darkerRatio < ratio;
      return lighterRatio >= ratio || lighterRatio >= darkerRatio || negligibleDifference ? lighterTone : darkerTone;
    } else {
      return darkerRatio >= ratio || darkerRatio >= lighterRatio ? darkerTone : lighterTone;
    }
  }
  /**
   * Returns whether [tone] prefers a light foreground.
   *
   * People prefer white foregrounds on ~T60-70. Observed over time, and also
   * by Andrew Somers during research for APCA.
   *
   * T60 used as to create the smallest discontinuity possible when skipping
   * down to T49 in order to ensure light foregrounds.
   * Since `tertiaryContainer` in dark monochrome scheme requires a tone of
   * 60, it should not be adjusted. Therefore, 60 is excluded here.
   */
  static tonePrefersLightForeground(tone) {
    return Math.round(tone) < 60;
  }
  /**
   * Returns whether [tone] can reach a contrast ratio of 4.5 with a lighter
   * color.
   */
  static toneAllowsLightForeground(tone) {
    return Math.round(tone) <= 49;
  }
  /**
   * Adjust a tone such that white has 4.5 contrast, if the tone is
   * reasonably close to supporting it.
   */
  static enableLightForeground(tone) {
    if (_DynamicColor.tonePrefersLightForeground(tone) && !_DynamicColor.toneAllowsLightForeground(tone)) {
      return 49;
    }
    return tone;
  }
};

// node_modules/@material/material-color-utilities/palettes/tonal_palette.js
/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
var TonalPalette = class _TonalPalette {
  /**
   * @param argb ARGB representation of a color
   * @return Tones matching that color's hue and chroma.
   */
  static fromInt(argb) {
    const hct = Hct.fromInt(argb);
    return _TonalPalette.fromHct(hct);
  }
  /**
   * @param hct Hct
   * @return Tones matching that color's hue and chroma.
   */
  static fromHct(hct) {
    return new _TonalPalette(hct.hue, hct.chroma, hct);
  }
  /**
   * @param hue HCT hue
   * @param chroma HCT chroma
   * @return Tones matching hue and chroma.
   */
  static fromHueAndChroma(hue, chroma) {
    const keyColor = new KeyColor(hue, chroma).create();
    return new _TonalPalette(hue, chroma, keyColor);
  }
  constructor(hue, chroma, keyColor) {
    this.hue = hue;
    this.chroma = chroma;
    this.keyColor = keyColor;
    this.cache = /* @__PURE__ */ new Map();
  }
  /**
   * @param tone HCT tone, measured from 0 to 100.
   * @return ARGB representation of a color with that tone.
   */
  tone(tone) {
    let argb = this.cache.get(tone);
    if (argb === void 0) {
      argb = Hct.from(this.hue, this.chroma, tone).toInt();
      this.cache.set(tone, argb);
    }
    return argb;
  }
  /**
   * @param tone HCT tone.
   * @return HCT representation of a color with that tone.
   */
  getHct(tone) {
    return Hct.fromInt(this.tone(tone));
  }
};
var KeyColor = class {
  constructor(hue, requestedChroma) {
    this.hue = hue;
    this.requestedChroma = requestedChroma;
    this.chromaCache = /* @__PURE__ */ new Map();
    this.maxChromaValue = 200;
  }
  /**
   * Creates a key color from a [hue] and a [chroma].
   * The key color is the first tone, starting from T50, matching the given hue
   * and chroma.
   *
   * @return Key color [Hct]
   */
  create() {
    const pivotTone = 50;
    const toneStepSize = 1;
    const epsilon = 0.01;
    let lowerTone = 0;
    let upperTone = 100;
    while (lowerTone < upperTone) {
      const midTone = Math.floor((lowerTone + upperTone) / 2);
      const isAscending = this.maxChroma(midTone) < this.maxChroma(midTone + toneStepSize);
      const sufficientChroma = this.maxChroma(midTone) >= this.requestedChroma - epsilon;
      if (sufficientChroma) {
        if (Math.abs(lowerTone - pivotTone) < Math.abs(upperTone - pivotTone)) {
          upperTone = midTone;
        } else {
          if (lowerTone === midTone) {
            return Hct.from(this.hue, this.requestedChroma, lowerTone);
          }
          lowerTone = midTone;
        }
      } else {
        if (isAscending) {
          lowerTone = midTone + toneStepSize;
        } else {
          upperTone = midTone;
        }
      }
    }
    return Hct.from(this.hue, this.requestedChroma, lowerTone);
  }
  // Find the maximum chroma for a given tone
  maxChroma(tone) {
    if (this.chromaCache.has(tone)) {
      return this.chromaCache.get(tone);
    }
    const chroma = Hct.from(this.hue, this.maxChromaValue, tone).chroma;
    this.chromaCache.set(tone, chroma);
    return chroma;
  }
};

// node_modules/@material/material-color-utilities/dynamiccolor/contrast_curve.js
/**
 * @license
 * Copyright 2023 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
var ContrastCurve = class {
  /**
   * Creates a `ContrastCurve` object.
   *
   * @param low Value for contrast level -1.0
   * @param normal Value for contrast level 0.0
   * @param medium Value for contrast level 0.5
   * @param high Value for contrast level 1.0
   */
  constructor(low, normal, medium, high) {
    this.low = low;
    this.normal = normal;
    this.medium = medium;
    this.high = high;
  }
  /**
   * Returns the value at a given contrast level.
   *
   * @param contrastLevel The contrast level. 0.0 is the default (normal); -1.0
   *     is the lowest; 1.0 is the highest.
   * @return The value. For contrast ratios, a number between 1.0 and 21.0.
   */
  get(contrastLevel) {
    if (contrastLevel <= -1) {
      return this.low;
    } else if (contrastLevel < 0) {
      return lerp(this.low, this.normal, (contrastLevel - -1) / 1);
    } else if (contrastLevel < 0.5) {
      return lerp(this.normal, this.medium, (contrastLevel - 0) / 0.5);
    } else if (contrastLevel < 1) {
      return lerp(this.medium, this.high, (contrastLevel - 0.5) / 0.5);
    } else {
      return this.high;
    }
  }
};

// node_modules/@material/material-color-utilities/dynamiccolor/tone_delta_pair.js
/**
 * @license
 * Copyright 2023 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
var ToneDeltaPair = class {
  /**
   * Documents a constraint in tone distance between two DynamicColors.
   *
   * The polarity is an adjective that describes "A", compared to "B".
   *
   * For instance, ToneDeltaPair(A, B, 15, 'darker', stayTogether) states that
   * A's tone should be at least 15 darker than B's.
   *
   * 'nearer' and 'farther' describes closeness to the surface roles. For
   * instance, ToneDeltaPair(A, B, 10, 'nearer', stayTogether) states that A
   * should be 10 lighter than B in light mode, and 10 darker than B in dark
   * mode.
   *
   * @param roleA The first role in a pair.
   * @param roleB The second role in a pair.
   * @param delta Required difference between tones. Absolute value, negative
   * values have undefined behavior.
   * @param polarity The relative relation between tones of roleA and roleB,
   * as described above.
   * @param stayTogether Whether these two roles should stay on the same side of
   * the "awkward zone" (T50-59). This is necessary for certain cases where
   * one role has two backgrounds.
   */
  constructor(roleA, roleB, delta, polarity, stayTogether) {
    this.roleA = roleA;
    this.roleB = roleB;
    this.delta = delta;
    this.polarity = polarity;
    this.stayTogether = stayTogether;
  }
};

// node_modules/@material/material-color-utilities/dynamiccolor/variant.js
/**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
var Variant;
(function(Variant2) {
  Variant2[Variant2["MONOCHROME"] = 0] = "MONOCHROME";
  Variant2[Variant2["NEUTRAL"] = 1] = "NEUTRAL";
  Variant2[Variant2["TONAL_SPOT"] = 2] = "TONAL_SPOT";
  Variant2[Variant2["VIBRANT"] = 3] = "VIBRANT";
  Variant2[Variant2["EXPRESSIVE"] = 4] = "EXPRESSIVE";
  Variant2[Variant2["FIDELITY"] = 5] = "FIDELITY";
  Variant2[Variant2["CONTENT"] = 6] = "CONTENT";
  Variant2[Variant2["RAINBOW"] = 7] = "RAINBOW";
  Variant2[Variant2["FRUIT_SALAD"] = 8] = "FRUIT_SALAD";
})(Variant || (Variant = {}));

// node_modules/@material/material-color-utilities/dynamiccolor/material_dynamic_colors.js
/**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
function isFidelity(scheme) {
  return scheme.variant === Variant.FIDELITY || scheme.variant === Variant.CONTENT;
}
function isMonochrome(scheme) {
  return scheme.variant === Variant.MONOCHROME;
}
function findDesiredChromaByTone(hue, chroma, tone, byDecreasingTone) {
  let answer = tone;
  let closestToChroma = Hct.from(hue, chroma, tone);
  if (closestToChroma.chroma < chroma) {
    let chromaPeak = closestToChroma.chroma;
    while (closestToChroma.chroma < chroma) {
      answer += byDecreasingTone ? -1 : 1;
      const potentialSolution = Hct.from(hue, chroma, answer);
      if (chromaPeak > potentialSolution.chroma) {
        break;
      }
      if (Math.abs(potentialSolution.chroma - chroma) < 0.4) {
        break;
      }
      const potentialDelta = Math.abs(potentialSolution.chroma - chroma);
      const currentDelta = Math.abs(closestToChroma.chroma - chroma);
      if (potentialDelta < currentDelta) {
        closestToChroma = potentialSolution;
      }
      chromaPeak = Math.max(chromaPeak, potentialSolution.chroma);
    }
  }
  return answer;
}
var MaterialDynamicColors = class _MaterialDynamicColors {
  static highestSurface(s) {
    return s.isDark ? _MaterialDynamicColors.surfaceBright : _MaterialDynamicColors.surfaceDim;
  }
};
MaterialDynamicColors.contentAccentToneDelta = 15;
MaterialDynamicColors.primaryPaletteKeyColor = DynamicColor.fromPalette({
  name: "primary_palette_key_color",
  palette: (s) => s.primaryPalette,
  tone: (s) => s.primaryPalette.keyColor.tone
});
MaterialDynamicColors.secondaryPaletteKeyColor = DynamicColor.fromPalette({
  name: "secondary_palette_key_color",
  palette: (s) => s.secondaryPalette,
  tone: (s) => s.secondaryPalette.keyColor.tone
});
MaterialDynamicColors.tertiaryPaletteKeyColor = DynamicColor.fromPalette({
  name: "tertiary_palette_key_color",
  palette: (s) => s.tertiaryPalette,
  tone: (s) => s.tertiaryPalette.keyColor.tone
});
MaterialDynamicColors.neutralPaletteKeyColor = DynamicColor.fromPalette({
  name: "neutral_palette_key_color",
  palette: (s) => s.neutralPalette,
  tone: (s) => s.neutralPalette.keyColor.tone
});
MaterialDynamicColors.neutralVariantPaletteKeyColor = DynamicColor.fromPalette({
  name: "neutral_variant_palette_key_color",
  palette: (s) => s.neutralVariantPalette,
  tone: (s) => s.neutralVariantPalette.keyColor.tone
});
MaterialDynamicColors.background = DynamicColor.fromPalette({
  name: "background",
  palette: (s) => s.neutralPalette,
  tone: (s) => s.isDark ? 6 : 98,
  isBackground: true
});
MaterialDynamicColors.onBackground = DynamicColor.fromPalette({
  name: "on_background",
  palette: (s) => s.neutralPalette,
  tone: (s) => s.isDark ? 90 : 10,
  background: (s) => MaterialDynamicColors.background,
  contrastCurve: new ContrastCurve(3, 3, 4.5, 7)
});
MaterialDynamicColors.surface = DynamicColor.fromPalette({
  name: "surface",
  palette: (s) => s.neutralPalette,
  tone: (s) => s.isDark ? 6 : 98,
  isBackground: true
});
MaterialDynamicColors.surfaceDim = DynamicColor.fromPalette({
  name: "surface_dim",
  palette: (s) => s.neutralPalette,
  tone: (s) => s.isDark ? 6 : new ContrastCurve(87, 87, 80, 75).get(s.contrastLevel),
  isBackground: true
});
MaterialDynamicColors.surfaceBright = DynamicColor.fromPalette({
  name: "surface_bright",
  palette: (s) => s.neutralPalette,
  tone: (s) => s.isDark ? new ContrastCurve(24, 24, 29, 34).get(s.contrastLevel) : 98,
  isBackground: true
});
MaterialDynamicColors.surfaceContainerLowest = DynamicColor.fromPalette({
  name: "surface_container_lowest",
  palette: (s) => s.neutralPalette,
  tone: (s) => s.isDark ? new ContrastCurve(4, 4, 2, 0).get(s.contrastLevel) : 100,
  isBackground: true
});
MaterialDynamicColors.surfaceContainerLow = DynamicColor.fromPalette({
  name: "surface_container_low",
  palette: (s) => s.neutralPalette,
  tone: (s) => s.isDark ? new ContrastCurve(10, 10, 11, 12).get(s.contrastLevel) : new ContrastCurve(96, 96, 96, 95).get(s.contrastLevel),
  isBackground: true
});
MaterialDynamicColors.surfaceContainer = DynamicColor.fromPalette({
  name: "surface_container",
  palette: (s) => s.neutralPalette,
  tone: (s) => s.isDark ? new ContrastCurve(12, 12, 16, 20).get(s.contrastLevel) : new ContrastCurve(94, 94, 92, 90).get(s.contrastLevel),
  isBackground: true
});
MaterialDynamicColors.surfaceContainerHigh = DynamicColor.fromPalette({
  name: "surface_container_high",
  palette: (s) => s.neutralPalette,
  tone: (s) => s.isDark ? new ContrastCurve(17, 17, 21, 25).get(s.contrastLevel) : new ContrastCurve(92, 92, 88, 85).get(s.contrastLevel),
  isBackground: true
});
MaterialDynamicColors.surfaceContainerHighest = DynamicColor.fromPalette({
  name: "surface_container_highest",
  palette: (s) => s.neutralPalette,
  tone: (s) => s.isDark ? new ContrastCurve(22, 22, 26, 30).get(s.contrastLevel) : new ContrastCurve(90, 90, 84, 80).get(s.contrastLevel),
  isBackground: true
});
MaterialDynamicColors.onSurface = DynamicColor.fromPalette({
  name: "on_surface",
  palette: (s) => s.neutralPalette,
  tone: (s) => s.isDark ? 90 : 10,
  background: (s) => MaterialDynamicColors.highestSurface(s),
  contrastCurve: new ContrastCurve(4.5, 7, 11, 21)
});
MaterialDynamicColors.surfaceVariant = DynamicColor.fromPalette({
  name: "surface_variant",
  palette: (s) => s.neutralVariantPalette,
  tone: (s) => s.isDark ? 30 : 90,
  isBackground: true
});
MaterialDynamicColors.onSurfaceVariant = DynamicColor.fromPalette({
  name: "on_surface_variant",
  palette: (s) => s.neutralVariantPalette,
  tone: (s) => s.isDark ? 80 : 30,
  background: (s) => MaterialDynamicColors.highestSurface(s),
  contrastCurve: new ContrastCurve(3, 4.5, 7, 11)
});
MaterialDynamicColors.inverseSurface = DynamicColor.fromPalette({
  name: "inverse_surface",
  palette: (s) => s.neutralPalette,
  tone: (s) => s.isDark ? 90 : 20
});
MaterialDynamicColors.inverseOnSurface = DynamicColor.fromPalette({
  name: "inverse_on_surface",
  palette: (s) => s.neutralPalette,
  tone: (s) => s.isDark ? 20 : 95,
  background: (s) => MaterialDynamicColors.inverseSurface,
  contrastCurve: new ContrastCurve(4.5, 7, 11, 21)
});
MaterialDynamicColors.outline = DynamicColor.fromPalette({
  name: "outline",
  palette: (s) => s.neutralVariantPalette,
  tone: (s) => s.isDark ? 60 : 50,
  background: (s) => MaterialDynamicColors.highestSurface(s),
  contrastCurve: new ContrastCurve(1.5, 3, 4.5, 7)
});
MaterialDynamicColors.outlineVariant = DynamicColor.fromPalette({
  name: "outline_variant",
  palette: (s) => s.neutralVariantPalette,
  tone: (s) => s.isDark ? 30 : 80,
  background: (s) => MaterialDynamicColors.highestSurface(s),
  contrastCurve: new ContrastCurve(1, 1, 3, 4.5)
});
MaterialDynamicColors.shadow = DynamicColor.fromPalette({
  name: "shadow",
  palette: (s) => s.neutralPalette,
  tone: (s) => 0
});
MaterialDynamicColors.scrim = DynamicColor.fromPalette({
  name: "scrim",
  palette: (s) => s.neutralPalette,
  tone: (s) => 0
});
MaterialDynamicColors.surfaceTint = DynamicColor.fromPalette({
  name: "surface_tint",
  palette: (s) => s.primaryPalette,
  tone: (s) => s.isDark ? 80 : 40,
  isBackground: true
});
MaterialDynamicColors.primary = DynamicColor.fromPalette({
  name: "primary",
  palette: (s) => s.primaryPalette,
  tone: (s) => {
    if (isMonochrome(s)) {
      return s.isDark ? 100 : 0;
    }
    return s.isDark ? 80 : 40;
  },
  isBackground: true,
  background: (s) => MaterialDynamicColors.highestSurface(s),
  contrastCurve: new ContrastCurve(3, 4.5, 7, 7),
  toneDeltaPair: (s) => new ToneDeltaPair(MaterialDynamicColors.primaryContainer, MaterialDynamicColors.primary, 10, "nearer", false)
});
MaterialDynamicColors.onPrimary = DynamicColor.fromPalette({
  name: "on_primary",
  palette: (s) => s.primaryPalette,
  tone: (s) => {
    if (isMonochrome(s)) {
      return s.isDark ? 10 : 90;
    }
    return s.isDark ? 20 : 100;
  },
  background: (s) => MaterialDynamicColors.primary,
  contrastCurve: new ContrastCurve(4.5, 7, 11, 21)
});
MaterialDynamicColors.primaryContainer = DynamicColor.fromPalette({
  name: "primary_container",
  palette: (s) => s.primaryPalette,
  tone: (s) => {
    if (isFidelity(s)) {
      return s.sourceColorHct.tone;
    }
    if (isMonochrome(s)) {
      return s.isDark ? 85 : 25;
    }
    return s.isDark ? 30 : 90;
  },
  isBackground: true,
  background: (s) => MaterialDynamicColors.highestSurface(s),
  contrastCurve: new ContrastCurve(1, 1, 3, 4.5),
  toneDeltaPair: (s) => new ToneDeltaPair(MaterialDynamicColors.primaryContainer, MaterialDynamicColors.primary, 10, "nearer", false)
});
MaterialDynamicColors.onPrimaryContainer = DynamicColor.fromPalette({
  name: "on_primary_container",
  palette: (s) => s.primaryPalette,
  tone: (s) => {
    if (isFidelity(s)) {
      return DynamicColor.foregroundTone(MaterialDynamicColors.primaryContainer.tone(s), 4.5);
    }
    if (isMonochrome(s)) {
      return s.isDark ? 0 : 100;
    }
    return s.isDark ? 90 : 30;
  },
  background: (s) => MaterialDynamicColors.primaryContainer,
  contrastCurve: new ContrastCurve(3, 4.5, 7, 11)
});
MaterialDynamicColors.inversePrimary = DynamicColor.fromPalette({
  name: "inverse_primary",
  palette: (s) => s.primaryPalette,
  tone: (s) => s.isDark ? 40 : 80,
  background: (s) => MaterialDynamicColors.inverseSurface,
  contrastCurve: new ContrastCurve(3, 4.5, 7, 7)
});
MaterialDynamicColors.secondary = DynamicColor.fromPalette({
  name: "secondary",
  palette: (s) => s.secondaryPalette,
  tone: (s) => s.isDark ? 80 : 40,
  isBackground: true,
  background: (s) => MaterialDynamicColors.highestSurface(s),
  contrastCurve: new ContrastCurve(3, 4.5, 7, 7),
  toneDeltaPair: (s) => new ToneDeltaPair(MaterialDynamicColors.secondaryContainer, MaterialDynamicColors.secondary, 10, "nearer", false)
});
MaterialDynamicColors.onSecondary = DynamicColor.fromPalette({
  name: "on_secondary",
  palette: (s) => s.secondaryPalette,
  tone: (s) => {
    if (isMonochrome(s)) {
      return s.isDark ? 10 : 100;
    } else {
      return s.isDark ? 20 : 100;
    }
  },
  background: (s) => MaterialDynamicColors.secondary,
  contrastCurve: new ContrastCurve(4.5, 7, 11, 21)
});
MaterialDynamicColors.secondaryContainer = DynamicColor.fromPalette({
  name: "secondary_container",
  palette: (s) => s.secondaryPalette,
  tone: (s) => {
    const initialTone = s.isDark ? 30 : 90;
    if (isMonochrome(s)) {
      return s.isDark ? 30 : 85;
    }
    if (!isFidelity(s)) {
      return initialTone;
    }
    return findDesiredChromaByTone(s.secondaryPalette.hue, s.secondaryPalette.chroma, initialTone, s.isDark ? false : true);
  },
  isBackground: true,
  background: (s) => MaterialDynamicColors.highestSurface(s),
  contrastCurve: new ContrastCurve(1, 1, 3, 4.5),
  toneDeltaPair: (s) => new ToneDeltaPair(MaterialDynamicColors.secondaryContainer, MaterialDynamicColors.secondary, 10, "nearer", false)
});
MaterialDynamicColors.onSecondaryContainer = DynamicColor.fromPalette({
  name: "on_secondary_container",
  palette: (s) => s.secondaryPalette,
  tone: (s) => {
    if (isMonochrome(s)) {
      return s.isDark ? 90 : 10;
    }
    if (!isFidelity(s)) {
      return s.isDark ? 90 : 30;
    }
    return DynamicColor.foregroundTone(MaterialDynamicColors.secondaryContainer.tone(s), 4.5);
  },
  background: (s) => MaterialDynamicColors.secondaryContainer,
  contrastCurve: new ContrastCurve(3, 4.5, 7, 11)
});
MaterialDynamicColors.tertiary = DynamicColor.fromPalette({
  name: "tertiary",
  palette: (s) => s.tertiaryPalette,
  tone: (s) => {
    if (isMonochrome(s)) {
      return s.isDark ? 90 : 25;
    }
    return s.isDark ? 80 : 40;
  },
  isBackground: true,
  background: (s) => MaterialDynamicColors.highestSurface(s),
  contrastCurve: new ContrastCurve(3, 4.5, 7, 7),
  toneDeltaPair: (s) => new ToneDeltaPair(MaterialDynamicColors.tertiaryContainer, MaterialDynamicColors.tertiary, 10, "nearer", false)
});
MaterialDynamicColors.onTertiary = DynamicColor.fromPalette({
  name: "on_tertiary",
  palette: (s) => s.tertiaryPalette,
  tone: (s) => {
    if (isMonochrome(s)) {
      return s.isDark ? 10 : 90;
    }
    return s.isDark ? 20 : 100;
  },
  background: (s) => MaterialDynamicColors.tertiary,
  contrastCurve: new ContrastCurve(4.5, 7, 11, 21)
});
MaterialDynamicColors.tertiaryContainer = DynamicColor.fromPalette({
  name: "tertiary_container",
  palette: (s) => s.tertiaryPalette,
  tone: (s) => {
    if (isMonochrome(s)) {
      return s.isDark ? 60 : 49;
    }
    if (!isFidelity(s)) {
      return s.isDark ? 30 : 90;
    }
    const proposedHct = s.tertiaryPalette.getHct(s.sourceColorHct.tone);
    return DislikeAnalyzer.fixIfDisliked(proposedHct).tone;
  },
  isBackground: true,
  background: (s) => MaterialDynamicColors.highestSurface(s),
  contrastCurve: new ContrastCurve(1, 1, 3, 4.5),
  toneDeltaPair: (s) => new ToneDeltaPair(MaterialDynamicColors.tertiaryContainer, MaterialDynamicColors.tertiary, 10, "nearer", false)
});
MaterialDynamicColors.onTertiaryContainer = DynamicColor.fromPalette({
  name: "on_tertiary_container",
  palette: (s) => s.tertiaryPalette,
  tone: (s) => {
    if (isMonochrome(s)) {
      return s.isDark ? 0 : 100;
    }
    if (!isFidelity(s)) {
      return s.isDark ? 90 : 30;
    }
    return DynamicColor.foregroundTone(MaterialDynamicColors.tertiaryContainer.tone(s), 4.5);
  },
  background: (s) => MaterialDynamicColors.tertiaryContainer,
  contrastCurve: new ContrastCurve(3, 4.5, 7, 11)
});
MaterialDynamicColors.error = DynamicColor.fromPalette({
  name: "error",
  palette: (s) => s.errorPalette,
  tone: (s) => s.isDark ? 80 : 40,
  isBackground: true,
  background: (s) => MaterialDynamicColors.highestSurface(s),
  contrastCurve: new ContrastCurve(3, 4.5, 7, 7),
  toneDeltaPair: (s) => new ToneDeltaPair(MaterialDynamicColors.errorContainer, MaterialDynamicColors.error, 10, "nearer", false)
});
MaterialDynamicColors.onError = DynamicColor.fromPalette({
  name: "on_error",
  palette: (s) => s.errorPalette,
  tone: (s) => s.isDark ? 20 : 100,
  background: (s) => MaterialDynamicColors.error,
  contrastCurve: new ContrastCurve(4.5, 7, 11, 21)
});
MaterialDynamicColors.errorContainer = DynamicColor.fromPalette({
  name: "error_container",
  palette: (s) => s.errorPalette,
  tone: (s) => s.isDark ? 30 : 90,
  isBackground: true,
  background: (s) => MaterialDynamicColors.highestSurface(s),
  contrastCurve: new ContrastCurve(1, 1, 3, 4.5),
  toneDeltaPair: (s) => new ToneDeltaPair(MaterialDynamicColors.errorContainer, MaterialDynamicColors.error, 10, "nearer", false)
});
MaterialDynamicColors.onErrorContainer = DynamicColor.fromPalette({
  name: "on_error_container",
  palette: (s) => s.errorPalette,
  tone: (s) => {
    if (isMonochrome(s)) {
      return s.isDark ? 90 : 10;
    }
    return s.isDark ? 90 : 30;
  },
  background: (s) => MaterialDynamicColors.errorContainer,
  contrastCurve: new ContrastCurve(3, 4.5, 7, 11)
});
MaterialDynamicColors.primaryFixed = DynamicColor.fromPalette({
  name: "primary_fixed",
  palette: (s) => s.primaryPalette,
  tone: (s) => isMonochrome(s) ? 40 : 90,
  isBackground: true,
  background: (s) => MaterialDynamicColors.highestSurface(s),
  contrastCurve: new ContrastCurve(1, 1, 3, 4.5),
  toneDeltaPair: (s) => new ToneDeltaPair(MaterialDynamicColors.primaryFixed, MaterialDynamicColors.primaryFixedDim, 10, "lighter", true)
});
MaterialDynamicColors.primaryFixedDim = DynamicColor.fromPalette({
  name: "primary_fixed_dim",
  palette: (s) => s.primaryPalette,
  tone: (s) => isMonochrome(s) ? 30 : 80,
  isBackground: true,
  background: (s) => MaterialDynamicColors.highestSurface(s),
  contrastCurve: new ContrastCurve(1, 1, 3, 4.5),
  toneDeltaPair: (s) => new ToneDeltaPair(MaterialDynamicColors.primaryFixed, MaterialDynamicColors.primaryFixedDim, 10, "lighter", true)
});
MaterialDynamicColors.onPrimaryFixed = DynamicColor.fromPalette({
  name: "on_primary_fixed",
  palette: (s) => s.primaryPalette,
  tone: (s) => isMonochrome(s) ? 100 : 10,
  background: (s) => MaterialDynamicColors.primaryFixedDim,
  secondBackground: (s) => MaterialDynamicColors.primaryFixed,
  contrastCurve: new ContrastCurve(4.5, 7, 11, 21)
});
MaterialDynamicColors.onPrimaryFixedVariant = DynamicColor.fromPalette({
  name: "on_primary_fixed_variant",
  palette: (s) => s.primaryPalette,
  tone: (s) => isMonochrome(s) ? 90 : 30,
  background: (s) => MaterialDynamicColors.primaryFixedDim,
  secondBackground: (s) => MaterialDynamicColors.primaryFixed,
  contrastCurve: new ContrastCurve(3, 4.5, 7, 11)
});
MaterialDynamicColors.secondaryFixed = DynamicColor.fromPalette({
  name: "secondary_fixed",
  palette: (s) => s.secondaryPalette,
  tone: (s) => isMonochrome(s) ? 80 : 90,
  isBackground: true,
  background: (s) => MaterialDynamicColors.highestSurface(s),
  contrastCurve: new ContrastCurve(1, 1, 3, 4.5),
  toneDeltaPair: (s) => new ToneDeltaPair(MaterialDynamicColors.secondaryFixed, MaterialDynamicColors.secondaryFixedDim, 10, "lighter", true)
});
MaterialDynamicColors.secondaryFixedDim = DynamicColor.fromPalette({
  name: "secondary_fixed_dim",
  palette: (s) => s.secondaryPalette,
  tone: (s) => isMonochrome(s) ? 70 : 80,
  isBackground: true,
  background: (s) => MaterialDynamicColors.highestSurface(s),
  contrastCurve: new ContrastCurve(1, 1, 3, 4.5),
  toneDeltaPair: (s) => new ToneDeltaPair(MaterialDynamicColors.secondaryFixed, MaterialDynamicColors.secondaryFixedDim, 10, "lighter", true)
});
MaterialDynamicColors.onSecondaryFixed = DynamicColor.fromPalette({
  name: "on_secondary_fixed",
  palette: (s) => s.secondaryPalette,
  tone: (s) => 10,
  background: (s) => MaterialDynamicColors.secondaryFixedDim,
  secondBackground: (s) => MaterialDynamicColors.secondaryFixed,
  contrastCurve: new ContrastCurve(4.5, 7, 11, 21)
});
MaterialDynamicColors.onSecondaryFixedVariant = DynamicColor.fromPalette({
  name: "on_secondary_fixed_variant",
  palette: (s) => s.secondaryPalette,
  tone: (s) => isMonochrome(s) ? 25 : 30,
  background: (s) => MaterialDynamicColors.secondaryFixedDim,
  secondBackground: (s) => MaterialDynamicColors.secondaryFixed,
  contrastCurve: new ContrastCurve(3, 4.5, 7, 11)
});
MaterialDynamicColors.tertiaryFixed = DynamicColor.fromPalette({
  name: "tertiary_fixed",
  palette: (s) => s.tertiaryPalette,
  tone: (s) => isMonochrome(s) ? 40 : 90,
  isBackground: true,
  background: (s) => MaterialDynamicColors.highestSurface(s),
  contrastCurve: new ContrastCurve(1, 1, 3, 4.5),
  toneDeltaPair: (s) => new ToneDeltaPair(MaterialDynamicColors.tertiaryFixed, MaterialDynamicColors.tertiaryFixedDim, 10, "lighter", true)
});
MaterialDynamicColors.tertiaryFixedDim = DynamicColor.fromPalette({
  name: "tertiary_fixed_dim",
  palette: (s) => s.tertiaryPalette,
  tone: (s) => isMonochrome(s) ? 30 : 80,
  isBackground: true,
  background: (s) => MaterialDynamicColors.highestSurface(s),
  contrastCurve: new ContrastCurve(1, 1, 3, 4.5),
  toneDeltaPair: (s) => new ToneDeltaPair(MaterialDynamicColors.tertiaryFixed, MaterialDynamicColors.tertiaryFixedDim, 10, "lighter", true)
});
MaterialDynamicColors.onTertiaryFixed = DynamicColor.fromPalette({
  name: "on_tertiary_fixed",
  palette: (s) => s.tertiaryPalette,
  tone: (s) => isMonochrome(s) ? 100 : 10,
  background: (s) => MaterialDynamicColors.tertiaryFixedDim,
  secondBackground: (s) => MaterialDynamicColors.tertiaryFixed,
  contrastCurve: new ContrastCurve(4.5, 7, 11, 21)
});
MaterialDynamicColors.onTertiaryFixedVariant = DynamicColor.fromPalette({
  name: "on_tertiary_fixed_variant",
  palette: (s) => s.tertiaryPalette,
  tone: (s) => isMonochrome(s) ? 90 : 30,
  background: (s) => MaterialDynamicColors.tertiaryFixedDim,
  secondBackground: (s) => MaterialDynamicColors.tertiaryFixed,
  contrastCurve: new ContrastCurve(3, 4.5, 7, 11)
});

// node_modules/@material/material-color-utilities/dynamiccolor/dynamic_scheme.js
/**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
var DynamicScheme = class {
  constructor(args) {
    this.sourceColorArgb = args.sourceColorArgb;
    this.variant = args.variant;
    this.contrastLevel = args.contrastLevel;
    this.isDark = args.isDark;
    this.sourceColorHct = Hct.fromInt(args.sourceColorArgb);
    this.primaryPalette = args.primaryPalette;
    this.secondaryPalette = args.secondaryPalette;
    this.tertiaryPalette = args.tertiaryPalette;
    this.neutralPalette = args.neutralPalette;
    this.neutralVariantPalette = args.neutralVariantPalette;
    this.errorPalette = TonalPalette.fromHueAndChroma(25, 84);
  }
  /**
   * Support design spec'ing Dynamic Color by schemes that specify hue
   * rotations that should be applied at certain breakpoints.
   * @param sourceColor the source color of the theme, in HCT.
   * @param hues The "breakpoints", i.e. the hues at which a rotation should
   * be apply.
   * @param rotations The rotation that should be applied when source color's
   * hue is >= the same index in hues array, and <= the hue at the next index
   * in hues array.
   */
  static getRotatedHue(sourceColor, hues, rotations) {
    const sourceHue = sourceColor.hue;
    if (hues.length !== rotations.length) {
      throw new Error(`mismatch between hue length ${hues.length} & rotations ${rotations.length}`);
    }
    if (rotations.length === 1) {
      return sanitizeDegreesDouble(sourceColor.hue + rotations[0]);
    }
    const size = hues.length;
    for (let i = 0; i <= size - 2; i++) {
      const thisHue = hues[i];
      const nextHue = hues[i + 1];
      if (thisHue < sourceHue && sourceHue < nextHue) {
        return sanitizeDegreesDouble(sourceHue + rotations[i]);
      }
    }
    return sourceHue;
  }
  getArgb(dynamicColor) {
    return dynamicColor.getArgb(this);
  }
  getHct(dynamicColor) {
    return dynamicColor.getHct(this);
  }
  get primaryPaletteKeyColor() {
    return this.getArgb(MaterialDynamicColors.primaryPaletteKeyColor);
  }
  get secondaryPaletteKeyColor() {
    return this.getArgb(MaterialDynamicColors.secondaryPaletteKeyColor);
  }
  get tertiaryPaletteKeyColor() {
    return this.getArgb(MaterialDynamicColors.tertiaryPaletteKeyColor);
  }
  get neutralPaletteKeyColor() {
    return this.getArgb(MaterialDynamicColors.neutralPaletteKeyColor);
  }
  get neutralVariantPaletteKeyColor() {
    return this.getArgb(MaterialDynamicColors.neutralVariantPaletteKeyColor);
  }
  get background() {
    return this.getArgb(MaterialDynamicColors.background);
  }
  get onBackground() {
    return this.getArgb(MaterialDynamicColors.onBackground);
  }
  get surface() {
    return this.getArgb(MaterialDynamicColors.surface);
  }
  get surfaceDim() {
    return this.getArgb(MaterialDynamicColors.surfaceDim);
  }
  get surfaceBright() {
    return this.getArgb(MaterialDynamicColors.surfaceBright);
  }
  get surfaceContainerLowest() {
    return this.getArgb(MaterialDynamicColors.surfaceContainerLowest);
  }
  get surfaceContainerLow() {
    return this.getArgb(MaterialDynamicColors.surfaceContainerLow);
  }
  get surfaceContainer() {
    return this.getArgb(MaterialDynamicColors.surfaceContainer);
  }
  get surfaceContainerHigh() {
    return this.getArgb(MaterialDynamicColors.surfaceContainerHigh);
  }
  get surfaceContainerHighest() {
    return this.getArgb(MaterialDynamicColors.surfaceContainerHighest);
  }
  get onSurface() {
    return this.getArgb(MaterialDynamicColors.onSurface);
  }
  get surfaceVariant() {
    return this.getArgb(MaterialDynamicColors.surfaceVariant);
  }
  get onSurfaceVariant() {
    return this.getArgb(MaterialDynamicColors.onSurfaceVariant);
  }
  get inverseSurface() {
    return this.getArgb(MaterialDynamicColors.inverseSurface);
  }
  get inverseOnSurface() {
    return this.getArgb(MaterialDynamicColors.inverseOnSurface);
  }
  get outline() {
    return this.getArgb(MaterialDynamicColors.outline);
  }
  get outlineVariant() {
    return this.getArgb(MaterialDynamicColors.outlineVariant);
  }
  get shadow() {
    return this.getArgb(MaterialDynamicColors.shadow);
  }
  get scrim() {
    return this.getArgb(MaterialDynamicColors.scrim);
  }
  get surfaceTint() {
    return this.getArgb(MaterialDynamicColors.surfaceTint);
  }
  get primary() {
    return this.getArgb(MaterialDynamicColors.primary);
  }
  get onPrimary() {
    return this.getArgb(MaterialDynamicColors.onPrimary);
  }
  get primaryContainer() {
    return this.getArgb(MaterialDynamicColors.primaryContainer);
  }
  get onPrimaryContainer() {
    return this.getArgb(MaterialDynamicColors.onPrimaryContainer);
  }
  get inversePrimary() {
    return this.getArgb(MaterialDynamicColors.inversePrimary);
  }
  get secondary() {
    return this.getArgb(MaterialDynamicColors.secondary);
  }
  get onSecondary() {
    return this.getArgb(MaterialDynamicColors.onSecondary);
  }
  get secondaryContainer() {
    return this.getArgb(MaterialDynamicColors.secondaryContainer);
  }
  get onSecondaryContainer() {
    return this.getArgb(MaterialDynamicColors.onSecondaryContainer);
  }
  get tertiary() {
    return this.getArgb(MaterialDynamicColors.tertiary);
  }
  get onTertiary() {
    return this.getArgb(MaterialDynamicColors.onTertiary);
  }
  get tertiaryContainer() {
    return this.getArgb(MaterialDynamicColors.tertiaryContainer);
  }
  get onTertiaryContainer() {
    return this.getArgb(MaterialDynamicColors.onTertiaryContainer);
  }
  get error() {
    return this.getArgb(MaterialDynamicColors.error);
  }
  get onError() {
    return this.getArgb(MaterialDynamicColors.onError);
  }
  get errorContainer() {
    return this.getArgb(MaterialDynamicColors.errorContainer);
  }
  get onErrorContainer() {
    return this.getArgb(MaterialDynamicColors.onErrorContainer);
  }
  get primaryFixed() {
    return this.getArgb(MaterialDynamicColors.primaryFixed);
  }
  get primaryFixedDim() {
    return this.getArgb(MaterialDynamicColors.primaryFixedDim);
  }
  get onPrimaryFixed() {
    return this.getArgb(MaterialDynamicColors.onPrimaryFixed);
  }
  get onPrimaryFixedVariant() {
    return this.getArgb(MaterialDynamicColors.onPrimaryFixedVariant);
  }
  get secondaryFixed() {
    return this.getArgb(MaterialDynamicColors.secondaryFixed);
  }
  get secondaryFixedDim() {
    return this.getArgb(MaterialDynamicColors.secondaryFixedDim);
  }
  get onSecondaryFixed() {
    return this.getArgb(MaterialDynamicColors.onSecondaryFixed);
  }
  get onSecondaryFixedVariant() {
    return this.getArgb(MaterialDynamicColors.onSecondaryFixedVariant);
  }
  get tertiaryFixed() {
    return this.getArgb(MaterialDynamicColors.tertiaryFixed);
  }
  get tertiaryFixedDim() {
    return this.getArgb(MaterialDynamicColors.tertiaryFixedDim);
  }
  get onTertiaryFixed() {
    return this.getArgb(MaterialDynamicColors.onTertiaryFixed);
  }
  get onTertiaryFixedVariant() {
    return this.getArgb(MaterialDynamicColors.onTertiaryFixedVariant);
  }
};

// node_modules/@material/material-color-utilities/palettes/core_palette.js
/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
var CorePalette = class _CorePalette {
  /**
   * @param argb ARGB representation of a color
   */
  static of(argb) {
    return new _CorePalette(argb, false);
  }
  /**
   * @param argb ARGB representation of a color
   */
  static contentOf(argb) {
    return new _CorePalette(argb, true);
  }
  /**
   * Create a [CorePalette] from a set of colors
   */
  static fromColors(colors) {
    return _CorePalette.createPaletteFromColors(false, colors);
  }
  /**
   * Create a content [CorePalette] from a set of colors
   */
  static contentFromColors(colors) {
    return _CorePalette.createPaletteFromColors(true, colors);
  }
  static createPaletteFromColors(content, colors) {
    const palette = new _CorePalette(colors.primary, content);
    if (colors.secondary) {
      const p = new _CorePalette(colors.secondary, content);
      palette.a2 = p.a1;
    }
    if (colors.tertiary) {
      const p = new _CorePalette(colors.tertiary, content);
      palette.a3 = p.a1;
    }
    if (colors.error) {
      const p = new _CorePalette(colors.error, content);
      palette.error = p.a1;
    }
    if (colors.neutral) {
      const p = new _CorePalette(colors.neutral, content);
      palette.n1 = p.n1;
    }
    if (colors.neutralVariant) {
      const p = new _CorePalette(colors.neutralVariant, content);
      palette.n2 = p.n2;
    }
    return palette;
  }
  constructor(argb, isContent) {
    const hct = Hct.fromInt(argb);
    const hue = hct.hue;
    const chroma = hct.chroma;
    if (isContent) {
      this.a1 = TonalPalette.fromHueAndChroma(hue, chroma);
      this.a2 = TonalPalette.fromHueAndChroma(hue, chroma / 3);
      this.a3 = TonalPalette.fromHueAndChroma(hue + 60, chroma / 2);
      this.n1 = TonalPalette.fromHueAndChroma(hue, Math.min(chroma / 12, 4));
      this.n2 = TonalPalette.fromHueAndChroma(hue, Math.min(chroma / 6, 8));
    } else {
      this.a1 = TonalPalette.fromHueAndChroma(hue, Math.max(48, chroma));
      this.a2 = TonalPalette.fromHueAndChroma(hue, 16);
      this.a3 = TonalPalette.fromHueAndChroma(hue + 60, 24);
      this.n1 = TonalPalette.fromHueAndChroma(hue, 4);
      this.n2 = TonalPalette.fromHueAndChroma(hue, 8);
    }
    this.error = TonalPalette.fromHueAndChroma(25, 84);
  }
};

// node_modules/@material/material-color-utilities/quantize/lab_point_provider.js
/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
var LabPointProvider = class {
  /**
   * Convert a color represented in ARGB to a 3-element array of L*a*b*
   * coordinates of the color.
   */
  fromInt(argb) {
    return labFromArgb(argb);
  }
  /**
   * Convert a 3-element array to a color represented in ARGB.
   */
  toInt(point) {
    return argbFromLab(point[0], point[1], point[2]);
  }
  /**
   * Standard CIE 1976 delta E formula also takes the square root, unneeded
   * here. This method is used by quantization algorithms to compare distance,
   * and the relative ordering is the same, with or without a square root.
   *
   * This relatively minor optimization is helpful because this method is
   * called at least once for each pixel in an image.
   */
  distance(from, to) {
    const dL = from[0] - to[0];
    const dA = from[1] - to[1];
    const dB = from[2] - to[2];
    return dL * dL + dA * dA + dB * dB;
  }
};

// node_modules/@material/material-color-utilities/quantize/quantizer_wsmeans.js
/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
var MAX_ITERATIONS = 10;
var MIN_MOVEMENT_DISTANCE = 3;
var QuantizerWsmeans = class {
  /**
   * @param inputPixels Colors in ARGB format.
   * @param startingClusters Defines the initial state of the quantizer. Passing
   *     an empty array is fine, the implementation will create its own initial
   *     state that leads to reproducible results for the same inputs.
   *     Passing an array that is the result of Wu quantization leads to higher
   *     quality results.
   * @param maxColors The number of colors to divide the image into. A lower
   *     number of colors may be returned.
   * @return Colors in ARGB format.
   */
  static quantize(inputPixels, startingClusters, maxColors) {
    const pixelToCount = /* @__PURE__ */ new Map();
    const points = new Array();
    const pixels = new Array();
    const pointProvider = new LabPointProvider();
    let pointCount = 0;
    for (let i = 0; i < inputPixels.length; i++) {
      const inputPixel = inputPixels[i];
      const pixelCount = pixelToCount.get(inputPixel);
      if (pixelCount === void 0) {
        pointCount++;
        points.push(pointProvider.fromInt(inputPixel));
        pixels.push(inputPixel);
        pixelToCount.set(inputPixel, 1);
      } else {
        pixelToCount.set(inputPixel, pixelCount + 1);
      }
    }
    const counts = new Array();
    for (let i = 0; i < pointCount; i++) {
      const pixel = pixels[i];
      const count = pixelToCount.get(pixel);
      if (count !== void 0) {
        counts[i] = count;
      }
    }
    let clusterCount = Math.min(maxColors, pointCount);
    if (startingClusters.length > 0) {
      clusterCount = Math.min(clusterCount, startingClusters.length);
    }
    const clusters = new Array();
    for (let i = 0; i < startingClusters.length; i++) {
      clusters.push(pointProvider.fromInt(startingClusters[i]));
    }
    const additionalClustersNeeded = clusterCount - clusters.length;
    if (startingClusters.length === 0 && additionalClustersNeeded > 0) {
      for (let i = 0; i < additionalClustersNeeded; i++) {
        const l = Math.random() * 100;
        const a = Math.random() * (100 - -100 + 1) + -100;
        const b = Math.random() * (100 - -100 + 1) + -100;
        clusters.push(new Array(l, a, b));
      }
    }
    const clusterIndices = new Array();
    for (let i = 0; i < pointCount; i++) {
      clusterIndices.push(Math.floor(Math.random() * clusterCount));
    }
    const indexMatrix = new Array();
    for (let i = 0; i < clusterCount; i++) {
      indexMatrix.push(new Array());
      for (let j = 0; j < clusterCount; j++) {
        indexMatrix[i].push(0);
      }
    }
    const distanceToIndexMatrix = new Array();
    for (let i = 0; i < clusterCount; i++) {
      distanceToIndexMatrix.push(new Array());
      for (let j = 0; j < clusterCount; j++) {
        distanceToIndexMatrix[i].push(new DistanceAndIndex());
      }
    }
    const pixelCountSums = new Array();
    for (let i = 0; i < clusterCount; i++) {
      pixelCountSums.push(0);
    }
    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      for (let i = 0; i < clusterCount; i++) {
        for (let j = i + 1; j < clusterCount; j++) {
          const distance = pointProvider.distance(clusters[i], clusters[j]);
          distanceToIndexMatrix[j][i].distance = distance;
          distanceToIndexMatrix[j][i].index = i;
          distanceToIndexMatrix[i][j].distance = distance;
          distanceToIndexMatrix[i][j].index = j;
        }
        distanceToIndexMatrix[i].sort();
        for (let j = 0; j < clusterCount; j++) {
          indexMatrix[i][j] = distanceToIndexMatrix[i][j].index;
        }
      }
      let pointsMoved = 0;
      for (let i = 0; i < pointCount; i++) {
        const point = points[i];
        const previousClusterIndex = clusterIndices[i];
        const previousCluster = clusters[previousClusterIndex];
        const previousDistance = pointProvider.distance(point, previousCluster);
        let minimumDistance = previousDistance;
        let newClusterIndex = -1;
        for (let j = 0; j < clusterCount; j++) {
          if (distanceToIndexMatrix[previousClusterIndex][j].distance >= 4 * previousDistance) {
            continue;
          }
          const distance = pointProvider.distance(point, clusters[j]);
          if (distance < minimumDistance) {
            minimumDistance = distance;
            newClusterIndex = j;
          }
        }
        if (newClusterIndex !== -1) {
          const distanceChange = Math.abs(Math.sqrt(minimumDistance) - Math.sqrt(previousDistance));
          if (distanceChange > MIN_MOVEMENT_DISTANCE) {
            pointsMoved++;
            clusterIndices[i] = newClusterIndex;
          }
        }
      }
      if (pointsMoved === 0 && iteration !== 0) {
        break;
      }
      const componentASums = new Array(clusterCount).fill(0);
      const componentBSums = new Array(clusterCount).fill(0);
      const componentCSums = new Array(clusterCount).fill(0);
      for (let i = 0; i < clusterCount; i++) {
        pixelCountSums[i] = 0;
      }
      for (let i = 0; i < pointCount; i++) {
        const clusterIndex = clusterIndices[i];
        const point = points[i];
        const count = counts[i];
        pixelCountSums[clusterIndex] += count;
        componentASums[clusterIndex] += point[0] * count;
        componentBSums[clusterIndex] += point[1] * count;
        componentCSums[clusterIndex] += point[2] * count;
      }
      for (let i = 0; i < clusterCount; i++) {
        const count = pixelCountSums[i];
        if (count === 0) {
          clusters[i] = [0, 0, 0];
          continue;
        }
        const a = componentASums[i] / count;
        const b = componentBSums[i] / count;
        const c = componentCSums[i] / count;
        clusters[i] = [a, b, c];
      }
    }
    const argbToPopulation = /* @__PURE__ */ new Map();
    for (let i = 0; i < clusterCount; i++) {
      const count = pixelCountSums[i];
      if (count === 0) {
        continue;
      }
      const possibleNewCluster = pointProvider.toInt(clusters[i]);
      if (argbToPopulation.has(possibleNewCluster)) {
        continue;
      }
      argbToPopulation.set(possibleNewCluster, count);
    }
    return argbToPopulation;
  }
};
var DistanceAndIndex = class {
  constructor() {
    this.distance = -1;
    this.index = -1;
  }
};

// node_modules/@material/material-color-utilities/quantize/quantizer_map.js
/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
var QuantizerMap = class {
  /**
   * @param pixels Colors in ARGB format.
   * @return A Map with keys of ARGB colors, and values of the number of times
   *     the color appears in the image.
   */
  static quantize(pixels) {
    const countByColor = /* @__PURE__ */ new Map();
    for (let i = 0; i < pixels.length; i++) {
      const pixel = pixels[i];
      const alpha = alphaFromArgb(pixel);
      if (alpha < 255) {
        continue;
      }
      countByColor.set(pixel, (countByColor.get(pixel) ?? 0) + 1);
    }
    return countByColor;
  }
};

// node_modules/@material/material-color-utilities/quantize/quantizer_wu.js
/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
var INDEX_BITS = 5;
var SIDE_LENGTH = 33;
var TOTAL_SIZE = 35937;
var directions = {
  RED: "red",
  GREEN: "green",
  BLUE: "blue"
};
var QuantizerWu = class {
  constructor(weights = [], momentsR = [], momentsG = [], momentsB = [], moments = [], cubes = []) {
    this.weights = weights;
    this.momentsR = momentsR;
    this.momentsG = momentsG;
    this.momentsB = momentsB;
    this.moments = moments;
    this.cubes = cubes;
  }
  /**
   * @param pixels Colors in ARGB format.
   * @param maxColors The number of colors to divide the image into. A lower
   *     number of colors may be returned.
   * @return Colors in ARGB format.
   */
  quantize(pixels, maxColors) {
    this.constructHistogram(pixels);
    this.computeMoments();
    const createBoxesResult = this.createBoxes(maxColors);
    const results = this.createResult(createBoxesResult.resultCount);
    return results;
  }
  constructHistogram(pixels) {
    this.weights = Array.from({ length: TOTAL_SIZE }).fill(0);
    this.momentsR = Array.from({ length: TOTAL_SIZE }).fill(0);
    this.momentsG = Array.from({ length: TOTAL_SIZE }).fill(0);
    this.momentsB = Array.from({ length: TOTAL_SIZE }).fill(0);
    this.moments = Array.from({ length: TOTAL_SIZE }).fill(0);
    const countByColor = QuantizerMap.quantize(pixels);
    for (const [pixel, count] of countByColor.entries()) {
      const red = redFromArgb(pixel);
      const green = greenFromArgb(pixel);
      const blue = blueFromArgb(pixel);
      const bitsToRemove = 8 - INDEX_BITS;
      const iR = (red >> bitsToRemove) + 1;
      const iG = (green >> bitsToRemove) + 1;
      const iB = (blue >> bitsToRemove) + 1;
      const index = this.getIndex(iR, iG, iB);
      this.weights[index] = (this.weights[index] ?? 0) + count;
      this.momentsR[index] += count * red;
      this.momentsG[index] += count * green;
      this.momentsB[index] += count * blue;
      this.moments[index] += count * (red * red + green * green + blue * blue);
    }
  }
  computeMoments() {
    for (let r = 1; r < SIDE_LENGTH; r++) {
      const area = Array.from({ length: SIDE_LENGTH }).fill(0);
      const areaR = Array.from({ length: SIDE_LENGTH }).fill(0);
      const areaG = Array.from({ length: SIDE_LENGTH }).fill(0);
      const areaB = Array.from({ length: SIDE_LENGTH }).fill(0);
      const area2 = Array.from({ length: SIDE_LENGTH }).fill(0);
      for (let g = 1; g < SIDE_LENGTH; g++) {
        let line = 0;
        let lineR = 0;
        let lineG = 0;
        let lineB = 0;
        let line2 = 0;
        for (let b = 1; b < SIDE_LENGTH; b++) {
          const index = this.getIndex(r, g, b);
          line += this.weights[index];
          lineR += this.momentsR[index];
          lineG += this.momentsG[index];
          lineB += this.momentsB[index];
          line2 += this.moments[index];
          area[b] += line;
          areaR[b] += lineR;
          areaG[b] += lineG;
          areaB[b] += lineB;
          area2[b] += line2;
          const previousIndex = this.getIndex(r - 1, g, b);
          this.weights[index] = this.weights[previousIndex] + area[b];
          this.momentsR[index] = this.momentsR[previousIndex] + areaR[b];
          this.momentsG[index] = this.momentsG[previousIndex] + areaG[b];
          this.momentsB[index] = this.momentsB[previousIndex] + areaB[b];
          this.moments[index] = this.moments[previousIndex] + area2[b];
        }
      }
    }
  }
  createBoxes(maxColors) {
    this.cubes = Array.from({ length: maxColors }).fill(0).map(() => new Box());
    const volumeVariance = Array.from({ length: maxColors }).fill(0);
    this.cubes[0].r0 = 0;
    this.cubes[0].g0 = 0;
    this.cubes[0].b0 = 0;
    this.cubes[0].r1 = SIDE_LENGTH - 1;
    this.cubes[0].g1 = SIDE_LENGTH - 1;
    this.cubes[0].b1 = SIDE_LENGTH - 1;
    let generatedColorCount = maxColors;
    let next = 0;
    for (let i = 1; i < maxColors; i++) {
      if (this.cut(this.cubes[next], this.cubes[i])) {
        volumeVariance[next] = this.cubes[next].vol > 1 ? this.variance(this.cubes[next]) : 0;
        volumeVariance[i] = this.cubes[i].vol > 1 ? this.variance(this.cubes[i]) : 0;
      } else {
        volumeVariance[next] = 0;
        i--;
      }
      next = 0;
      let temp = volumeVariance[0];
      for (let j = 1; j <= i; j++) {
        if (volumeVariance[j] > temp) {
          temp = volumeVariance[j];
          next = j;
        }
      }
      if (temp <= 0) {
        generatedColorCount = i + 1;
        break;
      }
    }
    return new CreateBoxesResult(maxColors, generatedColorCount);
  }
  createResult(colorCount) {
    const colors = [];
    for (let i = 0; i < colorCount; ++i) {
      const cube = this.cubes[i];
      const weight = this.volume(cube, this.weights);
      if (weight > 0) {
        const r = Math.round(this.volume(cube, this.momentsR) / weight);
        const g = Math.round(this.volume(cube, this.momentsG) / weight);
        const b = Math.round(this.volume(cube, this.momentsB) / weight);
        const color = 255 << 24 | (r & 255) << 16 | (g & 255) << 8 | b & 255;
        colors.push(color);
      }
    }
    return colors;
  }
  variance(cube) {
    const dr = this.volume(cube, this.momentsR);
    const dg = this.volume(cube, this.momentsG);
    const db = this.volume(cube, this.momentsB);
    const xx = this.moments[this.getIndex(cube.r1, cube.g1, cube.b1)] - this.moments[this.getIndex(cube.r1, cube.g1, cube.b0)] - this.moments[this.getIndex(cube.r1, cube.g0, cube.b1)] + this.moments[this.getIndex(cube.r1, cube.g0, cube.b0)] - this.moments[this.getIndex(cube.r0, cube.g1, cube.b1)] + this.moments[this.getIndex(cube.r0, cube.g1, cube.b0)] + this.moments[this.getIndex(cube.r0, cube.g0, cube.b1)] - this.moments[this.getIndex(cube.r0, cube.g0, cube.b0)];
    const hypotenuse = dr * dr + dg * dg + db * db;
    const volume = this.volume(cube, this.weights);
    return xx - hypotenuse / volume;
  }
  cut(one, two) {
    const wholeR = this.volume(one, this.momentsR);
    const wholeG = this.volume(one, this.momentsG);
    const wholeB = this.volume(one, this.momentsB);
    const wholeW = this.volume(one, this.weights);
    const maxRResult = this.maximize(one, directions.RED, one.r0 + 1, one.r1, wholeR, wholeG, wholeB, wholeW);
    const maxGResult = this.maximize(one, directions.GREEN, one.g0 + 1, one.g1, wholeR, wholeG, wholeB, wholeW);
    const maxBResult = this.maximize(one, directions.BLUE, one.b0 + 1, one.b1, wholeR, wholeG, wholeB, wholeW);
    let direction;
    const maxR = maxRResult.maximum;
    const maxG = maxGResult.maximum;
    const maxB = maxBResult.maximum;
    if (maxR >= maxG && maxR >= maxB) {
      if (maxRResult.cutLocation < 0) {
        return false;
      }
      direction = directions.RED;
    } else if (maxG >= maxR && maxG >= maxB) {
      direction = directions.GREEN;
    } else {
      direction = directions.BLUE;
    }
    two.r1 = one.r1;
    two.g1 = one.g1;
    two.b1 = one.b1;
    switch (direction) {
      case directions.RED:
        one.r1 = maxRResult.cutLocation;
        two.r0 = one.r1;
        two.g0 = one.g0;
        two.b0 = one.b0;
        break;
      case directions.GREEN:
        one.g1 = maxGResult.cutLocation;
        two.r0 = one.r0;
        two.g0 = one.g1;
        two.b0 = one.b0;
        break;
      case directions.BLUE:
        one.b1 = maxBResult.cutLocation;
        two.r0 = one.r0;
        two.g0 = one.g0;
        two.b0 = one.b1;
        break;
      default:
        throw new Error("unexpected direction " + direction);
    }
    one.vol = (one.r1 - one.r0) * (one.g1 - one.g0) * (one.b1 - one.b0);
    two.vol = (two.r1 - two.r0) * (two.g1 - two.g0) * (two.b1 - two.b0);
    return true;
  }
  maximize(cube, direction, first, last, wholeR, wholeG, wholeB, wholeW) {
    const bottomR = this.bottom(cube, direction, this.momentsR);
    const bottomG = this.bottom(cube, direction, this.momentsG);
    const bottomB = this.bottom(cube, direction, this.momentsB);
    const bottomW = this.bottom(cube, direction, this.weights);
    let max = 0;
    let cut = -1;
    let halfR = 0;
    let halfG = 0;
    let halfB = 0;
    let halfW = 0;
    for (let i = first; i < last; i++) {
      halfR = bottomR + this.top(cube, direction, i, this.momentsR);
      halfG = bottomG + this.top(cube, direction, i, this.momentsG);
      halfB = bottomB + this.top(cube, direction, i, this.momentsB);
      halfW = bottomW + this.top(cube, direction, i, this.weights);
      if (halfW === 0) {
        continue;
      }
      let tempNumerator = (halfR * halfR + halfG * halfG + halfB * halfB) * 1;
      let tempDenominator = halfW * 1;
      let temp = tempNumerator / tempDenominator;
      halfR = wholeR - halfR;
      halfG = wholeG - halfG;
      halfB = wholeB - halfB;
      halfW = wholeW - halfW;
      if (halfW === 0) {
        continue;
      }
      tempNumerator = (halfR * halfR + halfG * halfG + halfB * halfB) * 1;
      tempDenominator = halfW * 1;
      temp += tempNumerator / tempDenominator;
      if (temp > max) {
        max = temp;
        cut = i;
      }
    }
    return new MaximizeResult(cut, max);
  }
  volume(cube, moment) {
    return moment[this.getIndex(cube.r1, cube.g1, cube.b1)] - moment[this.getIndex(cube.r1, cube.g1, cube.b0)] - moment[this.getIndex(cube.r1, cube.g0, cube.b1)] + moment[this.getIndex(cube.r1, cube.g0, cube.b0)] - moment[this.getIndex(cube.r0, cube.g1, cube.b1)] + moment[this.getIndex(cube.r0, cube.g1, cube.b0)] + moment[this.getIndex(cube.r0, cube.g0, cube.b1)] - moment[this.getIndex(cube.r0, cube.g0, cube.b0)];
  }
  bottom(cube, direction, moment) {
    switch (direction) {
      case directions.RED:
        return -moment[this.getIndex(cube.r0, cube.g1, cube.b1)] + moment[this.getIndex(cube.r0, cube.g1, cube.b0)] + moment[this.getIndex(cube.r0, cube.g0, cube.b1)] - moment[this.getIndex(cube.r0, cube.g0, cube.b0)];
      case directions.GREEN:
        return -moment[this.getIndex(cube.r1, cube.g0, cube.b1)] + moment[this.getIndex(cube.r1, cube.g0, cube.b0)] + moment[this.getIndex(cube.r0, cube.g0, cube.b1)] - moment[this.getIndex(cube.r0, cube.g0, cube.b0)];
      case directions.BLUE:
        return -moment[this.getIndex(cube.r1, cube.g1, cube.b0)] + moment[this.getIndex(cube.r1, cube.g0, cube.b0)] + moment[this.getIndex(cube.r0, cube.g1, cube.b0)] - moment[this.getIndex(cube.r0, cube.g0, cube.b0)];
      default:
        throw new Error("unexpected direction $direction");
    }
  }
  top(cube, direction, position, moment) {
    switch (direction) {
      case directions.RED:
        return moment[this.getIndex(position, cube.g1, cube.b1)] - moment[this.getIndex(position, cube.g1, cube.b0)] - moment[this.getIndex(position, cube.g0, cube.b1)] + moment[this.getIndex(position, cube.g0, cube.b0)];
      case directions.GREEN:
        return moment[this.getIndex(cube.r1, position, cube.b1)] - moment[this.getIndex(cube.r1, position, cube.b0)] - moment[this.getIndex(cube.r0, position, cube.b1)] + moment[this.getIndex(cube.r0, position, cube.b0)];
      case directions.BLUE:
        return moment[this.getIndex(cube.r1, cube.g1, position)] - moment[this.getIndex(cube.r1, cube.g0, position)] - moment[this.getIndex(cube.r0, cube.g1, position)] + moment[this.getIndex(cube.r0, cube.g0, position)];
      default:
        throw new Error("unexpected direction $direction");
    }
  }
  getIndex(r, g, b) {
    return (r << INDEX_BITS * 2) + (r << INDEX_BITS + 1) + r + (g << INDEX_BITS) + g + b;
  }
};
var Box = class {
  constructor(r0 = 0, r1 = 0, g0 = 0, g1 = 0, b0 = 0, b1 = 0, vol = 0) {
    this.r0 = r0;
    this.r1 = r1;
    this.g0 = g0;
    this.g1 = g1;
    this.b0 = b0;
    this.b1 = b1;
    this.vol = vol;
  }
};
var CreateBoxesResult = class {
  /**
   * @param requestedCount how many colors the caller asked to be returned from
   *     quantization.
   * @param resultCount the actual number of colors achieved from quantization.
   *     May be lower than the requested count.
   */
  constructor(requestedCount, resultCount) {
    this.requestedCount = requestedCount;
    this.resultCount = resultCount;
  }
};
var MaximizeResult = class {
  constructor(cutLocation, maximum) {
    this.cutLocation = cutLocation;
    this.maximum = maximum;
  }
};

// node_modules/@material/material-color-utilities/quantize/quantizer_celebi.js
/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
var QuantizerCelebi = class {
  /**
   * @param pixels Colors in ARGB format.
   * @param maxColors The number of colors to divide the image into. A lower
   *     number of colors may be returned.
   * @return Map with keys of colors in ARGB format, and values of number of
   *     pixels in the original image that correspond to the color in the
   *     quantized image.
   */
  static quantize(pixels, maxColors) {
    const wu = new QuantizerWu();
    const wuResult = wu.quantize(pixels, maxColors);
    return QuantizerWsmeans.quantize(pixels, wuResult, maxColors);
  }
};

// node_modules/@material/material-color-utilities/scheme/scheme.js
/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
var Scheme = class _Scheme {
  get primary() {
    return this.props.primary;
  }
  get onPrimary() {
    return this.props.onPrimary;
  }
  get primaryContainer() {
    return this.props.primaryContainer;
  }
  get onPrimaryContainer() {
    return this.props.onPrimaryContainer;
  }
  get secondary() {
    return this.props.secondary;
  }
  get onSecondary() {
    return this.props.onSecondary;
  }
  get secondaryContainer() {
    return this.props.secondaryContainer;
  }
  get onSecondaryContainer() {
    return this.props.onSecondaryContainer;
  }
  get tertiary() {
    return this.props.tertiary;
  }
  get onTertiary() {
    return this.props.onTertiary;
  }
  get tertiaryContainer() {
    return this.props.tertiaryContainer;
  }
  get onTertiaryContainer() {
    return this.props.onTertiaryContainer;
  }
  get error() {
    return this.props.error;
  }
  get onError() {
    return this.props.onError;
  }
  get errorContainer() {
    return this.props.errorContainer;
  }
  get onErrorContainer() {
    return this.props.onErrorContainer;
  }
  get background() {
    return this.props.background;
  }
  get onBackground() {
    return this.props.onBackground;
  }
  get surface() {
    return this.props.surface;
  }
  get onSurface() {
    return this.props.onSurface;
  }
  get surfaceVariant() {
    return this.props.surfaceVariant;
  }
  get onSurfaceVariant() {
    return this.props.onSurfaceVariant;
  }
  get outline() {
    return this.props.outline;
  }
  get outlineVariant() {
    return this.props.outlineVariant;
  }
  get shadow() {
    return this.props.shadow;
  }
  get scrim() {
    return this.props.scrim;
  }
  get inverseSurface() {
    return this.props.inverseSurface;
  }
  get inverseOnSurface() {
    return this.props.inverseOnSurface;
  }
  get inversePrimary() {
    return this.props.inversePrimary;
  }
  /**
   * @param argb ARGB representation of a color.
   * @return Light Material color scheme, based on the color's hue.
   */
  static light(argb) {
    return _Scheme.lightFromCorePalette(CorePalette.of(argb));
  }
  /**
   * @param argb ARGB representation of a color.
   * @return Dark Material color scheme, based on the color's hue.
   */
  static dark(argb) {
    return _Scheme.darkFromCorePalette(CorePalette.of(argb));
  }
  /**
   * @param argb ARGB representation of a color.
   * @return Light Material content color scheme, based on the color's hue.
   */
  static lightContent(argb) {
    return _Scheme.lightFromCorePalette(CorePalette.contentOf(argb));
  }
  /**
   * @param argb ARGB representation of a color.
   * @return Dark Material content color scheme, based on the color's hue.
   */
  static darkContent(argb) {
    return _Scheme.darkFromCorePalette(CorePalette.contentOf(argb));
  }
  /**
   * Light scheme from core palette
   */
  static lightFromCorePalette(core) {
    return new _Scheme({
      primary: core.a1.tone(40),
      onPrimary: core.a1.tone(100),
      primaryContainer: core.a1.tone(90),
      onPrimaryContainer: core.a1.tone(10),
      secondary: core.a2.tone(40),
      onSecondary: core.a2.tone(100),
      secondaryContainer: core.a2.tone(90),
      onSecondaryContainer: core.a2.tone(10),
      tertiary: core.a3.tone(40),
      onTertiary: core.a3.tone(100),
      tertiaryContainer: core.a3.tone(90),
      onTertiaryContainer: core.a3.tone(10),
      error: core.error.tone(40),
      onError: core.error.tone(100),
      errorContainer: core.error.tone(90),
      onErrorContainer: core.error.tone(10),
      background: core.n1.tone(99),
      onBackground: core.n1.tone(10),
      surface: core.n1.tone(99),
      onSurface: core.n1.tone(10),
      surfaceVariant: core.n2.tone(90),
      onSurfaceVariant: core.n2.tone(30),
      outline: core.n2.tone(50),
      outlineVariant: core.n2.tone(80),
      shadow: core.n1.tone(0),
      scrim: core.n1.tone(0),
      inverseSurface: core.n1.tone(20),
      inverseOnSurface: core.n1.tone(95),
      inversePrimary: core.a1.tone(80)
    });
  }
  /**
   * Dark scheme from core palette
   */
  static darkFromCorePalette(core) {
    return new _Scheme({
      primary: core.a1.tone(80),
      onPrimary: core.a1.tone(20),
      primaryContainer: core.a1.tone(30),
      onPrimaryContainer: core.a1.tone(90),
      secondary: core.a2.tone(80),
      onSecondary: core.a2.tone(20),
      secondaryContainer: core.a2.tone(30),
      onSecondaryContainer: core.a2.tone(90),
      tertiary: core.a3.tone(80),
      onTertiary: core.a3.tone(20),
      tertiaryContainer: core.a3.tone(30),
      onTertiaryContainer: core.a3.tone(90),
      error: core.error.tone(80),
      onError: core.error.tone(20),
      errorContainer: core.error.tone(30),
      onErrorContainer: core.error.tone(80),
      background: core.n1.tone(10),
      onBackground: core.n1.tone(90),
      surface: core.n1.tone(10),
      onSurface: core.n1.tone(90),
      surfaceVariant: core.n2.tone(30),
      onSurfaceVariant: core.n2.tone(80),
      outline: core.n2.tone(60),
      outlineVariant: core.n2.tone(30),
      shadow: core.n1.tone(0),
      scrim: core.n1.tone(0),
      inverseSurface: core.n1.tone(90),
      inverseOnSurface: core.n1.tone(20),
      inversePrimary: core.a1.tone(40)
    });
  }
  constructor(props) {
    this.props = props;
  }
  toJSON() {
    return {
      ...this.props
    };
  }
};

// node_modules/@material/material-color-utilities/scheme/scheme_android.js
/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// node_modules/@material/material-color-utilities/temperature/temperature_cache.js
/**
 * @license
 * Copyright 2023 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// node_modules/@material/material-color-utilities/scheme/scheme_content.js
/**
 * @license
 * Copyright 2023 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// node_modules/@material/material-color-utilities/scheme/scheme_expressive.js
/**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
var SchemeExpressive = class _SchemeExpressive extends DynamicScheme {
  constructor(sourceColorHct, isDark, contrastLevel) {
    super({
      sourceColorArgb: sourceColorHct.toInt(),
      variant: Variant.EXPRESSIVE,
      contrastLevel,
      isDark,
      primaryPalette: TonalPalette.fromHueAndChroma(sanitizeDegreesDouble(sourceColorHct.hue + 240), 40),
      secondaryPalette: TonalPalette.fromHueAndChroma(DynamicScheme.getRotatedHue(sourceColorHct, _SchemeExpressive.hues, _SchemeExpressive.secondaryRotations), 24),
      tertiaryPalette: TonalPalette.fromHueAndChroma(DynamicScheme.getRotatedHue(sourceColorHct, _SchemeExpressive.hues, _SchemeExpressive.tertiaryRotations), 32),
      neutralPalette: TonalPalette.fromHueAndChroma(sourceColorHct.hue + 15, 8),
      neutralVariantPalette: TonalPalette.fromHueAndChroma(sourceColorHct.hue + 15, 12)
    });
  }
};
SchemeExpressive.hues = [
  0,
  21,
  51,
  121,
  151,
  191,
  271,
  321,
  360
];
SchemeExpressive.secondaryRotations = [
  45,
  95,
  45,
  20,
  45,
  90,
  45,
  45,
  45
];
SchemeExpressive.tertiaryRotations = [
  120,
  120,
  20,
  45,
  20,
  15,
  20,
  120,
  120
];

// node_modules/@material/material-color-utilities/scheme/scheme_fidelity.js
/**
 * @license
 * Copyright 2023 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// node_modules/@material/material-color-utilities/scheme/scheme_fruit_salad.js
/**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// node_modules/@material/material-color-utilities/scheme/scheme_monochrome.js
/**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// node_modules/@material/material-color-utilities/scheme/scheme_neutral.js
/**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// node_modules/@material/material-color-utilities/scheme/scheme_rainbow.js
/**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// node_modules/@material/material-color-utilities/scheme/scheme_tonal_spot.js
/**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// node_modules/@material/material-color-utilities/scheme/scheme_vibrant.js
/**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
var SchemeVibrant = class _SchemeVibrant extends DynamicScheme {
  constructor(sourceColorHct, isDark, contrastLevel) {
    super({
      sourceColorArgb: sourceColorHct.toInt(),
      variant: Variant.VIBRANT,
      contrastLevel,
      isDark,
      primaryPalette: TonalPalette.fromHueAndChroma(sourceColorHct.hue, 200),
      secondaryPalette: TonalPalette.fromHueAndChroma(DynamicScheme.getRotatedHue(sourceColorHct, _SchemeVibrant.hues, _SchemeVibrant.secondaryRotations), 24),
      tertiaryPalette: TonalPalette.fromHueAndChroma(DynamicScheme.getRotatedHue(sourceColorHct, _SchemeVibrant.hues, _SchemeVibrant.tertiaryRotations), 32),
      neutralPalette: TonalPalette.fromHueAndChroma(sourceColorHct.hue, 10),
      neutralVariantPalette: TonalPalette.fromHueAndChroma(sourceColorHct.hue, 12)
    });
  }
};
SchemeVibrant.hues = [
  0,
  41,
  61,
  101,
  131,
  181,
  251,
  301,
  360
];
SchemeVibrant.secondaryRotations = [
  18,
  15,
  10,
  12,
  15,
  18,
  15,
  12,
  12
];
SchemeVibrant.tertiaryRotations = [
  35,
  30,
  20,
  25,
  30,
  35,
  30,
  25,
  25
];

// node_modules/@material/material-color-utilities/score/score.js
/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
var SCORE_OPTION_DEFAULTS = {
  desired: 4,
  fallbackColorARGB: 4282549748,
  filter: true
  // Avoid unsuitable colors.
};
function compare(a, b) {
  if (a.score > b.score) {
    return -1;
  } else if (a.score < b.score) {
    return 1;
  }
  return 0;
}
var Score = class _Score {
  constructor() {
  }
  /**
   * Given a map with keys of colors and values of how often the color appears,
   * rank the colors based on suitability for being used for a UI theme.
   *
   * @param colorsToPopulation map with keys of colors and values of how often
   *     the color appears, usually from a source image.
   * @param {ScoreOptions} options optional parameters.
   * @return Colors sorted by suitability for a UI theme. The most suitable
   *     color is the first item, the least suitable is the last. There will
   *     always be at least one color returned. If all the input colors
   *     were not suitable for a theme, a default fallback color will be
   *     provided, Google Blue.
   */
  static score(colorsToPopulation, options) {
    const { desired, fallbackColorARGB, filter } = { ...SCORE_OPTION_DEFAULTS, ...options };
    const colorsHct = [];
    const huePopulation = new Array(360).fill(0);
    let populationSum = 0;
    for (const [argb, population] of colorsToPopulation.entries()) {
      const hct = Hct.fromInt(argb);
      colorsHct.push(hct);
      const hue = Math.floor(hct.hue);
      huePopulation[hue] += population;
      populationSum += population;
    }
    const hueExcitedProportions = new Array(360).fill(0);
    for (let hue = 0; hue < 360; hue++) {
      const proportion = huePopulation[hue] / populationSum;
      for (let i = hue - 14; i < hue + 16; i++) {
        const neighborHue = sanitizeDegreesInt(i);
        hueExcitedProportions[neighborHue] += proportion;
      }
    }
    const scoredHct = new Array();
    for (const hct of colorsHct) {
      const hue = sanitizeDegreesInt(Math.round(hct.hue));
      const proportion = hueExcitedProportions[hue];
      if (filter && (hct.chroma < _Score.CUTOFF_CHROMA || proportion <= _Score.CUTOFF_EXCITED_PROPORTION)) {
        continue;
      }
      const proportionScore = proportion * 100 * _Score.WEIGHT_PROPORTION;
      const chromaWeight = hct.chroma < _Score.TARGET_CHROMA ? _Score.WEIGHT_CHROMA_BELOW : _Score.WEIGHT_CHROMA_ABOVE;
      const chromaScore = (hct.chroma - _Score.TARGET_CHROMA) * chromaWeight;
      const score = proportionScore + chromaScore;
      scoredHct.push({ hct, score });
    }
    scoredHct.sort(compare);
    const chosenColors = [];
    for (let differenceDegrees2 = 90; differenceDegrees2 >= 15; differenceDegrees2--) {
      chosenColors.length = 0;
      for (const { hct } of scoredHct) {
        const duplicateHue = chosenColors.find((chosenHct) => {
          return differenceDegrees(hct.hue, chosenHct.hue) < differenceDegrees2;
        });
        if (!duplicateHue) {
          chosenColors.push(hct);
        }
        if (chosenColors.length >= desired)
          break;
      }
      if (chosenColors.length >= desired)
        break;
    }
    const colors = [];
    if (chosenColors.length === 0) {
      colors.push(fallbackColorARGB);
    }
    for (const chosenHct of chosenColors) {
      colors.push(chosenHct.toInt());
    }
    return colors;
  }
};
Score.TARGET_CHROMA = 48;
Score.WEIGHT_PROPORTION = 0.7;
Score.WEIGHT_CHROMA_ABOVE = 0.3;
Score.WEIGHT_CHROMA_BELOW = 0.1;
Score.CUTOFF_CHROMA = 5;
Score.CUTOFF_EXCITED_PROPORTION = 0.01;

// node_modules/@material/material-color-utilities/utils/string_utils.js
/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// node_modules/@material/material-color-utilities/utils/image_utils.js
/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// node_modules/@material/material-color-utilities/utils/theme_utils.js
/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
function themeFromSourceColor(source, customColors = []) {
  const palette = CorePalette.of(source);
  return {
    source,
    schemes: {
      light: Scheme.light(source),
      dark: Scheme.dark(source)
    },
    palettes: {
      primary: palette.a1,
      secondary: palette.a2,
      tertiary: palette.a3,
      neutral: palette.n1,
      neutralVariant: palette.n2,
      error: palette.error
    },
    customColors: customColors.map((c) => customColor(source, c))
  };
}
function customColor(source, color) {
  let value = color.value;
  const from = value;
  const to = source;
  if (color.blend) {
    value = Blend.harmonize(from, to);
  }
  const palette = CorePalette.of(value);
  const tones = palette.a1;
  return {
    color,
    value,
    light: {
      color: tones.tone(40),
      onColor: tones.tone(100),
      colorContainer: tones.tone(90),
      onColorContainer: tones.tone(10)
    },
    dark: {
      color: tones.tone(80),
      onColor: tones.tone(20),
      colorContainer: tones.tone(30),
      onColorContainer: tones.tone(90)
    }
  };
}

// node_modules/@material/material-color-utilities/index.js
/**
 * @license
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// dist/core/video-theme.js
var execFileAsync = promisify(execFile);
var FFMPEG_CANDIDATES = [
  process.env.FFMPEG_PATH,
  "ffmpeg",
  "D:/.codex/tools/ffmpeg/ffmpeg-n9.0.1-11-ge47273f4d9-win64-gpl-9.0/bin/ffmpeg.exe",
  "C:/ffmpeg/bin/ffmpeg.exe"
].filter(Boolean);
var ffmpegCache = null;
async function findFfmpeg() {
  if (ffmpegCache !== null)
    return ffmpegCache ?? void 0;
  for (const candidate of FFMPEG_CANDIDATES) {
    const isPath = !candidate.includes("/") && !candidate.includes("\\");
    const exe = isPath ? candidate : candidate;
    try {
      await execFileAsync(exe, ["-version"], { timeout: 8e3, windowsHide: true });
      const ffprobe = exe.replace(/ffmpeg(\.exe)?$/i, "ffprobe$1");
      const ffprobePath = ffprobe === exe ? "ffprobe" : ffprobe;
      try {
        await execFileAsync(ffprobePath, ["-version"], { timeout: 8e3, windowsHide: true });
      } catch {
        ffmpegCache = { path: exe, ffprobePath: "ffprobe" };
        return ffmpegCache;
      }
      ffmpegCache = { path: exe, ffprobePath };
      return ffmpegCache;
    } catch {
    }
  }
  ffmpegCache = void 0;
  return void 0;
}
async function probeDuration(ffprobePath, mediaPath) {
  try {
    const { stdout } = await execFileAsync(ffprobePath, [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "format=duration",
      "-of",
      "default=nw=1:nk=1",
      mediaPath
    ], { timeout: 15e3, windowsHide: true });
    const value = Number(stdout.trim());
    return Number.isFinite(value) && value > 0 ? value : void 0;
  } catch {
    return void 0;
  }
}
async function grabFrameRaw(ffmpegPath, mediaPath, at, width = 96, height = 54) {
  const tmp = path3.join(os2.tmpdir(), `zcode-livewall-${process.pid}-${Math.random().toString(36).slice(2)}.raw`);
  try {
    const seek = at > 0 ? ["-ss", at.toFixed(3)] : [];
    await execFileAsync(ffmpegPath, [
      "-v",
      "error",
      ...seek,
      "-i",
      mediaPath,
      "-frames:v",
      "1",
      "-vf",
      `scale=${width}:${height}`,
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      tmp,
      "-y"
    ], { timeout: 2e4, windowsHide: true });
    const buf = fs3.readFileSync(tmp);
    return buf.length >= width * height * 3 ? buf.subarray(0, width * height * 3) : void 0;
  } catch {
    return void 0;
  } finally {
    try {
      fs3.rmSync(tmp, { force: true });
    } catch {
    }
  }
}
async function grabPosterJpeg(ffmpegPath, mediaPath, at, maxWidth = 1920, quality = 4) {
  const tmp = path3.join(os2.tmpdir(), `zcode-livewall-poster-${process.pid}-${Math.random().toString(36).slice(2)}.jpg`);
  try {
    const seek = at > 0 ? ["-ss", at.toFixed(3)] : [];
    await execFileAsync(ffmpegPath, [
      "-v",
      "error",
      ...seek,
      "-i",
      mediaPath,
      "-frames:v",
      "1",
      "-vf",
      `scale='min(${maxWidth},iw)':-2`,
      "-q:v",
      String(quality),
      tmp,
      "-y"
    ], { timeout: 3e4, windowsHide: true });
    const buf = fs3.readFileSync(tmp);
    return buf.length > 0 ? buf : void 0;
  } catch {
    return void 0;
  } finally {
    try {
      fs3.rmSync(tmp, { force: true });
    } catch {
    }
  }
}
function paletteFromRaw(raw) {
  const pixels = [];
  for (let i = 0; i + 2 < raw.length; i += 3) {
    pixels.push(argbFromRgb(raw[i], raw[i + 1], raw[i + 2]));
  }
  if (pixels.length === 0)
    return [];
  return Score.score(QuantizerCelebi.quantize(pixels, 48));
}
async function themeFromVideo(mediaPath) {
  const ff = await findFfmpeg();
  if (!ff)
    return void 0;
  const duration = await probeDuration(ff.ffprobePath, mediaPath);
  const points = duration ? [0.12, 0.3, 0.5, 0.7, 0.88].map((f) => Math.max(0.5, duration * f)) : [1, 3, 6, 10];
  const scores = /* @__PURE__ */ new Map();
  const frames = [];
  for (const at of points) {
    const raw = await grabFrameRaw(ff.path, mediaPath, at);
    if (!raw)
      continue;
    frames.push(raw);
    const ranked = paletteFromRaw(raw);
    ranked.slice(0, 6).forEach((argb, rank) => {
      scores.set(argb, (scores.get(argb) ?? 0) + (6 - rank));
    });
  }
  let best = [...scores.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (best === void 0) {
    best = argbFromRgb(103, 80, 164);
  }
  const posterAt = points[Math.floor(points.length / 2)] ?? 1;
  const posterJpeg = await grabPosterJpeg(ff.path, mediaPath, posterAt);
  return {
    sourceArgb: best,
    theme: themeFromSourceColor(best),
    posterJpeg,
    posterAt,
    duration
  };
}
async function themeFromImage(imagePath) {
  const ff = await findFfmpeg();
  if (!ff)
    return void 0;
  const raw = await grabFrameRaw(ff.path, imagePath, 0, 128, 128);
  if (!raw)
    return void 0;
  const ranked = paletteFromRaw(raw);
  const sourceArgb = ranked[0] ?? argbFromRgb(103, 80, 164);
  return {
    sourceArgb,
    theme: themeFromSourceColor(sourceArgb),
    posterJpeg: void 0,
    posterAt: 0,
    duration: void 0
  };
}
function argbToCss(argb, alpha = 1) {
  const r = (argb & 16711680) >> 16;
  const g = (argb & 65280) >> 8;
  const b = argb & 255;
  return alpha >= 1 ? `#${toHex(r)}${toHex(g)}${toHex(b)}` : `rgba(${r}, ${g}, ${b}, ${round2(alpha)})`;
}
function toHex(v) {
  return v.toString(16).padStart(2, "0");
}
function round2(v) {
  return Math.round(v * 100) / 100;
}

// dist/core/tokens.js
var LIGHT_SURFACE_TONES = { lowest: 100, low: 96, container: 94, high: 92, highest: 90 };
var DARK_SURFACE_TONES = { lowest: 4, low: 10, container: 12, high: 17, highest: 22 };
function buildVariableOverrides(theme, opts) {
  return `:root,:host{${tokenRows(theme, "light", opts).join("")}}
.dark{${tokenRows(theme, "dark", opts).join("")}}`;
}
function buildTransparencyOverrides(opts) {
  return `:root,:host{${transparencyRows("light", opts).join("")}}
.dark{${transparencyRows("dark", opts).join("")}}`;
}
var LIGHT_SCRIM = "255,255,255";
var DARK_SCRIM = "18,18,22";
function transparencyRows(mode, opts) {
  const rgb = mode === "light" ? LIGHT_SCRIM : DARK_SCRIM;
  const baseAlpha = 0.72;
  const panelAlpha = 0.62;
  const inputAlpha = 0.5;
  const popoverAlpha = 0.92;
  return [
    `--color-background:transparent;`,
    `--color-background-alt:rgba(${rgb},${panelAlpha});`,
    `--color-background-win-alt:rgba(${rgb},${panelAlpha});`,
    `--color-panel:rgba(${rgb},${panelAlpha});`,
    `--color-sidebar:rgba(${rgb},${panelAlpha});`,
    `--color-surface:rgba(${rgb},${baseAlpha});`,
    `--color-surface-hover:rgba(${rgb},${baseAlpha});`,
    `--color-card:rgba(${rgb},${baseAlpha});`,
    `--color-card-selected:rgba(${rgb},${Math.min(1, baseAlpha + 0.15)});`,
    `--color-popover:rgba(${rgb},${popoverAlpha});`,
    `--color-input:rgba(${rgb},${inputAlpha});`,
    `--color-input-focused:rgba(${rgb},${Math.min(1, inputAlpha + 0.2)});`,
    opts.dim > 0 ? `--zcode-livewall-dim:${opts.dim / 100};` : ""
  ].filter(Boolean);
}
function tokenRows(theme, mode, opts) {
  const s = mode === "light" ? theme.schemes.light : theme.schemes.dark;
  const t = mode === "light" ? LIGHT_SURFACE_TONES : DARK_SURFACE_TONES;
  const n = theme.palettes.neutral;
  const A = (argb, alpha = 1) => argbToCss(argb, alpha);
  const baseAlpha = opts.wallpaperVisible ? 0.72 : 1;
  const panelAlpha = opts.wallpaperVisible ? 0.62 : 1;
  const inputAlpha = opts.wallpaperVisible ? 0.5 : 1;
  const popoverAlpha = opts.wallpaperVisible ? 0.92 : 1;
  return [
    `--color-background:transparent;`,
    `--color-background-alt:${A(n.tone(t.high), panelAlpha)};`,
    `--color-background-win-alt:${A(n.tone(t.low), panelAlpha)};`,
    `--color-panel:${A(n.tone(t.low), panelAlpha)};`,
    `--color-sidebar:${A(n.tone(t.low), panelAlpha)};`,
    `--color-surface:${A(n.tone(t.lowest === 100 ? 98 : 6), baseAlpha)};`,
    `--color-surface-hover:${A(n.tone(t.high), baseAlpha)};`,
    `--color-card:${A(n.tone(t.container), baseAlpha)};`,
    `--color-card-selected:${A(n.tone(t.highest), Math.min(1, baseAlpha + 0.15))};`,
    `--color-card-border:${A(s.outlineVariant, 0.5)};`,
    `--color-popover:${A(n.tone(t.container), popoverAlpha)};`,
    `--color-input:${A(n.tone(t.highest), inputAlpha)};`,
    `--color-input-focused:${A(n.tone(t.highest), Math.min(1, inputAlpha + 0.2))};`,
    `--color-input-border:${A(s.outlineVariant, 0.6)};`,
    `--color-input-border-hover:${A(s.outline, 0.7)};`,
    `--color-input-border-focused:${A(s.primary, 0.9)};`,
    `--color-foreground:${A(s.onSurface)};`,
    `--color-foreground-subtle:${A(s.onSurfaceVariant)};`,
    `--color-foreground-subtlest:${A(s.onSurfaceVariant, 0.72)};`,
    `--color-foreground-inverse:${A(s.inverseOnSurface)};`,
    `--color-primary:${A(s.primary)};`,
    `--color-primary-foreground:${A(s.onPrimary)};`,
    `--color-secondary:${A(s.secondaryContainer)};`,
    `--color-accent:${A(s.tertiary)};`,
    `--color-brand:${A(s.primary)};`,
    `--color-border:${A(s.outlineVariant, 0.55)};`,
    `--color-border-hover:${A(s.outlineVariant, 0.9)};`,
    `--color-border-color-interactive:${A(s.outlineVariant, 0.7)};`,
    `--color-border-color-interactive-hover:${A(s.outlineVariant, 1)};`,
    `--color-border-color-interactive-active:${A(s.primary, 0.9)};`,
    `--color-find-highlight:${A(s.tertiaryContainer)};`,
    `--color-find-highlight-active:${A(s.secondaryContainer)};`,
    `--divider-color:${A(s.outlineVariant, 0.4)};`,
    opts.dim > 0 ? `--zcode-livewall-dim:${opts.dim / 100};` : ""
  ].filter(Boolean);
}

// dist/core/payload.js
var MARKER = "zcode-livewall";
function layerCss(config) {
  const blurScale = config.blur > 0 && config.fit !== "contain" ? 1 + Math.min(0.08, config.blur / 500) : 1;
  return `
html, body { background: transparent !important; }
#${MARKER}-stage {
  position: fixed;
  inset: 0;
  z-index: -2147483646;
  overflow: hidden;
  pointer-events: none;
  background: #0b0b10;
}
#${MARKER}-video, #${MARKER}-poster, #${MARKER}-web {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: ${config.fit};
  object-position: center;
  pointer-events: none;
  border: 0;
}
/* contain: the media is sized by the injected script, which knows
   the intrinsic dimensions and the stage size. CSS alone cannot do this well:
   object-fit only rearranges content inside a full-size box, and auto sizing
   never scales UP (a 248px GIF stays 248px in a 1150px window).
   The script sets width/height in px on the media elements. */
#${MARKER}-stage[data-fit="contain"] #${MARKER}-video,
#${MARKER}-stage[data-fit="contain"] #${MARKER}-poster {
  inset: 0;
  margin: auto;
  object-fit: contain;
}
/* Explicit stacking. The backdrop is appended after the media layers, so
   without this it paints on top of them and the whole wallpaper reads as a
   blurred smear in contain mode. */
#${MARKER}-backdrop { z-index: 0; }
#${MARKER}-video, #${MARKER}-poster, #${MARKER}-web { z-index: 1; }
#${MARKER}-dim { z-index: 2; }
#${MARKER}-video, #${MARKER}-poster, #${MARKER}-web {
  filter: blur(${config.blur}px);
  transition: opacity .25s ease, filter .25s ease;
}
#${MARKER}-video, #${MARKER}-poster {
  transform: scale(${blurScale});
  opacity: ${config.wallpaperVisible ? 1 : 0};
}
/* While the video is still buffering its first frame the poster (a real
   thumbnail of the same source) shows through underneath; once the video is
   actually drawing, the poster fades out so there is no black startup gap. */
/* While the video is still buffering its first frame the poster (a real
   thumbnail of the same source) shows through underneath; once the video is
   actually drawing, the poster fades out so there is no black startup gap.
   The [data-video] guard keeps a stale ready flag from hiding the poster on
   image wallpapers, where there is no video to take over the frame. */
#${MARKER}-stage[data-vready="1"][data-video="1"] #${MARKER}-poster { opacity: 0; }
#${MARKER}-backdrop {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  /* Dimmer than the sharp image so the letterbox bars read as ambient fill
     rather than competing with the picture in the middle. Tracks the user's
     blur (plus a floor) so slider-at-zero also clears the bars. */
  filter: blur(${config.blur + 12}px) saturate(1.1) brightness(.55);
  transform: scale(1.15);
  display: none;
}
#${MARKER}-backdrop[data-on="1"] { display: block; }
#${MARKER}-stage[data-hidden="1"] { display: none; }
#${MARKER}-dim {
  position: absolute;
  inset: 0;
  background: rgb(0 0 0 / var(--zcode-livewall-dim, ${config.dim / 100}));
  pointer-events: none;
}}`;
}
function buildPayload(input) {
  const { config, theme } = input;
  const parts = [layerCss(config)];
  if (theme) {
    if (config.monet) {
      parts.push(buildVariableOverrides(theme, {
        dim: config.dim,
        wallpaperVisible: config.wallpaperVisible
      }));
    } else if (config.wallpaperVisible) {
      parts.push(buildTransparencyOverrides({ dim: config.dim }));
    }
  }
  const css = parts.join("\n");
  return { css, script: buildBootstrapScript(input, css) };
}
function buildBootstrapScript(input, css) {
  const { config, videoUrl, posterUrl, webUrl } = input;
  const showVideo = Boolean(videoUrl) && config.wallpaperVisible;
  const showWeb = Boolean(webUrl) && config.wallpaperVisible;
  const showPoster = Boolean(posterUrl) && config.wallpaperVisible;
  const visible = config.wallpaperVisible && Boolean(videoUrl || webUrl || posterUrl);
  return `(function boot(){
  // addScriptToEvaluateOnNewDocument fires before the document has a root
  // element; appending then throws and the layer never installs.
  if (!document.documentElement) { setTimeout(boot, 30); return; }
  var MARKER = ${JSON.stringify(MARKER)};
  var STAGE = MARKER + '-stage';
  var VIDEO_URL = ${JSON.stringify(videoUrl ?? "")};
  var POSTER_URL = ${JSON.stringify(posterUrl ?? "")};
  var WEB_URL = ${JSON.stringify(webUrl ?? "")};
  var FIT = ${JSON.stringify(config.fit)};
  var SPEED = ${config.speed};
  var PAUSED = ${config.paused ? "true" : "false"};
  var PAUSE_ON_BLUR = ${config.pauseOnBlur ? "true" : "false"};
  var VISIBLE = ${visible ? "true" : "false"};
  var SHOW_VIDEO = ${showVideo ? "true" : "false"};
  var SHOW_WEB = ${showWeb ? "true" : "false"};
  var SHOW_POSTER = ${showPoster ? "true" : "false"};
  var DIM = ${config.dim / 100};
  var CSS = ${JSON.stringify(css)};

  var state = window.__zcodeLivewall || (window.__zcodeLivewall = {});
  state.config = { videoUrl: VIDEO_URL, posterUrl: POSTER_URL, webUrl: WEB_URL, fit: FIT, speed: SPEED, paused: PAUSED, pauseOnBlur: PAUSE_ON_BLUR, visible: VISIBLE };

  // --- stylesheet ----------------------------------------------------------
  var style = document.getElementById(MARKER + '-style');
  if (!style) {
    style = document.createElement('style');
    style.id = MARKER + '-style';
    (document.head || document.documentElement).appendChild(style);
  }
  if (style.textContent !== CSS) style.textContent = CSS;

  // The panel's live preview sets blur/transform inline on the media layers,
  // and inline styles beat this stylesheet forever. Every re-injection is the
  // authority: drop those properties so the shipped CSS is what renders.
  ['${MARKER}-video', '${MARKER}-poster', '${MARKER}-web'].forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.style.removeProperty('filter');
    el.style.removeProperty('transform');
  });
  var bd = document.getElementById('${MARKER}-backdrop');
  if (bd) bd.style.removeProperty('filter');

  // --- stage ---------------------------------------------------------------
  var stage = document.getElementById(STAGE);
  if (!stage) {
    stage = document.createElement('div');
    stage.id = STAGE;
    document.documentElement.appendChild(stage);
  }
  stage.dataset.fit = FIT;
  stage.dataset.hidden = VISIBLE ? '0' : '1';
  // Marks that a video layer is the active frame owner; the poster fade-out
  // rule keys off this so it can never hide an image wallpaper.
  stage.dataset.video = SHOW_VIDEO ? '1' : '0';

  // --- blurred backdrop for letterboxed framing ----------------------------
  var backdrop = document.getElementById(MARKER + '-backdrop');
  var backdropSrc = POSTER_URL || VIDEO_URL;
  var wantsBackdrop = FIT === 'contain' && backdropSrc;
  if (wantsBackdrop) {
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = MARKER + '-backdrop';
      stage.appendChild(backdrop);
    }
    if (backdrop.dataset.src !== backdropSrc) {
      backdrop.style.backgroundImage = 'url("' + backdropSrc + '")';
      backdrop.dataset.src = backdropSrc;
    }
    backdrop.dataset.on = '1';
  } else if (backdrop) {
    backdrop.dataset.on = '0';
  }

  // --- poster still --------------------------------------------------------
  var poster = document.getElementById(MARKER + '-poster');
  if (SHOW_POSTER) {
    if (!poster) {
      poster = document.createElement('img');
      poster.id = MARKER + '-poster';
      poster.alt = '';
      poster.decoding = 'async';
      stage.appendChild(poster);
    }
    if (poster.getAttribute('src') !== POSTER_URL) {
      // Intrinsic size is only known after decode, so sizing waits for load.
      // One listener per element instance: re-evaluating the boot script on a
      // live poster used to accumulate a listener every push.
      if (state.loadHooked !== poster) {
        state.loadHooked = poster;
        poster.addEventListener('load', function () {
          if (state.applyMediaSizing) state.applyMediaSizing();
        });
      }
      poster.src = POSTER_URL;
    } else if (poster.naturalWidth && poster.naturalHeight && state.applyMediaSizing) {
      state.applyMediaSizing();
    }
    // The poster stays visible under the video until the first frame draws
    // (see the vready wiring below): a black startup gap reads as a hang.
    poster.style.display = 'block';
  } else if (poster) {
    poster.style.display = 'none';
  }

  // --- video layer ---------------------------------------------------------
  var video = document.getElementById(MARKER + '-video');
  if (SHOW_VIDEO) {
    if (!video) {
      video = document.createElement('video');
      video.id = MARKER + '-video';
      video.muted = true;
      video.loop = true;
      video.autoplay = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.disablePictureInPicture = true;
      video.setAttribute('muted', '');
      video.setAttribute('playsinline', '');
      stage.appendChild(video);
      // The poster-under-video handoff: the video element paints after the
      // poster in DOM order, so the poster shows through until this fires.
      video.addEventListener('playing', function () {
        var st = document.getElementById(STAGE);
        if (st) st.dataset.vready = '1';
      });
    }
    if (video.getAttribute('src') !== VIDEO_URL) {
      // Same as the poster: size the box once metadata reveals the dimensions.
      if (state.metaHooked !== video) {
        state.metaHooked = video;
        video.addEventListener('loadedmetadata', function () {
          if (state.applyMediaSizing) state.applyMediaSizing();
        });
      }
      // A new stream means no first frame yet \u2014 fall back to the poster and
      // wait for the next 'playing' event before treating it as ready.
      var st0 = document.getElementById(STAGE);
      if (st0) st0.dataset.vready = '';
      video.src = VIDEO_URL;
      video.load();
    } else if (video.videoWidth && video.videoHeight && state.applyMediaSizing) {
      state.applyMediaSizing();
    }
    video.playbackRate = SPEED;
    video.style.display = 'block';

    if (PAUSED) {
      try { video.pause(); } catch (e) {}
    } else {
      var p = video.play();
      if (p && p.catch) p.catch(function () {});
    }

    // Autoplay can be blocked until the first user gesture; retry once.
    if (!state.gestureHooked) {
      state.gestureHooked = true;
      var retry = function () {
        var v = document.getElementById(MARKER + '-video');
        if (v && !(state.config && state.config.paused)) {
          var q = v.play(); if (q && q.catch) q.catch(function () {});
        }
      };
      document.addEventListener('pointerdown', retry, { once: true });
      document.addEventListener('keydown', retry, { once: true });
    }
  } else if (video) {
    // Keep the element: removing it here breaks the "hide wallpaper, then show
    // it again" path, because the next injection only recreates a video when
    // it is missing *and* the source is a video \u2014 but the stage still holds a
    // stale layer reference in the meantime.
    video.style.display = 'none';
    try { video.pause(); } catch (e) {}
  }

  // The ready flag belongs to video sources only. Clearing it inside the video
  // branch above missed the case where the video element had already been
  // removed: the flag then stayed on the stage and faded the poster to
  // opacity 0, leaving only the blurred backdrop visible on image wallpapers.
  if (!SHOW_VIDEO) {
    var stClear = document.getElementById(STAGE);
    if (stClear) stClear.dataset.vready = '';
  }

  // --- web (HTML) project layer -------------------------------------------
  var web = document.getElementById(MARKER + '-web');
  if (SHOW_WEB) {
    if (!web) {
      web = document.createElement('iframe');
      web.id = MARKER + '-web';
      web.setAttribute('sandbox', 'allow-scripts allow-same-origin');
      web.setAttribute('scrolling', 'no');
      web.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;pointer-events:none;background:transparent';
      stage.appendChild(web);
    }
    if (web.getAttribute('src') !== WEB_URL) web.src = WEB_URL;
    web.style.display = 'block';
    if (poster) poster.style.display = 'none';
  } else if (web) {
    web.style.display = 'none';
  }

  // --- dim overlay ---------------------------------------------------------
  var dim = document.getElementById(MARKER + '-dim');
  if (!dim) {
    dim = document.createElement('div');
    dim.id = MARKER + '-dim';
    stage.appendChild(dim);
  }
  dim.style.background = 'rgb(0 0 0 / ' + DIM + ')';
  try { document.documentElement.style.setProperty('--zcode-livewall-dim', String(DIM)); } catch (e) {}

  // --- pause when hidden or unfocused -------------------------------------
  if (!state.visibilityHooked) {
    state.visibilityHooked = true;
    state.syncPlayback = function () {
      var v = document.getElementById(MARKER + '-video');
      var c = state.config || {};
      if (!v) return;
      var shouldPause = c.paused || (c.pauseOnBlur && document.visibilityState === 'hidden');
      if (shouldPause) { try { v.pause(); } catch (e) {} }
      else { var q = v.play(); if (q && q.catch) q.catch(function () {}); }
      v.playbackRate = c.speed || 1;
    };
    document.addEventListener('visibilitychange', state.syncPlayback);
    window.addEventListener('blur', state.syncPlayback);
    window.addEventListener('focus', state.syncPlayback);
  }
  if (state.syncPlayback) state.syncPlayback();

  // --- media sizing --------------------------------------------------------
  /**
   * Size the media explicitly for both fit modes.
   *
   * contain: largest box with the media's own ratio that fits the stage.
   * cover:   smallest box that covers the stage; overflow is cropped.
   *
   * Done in JS because the intrinsic size is only known after load, and
   * because CSS auto sizing never scales a small image up. Also flags sources
   * too small to look sharp (stage.dataset.upscale).
   */
  function applyMediaSizing() {
    var st = document.getElementById(STAGE);
    if (!st) return;
    var mode = st.dataset.fit || 'cover';
    var w = st.clientWidth || window.innerWidth;
    var h = st.clientHeight || window.innerHeight;
    var dpr = window.devicePixelRatio || 1;

    [document.getElementById(MARKER + '-video'),
     document.getElementById(MARKER + '-poster')].forEach(function (el) {
      if (!el) return;
      var iw = el.naturalWidth || el.videoWidth || 0;
      var ih = el.naturalHeight || el.videoHeight || 0;
      if (!iw || !ih) return;
      var scale = mode === 'contain' ? Math.min(w / iw, h / ih) : Math.max(w / iw, h / ih);
      el.style.width = Math.round(iw * scale) + 'px';
      el.style.height = Math.round(ih * scale) + 'px';
      el.style.removeProperty('margin');
      if (el.style.transform === 'none') el.style.removeProperty('transform');

      var coverScale = Math.max((w * dpr) / iw, (h * dpr) / ih);
      st.dataset.upscale = coverScale > 1.5 ? String(Math.round(coverScale * 10) / 10) : '';
    });
  }

  state.applyMediaSizing = applyMediaSizing;
  applyMediaSizing();

  if (!state.resizeHooked) {
    state.resizeHooked = true;
    window.addEventListener('resize', function () {
      if (state.applyMediaSizing) state.applyMediaSizing();
    });
  }

  // --- persistence for the panel's self-heal path --------------------------
  try {
    localStorage.setItem(MARKER + ':css', CSS);
    localStorage.setItem(MARKER + ':meta', JSON.stringify(state.config));
  } catch (e) {}
})();`;
}
function buildResetScript() {
  return `(function(){
  document.getElementById(${JSON.stringify(MARKER)} + '-style')?.remove();
  document.getElementById(${JSON.stringify(MARKER)} + '-stage')?.remove();
  try {
    localStorage.removeItem(${JSON.stringify(MARKER)} + ':css');
    localStorage.removeItem(${JSON.stringify(MARKER)} + ':meta');
  } catch (e) {}
  if (window.__zcodeLivewall) {
    try { window.__zcodeLivewall.visibilityHooked = false; window.__zcodeLivewall.gestureHooked = false; } catch (e) {}
  }
})();`;
}

// dist/core/media-server.js
import http from "node:http";
import fs4 from "node:fs";
import path4 from "node:path";
import { randomBytes } from "node:crypto";
var MIME = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp"
};
async function startMediaServer(port) {
  const token = randomBytes(12).toString("hex");
  const published = /* @__PURE__ */ new Map();
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const prefix = `/m/${token}/`;
      if (!url.pathname.startsWith(prefix)) {
        res.writeHead(404).end();
        return;
      }
      const key = decodeURIComponent(url.pathname.slice(prefix.length));
      const filePath = published.get(key);
      if (!filePath) {
        res.writeHead(404).end();
        return;
      }
      let stat;
      try {
        stat = fs4.statSync(filePath);
      } catch {
        res.writeHead(404).end();
        return;
      }
      const headers = {
        "Content-Type": MIME[path4.extname(filePath).toLowerCase()] ?? "application/octet-stream",
        "Accept-Ranges": "bytes",
        // The published keys map one file for the lifetime of this process and
        // every restart gets a fresh token + keys, so a URL can never serve
        // different bytes. Caching on the renderer side is what makes a reload
        // or app restart paint instantly instead of re-streaming the file.
        "Cache-Control": "public, max-age=31536000, immutable",
        "Access-Control-Allow-Origin": "*"
      };
      const range = req.headers.range;
      if (range) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!m) {
          res.writeHead(416, { "Content-Range": `bytes */${stat.size}` }).end();
          return;
        }
        const start = m[1] ? Number(m[1]) : 0;
        const end = m[2] ? Math.min(Number(m[2]), stat.size - 1) : stat.size - 1;
        if (start > end || start >= stat.size) {
          res.writeHead(416, { "Content-Range": `bytes */${stat.size}` }).end();
          return;
        }
        res.writeHead(206, {
          ...headers,
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Content-Length": end - start + 1
        });
        if (req.method === "HEAD") {
          res.end();
          return;
        }
        fs4.createReadStream(filePath, { start, end }).pipe(res);
        return;
      }
      res.writeHead(200, { ...headers, "Content-Length": stat.size });
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      fs4.createReadStream(filePath).pipe(res);
    } catch {
      try {
        res.destroy();
      } catch {
      }
    }
  });
  server.on("clientError", (_err, socket) => {
    try {
      socket.destroy();
    } catch {
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return {
    port,
    token,
    publish(kind, filePath) {
      const key = `${kind}-${randomBytes(6).toString("hex")}${path4.extname(filePath).toLowerCase()}`;
      published.set(key, filePath);
      return `/m/${token}/${encodeURIComponent(key)}`;
    },
    close() {
      return new Promise((resolve) => server.close(() => resolve()));
    }
  };
}

// dist/core/optimize.js
import { execFile as execFile2 } from "node:child_process";
import { promisify as promisify2 } from "node:util";
import { createHash } from "node:crypto";
import fs5 from "node:fs";
import path5 from "node:path";
var execFileAsync2 = promisify2(execFile2);
var OPTIMIZE_PIXEL_THRESHOLD = 1920 * 1080 * 1.3;
var TARGET_FPS = 30;
async function probeVideo(mediaPath) {
  const ff = await findFfmpeg();
  if (!ff)
    return void 0;
  try {
    const { stdout } = await execFileAsync2(ff.ffprobePath, [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height,r_frame_rate",
      "-of",
      "default=nw=1:nk=1",
      mediaPath
    ], { timeout: 15e3, windowsHide: true });
    const [w, h, rate] = stdout.trim().split(/\s+/);
    const [num, den] = (rate ?? "").split("/").map(Number);
    return {
      width: Number(w),
      height: Number(h),
      fps: Number.isFinite(num) && Number.isFinite(den) && den > 0 ? num / den : void 0,
      duration: await probeDuration(ff.ffprobePath, mediaPath)
    };
  } catch {
    return void 0;
  }
}
function needsOptimize(info) {
  if (!info)
    return false;
  const pixels = info.width * info.height;
  const tooBig = pixels > OPTIMIZE_PIXEL_THRESHOLD;
  const tooFast = (info.fps ?? 0) > TARGET_FPS + 5;
  return tooBig || tooFast;
}
var OPTIMIZE_MIN_HEIGHT = 720;
function stampFor(mediaPath) {
  let stamp = "0";
  try {
    const st = fs5.statSync(mediaPath);
    stamp = `${Math.round(st.mtimeMs)}-${st.size}`;
  } catch {
  }
  return stamp;
}
function cacheFileFor(mediaPath, targetHeight) {
  const key = createHash("sha1").update(`${mediaPath}|${stampFor(mediaPath)}|${targetHeight}`).digest("hex").slice(0, 24);
  return path5.join(cacheDir(), `${key}.mp4`);
}
var jobs = /* @__PURE__ */ new Map();
var RETRY_COOLDOWN_MS = 10 * 60 * 1e3;
var MAX_ATTEMPTS = 3;
var failures = /* @__PURE__ */ new Map();
function clearOptimizeRetries() {
  failures.clear();
}
function cachedCopy(mediaPath, targetHeight) {
  const dest = cacheFileFor(mediaPath, targetHeight);
  try {
    return fs5.existsSync(dest) && fs5.statSync(dest).size > 0 ? dest : void 0;
  } catch {
    return void 0;
  }
}
function optimizedCopy(mediaPath, targetHeight = 1080) {
  const dest = cacheFileFor(mediaPath, targetHeight);
  if (fs5.existsSync(dest) && fs5.statSync(dest).size > 0)
    return dest;
  const failureKey = `${mediaPath}|${stampFor(mediaPath)}`;
  if (jobs.has(mediaPath))
    return void 0;
  const failed = failures.get(failureKey);
  if (failed) {
    if (failed.count >= MAX_ATTEMPTS)
      return void 0;
    if (Date.now() - failed.at < RETRY_COOLDOWN_MS)
      return void 0;
  }
  const th = Math.max(OPTIMIZE_MIN_HEIGHT, Math.min(Math.round(targetHeight), 2160));
  const job = (async () => {
    const ff = await findFfmpeg();
    if (!ff)
      return void 0;
    fs5.mkdirSync(cacheDir(), { recursive: true });
    const tmp = `${dest}.part.mp4`;
    try {
      await execFileAsync2(ff.path, [
        "-v",
        "error",
        "-i",
        mediaPath,
        // Only ever shrink: `min(ih, <target>)` keeps both a 60 fps small
        // square from being blown up and a 4K source from overshooting.
        "-vf",
        `scale=-2:min(ih\\,${th}):flags=fast_bilinear`,
        "-r",
        String(TARGET_FPS),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "28",
        "-an",
        "-movflags",
        "+faststart",
        tmp,
        "-y"
      ], { timeout: 30 * 60 * 1e3, windowsHide: true });
      fs5.renameSync(tmp, dest);
      if (fs5.statSync(dest).size <= 0) {
        fs5.rmSync(dest, { force: true });
        throw new Error("transcoder produced an empty file");
      }
      return dest;
    } catch {
      failures.set(failureKey, {
        count: (failures.get(failureKey)?.count ?? 0) + 1,
        at: Date.now()
      });
      try {
        fs5.rmSync(tmp, { force: true });
      } catch {
      }
      return void 0;
    } finally {
      jobs.delete(mediaPath);
    }
  })();
  jobs.set(mediaPath, job);
  void job.catch(() => void 0);
  return void 0;
}
function isOptimizing(mediaPath) {
  return jobs.has(mediaPath);
}

// dist/panel/panel-script.js
var PANEL_ROOT_ID = "zcode-livewall-panel-root";
function buildPanelScript(apiPort, token) {
  const api = `http://127.0.0.1:${apiPort}`;
  return `(function boot(){
  var API = ${JSON.stringify(api)};
  var TOKEN = ${JSON.stringify(token)};
  var ROOT_ID = ${JSON.stringify(PANEL_ROOT_ID)};

  // Page.addScriptToEvaluateOnNewDocument runs before the document has a root
  // element, so appending here would throw and the panel would never install.
  if (!document.documentElement) { setTimeout(boot, 30); return; }

  var stale = document.getElementById(ROOT_ID);
  if (stale) stale.remove();
  var staleStyle = document.getElementById('zcode-livewall-panel-style');
  if (staleStyle) staleStyle.remove();

  var css = [
    '#zcode-livewall-panel-root, #zcode-livewall-panel-root * { box-sizing: border-box; font-family: system-ui, sans-serif; }',
    '#zcode-livewall-panel-root { position: fixed; inset: auto; z-index: 2147483647; font-size: 12px; color: #e8e8ea; }',
    '#zlw-fab { position: fixed; right: 60px; bottom: 18px; width: 34px; height: 34px; border-radius: 50%;',
      ' background: rgba(32,32,38,.78); border: 1px solid rgba(255,255,255,.12); cursor: pointer;',
      ' display: flex; align-items: center; justify-content: center; backdrop-filter: blur(10px);',
      ' box-shadow: 0 2px 12px rgba(0,0,0,.35); user-select: none; font-size: 15px; line-height: 1; }',
    '#zlw-fab:hover { background: rgba(52,52,60,.85); }',
    '#zlw-panel { position: fixed; right: 18px; bottom: 60px; width: 286px; padding: 0 0 10px;',
      ' background: rgba(24,24,30,.9); border: 1px solid rgba(255,255,255,.12); border-radius: 12px;',
      ' backdrop-filter: blur(16px); box-shadow: 0 8px 32px rgba(0,0,0,.45); user-select: none; }',
    '#zlw-panel[hidden] { display: none; }',
    '#zlw-head { padding: 9px 12px; font-weight: 600; cursor: move; border-bottom: 1px solid rgba(255,255,255,.1);',
      ' display: flex; justify-content: space-between; align-items: center; }',
    '#zlw-close { cursor: pointer; opacity: .7; padding: 0 4px; } #zlw-close:hover { opacity: 1; }',
    '#zlw-body { padding: 10px 12px 0; max-height: 62vh; overflow-y: auto; }',
    '.zlw-row { margin-bottom: 10px; }',
    '.zlw-row label { display: flex; justify-content: space-between; margin-bottom: 4px; opacity: .85; }',
    '#zlw-panel input[type=range] { width: 100%; accent-color: #7aa2f7; height: 18px; margin: 0; cursor: pointer; }',
    '.zlw-toggles { display: flex; justify-content: center; gap: 14px; flex-wrap: wrap; }',
    '.zlw-toggles label { display: flex; align-items: center; gap: 5px; margin: 0; cursor: pointer; }',
    '.zlw-actions { display: flex; justify-content: center; gap: 8px; }',
    '.zlw-btn { display: inline-block; padding: 6px 14px; text-align: center; border-radius: 999px; cursor: pointer;',
      ' background: rgba(255,255,255,.09); border: 1px solid rgba(255,255,255,.14); color: inherit; font-size: 12px; }',
    '.zlw-btn:hover { background: rgba(255,255,255,.16); }',
    '#zlw-projects { width: 100%; max-height: 260px; overflow-y: auto; border-radius: 8px;',
      ' border: 1px solid rgba(255,255,255,.1); background: rgba(0,0,0,.22); }',
    '.zlw-proj { padding: 6px 8px; cursor: pointer; display: flex; justify-content: space-between; gap: 6px;',
      ' border-bottom: 1px solid rgba(255,255,255,.05); }',
    '.zlw-proj:hover { background: rgba(255,255,255,.09); }',
    '.zlw-proj[data-active="1"] { background: rgba(122,162,247,.22); }',
    '.zlw-proj[data-busy="1"] { opacity: .65; cursor: progress; }',
    '.zlw-proj .zlw-meta { opacity: .55; font-size: 10px; white-space: nowrap; }',
    '#zlw-status { min-height: 14px; padding: 2px 12px 0; opacity: .6; font-size: 11px; }',
    '#zlw-offline { display: flex; flex-direction: column; gap: 6px; align-items: center;',
      ' padding: 10px 12px; background: rgba(120,53,15,.55); font-size: 11px; line-height: 1.5; text-align: center; }',
    '#zlw-offline[hidden] { display: none; }',
    '#zlw-offline code { background: rgba(0,0,0,.35); padding: 1px 4px; border-radius: 4px; font-size: 10px; user-select: text; }',
    '#zcode-livewall-panel-root[data-offline="1"] #zlw-body { opacity: .45; pointer-events: none; }',
    '#zcode-livewall-panel-root[data-offline="1"] #zlw-status { display: none; }',
    '#zcode-livewall-panel-root[data-offline="1"] #zlw-fab { border-color: rgba(248,113,113,.7); }'
  ].join('');

  var style = document.createElement('style');
  style.id = 'zcode-livewall-panel-style';
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);

  var root = document.createElement('div');
  root.id = ROOT_ID;
  root.innerHTML =
    '<div id="zlw-fab" title="ZCode LiveWall">\u{1F39E}</div>' +
    '<div id="zlw-panel" hidden>' +
    '  <div id="zlw-head"><span>ZCode LiveWall</span><span id="zlw-close">\u2715</span></div>' +
    '  <div id="zlw-offline" hidden>' +
    '    <div>\u26A0 \u52A8\u6001\u58C1\u7EB8\u670D\u52A1\u672A\u8FD0\u884C,\u9762\u677F\u4E0D\u53EF\u7528</div>' +
    '    <div>\u5728\u63D2\u4EF6\u76EE\u5F55\u6267\u884C <code>node dist/cli.js serve --detach</code> \u542F\u52A8</div>' +
    '    <button class="zlw-btn" id="zlw-retry">\u91CD\u8BD5\u8FDE\u63A5</button>' +
    '  </div>' +
    '  <div id="zlw-body">' +
    '    <div class="zlw-row"><label><span>\u58C1\u7EB8\u5E93</span><span id="zlw-count"></span></label>' +
    '      <input type="search" id="zlw-search" placeholder="\u641C\u7D22\u6807\u9898 / \u7C7B\u578B\u2026" style="width:100%;margin-bottom:5px;padding:5px 8px;border-radius:6px;border:1px solid rgba(255,255,255,.14);background:rgba(0,0,0,.25);color:inherit;font-size:12px;outline:none">' +
    '      <div id="zlw-projects"></div></div>' +
    '    <div class="zlw-row"><label title="\u80CC\u666F\u6A21\u7CCA\u7A0B\u5EA6(\u50CF\u7D20)"><span>\u80CC\u666F\u6A21\u7CCA</span><span><span id="zlw-blur-val">0</span>px</span></label>' +
    '      <input type="range" id="zlw-blur" min="0" max="40" step="1" value="0"></div>' +
    '    <div class="zlw-row"><label title="\u80CC\u666F\u538B\u6697\u7A0B\u5EA6(\u767E\u5206\u6BD4,\u8D8A\u9AD8\u8D8A\u6697)"><span>\u80CC\u666F\u538B\u6697</span><span><span id="zlw-dim-val">0</span>%</span></label>' +
    '      <input type="range" id="zlw-dim" min="0" max="85" step="1" value="0"></div>' +
    '    <div class="zlw-row"><label title="\u64AD\u653E\u901F\u5EA6"><span>\u64AD\u653E\u901F\u5EA6</span><span><span id="zlw-speed-val">1</span>\xD7</span></label>' +
    '      <input type="range" id="zlw-speed" min="0.25" max="2" step="0.05" value="1"></div>' +
    '    <div class="zlw-row zlw-toggles">' +
    '      <label title="\u6839\u636E\u89C6\u9891\u62BD\u5E27\u81EA\u52A8\u751F\u6210 UI \u914D\u8272"><input type="checkbox" id="zlw-monet">UI \u83AB\u5948\u53D6\u8272</label>' +
    '      <label title="\u663E\u793A\u6216\u9690\u85CF\u52A8\u6001\u80CC\u666F"><input type="checkbox" id="zlw-vis">\u663E\u793A\u58C1\u7EB8</label>' +
    '      <label title="\u7A97\u53E3\u5931\u7126\u6216\u6700\u5C0F\u5316\u65F6\u6682\u505C\u64AD\u653E"><input type="checkbox" id="zlw-pause-blur">\u5931\u7126\u6682\u505C</label>' +
    '      <label title="4K/60fps \u89C6\u9891\u4F1A\u5360\u6EE1 CPU\uFF0C\u5F00\u542F\u540E\u4F1A\u8F6C\u7801\u51FA\u4E0E\u5C4F\u5E55\u5339\u914D\u7684 30fps \u7F13\u5B58\uFF0C\u4E0B\u6B21\u5207\u6362\u81EA\u52A8\u6539\u7528"><input type="checkbox" id="zlw-optimize">\u6027\u80FD\u4F18\u5316</label>' +
    '    </div>' +
    '    <div class="zlw-row zlw-actions">' +
    '      <button class="zlw-btn" id="zlw-pause" title="\u6682\u505C\u6216\u7EE7\u7EED\u64AD\u653E">\u6682\u505C</button>' +
    '      <button class="zlw-btn" id="zlw-fit" title="\u586B\u6EE1\u88C1\u526A / \u5B8C\u6574\u663E\u793A(\u6A21\u7CCA\u57AB\u5E95)">\u586B\u5145: \u2026</button>' +
    '    </div>' +
    '    <div class="zlw-row zlw-actions">' +
    '      <label class="zlw-btn" for="zlw-file-video" title="\u9009\u62E9\u4E00\u4E2A\u672C\u5730\u89C6\u9891\u6587\u4EF6\u4F5C\u4E3A\u52A8\u6001\u58C1\u7EB8">\u89C6\u9891\u2026</label>' +
    '      <label class="zlw-btn" for="zlw-file-image" title="\u9009\u62E9\u4E00\u5F20\u672C\u5730\u56FE\u7247\u4F5C\u4E3A\u9759\u6001\u58C1\u7EB8">\u56FE\u7247\u2026</label>' +
    '      <input type="file" id="zlw-file-video" accept="video/*" hidden>' +
    '      <input type="file" id="zlw-file-image" accept="image/*" hidden>' +
    '    </div>' +
    '    <div class="zlw-row zlw-actions">' +
    '      <button class="zlw-btn" id="zlw-reset" title="\u79FB\u9664\u52A8\u6001\u58C1\u7EB8,\u8FD8\u539F ZCode \u9ED8\u8BA4\u5916\u89C2">\u8FD8\u539F\u9ED8\u8BA4\u5916\u89C2</button>' +
    '    </div>' +
    '  </div>' +
    '</div>' +
    '<div id="zlw-status"></div>';
  // The body may still be missing when this runs as a new-document script.
  if (!document.body) { setTimeout(boot, 30); return; }
  document.body.appendChild(root);

  function $(id) { return document.getElementById(id); }
  function stageEl() { return document.getElementById('zcode-livewall-stage'); }
  function videoEl() { return document.getElementById('zcode-livewall-video'); }
  function status(msg) {
    var el = $('zlw-status'); if (!el) return;
    el.textContent = msg;
    setTimeout(function () { if (el.textContent === msg) el.textContent = ''; }, 2400);
  }
  function auth(extra) {
    var h = extra || {};
    h['x-zlw-token'] = TOKEN;
    return h;
  }
  function post(path, body, cb) {
    fetch(API + path, { method: 'POST', headers: auth({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.error) { status('\u64CD\u4F5C\u5931\u8D25: ' + d.error); return; }
        if (cb) cb(d);
      })
      .catch(function () { status('\u65E0\u6CD5\u8FDE\u63A5\u52A8\u6001\u58C1\u7EB8\u670D\u52A1'); });
  }

  var FIT_LABELS = { cover: '\u586B\u6EE1\u88C1\u526A', contain: '\u5B8C\u6574\u663E\u793A' };
  var FIT_ORDER = ['contain', 'cover'];
  function applyFitLabel(btn, fit) {
    btn.textContent = '\u586B\u5145: ' + (FIT_LABELS[fit] || fit);
    btn.setAttribute('data-fit', fit);
  }

  var projectsLoaded = false;
  var allProjects = [];
  var activeTitle = null;

  /** Renders the cached list, filtered by the search box. */
  function renderProjects() {
    var box = $('zlw-projects');
    var q = ($('zlw-search') && $('zlw-search').value || '').trim().toLowerCase();
    var list = q
      ? allProjects.filter(function (p) {
          return (p.title || '').toLowerCase().indexOf(q) >= 0 ||
                 (p.type || '').toLowerCase().indexOf(q) >= 0 ||
                 String(p.id).indexOf(q) >= 0;
        })
      : allProjects;

    box.innerHTML = '';
    $('zlw-count').textContent = q ? list.length + ' / ' + allProjects.length : allProjects.length + ' \u4E2A';
    if (list.length === 0) {
      box.innerHTML = '<div class="zlw-proj" style="cursor:default;opacity:.6">\u6CA1\u6709\u5339\u914D\u7684\u58C1\u7EB8</div>';
      return;
    }
    list.forEach(function (p) {
      var row = document.createElement('div');
      row.className = 'zlw-proj';
      row.setAttribute('data-id', p.id);
      if (activeTitle && p.title === activeTitle) row.setAttribute('data-active', '1');
      row.innerHTML = '<span></span><span class="zlw-meta"></span>';
      row.firstChild.textContent = p.title;
      row.lastChild.textContent = (p.type || '') + (p.source === 'workshop' ? ' \xB7 \u5DE5\u574A' : '') +
        (/preview./i.test(p.media || '') ? ' \xB7 \u4F4E\u6E05\u9884\u89C8' : '');
      row.addEventListener('click', function () {
        // Give the click immediate feedback: the request can take a moment
        // on a cold video, and a row that looks inert reads as a dead click.
        var prev = box.querySelector('.zlw-proj[data-active="1"]');
        if (prev) prev.removeAttribute('data-active');
        row.setAttribute('data-active', '1');
        row.setAttribute('data-busy', '1');
        status('\u6B63\u5728\u5207\u6362\u5230 ' + p.title + '\u2026');
        post('/api/source', { project: p.id }, function (res) {
          row.removeAttribute('data-busy');
          if (res && res.error) { status('\u5207\u6362\u5931\u8D25: ' + res.error); return; }
          activeTitle = p.title;
          status('\u5DF2\u5207\u6362\u5230 ' + p.title);
          refresh();
        });
      });
      box.appendChild(row);
    });
  }

  function loadProjects(activeName) {
    if (activeName) activeTitle = activeName;
    fetch(API + '/api/projects', { headers: auth() })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        allProjects = (d && d.projects) || [];
        if (allProjects.length === 0) {
          $('zlw-projects').innerHTML = '<div class="zlw-proj" style="cursor:default;opacity:.6">\u672A\u627E\u5230 Wallpaper Engine \u58C1\u7EB8</div>';
          return;
        }
        renderProjects();
        projectsLoaded = true;
      })
      .catch(function () { setOffline(true); });
  }

  $('zlw-search').addEventListener('input', function () {
    if (projectsLoaded) renderProjects();
  });

  function setOffline(on) {
    root.setAttribute('data-offline', on ? '1' : '0');
    $('zlw-offline').hidden = !on;
    $('zlw-fab').title = on ? 'ZCode LiveWall \u2014 \u670D\u52A1\u672A\u8FD0\u884C' : 'ZCode LiveWall';
    if (on) {
      $('zlw-blur').value = 0; $('zlw-blur-val').textContent = '0';
      $('zlw-dim').value = 0; $('zlw-dim-val').textContent = '0';
      $('zlw-monet').checked = false;
      $('zlw-vis').checked = false;
    }
  }

  function refresh() {
    fetch(API + '/api/config', { headers: auth() })
      .then(function (r) { return r.json(); })
      .then(function (c) {
        setOffline(false);
        $('zlw-blur').value = c.blur; $('zlw-blur-val').textContent = c.blur;
        $('zlw-dim').value = c.dim; $('zlw-dim-val').textContent = c.dim;
        $('zlw-speed').value = c.speed; $('zlw-speed-val').textContent = Number(c.speed).toFixed(2).replace(/0+$/,'').replace(/\\.$/,'');
        $('zlw-monet').checked = !!c.monet;
        $('zlw-vis').checked = !!c.wallpaperVisible;
        $('zlw-pause-blur').checked = !!c.pauseOnBlur;
        $('zlw-optimize').checked = !!c.optimize;
        applyFitLabel($('zlw-fit'), c.fit || 'cover');
        $('zlw-pause').textContent = c.paused ? '\u7EE7\u7EED' : '\u6682\u505C';
        if (c.sourceName) activeTitle = c.sourceName;
        // A source far smaller than the window looks soft no matter the mode;
        // the injected layer reports its upscale factor here. With \u4F4E\u6E05\u4FDD\u62A4 on
        // the layer has already re-framed it (dataset.eff), so say so.
        var stageEl = document.getElementById('zcode-livewall-stage');
        var up = stageEl && stageEl.dataset.upscale;
        if (up && stageEl.dataset.eff === 'contain') status('\u63D0\u793A: \u5206\u8FA8\u7387\u504F\u4F4E(\u653E\u5927 ' + up + '\xD7)\uFF0C\u5DF2\u81EA\u52A8\u6539\u4E3A\u5B8C\u6574\u663E\u793A\uFF1B\u6362\u9AD8\u6E05\u7D20\u6750\u4F1A\u66F4\u6E05\u6670');
        else if (up) status('\u63D0\u793A: \u8FD9\u5F20\u58C1\u7EB8\u5206\u8FA8\u7387\u504F\u4F4E(\u653E\u5927 ' + up + '\xD7), \u6362\u66F4\u9AD8\u6E05\u7684\u7D20\u6750\u4F1A\u66F4\u6E05\u6670');
        if (!projectsLoaded) loadProjects(c.sourceName);
        // Keep the highlight in sync with the server's idea of the source; a
        // busy row is left alone so the click feedback survives the refresh.
        var active = document.querySelectorAll('.zlw-proj');
        for (var i = 0; i < active.length; i++) {
          var row = active[i];
          if (row.getAttribute('data-busy') === '1') continue;
          var label = row.firstChild && row.firstChild.textContent;
          if (activeTitle && label === activeTitle) row.setAttribute('data-active', '1');
          else row.removeAttribute('data-active');
        }
      })
      .catch(function () { setOffline(true); });
  }

  var pushTimer = null;
  function pushConfig(patch) {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      post('/api/config', patch, function (d) { status(d && d.windows > 0 ? '\u5DF2\u5E94\u7528' : '\u5DF2\u4FDD\u5B58(ZCode \u672A\u8FDE\u63A5)'); });
    }, 250);
  }

  $('zlw-blur').addEventListener('input', function () {
    $('zlw-blur-val').textContent = this.value;
    var px = Number(this.value);
    var filter = px > 0 ? 'blur(' + px + 'px)' : 'none';
    // Match the injected CSS: contain mode keeps scale 1 so the letterbox
    // bars stay visible; growing the layer would crop them away.
    var stage = stageEl();
    var inContain = stage && stage.dataset.fit === 'contain';
    var scale = px > 0 && !inContain ? 'scale(1.04)' : 'none';
    // video: animated wallpapers; poster: still images and GIFs; web: iframe
    // pages \u2014 all three carry the blur or the slider looks dead on that type.
    ['zcode-livewall-video', 'zcode-livewall-poster', 'zcode-livewall-web'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.style.filter = filter;
      el.style.transform = scale;
    });
    // The blurred backdrop (letterbox fill) tracks the same value; matches
    // the stylesheet formula blur+12 so preview and injected CSS agree.
    var bd = document.getElementById('zcode-livewall-backdrop');
    if (bd) bd.style.filter = 'blur(' + (px + 12) + 'px) saturate(1.1) brightness(.55)';
    pushConfig({ blur: px });
  });
  $('zlw-dim').addEventListener('input', function () {
    $('zlw-dim-val').textContent = this.value;
    document.documentElement.style.setProperty('--zcode-livewall-dim', String(Number(this.value) / 100));
    var d = document.getElementById('zcode-livewall-dim');
    if (d) d.style.background = 'rgb(0 0 0 / ' + (Number(this.value) / 100) + ')';
    pushConfig({ dim: Number(this.value) });
  });
  $('zlw-speed').addEventListener('input', function () {
    var val = Number(this.value);
    $('zlw-speed-val').textContent = String(Math.round(val * 100) / 100);
    var v = videoEl(); if (v) v.playbackRate = val;
    pushConfig({ speed: val });
  });
  $('zlw-monet').addEventListener('change', function () { pushConfig({ monet: this.checked }); });
  $('zlw-vis').addEventListener('change', function () { pushConfig({ wallpaperVisible: this.checked }); });
  $('zlw-pause-blur').addEventListener('change', function () { pushConfig({ pauseOnBlur: this.checked }); });
  $('zlw-optimize').addEventListener('change', function () {
    pushConfig({ optimize: this.checked });
    if (this.checked) status('\u5DF2\u5F00\u542F\uFF1A\u5927\u89C6\u9891\u5C06\u5728\u540E\u53F0\u8F6C\u7801\uFF0C\u5B8C\u6210\u540E\u81EA\u52A8\u751F\u6548');
  });

  $('zlw-pause').addEventListener('click', function () {
    var next = this.textContent === '\u6682\u505C';
    this.textContent = next ? '\u7EE7\u7EED' : '\u6682\u505C';
    var v = videoEl();
    if (v) { if (next) v.pause(); else { var p = v.play(); if (p && p.catch) p.catch(function () {}); } }
    pushConfig({ paused: next });
  });

  $('zlw-fit').addEventListener('click', function () {
    var current = this.getAttribute('data-fit') || 'cover';
    var next = FIT_ORDER[(FIT_ORDER.indexOf(current) + 1) % FIT_ORDER.length];
    applyFitLabel(this, next);
    post('/api/config', { fit: next }, function (d) { status('\u5DF2\u5207\u6362: ' + FIT_LABELS[next]); });
  });

  /**
   * Uploads a picked file and makes it the wallpaper. Images and videos share
   * this path; the service decides the kind from the extension.
   */
  function uploadFile(input, kindLabel) {
    var f = input.files && input.files[0];
    input.value = '';
    if (!f) return;
    var limitMb = kindLabel === '\u89C6\u9891' ? 120 : 40;
    if (f.size > limitMb * 1024 * 1024) {
      status(kindLabel + '\u8FC7\u5927\uFF0C\u4E0A\u9650 ' + limitMb + ' MB');
      return;
    }
    status('\u6B63\u5728\u5BFC\u5165' + kindLabel + ' ' + f.name + '\u2026');
    // The panel cannot read arbitrary paths, so hand the bytes to the service
    // through a data URI; the service writes them into its data directory.
    var fr = new FileReader();
    fr.onload = function () {
      fetch(API + '/api/upload', {
        method: 'POST',
        headers: auth({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ name: f.name, dataUri: fr.result })
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.error) { status('\u5BFC\u5165\u5931\u8D25: ' + d.error); return; }
          status('\u5DF2\u5E94\u7528' + kindLabel + ': ' + f.name);
          refresh();
        })
        .catch(function () { status('\u5BFC\u5165\u5931\u8D25: \u670D\u52A1\u4E0D\u53EF\u8FBE'); });
    };
    fr.readAsDataURL(f);
  }

  $('zlw-file-video').addEventListener('change', function () { uploadFile(this, '\u89C6\u9891'); });
  $('zlw-file-image').addEventListener('change', function () { uploadFile(this, '\u56FE\u7247'); });

  $('zlw-reset').addEventListener('click', function () {
    post('/api/reset', {}, function () {
      try {
        localStorage.removeItem('zcode-livewall:css');
        localStorage.removeItem('zcode-livewall:meta');
      } catch (e) {}
      status('\u5DF2\u8FD8\u539F\u9ED8\u8BA4\u5916\u89C2');
      refresh();
    });
  });

  $('zlw-retry').addEventListener('click', function () {
    this.textContent = '\u6B63\u5728\u91CD\u8BD5\u2026';
    refresh();
  });

  /**
   * The panel is positioned with right/bottom until the first drag switches it
   * to left/top. That switch must write both in the same frame: setting
   * right/bottom to auto alone leaves the box at its static position, which is
   * below the fold and looks like the panel never opened.
   */
  function clampIntoView(panel) {
    var r = panel.getBoundingClientRect();
    var maxX = Math.max(4, window.innerWidth - r.width - 4);
    var maxY = Math.max(4, window.innerHeight - r.height - 4);
    panel.style.left = Math.min(Math.max(4, r.left), maxX) + 'px';
    panel.style.top = Math.min(Math.max(4, r.top), maxY) + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  }

  /**
   * Blur/dim/speed can change behind the panel's back \u2014 MCP tools, the CLI,
   * curl, a wallpaper switch pushed by another surface. While the panel is
   * open, poll the service so the sliders never show a stale value; otherwise
   * dragging from a wrong start point reads as "the slider does nothing".
   * Skipped while a slider is being dragged: refreshing then would snap the
   * thumb back mid-drag.
   */
  var beatTimer = null;
  var sliderHeld = 0;
  ['pointerdown'].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      var t = e.target;
      if (t && t.id && /^zlw-(blur|dim|speed)$/.test(t.id)) sliderHeld++;
    }, true);
  });
  ['pointerup', 'pointercancel'].forEach(function (ev) {
    document.addEventListener(ev, function () { sliderHeld = Math.max(0, sliderHeld - 1); }, true);
  });
  function setBeat(on) {
    if (on && !beatTimer) beatTimer = setInterval(function () {
      if (document.getElementById('zlw-panel').hidden) { setBeat(false); return; }
      if (sliderHeld > 0) return;
      refresh();
    }, 2500);
    if (!on && beatTimer) { clearInterval(beatTimer); beatTimer = null; }
  }

  function togglePanel(show) {
    var p = $('zlw-panel');
    p.hidden = show === undefined ? !p.hidden : !show;
    if (!p.hidden) {
      // A stale off-screen position from a previous window size would make the
      // panel open invisibly, so reclaim it on every open.
      if (p.style.left) clampIntoView(p);
      refresh();
      if (!projectsLoaded) loadProjects();
      setBeat(true);
    } else {
      setBeat(false);
    }
  }

  $('zlw-fab').addEventListener('click', function () { togglePanel(); });
  $('zlw-close').addEventListener('click', function () { $('zlw-panel').hidden = true; });

  refresh();
  loadProjects();

  (function () {
    var head = $('zlw-head'), panel = $('zlw-panel');
    var sx = 0, sy = 0, ox = 0, oy = 0, dragging = false, moved = false;
    var DRAG_THRESHOLD = 3;

    // No setPointerCapture here. Pointer capture retargets every later pointer
    // event \u2014 including pointerup and the resulting click \u2014 to the capturing
    // element, so the \u2715 button inside the header would never receive its own
    // click. Dragging is tracked with document-level move/up listeners instead,
    // which leave the event targets untouched.
    function isInteractive(el) {
      return !!(el && el.closest && el.closest('button, input, select, textarea, a, label'));
    }

    function onMove(e) {
      if (!dragging) return;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (!moved && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      moved = true;
      var x = Math.max(4, Math.min(window.innerWidth - 80, ox + dx));
      var y = Math.max(4, Math.min(window.innerHeight - 60, oy + dy));
      panel.style.left = x + 'px'; panel.style.top = y + 'px';
    }

    function onUp() {
      dragging = false; moved = false;
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
    }

    head.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || isInteractive(e.target)) return;
      dragging = true; moved = false;
      sx = e.clientX; sy = e.clientY;
      var r = panel.getBoundingClientRect(); ox = r.left; oy = r.top;
      // Pin the current position before releasing right/bottom, otherwise the
      // panel jumps to its static flow position until the first pointermove.
      panel.style.left = ox + 'px'; panel.style.top = oy + 'px';
      panel.style.right = 'auto'; panel.style.bottom = 'auto';
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onUp);
    });

    window.addEventListener('resize', function () {
      if (!panel.hidden && panel.style.left) clampIntoView(panel);
    });
  })();

  // Self-heal: if the layer was lost but a previous injection saved it.
  if (!document.getElementById('zcode-livewall-style')) {
    var savedCss = null, savedMeta = null;
    try {
      savedCss = localStorage.getItem('zcode-livewall:css');
      savedMeta = localStorage.getItem('zcode-livewall:meta');
    } catch (e) {}
    if (savedCss) {
      var s = document.createElement('style');
      s.id = 'zcode-livewall-style';
      s.textContent = savedCss;
      (document.head || document.documentElement).appendChild(s);
      if (savedMeta && !document.getElementById('zcode-livewall-stage')) {
        try {
          var meta = JSON.parse(savedMeta);
          if (meta.videoUrl) {
            var stage = document.createElement('div');
            stage.id = 'zcode-livewall-stage';
            var v = document.createElement('video');
            v.id = 'zcode-livewall-video';
            v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true;
            v.src = meta.videoUrl;
            stage.appendChild(v);
            document.documentElement.appendChild(stage);
          }
        } catch (e) {}
      }
    }
  }
})();`;
}

// dist/core/zcode-process.js
import { execFile as execFile3 } from "node:child_process";
import { promisify as promisify3 } from "node:util";
var execFileAsync3 = promisify3(execFile3);
async function isZcodeProcessRunning() {
  try {
    if (process.platform === "win32") {
      const { stdout: stdout2 } = await execFileAsync3("tasklist", ["/NH", "/FI", "IMAGENAME eq ZCode.exe"], {
        windowsHide: true
      });
      return stdout2.toLowerCase().includes("zcode.exe");
    }
    const name = process.platform === "darwin" ? "ZCode" : "zcode";
    const { stdout } = await execFileAsync3("pgrep", ["-x", name]);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

// dist/core/launch.js
import { execFile as execFile4, spawn } from "node:child_process";
import { promisify as promisify4 } from "node:util";
import fs6 from "node:fs";
import os3 from "node:os";
import path6 from "node:path";
var execFileAsync4 = promisify4(execFile4);
var ZCODE_EXE_CANDIDATES = process.platform === "win32" ? [
  process.env.ZCODE_WINDOWS_APP_INSTALL_DIR ? path6.join(process.env.ZCODE_WINDOWS_APP_INSTALL_DIR, "ZCode.exe") : void 0,
  "C:\\Program Files\\ZCode\\ZCode.exe",
  "D:\\ZCode\\ZCode.exe",
  path6.join(os3.homedir(), "AppData", "Local", "Programs", "ZCode", "ZCode.exe")
].filter(Boolean) : process.platform === "darwin" ? ["/Applications/ZCode.app/Contents/MacOS/ZCode"] : ["/usr/bin/zcode", "/opt/ZCode/zcode"];
function findZcodeExecutable() {
  return ZCODE_EXE_CANDIDATES.find((p) => {
    try {
      return fs6.statSync(p).isFile();
    } catch {
      return false;
    }
  });
}
async function launchZcode(port) {
  if (await discoverCdpPort(port)) {
    return { started: false, reason: "already-running-with-cdp" };
  }
  const exe = findZcodeExecutable();
  if (!exe) {
    throw new Error("ZCode executable not found; set ZCODE_WINDOWS_APP_INSTALL_DIR or install ZCode to a known path.");
  }
  if (await isZcodeProcessRunning()) {
    return { started: false, reason: "running-without-cdp" };
  }
  const child = spawn(exe, [`--remote-debugging-port=${port}`], {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await discoverCdpPort(port))
      return { started: true };
  }
  throw new Error("ZCode started but no CDP endpoint appeared. Quit ZCode completely and try again.");
}
async function killZcode() {
  try {
    if (process.platform === "win32") {
      await execFileAsync4("taskkill", ["/F", "/IM", "ZCode.exe"], { windowsHide: true });
    } else {
      await execFileAsync4("pkill", ["-x", process.platform === "darwin" ? "ZCode" : "zcode"]);
    }
    return true;
  } catch {
    return false;
  }
}

// dist/core/steam-preview.js
import fs7 from "node:fs";
import path7 from "node:path";
import os4 from "node:os";
var STEAM_API = "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/";
var WORKSHOP_APP_ID = "431960";
var DETAILS_TIMEOUT_MS = 6e3;
var DETAILS_RETRIES = 4;
var DOWNLOAD_TIMEOUT_MS = 15e3;
var FAILURE_COOLDOWN_BASE_MS = 60 * 1e3;
var FAILURE_COOLDOWN_MAX_MS = 30 * 60 * 1e3;
function isWorkshopId(projectId) {
  return /^\d{6,12}$/.test(projectId.trim());
}
function localWorkshopProject(projectId) {
  const id = projectId.trim();
  for (const lib of findSteamLibraries()) {
    const p = path7.join(lib, "steamapps", "workshop", "content", WORKSHOP_APP_ID, id, "project.json");
    if (fs7.existsSync(p))
      return true;
  }
  return false;
}
function previewDir() {
  return path7.join(dataDir(), "steam-previews");
}
function previewCachePath(projectId) {
  return path7.join(previewDir(), `${projectId.trim()}.jpg`);
}
function cachedSteamPreview(projectId) {
  if (!isWorkshopId(projectId))
    return void 0;
  try {
    const p = previewCachePath(projectId);
    return fs7.existsSync(p) && fs7.statSync(p).size > 30 * 1024 ? p : void 0;
  } catch {
    return void 0;
  }
}
function imageSize(imagePath) {
  try {
    const fd = fs7.openSync(imagePath, "r");
    const head = Buffer.alloc(64);
    fs7.readSync(fd, head, 0, 64, 0);
    fs7.closeSync(fd);
    if (head[0] === 71 && head[1] === 73 && head[2] === 70) {
      return { width: head.readUInt16LE(6), height: head.readUInt16LE(8) };
    }
    if (head[0] === 137 && head[1] === 80 && head[2] === 78) {
      const png = Buffer.alloc(24);
      const fd2 = fs7.openSync(imagePath, "r");
      fs7.readSync(fd2, png, 0, 24, 0);
      fs7.closeSync(fd2);
      return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
    }
    if (head[0] === 255 && head[1] === 216) {
      const fd3 = fs7.openSync(imagePath, "r");
      const scan = Buffer.alloc(Math.min(fs7.fstatSync(fd3).size, 512 * 1024));
      fs7.readSync(fd3, scan, 0, scan.length, 0);
      fs7.closeSync(fd3);
      let p = 2;
      while (p + 9 < scan.length) {
        if (scan[p] !== 255) {
          p++;
          continue;
        }
        const marker = scan[p + 1];
        if (marker === 216 || marker === 1 || marker >= 208 && marker <= 217) {
          p += 2;
          continue;
        }
        if (marker >= 192 && marker <= 207 && marker !== 196 && marker !== 200 && marker !== 204) {
          return { height: scan.readUInt16BE(p + 5), width: scan.readUInt16BE(p + 7) };
        }
        p += 2 + scan.readUInt16BE(p + 2);
      }
    }
    return void 0;
  } catch {
    return void 0;
  }
}
var MIN_USEFUL_PREVIEW_WIDTH = 640;
var inFlight = /* @__PURE__ */ new Set();
var failures2 = /* @__PURE__ */ new Map();
function cooldownRemaining(id) {
  const f = failures2.get(id);
  if (!f)
    return 0;
  const wait = Math.min(FAILURE_COOLDOWN_BASE_MS * 2 ** f.count, FAILURE_COOLDOWN_MAX_MS);
  return Math.max(0, wait - (Date.now() - f.at));
}
async function fetchDetails(projectId) {
  const body = `itemcount=1&publishedfileids%5B0%5D=${encodeURIComponent(projectId)}`;
  let lastErr;
  for (let attempt = 0; attempt < DETAILS_RETRIES; attempt++) {
    try {
      const res = await fetch(STEAM_API, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(DETAILS_TIMEOUT_MS)
      });
      const json = await res.json();
      return json.response?.publishedfiledetails?.[0]?.preview_url;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  throw lastErr ?? new Error("steam api unreachable");
}
async function downloadTo(url, dest) {
  const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!res.ok)
    throw new Error(`HTTP ${res.status}`);
  const ab = await res.arrayBuffer();
  fs7.writeFileSync(dest, Buffer.from(ab));
}
function refreshSteamPreview(projectId, onDone) {
  const id = projectId.trim();
  if (!isWorkshopId(id) || inFlight.has(id))
    return;
  if (cooldownRemaining(id) > 0)
    return;
  if (!localWorkshopProject(id))
    return;
  inFlight.add(id);
  void (async () => {
    try {
      const url = await fetchDetails(id);
      if (!url)
        throw new Error("no preview_url");
      fs7.mkdirSync(previewDir(), { recursive: true });
      const tmp = path7.join(os4.tmpdir(), `zlw-prev-${id}-${Math.random().toString(36).slice(2)}.img`);
      await downloadTo(url, tmp);
      const dim = imageSize(tmp);
      if (!dim)
        throw new Error("unreadable image");
      if (fs7.statSync(tmp).size < 30 * 1024)
        throw new Error("download too small");
      fs7.renameSync(tmp, previewCachePath(id));
      failures2.delete(id);
      onDone?.(previewCachePath(id));
    } catch (err) {
      console.error(`steam-preview: ${id} failed \u2014 ${err.message}`);
      const prev = failures2.get(id);
      failures2.set(id, { count: (prev?.count ?? 0) + 1, at: Date.now() });
      onDone?.(void 0);
    } finally {
      inFlight.delete(id);
    }
  })();
}

// dist/core/serve.js
var POLL_MS = 1500;
var AUTORESTART_DELAY_MS = 3e4;
var AUTORESTART_COOLDOWN_MS = 10 * 6e4;
var MAX_UPLOAD_BYTES = 120 * 1024 * 1024;
var MAX_BODY = Math.ceil(MAX_UPLOAD_BYTES * 1.4);
var runtimeState = { cdpReachable: false, rendererCount: 0, zcodeRunning: false };
var nextProcessProbe = 0;
var cachedSource;
var themeJobs = /* @__PURE__ */ new Map();
var THEME_RETRY_COOLDOWN_MS = 5 * 60 * 1e3;
var themeFailedAt = /* @__PURE__ */ new Map();
function posterFileFor(samplePath) {
  const hash = createHash2("sha1").update(samplePath.toLowerCase()).digest("hex").slice(0, 16);
  return path8.join(dataDir(), `poster-${hash}.jpg`);
}
var posterJobs = /* @__PURE__ */ new Map();
var optimizingChecked = /* @__PURE__ */ new Set();
function clearOptimizeChecks() {
  optimizingChecked.clear();
}
var lastPlayedPath;
var viewNeeds = { w: 0, h: 0, dpr: 1 };
function displayTargetHeight() {
  if (!viewNeeds.h)
    return 1080;
  return Math.min(2160, Math.max(720, Math.round(viewNeeds.h * (viewNeeds.dpr || 1))));
}
function captureViewNeeds(conn) {
  conn.send("Runtime.evaluate", {
    expression: "JSON.stringify({w: window.innerWidth|0, h: window.innerHeight|0, dpr: Number(window.devicePixelRatio)||1})",
    returnByValue: true
  }).then((r) => {
    const parsed = JSON.parse(r?.result?.value ?? "{}");
    if (parsed && parsed.h > 0)
      viewNeeds = parsed;
  }).catch(() => {
  });
}
function themeFor(sourcePath, opts = {}) {
  let mtimeMs = 0;
  try {
    mtimeMs = fs8.statSync(sourcePath).mtimeMs;
  } catch {
    return Promise.resolve(void 0);
  }
  const cached = cachedSource?.path === sourcePath && cachedSource.mtimeMs === mtimeMs;
  if (cached && (cachedSource.theme || opts.block)) {
    return Promise.resolve(cachedSource.theme);
  }
  if (!/\.(mp4|webm|mov|m4v|mkv)$/i.test(sourcePath))
    return Promise.resolve(void 0);
  const key = `${sourcePath}:${mtimeMs}`;
  const failure = themeFailedAt.get(key);
  if (failure !== void 0 && Date.now() - failure < THEME_RETRY_COOLDOWN_MS) {
    return Promise.resolve(void 0);
  }
  let job = themeJobs.get(key);
  if (!job) {
    job = themeFromVideo(sourcePath).then((theme) => {
      cachedSource = { path: sourcePath, mtimeMs, theme };
      themeFailedAt.delete(key);
      return theme;
    }).catch(() => {
      cachedSource = { path: sourcePath, mtimeMs, theme: void 0 };
      themeFailedAt.set(key, Date.now());
      return void 0;
    }).finally(() => {
      themeJobs.delete(key);
    });
    themeJobs.set(key, job);
  }
  return opts.block ? job : cached ? Promise.resolve(cachedSource.theme) : Promise.resolve(void 0);
}
function themeForImage(sourcePath, opts = {}) {
  let mtimeMs = 0;
  try {
    mtimeMs = fs8.statSync(sourcePath).mtimeMs;
  } catch {
    return Promise.resolve(void 0);
  }
  const cached = cachedSource?.path === sourcePath && cachedSource.mtimeMs === mtimeMs;
  if (cached && (cachedSource.theme || opts.block)) {
    return Promise.resolve(cachedSource.theme);
  }
  const key = `img:${sourcePath}:${mtimeMs}`;
  const failure = themeFailedAt.get(key);
  if (failure !== void 0 && Date.now() - failure < THEME_RETRY_COOLDOWN_MS) {
    return Promise.resolve(void 0);
  }
  let job = themeJobs.get(key);
  if (!job) {
    job = themeFromImage(sourcePath).then((theme) => {
      cachedSource = { path: sourcePath, mtimeMs, theme };
      themeFailedAt.delete(key);
      return theme;
    }).catch(() => {
      cachedSource = { path: sourcePath, mtimeMs, theme: void 0 };
      themeFailedAt.set(key, Date.now());
      return void 0;
    }).finally(() => {
      themeJobs.delete(key);
    });
    themeJobs.set(key, job);
  }
  return opts.block ? job : cached ? Promise.resolve(cachedSource.theme) : Promise.resolve(void 0);
}
function isVideo(p) {
  return /\.(mp4|webm|mov|m4v|mkv)$/i.test(p);
}
function isWeb(p) {
  return /\.html?$/i.test(p);
}
function isAnimatedImage(p) {
  return /\.gif$/i.test(p);
}
function resolveSource(config) {
  if (!config.source || !fs8.existsSync(config.source))
    return void 0;
  if (isWeb(config.source))
    return { kind: "web", path: config.source, posterPath: void 0 };
  if (isVideo(config.source)) {
    if (config.optimize) {
      const cached = optimizedCopy(config.source, displayTargetHeight());
      if (cached)
        return { kind: "video", path: cached, posterPath: void 0, originalPath: config.source };
      void ensureOptimized(config.source);
    }
    return { kind: "video", path: config.source };
  }
  if (isAnimatedImage(config.source))
    return { kind: "image", path: config.source };
  return { kind: "image", path: config.source };
}
async function ensureOptimized(mediaPath) {
  let stamp = "0";
  try {
    const st = fs8.statSync(mediaPath);
    stamp = `${Math.round(st.mtimeMs)}-${st.size}`;
  } catch {
    return;
  }
  const key = `${mediaPath}|${stamp}`;
  if (optimizingChecked.has(key))
    return;
  optimizingChecked.add(key);
  const info = await probeVideo(mediaPath);
  if (needsOptimize(info))
    optimizedCopy(mediaPath, displayTargetHeight());
}
async function startServe(opts) {
  fs8.mkdirSync(dataDir(), { recursive: true });
  const stored = currentConfig();
  const apiPort = opts.apiPort ?? stored.apiPort;
  const mediaPort = opts.mediaPort ?? stored.mediaPort;
  const fixedCdpPort = opts.cdpPort ?? (stored.cdpPort > 0 ? stored.cdpPort : void 0);
  const token = randomBytes2(16).toString("hex");
  fs8.writeFileSync(tokenFile(), token);
  fs8.writeFileSync(pidFile(), String(process.pid));
  const media = await startMediaServer(mediaPort);
  let currentCdpPort;
  const held = /* @__PURE__ */ new Map();
  let publishedFor;
  async function mediaUrls(config, source) {
    if (publishedFor?.path === source.path)
      return publishedFor;
    const entry = { path: source.path };
    if (source.kind === "web") {
      entry.webUrl = `http://127.0.0.1:${media.port}${media.publish("web", source.path)}`;
    } else {
      entry.videoUrl = `http://127.0.0.1:${media.port}${media.publish("media", source.path)}`;
    }
    let posterPath = source.posterPath;
    if (!posterPath && source.kind === "video") {
      const posterFile = posterFileFor(source.originalPath ?? source.path);
      if (fs8.existsSync(posterFile))
        posterPath = posterFile;
    }
    if (config.projectId && (source.kind === "image" || source.kind === "web")) {
      const cached = cachedSteamPreview(config.projectId);
      const localDim = posterPath ? imageSize(posterPath) : void 0;
      const localWidth = localDim?.width ?? 0;
      if (cached) {
        const cachedDim = imageSize(cached);
        if ((cachedDim?.width ?? 0) > localWidth)
          posterPath = cached;
      } else if (!localDim || localWidth < MIN_USEFUL_PREVIEW_WIDTH) {
        refreshSteamPreview(config.projectId, (downloaded) => {
          const latest = currentConfig();
          if (latest.projectId === config.projectId && downloaded) {
            publishedFor = void 0;
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
  async function buildFor(config, opts2 = {}) {
    const source = resolveSource(config);
    if (!source)
      return void 0;
    const urls = await mediaUrls(config, source);
    const samplePath = source.originalPath ?? source.path;
    const theme = source.kind === "video" ? await themeFor(samplePath, { block: opts2.blockTheme }) : source.kind === "image" ? await themeForImage(samplePath, { block: opts2.blockTheme }) : void 0;
    const input = {
      config,
      videoUrl: source.kind === "image" ? void 0 : urls.videoUrl,
      posterUrl: urls.posterUrl,
      webUrl: urls.webUrl,
      theme: theme?.theme
    };
    if (source.kind === "image") {
      input.posterUrl = urls.videoUrl;
      input.videoUrl = void 0;
    }
    return { payload: buildPayload(input), input };
  }
  async function holdSession(target, config) {
    if (!target.webSocketDebuggerUrl)
      return;
    const conn = await CdpConnection.connect(target.webSocketDebuggerUrl);
    try {
      await conn.send("Page.enable");
      const session = { conn };
      const built = await buildFor(config);
      if (built) {
        const { identifier } = await conn.send("Page.addScriptToEvaluateOnNewDocument", {
          source: built.payload.script
        });
        session.themeScriptId = identifier;
        await conn.send("Runtime.evaluate", { expression: built.payload.script, returnByValue: true });
        if (built.input.theme === void 0)
          scheduleThemeRefresh(config);
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
  async function pushConfig(config, opts2 = {}) {
    const built = await buildFor(config, opts2);
    if (!built)
      return 0;
    let ok = 0;
    for (const [id, session] of held) {
      try {
        if (session.themeScriptId) {
          await session.conn.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: session.themeScriptId }).catch(() => {
          });
        }
        session.themeScriptId = await session.conn.send("Page.addScriptToEvaluateOnNewDocument", { source: built.payload.script }).then((r) => r.identifier);
        await session.conn.send("Runtime.evaluate", {
          expression: built.payload.script,
          returnByValue: true
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
  function scheduleThemeRefresh(config) {
    const source = resolveSource(config);
    if (!source)
      return;
    if (source.kind !== "video" && source.kind !== "image")
      return;
    const sample = source.originalPath ?? source.path;
    const wanted = source.path;
    const lookup = source.kind === "video" ? themeFor : themeForImage;
    void lookup(sample, { block: true }).then(async (theme) => {
      if (!theme)
        return;
      const latest = resolveSource(currentConfig());
      if (!latest || latest.path !== wanted)
        return;
      if (theme.posterJpeg) {
        try {
          const posterFile = posterFileFor(sample);
          fs8.writeFileSync(posterFile, theme.posterJpeg);
          for (const entry of fs8.readdirSync(dataDir())) {
            const isStale = entry === "poster.jpg" || entry.startsWith("poster-") && entry !== path8.basename(posterFile);
            if (!isStale)
              continue;
            try {
              fs8.rmSync(path8.join(dataDir(), entry), { force: true });
            } catch {
            }
          }
        } catch {
        }
      }
      publishedFor = void 0;
      await pushConfig(currentConfig(), { blockTheme: true }).catch(() => 0);
    }).catch(() => {
    });
  }
  function kickPoster(config) {
    const source = resolveSource(config);
    if (!source || source.kind !== "video")
      return;
    const sample = source.originalPath ?? source.path;
    const posterFile = posterFileFor(sample);
    try {
      if (fs8.existsSync(posterFile))
        return;
    } catch {
    }
    if (posterJobs.has(sample))
      return;
    const job = (async () => {
      try {
        const ff = await findFfmpeg();
        if (!ff)
          return;
        const from = cachedCopy(sample, displayTargetHeight()) ?? sample;
        const buf = await grabPosterJpeg(ff.path, from, 0);
        if (buf)
          fs8.writeFileSync(posterFile, buf);
      } catch {
      } finally {
        posterJobs.delete(sample);
      }
      const latest = resolveSource(currentConfig());
      if ((latest?.originalPath ?? latest?.path) === sample) {
        publishedFor = void 0;
        await pushConfig(currentConfig()).catch(() => 0);
      }
    })();
    posterJobs.set(sample, job);
  }
  let cdpMissingSince = 0;
  let lastAutoRestart = 0;
  async function maybeAutoRestart() {
    if (!currentConfig().autoRestart)
      return;
    const now = Date.now();
    if (!cdpMissingSince)
      cdpMissingSince = now;
    if (now - cdpMissingSince < AUTORESTART_DELAY_MS)
      return;
    if (now - lastAutoRestart < AUTORESTART_COOLDOWN_MS)
      return;
    if (!await isZcodeProcessRunning()) {
      cdpMissingSince = now;
      return;
    }
    lastAutoRestart = now;
    console.log("serve: ZCode has no CDP port \u2014 restarting it with --remote-debugging-port");
    await killZcode();
    for (let i = 0; i < 20; i++) {
      await new Promise((r2) => setTimeout(r2, 500));
      if (!await isZcodeProcessRunning())
        break;
    }
    if (await isZcodeProcessRunning()) {
      console.error("serve: ZCode did not exit; auto-restart abandoned for this cooldown");
      return;
    }
    const r = await launchZcode(fixedCdpPort ?? 9222).catch((err) => {
      console.error(`serve: auto-restart failed \u2014 ${err.message}`);
      return { started: false };
    });
    if (r.started)
      console.log("serve: ZCode restarted with CDP; injection resumes on the next poll");
  }
  async function poll() {
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
          nextProcessProbe = Date.now() + 15e3;
          runtimeState = {
            cdpReachable: false,
            rendererCount: 0,
            zcodeRunning: await isZcodeProcessRunning(),
            lastError: "No ZCode renderer with an open CDP port found.",
            updatedAt: (/* @__PURE__ */ new Date()).toISOString()
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
          }
        }
      }
      for (const id of [...held.keys()]) {
        if (!current.has(id)) {
          held.get(id).conn.close();
          held.delete(id);
        }
      }
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
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
    } catch (err) {
      for (const [id, session] of held) {
        session.conn.close();
        held.delete(id);
      }
      if (Date.now() > nextProcessProbe) {
        nextProcessProbe = Date.now() + 15e3;
        runtimeState = {
          cdpReachable: false,
          cdpPort: port,
          rendererCount: 0,
          zcodeRunning: await isZcodeProcessRunning(),
          lastError: err.message,
          updatedAt: (/* @__PURE__ */ new Date()).toISOString()
        };
      }
      await maybeAutoRestart();
    }
  }
  function publicConfig(config) {
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
      sourceName: config.projectId ? findProject(config.projectId)?.title ?? path8.basename(config.source ?? "") : config.source ? path8.basename(config.source) : void 0,
      cdpPort: runtimeState.cdpPort,
      mediaPort: media.port
    };
  }
  function sanitize(body) {
    const out = {};
    if (typeof body?.blur === "number" && body.blur >= 0 && body.blur <= 100)
      out.blur = body.blur;
    if (typeof body?.dim === "number" && body.dim >= 0 && body.dim <= 100)
      out.dim = body.dim;
    if (typeof body?.monet === "boolean")
      out.monet = body.monet;
    if (typeof body?.wallpaperVisible === "boolean")
      out.wallpaperVisible = body.wallpaperVisible;
    if (body?.fit === "cover" || body?.fit === "contain")
      out.fit = body.fit;
    if (typeof body?.speed === "number" && body.speed >= 0.25 && body.speed <= 3)
      out.speed = body.speed;
    if (typeof body?.paused === "boolean")
      out.paused = body.paused;
    if (typeof body?.pauseOnBlur === "boolean")
      out.pauseOnBlur = body.pauseOnBlur;
    if (typeof body?.optimize === "boolean")
      out.optimize = body.optimize;
    return out;
  }
  function sendJson(res, code, body) {
    try {
      res.writeHead(code, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, x-zlw-token"
      });
      res.end(JSON.stringify(body));
    } catch {
    }
  }
  function authorized(req) {
    const header = req.headers["x-zlw-token"];
    return typeof header === "string" && header === token;
  }
  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on("data", (c) => {
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
  const server = http2.createServer((req, res) => {
    handle(req, res).catch(() => {
      try {
        res.destroy();
      } catch {
      }
    });
  });
  async function handle(req, res) {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    try {
      if (req.method === "OPTIONS")
        return sendJson(res, 204, {});
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
          clearOptimizeChecks();
        }
        const config = { ...currentConfig(), ...patch };
        saveConfig(config);
        const windows = await pushConfig(config).catch(() => 0);
        if (patch.monet !== void 0)
          scheduleThemeRefresh(config);
        return sendJson(res, 200, { ok: true, windows, ...publicConfig(config) });
      }
      if (req.method === "GET" && url.pathname === "/api/projects") {
        const projects = listPlayable().map((p) => ({
          id: p.id,
          title: p.title,
          type: p.type,
          source: p.source,
          media: p.mediaPath ? path8.basename(p.mediaPath) : void 0
        }));
        return sendJson(res, 200, { projects });
      }
      if (req.method === "POST" && url.pathname === "/api/source") {
        const body = JSON.parse(await readBody(req));
        const wanted = body?.project != null && body.project !== "" ? String(body.project) : "";
        const project = wanted ? findProject(wanted) : void 0;
        if (!project?.mediaPath) {
          return sendJson(res, 400, { error: `no playable project matching "${wanted}"` });
        }
        const config = {
          ...currentConfig(),
          source: project.mediaPath,
          sourceKind: project.type === "web" ? "web" : isVideo(project.mediaPath) ? "video" : "image",
          projectId: project.id
        };
        publishedFor = void 0;
        saveConfig(config);
        const windows = await pushConfig(config).catch(() => 0);
        scheduleThemeRefresh(config);
        kickPoster(config);
        return sendJson(res, 200, { ok: true, windows, ...publicConfig(config) });
      }
      if (req.method === "POST" && url.pathname === "/api/source/path") {
        const body = JSON.parse(await readBody(req));
        const file = typeof body?.path === "string" ? path8.resolve(body.path) : "";
        if (!file || !fs8.existsSync(file)) {
          return sendJson(res, 400, { error: "file not found" });
        }
        if (file.startsWith(cacheDir())) {
          return sendJson(res, 400, { error: "cache files cannot be used as a wallpaper source" });
        }
        const config = {
          ...currentConfig(),
          source: file,
          sourceKind: isWeb(file) ? "web" : isVideo(file) ? "video" : "image",
          projectId: void 0
        };
        publishedFor = void 0;
        saveConfig(config);
        const windows = await pushConfig(config).catch(() => 0);
        scheduleThemeRefresh(config);
        kickPoster(config);
        return sendJson(res, 200, { ok: true, windows, ...publicConfig(config) });
      }
      if (req.method === "POST" && url.pathname === "/api/upload") {
        const body = JSON.parse(await readBody(req));
        const name = typeof body?.name === "string" ? path8.basename(body.name) : "";
        const dataUri = typeof body?.dataUri === "string" ? body.dataUri : "";
        const m = /^data:(video\/[\w.+-]+|image\/[\w.+-]+);base64,(.+)$/.exec(dataUri);
        if (!m || !name)
          return sendJson(res, 400, { error: "name and a base64 media data URI are required" });
        const bytes = Buffer.from(m[2], "base64");
        if (bytes.length > MAX_UPLOAD_BYTES) {
          return sendJson(res, 400, {
            error: `file too large (max ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB)`
          });
        }
        const dir = path8.join(dataDir(), "uploads");
        fs8.mkdirSync(dir, { recursive: true });
        const extByMime = {
          "image/jpeg": ".jpg",
          "image/png": ".png",
          "image/webp": ".webp",
          "image/gif": ".gif",
          "image/bmp": ".bmp",
          "image/avif": ".avif",
          "video/mp4": ".mp4",
          "video/webm": ".webm",
          "video/quicktime": ".mov",
          "video/x-matroska": ".mkv"
        };
        let safeName = name;
        if (!path8.extname(safeName))
          safeName += extByMime[m[1]] ?? "";
        const dest = path8.join(dir, safeName);
        fs8.writeFileSync(dest, bytes);
        const config = {
          ...currentConfig(),
          source: dest,
          sourceKind: isWeb(dest) ? "web" : isVideo(dest) ? "video" : "image",
          projectId: void 0
        };
        publishedFor = void 0;
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
              await session.conn.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: session.themeScriptId }).catch(() => {
              });
              session.themeScriptId = void 0;
            }
            await session.conn.send("Runtime.evaluate", { expression: buildResetScript() });
          } catch {
            session.conn.close();
            held.delete(id);
          }
        }
        const config = currentConfig();
        saveConfig({ ...config, source: void 0, sourceKind: void 0, projectId: void 0 });
        return sendJson(res, 200, { ok: true });
      }
      if (req.method === "GET" && url.pathname === "/api/status") {
        return sendJson(res, 200, {
          ...runtimeState,
          service: "zcode-livewall",
          pid: process.pid
        });
      }
      if (req.method === "GET" && url.pathname === "/api/health") {
        return sendJson(res, 200, { ok: true, service: "zcode-livewall", pid: process.pid });
      }
      return sendJson(res, 404, { error: "not found" });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(apiPort, "127.0.0.1", resolve);
  });
  server.on("error", (err) => console.error(`serve: http error \u2014 ${err.message}`));
  const shutdown = async () => {
    try {
      fs8.rmSync(pidFile(), { force: true });
    } catch {
    }
    for (const [, s] of held)
      s.conn.close();
    await media.close().catch(() => {
    });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  console.log(`serve: control API on http://127.0.0.1:${apiPort}`);
  console.log(`serve: media on http://127.0.0.1:${media.port} (token-gated)`);
  console.log(`serve: CDP ${fixedCdpPort ? `pinned to ${fixedCdpPort}` : "auto-discovering"}`);
  await poll();
  let steamRetryAt = 0;
  for (; ; ) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    await poll();
    const now = Date.now();
    if (now - steamRetryAt > 6e4) {
      steamRetryAt = now;
      const cfg = currentConfig();
      const source = resolveSource(cfg);
      if (cfg.projectId && source && (source.kind === "image" || source.kind === "web") && !cachedSteamPreview(cfg.projectId)) {
        const poster = source.posterPath;
        const dim = poster ? imageSize(poster) : void 0;
        if (!dim || dim.width < MIN_USEFUL_PREVIEW_WIDTH) {
          refreshSteamPreview(cfg.projectId, (downloaded) => {
            const latest = currentConfig();
            if (latest.projectId === cfg.projectId && downloaded) {
              publishedFor = void 0;
              void pushConfig(latest).catch(() => 0);
            }
          });
        }
      }
    }
  }
}
async function existingServePid(apiPort) {
  try {
    const res = await fetch(`http://127.0.0.1:${apiPort}/api/health`, {
      signal: AbortSignal.timeout(1e3)
    });
    const body = await res.json();
    return body?.service === "zcode-livewall" ? body.pid : void 0;
  } catch {
    return void 0;
  }
}

// dist/cli.js
var USAGE = `zcode-livewall <command> [options]

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
async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const flag = (name) => {
    const i = rest.indexOf(name);
    return i >= 0 && i + 1 < rest.length ? rest[i + 1] : void 0;
  };
  const has = (name) => rest.includes(name);
  try {
    switch (cmd) {
      case "launch": {
        const port = Number(flag("--port") ?? 9222);
        const r = await launchZcode(port);
        if (r.started)
          console.log(`ZCode started with CDP on port ${port}.`);
        else if (r.reason === "running-without-cdp") {
          console.error("A ZCode instance is already running without the debug port. Quit ZCode completely (including the tray icon) and run this command again.");
          process.exitCode = 1;
        } else
          console.log(`ZCode already reachable on port ${port}.`);
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
        const asFile = fs9.existsSync(target) ? path9.resolve(target) : void 0;
        const project = asFile ? void 0 : findProject(target);
        if (!asFile && !project?.mediaPath) {
          console.error(`No Wallpaper Engine project or file matching "${target}".`);
          process.exitCode = 1;
          break;
        }
        const config = {
          ...currentConfig(),
          source: asFile ?? project.mediaPath,
          sourceKind: asFile ? /\.html?$/i.test(asFile) ? "web" : /\.(mp4|webm|mov|m4v|mkv)$/i.test(asFile) ? "video" : "image" : project.type === "web" ? "web" : /\.(mp4|webm|mov|m4v)$/i.test(project.mediaPath) ? "video" : "image",
          projectId: project?.id
        };
        if (flag("--blur"))
          config.blur = Number(flag("--blur"));
        if (flag("--dim"))
          config.dim = Number(flag("--dim"));
        if (flag("--fit") === "cover" || flag("--fit") === "contain")
          config.fit = flag("--fit");
        if (has("--no-monet"))
          config.monet = false;
        saveConfig(config);
        console.log(`Stored "${project?.title ?? path9.basename(config.source)}" as the animated wallpaper.`);
        console.log("Run `zcode-livewall serve` (or use the plugin panel) to inject it.");
        break;
      }
      case "serve": {
        const apiPort = Number(flag("--api-port") ?? DEFAULT_CONFIG.apiPort);
        const mediaPort = Number(flag("--media-port") ?? DEFAULT_CONFIG.mediaPort);
        if (has("--detach")) {
          await startDetached(apiPort, mediaPort, flag("--port") ? Number(flag("--port")) : void 0);
          break;
        }
        await startServe({
          apiPort,
          mediaPort,
          cdpPort: flag("--port") ? Number(flag("--port")) : void 0
        });
        break;
      }
      case "stop": {
        let pid;
        try {
          pid = Number(fs9.readFileSync(pidFile(), "utf8").trim());
        } catch {
        }
        if (!pid) {
          console.log("No serve pid file; nothing to stop.");
          break;
        }
        try {
          process.kill(pid);
          fs9.rmSync(pidFile(), { force: true });
          console.log(`Stopped serve (pid ${pid}).`);
        } catch (err) {
          console.error(`Could not stop pid ${pid}: ${err.message}`);
        }
        break;
      }
      case "status": {
        const stored = loadConfig();
        const port = await discoverCdpPort(stored.cdpPort && stored.cdpPort > 0 ? stored.cdpPort : void 0);
        console.log(JSON.stringify({ config: { ...DEFAULT_CONFIG, ...stored }, cdpPort: port ?? null }, null, 2));
        if (!port) {
          console.log("CDP not reachable. If ZCode is running, it was started without --remote-debugging-port.\nQuit ZCode completely, then start it from a shortcut that carries the flag (see zcode-beautify repair-launchers).");
        } else {
          const targets = pickRendererTargets(await listTargets(port));
          console.log(`${targets.length} renderer target(s) on port ${port}.`);
        }
        break;
      }
      case "reset": {
        const config = currentConfig();
        saveConfig({ ...config, source: void 0, sourceKind: void 0, projectId: void 0 });
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
        if (cmd !== void 0)
          process.exitCode = 1;
    }
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exitCode = 1;
  }
}
async function startDetached(apiPort, mediaPort, cdpPort) {
  const already = await existingServePid(apiPort);
  if (already !== void 0) {
    throw new Error(`a livewall service is already running on port ${apiPort} (pid ${already})`);
  }
  fs9.mkdirSync(dataDir(), { recursive: true });
  const logFile = path9.join(dataDir(), "serve.log");
  const out = fs9.openSync(logFile, "a");
  const args = [process.argv[1], "serve", "--api-port", String(apiPort), "--media-port", String(mediaPort)];
  if (cdpPort)
    args.push("--port", String(cdpPort));
  const child = spawn2(process.execPath, args, {
    detached: true,
    stdio: ["ignore", out, out],
    windowsHide: true
  });
  child.unref();
  fs9.closeSync(out);
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const res = await fetch(`http://127.0.0.1:${apiPort}/api/health`, {
        signal: AbortSignal.timeout(1e3)
      });
      const body = await res.json();
      if (body?.service === "zcode-livewall") {
        console.log(`LiveWall service running on http://127.0.0.1:${apiPort} (pid ${body.pid}).`);
        console.log(`Log: ${logFile}`);
        return;
      }
    } catch {
    }
  }
  console.error(`serve did not come up within 10s \u2014 see ${logFile}`);
  process.exitCode = 1;
}
main();
