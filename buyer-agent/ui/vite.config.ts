import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // Keeps the browser same-origin in dev, so there is no CORS dance and no API base URL to
      // configure in the client.
      "/api": { target: "http://localhost:4100", changeOrigin: true },
    },
  },
});
