import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
