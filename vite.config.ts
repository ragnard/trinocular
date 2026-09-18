import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    fs: {
      allow: ["packages"]
    }
  },
  optimizeDeps: {
    // monaco-language-trino is this repo's own source, symlinked in by the
    // workspace. Pre-bundling it would cache a copy in node_modules/.vite that
    // survives edits to packages/, so exclude it: vite then compiles it from
    // source like the rest of src/, with HMR and nothing to invalidate.
    exclude: ["monaco-language-trino"]
  },
  resolve: {
    alias: [
      // Redirect bare `import 'monaco-editor'` to our slim setup,
      // but let deep imports like `monaco-editor/esm/...` pass through.
      {
        find: /^monaco-editor$/,
        replacement: new URL("./src/lib/monaco/monacoSetup.ts", import.meta.url).pathname
      }
    ]
  }
});
