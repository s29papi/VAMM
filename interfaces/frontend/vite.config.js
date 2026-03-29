import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiBaseUrl = (env.VAMM_MAKER_API_BASE_URL ?? "").trim().replace(/\/$/, "");
  const apiKey = (env.VAMM_API_KEY ?? "").trim();

  return {
    plugins: [react()],
    build: {
      target: "esnext",
    },
    resolve: {
      alias: {
        "core-js/proposals/json-parse-with-source.js": fileURLToPath(
          new URL("./src/shims/json-parse-with-source.js", import.meta.url),
        ),
      },
    },
    optimizeDeps: {
      exclude: ["@provablehq/sdk", "@provablehq/wasm"],
      esbuildOptions: {
        target: "esnext",
      },
    },
    server: {
      host: "0.0.0.0",
      port: 4173,
      proxy: apiBaseUrl
        ? {
          "/api/vamm": {
            target: apiBaseUrl,
            changeOrigin: true,
            headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
          },
        }
        : undefined,
    },
  };
});
