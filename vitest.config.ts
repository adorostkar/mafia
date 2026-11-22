import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["server/**/*.test.ts", "src/**/*.test.{ts,tsx}"],
    environment: "node",
    fileParallelism: false,
    // Use browser storage from jsdom, not Node's optional server-side storage.
    execArgv: ["--no-experimental-webstorage"],
  },
});
