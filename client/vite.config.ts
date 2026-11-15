import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// host 0.0.0.0 + allowedHosts so the dev server works inside Replit's preview.
// /api is proxied to the backend (server/) once it exists.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: true,
    proxy: { "/api": "http://localhost:3000" },
  },
});
