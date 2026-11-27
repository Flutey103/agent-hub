import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { productDescription, productName, productTitle, productUrl } from "../shared/brand";

const root = path.dirname(fileURLToPath(import.meta.url));

function brandHtml(): Plugin {
  return {
    name: "brand-html",
    transformIndexHtml(html) {
      return html
        .replaceAll("__PRODUCT_TITLE__", productTitle)
        .replaceAll("__PRODUCT_DESCRIPTION__", productDescription)
        .replaceAll("__PRODUCT_NAME__", productName)
        .replaceAll("__PRODUCT_URL__", productUrl);
    },
  };
}

function oauthSessionDev(): Plugin {
  return {
    name: "oauth-session-dev",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const pathname = req.url?.split("?")[0];
        if (pathname !== "/oauth-session.js") return next();
        try {
          const loaded = await server.transformRequest("/src/oauth-session.ts");
          if (!loaded) return next();
          res.statusCode = 200;
          res.setHeader("Content-Type", "text/javascript");
          res.setHeader("Cache-Control", "no-store");
          res.end(loaded.code);
        } catch (error) {
          res.statusCode = 500;
          res.end(error instanceof Error ? error.message : "oauth session script failed");
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), brandHtml(), oauthSessionDev()],
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(root, "index.html"),
        "oauth-session": path.resolve(root, "src/oauth-session.ts"),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === "oauth-session" ? "oauth-session.js" : "assets/[name]-[hash].js"),
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
  resolve: { alias: { "@": path.resolve(root, "src") } },
  envDir: "..",
  server: {
    port: 5173,
    fs: { allow: [".."] },
    proxy: {
      "/api": "http://127.0.0.1:43123",
      "/mcp": "http://127.0.0.1:43123",
      "/authorize": "http://127.0.0.1:43123",
      "/token": "http://127.0.0.1:43123",
      "/register": "http://127.0.0.1:43123",
      "/.well-known": "http://127.0.0.1:43123",
    },
  },
});
