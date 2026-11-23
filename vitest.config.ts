import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Agent skills under .claude/ ship their own example tests; keep them out of the project suite.
    exclude: [...configDefaults.exclude, ".claude/**"],
  },
});
