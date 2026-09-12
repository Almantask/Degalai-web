import { cpSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync, createReadStream } from "node:fs";
import { join, resolve } from "node:path";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

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
          if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) return next();
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.setHeader("Cache-Control", "no-cache");
          createReadStream(file).pipe(res);
        });
      },
      closeBundle() {
        const dist = resolve("dist");
        if (!existsSync(dist) || !existsSync("data")) return;
        mkdirSync(join(dist, "data"), { recursive: true });
        cpSync("data", join(dist, "data"), {
          recursive: true,
          filter: (src) => !src.includes("/cache") && !src.includes("/downloads"),
        });
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
            urlPattern: ({ url }) => url.pathname.includes("/data/") && url.pathname.endsWith(".json"),
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "kur-degalai-data",
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 14 },
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
