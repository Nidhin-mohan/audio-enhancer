/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Cross-origin isolation lets ONNX Runtime use multithreaded WASM for Separation.
const isolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // The regular test run stays unisolated (simplest for the test runner); slow tests need threads.
  server: { headers: mode === "test" ? {} : isolation },
  preview: { headers: isolation },
  worker: { format: "es" },
  optimizeDeps: {
    include: ["@breezystack/lamejs", "mp4-muxer"],
    // ONNX Runtime locates its .wasm files relative to its own module; pre-bundling breaks that.
    exclude: ["onnxruntime-web", "demucs-web"],
  },
  test: {
    // `npm run test:slow` runs only the slow tests (e.g. the real Separation model).
    include: mode === "slow" ? ["src/**/*.slow.test.ts"] : ["src/**/*.test.ts"],
    exclude: mode === "slow" ? [] : ["src/**/*.slow.test.ts"],
    testTimeout: mode === "slow" ? 15 * 60_000 : 5_000,
    browser: {
      enabled: true,
      provider: "playwright",
      headless: true,
      instances: [
        {
          browser: "chromium",
          launch: { channel: "msedge", args: ["--autoplay-policy=no-user-gesture-required"] },
        },
      ],
    },
  },
}));
