import { defineConfig } from "vitest/config";

export default defineConfig({ test: { maxWorkers: 2, include: ["lib/**/*.test.ts", "03-webhook/**/*.test.ts"], exclude: ["fixtures/**", "runner/**", "node_modules/**"] } });
