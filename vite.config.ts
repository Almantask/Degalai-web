import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  createReadStream,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { includePublishedDataFile } from "./scripts/publish-data.ts";

const base = process.env.BASE_URL ?? "/";

export default defineConfig({
  base,
  plugins: [
    {
      name: "data-files",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = req.url ?? "";
          if (!url.startsWith("/data/")) return next();
          const rel = decodeURIComponent(url.slice("/data/".length).split("?")[0]);
          const file = resolve("data", rel);
          const root = resolve("data");
          if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile())
            return next();
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.setHeader("Cache-Control", "no-cache");
          createReadStream(file).pipe(res);
        });
      },
      closeBundle() {
        const dist = resolve("dist");
        if (!existsSync(dist) || !existsSync("data")) return;
        const distData = join(dist, "data");
        if (existsSync(distData)) rmSync(distData, { recursive: true });
        mkdirSync(distData, { recursive: true });
        let latestPrice = "";
        try {
          const meta = JSON.parse(readFileSync(resolve("data/meta.json"), "utf8")) as {
            date?: string;
          };
          latestPrice = meta.date ?? "";
        } catch {
          latestPrice = "";
        }
        const dataRoot = resolve("data");
        cpSync("data", join(dist, "data"), {
          recursive: true,
          filter: (src) => includePublishedDataFile(relative(dataRoot, resolve(src)), latestPrice),
        });
        const histPath = join(dist, "data/history.json");
        if (existsSync(histPath)) {
          try {
            const hist = JSON.parse(readFileSync(histPath, "utf8")) as {
              samples?: unknown;
              generatedAt?: string;
              keepDays?: number;
              byFuel?: unknown;
            };
            const { samples: _samples, ...rest } = hist;
            writeFileSync(histPath, `${JSON.stringify(rest)}\n`);
          } catch {
            // Keep the copied file if it is not JSON.
          }
        }
        const indexPath = join(dist, "index.html");
        if (!existsSync(indexPath)) return;
        const index = readFileSync(indexPath, "utf8");
        for (const route of ["en", "istorija", "en/history", "apie", "en/about"]) {
          const file = join(dist, route, "index.html");
          mkdirSync(join(file, ".."), { recursive: true });
          writeFileSync(file, index);
        }
        writeFileSync(join(dist, "404.html"), index);
      },
    },
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: false,
      workbox: {
        globDirectory: "dist",
        globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
        globIgnores: ["**/data/**"],
        navigateFallback: "index.html",
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.endsWith("/history.json"),
            handler: "NetworkFirst",
            options: {
              cacheName: "kur-degalai-history",
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
          {
            urlPattern: ({ url }) =>
              url.pathname.includes("/data/") && url.pathname.endsWith(".json"),
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "kur-degalai-data",
              expiration: { maxEntries: 12, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
          {
            urlPattern: /^https:\/\/tiles\.openfreemap\.org\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "openfreemap-tiles",
              expiration: { maxEntries: 256, maxAgeSeconds: 60 * 60 * 24 * 14 },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: { "@": resolve("src") },
  },
});
