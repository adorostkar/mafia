import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  build: { assetsInlineLimit: 0 },
  server: {
    proxy: {
      "/api": `http://127.0.0.1:${process.env.PORT ?? loadEnv(mode, process.cwd(), "").PORT ?? "3001"}`,
    },
  },
}));
