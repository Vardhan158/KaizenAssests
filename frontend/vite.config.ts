import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default (defineConfig as any)({
  server: {
    port: 8080,
    strictPort: true,
    host: "0.0.0.0",
  },
  resolve: {
    tsconfigPaths: true,
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
