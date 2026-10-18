/**
 * Local media server for the injected video layer.
 *
 * A 45 MB wallpaper cannot travel as a data URI, and a `file://` URL is not
 * readable from the renderer, so the video is served over loopback HTTP with
 * byte-range support (required for seeking and for Chromium to start playback
 * before the whole file arrives). The server binds to 127.0.0.1 only.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export interface MediaServer {
  port: number;
  /** Unguessable path prefix; nothing else on the machine can enumerate media. */
  token: string;
  /** Registers a file and returns its loopback URL path. */
  publish(kind: string, filePath: string): string;
  close(): Promise<void>;
}

export async function startMediaServer(port: number): Promise<MediaServer> {
  const token = randomBytes(12).toString("hex");
  const published = new Map<string, string>();

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

      let stat: fs.Stats;
      try {
        stat = fs.statSync(filePath);
      } catch {
        res.writeHead(404).end();
        return;
      }

      const headers: Record<string, string> = {
        "Content-Type": MIME[path.extname(filePath).toLowerCase()] ?? "application/octet-stream",
        "Accept-Ranges": "bytes",
        // The published keys map one file for the lifetime of this process and
        // every restart gets a fresh token + keys, so a URL can never serve
        // different bytes. Caching on the renderer side is what makes a reload
        // or app restart paint instantly instead of re-streaming the file.
        "Cache-Control": "public, max-age=31536000, immutable",
        "Access-Control-Allow-Origin": "*",
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
          "Content-Length": end - start + 1,
        });
        if (req.method === "HEAD") {
          res.end();
          return;
        }
        fs.createReadStream(filePath, { start, end }).pipe(res);
        return;
      }

      res.writeHead(200, { ...headers, "Content-Length": stat.size });
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      fs.createReadStream(filePath).pipe(res);
    } catch {
      try {
        res.destroy();
      } catch {
        /* socket gone */
      }
    }
  });

  // A dead pipe (renderer navigated away mid-stream) must not kill the server.
  server.on("clientError", (_err, socket) => {
    try {
      socket.destroy();
    } catch {
      /* ignore */
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });

  return {
    port,
    token,
    publish(kind: string, filePath: string): string {
      const key = `${kind}-${randomBytes(6).toString("hex")}${path.extname(filePath).toLowerCase()}`;
      published.set(key, filePath);
      return `/m/${token}/${encodeURIComponent(key)}`;
    },
    close(): Promise<void> {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
