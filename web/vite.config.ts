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

export default defineConfig({
  plugins: [react(), tailwindcss(), brandHtml()],
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
