import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:1247",
    channel: "chrome",
    headless: true,
    trace: "retain-on-failure"
  },
  webServer: {
    command: "node tests/e2e/fixture-server.mjs",
    url: "http://127.0.0.1:1247/api/health",
    timeout: 30_000,
    reuseExistingServer: false
  }
});
