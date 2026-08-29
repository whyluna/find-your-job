import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
      "@shared": path.resolve(root, "packages/shared/src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "packages/shared/src/**/*.test.ts"],
  },
});
