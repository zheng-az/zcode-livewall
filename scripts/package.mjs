// Packages the distributable bundles into packages/:
//   zcode-livewall-plugin-v<version>.zip — ready-made plugin for ZCode users.
// Run via `npm run package`. Zip entry names use forward slashes only (ZCode
// rejects backslashes / absolute paths in plugin zips).
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const AdmZip = require("adm-zip");

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const version = pkg.version;
const outDir = "packages";
fs.mkdirSync(outDir, { recursive: true });

const pluginFiles = [
  "marketplace.json",
  ".zcode-plugin/plugin.json",
  "commands/livewall.md",
  "skills/livewall/SKILL.md",
  "dist/cli.js",
  "dist/mcp/server.js",
  "README.md",
  "LICENSE",
  "package.json",
];

const pluginZip = new AdmZip();
for (const rel of pluginFiles) {
  const full = path.resolve(rel);
  if (!fs.existsSync(full)) {
    throw new Error(`missing file for plugin package: ${rel}`);
  }
  const zipPath = `zcode-livewall-plugin-v${version}/${rel.split(path.sep).join("/")}`;
  pluginZip.addFile(zipPath, fs.readFileSync(full));
}
const pluginOut = path.join(outDir, `zcode-livewall-plugin-v${version}.zip`);
fs.writeFileSync(pluginOut, pluginZip.toBuffer());

console.log(`${pluginOut} (${pluginZip.toBuffer().length} bytes)`);
