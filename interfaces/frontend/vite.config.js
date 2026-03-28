import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
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
  },
});
