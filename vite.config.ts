/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.slow.test.ts"],
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
});
