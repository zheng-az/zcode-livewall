// Bundles the compiled CLI and MCP server into self-contained single files so
// the plugin can be installed without npm install. Run via `npm run bundle`.
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";

const { version } = JSON.parse(fs.readFileSync("package.json", "utf8"));

await build({
  entryPoints: ["dist/cli.js", "dist/mcp/server.js"],
  define: { __PLUGIN_VERSION__: JSON.stringify(version) },
  outdir: "dist",
  allowOverwrite: true,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  legalComments: "inline",
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});

// Remove the tsc intermediates the bundles were built from, so dist/ holds
// exactly the two shippable files (they regenerate on the next build).
const keep = new Set([path.resolve("dist/cli.js"), path.resolve("dist/mcp/server.js")]);
function clean(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.resolve(dir, entry.name);
    if (keep.has(full)) continue;
    if (entry.isDirectory()) clean(full);
    else fs.rmSync(full);
  }
  if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
}
clean("dist");

console.log("bundle written to dist/cli.js and dist/mcp/server.js");
