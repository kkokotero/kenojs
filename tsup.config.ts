import { defineConfig } from "tsup";

const entry = [
  "src/index.ts",
  "src/application/index.ts",
  "src/certificates/index.ts",
  "src/client/index.ts",
  "src/middleware/index.ts",
  "src/multi-server/index.ts",
  "src/plugins/index.ts",
  "src/request/index.ts",
  "src/response/index.ts",
  "src/router/index.ts",
  "src/thread-cluster/index.ts",
  "src/types/index.ts",
  "src/websocket/index.ts",
  "src/worker-pool/index.ts",
];

export default defineConfig({
  entry,
  clean: true,
  dts: true,
  external: ["selfsigned"],
  format: ["esm"],
  minify: true,
  outDir: "dist",
  platform: "node",
  sourcemap: false,
  splitting: true,
  target: "es2022",
  treeshake: true,
  bundle: true,
});
