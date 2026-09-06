import { defineConfig } from "vitest/config";
import * as path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    silent: true,
  },
  resolve: {
    alias: {
      "@orchlet/shared": path.resolve(__dirname, "packages/shared/src/index.ts"),
      "@orchlet/core": path.resolve(__dirname, "packages/core/src/index.ts"),
      "@orchlet/usage": path.resolve(__dirname, "packages/usage/src/index.ts"),
      "@orchlet/routing": path.resolve(__dirname, "packages/routing/src/index.ts"),
      "@orchlet/context": path.resolve(__dirname, "packages/context/src/index.ts"),
      "@orchlet/github": path.resolve(__dirname, "packages/github/src/index.ts"),
      "@orchlet/providers": path.resolve(__dirname, "packages/providers/src/index.ts"),
      "@orchlet/notifications": path.resolve(__dirname, "packages/notifications/src/index.ts"),
      "@orchlet/workflow-engine": path.resolve(__dirname, "packages/workflow-engine/src/index.ts"),
      "@orchlet/t3-adapter": path.resolve(__dirname, "packages/t3-adapter/src/index.ts"),
    },
  },
});
