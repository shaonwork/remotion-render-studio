import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/* SINGLE=1 vite build → everything (JS, CSS, the esbuild .wasm, encoder chunks)
   is inlined as data URIs / one bundle, so scripts/make-single.mjs can fold the
   result into ONE self-contained HTML file that runs from file:// with no server. */
const single = process.env.SINGLE === "1";

export default defineConfig({
  plugins: [react()],
  resolve: { dedupe: ["react", "react-dom", "remotion"] },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 6000,
    ...(single
      ? {
          assetsInlineLimit: () => true,
          cssCodeSplit: false,
          rollupOptions: { output: { inlineDynamicImports: true } },
        }
      : {}),
  },
});
