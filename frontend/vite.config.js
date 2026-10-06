import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// Optional Vite config — enables `vite` as an alternative dev server to CRA.
// The hosted environment runs `yarn start` (CRA) which continues to work.
// To use Vite locally: install `vite` and `@vitejs/plugin-react`, then run:
//   npx vite --port 3000 --host 0.0.0.0
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: false,
    open: false,
    cors: true,
  },
  preview: { port: 4173, host: "0.0.0.0" },
  css: {
    devSourcemap: true,
    postcss: "./postcss.config.js",
  },
  envPrefix: ["REACT_APP_", "VITE_"],
  build: {
    outDir: "build",
    sourcemap: false,
    cssCodeSplit: true,
    minify: "esbuild",
    target: "es2019",
  },
});
